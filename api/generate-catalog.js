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
const CATALOG_IMAGE_MODEL = "gpt-image-2";
const CATALOG_IMAGE_QUALITY = "high";
const CATALOG_PROMPT_VERSION = String(process.env.CATALOG_PROMPT_VERSION || "v5").trim().toLowerCase() === "legacy"
  ? "legacy"
  : "v5";

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

function normalizeConstructionType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (type === "raised" || type === "raised-panel" || type === "raised panel") return "raised";
  if (type === "inset" || type === "recessed" || type === "recessed-panel" || type === "inset-panel") return "inset";
  if (type === "slab" || type === "flat" || type === "flat-panel") return "slab";
  return "";
}

function constructionInstruction(kind, type, reference) {
  const subject = kind === "drawer" ? "drawer front" : "cabinet door";
  const plural = kind === "drawer" ? "drawer fronts" : "cabinet doors";
  if (type === "raised") {
    return `CATALOG CONSTRUCTION: ${subject.toUpperCase()} = RAISED PANEL. This classification is supplied by the catalog administrator and must not be reinterpreted. Use ${reference} for the exact design. Every ${subject} must have a clearly dimensional center panel that visibly projects forward from its surrounding inner profile. Copy the reference's exact panel shape, sloped bevel, stepped transitions, frame proportions, highlights, shadows, and forward relief onto all ${plural}.`;
  }
  if (type === "inset") {
    return `CATALOG CONSTRUCTION: ${subject.toUpperCase()} = INSET / RECESSED PANEL. This classification is supplied by the catalog administrator and must not be reinterpreted. Use ${reference} for the exact design. Every ${subject} must have a center panel that visibly sits behind its surrounding frame. Copy the reference's exact inset depth, panel shape, inner profile, frame proportions, edge transitions, highlights, and shadow lines onto all ${plural}.`;
  }
  if (type === "slab") {
    return `CATALOG CONSTRUCTION: ${subject.toUpperCase()} = SLAB. This classification is supplied by the catalog administrator and must not be reinterpreted. Use ${reference} for the exact design. Every ${subject} must be one continuous face with the exact thickness, perimeter edge, bevel, corner treatment, proportions, highlights, and shadows visible in the reference.`;
  }
  return `Use ${reference} as the exact visual specification for every ${subject}.`;
}

function selectedDetails(body) {
  const prompt = body.prompt || "";
  const countertopFromPrompt = parseMaterial(prompt, "COUNTERTOP INSTRUCTION", /COUNTERTOP INSTRUCTION:\s*Replace only the visible countertop surfaces with\s+(.+?)\.\s+Preserve/is);
  const backsplashFromPrompt = parseMaterial(prompt, "BACKSPLASH INSTRUCTION", /BACKSPLASH INSTRUCTION:\s*Replace only the visible backsplash area with\s+(.+?)\.\s+Preserve/is);
  const flooringFromPrompt = parseMaterial(prompt, "FLOORING INSTRUCTION", /FLOORING INSTRUCTION:\s*Replace only the visible flooring with\s+(.+?)\.\s+Preserve/is);
  return {
    doorName: body.catalogDoorName || body.style || "selected catalog door reference",
    drawerName: body.catalogDrawerName || body.catalogDoorName || body.style || "selected drawer front reference",
    doorConstructionType: normalizeConstructionType(body.catalogDoorConstructionType),
    drawerConstructionType: normalizeConstructionType(body.catalogDrawerConstructionType),
    upperName: body.upperSwatchName || body.color || "selected upper/wall swatch",
    baseName: body.baseSwatchName || body.island || body.upperSwatchName || body.color || "selected base/lower swatch",
    upperHex: body.upperSwatchHex || body.mainCustomHex || "",
    baseHex: body.baseSwatchHex || body.islandCustomHex || body.upperSwatchHex || body.mainCustomHex || "",
    countertop: body.countertop || countertopFromPrompt,
    backsplash: body.backsplash || backsplashFromPrompt,
    flooring: body.flooring || flooringFromPrompt
  };
}

function buildLegacyCatalogPrompt(body, hasMainReference, hasBaseReference, hasDoorReference, hasDrawerReference) {
  const details = selectedDetails(body);
  const upperColorText = hasMainReference ? `the attached upper/wall cabinet finish swatch (${details.upperName}${details.upperHex ? `, ${details.upperHex}` : ""})` : details.upperName;
  const baseColorText = hasBaseReference ? `the attached base/lower cabinet finish swatch (${details.baseName}${details.baseHex ? `, ${details.baseHex}` : ""})` : details.baseName;
  const doorText = hasDoorReference ? "the attached cabinet door reference image" : details.doorName;
  const drawerText = hasDrawerReference ? "the attached drawer front reference image" : doorText;
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

Fit the new door style naturally to each existing cabinet size, including double doors, narrow doors, tall pantry doors, island doors, end panels, and exposed sides, while maintaining the same proportions as the reference image.
Replace drawer fronts with ${drawerText}. If a separate drawer front reference is attached, drawer fronts must use that drawer-front geometry instead of stretching the tall door geometry.

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

function buildCatalogPromptV5(body, hasMainReference, hasBaseReference, hasDoorReference, hasDrawerReference) {
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
  const drawerReference = hasDrawerReference
    ? `the attached drawer front reference image (${details.drawerName})`
    : doorReference;
  const geometryAttachmentGuide = hasDrawerReference
    ? `2. The second image is the exact DRAWER-FRONT reference (${details.drawerName}). Use it only for drawer fronts.\n3. The third image is the exact cabinet DOOR reference (${details.doorName}). Use it only for cabinet doors.\nAny images after the third image are finish or surface references.`
    : `2. The second image is the exact cabinet DOOR reference (${details.doorName}). Use it only for cabinet doors.\nNo separate drawer-front image is attached. Derive the drawer-front design from the cabinet door reference without inventing unrelated geometry. Any images after the second image are finish or surface references.`;
  const drawerInstruction = hasDrawerReference
    ? `Replace every drawer front with the exact drawer-front geometry shown in ${drawerReference}. Use this reference only on drawer fronts. Preserve its horizontal proportions and reproduce its exact visible face pattern, outer contour, edge profile, depth transitions, dimensional relief, and shadow lines.`
    : `Replace every drawer front with a horizontally proportioned version of ${drawerReference}. Preserve the reference construction while fitting it naturally to the shorter drawer-front height.`;
  const doorConstructionInstruction = constructionInstruction("door", details.doorConstructionType, doorReference);
  const drawerConstructionInstruction = constructionInstruction("drawer", details.drawerConstructionType, drawerReference);
  const selectedSurfaceChanges = [
    details.countertop ? `Replace the countertops with ${details.countertop}.` : "Keep the existing countertops unchanged.",
    details.backsplash ? `Replace the backsplash with ${details.backsplash}.` : "Keep the existing backsplash unchanged.",
    details.flooring ? `Replace the flooring with ${details.flooring}.` : "Keep the existing flooring unchanged."
  ].join("\n");

  return `
The selected catalog cabinet DOOR profile is the primary success criterion.
A result with the wrong cabinet-door geometry is a failed result, even if the drawer fronts, color, room realism, countertops, backsplash, or flooring look good.
Prioritize exact cabinet-door accuracy above every other change. After the doors are correct, match the drawer-front reference exactly within drawer areas only.

The attached images have distinct jobs and must not be blended together:
1. The first image is the original kitchen and is the layout, perspective, lighting, and composition source.
${geometryAttachmentGuide} Finish and surface references control color or material only and must not change door or drawer geometry.

Use the uploaded kitchen photo as the base image and create a photorealistic cabinet refacing preview, not a redesign.

Replace every existing cabinet door with the exact door profile shown in ${doorReference}. Match its exact visible face pattern, outer contour, proportions, edge details, profile transitions, dimensional relief, and shadow lines. Fit that same design naturally to every cabinet-door size, including upper doors, base doors, double doors, narrow doors, tall pantry doors, and island doors.

${doorConstructionInstruction}

${drawerInstruction}

${drawerConstructionInstruction}

The door and drawer-front references are separate exact specifications, not inspiration. The door reference and its administrator-supplied construction type control cabinet doors only. The drawer-front reference and its administrator-supplied construction type control drawer fronts only. Never copy, stretch, blend, or transfer geometry between them. Do not retain the kitchen's original door style, substitute a generic style, mix styles, or invent details absent from the appropriate reference.

Apply ${upperFinish} exactly and uniformly to every visible upper cabinet door, drawer front, face frame, exposed side, end panel, filler, and cabinet trim above countertop height.
Apply ${baseFinish} exactly and uniformly to every visible base cabinet door, drawer front, face frame, exposed side, end panel, filler, toe kick, island surface, peninsula surface, and cabinet trim below countertop height. Do not leave any corresponding cabinet surface in its original color. If the upper and base finishes are the same, apply that one finish uniformly to every cabinet surface in the kitchen.

Keep the cabinet boxes, cabinet layout, cabinet count, drawer count, appliance locations, hardware placement, island, walls, windows, trim, lighting, decorations, camera angle, perspective, and room dimensions exactly as they are. Do not redesign, modernize, resize, move, add, or remove anything.

Selected surface changes:
${selectedSurfaceChanges}
Preserve the original shape, position, openings, scale, perspective, and surrounding objects for each changed surface. Apart from the explicitly selected changes above, everything else must remain identical to the original photograph.

The finished image must look like the same kitchen photographed after professional cabinet refacing. The cabinet doors must match the supplied door reference exactly, the cabinet finishes must match the supplied swatches exactly, and the lighting, perspective, and textures must remain photorealistic.
`.trim();
}

function buildCatalogPrompt(body, hasMainReference, hasBaseReference, hasDoorReference, hasDrawerReference) {
  if (CATALOG_PROMPT_VERSION === "legacy") {
    return buildLegacyCatalogPrompt(body, hasMainReference, hasBaseReference, hasDoorReference, hasDrawerReference);
  }
  return buildCatalogPromptV5(body, hasMainReference, hasBaseReference, hasDoorReference, hasDrawerReference);
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
    const drawerReference = body.catalogDrawerReference || null;
    const requireDrawerReference = body.requireDrawerReference === true;
    const doorConstructionType = normalizeConstructionType(body.catalogDoorConstructionType);
    const drawerConstructionType = normalizeConstructionType(body.catalogDrawerConstructionType);
    const requireConstructionTypes = body.requireConstructionTypes === true;
    const countertopReference = body.countertopCustomReference || null;
    const backsplashReference = body.backsplashCustomReference || null;
    const flooringReference = body.flooringCustomReference || null;
    const extraReferences = Array.isArray(body.referenceImages) ? body.referenceImages.filter(Boolean) : [];

    if (!doorReference) {
      return res.status(400).json({ error: "Catalog door image was not sent. Select a catalog door again and generate after the page finishes loading." });
    }
    if (requireDrawerReference && !drawerReference) {
      return res.status(400).json({ error: "Catalog drawer image was not sent. Add and generate the separate AI drawer reference in Catalog Manager before creating this premium custom preview." });
    }
    if (requireConstructionTypes && !doorConstructionType) {
      return res.status(400).json({ error: "Catalog door construction type was not sent. Edit this door in Catalog Manager and select Inset, Raised panel, or Slab." });
    }
    if (requireConstructionTypes && !drawerConstructionType) {
      return res.status(400).json({ error: "Catalog drawer-front construction type was not sent. Edit this door in Catalog Manager and select Inset, Raised panel, or Slab for its drawer front." });
    }
    if (!mainReference) {
      return res.status(400).json({ error: "Catalog color swatch image was not sent. Select a catalog color swatch again and generate after the page finishes loading." });
    }

    const selectedPrompt = buildCatalogPrompt(body, !!mainReference, !!baseReference, !!doorReference, !!drawerReference);

    const form = new FormData();
    const generationId = createGenerationId();
    const generationStartedAt = Date.now();
    const attachedImages = [];
    function observeImage(role, dataUrl, fallbackName) {
      if (stripDataUrl(dataUrl)) {
        attachedImages.push(describeImage(role, dataUrl, `${fallbackName}.${getExt(getMimeType(dataUrl, "image/jpeg"))}`, attachedImages.length + 1));
      }
    }
    const attachmentStatus = {
      kitchen: false,
      catalogDoor: false,
      catalogDrawer: !drawerReference,
      upperSwatch: false,
      baseSwatch: !baseReference || baseReference === mainReference,
      countertop: !countertopReference,
      backsplash: !backsplashReference,
      flooring: !flooringReference,
      additionalReferences: []
    };
    form.append("model", CATALOG_IMAGE_MODEL);
    form.append("prompt", selectedPrompt);
    form.append("size", "1536x1024");
    form.append("quality", CATALOG_IMAGE_QUALITY);
    attachmentStatus.kitchen = appendImage(form, body.image, "kitchen");
    if (attachmentStatus.kitchen) observeImage("Kitchen photo", body.image, "kitchen");
    if (drawerReference) attachmentStatus.catalogDrawer = appendImage(form, drawerReference, "selected-catalog-drawer-front-reference");
    if (attachmentStatus.catalogDrawer && drawerReference) observeImage("Catalog drawer front reference", drawerReference, "selected-catalog-drawer-front-reference");
    attachmentStatus.catalogDoor = appendImage(form, doorReference, "selected-catalog-door-exact-reference");
    if (attachmentStatus.catalogDoor) observeImage("Catalog door exact reference", doorReference, "selected-catalog-door-exact-reference");
    attachmentStatus.upperSwatch = appendImage(form, mainReference, "selected-upper-swatch-reference");
    if (attachmentStatus.upperSwatch) observeImage("Upper swatch", mainReference, "selected-upper-swatch-reference");
    if (baseReference && baseReference !== mainReference) attachmentStatus.baseSwatch = appendImage(form, baseReference, "selected-base-swatch-reference");
    if (attachmentStatus.baseSwatch && baseReference && baseReference !== mainReference) observeImage("Base swatch", baseReference, "selected-base-swatch-reference");
    if (countertopReference) attachmentStatus.countertop = appendImage(form, countertopReference, "selected-countertop-reference");
    if (attachmentStatus.countertop && countertopReference) observeImage("Countertop", countertopReference, "selected-countertop-reference");
    if (backsplashReference) attachmentStatus.backsplash = appendImage(form, backsplashReference, "selected-backsplash-reference");
    if (attachmentStatus.backsplash && backsplashReference) observeImage("Backsplash", backsplashReference, "selected-backsplash-reference");
    if (flooringReference) attachmentStatus.flooring = appendImage(form, flooringReference, "selected-flooring-reference");
    if (attachmentStatus.flooring && flooringReference) observeImage("Flooring", flooringReference, "selected-flooring-reference");
    extraReferences.slice(0, 6).forEach(function(ref, index) {
      if (ref && ref !== mainReference && ref !== baseReference && ref !== doorReference && ref !== drawerReference && ref !== countertopReference && ref !== backsplashReference && ref !== flooringReference) {
        const attached = appendImage(form, ref, `catalog-reference-${index + 1}`);
        attachmentStatus.additionalReferences.push({ index: index + 1, attached });
        if (attached) observeImage(`Additional reference ${index + 1}`, ref, `catalog-reference-${index + 1}`);
      }
    });

    if (!attachmentStatus.kitchen) return res.status(400).json({ error: "Kitchen image could not be attached. Upload the kitchen photo again and retry." });
    if (!attachmentStatus.catalogDoor) return res.status(400).json({ error: "Catalog door image could not be attached. Select the catalog door again after the page finishes loading." });
    if (drawerReference && !attachmentStatus.catalogDrawer) return res.status(400).json({ error: "Catalog drawer front image could not be attached. Select the catalog door style again after the page finishes loading." });
    if (!attachmentStatus.upperSwatch) return res.status(400).json({ error: "Catalog finish swatch could not be attached. Select the catalog color swatch again after the page finishes loading." });

    const inspectorPayload = {
      model: CATALOG_IMAGE_MODEL,
      size: "1536x1024",
      quality: CATALOG_IMAGE_QUALITY,
      promptVersion: CATALOG_PROMPT_VERSION,
      prompt: selectedPrompt,
      attachmentStatus,
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
      model: CATALOG_IMAGE_MODEL,
      promptVersion: CATALOG_PROMPT_VERSION,
      quality: CATALOG_IMAGE_QUALITY,
      attachmentStatus,
      summary: {
        companyKey: safeCompanyKey,
        manufacturer: body.manufacturer || body.selectedCatalog || "",
        cabinetLine: body.cabinetLine || "",
        doorStyle: body.catalogDoorName || body.selectedDoorStyle || body.style || "",
        drawerFront: body.catalogDrawerName || "",
        doorConstructionType,
        drawerConstructionType,
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
