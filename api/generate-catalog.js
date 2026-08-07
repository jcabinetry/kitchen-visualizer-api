export const config = {
  maxDuration: 60,
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
import sharp from "sharp";

const DEFAULT_MONTHLY_LIMIT = 200;
const ALERT_EMAIL_FORM = "https://formspree.io/f/xaqzgvyk";
const DEFAULT_CATALOG_IMAGE_MODEL = "gpt-image-2";
const TEST_CATALOG_IMAGE_MODEL = "gpt-image-1";
const CATALOG_IMAGE_QUALITY = "high";
const CATALOG_PROMPT_VERSION = "v13-upload-analysis-masked-edit";
const CLEAN_TEST_COMPANY_KEY = "13333";
const CLEAN_TEST_PROMPT_VERSION = "v11-clean";

function selectCatalogImageModel(value) {
  return String(value || "").trim().toLowerCase() === TEST_CATALOG_IMAGE_MODEL
    ? TEST_CATALOG_IMAGE_MODEL
    : DEFAULT_CATALOG_IMAGE_MODEL;
}

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

function buildCatalogPromptV8(body, hasMainReference, hasBaseReference, hasDoorReference, hasDrawerReference, hasDoorSourceReference, hasDrawerSourceReference) {
  const details = selectedDetails(body);
  const upperFinish = hasMainReference
    ? `the attached upper cabinet finish swatch (${details.upperName}${details.upperHex ? `, ${details.upperHex}` : ""})`
    : details.upperName;
  const baseFinish = hasBaseReference
    ? `the attached base cabinet finish swatch (${details.baseName}${details.baseHex ? `, ${details.baseHex}` : ""})`
    : details.baseName;
  const approvedDoorMaster = hasDoorReference
    ? `the approved AI cabinet door master (${details.doorName})`
    : details.doorName;
  const approvedDrawerMaster = hasDrawerReference
    ? `the approved AI drawer-front master (${details.drawerName})`
    : approvedDoorMaster;
  const originalDoorReference = hasDoorSourceReference
    ? `the original uploaded catalog door image (${details.doorName})`
    : approvedDoorMaster;
  const originalDrawerReference = hasDrawerSourceReference
    ? `the original uploaded catalog drawer-front image (${details.drawerName})`
    : approvedDrawerMaster;
  const doorSpecification = hasDoorSourceReference
    ? `${approvedDoorMaster} as the exact controlling template, with ${originalDoorReference} only as supporting confirmation`
    : approvedDoorMaster;
  const drawerSpecification = hasDrawerSourceReference
    ? `${approvedDrawerMaster} as the exact controlling template, with ${originalDrawerReference} only as supporting confirmation`
    : approvedDrawerMaster;
  let attachmentNumber = 2;
  const geometryAttachments = [];
  if (hasDrawerReference) geometryAttachments.push(`${attachmentNumber++}. APPROVED AI DRAWER-FRONT MASTER (${details.drawerName}); this is the exact controlling template for every drawer front.`);
  if (hasDoorReference) geometryAttachments.push(`${attachmentNumber++}. APPROVED AI CABINET DOOR MASTER (${details.doorName}); this is the exact controlling template for every cabinet door.`);
  if (hasDrawerSourceReference) geometryAttachments.push(`${attachmentNumber++}. ORIGINAL UPLOADED DRAWER-FRONT image (${details.drawerName}); use only to confirm the approved drawer master, never to replace it.`);
  if (hasDoorSourceReference) geometryAttachments.push(`${attachmentNumber++}. ORIGINAL UPLOADED CABINET DOOR image (${details.doorName}); use only to confirm the approved door master, never to replace it.`);
  const geometryAttachmentGuide = `${geometryAttachments.join("\n")}\nAny images after image ${attachmentNumber - 1} are finish or surface references.`;
  const drawerInstruction = hasDrawerReference
    ? `Replace every drawer front using ${drawerSpecification}. Use these drawer references only on drawer fronts. Copy the approved master exactly: its horizontal proportions, visible face pattern, outer contour, rail and stile widths, panel outline, molding or bevel sequence, edge profile, and transitions. Do not replace it with a generic ${details.drawerConstructionType || "catalog"} drawer front.`
    : `Replace every drawer front with a horizontally proportioned version of ${doorSpecification}. Preserve the reference construction while fitting it naturally to the shorter drawer-front height.`;
  const doorConstructionInstruction = constructionInstruction("door", details.doorConstructionType, doorSpecification);
  const drawerConstructionInstruction = constructionInstruction("drawer", details.drawerConstructionType, drawerSpecification);
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

Replace every existing cabinet door using ${doorSpecification}. The APPROVED AI DOOR MASTER is authoritative for the style-specific geometry: exact visible face pattern, panel outline, outer contour, rail and stile widths, proportions, molding and bevel sequence, number and placement of profile steps, edge details, and transitions. Copy it; do not reinterpret, simplify, normalize, or redesign it. Do not substitute a generic ${details.doorConstructionType || "catalog"} door. Fit that same approved master naturally to every cabinet-door size, including upper doors, base doors, double doors, narrow doors, tall pantry doors, and island doors.

${doorConstructionInstruction}

${drawerInstruction}

${drawerConstructionInstruction}

The approved AI door and drawer masters are separate exact templates, not inspiration. The APPROVED AI DOOR MASTER controls cabinet-door geometry only. The APPROVED AI DRAWER-FRONT MASTER controls drawer-front geometry only. The original uploads are secondary confirmation images. The administrator-supplied construction types confirm whether the centers are inset/recessed, raised, or slab. Never blend door and drawer geometry, retain the kitchen's original door style, substitute a generic style, mix styles, or invent details absent from the appropriate approved master.

Apply ${upperFinish} exactly and uniformly to every visible upper cabinet door, drawer front, face frame, exposed side, end panel, filler, and cabinet trim above countertop height.
Apply ${baseFinish} exactly and uniformly to every visible base cabinet door, drawer front, face frame, exposed side, end panel, filler, toe kick, island surface, peninsula surface, and cabinet trim below countertop height. Do not leave any corresponding cabinet surface in its original color. If the upper and base finishes are the same, apply that one finish uniformly to every cabinet surface in the kitchen.

Keep the cabinet boxes, cabinet layout, cabinet count, drawer count, appliance locations, hardware placement, island, walls, windows, trim, lighting, decorations, camera angle, perspective, and room dimensions exactly as they are. Do not redesign, modernize, resize, move, add, or remove anything.

Selected surface changes:
${selectedSurfaceChanges}
Preserve the original shape, position, openings, scale, perspective, and surrounding objects for each changed surface. Apart from the explicitly selected changes above, everything else must remain identical to the original photograph.

The finished image must look like the same kitchen photographed after professional cabinet refacing. The cabinet doors must match the supplied door reference exactly, the cabinet finishes must match the supplied swatches exactly, and the lighting, perspective, and textures must remain photorealistic.
`.trim();
}

function buildCatalogPromptV9(body, hasMainReference, hasBaseReference, hasCountertopReference, hasBacksplashReference, hasFlooringReference) {
  const details = selectedDetails(body);
  const doorDescription = String(body.catalogDoorProfileDescription || "").trim();
  const drawerDescription = String(body.catalogDrawerProfileDescription || "").trim();
  const doorMustAvoid = String(body.catalogDoorProfileMustAvoid || "").trim();
  const drawerMustAvoid = String(body.catalogDrawerProfileMustAvoid || "").trim();
  let order = 4;
  const attachments = [
    "1. ORIGINAL KITCHEN PHOTO: layout, objects, lighting, perspective, and composition source.",
    `2. APPROVED AI CABINET DOOR MASTER (${details.doorName}): exact geometry for cabinet doors only.`,
    `3. APPROVED AI DRAWER-FRONT MASTER (${details.drawerName}): exact geometry for drawer fronts only.`
  ];
  if (hasMainReference) attachments.push(`${order++}. UPPER CABINET FINISH SWATCH: color/material only.`);
  if (hasBaseReference) attachments.push(`${order++}. BASE CABINET FINISH SWATCH: color/material only.`);
  if (hasCountertopReference) attachments.push(`${order++}. COUNTERTOP REFERENCE: countertop material only.`);
  if (hasBacksplashReference) attachments.push(`${order++}. BACKSPLASH REFERENCE: backsplash material only.`);
  if (hasFlooringReference) attachments.push(`${order++}. FLOORING REFERENCE: flooring material only.`);
  const surfaces = [
    details.countertop ? `Countertop: change to ${details.countertop}; preserve exact shape, edge, openings, and position.` : "Countertop: keep unchanged.",
    details.backsplash ? `Backsplash: change to ${details.backsplash}; preserve exact area, outlets, windows, and trim.` : "Backsplash: keep unchanged.",
    details.flooring ? `Flooring: change to ${details.flooring}; preserve perspective, scale, shadows, and room layout.` : "Flooring: keep unchanged."
  ].join("\n");
  return `Create one photorealistic cabinet-refacing edit of image 1. This is one generation request, not a staged redesign.

ATTACHMENT ORDER AND AUTHORITY
${attachments.join("\n")}
No original catalog source images are attached. Never blend the door master, drawer master, finish swatches, or surface references.

CABINET DOORS — PRIMARY SUCCESS CRITERION
Match image 2 closely enough that an average customer immediately recognizes the selected catalog door style at normal viewing size. Preserve its visible face pattern, outer contour, panel outline, rail/stile proportions, profile steps, bevels, reveals, molding, edge treatment, and depth. Tiny photorealistic differences in texture, lighting, or microscopic edge detail are acceptable. A wrong depth direction, generic profile, changed bevel/step sequence, or visibly different proportions are not acceptable. Classification: ${details.doorConstructionType}. The classification controls depth direction only; it is not permission to substitute a generic ${details.doorConstructionType} door.
Saved door geometry specification: ${doorDescription}
Door must avoid: ${doorMustAvoid}

DRAWER FRONTS — SEPARATE SPECIFICATION
Match image 3 closely enough that an average customer recognizes the selected drawer-front style at normal viewing size. Keep its own horizontal proportions, relief direction, and profile sequence; do not stretch the door master or copy door geometry into drawer areas. Tiny texture and lighting differences are acceptable, but a generic or visibly different drawer profile is not. Classification: ${details.drawerConstructionType}.
Saved drawer-front geometry specification: ${drawerDescription}
Drawer front must avoid: ${drawerMustAvoid}

FINISHES
Apply ${details.upperName}${details.upperHex ? ` (${details.upperHex})` : ""} to every visible upper cabinet face, frame, side, filler, and trim. Apply ${details.baseName}${details.baseHex ? ` (${details.baseHex})` : ""} to every visible base, island, and peninsula cabinet face, frame, side, filler, trim, and toe kick. Finish references control color/material only and cannot alter geometry.

SELECTED SURFACES
${surfaces}

LOCKED SCENE
Keep cabinet boxes, layout, counts, openings, hardware placement, appliances, walls, windows, trim, decorations, camera angle, perspective, and room dimensions unchanged. Fit the exact masters naturally to upper, base, narrow, double, tall, and island faces without simplifying either profile. A visually generic door or drawer front is a failed result even when the rest of the room looks good.`;
}

function buildCatalogPrompt(body, hasMainReference, hasBaseReference, hasCountertopReference, hasBacksplashReference, hasFlooringReference) {
  return buildCatalogPromptV9(body, hasMainReference, hasBaseReference, hasCountertopReference, hasBacksplashReference, hasFlooringReference);
}

function buildGeometryPassPrompt(body) {
  const details = selectedDetails(body);
  const doorDescription = String(body.catalogDoorProfileDescription || "").trim();
  const drawerDescription = String(body.catalogDrawerProfileDescription || "").trim();
  const doorMustAvoid = String(body.catalogDoorProfileMustAvoid || "").trim();
  const drawerMustAvoid = String(body.catalogDrawerProfileMustAvoid || "").trim();

  return `Create the first stage of a cabinet-refacing visualization.

ATTACHMENT ORDER
1. ORIGINAL KITCHEN PHOTO: preserve its layout, objects, lighting, perspective, and composition.
2. APPROVED AI CABINET DOOR MASTER (${details.doorName}): exact geometry for cabinet doors only.
3. APPROVED AI DRAWER-FRONT MASTER (${details.drawerName}): exact geometry for drawer fronts only.

CHANGE ONLY CABINET DOORS AND DRAWER FRONTS
Replace every existing cabinet door with the exact visible design from image 2. Replace every drawer front with the exact visible design from image 3. Copy the panel outline, outer contour, rail and stile proportions, profile steps, bevels, reveals, molding, edge treatment, corners, and depth direction. Fit the same designs naturally to narrow, wide, short, tall, double, upper, base, island, and peninsula faces without simplifying them.

Door construction classification: ${details.doorConstructionType}.
Door geometry specification: ${doorDescription}
Door must avoid: ${doorMustAvoid}

Drawer-front construction classification: ${details.drawerConstructionType}.
Drawer-front geometry specification: ${drawerDescription}
Drawer front must avoid: ${drawerMustAvoid}

The door and drawer masters are separate exact templates. Never stretch the door master into drawer areas, blend the two designs, keep the kitchen's old door profile, substitute a generic cabinet style, reverse raised versus recessed depth, or invent details absent from the correct master.

LOCK EVERYTHING ELSE
Keep every existing cabinet color and material unchanged during this stage. Keep face frames, cabinet boxes, exposed sides, end panels, fillers, trim, toe kicks, hardware, countertops, backsplash, flooring, appliances, walls, windows, decorations, lighting, camera angle, perspective, and room dimensions unchanged. Do not recolor cabinets and do not change any non-cabinet surface.

Return one photorealistic image of the same kitchen with only the cabinet-door and drawer-front geometry replaced. Exact catalog geometry is the primary success criterion.`;
}

function buildFinishSurfacePassPrompt(body, hasBaseReference, hasCountertopReference, hasBacksplashReference, hasFlooringReference) {
  const details = selectedDetails(body);
  let order = 2;
  const attachments = [`${order++}. UPPER CABINET FINISH SWATCH: color and material only.`];
  if (hasBaseReference) attachments.push(`${order++}. BASE CABINET FINISH SWATCH: color and material only.`);
  if (hasCountertopReference) attachments.push(`${order++}. COUNTERTOP REFERENCE: countertop material only.`);
  if (hasBacksplashReference) attachments.push(`${order++}. BACKSPLASH REFERENCE: backsplash material only.`);
  if (hasFlooringReference) attachments.push(`${order++}. FLOORING REFERENCE: flooring material only.`);

  const surfaceInstructions = [
    details.countertop
      ? `Change only visible countertops to ${details.countertop}${hasCountertopReference ? ", matching the attached countertop reference" : ""}. Preserve their exact shape, edge, thickness, overhang, openings, and position.`
      : "Keep countertops unchanged.",
    details.backsplash
      ? `Change only the visible backsplash to ${details.backsplash}${hasBacksplashReference ? ", matching the attached backsplash reference" : ""}. Preserve its exact area, outlets, windows, trim, and position.`
      : "Keep the backsplash unchanged.",
    details.flooring
      ? `Change only visible flooring to ${details.flooring}${hasFlooringReference ? ", matching the attached flooring reference" : ""}. Preserve its perspective, scale, shadows, and room layout.`
      : "Keep flooring unchanged."
  ].join("\n");

  return `Create the final styling stage of an existing cabinet-refacing visualization.

ATTACHMENT ORDER
1. APPROVED GEOMETRY-STAGE KITCHEN: this is the required base image.
${attachments.join("\n")}

LOCK THE APPROVED CABINET GEOMETRY
Every cabinet door and drawer front in image 1 is already approved. Preserve every panel outline, rail and stile width, profile step, bevel, reveal, molding detail, corner, edge, proportion, depth direction, door count, drawer count, opening, and hardware location. Do not regenerate, reinterpret, simplify, resize, move, add, remove, or substitute any cabinet face. Finish and material references control appearance only and must never alter geometry.

APPLY CABINET FINISHES
Apply ${details.upperName}${details.upperHex ? ` (${details.upperHex})` : ""} to every visible upper cabinet door, drawer front, face frame, exposed side, end panel, filler, and trim.
Apply ${details.baseName}${details.baseHex ? ` (${details.baseHex})` : ""} to every visible base, island, and peninsula cabinet door, drawer front, face frame, exposed side, end panel, filler, trim, and toe kick. Do not leave any corresponding cabinet surface in its original color. If only one cabinet finish is attached, use it for every cabinet surface.

SELECTED SURFACES
${surfaceInstructions}

Keep appliances, walls outside the selected backsplash, windows, decorations, lighting, camera angle, perspective, room dimensions, and every unselected surface unchanged. Return the same photorealistic kitchen with the approved cabinet geometry intact and only the requested finishes and materials applied.`;
}

function buildCatalogPromptV11Clean(body, hasMainReference, hasBaseReference, hasCountertopReference, hasBacksplashReference, hasFlooringReference) {
  const details = selectedDetails(body);
  let order = 4;
  const attachments = [
    "1. ORIGINAL KITCHEN PHOTO.",
    `2. APPROVED AI-READABLE CABINET DOOR (${details.doorName}).`,
    `3. APPROVED AI-READABLE DRAWER FRONT (${details.drawerName}).`
  ];
  if (hasMainReference) attachments.push(`${order++}. UPPER CABINET FINISH SWATCH.`);
  if (hasBaseReference) attachments.push(`${order++}. BASE CABINET FINISH SWATCH.`);
  if (hasCountertopReference) attachments.push(`${order++}. SELECTED COUNTERTOP REFERENCE.`);
  if (hasBacksplashReference) attachments.push(`${order++}. SELECTED BACKSPLASH REFERENCE.`);
  if (hasFlooringReference) attachments.push(`${order++}. SELECTED FLOORING REFERENCE.`);

  const selectedSurfaces = [];
  if (details.countertop) {
    selectedSurfaces.push(`Change only the visible countertops to ${hasCountertopReference ? "the selected countertop reference image" : details.countertop}. Preserve their existing shape, edge, thickness, overhang, sink cutout, appliance openings, and position.`);
  }
  if (details.backsplash) {
    selectedSurfaces.push(`Change only the visible backsplash to ${hasBacksplashReference ? "the selected backsplash reference image" : details.backsplash}. Preserve its existing area, outlets, windows, trim, cabinets, countertops, and position.`);
  }
  if (details.flooring) {
    selectedSurfaces.push(`Change only the visible flooring to ${hasFlooringReference ? "the selected flooring reference image" : details.flooring}. Preserve its perspective, scale, shadows, cabinets, appliances, furniture, rugs, and room layout.`);
  }

  const surfaceSection = selectedSurfaces.length
    ? `After the cabinet doors and drawer fronts are correct, make only these additional selected surface changes:\n${selectedSurfaces.join("\n")}\nThese surface selections must not influence cabinet-door or drawer-front geometry.`
    : "No additional surface changes were selected. Keep every countertop, backsplash, floor, and other non-cabinet surface unchanged.";

  return `Attachment order:
${attachments.join("\n")}

Replace all existing cabinet doors in image 1 with the exact cabinet-door design shown in image 2. Replace every drawer front with the exact drawer-front design shown in image 3. Copy their visible profiles, panel shapes, frame widths, inside bevels, center panels, proportions, edge details, depth, and craftsmanship exactly. Do not simplify either design or substitute another cabinet style.

Apply the attached cabinet finish swatch or swatches uniformly to all cabinet doors, drawer fronts, visible face frames, cabinet sides, end panels, fillers, trim, and toe kicks. If only one cabinet finish is attached, use it on every cabinet surface.

Keep the cabinet boxes, cabinet layout, cabinet count, door count, drawer count, appliance locations, countertops, backsplash, flooring, walls, windows, trim, lighting, hardware placement, island, decorations, camera angle, perspective, and room dimensions exactly as they are. Do not redesign, modernize, resize, move, add, or remove anything.

This is a cabinet refacing visualization, not a kitchen remodel. The only cabinet changes should be the exact door style from image 2, the exact drawer-front style from image 3, and the selected cabinet finish.

${surfaceSection}

Produce one photorealistic image with accurate lighting, perspective, and textures.`;
}

function appendImage(form, dataUrl, fallbackName) {
  const base64 = stripDataUrl(dataUrl);
  if (!base64) return false;
  const mime = getMimeType(dataUrl, "image/jpeg");
  form.append("image[]", new File([Buffer.from(base64, "base64")], `${fallbackName}.${getExt(mime)}`, { type: mime }));
  return true;
}

function appendMask(form, dataUrl) {
  const base64 = stripDataUrl(dataUrl);
  if (!base64) return false;
  form.append("mask", new File([Buffer.from(base64, "base64")], "cabinet-edit-mask.png", { type: "image/png" }));
  return true;
}

async function resultImageDataUrl(result) {
  const imageBase64 = result?.data?.[0]?.b64_json;
  if (imageBase64) return `data:image/png;base64,${imageBase64}`;
  const imageUrl = result?.data?.[0]?.url;
  if (!imageUrl) return "";
  const response = await fetch(imageUrl);
  if (!response.ok) return "";
  const mime = response.headers.get("content-type") || "image/png";
  const bytes = Buffer.from(await response.arrayBuffer());
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function compositeCabinetGroups(originalImage, upperImage, baseImage, upperMask, baseMask) {
  const original = Buffer.from(stripDataUrl(originalImage), "base64");
  const metadata = await sharp(original).rotate().metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) throw new Error("Kitchen image dimensions could not be read for final compositing.");

  async function maskedLayer(image, mask) {
    const imageBuffer = Buffer.from(stripDataUrl(image), "base64");
    const maskBuffer = Buffer.from(stripDataUrl(mask), "base64");
    const alpha = await sharp(maskBuffer).resize(width, height).extractChannel(3).negate().raw().toBuffer();
    const rgb = await sharp(imageBuffer).resize(width, height, { fit: "fill" }).removeAlpha().raw().toBuffer();
    return sharp(rgb, { raw: { width, height, channels: 3 } })
      .joinChannel(alpha, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer();
  }

  const [upperLayer, baseLayer] = await Promise.all([
    maskedLayer(upperImage, upperMask),
    maskedLayer(baseImage, baseMask)
  ]);
  const output = await sharp(original).rotate().resize(width, height, { fit: "fill" })
    .composite([{ input: upperLayer, blend: "over" }, { input: baseLayer, blend: "over" }])
    .png()
    .toBuffer();
  return `data:image/png;base64,${output.toString("base64")}`;
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
    const cleanPromptTest = safeCompanyKey === CLEAN_TEST_COMPANY_KEY;
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
    const doorProfileDescription = String(body.catalogDoorProfileDescription || "").trim();
    const drawerProfileDescription = String(body.catalogDrawerProfileDescription || "").trim();
    const doorProfileMustAvoid = String(body.catalogDoorProfileMustAvoid || "").trim();
    const drawerProfileMustAvoid = String(body.catalogDrawerProfileMustAvoid || "").trim();
    const requireProfileDescriptions = body.requireProfileDescriptions === true;
    const countertopReference = body.countertopCustomReference || null;
    const backsplashReference = body.backsplashCustomReference || null;
    const flooringReference = body.flooringCustomReference || null;

    if (!doorReference) {
      return res.status(400).json({ error: "Catalog door image was not sent. Select a catalog door again and generate after the page finishes loading." });
    }
    if (requireDrawerReference && !drawerReference) {
      return res.status(400).json({ error: "Catalog drawer image was not sent. Add and generate the separate AI drawer reference in Catalog Manager before creating this premium custom preview." });
    }
    if (!cleanPromptTest && requireConstructionTypes && !doorConstructionType) {
      return res.status(400).json({ error: "Catalog door construction type was not sent. Edit this door in Catalog Manager and select Inset, Raised panel, or Slab." });
    }
    if (!cleanPromptTest && requireConstructionTypes && !drawerConstructionType) {
      return res.status(400).json({ error: "Catalog drawer-front construction type was not sent. Edit this door in Catalog Manager and select Inset, Raised panel, or Slab for its drawer front." });
    }
    if (!cleanPromptTest && requireProfileDescriptions && (!doorProfileDescription || !drawerProfileDescription || !doorProfileMustAvoid || !drawerProfileMustAvoid || body.profileAnalysisStatus !== "ready")) {
      return res.status(400).json({ error: "This style needs current door and drawer geometry descriptions. Generate them in Catalog Manager, save the catalog, and reload the visualizer." });
    }
    if (!mainReference) {
      return res.status(400).json({ error: "Catalog color swatch image was not sent. Select a catalog color swatch again and generate after the page finishes loading." });
    }

    if (!body.cabinetMask || !stripDataUrl(body.cabinetMask) || !stripDataUrl(body.upperCabinetMask) || !stripDataUrl(body.baseCabinetMask)) {
      return res.status(400).json({ error: "Kitchen cabinet analysis is not ready. Upload the kitchen photo again and wait for analysis to finish." });
    }

    const imageModel = selectCatalogImageModel(body.imageModel);
    const activePromptVersion = CATALOG_PROMPT_VERSION;
    const prompt = buildCatalogPrompt(body, true, !!(baseReference && baseReference !== mainReference), false, false, false) + `

MASK RULE
The transparent area of the mask identifies the only cabinet region that may change. Preserve every pixel outside that editable cabinet region. Do not change countertops, backsplash, flooring, appliances, walls, windows, decorations, or room layout. Complete the cabinet door style, drawer-front style, finish, face frames, exposed sides, trim, and toe kicks naturally inside the editable region. Preserve existing hardware and realistic shadows.`;

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
      cabinetMask: false,
      catalogDoor: false,
      catalogDrawer: !drawerReference,
      upperSwatch: false,
      baseSwatch: !baseReference || baseReference === mainReference,
      countertop: true,
      backsplash: true,
      flooring: true
    };
    function createGroupEditForm(mask, groupPrompt) {
      const form = new FormData();
      form.append("model", imageModel);
      form.append("prompt", groupPrompt);
      form.append("size", "1536x1024");
      form.append("quality", CATALOG_IMAGE_QUALITY);
      const status = {
        kitchen: appendImage(form, body.image, "kitchen"),
        cabinetMask: appendMask(form, mask),
        catalogDoor: appendImage(form, doorReference, "selected-catalog-door-exact-reference"),
        catalogDrawer: drawerReference ? appendImage(form, drawerReference, "selected-catalog-drawer-front-reference") : true,
        upperSwatch: appendImage(form, mainReference, "selected-upper-swatch-reference"),
        baseSwatch: baseReference && baseReference !== mainReference ? appendImage(form, baseReference, "selected-base-swatch-reference") : true
      };
      return { form, status };
    }
    const upperPrompt = `${prompt}\n\nGROUP LOCK: This request edits UPPER WALL CABINETS ONLY. Apply only the upper finish ${body.upperSwatchName || body.selectedFinishColor || body.color || "shown in the upper swatch"}. Do not use the base finish in the editable upper region.`;
    const basePrompt = `${prompt}\n\nGROUP LOCK: This request edits BASE, ISLAND, PENINSULA, AND TALL CABINETS ONLY. Apply only the base finish ${body.baseSwatchName || body.selectedBaseFinishColor || body.island || "shown in the base swatch"}. Do not use the upper finish in the editable base region.`;
    const upperEdit = createGroupEditForm(body.upperCabinetMask, upperPrompt);
    const baseEdit = createGroupEditForm(body.baseCabinetMask, basePrompt);
    Object.keys(upperEdit.status).forEach(key => { attachmentStatus[key] = upperEdit.status[key] && baseEdit.status[key]; });
    if (attachmentStatus.kitchen) observeImage("Kitchen photo", body.image, "kitchen");
    if (attachmentStatus.catalogDoor) observeImage("Approved AI cabinet door master", doorReference, "selected-catalog-door-exact-reference");
    if (attachmentStatus.catalogDrawer && drawerReference) observeImage("Approved AI drawer-front master", drawerReference, "selected-catalog-drawer-front-reference");
    if (attachmentStatus.upperSwatch) observeImage("Upper swatch", mainReference, "selected-upper-swatch-reference");
    if (attachmentStatus.baseSwatch && baseReference && baseReference !== mainReference) observeImage("Base swatch", baseReference, "selected-base-swatch-reference");
    if (!attachmentStatus.kitchen) return res.status(400).json({ error: "Kitchen image could not be attached. Upload the kitchen photo again and retry." });
    if (!attachmentStatus.cabinetMask) return res.status(400).json({ error: "Kitchen cabinet mask could not be attached. Upload the kitchen photo again and retry." });
    if (!attachmentStatus.catalogDoor) return res.status(400).json({ error: "Catalog door image could not be attached. Select the catalog door again after the page finishes loading." });
    if (drawerReference && !attachmentStatus.catalogDrawer) return res.status(400).json({ error: "Catalog drawer front image could not be attached. Select the catalog door style again after the page finishes loading." });
    if (!attachmentStatus.upperSwatch) return res.status(400).json({ error: "Catalog finish swatch could not be attached. Select the catalog color swatch again after the page finishes loading." });

    const inspectorPayload = {
      model: imageModel,
      size: "1536x1024",
      quality: CATALOG_IMAGE_QUALITY,
      promptVersion: activePromptVersion,
      prompt,
      generationMode: "upload-analysis-masked-edit",
      requestCount: 2,
      passes: [{ stage: "upper-masked-edit", prompt: upperPrompt }, { stage: "base-masked-edit", prompt: basePrompt }],
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
      model: imageModel,
      promptVersion: activePromptVersion,
      quality: CATALOG_IMAGE_QUALITY,
      attachmentStatus,
      summary: {
        companyKey: safeCompanyKey,
        manufacturer: body.manufacturer || body.selectedCatalog || "",
        cabinetLine: body.cabinetLine || "",
        doorStyle: body.catalogDoorName || body.selectedDoorStyle || body.style || "",
        drawerFront: body.catalogDrawerName || "",
        doorConstructionType: cleanPromptTest ? "" : doorConstructionType,
        drawerConstructionType: cleanPromptTest ? "" : drawerConstructionType,
        doorProfileDescription: cleanPromptTest ? "" : doorProfileDescription,
        drawerProfileDescription: cleanPromptTest ? "" : drawerProfileDescription,
        doorProfileMustAvoid: cleanPromptTest ? "" : doorProfileMustAvoid,
        drawerProfileMustAvoid: cleanPromptTest ? "" : drawerProfileMustAvoid,
        promptMode: "upload-analysis-masked-edit",
        requestCount: 2,
        upperFinish: body.upperSwatchName || body.selectedFinishColor || body.color || "",
        baseFinish: body.baseSwatchName || body.selectedBaseFinishColor || body.island || body.upperSwatchName || "",
        countertop: "disabled in masked test",
        backsplash: "disabled in masked test",
        flooring: "disabled in masked test"
      },
      prompt: inspectorPayload.prompt,
      payload: inspectorPayload,
      referenceImages: attachedImages,
      warnings: ["Countertop, backsplash, and flooring edits are disabled in the masked cabinet test."]
    }).catch(function(error) {
      console.warn("Generation inspector logging skipped.", error?.message || error);
    });

    const [upperResponse, baseResponse] = await Promise.all([
      fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: upperEdit.form }),
      fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: baseEdit.form })
    ]);
    const [upperResult, baseResult] = await Promise.all([upperResponse.json(), baseResponse.json()]);
    if (!upperResponse.ok || !baseResponse.ok) {
      const failedResponse = !upperResponse.ok ? upperResponse : baseResponse;
      const failedResult = !upperResponse.ok ? upperResult : baseResult;
      await updateGenerationRecord(generationId, {
        status: "error",
        result: {
          generationTimeMs: Date.now() - generationStartedAt,
          image: "",
          imageSize: ""
        },
        error: {
          status: failedResponse.status,
          stage: !upperResponse.ok ? "upper-masked-edit" : "base-masked-edit",
          message: failedResult?.error?.message || failedResult?.message || "OpenAI grouped cabinet edit failed."
        }
      }).catch(function(error) {
        console.warn("Generation inspector error logging skipped.", error?.message || error);
      });
      return res.status(failedResponse.status).json({ error: failedResult?.error?.message || failedResult?.message || "The grouped cabinet edit failed." });
    }

    const [upperImage, baseImage] = await Promise.all([resultImageDataUrl(upperResult), resultImageDataUrl(baseResult)]);
    if (!upperImage || !baseImage) return res.status(500).json({ error: "One cabinet group finished without a usable image." });
    const generatedImage = await compositeCabinetGroups(body.image, upperImage, baseImage, body.upperCabinetMask, body.baseCabinetMask);

    const updatedUsed = await redisIncr(usageKey);
    if (updatedUsed >= safeMonthlyLimit) await sendLimitEmail({ companyKey: safeCompanyKey, companyName: safeCompanyName, used: updatedUsed, limit: safeMonthlyLimit, customerName: body.customerName, customerEmail: body.customerEmail, customerPhone: body.customerPhone });

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
    if (generatedImage) return res.status(200).json({ image: generatedImage, used: updatedUsed, limit: safeMonthlyLimit });
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
