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
    doorName: body.catalogDoorName || body.style || "selected catalog door",
    upperName: body.upperSwatchName || body.color || "selected upper/wall swatch",
    baseName: body.baseSwatchName || body.island || body.upperSwatchName || body.color || "selected base/lower swatch",
    upperHex: body.upperSwatchHex || "",
    baseHex: body.baseSwatchHex || body.upperSwatchHex || "",
    countertop: body.countertop || countertopFromPrompt,
    backsplash: body.backsplash || backsplashFromPrompt,
    flooring: body.flooring || flooringFromPrompt
  };
}

function doorSpecificInstruction(doorName) {
  const name = String(doorName || "").toLowerCase();
  if (name.includes("raised")) {
    return "Because the selected door is a raised-panel style, show a raised center panel with shaped/beveled profile detail. Do not render it as an inset, recessed-panel, flat shaker, or slab door.";
  }
  if (name.includes("slab")) {
    return "Because the selected door is a slab style, show a plain flat slab face. Do not add shaker rails, raised panels, or recessed panels.";
  }
  if (name.includes("shaker")) {
    return "Because the selected door is a shaker style, match the selected shaker proportions and rail/stile profile from the reference image. Do not substitute a different shaker profile.";
  }
  return "Match the visible panel shape, edge profile, rail/stile proportions, and center-panel depth from the selected catalog door reference image.";
}

function buildCatalogPrompt(body, hasMainReference, hasBaseReference, hasDoorReference) {
  const details = selectedDetails(body);
  const upperColorText = hasMainReference ? `uploaded upper/wall swatch reference for ${details.upperName}${details.upperHex ? ` (${details.upperHex})` : ""}` : details.upperName;
  const baseColorText = hasBaseReference ? `uploaded base/lower swatch reference for ${details.baseName}${details.baseHex ? ` (${details.baseHex})` : ""}` : details.baseName;
  const doorText = hasDoorReference ? `uploaded catalog door reference for ${details.doorName}` : details.doorName;
  return `
Edit this exact kitchen photo into a realistic refacing preview, not a redesign.
Keep the same kitchen photo, same camera angle, same room, same lighting, same appliances, same cabinet box layout, same openings, same door/drawer count, same walls, and same decor.
Do not create a new kitchen. Do not invent a default cabinet style. Do not invent wood grain unless the selected swatch visibly contains wood grain.

PROTECTED NON-CABINET SURFACES:
Do not recolor, repaint, tint, or alter any walls, ceilings, crown molding, baseboards, room trim, windows, window frames, interior doors, appliances, sinks, faucets, decor, lighting, open wall areas, or non-cabinet surfaces.
Cabinet finish colors apply only to cabinet doors, drawer fronts, face frames, side panels, end panels, rails, stiles, fillers, toe kicks, and trim that is physically part of the cabinets.
The selected upper cabinet finish must never be applied to walls, open wall areas, backsplash areas, ceilings, trim, appliances, or room surfaces.
If a wall or open room surface starts white, gray, beige, painted, tiled, or any other color, keep that non-cabinet surface visually the same unless the user specifically selected a backsplash, countertop, or flooring change for that surface.

CATALOG CABINET REQUIREMENTS:
Door style: ${doorText}.
Upper/wall cabinet finish: ${upperColorText}.
Base/lower cabinet finish: ${baseColorText}.
The attached selected-catalog-door-reference image is the door style source of truth.
The attached selected-upper-swatch-reference image is the upper/wall color source of truth.
The attached selected-base-swatch-reference image is the base/lower color source of truth.
Keep upper cabinets separate from base cabinets. Apply the selected upper/wall swatch color only to visible upper cabinet surfaces above countertop height.

CATALOG FINISH / STAIN REQUIREMENT:
Treat each selected swatch reference as the exact cabinet finish target, not just an approximate color chip.
If a selected swatch is a solid painted color, render a smooth solid painted cabinet finish and do not add wood grain, stain, or texture.
If a selected swatch visibly contains wood grain, stain variation, pores, streaks, warm/cool undertones, darker grain lines, or natural texture, render the cabinets as stained wood with the same dominant stain color, same undertone, same darkness/lightness, same saturation, same warmth/coolness, and same grain contrast shown in the swatch.
The stain color must visually match the selected swatch image. Do not shift pecan, walnut, oak, maple, cherry, hickory, natural, or other stained finishes lighter, darker, redder, yellower, grayer, more orange, more brown, or more saturated than the selected swatch.
A stained wood swatch must remain wood-like and stained, not painted. Match both requirements at the same time: the exact stain color/tone from the swatch and the visible natural wood-grain texture from the swatch.
Do not flatten a stained wood swatch into a plain solid paint color, but also do not invent a different wood stain tone. Preserve the wood material character while matching the swatch color exactly.
For stained finishes, keep the visible wood-grain texture subtle and realistic on every refinished cabinet face while preserving the selected door profile and matching the selected swatch tone exactly.

BASE CABINET COLOR REQUIREMENT:
Apply the selected base/lower swatch color consistently to every visible cabinet below countertop height.
Base Cabinet Color means every visible lower cabinet surface, including:
- every lower cabinet door
- every drawer front
- every sink base cabinet
- every drawer stack
- every appliance-side base cabinet
- every exposed lower cabinet side
- every exposed lower end panel
- every peninsula base cabinet
- every toe-kick-adjacent lower cabinet face
- every visible lower rail and stile
- every visible island cabinet door, drawer front, side, and end panel

Do not leave any visible lower cabinet surface in its original color.
Treat island cabinetry as part of the selected Base Cabinet Color for catalog generation, and apply the base/lower swatch color to every visible island door, drawer front, exposed side, and end panel.

DOOR PROFILE REQUIREMENT:
Use the selected catalog door reference image as the highest-priority manufacturing reference and strict visual target for each visible cabinet door and drawer front.
${doorSpecificInstruction(details.doorName)}
Preserve the original kitchen's exact number, size, and location of doors and drawers, but change the visible face/profile to match the selected catalog door reference.
The selected catalog door reference image is mandatory and must be treated as the exact shape/profile target, not inspiration and not a style suggestion.
Copy only the visible door construction shown in the selected catalog picture: panel shape, panel type, square-vs-arched geometry, slab-vs-framed construction, raised-vs-recessed panel, rail width, stile width, frame proportions, inside profile, outside profile, reveal depth, bead details, groove details, edge profile, panel depth, and proportions exactly as pictured.
Do not invent, add, remove, exaggerate, or simplify any door shape. Do not add an arch, cathedral curve, raised center panel, recessed field, bead detail, decorative groove, ogee edge, extra trim, extra molding, bevel, shaker frame, slab face, or decorative profile unless that exact feature is clearly visible in the selected catalog door image.
If the selected door picture has a square top rail, keep every generated door square. If it has an arched/cathedral top rail, use that same arch shape only. If it has a flat/slab face, keep it flat/slab. Match the selected picture exactly.
The generated cabinet door fronts must look like the exact door shown in the selected catalog picture, only scaled and perspective-matched onto the original kitchen cabinets.
Only the door face style should change. Never redesign the cabinetry to fit the door style.
Apply the selected door style consistently to upper doors, base doors, drawer fronts, sink base doors, island doors, peninsula doors, and exposed cabinet end panels where a cabinet face is visible.
Do not leave any cabinet face in the original door style if the selected catalog door style is different.
Do not mix multiple door styles. Do not use generic shaker, generic slab, generic raised panel, or default cabinet doors unless the selected catalog door reference image actually shows that exact style.
Do not render an inset/recessed door unless the selected catalog reference is visibly inset/recessed.
Do not substitute white shaker, generic shaker, generic slab, generic raised panel, or random wood cabinets unless that exact catalog door and swatch were selected.
If there is any conflict between a generic door-style name and the supplied catalog door image, follow the supplied catalog door image.
If the model is uncertain about a detail, simplify toward the exact supplied catalog door construction instead of hallucinating decorative features.

OTHER SELECTED SURFACE CHANGES:
${details.countertop ? `Change the countertops to: ${details.countertop}. Preserve the same countertop shape, edge, overhang, sink cutout, and appliance openings.` : "Keep countertops unchanged."}
${details.backsplash ? `Change the backsplash to: ${details.backsplash}. Preserve outlets, windows, trim, cabinets, and wall layout.` : "Keep backsplash unchanged."}
${details.flooring ? `Change the flooring to: ${details.flooring}. Preserve the same floor perspective, scale, shadows, cabinets, appliances, and room layout.` : "Keep flooring unchanged."}

FINAL CHECK:
The final image must look like the original kitchen photo with only the selected surfaces refinished. The cabinet color must match the selected swatch image. The cabinet door profile must follow the selected catalog door reference image. If a selected catalog reference is ignored, the image is wrong.
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
    appendImage(form, doorReference, "selected-catalog-door-reference");
    observeImage("Catalog door", doorReference, "selected-catalog-door-reference");
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
