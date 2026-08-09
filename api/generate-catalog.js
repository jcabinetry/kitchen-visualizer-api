export const config = {
  maxDuration: 300,
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
const GEOMETRY_IMAGE_QUALITY = "high";
const FINISH_IMAGE_QUALITY = "medium";
const CATALOG_PROMPT_VERSION = "v20-four-sided-frame-consistency-correction";

function selectCatalogImageModel(value) {
  return String(value || "").trim().toLowerCase() === TEST_CATALOG_IMAGE_MODEL
    ? TEST_CATALOG_IMAGE_MODEL
    : DEFAULT_CATALOG_IMAGE_MODEL;
}

async function selectOutputSize(image, model) {
  if (model !== DEFAULT_CATALOG_IMAGE_MODEL) return "1536x1024";
  const input = Buffer.from(stripDataUrl(image), "base64");
  const metadata = await sharp(input).rotate().metadata();
  let width = metadata.width || 1536;
  let height = metadata.height || 1024;
  const pixels = width * height;
  const minimumScale = pixels < 655360 ? Math.sqrt(655360 / pixels) : 1;
  const maximumScale = Math.min(2048 / Math.max(width, height), Math.sqrt(8294400 / pixels));
  const scale = Math.min(minimumScale, maximumScale);
  width = Math.max(16, Math.round(width * scale / 16) * 16);
  height = Math.max(16, Math.round(height * scale / 16) * 16);
  return `${width}x${height}`;
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
  const surfaces = "Countertop: keep unchanged.\nBacksplash: keep unchanged.\nFlooring: keep unchanged.";
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
  const masterMeasurements = String(body.masterMeasurements || "").trim();

  return `Create the first stage of a cabinet-refacing visualization.

ATTACHMENT ORDER
1. ORIGINAL KITCHEN PHOTO: preserve its layout, objects, lighting, perspective, and composition.
2. APPROVED AI CABINET DOOR MASTER (${details.doorName}): exact geometry for cabinet doors only.
3. APPROVED AI DRAWER-FRONT MASTER (${details.drawerName}): exact geometry for drawer fronts only.
4. CABINET DOOR EDGE BLUEPRINT: high contrast geometry extracted from image 2. Use only to see subtle profile boundaries.
5. DRAWER-FRONT EDGE BLUEPRINT: high contrast geometry extracted from image 3. Use only to see subtle profile boundaries.

CHANGE ONLY CABINET DOORS AND DRAWER FRONTS
Replace every existing cabinet door with the exact visible design from image 2. Replace every drawer front with the exact visible design from image 3. Use images 4 and 5 to locate every subtle rail, stile, inset, bevel, reveal, and panel boundary that may be hard to see in the shaded masters. The masters control the profile sequence, panel shape, corner treatment, and depth direction. The saved complete rail and stile width below overrides the apparent border proportion in the AI door master whenever they conflict. Compress or expand the complete door profile assembly to the saved physical width while keeping its internal bevel, reveal, and molding sequence recognizable. The blueprints control edge order only and must never override the saved physical width or be interpreted as color, finish, thickness, or a new design. Fit the same designs naturally to narrow, wide, short, tall, double, upper, base, island, and peninsula faces without simplifying them.

Door construction classification: ${details.doorConstructionType}.
Door geometry specification: ${doorDescription}
Door must avoid: ${doorMustAvoid}

Drawer-front construction classification: ${details.drawerConstructionType}.
Drawer-front geometry specification: ${drawerDescription}
Drawer front must avoid: ${drawerMustAvoid}

MASTER SCALE
${masterMeasurements}
The saved complete rail and stile assembly width is a fixed physical dimension for this catalog style. It runs from the outside door edge all the way to the center panel opening and includes the flat face, edge treatment, bevels, reveals, molding, and the full recessed or raised transition. On every individual door, the left stile, right stile, top rail, and bottom rail must each have this same complete physical width. Never make the vertical stiles wider than the horizontal rails. Keep this four-sided assembly width constant on every cabinet door regardless of door width or height. Never enlarge it proportionally on wide or tall doors. Never shrink it proportionally on narrow or short doors. Only the center panel area changes size.

The door and drawer masters are separate exact templates. Never stretch the door master into drawer areas, blend the two designs, keep the kitchen's old door profile, substitute a generic cabinet style, reverse raised versus recessed depth, or invent details absent from the correct master.

LOCK EVERYTHING ELSE
Keep every existing cabinet color and material unchanged during this stage. Keep face frames, cabinet boxes, exposed sides, end panels, fillers, trim, toe kicks, hardware, countertops, backsplash, flooring, appliances, walls, windows, decorations, lighting, camera angle, perspective, and room dimensions unchanged. Do not recolor cabinets and do not change any non-cabinet surface.

Return one photorealistic image of the same kitchen with only the cabinet-door and drawer-front geometry replaced. Exact catalog geometry is the primary success criterion.`;
}

function buildGeometryConsistencyPrompt(body, masterMeasurements) {
  const details = selectedDetails(body);
  return `Correct rail and stile scale consistency in a preliminary cabinet-refacing image.

ATTACHMENT ORDER
1. PRELIMINARY GEOMETRY KITCHEN: edit this image without redesigning it.
2. APPROVED AI CABINET DOOR MASTER (${details.doorName}): controls profile shape and sequence, but not an oversized apparent border proportion.
3. APPROVED AI DRAWER-FRONT MASTER (${details.drawerName}): preserve the drawer fronts already created.
4. CABINET DOOR EDGE BLUEPRINT: controls the order of door profile edges only.
5. DRAWER-FRONT EDGE BLUEPRINT: preserve drawer geometry.

EXACT PHYSICAL SCALE
${masterMeasurements}

Normalize every cabinet door so the complete rail and stile assembly has the same fixed physical width. The complete assembly runs from the outside door edge to the center panel opening and includes every flat section, bevel, reveal, molding detail, and raised or recessed transition. Do not scale this assembly proportionally with door width or height. A taller or wider door must have a larger center panel, not a wider rail or stile.

WITHIN EACH INDIVIDUAL DOOR
The left stile, right stile, top rail, and bottom rail must all have the same complete physical width. The center panel must be centered within four equal-width sides. Never make the side stiles thicker than the top or bottom rail. If the bottom rail already matches the saved physical width, preserve it and reduce the top rail and both side stiles to match it. Do not enlarge a correct narrow rail merely to match incorrect wide stiles.

Compare doors that lie on the same cabinet plane and at similar depth. Their complete rails and stiles must have the same apparent thickness after perspective is considered. Preserve any door whose scale is already correct and use it as an in-image calibration reference. Correct doors with enlarged rails or stiles to match that physical scale. Across different walls or depths, preserve normal perspective while keeping the physical dimension consistent.

LOCKED ELEMENTS
Do not change drawer fronts, door count, drawer count, cabinet openings, face positions, cabinet boxes, hardware, colors, materials, lighting, shadows, countertops, backsplash, flooring, appliances, walls, windows, decorations, camera angle, perspective, or room layout. Do not move, add, remove, or resize cabinets. Change only incorrect cabinet-door rail and stile scale and the resulting center-panel opening.

Return one corrected photorealistic image.`;
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

function buildColorPassPrompt(body) {
  const details = selectedDetails(body);
  return `Apply cabinet finishes to this already corrected kitchen image.

CHANGE ONLY CABINET COLOR AND FINISH
Apply ${details.upperName}${details.upperHex ? ` (${details.upperHex})` : ""} to every visible upper cabinet door, drawer front, face frame, exposed side, filler, and trim above countertop height.
Apply ${details.baseName}${details.baseHex ? ` (${details.baseHex})` : ""} to every visible base, island, and peninsula cabinet door, drawer front, face frame, exposed side, filler, trim, and toe kick below countertop height.

The attached finish swatches control color and material only. Preserve the exact cabinet door and drawer geometry already present in image 1. Do not redraw, simplify, replace, or reinterpret any door or drawer profile.

LOCKED SCENE
Preserve the cabinet layout, cabinet count, openings, hardware, appliances, countertops, backsplash, flooring, walls, windows, decorations, camera angle, lighting, perspective, and room dimensions. The transparent mask area is the only editable region. Everything outside it must remain unchanged.`;
}

async function measureMasterGeometry(dataUrl, physicalWidth, physicalHeight, label) {
  const base64 = stripDataUrl(dataUrl);
  if (!base64) return "";
  try {
    const prepared = await sharp(Buffer.from(base64, "base64"))
      .rotate()
      .trim({ threshold: 18 })
      .resize(600, 800, { fit: "fill" })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const width = prepared.info.width;
    const height = prepared.info.height;
    const pixels = prepared.data;

    function verticalGradient(x) {
      let sum = 0;
      let count = 0;
      for (let y = Math.floor(height * 0.28); y < Math.floor(height * 0.72); y++) {
        sum += Math.abs(pixels[y * width + x] - pixels[y * width + x - 1]);
        count++;
      }
      return count ? sum / count : 0;
    }

    function horizontalGradient(y) {
      let sum = 0;
      let count = 0;
      for (let x = Math.floor(width * 0.28); x < Math.floor(width * 0.72); x++) {
        sum += Math.abs(pixels[y * width + x] - pixels[(y - 1) * width + x]);
        count++;
      }
      return count ? sum / count : 0;
    }

    function innerBoundary(length, gradient, reverse) {
      const values = [];
      let maximum = 0;
      for (let offset = Math.floor(length * 0.035); offset <= Math.floor(length * 0.40); offset++) {
        const position = reverse ? length - 1 - offset : offset;
        const value = gradient(position);
        values.push({ offset, value });
        maximum = Math.max(maximum, value);
      }
      const threshold = Math.max(2.5, maximum * 0.22);
      const candidates = values.filter(item => item.value >= threshold);
      return candidates.length ? candidates[candidates.length - 1].offset : Math.round(length * 0.10);
    }

    const left = innerBoundary(width, verticalGradient, false);
    const right = innerBoundary(width, verticalGradient, true);
    const top = innerBoundary(height, horizontalGradient, false);
    const bottom = innerBoundary(height, horizontalGradient, true);
    const leftPct = left / width * 100;
    const rightPct = right / width * 100;
    const topPct = top / height * 100;
    const bottomPct = bottom / height * 100;
    const panelWidthPct = Math.max(1, 100 - leftPct - rightPct);
    const panelHeightPct = Math.max(1, 100 - topPct - bottomPct);

    return `${label} master represents exactly ${physicalWidth} inches wide by ${physicalHeight} inches tall.
Left profile: ${leftPct.toFixed(1)} percent or ${(physicalWidth * leftPct / 100).toFixed(2)} inches.
Right profile: ${rightPct.toFixed(1)} percent or ${(physicalWidth * rightPct / 100).toFixed(2)} inches.
Top profile: ${topPct.toFixed(1)} percent or ${(physicalHeight * topPct / 100).toFixed(2)} inches.
Bottom profile: ${bottomPct.toFixed(1)} percent or ${(physicalHeight * bottomPct / 100).toFixed(2)} inches.
Center panel opening: approximately ${panelWidthPct.toFixed(1)} percent of width by ${panelHeightPct.toFixed(1)} percent of height.
Keep these profile dimensions and proportions. Do not widen them into a generic cabinet frame.`;
  } catch (_error) {
    return `${label} master represents exactly ${physicalWidth} inches wide by ${physicalHeight} inches tall. Preserve its visible proportions.`;
  }
}

async function createGeometryBlueprint(dataUrl, targetWidth, targetHeight) {
  const base64 = stripDataUrl(dataUrl);
  if (!base64) return "";
  try {
    const prepared = await sharp(Buffer.from(base64, "base64")).rotate().trim({ threshold: 10 })
      .resize(targetWidth, targetHeight, { fit: "contain", background: "#ffffff" }).greyscale().raw()
      .toBuffer({ resolveWithObject: true });
    const width = prepared.info.width, height = prepared.info.height, pixels = prepared.data;
    const gradients = [], strengths = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      const strength = Math.abs(pixels[index + 1] - pixels[index - 1]) + Math.abs(pixels[index + width] - pixels[index - width]);
      strengths[index] = strength; gradients.push(strength);
    }
    gradients.sort(function(a, b) { return a - b; });
    const adaptive = gradients[Math.floor(gradients.length * 0.86)] || 8;
    const strongThreshold = Math.max(7, adaptive * 0.72), softThreshold = Math.max(4, strongThreshold * 0.48);
    const edgePixels = Buffer.alloc(width * height, 255);
    for (let index = 0; index < strengths.length; index++) {
      if (strengths[index] >= strongThreshold) edgePixels[index] = 18;
      else if (strengths[index] >= softThreshold) edgePixels[index] = 115;
    }
    const output = await sharp(edgePixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
    return `data:image/png;base64,${output.toString("base64")}`;
  } catch (_error) { return ""; }
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

async function resizeMaskToMatchImage(maskDataUrl, imageDataUrl) {
  const maskBase64 = stripDataUrl(maskDataUrl);
  const imageBase64 = stripDataUrl(imageDataUrl);
  if (!maskBase64 || !imageBase64) return "";
  const imageMetadata = await sharp(Buffer.from(imageBase64, "base64")).metadata();
  if (!imageMetadata.width || !imageMetadata.height) return "";
  const resizedMask = await sharp(Buffer.from(maskBase64, "base64"))
    .resize(imageMetadata.width, imageMetadata.height, { fit: "fill", kernel: "nearest" })
    .png()
    .toBuffer();
  return `data:image/png;base64,${resizedMask.toString("base64")}`;
}

async function resultImagesDataUrls(result) {
  const images = [];
  for (const item of result?.data || []) {
    if (item?.b64_json) { images.push(`data:image/png;base64,${item.b64_json}`); continue; }
    if (!item?.url) continue;
    const response = await fetch(item.url);
    if (!response.ok) continue;
    const mime = response.headers.get("content-type") || "image/png";
    const bytes = Buffer.from(await response.arrayBuffer());
    images.push(`data:${mime};base64,${bytes.toString("base64")}`);
  }
  return images;
}
async function resultImageDataUrl(result) {
  const images = await resultImagesDataUrls(result);
  return images[0] || "";
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
    const doorProfileDescription = String(body.catalogDoorProfileDescription || "").trim();
    const drawerProfileDescription = String(body.catalogDrawerProfileDescription || "").trim();
    const doorProfileMustAvoid = String(body.catalogDoorProfileMustAvoid || "").trim();
    const drawerProfileMustAvoid = String(body.catalogDrawerProfileMustAvoid || "").trim();
    const requireProfileDescriptions = body.requireProfileDescriptions === true;
    const suppliedDoorMasterWidth = Number(body.catalogDoorMasterWidthInches || 18);
    const suppliedDoorMasterHeight = Number(body.catalogDoorMasterHeightInches || 24);
    const suppliedDoorFrameWidth = Number(body.catalogDoorFrameWidthInches || 0);
    const doorMasterWidthInches = Number.isFinite(suppliedDoorMasterWidth) && suppliedDoorMasterWidth > 0 ? suppliedDoorMasterWidth : 18;
    const doorMasterHeightInches = Number.isFinite(suppliedDoorMasterHeight) && suppliedDoorMasterHeight > 0 ? suppliedDoorMasterHeight : 24;
    const doorFrameWidthInches = Number.isFinite(suppliedDoorFrameWidth) && suppliedDoorFrameWidth > 0 ? suppliedDoorFrameWidth : 0;
    const requireFrameMeasurements = body.requireFrameMeasurements === true;
    const countertopReference = body.countertopCustomReference || null;
    const backsplashReference = body.backsplashCustomReference || null;
    const flooringReference = body.flooringCustomReference || null;

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
    if (requireProfileDescriptions && (!doorProfileDescription || !drawerProfileDescription || !doorProfileMustAvoid || !drawerProfileMustAvoid || body.profileAnalysisStatus !== "ready")) {
      return res.status(400).json({ error: "This style needs current door and drawer geometry descriptions. Generate them in Catalog Manager, save the catalog, and reload the visualizer." });
    }
    if (requireFrameMeasurements && doorConstructionType !== "slab" && (!doorFrameWidthInches || body.doorFrameMeasurementStatus !== "confirmed")) {
      return res.status(400).json({ error: "This style needs a confirmed rail and stile width. Measure and confirm it in Catalog Manager, save the catalog, and reload the visualizer." });
    }
    if (!mainReference) {
      return res.status(400).json({ error: "Catalog color swatch image was not sent. Select a catalog color swatch again and generate after the page finishes loading." });
    }

    if (!body.cabinetMask || !stripDataUrl(body.cabinetMask)) {
      return res.status(400).json({ error: "Kitchen cabinet analysis is not ready. Upload the kitchen photo again and wait for analysis to finish." });
    }

    const imageModel = selectCatalogImageModel(body.imageModel);
    const outputSize = await selectOutputSize(body.image, imageModel);
    const activePromptVersion = CATALOG_PROMPT_VERSION;
    const doorMasterMeasurements = doorFrameWidthInches > 0
      ? `CABINET DOOR master represents exactly ${doorMasterWidthInches.toFixed(2)} inches wide by ${doorMasterHeightInches.toFixed(2)} inches tall.
Catalog saved complete rail and stile assembly width: exactly ${doorFrameWidthInches.toFixed(2)} inches from the outside door edge to the center panel opening.
That complete width is ${(doorFrameWidthInches / doorMasterWidthInches * 100).toFixed(2)} percent of the ${doorMasterWidthInches.toFixed(2)} inch master width.
Keep the entire rail and stile assembly exactly ${doorFrameWidthInches.toFixed(2)} inches wide on every cabinet door. This includes the flat face, outer edge treatment, every bevel, reveal, molding detail, and the complete recessed or raised transition before the center panel begins. On each individual door, the left stile, right stile, top rail, and bottom rail must all be exactly ${doorFrameWidthInches.toFixed(2)} inches wide. Never make the vertical stiles wider than the horizontal rails. This is a fixed manufacturing dimension, not a scalable proportion. Only the center panel area may expand or contract.`
      : await measureMasterGeometry(doorReference, doorMasterWidthInches, doorMasterHeightInches, "CABINET DOOR");
    const drawerMasterMeasurements = await measureMasterGeometry(drawerReference || doorReference, 18, 5, "DRAWER FRONT");
    const masterMeasurements = doorMasterMeasurements + "\n" + drawerMasterMeasurements;
    const doorBlueprint = await createGeometryBlueprint(doorReference, 768, 1024);
    const drawerBlueprint = await createGeometryBlueprint(drawerReference || doorReference, 1024, 320);
    const prompt = buildGeometryPassPrompt({
      ...body,
      masterMeasurements
    }) + `

MASK RULE
The transparent area of the mask identifies the only cabinet region that may change. Preserve every pixel outside that editable cabinet region. Do not change cabinet colors, countertops, backsplash, flooring, appliances, walls, windows, decorations, or room layout. Change only cabinet door and drawer-front geometry inside the editable region. Preserve existing hardware and realistic shadows.`;

    const editForm = new FormData();
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
      doorBlueprint: false,
      drawerBlueprint: false,
      upperSwatch: false,
      baseSwatch: !baseReference || baseReference === mainReference,
      countertop: true,
      backsplash: true,
      flooring: true
    };
    editForm.append("model", imageModel);
    editForm.append("prompt", prompt);
    editForm.append("size", outputSize);
    editForm.append("quality", GEOMETRY_IMAGE_QUALITY);
    editForm.append("n", "1");
    attachmentStatus.kitchen = appendImage(editForm, body.image, "kitchen");
    if (attachmentStatus.kitchen) observeImage("Kitchen photo", body.image, "kitchen");
    attachmentStatus.cabinetMask = appendMask(editForm, body.cabinetMask);
    attachmentStatus.catalogDoor = appendImage(editForm, doorReference, "selected-catalog-door-exact-reference");
    if (attachmentStatus.catalogDoor) observeImage("Approved AI cabinet door master", doorReference, "selected-catalog-door-exact-reference");
    if (drawerReference) attachmentStatus.catalogDrawer = appendImage(editForm, drawerReference, "selected-catalog-drawer-front-reference");
    if (attachmentStatus.catalogDrawer && drawerReference) observeImage("Approved AI drawer-front master", drawerReference, "selected-catalog-drawer-front-reference");
    attachmentStatus.doorBlueprint = appendImage(editForm, doorBlueprint, "cabinet-door-edge-blueprint");
    if (attachmentStatus.doorBlueprint) observeImage("Cabinet door edge blueprint", doorBlueprint, "cabinet-door-edge-blueprint");
    attachmentStatus.drawerBlueprint = appendImage(editForm, drawerBlueprint, "drawer-front-edge-blueprint");
    if (attachmentStatus.drawerBlueprint) observeImage("Drawer front edge blueprint", drawerBlueprint, "drawer-front-edge-blueprint");
    // Finish swatches are intentionally withheld from the geometry pass.
    // They are attached only to the final pass so the first two model calls can focus on door and drawer shape.
    attachmentStatus.upperSwatch = true;
    attachmentStatus.baseSwatch = true;
    if (attachmentStatus.cabinetMask) observeImage("Diagnostic cabinet edit mask, not a numbered reference image", body.cabinetMask, "diagnostic-cabinet-edit-mask");
    if (!attachmentStatus.kitchen) return res.status(400).json({ error: "Kitchen image could not be attached. Upload the kitchen photo again and retry." });
    if (!attachmentStatus.cabinetMask) return res.status(400).json({ error: "Kitchen cabinet mask could not be attached. Upload the kitchen photo again and retry." });
    if (!attachmentStatus.catalogDoor) return res.status(400).json({ error: "Catalog door image could not be attached. Select the catalog door again after the page finishes loading." });
    if (drawerReference && !attachmentStatus.catalogDrawer) return res.status(400).json({ error: "Catalog drawer front image could not be attached. Select the catalog door style again after the page finishes loading." });
    if (!attachmentStatus.doorBlueprint || !attachmentStatus.drawerBlueprint) return res.status(500).json({ error: "The high contrast cabinet geometry blueprints could not be created." });
    if (!attachmentStatus.upperSwatch) return res.status(400).json({ error: "Catalog finish swatch could not be attached. Select the catalog color swatch again after the page finishes loading." });

    const inspectorPayload = {
      model: imageModel,
      size: outputSize,
      quality: `geometry ${GEOMETRY_IMAGE_QUALITY}, finish ${FINISH_IMAGE_QUALITY}`,
      promptVersion: activePromptVersion,
      prompt,
      generationMode: "geometry-consistency-correction-then-color",
      requestCount: 3,
      masterMeasurements,
      passes: [
        { stage: "door-drawer-geometry", prompt, candidateCount: 1 },
        { stage: "door-scale-consistency-correction", prompt: buildGeometryConsistencyPrompt(body, masterMeasurements) },
        { stage: "cabinet-finish", prompt: buildColorPassPrompt(body) }
      ],
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
      quality: `geometry ${GEOMETRY_IMAGE_QUALITY}, finish ${FINISH_IMAGE_QUALITY}`,
      attachmentStatus,
      summary: {
        companyKey: safeCompanyKey,
        manufacturer: body.manufacturer || body.selectedCatalog || "",
        cabinetLine: body.cabinetLine || "",
        doorStyle: body.catalogDoorName || body.selectedDoorStyle || body.style || "",
        drawerFront: body.catalogDrawerName || "",
        doorConstructionType,
        drawerConstructionType,
        doorProfileDescription,
        drawerProfileDescription,
        doorProfileMustAvoid,
        drawerProfileMustAvoid,
        promptMode: "geometry-consistency-correction-then-color",
        requestCount: 3,
        masterMeasurements,
        doorMasterWidthInches,
        doorMasterHeightInches,
        doorFrameWidthInches,
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

    const geometryResponse = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: editForm });
    const geometryResult = await geometryResponse.json();
    if (!geometryResponse.ok) {
      await updateGenerationRecord(generationId, {
        status: "error",
        error: {
          status: geometryResponse.status,
          stage: "door-drawer-geometry",
          message: geometryResult?.error?.message || geometryResult?.message || "OpenAI cabinet geometry edit failed."
        }
      }).catch(function() {});
      return res.status(geometryResponse.status).json({ error: geometryResult?.error?.message || geometryResult?.message || "The cabinet geometry edit failed." });
    }

    const geometryCandidates = await resultImagesDataUrls(geometryResult);
    if (!geometryCandidates.length) return res.status(500).json({ error: "The cabinet geometry pass returned no image." });
    const preliminaryGeometryImage = geometryCandidates[0];
    const consistencyPrompt = buildGeometryConsistencyPrompt(body, masterMeasurements);
    const consistencyForm = new FormData();
    consistencyForm.append("model", imageModel);
    consistencyForm.append("prompt", consistencyPrompt);
    consistencyForm.append("size", outputSize);
    consistencyForm.append("quality", GEOMETRY_IMAGE_QUALITY);
    consistencyForm.append("n", "1");
    if (!appendImage(consistencyForm, preliminaryGeometryImage, "preliminary-geometry-kitchen")) {
      return res.status(500).json({ error: "The preliminary kitchen could not be prepared for door scale correction." });
    }
    const consistencyMask = await resizeMaskToMatchImage(body.cabinetMask, preliminaryGeometryImage);
    if (!appendMask(consistencyForm, consistencyMask)) {
      return res.status(500).json({ error: "The cabinet mask could not be resized for door scale correction." });
    }
    appendImage(consistencyForm, doorReference, "approved-cabinet-door-master");
    appendImage(consistencyForm, drawerReference || doorReference, "approved-drawer-front-master");
    appendImage(consistencyForm, doorBlueprint, "cabinet-door-edge-blueprint");
    appendImage(consistencyForm, drawerBlueprint, "drawer-front-edge-blueprint");

    const consistencyResponse = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: consistencyForm });
    const consistencyResult = await consistencyResponse.json();
    if (!consistencyResponse.ok) {
      await updateGenerationRecord(generationId, {
        status: "error",
        error: {
          status: consistencyResponse.status,
          stage: "door-scale-consistency-correction",
          message: consistencyResult?.error?.message || consistencyResult?.message || "OpenAI door scale consistency correction failed."
        }
      }).catch(function() {});
      return res.status(consistencyResponse.status).json({ error: consistencyResult?.error?.message || consistencyResult?.message || "The door scale consistency correction failed." });
    }
    const geometryImage = await resultImageDataUrl(consistencyResult);
    if (!geometryImage) return res.status(500).json({ error: "The door scale consistency correction returned no image." });
    const geometrySelection = { selectedIndex: 0, reason: "A dedicated image correction pass normalized complete rail and stile scale across cabinet doors." };
    const selectedGeometryIndex = 0;
    await updateGenerationRecord(generationId, {
      result: { masterMeasurements, geometryCandidates, preliminaryGeometryImage, selectedGeometryIndex, geometrySelection, consistencyPrompt, geometryImage }
    }).catch(function(error) { console.warn("Geometry correction logging skipped.", error?.message || error); });

    const colorPrompt = buildColorPassPrompt(body);
    const colorForm = new FormData();
    colorForm.append("model", imageModel);
    colorForm.append("prompt", colorPrompt);
    colorForm.append("size", outputSize);
    colorForm.append("quality", FINISH_IMAGE_QUALITY);
    if (!appendImage(colorForm, geometryImage, "geometry-corrected-kitchen")) {
      return res.status(500).json({ error: "The corrected kitchen could not be prepared for the finish pass." });
    }
    const colorMask = await resizeMaskToMatchImage(body.cabinetMask, geometryImage);
    if (!appendMask(colorForm, colorMask)) {
      return res.status(500).json({ error: "The cabinet mask could not be resized for the finish pass." });
    }
    if (!appendImage(colorForm, mainReference, "selected-upper-swatch-reference")) {
      return res.status(400).json({ error: "The upper finish swatch could not be attached." });
    }
    if (baseReference && baseReference !== mainReference && !appendImage(colorForm, baseReference, "selected-base-swatch-reference")) {
      return res.status(400).json({ error: "The base finish swatch could not be attached." });
    }

    const colorResponse = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: colorForm });
    const colorResult = await colorResponse.json();
    if (!colorResponse.ok) {
      await updateGenerationRecord(generationId, {
        status: "error",
        error: {
          status: colorResponse.status,
          stage: "cabinet-finish",
          message: colorResult?.error?.message || colorResult?.message || "OpenAI cabinet finish edit failed."
        }
      }).catch(function() {});
      return res.status(colorResponse.status).json({ error: colorResult?.error?.message || colorResult?.message || "The cabinet finish edit failed." });
    }

    const generatedImage = await resultImageDataUrl(colorResult);
    if (!generatedImage) return res.status(500).json({ error: "The cabinet finish pass returned no image." });

    const updatedUsed = await redisIncr(usageKey);
    if (updatedUsed >= safeMonthlyLimit) await sendLimitEmail({ companyKey: safeCompanyKey, companyName: safeCompanyName, used: updatedUsed, limit: safeMonthlyLimit, customerName: body.customerName, customerEmail: body.customerEmail, customerPhone: body.customerPhone });

    await updateGenerationRecord(generationId, {
      status: "complete",
      result: {
        generationTimeMs: Date.now() - generationStartedAt,
        image: generatedImage,
        imageSize: imageSizeLabel(generatedImage),
        masterMeasurements,
        geometryCandidates,
        preliminaryGeometryImage,
        selectedGeometryIndex,
        geometrySelection,
        consistencyPrompt,
        geometryImage
      }
    }).catch(function(error) {
      console.warn("Generation inspector result logging skipped.", error?.message || error);
    });
    return res.status(200).json({ image: generatedImage, used: updatedUsed, limit: safeMonthlyLimit });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Server error." });
  }
}
