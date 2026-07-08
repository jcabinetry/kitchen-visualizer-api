import { setCorsHeaders } from "./_lib/cors.js";
import { put } from "@vercel/blob";

function slug(value) {
  return String(value || "catalog")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "catalog";
}

function requireAdmin(req, res) {
  const required = process.env.ADMIN_API_TOKEN || process.env.ADMIN_TOKEN || "";
  if (!required) return true;
  const supplied = req.headers["x-admin-token"] || req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (supplied === required) return true;
  res.status(401).json({ error: "Unauthorized." });
  return false;
}

function base64ToBuffer(value) {
  const clean = String(value || "").replace(/^data:application\/pdf;base64,/, "");
  return Buffer.from(clean, "base64");
}

export default async function handler(req, res) {
  if (setCorsHeaders(req, res, "POST, OPTIONS")) return;
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!requireAdmin(req, res)) return;

  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN is not configured.");
    const body = req.body || {};
    const catalogName = slug(body.catalogName || "catalog");
    const fileName = slug(String(body.fileName || "catalog").replace(/\.pdf$/i, ""));
    const bytes = base64ToBuffer(body.fileBase64);
    if (!bytes.length) throw new Error("PDF file is required.");
    if (bytes.length > 20 * 1024 * 1024) throw new Error("PDF is too large. Use a public PDF link for files over 20 MB.");

    const blob = await put(`catalog-pdfs/${catalogName}/${fileName}-${Date.now()}.pdf`, bytes, {
      access: "public",
      contentType: "application/pdf"
    });

    return res.status(200).json({ url: blob.url });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "PDF upload failed." });
  }
}
