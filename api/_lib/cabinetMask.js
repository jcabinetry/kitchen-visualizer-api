import sharp from "sharp";

function stripDataUrl(value) {
  const parts = String(value || "").split(",");
  return parts.length > 1 ? parts[1] : "";
}

function responseText(result) {
  if (result?.output_text) return result.output_text;
  return (result?.output || [])
    .flatMap(item => item?.content || [])
    .map(item => item?.text || "")
    .join("\n");
}

function parseJson(text) {
  const value = String(text || "").trim();
  try { return JSON.parse(value); } catch (_error) {}
  const match = value.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Cabinet analysis did not return valid JSON.");
  return JSON.parse(match[0]);
}

function normalizePolygon(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const points = value.map(point => [
    Math.max(0, Math.min(1000, Number(point?.[0]))),
    Math.max(0, Math.min(1000, Number(point?.[1])))
  ]);
  return points.some(point => !Number.isFinite(point[0]) || !Number.isFinite(point[1])) ? null : points;
}

function escapeXml(value) {
  return String(value).replace(/[&<>\"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[character]));
}

export async function analyzeCabinetRegions(image, { timeoutMs = 22000 } = {}) {
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const prompt = `Find all visible cabinetry in this kitchen photograph so an image editor can refinish it.

Return JSON only in this exact shape:
{"regions":[{"group":"upper|base","polygon":[[x,y],[x,y],[x,y]]}],"faceCount":0}

Coordinates use a 0 to 1000 scale relative to the full photograph. Draw tight polygons around connected visible cabinet assemblies. Include doors, drawer fronts, face frames, exposed cabinet sides, end panels, fillers, trim, toe kicks, island panels, and peninsula panels. Upper means wall cabinets above countertops. Base means lower cabinets, islands, peninsulas, and tall pantry cabinets. Exclude countertops, backsplash, walls, floors, appliances, open shelves, cabinet interiors, windows, decorations, people, and loose objects. Use enough polygon points to follow the actual cabinet boundaries. Do not return rectangles unless the visible cabinet assembly is truly rectangular. Return no explanation.`;

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.CABINET_DETECTION_MODEL || "gpt-4.1-mini",
        input: [{ role: "user", content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: image, detail: "high" }
        ] }],
        max_output_tokens: 5000
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.error?.message || "Cabinet analysis failed.");
    const parsed = parseJson(responseText(result));
    const regions = (Array.isArray(parsed.regions) ? parsed.regions : [])
      .map(region => ({
        group: String(region?.group || "").toLowerCase() === "upper" ? "upper" : "base",
        polygon: normalizePolygon(region?.polygon)
      }))
      .filter(region => region.polygon);
    if (!regions.length) throw new Error("No cabinet regions were detected.");
    return { regions, faceCount: Math.max(0, Number(parsed.faceCount || 0)) };
  } finally {
    clearTimeout(timer);
  }
}

export async function createCabinetEditMask(image, regions) {
  const input = Buffer.from(stripDataUrl(image), "base64");
  if (!input.length) throw new Error("Invalid kitchen image.");
  const metadata = await sharp(input).rotate().metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) throw new Error("Kitchen image dimensions could not be read.");

  const polygons = regions.map(region => {
    const points = region.polygon.map(([x, y]) => `${(x * width / 1000).toFixed(1)},${(y * height / 1000).toFixed(1)}`).join(" ");
    return `<polygon points="${escapeXml(points)}" fill="black"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/>${polygons}</svg>`;
  const alpha = await sharp(Buffer.from(svg)).greyscale().raw().toBuffer();
  const rgb = await sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } } }).raw().toBuffer();
  const mask = await sharp(rgb, { raw: { width, height, channels: 3 } })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
  return `data:image/png;base64,${mask.toString("base64")}`;
}

export async function createCabinetGroupMask(image, regions, group) {
  return createCabinetEditMask(image, regions.filter(region => region.group === group));
}

async function averageSwatch(dataUrl) {
  const input = Buffer.from(stripDataUrl(dataUrl), "base64");
  if (!input.length) throw new Error("Invalid finish swatch.");
  const channels = await sharp(input).resize(48, 48, { fit: "cover" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const totals = [0, 0, 0];
  for (let index = 0; index < channels.data.length; index += channels.info.channels) {
    totals[0] += channels.data[index];
    totals[1] += channels.data[index + 1];
    totals[2] += channels.data[index + 2];
  }
  const count = channels.data.length / channels.info.channels;
  return { r: Math.round(totals[0] / count), g: Math.round(totals[1] / count), b: Math.round(totals[2] / count) };
}

export async function createPrecoloredKitchen(image, upperMask, baseMask, upperSwatch, baseSwatch) {
  const input = Buffer.from(stripDataUrl(image), "base64");
  if (!input.length) throw new Error("Invalid kitchen image.");
  const metadata = await sharp(input).rotate().metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) throw new Error("Kitchen image dimensions could not be read.");

  async function tintLayer(maskDataUrl, swatchDataUrl) {
    const color = await averageSwatch(swatchDataUrl);
    const mask = Buffer.from(stripDataUrl(maskDataUrl), "base64");
    const alpha = await sharp(mask).ensureAlpha().extractChannel(3).negate().linear(0.68).png().toBuffer();
    const rgb = await sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
    return sharp(rgb).joinChannel(alpha).png().toBuffer();
  }

  const layers = [];
  if (upperMask && upperSwatch) layers.push({ input: await tintLayer(upperMask, upperSwatch), blend: "over" });
  if (baseMask && baseSwatch) layers.push({ input: await tintLayer(baseMask, baseSwatch), blend: "over" });
  const output = await sharp(input).rotate().composite(layers).jpeg({ quality: 94, chromaSubsampling: "4:4:4" }).toBuffer();
  return `data:image/jpeg;base64,${output.toString("base64")}`;
}
