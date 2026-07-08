import { setCorsHeaders } from "./_lib/cors.js";
import { saveRemoteCatalogImageAsset } from "./_lib/blobStore.js";

function ok(req, res) {
  const token = process.env.ADMIN_API_TOKEN || process.env.ADMIN_TOKEN || "";
  if (!token) return true;
  const supplied = req.headers["x-admin-token"] || "";
  if (supplied === token) return true;
  res.status(401).json({ error: "Unauthorized." });
  return false;
}

export default async function handler(req, res) {
  if (setCorsHeaders(req, res, "POST, OPTIONS")) return;
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!ok(req, res)) return;
  try {
    const body = req.body || {};
    const url = await saveRemoteCatalogImageAsset({
      catalogId: body.catalogId,
      kind: body.kind || "asset",
      name: body.name || "catalog-asset",
      imageUrl: body.imageUrl
    });
    return res.status(200).json({ url });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Upload failed." });
  }
}
