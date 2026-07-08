import { put } from "@vercel/blob";

function safePart(value) {
  return String(value || "asset")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "asset";
}

function extensionFromType(type) {
  const clean = String(type || "").toLowerCase();
  if (clean.includes("png")) return "png";
  if (clean.includes("webp")) return "webp";
  if (clean.includes("jpeg") || clean.includes("jpg")) return "jpg";
  return "jpg";
}

export async function saveCatalogImageAsset({ catalogId, kind, name, bytes, contentType }) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not configured.");
  }
  if (!bytes) throw new Error("Image bytes are required.");
  const ext = extensionFromType(contentType);
  const filename = [
    "catalogs",
    safePart(catalogId),
    safePart(kind),
    `${safePart(name)}-${Date.now()}.${ext}`
  ].join("/");
  const blob = await put(filename, bytes, {
    access: "public",
    contentType: contentType || "image/jpeg"
  });
  return blob.url;
}

export async function saveRemoteCatalogImageAsset({ catalogId, kind, name, imageUrl }) {
  const response = await fetch(imageUrl, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not download image asset.");
  const contentType = response.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/")) throw new Error("Source is not an image.");
  const bytes = await response.arrayBuffer();
  return saveCatalogImageAsset({ catalogId, kind, name, bytes, contentType });
}
