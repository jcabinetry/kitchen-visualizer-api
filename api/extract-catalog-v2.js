import { setCorsHeaders } from "./_lib/cors.js";
import { saveCatalog, cleanCatalogId } from "./_lib/catalogStore.js";
import { extractCatalogV2, parseSources, slug } from "./_lib/catalogExtractV2.js";

function requireAdmin(req, res) {
  const required = process.env.ADMIN_API_TOKEN || process.env.ADMIN_TOKEN || "";
  if (!required) return true;
  const supplied = req.headers["x-admin-token"] || req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (supplied === required) return true;
  res.status(401).json({ error: "Unauthorized." });
  return false;
}

export default async function handler(req, res) {
  if (setCorsHeaders(req, res, "POST, OPTIONS")) return;
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!requireAdmin(req, res)) return;

  try {
    const body = req.body || {};
    const name = String(body.name || "Imported Catalog").trim();
    const catalogId = cleanCatalogId(body.catalogId || slug(name));
    const sourceUrls = parseSources(body);
    if (!catalogId) throw new Error("Manufacturer name is required.");
    if (!sourceUrls.length) throw new Error("Add at least one catalog source link.");

    const result = await extractCatalogV2({ name, sourceUrls });
    const catalog = await saveCatalog({
      catalogId,
      name,
      version: String(body.version || new Date().toISOString().slice(0, 10)),
      sourceType: sourceUrls.length > 1 ? "catalog-engine-v2-multi" : "catalog-engine-v2",
      sourceUrl: sourceUrls[0],
      sourceUrls,
      notes: result.notes,
      extraction: {
        engine: "v2",
        status: "extracted",
        updatedAt: new Date().toISOString(),
        sourceCount: sourceUrls.length
      },
      stats: result.stats,
      manufacturers: [{ id: slug(name), name, sourceUrl: sourceUrls[0], sourceUrls, lines: result.lines }]
    });

    return res.status(200).json({ catalog, message: "Catalog Extraction Engine v2 complete." });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Catalog extraction failed." });
  }
}
