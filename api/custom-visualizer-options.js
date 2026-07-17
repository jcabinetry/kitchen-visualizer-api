import { getCatalog } from "./_lib/catalogStore.js";
import { cleanCompanyKey, getCustomer } from "./_lib/customerStore.js";
import { setCorsHeaders } from "./_lib/cors.js";
import { stableCatalogOptionId } from "./_lib/customVisualizerV2.js";

function preview(value) {
  const source = String(value || "");
  return source.startsWith("data:image/") || source.startsWith("https://") ? source : "";
}

function publicOptions(catalog, assignment) {
  const allowed = Array.isArray(assignment.lineIds) ? assignment.lineIds.map(stableCatalogOptionId) : [];
  return {
    id: catalog.catalogId,
    name: catalog.name,
    manufacturers: (catalog.manufacturers || []).map(function(manufacturer) {
      const lines = (manufacturer.lines || []).filter(function(line) {
        return !allowed.length || allowed.includes(stableCatalogOptionId(line));
      }).map(function(line) {
        return {
          id: stableCatalogOptionId(line),
          name: line.name || line.label || stableCatalogOptionId(line),
          doors: (line.doors || []).map(function(door) {
            const ready = Boolean((door.aiDoorReference || door.aiImage) && (door.aiDrawerReference || door.aiDrawerImage) && door.doorProfileDescription && door.drawerProfileDescription && door.doorProfileMustAvoid && door.drawerProfileMustAvoid && (!door.profileAnalysisStatus || door.profileAnalysisStatus === "ready"));
            return { id: stableCatalogOptionId(door), name: door.name || door.label || door.value || stableCatalogOptionId(door), preview: preview(door.image || door.thumbnail), drawerPreview: preview(door.drawerImage || door.drawerThumbnail), ready };
          }),
          finishes: (line.finishes || []).map(function(finish) {
            return { id: stableCatalogOptionId(finish), name: finish.name || finish.label || finish.value || stableCatalogOptionId(finish), preview: preview(finish.swatch || finish.image || finish.thumbnail), ready: Boolean(finish.swatch || finish.image || finish.thumbnail) };
          })
        };
      });
      return { id: stableCatalogOptionId(manufacturer), name: manufacturer.name || manufacturer.label || stableCatalogOptionId(manufacturer), lines };
    }).filter(function(manufacturer) { return manufacturer.lines.length; })
  };
}

export default async function handler(req, res) {
  if (setCorsHeaders(req, res, "GET, OPTIONS")) return;
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });

  try {
    const companyKey = cleanCompanyKey(req.query.companyKey);
    if (!companyKey) return res.status(400).json({ error: "Company key missing." });
    const customer = await getCustomer(companyKey);
    if (!customer) return res.status(404).json({ error: "Company not found." });
    if (customer.status === "archived") return res.status(403).json({ error: "This visualizer is not active." });

    const assignments = Array.isArray(customer.catalogSelections) ? customer.catalogSelections : (customer.selectedCatalogs || []).map(function(catalogId) { return { catalogId, lineIds: [] }; });
    const catalogs = (await Promise.all(assignments.map(async function(assignment) {
      const catalog = await getCatalog(assignment.catalogId);
      return catalog && catalog.status !== "archived" ? publicOptions(catalog, assignment) : null;
    }))).filter(Boolean);

    return res.status(200).json({ company: { companyKey: customer.companyKey, companyName: customer.companyName, logoUrl: customer.logoUrl || customer.branding?.logoUrl || "", primaryColor: customer.primaryColor || customer.branding?.primaryColor || "#17324d", monthlyLimit: customer.monthlyLimit }, catalogs });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Catalog options could not be loaded." });
  }
}
