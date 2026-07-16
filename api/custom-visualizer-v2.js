import { getCatalog } from "./_lib/catalogStore.js";
import { cleanCompanyKey, getCustomer, usageKey } from "./_lib/customerStore.js";
import { getRedis } from "./_lib/redisClient.js";
import { setCorsHeaders } from "./_lib/cors.js";
import { buildMasterPrompt, buildValidationPrompt, CUSTOM_VISUALIZER_V2_PROMPT_VERSION, normalizeValidation, resolveCatalogSelection } from "./_lib/customVisualizerV2.js";

export const config = { api: { bodyParser: { sizeLimit: "25mb" } } };

const MAX_ASSET_BYTES = 20 * 1024 * 1024;

function parseDataImage(value) {
  const match = String(value || "").match(/^data:(image\/(?:png|jpe?g|webp));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  return { mime: match[1].toLowerCase().replace("jpg", "jpeg"), buffer: Buffer.from(match[2].replace(/\s/g, ""), "base64") };
}

function extension(mime) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

function safeRemoteUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Catalog reference assets must use HTTPS.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error("Catalog reference asset host is not allowed.");
  return url;
}

async function authoritativeImage(value, role, allowRemote = true) {
  let parsed = parseDataImage(value);
  if (!parsed) {
    if (!allowRemote) throw new Error(`${role} must be an uploaded PNG, JPEG, or WebP image.`);
    const url = safeRemoteUrl(value);
    const response = await fetch(url, { redirect: "follow" });
    safeRemoteUrl(response.url);
    if (!response.ok) throw new Error(`${role} could not be retrieved from the catalog.`);
    const mime = String(response.headers.get("content-type") || "").split(";")[0].toLowerCase();
    if (!/^image\/(png|jpe?g|webp)$/.test(mime)) throw new Error(`${role} is not a supported image.`);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_ASSET_BYTES) throw new Error(`${role} is too large.`);
    const buffer = Buffer.from(await response.arrayBuffer());
    parsed = { mime: mime.replace("image/jpg", "image/jpeg"), buffer };
  }
  if (!parsed.buffer.length || parsed.buffer.length > MAX_ASSET_BYTES) throw new Error(`${role} is empty or too large.`);
  return parsed;
}

function appendImage(form, image, name) {
  form.append("image[]", new File([image.buffer], `${name}.${extension(image.mime)}`, { type: image.mime }));
}

async function generateImage(images, prompt) {
  const form = new FormData();
  form.append("model", process.env.CUSTOM_VISUALIZER_IMAGE_MODEL || "gpt-image-2");
  form.append("prompt", prompt);
  form.append("size", process.env.CUSTOM_VISUALIZER_IMAGE_SIZE || "1536x1024");
  form.append("quality", process.env.CUSTOM_VISUALIZER_IMAGE_QUALITY || "high");
  appendImage(form, images.kitchen, "01-original-kitchen");
  appendImage(form, images.door, "02-authoritative-door-geometry");
  appendImage(form, images.drawer, "03-authoritative-drawer-geometry");
  appendImage(form, images.finish, "04-authoritative-finish-color");

  const response = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
  const result = await response.json().catch(function() { return {}; });
  if (!response.ok) throw new Error(result?.error?.message || "OpenAI image edit failed.");
  const base64 = result?.data?.[0]?.b64_json;
  if (!base64) throw new Error("OpenAI did not return an image.");
  return `data:image/png;base64,${base64}`;
}

function responseText(result) {
  if (result?.output_text) return result.output_text;
  return (result?.output || []).flatMap(function(item) { return item?.content || []; }).map(function(item) { return item?.text || ""; }).join("\n");
}

function parseJson(text) {
  try { return JSON.parse(String(text || "").trim()); } catch (_error) {}
  const match = String(text || "").match(/\{[\s\S]*\}/);
  if (!match) throw new Error("The validation model did not return valid JSON.");
  return JSON.parse(match[0]);
}

async function validateImage(images, generatedImage, resolved) {
  const ordered = [images.kitchen, images.door, images.drawer, images.finish].map(function(image) { return `data:${image.mime};base64,${image.buffer.toString("base64")}`; });
  ordered.push(generatedImage);
  const content = [{ type: "input_text", text: buildValidationPrompt(resolved) }];
  ordered.forEach(function(image) { content.push({ type: "input_image", image_url: image, detail: "high" }); });
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: process.env.CUSTOM_VISUALIZER_VALIDATION_MODEL || "gpt-4.1-mini", input: [{ role: "user", content }], max_output_tokens: 900 })
  });
  const result = await response.json().catch(function() { return {}; });
  if (!response.ok) throw new Error(result?.error?.message || "Generated-image validation failed.");
  return normalizeValidation(parseJson(responseText(result)));
}

export default async function handler(req, res) {
  if (setCorsHeaders(req, res, "POST, OPTIONS")) return;
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY." });
    const body = req.body || {};
    const companyKey = cleanCompanyKey(body.companyKey);
    if (!companyKey) return res.status(400).json({ error: "Company key missing." });
    const kitchen = await authoritativeImage(body.image, "Kitchen image", false);
    const customer = await getCustomer(companyKey);
    if (!customer) return res.status(404).json({ error: "Company not found." });
    if (customer.status === "archived") return res.status(403).json({ error: "This visualizer is not active." });

    const catalogId = String(body.selection?.catalogId || "").trim();
    const catalog = await getCatalog(catalogId);
    const resolved = resolveCatalogSelection({ customer, catalog, selection: body.selection || {} });
    const redis = getRedis();
    const key = usageKey(companyKey);
    const used = Number((await redis.get(key)) || 0);
    const limit = Math.max(1, Number(customer.monthlyLimit) || 200);
    if (used >= limit) return res.status(403).json({ error: "This account has reached its monthly preview limit.", used, limit });

    const images = {
      kitchen,
      door: await authoritativeImage(resolved.doorReference, "Approved door reference"),
      drawer: await authoritativeImage(resolved.drawerReference, "Approved drawer-front reference"),
      finish: await authoritativeImage(resolved.finishReference, "Authoritative finish swatch")
    };

    let generatedImage = "";
    let validation = null;
    let attempts = 0;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      attempts += 1;
      const feedback = attempt === 0 ? [] : (validation?.violations?.length ? validation.violations : ["The previous result did not meet the required layout, geometry, or finish scores."]);
      generatedImage = await generateImage(images, buildMasterPrompt(resolved, feedback));
      validation = await validateImage(images, generatedImage, resolved);
      if (validation.pass) break;
    }

    if (!validation?.pass) return res.status(422).json({ error: "The generated preview did not preserve the selected door geometry or room closely enough. No usage was charged.", validation, attempts, promptVersion: CUSTOM_VISUALIZER_V2_PROMPT_VERSION });
    const updatedUsed = Number(await redis.incr(key));
    return res.status(200).json({ image: generatedImage, used: updatedUsed, limit, validation, attempts, promptVersion: CUSTOM_VISUALIZER_V2_PROMPT_VERSION, selection: { catalogId: resolved.catalogId, manufacturerId: resolved.manufacturerId, lineId: resolved.lineId, doorId: resolved.doorId, finishId: resolved.finishId, doorName: resolved.doorName, finishName: resolved.finishName } });
  } catch (error) {
    const message = error?.message || "Custom visualization failed.";
    const status = /select|assigned|available|missing|complete|analy|not active|verified|supported image|too large/i.test(message) ? 400 : 500;
    return res.status(status).json({ error: message });
  }
}
