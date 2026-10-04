const PROMPT_VERSION = "custom-v2-master-1";

function text(value) {
  return String(value || "").trim();
}

export function stableCatalogOptionId(item = {}) {
  const source = typeof item === "string" ? item : (item.id || item.value || item.name || item.label);
  return text(source)
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

function sameId(item, wanted) {
  const target = stableCatalogOptionId({ id: wanted });
  return target && stableCatalogOptionId(item) === target;
}

function required(value, message) {
  if (!text(value)) throw new Error(message);
  return value;
}

function customerCatalogSelection(customer, catalogId) {
  const selections = Array.isArray(customer?.catalogSelections) ? customer.catalogSelections : [];
  const direct = selections.find(function(selection) {
    return text(selection?.catalogId) === text(catalogId);
  });
  if (direct) return direct;

  const legacy = Array.isArray(customer?.selectedCatalogs) ? customer.selectedCatalogs : [];
  if (legacy.map(text).includes(text(catalogId))) return { catalogId, lineIds: [] };
  return null;
}

export function resolveCatalogSelection({ customer, catalog, selection }) {
  if (!customer || customer.status === "archived") throw new Error("This visualizer is not active.");
  if (!catalog || catalog.status === "archived") throw new Error("The selected catalog is not active.");

  const catalogId = required(selection?.catalogId, "Select a catalog.");
  if (text(catalog.catalogId) !== text(catalogId)) throw new Error("The selected catalog could not be verified.");

  const assignment = customerCatalogSelection(customer, catalogId);
  if (!assignment) throw new Error("This catalog is not assigned to this customer.");

  const manufacturerId = required(selection?.manufacturerId, "Select a manufacturer.");
  const manufacturer = (catalog.manufacturers || []).find(function(item) { return sameId(item, manufacturerId); });
  if (!manufacturer) throw new Error("The selected manufacturer is not in the assigned catalog.");

  const lineId = required(selection?.lineId, "Select a cabinet line.");
  const allowedLineIds = Array.isArray(assignment.lineIds) ? assignment.lineIds.map(stableCatalogOptionId) : [];
  if (allowedLineIds.length && !allowedLineIds.includes(stableCatalogOptionId({ id: lineId }))) {
    throw new Error("This cabinet line is not assigned to this customer.");
  }

  const line = (manufacturer.lines || []).find(function(item) { return sameId(item, lineId); });
  if (!line) throw new Error("The selected cabinet line is not available.");

  const doorId = required(selection?.doorId, "Select a door style.");
  const door = (line.doors || []).find(function(item) { return sameId(item, doorId); });
  if (!door) throw new Error("The selected door style is not available in this cabinet line.");

  const finishId = required(selection?.finishId, "Select a cabinet finish.");
  const finish = (line.finishes || []).find(function(item) { return sameId(item, finishId); });
  if (!finish) throw new Error("The selected finish is not available in this cabinet line.");

  const doorReference = door.aiDoorReference || door.aiImage || "";
  const drawerReference = door.aiDrawerReference || door.aiDrawerImage || "";
  const finishReference = finish.swatch || finish.image || finish.thumbnail || "";
  required(doorReference, "This door style is missing its approved AI door reference. Complete it in Catalog Manager.");
  required(drawerReference, "This door style is missing its approved AI drawer-front reference. Complete it in Catalog Manager.");
  required(finishReference, "This finish is missing its authoritative color swatch. Complete it in Catalog Manager.");

  const doorDescription = required(door.doorProfileDescription, "This door style is missing its geometry description. Analyze it in Catalog Manager.");
  const drawerDescription = required(door.drawerProfileDescription, "This drawer front is missing its geometry description. Analyze it in Catalog Manager.");
  const doorMustAvoid = required(door.doorProfileMustAvoid, "This door style is missing its geometry exclusions. Analyze it in Catalog Manager.");
  const drawerMustAvoid = required(door.drawerProfileMustAvoid, "This drawer front is missing its geometry exclusions. Analyze it in Catalog Manager.");
  if (door.profileAnalysisStatus && door.profileAnalysisStatus !== "ready") {
    throw new Error("This door style's geometry analysis is not current. Regenerate it in Catalog Manager.");
  }

  return {
    catalogId: text(catalog.catalogId),
    catalogName: text(catalog.name),
    manufacturerId: stableCatalogOptionId(manufacturer),
    manufacturerName: text(manufacturer.name || manufacturer.label),
    lineId: stableCatalogOptionId(line),
    lineName: text(line.name || line.label),
    doorId: stableCatalogOptionId(door),
    doorName: text(door.name || door.label || door.value),
    finishId: stableCatalogOptionId(finish),
    finishName: text(finish.name || finish.label || finish.value),
    doorReference,
    drawerReference,
    finishReference,
    doorConstructionType: text(door.doorConstructionType),
    drawerConstructionType: text(door.drawerConstructionType),
    doorDescription,
    drawerDescription,
    doorMustAvoid,
    drawerMustAvoid
  };
}

export function buildMasterPrompt(resolved, retryFeedback = []) {
  const retrySection = retryFeedback.length
    ? `\nRETRY CORRECTIONS REQUIRED:\n${retryFeedback.map(function(item) { return `- ${text(item)}`; }).join("\n")}\nCorrect these failures while continuing to obey every rule below.`
    : "";

  return `CUSTOM CABINET REFACING — ${PROMPT_VERSION}

IMAGE ROLES (never interchange them):
1. ORIGINAL KITCHEN: immutable source for the room, camera, layout, cabinet locations, openings, appliances, hardware locations, lighting, and all non-cabinet surfaces.
2. AUTHORITATIVE CABINET DOOR MASTER: geometry only for every cabinet door.
3. AUTHORITATIVE DRAWER-FRONT MASTER: geometry only for every drawer front.
4. AUTHORITATIVE FINISH SWATCH: color and finish only. It provides no geometry.

TASK:
Perform a photorealistic cabinet refacing edit of image 1. Replace only visible cabinet doors, drawer fronts, and their matching visible cabinet face-frame/side finish. This is not a room redesign.

EXACT DOOR GEOMETRY — ${resolved.doorName}:
${resolved.doorDescription}
Must avoid: ${resolved.doorMustAvoid}
Use image 2 as the final visual authority. Scale the same profile proportionally for narrow, wide, short, tall, paired, pantry, and island doors. Do not simplify, reinterpret, modernize, or substitute a generic profile.

EXACT DRAWER-FRONT GEOMETRY:
${resolved.drawerDescription}
Must avoid: ${resolved.drawerMustAvoid}
Use image 3 as the final visual authority. Never copy the door proportions onto drawers and never copy drawer proportions onto doors.

COLOR / FINISH — ${resolved.finishName}:
Apply the hue, value, undertone, sheen, and visible finish behavior from image 4 uniformly to doors, drawer fronts, visible face frames, finished cabinet sides, fillers, trim, and toe kicks. Image 4 controls color only; ignore any shapes or objects visible in it.

IMMUTABLE ROOM CONSTRAINTS:
- Preserve the exact camera position, crop, perspective, focal length appearance, and room dimensions from image 1.
- Preserve every cabinet box location, cabinet opening, cabinet count, door count, drawer count, island footprint, and crown/toe-kick boundary.
- Preserve walls, ceilings, windows, doors, floors, countertops, backsplash, sinks, faucets, appliances, vents, lighting, decorations, and hardware placement.
- Do not add, remove, move, resize, restyle, clean up, stage, or redesign anything except the cabinet faces and matching cabinet finish described above.
- Do not invent cabinets in blank wall areas or cover appliances and openings.

OUTPUT:
Return one photorealistic image at the same landscape composition as image 1. The result must read as the original photograph with only the selected cabinet refacing applied.${retrySection}`;
}

export function buildValidationPrompt(resolved) {
  return `Audit a generated cabinet-refacing image against four authoritative references.

Image order: 1 original kitchen; 2 exact cabinet-door master; 3 exact drawer-front master; 4 exact finish swatch; 5 generated result.

Selected door: ${resolved.doorName}
Door geometry: ${resolved.doorDescription}
Door exclusions: ${resolved.doorMustAvoid}
Drawer geometry: ${resolved.drawerDescription}
Drawer exclusions: ${resolved.drawerMustAvoid}
Selected finish: ${resolved.finishName}

Fail the result if any important room structure, camera perspective, cabinet layout/count, opening, appliance, countertop, backsplash, floor, island, or hardware location changed. Fail if doors or drawers use a generic or materially different profile, if door geometry was copied onto drawers, or if the selected finish is materially wrong. Ignore tiny photorealistic lighting variation.

Return JSON only in this exact shape:
{"pass":true,"layoutScore":0,"doorGeometryScore":0,"drawerGeometryScore":0,"finishScore":0,"violations":[]}
Scores are integers from 0 to 100. pass may be true only when layoutScore >= 92, doorGeometryScore >= 88, drawerGeometryScore >= 88, finishScore >= 85, and violations is empty.`;
}

export function normalizeValidation(value) {
  const source = value && typeof value === "object" ? value : {};
  const result = {
    pass: source.pass === true,
    layoutScore: Math.max(0, Math.min(100, Number(source.layoutScore) || 0)),
    doorGeometryScore: Math.max(0, Math.min(100, Number(source.doorGeometryScore) || 0)),
    drawerGeometryScore: Math.max(0, Math.min(100, Number(source.drawerGeometryScore) || 0)),
    finishScore: Math.max(0, Math.min(100, Number(source.finishScore) || 0)),
    violations: Array.isArray(source.violations) ? source.violations.map(text).filter(Boolean).slice(0, 8) : []
  };
  result.pass = result.pass && result.layoutScore >= 92 && result.doorGeometryScore >= 88 && result.drawerGeometryScore >= 88 && result.finishScore >= 85 && result.violations.length === 0;
  return result;
}

export const CUSTOM_VISUALIZER_V2_PROMPT_VERSION = PROMPT_VERSION;
