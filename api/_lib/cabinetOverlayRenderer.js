import sharp from "sharp";

function stripDataUrl(value) {
  const parts = String(value || "").split(",");
  return parts.length > 1 ? parts[1] : "";
}

function dataUrl(buffer, mime = "image/png") {
  return `data:${mime};base64,${buffer.toString("base64")}`;
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
  if (!match) throw new Error("Cabinet detection did not return valid JSON.");
  return JSON.parse(match[0]);
}

function normalizeFace(face) {
  const corners = Array.isArray(face?.corners) ? face.corners : [];
  if (corners.length !== 4) return null;
  const points = corners.map(point => [
    Math.max(0, Math.min(1000, Number(point?.[0]))),
    Math.max(0, Math.min(1000, Number(point?.[1])))
  ]);
  if (points.some(point => !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) return null;
  const kind = String(face.kind || "").toLowerCase() === "drawer" ? "drawer" : "door";
  const rawGroup = String(face.group || "").toLowerCase();
  const group = rawGroup === "upper" ? "upper" : "base";
  return { kind, group, corners: points, confidence: Number(face.confidence || 0) };
}

export async function detectCabinetFaces(image, { timeoutMs = 18000 } = {}) {
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const prompt = `Analyze this kitchen photograph and locate every visible cabinet door and drawer front.

Return JSON only in this exact shape:
{"faces":[{"kind":"door|drawer","group":"upper|base","corners":[[x1,y1],[x2,y2],[x3,y3],[x4,y4]],"confidence":0.0}]}

Coordinates use a 0 to 1000 scale relative to the full image. Corners must be ordered top-left, top-right, bottom-right, bottom-left as they appear in perspective. Trace the outside edge of each actual door or drawer front precisely. Include narrow, partially visible, island, peninsula, and tall cabinet faces. Classify wall cabinets above the countertop as upper. Classify lower, island, peninsula, and tall base cabinetry as base. Exclude appliances, open shelves, cabinet interiors, face frames, countertops, walls, toe kicks, and decorative objects. Do not merge adjacent doors. Accuracy of the four corners is more important than prose. Return no explanation.`;

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
        max_output_tokens: 4000
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.error?.message || "Cabinet detection failed.");
    const parsed = parseJson(responseText(result));
    const faces = (Array.isArray(parsed.faces) ? parsed.faces : []).map(normalizeFace).filter(Boolean);
    if (!faces.length) throw new Error("No cabinet faces were detected.");
    return faces;
  } finally {
    clearTimeout(timer);
  }
}

async function imageRaw(image, options = {}) {
  const buffer = Buffer.from(stripDataUrl(image), "base64");
  let pipeline = sharp(buffer).rotate().ensureAlpha();
  if (options.resize) pipeline = pipeline.resize(options.resize);
  if (options.trim) pipeline = pipeline.trim({ background: options.background || "#151a25", threshold: 18 });
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

function pixel(source, x, y) {
  const sx = Math.max(0, Math.min(source.width - 1, Math.round(x)));
  const sy = Math.max(0, Math.min(source.height - 1, Math.round(y)));
  const index = (sy * source.width + sx) * source.channels;
  return [source.data[index], source.data[index + 1], source.data[index + 2], source.data[index + 3] ?? 255];
}

function averageColor(source) {
  let r = 0, g = 0, b = 0, count = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((source.width * source.height) / 12000)));
  for (let y = 0; y < source.height; y += step) {
    for (let x = 0; x < source.width; x += step) {
      const p = pixel(source, x, y);
      if (p[3] < 32) continue;
      r += p[0]; g += p[1]; b += p[2]; count += 1;
    }
  }
  return count ? [r / count, g / count, b / count] : [180, 180, 180];
}

function invert3(matrix) {
  const [a,b,c,d,e,f,g,h,i] = matrix;
  const A=e*i-f*h, B=-(d*i-f*g), C=d*h-e*g;
  const D=-(b*i-c*h), E=a*i-c*g, F=-(a*h-b*g);
  const G=b*f-c*e, H=-(a*f-c*d), I=a*e-b*d;
  const det=a*A+b*B+c*C;
  if (Math.abs(det) < 1e-9) return null;
  return [A/det,D/det,G/det,B/det,E/det,H/det,C/det,F/det,I/det];
}

function squareToQuad(points) {
  const [p0,p1,p2,p3] = points;
  const dx1=p1[0]-p2[0], dx2=p3[0]-p2[0], dx3=p0[0]-p1[0]+p2[0]-p3[0];
  const dy1=p1[1]-p2[1], dy2=p3[1]-p2[1], dy3=p0[1]-p1[1]+p2[1]-p3[1];
  let g=0, h=0;
  const denominator=dx1*dy2-dx2*dy1;
  if (Math.abs(dx3) > 1e-8 || Math.abs(dy3) > 1e-8) {
    if (Math.abs(denominator) < 1e-9) return null;
    g=(dx3*dy2-dx2*dy3)/denominator;
    h=(dx1*dy3-dx3*dy1)/denominator;
  }
  return [p1[0]-p0[0]+g*p1[0], p3[0]-p0[0]+h*p3[0], p0[0], p1[1]-p0[1]+g*p1[1], p3[1]-p0[1]+h*p3[1], p0[1], g, h, 1];
}

function pointInQuad(x, y, points) {
  let sign = 0;
  for (let index = 0; index < 4; index += 1) {
    const a = points[index], b = points[(index + 1) % 4];
    const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(cross) < 0.001) continue;
    const current = cross > 0 ? 1 : -1;
    if (sign && sign !== current) return false;
    sign = current;
  }
  return true;
}

function applyTemplate(output, canvasWidth, canvasHeight, template, swatch, face) {
  const points = face.corners.map(([x,y]) => [x * canvasWidth / 1000, y * canvasHeight / 1000]);
  const inverse = invert3(squareToQuad(points));
  if (!inverse) return;
  const minX=Math.max(0,Math.floor(Math.min(...points.map(p=>p[0]))));
  const maxX=Math.min(canvasWidth-1,Math.ceil(Math.max(...points.map(p=>p[0]))));
  const minY=Math.max(0,Math.floor(Math.min(...points.map(p=>p[1]))));
  const maxY=Math.min(canvasHeight-1,Math.ceil(Math.max(...points.map(p=>p[1]))));
  const templateAverage = averageColor(template);
  const templateLum = Math.max(1, 0.2126*templateAverage[0]+0.7152*templateAverage[1]+0.0722*templateAverage[2]);
  for (let y=minY; y<=maxY; y+=1) {
    for (let x=minX; x<=maxX; x+=1) {
      if (!pointInQuad(x+0.5,y+0.5,points)) continue;
      const denominator=inverse[6]*(x+0.5)+inverse[7]*(y+0.5)+inverse[8];
      if (Math.abs(denominator)<1e-9) continue;
      const u=(inverse[0]*(x+0.5)+inverse[1]*(y+0.5)+inverse[2])/denominator;
      const v=(inverse[3]*(x+0.5)+inverse[4]*(y+0.5)+inverse[5])/denominator;
      if (u<0||u>1||v<0||v>1) continue;
      const master=pixel(template,u*(template.width-1),v*(template.height-1));
      if (master[3]<24) continue;
      const material=pixel(swatch,(u*3%1)*(swatch.width-1),(v*3%1)*(swatch.height-1));
      const masterLum=0.2126*master[0]+0.7152*master[1]+0.0722*master[2];
      const relief=Math.max(0.42,Math.min(1.55,masterLum/templateLum));
      const index=(y*canvasWidth+x)*4;
      const alpha=0.94*(master[3]/255);
      for(let channel=0;channel<3;channel+=1){
        const colored=Math.max(0,Math.min(255,material[channel]*relief));
        output[index+channel]=Math.round(colored*alpha+output[index+channel]*(1-alpha));
      }
      output[index+3]=255;
    }
  }
}

export async function renderCabinetOverlays({ image, doorReference, drawerReference, upperSwatch, baseSwatch, faces }) {
  const [base, door, drawer, upper, lower] = await Promise.all([
    imageRaw(image),
    imageRaw(doorReference, { trim: true }),
    imageRaw(drawerReference, { trim: true }),
    imageRaw(upperSwatch, { resize: { width: 256, height: 256, fit: "cover" } }),
    imageRaw(baseSwatch || upperSwatch, { resize: { width: 256, height: 256, fit: "cover" } })
  ]);
  const output = Buffer.from(base.data);
  const ordered = [...faces].sort((a,b) => a.kind === b.kind ? 0 : a.kind === "door" ? -1 : 1);
  ordered.forEach(face => applyTemplate(output, base.width, base.height, face.kind === "drawer" ? drawer : door, face.group === "upper" ? upper : lower, face));
  const png = await sharp(output, { raw: { width: base.width, height: base.height, channels: 4 } }).png().toBuffer();
  return { image: dataUrl(png), width: base.width, height: base.height, faceCount: ordered.length };
}
