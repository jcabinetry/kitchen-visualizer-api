export const config = {
  api: {
    bodyParser: {
      sizeLimit: "35mb"
    }
  }
};

const DEFAULT_MONTHLY_LIMIT = 200;
const ALERT_EMAIL_FORM = "https://formspree.io/f/xaqzgvyk";

function cleanEnvValue(value) {
  return String(value || "").trim().replace(/^['\"]|['\"]$/g, "");
}

function firstMatching(values, predicate) {
  return values.map(cleanEnvValue).find(function(value) {
    return value && predicate(value);
  });
}

function getRedisConfig() {
  const candidates = [process.env.UPSTASH_REDIS_REST_URL, process.env.KV_REST_API_URL, process.env.UPSTASH_REDIS_REST_TOKEN, process.env.KV_REST_API_TOKEN];
  const url = firstMatching(candidates, value => value.startsWith("https://"));
  const token = firstMatching(candidates, value => !value.startsWith("https://") && !value.startsWith("rediss://"));
  if (!url || !token) throw new Error("Missing valid Upstash Redis REST credentials. Set an https:// REST URL and REST token in Vercel.");
  return { url, token };
}

function stripDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const parts = dataUrl.split(",");
  return parts.length > 1 ? parts[1] : null;
}

function getMimeType(dataUrl, fallback = "image/jpeg") {
  if (!dataUrl || typeof dataUrl !== "string") return fallback;
  const match = dataUrl.match(/^data:(.*?);base64,/);
  return match ? match[1] : fallback;
}

function getExt(mime) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

function getMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

function cleanKey(value) {
  return String(value || "default-company").toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").slice(0, 80);
}

async function redisGet(key) {
  const redis = getRedisConfig();
  const response = await fetch(`${redis.url}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${redis.token}` } });
  const data = await response.json();
  return data.result;
}

async function redisSet(key, value) {
  const redis = getRedisConfig();
  await fetch(`${redis.url}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, { method: "POST", headers: { Authorization: `Bearer ${redis.token}` } });
}

async function redisIncr(key) {
  const redis = getRedisConfig();
  const response = await fetch(`${redis.url}/incr/${encodeURIComponent(key)}`, { method: "POST", headers: { Authorization: `Bearer ${redis.token}` } });
  const data = await response.json();
  return Number(data.result || 0);
}

async function sendLimitEmail({ companyKey, companyName, used, limit, customerName, customerEmail, customerPhone }) {
  const alertSentKey = `visualizer:${companyKey}:${getMonthKey()}:limitEmailSent`;
  if ((await redisGet(alertSentKey)) === "yes") return;
  await fetch(ALERT_EMAIL_FORM, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ subject: "Visualizer monthly limit reached", company: companyName, companyKey, used, limit, customerName: customerName || "-", customerEmail: customerEmail || "-", customerPhone: customerPhone || "-", message: `${companyName} has reached the monthly visualizer limit of ${limit} previews.` })
  });
  await redisSet(alertSentKey, "yes");
}

function buildFallbackPrompt(body, hasMainReference, hasBaseReference) {
  const upperColorText = hasMainReference ? "the uploaded upper cabinet finish reference image" : body.color || "white painted cabinets";
  const baseColorText = hasBaseReference ? "the uploaded base/lower cabinet finish reference image" : body.island || "the same finish as the upper cabinets";
  return `
Edit this exact kitchen photo into a cabinet refacing preview.
Preserve the exact existing cabinet layout, camera angle, room, appliance openings, door count, drawer count, and cabinet geometry.
Apply this upper/wall cabinet finish to every upper cabinet surface: ${upperColorText}.
Apply this base/lower cabinet finish to every lower cabinet surface below the countertops: ${baseColorText}.
Use this selected door style as the required visual/profile reference without changing the original cabinet layout: ${body.style || "existing cabinet door style"}.
Use this hardware style: ${body.hardware || "keep hardware close to original placement"}.
${body.countertop ? `Change only countertops to ${body.countertop}.` : "Keep countertops unchanged."}
${body.backsplash ? `Change only backsplash to ${body.backsplash}.` : "Keep backsplash unchanged."}
${body.flooring ? `Change only flooring to ${body.flooring}.` : "Keep flooring unchanged."}
Do not generate generic white shaker unless white shaker is the selected catalog choice.
Final output must look like the same kitchen with the selected catalog door style and selected catalog finish applied.
`.trim();
}

function hardenPrompt(prompt) {
  return `
${String(prompt || "").trim()}

CATALOG SELECTION IS A HARD REQUIREMENT:
Use the exact selected catalog door style and selected finish/color. Do not substitute generic white shaker, generic shaker, or any default cabinet style/color unless that is exactly what the user selected.
If reference images are attached, use them as visual reference images:
- door reference image = cabinet door profile/style reference
- upper/base swatch reference images = cabinet finish/color references
The kitchen layout must stay the same, but the visible cabinet finish and door face/profile should follow the selected catalog references as closely as possible.
Base/lower cabinet finish means every lower cabinet, including any island cabinets. It is not island-only.
`.trim();
}

function appendImage(form, dataUrl, fallbackName) {
  const base64 = stripDataUrl(dataUrl);
  if (!base64) return false;
  const mime = getMimeType(dataUrl, "image/jpeg");
  form.append("image[]", new File([Buffer.from(base64, "base64")], `${fallbackName}.${getExt(mime)}`, { type: mime }));
  return true;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body || {};
    getRedisConfig();
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY." });
    if (!body.image) return res.status(400).json({ error: "Missing kitchen image." });
    if (!stripDataUrl(body.image)) return res.status(400).json({ error: "Invalid kitchen image." });

    const safeCompanyKey = cleanKey(body.companyKey);
    const safeCompanyName = body.companyName || safeCompanyKey;
    const safeMonthlyLimit = Math.max(1, parseInt(body.monthlyLimit ?? DEFAULT_MONTHLY_LIMIT, 10) || DEFAULT_MONTHLY_LIMIT);
    const customerRecord = (await redisGet(`visualizer:customer:${safeCompanyKey}`)) || (await redisGet(`customer:${safeCompanyKey}`));
    if (customerRecord) {
      try {
        const customer = JSON.parse(customerRecord);
        if (customer.status === "archived") return res.status(403).json({ error: "This account has been deactivated. Please contact your administrator." });
      } catch (_error) {}
    }

    const usageKey = `visualizer:${safeCompanyKey}:${getMonthKey()}:used`;
    const usedNow = Number((await redisGet(usageKey)) || 0);
    if (usedNow >= safeMonthlyLimit) {
      sendLimitEmail({ companyKey: safeCompanyKey, companyName: safeCompanyName, used: usedNow, limit: safeMonthlyLimit, customerName: body.customerName, customerEmail: body.customerEmail, customerPhone: body.customerPhone }).catch(function() {});
      return res.status(403).json({ error: "This account has reached its monthly preview limit. Please contact support to continue using the visualizer.", used: usedNow, limit: safeMonthlyLimit });
    }

    const mainReference = body.mainCustomReference || body.mainCustomColorImage || body.mainCustomColorData || null;
    const baseReference = body.islandCustomReference || body.islandCustomColorImage || body.islandCustomColorData || null;
    const extraReferences = Array.isArray(body.referenceImages) ? body.referenceImages.filter(Boolean) : [];
    const selectedPrompt = body.prompt ? hardenPrompt(body.prompt) : hardenPrompt(buildFallbackPrompt(body, !!mainReference, !!baseReference));

    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("prompt", selectedPrompt);
    form.append("size", "1536x1024");
    appendImage(form, body.image, "kitchen");
    if (mainReference) appendImage(form, mainReference, "upper-finish-reference");
    if (baseReference && baseReference !== mainReference) appendImage(form, baseReference, "base-finish-reference");
    extraReferences.slice(0, 6).forEach(function(ref, index) {
      if (ref && ref !== mainReference && ref !== baseReference) appendImage(form, ref, `catalog-reference-${index + 1}`);
    });

    const openaiResponse = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
    const result = await openaiResponse.json();
    if (!openaiResponse.ok) return res.status(openaiResponse.status).json({ error: result?.error?.message || result?.message || "OpenAI image edit failed." });

    const updatedUsed = await redisIncr(usageKey);
    if (updatedUsed >= safeMonthlyLimit) await sendLimitEmail({ companyKey: safeCompanyKey, companyName: safeCompanyName, used: updatedUsed, limit: safeMonthlyLimit, customerName: body.customerName, customerEmail: body.customerEmail, customerPhone: body.customerPhone });

    const imageBase64 = result?.data?.[0]?.b64_json;
    const imageUrl = result?.data?.[0]?.url;
    if (imageBase64) return res.status(200).json({ image: `data:image/png;base64,${imageBase64}`, used: updatedUsed, limit: safeMonthlyLimit });
    if (imageUrl) return res.status(200).json({ image: imageUrl, used: updatedUsed, limit: safeMonthlyLimit });
    return res.status(500).json({ error: "No image returned from OpenAI." });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Server error." });
  }
}
