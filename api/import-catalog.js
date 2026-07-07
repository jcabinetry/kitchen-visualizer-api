import { setCorsHeaders } from "./_lib/cors.js";
import { saveCatalog } from "./_lib/catalogStore.js";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
}

function requireAdmin(req, res) {
  const required = process.env.ADMIN_API_TOKEN || process.env.ADMIN_TOKEN || "";
  if (!required) return true;

  const supplied = req.headers["x-admin-token"] || req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (supplied === required) return true;

  res.status(401).json({ error: "Unauthorized." });
  return false;
}

function cleanNameFromUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "Imported Catalog";

  if (/aristokraft/i.test(value)) return "Aristokraft";
  if (/cabdoor/i.test(value)) return "CabDoor";
  if (/fabuwood/i.test(value)) return "Fabuwood";
  if (/kraftmaid/i.test(value)) return "KraftMaid";
  if (/kemper/i.test(value)) return "Kemper";
  if (/waypoint/i.test(value)) return "Waypoint";

  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return host.split(".")[0].replace(/-/g, " ").replace(/\b\w/g, function(c) { return c.toUpperCase(); });
  } catch (_error) {
    return "Imported Catalog";
  }
}

function starterCatalogFromImport(body) {
  const name = String(body.name || cleanNameFromUrl(body.sourceUrl || body.catalogUrl || body.url)).trim();
  const version = String(body.version || new Date().toISOString().slice(0, 10)).trim();
  const sourceUrl = String(body.sourceUrl || body.catalogUrl || body.url || "").trim();

  return {
    name,
    version,
    sourceType: sourceUrl ? "url" : "manual",
    sourceUrl,
    notes: "Imported catalog shell. Extraction workflow will fill lines, doors, finishes, and species.",
    manufacturers: [
      {
        id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        name,
        sourceUrl,
        lines: [
          {
            id: "import-pending",
            name: "Import Pending",
            description: "Catalog has been saved. Run extraction to populate real product lines.",
            doors: [],
            finishes: [],
            species: []
          }
        ]
      }
    ]
  };
}

export default async function handler(req, res) {
  if (setCorsHeaders(req, res, "POST, OPTIONS")) return;
  setNoStore(res);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!requireAdmin(req, res)) return;

  try {
    const catalogShell = starterCatalogFromImport(req.body || {});
    const catalog = await saveCatalog(catalogShell);

    return res.status(200).json({
      catalog,
      message: "Catalog saved to library. Extraction/compare automation is the next build step."
    });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Catalog import failed." });
  }
}
