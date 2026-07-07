import { setCorsHeaders } from "./_lib/cors.js";
import { saveCatalog } from "./_lib/catalogStore.js";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
}

function requireAdmin(req, res) {
  const required = process.env.ADMIN_API_TOKEN || process.env.ADMIN_TOKEN || "";
  if (!required) return true;
  const supplied = req.headers["x-admin-token"] || req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (supplied === required) return true;
  res.status(401).json({ error: "Unauthorized." });
  return false;
}

function cleanId(value) {
  return String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function cleanNameFromUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "Imported Catalog";
  if (/aristokraft/i.test(value)) return "Aristokraft";
  if (/cabdoor/i.test(value)) return "CabDoor";
  if (/fabuwood/i.test(value)) return "Fabuwood";
  if (/kraftmaid/i.test(value)) return "KraftMaid";
  if (/kemper/i.test(value)) return "Kemper";
  if (/waypoint/i.test(value)) return "Waypoint";
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return host.split(".")[0].replace(/-/g, " ").replace(/\b\w/g, function(c) { return c.toUpperCase(); });
  } catch (_error) {
    return "Imported Catalog";
  }
}

function door(name, desc, image = "", imageCrop = null) {
  return { id: cleanId(name), label: name, value: `Aristokraft ${name} cabinet door style`, image, imageCrop, desc: desc || "Aristokraft cabinet door style" };
}

function finish(name, type, swatch = "", imageCrop = null) {
  return { id: cleanId(name), label: name, value: `Aristokraft ${name} ${type || "cabinet finish"}`, image: swatch, swatch, imageCrop, desc: type || "cabinet finish" };
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function assetUrl(sourceUrl, path) {
  try { return new URL(path, sourceUrl).href; } catch (_error) { return ""; }
}

async function imageExists(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok && String(response.headers.get("content-type") || "").startsWith("image/");
  } catch (_error) { return false; }
}

async function discoverFlipbookImages(sourceUrl) {
  const found = [];
  if (!sourceUrl) return found;
  try {
    const htmlResponse = await fetch(sourceUrl, { cache: "no-store" });
    const html = await htmlResponse.text().catch(function() { return ""; });
    const matches = html.match(/(?:src|href)=["']([^"']+\.(?:jpg|jpeg|png|webp))(?:\?[^"']*)?["']/gi) || [];
    matches.forEach(function(match) {
      const inner = match.match(/["']([^"']+)/)?.[1];
      if (inner) found.push(assetUrl(sourceUrl, inner));
    });
  } catch (_error) {}

  found.push(assetUrl(sourceUrl, "files/assets/cover/1.jpg"));
  const candidates = [];
  for (let i = 1; i <= 48; i += 1) {
    const padded = String(i).padStart(4, "0");
    candidates.push(assetUrl(sourceUrl, `files/assets/mobile/pages/page${padded}.jpg`));
    candidates.push(assetUrl(sourceUrl, `files/assets/common/page-html5-substrates/page${padded}_1.jpg`));
    candidates.push(assetUrl(sourceUrl, `files/assets/desktop/pages/page${padded}.jpg`));
  }
  const checks = await Promise.all(candidates.map(async function(url) { return (await imageExists(url)) ? url : ""; }));
  return unique([...found, ...checks]);
}

function safeJsonFromText(text) {
  const raw = String(text || "").trim();
  try { return JSON.parse(raw); } catch (_error) {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch (_error) { return null; }
}

function normalizeCrop(crop) {
  if (!crop || typeof crop !== "object") return null;
  const x = Number(crop.x), y = Number(crop.y), w = Number(crop.w), h = Number(crop.h);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)), w: Math.max(1, Math.min(100, w)), h: Math.max(1, Math.min(100, h)) };
}

async function aiDetectCatalogSnippets(imageUrls, doorNames, finishNames) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !imageUrls.length) return { doors: [], finishes: [], status: "no-openai-key" };

  const sampleImages = imageUrls.slice(0, 10);
  const prompt = `You are extracting cabinet catalog snippets. Return ONLY valid JSON. Find door style product photos and finish/color swatches on these catalog pages. Coordinates must be percentages of the full source image: x,y,w,h from 0 to 100. Use the closest matching names from these lists. Door names: ${doorNames.join(", ")}. Finish names: ${finishNames.join(", ")}. JSON format: {"doors":[{"name":"Benton","sourceImage":"exact image URL","crop":{"x":0,"y":0,"w":10,"h":10}}],"finishes":[{"name":"White","sourceImage":"exact image URL","crop":{"x":0,"y":0,"w":10,"h":10}}]}`;

  const content = [
    { type: "input_text", text: prompt },
    ...sampleImages.map(function(url) { return { type: "input_image", image_url: url }; })
  ];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.CATALOG_EXTRACT_MODEL || "gpt-4.1-mini", input: [{ role: "user", content }], max_output_tokens: 5000 })
  });

  const data = await response.json().catch(function() { return {}; });
  if (!response.ok) return { doors: [], finishes: [], status: "openai-error", error: data.error?.message || "OpenAI request failed" };

  const text = data.output_text || data.output?.flatMap(function(item) { return item.content || []; }).map(function(c) { return c.text || ""; }).join("\n") || "";
  const parsed = safeJsonFromText(text) || {};

  return {
    doors: Array.isArray(parsed.doors) ? parsed.doors : [],
    finishes: Array.isArray(parsed.finishes) ? parsed.finishes : [],
    status: "ai-detected"
  };
}

function applyDetectedCrops(items, detections) {
  detections.forEach(function(detection) {
    const nameId = cleanId(detection.name);
    const target = items.find(function(item) { return cleanId(item.label || item.name || item.id) === nameId || cleanId(item.label || item.name || item.id).includes(nameId) || nameId.includes(cleanId(item.label || item.name || item.id)); });
    const crop = normalizeCrop(detection.crop);
    if (!target || !crop || !detection.sourceImage) return;
    target.image = detection.sourceImage;
    target.swatch = target.swatch !== undefined ? detection.sourceImage : target.swatch;
    target.imageCrop = { src: detection.sourceImage, ...crop };
    target.thumbnail = detection.sourceImage;
  });
}

async function aristokraftCatalog(sourceUrl, version) {
  const catalogImages = await discoverFlipbookImages(sourceUrl);
  const coverImage = catalogImages[0] || "";

  const doorData = [
    ["Benton", "Shaker-style cabinet door"], ["Brellin", "Wide rail shaker-style cabinet door"], ["Briarcliff II", "Traditional raised-panel cabinet door"], ["Durham", "Classic recessed-panel cabinet door"], ["Ellis", "Simple shaker-style cabinet door"], ["Glyn", "Clean transitional cabinet door"], ["Lillian", "Decorative traditional cabinet door"], ["Maddox", "Modern flat/recessed cabinet door"], ["Quill", "Contemporary cabinet door"], ["Sinclair", "Popular shaker-style cabinet door"], ["Teagan", "Classic transitional cabinet door"], ["Winstead", "Traditional raised-panel cabinet door"]
  ];
  const doors = doorData.map(function(item) { return door(item[0], item[1], coverImage); });

  const paintedNames = ["PureStyle White", "White", "Frost", "Stone Gray", "Flagstone", "Burlap", "Sarsaparilla", "Colada", "Mythic Blue", "Sage"];
  const woodNames = ["Natural", "Cafe", "Umber", "Cocoa", "Autumn Brown", "Flagstone Stain"];
  const painted = paintedNames.map(function(name) { return finish(name, "painted cabinet finish", coverImage); });
  const wood = woodNames.map(function(name) { return finish(name, "wood stain cabinet finish", coverImage); });

  const ai = await aiDetectCatalogSnippets(catalogImages, doors.map(function(d) { return d.label; }), [...paintedNames, ...woodNames]);
  applyDetectedCrops(doors, ai.doors || []);
  applyDetectedCrops(painted, ai.finishes || []);
  applyDetectedCrops(wood, ai.finishes || []);

  const allFinishes = [...painted, ...wood];
  return {
    name: "Aristokraft",
    catalogId: "aristokraft",
    version,
    sourceType: "url",
    sourceUrl,
    notes: `Imported with ${doors.length} door styles, ${allFinishes.length} finishes, ${catalogImages.length} catalog image assets, and ${ai.doors?.length || 0} AI door crop detections / ${ai.finishes?.length || 0} finish crop detections.`,
    extraction: { sourceUrl, imageAssets: catalogImages, extractedAt: new Date().toISOString(), status: ai.status || "assets-discovered", ai },
    manufacturers: [{ id: "aristokraft", name: "Aristokraft", sourceUrl, lines: [
      { id: "door-selection-guide", name: "Door Selection Guide", description: "Door styles with painted and stained finish options.", doors, finishes: allFinishes, species: ["Birch", "Maple", "Oak", "Thermofoil", "PureStyle"] },
      { id: "painted-finishes", name: "Painted Finishes", description: "Painted cabinet finish options.", doors, finishes: painted, species: ["Paint", "PureStyle", "Thermofoil"] },
      { id: "wood-stain-finishes", name: "Wood Stain Finishes", description: "Wood stain cabinet finish options.", doors, finishes: wood, species: ["Birch", "Maple", "Oak"] }
    ] }]
  };
}

async function starterCatalogFromImport(body) {
  const name = String(body.name || cleanNameFromUrl(body.sourceUrl || body.catalogUrl || body.url)).trim();
  const version = String(body.version || new Date().toISOString().slice(0, 10)).trim();
  const sourceUrl = String(body.sourceUrl || body.catalogUrl || body.url || "").trim();

  if (/aristokraft/i.test(name) || /aristokraft/i.test(sourceUrl)) return aristokraftCatalog(sourceUrl, version);

  return { name, version, sourceType: sourceUrl ? "url" : "manual", sourceUrl, notes: "Imported catalog shell. Extraction workflow will fill lines, doors, finishes, and species.", manufacturers: [{ id: cleanId(name), name, sourceUrl, lines: [{ id: "import-pending", name: "Import Pending", description: "Catalog has been saved. Run extraction to populate real product lines.", doors: [], finishes: [], species: [] }] }] };
}

export default async function handler(req, res) {
  if (setCorsHeaders(req, res, "POST, OPTIONS")) return;
  setNoStore(res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!requireAdmin(req, res)) return;
  try {
    const catalogShell = await starterCatalogFromImport(req.body || {});
    const catalog = await saveCatalog(catalogShell);
    return res.status(200).json({ catalog, message: catalog.extraction?.status === "ai-detected" ? "Catalog imported with AI crop detection." : "Catalog saved to library." });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Catalog import failed." });
  }
}
