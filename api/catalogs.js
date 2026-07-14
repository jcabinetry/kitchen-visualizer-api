import { setCorsHeaders } from "./_lib/cors.js";
import { archiveCatalog, getCatalog, listCatalogs, listCatalogVersions, saveCatalog } from "./_lib/catalogStore.js";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "50mb"
    }
  }
};

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

export default async function handler(req, res) {
  if (setCorsHeaders(req, res, "GET, POST, PATCH, DELETE, OPTIONS")) return;
  setNoStore(res);

  try {
    if (req.method === "GET") {
      const catalogId = req.query.catalogId || req.query.id;
      if (catalogId) {
        const catalog = await getCatalog(catalogId);
        if (!catalog || catalog.status === "archived") return res.status(404).json({ error: "Catalog not found." });

        const includeVersions = String(req.query.versions || "") === "1";
        if (!includeVersions) return res.status(200).json(catalog);

        const versions = await listCatalogVersions(catalog.catalogId, 20);
        return res.status(200).json({ ...catalog, versions });
      }

      const catalogs = (await listCatalogs()).filter(function(catalog) {
        return catalog && catalog.status !== "archived";
      });
      return res.status(200).json({ catalogs });
    }

    if (!requireAdmin(req, res)) return;

    if (req.method === "POST" || req.method === "PATCH") {
      const catalog = await saveCatalog(req.body || {});
      return res.status(200).json({ catalog });
    }

    if (req.method === "DELETE") {
      const catalogId = req.query.catalogId || req.query.id || req.body?.catalogId || req.body?.id;
      const catalog = await archiveCatalog(catalogId);
      return res.status(200).json({ catalog });
    }

    return res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Catalog request failed." });
  }
}
