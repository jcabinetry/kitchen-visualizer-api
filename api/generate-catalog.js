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

function catalogDoorDescription(body, details) {
  const explicit = String(body.catalogDoorAiDescription || body.catalogDoorDescription || "").trim();
  if (explicit) return explicit.slice(0, 2200);

  const doorName = String(details.doorName || "").toLowerCase();
  if (/sen\s*ridge|senridge|sensen/.test(doorName)) {
    return "This selected catalog door reference shows a traditional five-piece cabinet door set with a separate matching five-piece drawer front above the taller lower door. The lower door has a tall vertical rectangular center panel surrounded by wide outer rails and stiles. The center panel is not flat and not flush with the outer frame. It has a raised/recessed dimensional profile with visible bevels and stepped edges around all four sides. The inside profile creates a shadow line between the outer frame and the center panel. The panel face sits within a shaped frame and has depth. The outer rails and stiles are wider and more sculpted than a plain Shaker door. The frame edges are not simple square edges. They have soft bevels and layered profile transitions. The lower door should read as a traditional profiled raised/recessed panel door, not a simple flat recessed Shaker rectangle. The drawer front above it is also a five-piece style. It has a horizontal rectangular center panel inside a profiled frame, matching the lower door's beveled and stepped profile language. The drawer front must not become a plain slab drawer. Keep the drawer front separate above the lower door. Keep the lower door as a tall vertical rectangle. Keep the center panel rectangular. Keep the profiled bevel around the center panel. Keep the wider outer rails and stiles. Keep the dimensional depth and shadow lines. Keep the traditional raised/recessed panel look. Do not create an arch. Do not create a cathedral top. Do not flatten it into a Shaker door. Do not simplify it into a plain recessed rectangle. Do not turn it into a slab door. Use the uploaded catalog door image as the source of truth for the exact shape, proportions, depth, bevels, rails, stiles, panel profile, and drawer-front construction. Use this written description only to understand the visual structure of that image. Do not use the unfinished raw wood color from the catalog door image as the final cabinet color. Cabinet color must come only from the selected finish swatch.";
  }

  return "";
}

function buildCatalogPrompt(body, hasMainReference, hasBaseReference, hasDoorReference) {
  const details = selectedDetails(body);
  const upperColorText = hasMainReference ? `uploaded upper/wall swatch reference for ${details.upperName}${details.upperHex ? ` (${details.upperHex})` : ""}` : details.upperName;
  const baseColorText = hasBaseReference ? `uploaded base/lower swatch reference for ${details.baseName}${details.baseHex ? ` (${details.baseHex})` : ""}` : details.baseName;
  const doorText = hasDoorReference ? `uploaded catalog door reference for ${details.doorName}` : details.doorName;
  const doorDescription = catalogDoorDescription(body, details);
  return `
MISSION:
Create a realistic cabinet door replacement and refacing preview using the ORIGINAL uploaded kitchen photo.
This is NOT a kitchen redesign.
The finished image must look like the same photograph taken seconds later after professionally refacing the cabinets.

Preserve:
- camera angle
- lighting
- perspective
- cabinet layout
- cabinet count
- drawer count
- appliance locations
- windows
- walls
- ceiling
- trim
- room proportions

Never redesign the room.

PRIORITY ORDER:
Follow these priorities exactly.
Priority 1: Cabinet Door Reference Match
Priority 2: Cabinet Finish Colors
Priority 3: Cabinet Layout Preservation
Priority 4: Countertops
Priority 5: Backsplash
Priority 6: Flooring
Never sacrifice a higher priority to improve a lower priority.

Selected cabinet door reference image: ${doorText}.
Selected upper/wall cabinet finish: ${upperColorText}.
Selected base/lower cabinet finish: ${baseColorText}.
${doorDescription ? `Hidden cabinet door description:\n${doorDescription}` : ""}

CABINET DOOR REFERENCE MATCH (HIGHEST PRIORITY):
Use the attached cabinet door reference image as the visual target for every cabinet door and drawer front.
Every visible cabinet door and drawer front must look just like that reference image.
Copy the visible door face from the image itself.
Do not choose from a named cabinet category.
Do not use a default cabinet appearance.
Do not use the original kitchen's old door pattern.
Keep only the existing cabinet boxes, openings, layout, sizes, and positions.
Use the door reference image only for shape, depth, borders, rails, stiles, contours, and face pattern.
Do not use the door reference image for cabinet color, wood tone, brightness, or material finish.
If any text conflicts with the attached cabinet door reference image, follow the image.
The finished kitchen should look like the exact cabinet door shown in the reference image was installed on the existing cabinet boxes.

CABINET FINISH (SECOND HIGHEST PRIORITY):
The attached cabinet finish swatches are exact finish references.
Copy the finish exactly.
Do not estimate.
Do not approximate.
Do not create your own interpretation.
The cabinet finish swatches are the ONLY approved source for cabinet color, tone, stain, paint, and material finish.
Do not use the catalog door image's color or raw wood tone for the final cabinet finish.

If the swatch is paint:
Use a painted finish. Do not add wood grain.

If the swatch is stained wood:
Keep the wood appearance.
Match:
- color
- undertone
- saturation
- darkness
- warmth
- grain visibility

Do not invent a different stain.
If Upper and Base use the same finish, every cabinet must receive that finish.
No cabinet may remain in its original color.

Apply the finish to:
- doors
- drawer fronts
- face frames
- cabinet sides
- end panels
- fillers
- cabinet trim
- toe kicks
- islands
- peninsulas

PROTECTED NON-CABINET SURFACES:
Do not recolor, repaint, tint, or alter any walls, ceilings, crown molding, baseboards, room trim, windows, window frames, interior doors, appliances, sinks, faucets, decor, lighting, open wall areas, or non-cabinet surfaces.
Cabinet finish colors apply only to cabinet doors, drawer fronts, face frames, side panels, end panels, rails, stiles, fillers, toe kicks, and trim that is physically part of the cabinets.
The selected upper cabinet finish must never be applied to walls, open wall areas, backsplash areas, ceilings, trim, appliances, or room surfaces.
If a wall or open room surface starts white, gray, beige, painted, tiled, or any other color, keep that non-cabinet surface visually the same unless the user specifically selected a backsplash, countertop, or flooring change for that surface.

ROOM PRESERVATION:
Do NOT change cabinet layout, cabinet sizes, cabinet locations, drawer locations, appliance locations, sink, windows, walls, ceiling, trim, lighting, or perspective.
Do NOT preserve the old cabinet door pattern; replace only the visible doors and drawer fronts with faces that match the attached cabinet door reference image.
Only the selected surfaces may change.

OTHER SELECTED SURFACE CHANGES:
After the cabinets are completely correct, apply countertop, backsplash, and flooring changes.
These changes must never modify the completed cabinet work.
${details.countertop ? `Change the countertops to: ${details.countertop}. Preserve the same countertop shape, edge, overhang, sink cutout, and appliance openings.` : "Keep countertops unchanged."}
${details.backsplash ? `Change the backsplash to: ${details.backsplash}. Preserve outlets, windows, trim, cabinets, and wall layout.` : "Keep backsplash unchanged."}
${details.flooring ? `Change the flooring to: ${details.flooring}. Preserve the same floor perspective, scale, shadows, cabinets, appliances, and room layout.` : "Keep flooring unchanged."}

FINAL VALIDATION:
Before considering the image complete, verify all of the following are true:
- Every cabinet door matches the supplied cabinet door reference image.
- No arches exist unless they exist in the supplied door.
- No decorative details have been invented.
- Every cabinet has the selected finish.
- No cabinet remains its original color.
- Every cabinet door and drawer front uses the same supplied door reference appearance.
- The room is still the original kitchen.

If ANY statement above is false, the generation is incorrect.
The catalog door image and cabinet finish swatches are mandatory requirements. They are never suggestions.
You will be evaluated only on whether the finished cabinet doors and cabinet finishes exactly match the supplied catalog references while preserving the original kitchen. If the cabinet doors or finishes do not match the supplied references, the generation is incorrect regardless of how realistic or attractive the rest of the image appears.

The final image must look like the original kitchen photo with only the selected surfaces refinished.
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
