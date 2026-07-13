export const config = {
  api: {
    bodyParser: {
      sizeLimit: "35mb"
    }
  }
};

import {
  saveGenerationRecord,
  updateGenerationRecord
} from "./_lib/generationInspectorStore.js";

const DEFAULT_MONTHLY_LIMIT = 200;
const ALERT_EMAIL_FORM = "https://formspree.io/f/xaqzgvyk";
const CATALOG_PROMPT_VERSION = String(process.env.CATALOG_PROMPT_VERSION || "v2").trim().toLowerCase() === "legacy"
  ? "legacy"
  : "v2";

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

function createGenerationId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `gen-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function dataUrlBytes(dataUrl) {
  const base64 = stripDataUrl(dataUrl);
  return base64 ? Buffer.byteLength(base64, "base64") : 0;
}

function describeImage(role, dataUrl, fileName, order) {
  return {
    order,
    role,
    fileName,
    mime: getMimeType(dataUrl, "image/jpeg"),
    bytes: dataUrlBytes(dataUrl),
    dataUrl
  };
}

function imageSizeLabel(image) {
  if (!image) return "";
  if (String(image).startsWith("data:")) {
    return `${getMimeType(image, "image/png")} / ${dataUrlBytes(image)} bytes`;
  }
  return "remote image URL";
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

function parseMaterial(prompt, heading, pattern) {
  const text = String(prompt || "");
  if (!text.includes(heading)) return "";
  const match = text.match(pattern);
  return match ? String(match[1] || "").trim() : "";
}

function selectedDetails(body) {
  const prompt = body.prompt || "";
  const countertopFromPrompt = parseMaterial(prompt, "COUNTERTOP INSTRUCTION", /COUNTERTOP INSTRUCTION:\s*Replace only the visible countertop surfaces with\s+(.+?)\.\s+Preserve/is);
  const backsplashFromPrompt = parseMaterial(prompt, "BACKSPLASH INSTRUCTION", /BACKSPLASH INSTRUCTION:\s*Replace only the visible backsplash area with\s+(.+?)\.\s+Preserve/is);
  const flooringFromPrompt = parseMaterial(prompt, "FLOORING INSTRUCTION", /FLOORING INSTRUCTION:\s*Replace only the visible flooring with\s+(.+?)\.\s+Preserve/is);
  return {
    doorName: body.catalogDoorName || body.style || "selected catalog door reference",
    upperName: body.upperSwatchName || body.color || "selected upper/wall swatch",
    baseName: body.baseSwatchName || body.island || body.upperSwatchName || body.color || "selected base/lower swatch",
    upperHex: body.upperSwatchHex || "",
    baseHex: body.baseSwatchHex || body.upperSwatchHex || "",
    countertop: body.countertop || countertopFromPrompt,
    backsplash: body.backsplash || backsplashFromPrompt,
    flooring: body.flooring || flooringFromPrompt
  };
}

function buildLegacyCatalogPrompt(body, hasMainReference, hasBaseReference, hasDoorReference) {
  const details = selectedDetails(body);
  const upperColorText = hasMainReference ? `the attached upper/wall cabinet finish swatch (${details.upperName}${details.upperHex ? `, ${details.upperHex}` : ""})` : details.upperName;
  const baseColorText = hasBaseReference ? `the attached base/lower cabinet finish swatch (${details.baseName}${details.baseHex ? `, ${details.baseHex}` : ""})` : details.baseName;
  const doorText = hasDoorReference ? "the attached cabinet door reference image" : details.doorName;
  const surfaceInstructions = [
    details.countertop
      ? `Countertops: replace only the visible countertop surfaces with ${details.countertop}. Keep the same countertop shape, edge, thickness, overhang, sink cutout, appliance openings, and layout.`
      : "Countertops: keep the existing countertops unchanged.",
    details.backsplash
      ? `Backsplash: replace only the visible backsplash area with ${details.backsplash}. Keep outlets, windows, trim, cabinets, countertops, and wall layout unchanged.`
      : "Backsplash: keep the existing backsplash unchanged.",
    details.flooring
      ? `Flooring: replace only the visible flooring with ${details.flooring}. Keep the same floor perspective, scale, shadows, cabinets, appliances, furniture, rugs, and room layout.`
      : "Flooring: keep the existing flooring unchanged."
  ].join("\n");
  return `
Replace all existing cabinet doors and drawer fronts in the kitchen with the exact door style shown in ${doorText}.
Match the profile, frame width, inside bevels, center panel, proportions, edge detail, and craftsmanship exactly.
Do not simplify the profile or substitute another cabinet style.
Preserve every detail of the reference door design.

Keep the cabinet boxes, cabinet layout, cabinet count, drawer count, appliance locations, walls, windows, trim, lighting, hardware placement, island, decorations, camera angle, perspective, and room dimensions exactly as they are.
Do not redesign, modernize, or move anything.

Fit the new door style naturally to each existing cabinet size, including double doors, narrow doors, tall pantry doors, island doors, end panels, exposed sides, and drawer fronts, while maintaining the same proportions as the reference image.

Apply ${upperColorText} uniformly to all upper cabinet doors, drawer fronts, visible face frames, side panels, end panels, fillers, toe kicks, and cabinet trim above countertop height.
Apply ${baseColorText} uniformly to all base/lower cabinet doors, drawer fronts, visible face frames, side panels, end panels, fillers, toe kicks, island panels, peninsula panels, and cabinet trim below countertop height.
If the upper and base finishes are the same, every cabinet in the kitchen should receive that same finish.

This is a cabinet refacing visualization, not a kitchen remodel.
The cabinet changes should be only the door style and finish.
Everything else must remain identical to the original photograph unless listed below.

Optional selected surface changes, applied after the cabinet refacing is correct:
${surfaceInstructions}

Produce a photorealistic image with accurate lighting, perspective, and textures.
`.trim();
}

function buildCatalogPromptV2(body, hasMainReference, hasBaseReference, hasDoorReference) {
  const details = selectedDetails(body);
  const upperFinish = hasMainReference
    ? `the attached upper cabinet finish swatch (${details.upperName}${details.upperHex ? `, ${details.upperHex}` : ""})`
    : details.upperName;
  const baseFinish = hasBaseReference
    ? `the attached base cabinet finish swatch (${details.baseName}${details.baseHex ? `, ${details.baseHex}` : ""})`
    : details.baseName;
  const doorReference = hasDoorReference
    ? `the attached cabinet door reference image (${details.doorName})`
    : details.doorName;
  const selectedSurfaceChanges = [
    details.countertop ? `Replace the countertops with ${details.countertop}.` : "Keep the existing countertops unchanged.",
    details.backsplash ? `Replace the backsplash with ${details.backsplash}.` : "Keep the existing backsplash unchanged.",
    details.flooring ? `Replace the flooring with ${details.flooring}.` : "Keep the existing flooring unchanged."
  ].join("\n");

  return `
Use the uploaded kitchen photo as the base image and create a photorealistic cabinet refacing preview, not a redesign.

Replace every existing cabinet door and drawer front with the exact door style shown in ${doorReference}. Match its profile, frame width, rail and stile proportions, inside bevels, center panel, edge detail, and craftsmanship exactly. Fit that same door style naturally to every existing cabinet size, including double doors, narrow doors, tall pantry doors, island doors, and drawer fronts.

Do not simplify the reference door, substitute a shaker style, mix door styles, or invent arches, cathedral tops, panels, grooves, bevels, trim, or decorative details that are not visible in the reference image. The supplied door image is the required result, not inspiration.

Apply ${upperFinish} exactly and uniformly to every visible upper cabinet door, drawer front, face frame, exposed side, end panel, filler, and cabinet trim above countertop height.
Apply ${baseFinish} exactly and uniformly to every visible base cabinet door, drawer front, face frame, exposed side, end panel, filler, toe kick, island surface, peninsula surface, and cabinet trim below countertop height. Do not leave any corresponding cabinet surface in its original color. If the upper and base finishes are the same, apply that one finish uniformly to every cabinet surface in the kitchen.

Keep the cabinet boxes, cabinet layout, cabinet count, drawer count, appliance locations, hardware placement, island, walls, windows, trim, lighting, decorations, camera angle, perspective, and room dimensions exactly as they are. Do not redesign, modernize, resize, move, add, or remove anything.

Selected surface changes:
${selectedSurfaceChanges}
Preserve the original shape, position, openings, scale, perspective, and surrounding objects for each changed surface. Apart from the explicitly selected changes above, everything else must remain identical to the original photograph.

The finished image must look like the same kitchen photographed after professional cabinet refacing. The cabinet doors must match the supplied door reference exactly, the cabinet finishes must match the supplied swatches exactly, and the lighting, perspective, and textures must remain photorealistic.
`.trim();
}

function buildCatalogPrompt(body, hasMainReference, hasBaseReference, hasDoorReference) {
  if (CATALOG_PROMPT_VERSION === "legacy") {
    return buildLegacyCatalogPrompt(body, hasMainReference, hasBaseReference, hasDoorReference);
  }
  return buildCatalogPromptV2(body, hasMainReference, hasBaseReference, hasDoorReference);
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

    const mainReference = body.mainCustomReference || body.mainCustomColorImage || body.mainCustomColorData || body.catalogSwatchReference || null;
    const baseReference = body.islandCustomReference || body.islandCustomColorImage || body.islandCustomColorData || body.catalogBaseSwatchReference || mainReference;
    const doorReference = body.catalogDoorReference || null;
    const countertopReference = body.countertopCustomReference || null;
    const backsplashReference = body.backsplashCustomReference || null;
    const flooringReference = body.flooringCustomReference || null;
    const extraReferences = Array.isArray(body.referenceImages) ? body.referenceImages.filter(Boolean) : [];

    if (!doorReference) {
      return res.status(400).json({ error: "Catalog door image was not sent. Select a catalog door again and generate after the page finishes loading." });
    }
    if (!mainReference) {
      return res.status(400).json({ error: "Catalog color swatch image was not sent. Select a catalog color swatch again and generate after the page finishes loading." });
    }

    const selectedPrompt = buildCatalogPrompt(body, !!mainReference, !!baseReference, !!doorReference);

    const form = new FormData();
    const generationId = createGenerationId();
    const generationStartedAt = Date.now();
    const attachedImages = [];
    function observeImage(role, dataUrl, fallbackName) {
      if (stripDataUrl(dataUrl)) {
        attachedImages.push(describeImage(role, dataUrl, `${fallbackName}.${getExt(getMimeType(dataUrl, "image/jpeg"))}`, attachedImages.length + 1));
      }
    }
    form.append("model", "gpt-image-1");
    form.append("prompt", selectedPrompt);
    form.append("size", "1536x1024");
    appendImage(form, body.image, "kitchen");
    observeImage("Kitchen photo", body.image, "kitchen");
    appendImage(form, doorReference, "selected-catalog-door-exact-reference");
    observeImage("Catalog door exact reference", doorReference, "selected-catalog-door-exact-reference");
    appendImage(form, mainReference, "selected-upper-swatch-reference");
    observeImage("Upper swatch", mainReference, "selected-upper-swatch-reference");
    if (baseReference && baseReference !== mainReference) appendImage(form, baseReference, "selected-base-swatch-reference");
    if (baseReference && baseReference !== mainReference) observeImage("Base swatch", baseReference, "selected-base-swatch-reference");
    if (countertopReference) appendImage(form, countertopReference, "selected-countertop-reference");
    if (countertopReference) observeImage("Countertop", countertopReference, "selected-countertop-reference");
    if (backsplashReference) appendImage(form, backsplashReference, "selected-backsplash-reference");
    if (backsplashReference) observeImage("Backsplash", backsplashReference, "selected-backsplash-reference");
    if (flooringReference) appendImage(form, flooringReference, "selected-flooring-reference");
    if (flooringReference) observeImage("Flooring", flooringReference, "selected-flooring-reference");
    extraReferences.slice(0, 6).forEach(function(ref, index) {
      if (ref && ref !== mainReference && ref !== baseReference && ref !== doorReference && ref !== countertopReference && ref !== backsplashReference && ref !== flooringReference) appendImage(form, ref, `catalog-reference-${index + 1}`);
      if (ref && ref !== mainReference && ref !== baseReference && ref !== doorReference && ref !== countertopReference && ref !== backsplashReference && ref !== flooringReference) observeImage(`Additional reference ${index + 1}`, ref, `catalog-reference-${index + 1}`);
    });

    const inspectorPayload = {
      model: "gpt-image-1",
      size: "1536x1024",
      prompt: selectedPrompt,
      attachments: attachedImages.map(function(image) {
        return {
          order: image.order,
          role: image.role,
          fileName: image.fileName,
          mime: image.mime,
          bytes: image.bytes,
          dataUrl: image.dataUrl
        };
      })
    };
    await saveGenerationRecord({
      generationId,
      timestamp: new Date(generationStartedAt).toISOString(),
      status: "sent",
      summary: {
        companyKey: safeCompanyKey,
        manufacturer: body.manufacturer || body.selectedCatalog || "",
        cabinetLine: body.cabinetLine || "",
        doorStyle: body.catalogDoorName || body.selectedDoorStyle || body.style || "",
        upperFinish: body.upperSwatchName || body.selectedFinishColor || body.color || "",
        baseFinish: body.baseSwatchName || body.selectedBaseFinishColor || body.island || body.upperSwatchName || "",
        countertop: body.countertop || "",
        backsplash: body.backsplash || "",
        flooring: body.flooring || ""
      },
      prompt: selectedPrompt,
      payload: inspectorPayload,
      referenceImages: attachedImages,
      warnings: attachedImages.length ? [] : ["No image attachments were recorded before OpenAI request."]
    }).catch(function(error) {
      console.warn("Generation inspector logging skipped.", error?.message || error);
    });

    const openaiResponse = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
    const result = await openaiResponse.json();
    if (!openaiResponse.ok) {
      await updateGenerationRecord(generationId, {
        status: "error",
        result: {
          generationTimeMs: Date.now() - generationStartedAt,
          image: "",
          imageSize: ""
        },
        error: {
          status: openaiResponse.status,
          message: result?.error?.message || result?.message || "OpenAI image edit failed."
        }
      }).catch(function(error) {
        console.warn("Generation inspector error logging skipped.", error?.message || error);
      });
      return res.status(openaiResponse.status).json({ error: result?.error?.message || result?.message || "OpenAI image edit failed." });
    }

    const updatedUsed = await redisIncr(usageKey);
    if (updatedUsed >= safeMonthlyLimit) await sendLimitEmail({ companyKey: safeCompanyKey, companyName: safeCompanyName, used: updatedUsed, limit: safeMonthlyLimit, customerName: body.customerName, customerEmail: body.customerEmail, customerPhone: body.customerPhone });

    const imageBase64 = result?.data?.[0]?.b64_json;
    const imageUrl = result?.data?.[0]?.url;
    const generatedImage = imageBase64 ? `data:image/png;base64,${imageBase64}` : imageUrl || "";
    if (generatedImage) {
      await updateGenerationRecord(generationId, {
        status: "complete",
        result: {
          generationTimeMs: Date.now() - generationStartedAt,
          image: generatedImage,
          imageSize: imageSizeLabel(generatedImage)
        }
      }).catch(function(error) {
        console.warn("Generation inspector result logging skipped.", error?.message || error);
      });
    }
    if (imageBase64) return res.status(200).json({ image: `data:image/png;base64,${imageBase64}`, used: updatedUsed, limit: safeMonthlyLimit });
    if (imageUrl) return res.status(200).json({ image: imageUrl, used: updatedUsed, limit: safeMonthlyLimit });
    await updateGenerationRecord(generationId, {
      status: "error",
      result: {
        generationTimeMs: Date.now() - generationStartedAt,
        image: "",
        imageSize: ""
      },
      error: {
        status: 500,
        message: "No image returned from OpenAI."
      }
    }).catch(function(error) {
      console.warn("Generation inspector empty result logging skipped.", error?.message || error);
    });
    return res.status(500).json({ error: "No image returned from OpenAI." });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Server error." });
  }
}
