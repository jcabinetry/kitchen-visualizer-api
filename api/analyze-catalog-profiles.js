import { setCorsHeaders } from "./_lib/cors.js";

export const config = { api: { bodyParser: { sizeLimit: "20mb" } } };

const ANALYSIS_VERSION = "profile-v2-fixed-frame-scale";

function admin(req, res) {
  const expected = process.env.ADMIN_API_TOKEN || process.env.ADMIN_TOKEN || "";
  if (!expected) return true;
  const supplied = req.headers["x-admin-token"] || String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (supplied === expected) return true;
  res.status(401).json({ error: "Unauthorized." });
  return false;
}

function validImage(value) {
  return typeof value === "string" && /^data:image\/(png|jpe?g|webp);base64,/i.test(value);
}

function parseJson(value) {
  const text = String(value || "").trim();
  try { return JSON.parse(text); } catch (_error) {}
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("The AI profile helper did not return valid JSON.");
  return JSON.parse(match[0]);
}

function cleanProfile(profile, includeFrameWidth = false) {
  const cleaned = { description: String(profile?.description || "").trim(), mustAvoid: String(profile?.mustAvoid || "").trim() };
  if (includeFrameWidth) {
    const width = Number(profile?.frameWidthInches || 0);
    cleaned.frameWidthInches = Number.isFinite(width) && width > 0 ? Math.round(width * 20) / 20 : 0;
    cleaned.frameMeasurementExplanation = String(profile?.frameMeasurementExplanation || "").trim();
  }
  return cleaned;
}

function responseText(result) {
  if (result?.output_text) return result.output_text;
  return (result?.output || []).flatMap(function(item) { return item?.content || []; }).map(function(item) { return item?.text || ""; }).join("\n");
}

export default async function handler(req, res) {
  if (setCorsHeaders(req, res, "POST, OPTIONS")) return;
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!admin(req, res)) return;
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY." });
    const body = req.body || {};
    const images = [body.doorSource, body.doorMaster, body.drawerSource, body.drawerMaster];
    if (!images.every(validImage)) return res.status(400).json({ error: "Both original and approved AI images are required for the door and drawer front." });
    const prompt = `You are a cabinet-face geometry analyst. Describe two reusable visual specifications from four labeled images. The approved AI masters are authoritative; the original uploads only clarify details. Do not identify color, wood species, finish, brand, or hardware.

Image order: 1 original CABINET DOOR source; 2 approved AI CABINET DOOR master; 3 original DRAWER-FRONT source; 4 approved AI DRAWER-FRONT master.
Administrator classifications: door=${String(body.doorConstructionType || "unspecified")}; drawer=${String(body.drawerConstructionType || "unspecified")}.
Catalog door scale: master width=${Number(body.doorMasterWidthInches || 18)} inches. An existing administrator value of ${Number(body.doorFrameWidthInches || 0)} inches may be present, but independently calculate a new suggestion from the approved master. Keep bevels and panel transitions separate from the flat width.

For each face, describe only reproducible geometry: outer contour, number of pieces, rail/stile proportions, center-panel shape and depth direction, inner and outer profile sequence, bevels, steps, reveals, molding, edge treatment, corners, and important proportions. Explicitly distinguish raised, recessed/inset, and slab depth. Write a separate must-avoid statement listing generic substitutions and details that would change this exact style. Never copy door geometry into the drawer front or vice versa.

For the cabinet door only, calculate the flat rail and stile face width from the approved AI door master. The full visible door width represents exactly ${Number(body.doorMasterWidthInches || 18)} inches. Measure the flat face band from the actual outside door boundary to the point where the flat rail or stile face ends and the decorative bevel, molding, recessed transition, or raised transition begins. Exclude the outer edge treatment and exclude the inner bevel or panel transition from the flat width. Rails and stiles are the same physical width for this style. Do not measure all the way to the center panel opening. Return the calculated physical width in inches and a short visual explanation.

Return JSON only: {"door":{"description":"...","mustAvoid":"...","frameWidthInches":0,"frameMeasurementExplanation":"..."},"drawer":{"description":"...","mustAvoid":"..."}}`;
    const content = [{ type: "input_text", text: prompt }];
    images.forEach(function(image) { content.push({ type: "input_image", image_url: image, detail: "high" }); });
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: process.env.CATALOG_PROFILE_MODEL || "gpt-4.1-mini", input: [{ role: "user", content }], max_output_tokens: 1800 })
    });
    const result = await response.json().catch(function() { return {}; });
    if (!response.ok) return res.status(response.status).json({ error: result?.error?.message || "AI profile analysis failed." });
    const parsed = parseJson(responseText(result));
    const door = cleanProfile(parsed.door, true);
    const drawer = cleanProfile(parsed.drawer);
    if (!door.description || !drawer.description || !door.mustAvoid || !drawer.mustAvoid) return res.status(502).json({ error: "The AI profile helper returned incomplete details. Please regenerate." });
    return res.status(200).json({ door, drawer, analysisVersion: ANALYSIS_VERSION, analyzedAt: new Date().toISOString() });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "AI profile analysis failed." });
  }
}
