export const config = {
  maxDuration: 300,
  api: {
    bodyParser: {
      sizeLimit: "20mb"
    }
  }
};

import { setCorsHeaders } from "./_lib/cors.js";

function requireAdmin(req, res) {
  const required = process.env.ADMIN_API_TOKEN || process.env.ADMIN_TOKEN || "";
  if (!required) return true;
  const supplied = req.headers["x-admin-token"] || req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (supplied === required) return true;
  res.status(401).json({ error: "Unauthorized." });
  return false;
}

function stripDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return "";
  const parts = dataUrl.split(",");
  return parts.length > 1 ? parts[1] : "";
}

function getMimeType(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(.*?);base64,/);
  return match ? match[1] : "image/jpeg";
}

function getExt(mime) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

function normalizeConstructionType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (type === "raised" || type === "raised-panel" || type === "raised panel") return "raised";
  if (type === "inset" || type === "recessed" || type === "recessed-panel" || type === "inset-panel") return "inset";
  if (type === "slab" || type === "flat" || type === "flat-panel") return "slab";
  return "";
}

function constructionRequirements(kind, type) {
  const subject = kind === "drawer" ? "drawer front" : "cabinet door";
  if (type === "raised") {
    return `CATALOG CONSTRUCTION: ${subject.toUpperCase()} = RAISED PANEL. Create a pronounced center panel whose face visibly projects forward from the surrounding inner profile. Preserve the source's exact panel outline, bevel path, transition widths, rail and stile proportions, and edge details. Use clear highlights on the forward face and contact shadows along the sloped or stepped transition so the positive relief is unmistakable. Never make the center panel recessed, inset, flat, or a shallow decorative outline.`;
  }
  if (type === "inset") {
    return `CATALOG CONSTRUCTION: ${subject.toUpperCase()} = INSET / RECESSED PANEL. Create a center panel that visibly sits behind the surrounding frame and inner profile. Preserve the source's exact panel outline, inset depth, transition widths, rail and stile proportions, and edge details. Use clear shadowing inside the recessed transition so the negative relief is unmistakable. Never make the center panel raised, forward-projecting, slab-like, or a shallow decorative outline.`;
  }
  if (type === "slab") {
    return `CATALOG CONSTRUCTION: ${subject.toUpperCase()} = SLAB. Create one continuous uninterrupted face with only the source's exact perimeter thickness, outer-edge profile, bevel, and corner treatment. Do not add rails, stiles, a center panel, an inner frame, recessed borders, raised borders, applied molding, or decorative outlines.`;
  }
  return `No construction classification was supplied. Preserve only the depth direction and geometry that are clearly visible in the source image; do not invent a raised panel, recessed panel, frame, or molding.`;
}

function buildPrompt(kind, name, constructionType) {
  const label = kind === "drawer" ? "drawer front" : "cabinet door";
  const oneItem = kind === "drawer" ? "Exactly one wide, short drawer front" : "Exactly one cabinet door";
  const noOther = kind === "drawer" ? "No cabinet door" : "No drawer front";
  const type = normalizeConstructionType(constructionType);
  const proportions = kind === "drawer"
    ? "Keep the source's exact wide horizontal proportions and short height. Do not stretch it into a cabinet door or add tall door geometry."
    : "Keep the source's exact vertical proportions, outer contour, frame widths, and rail-to-stile relationships.";
  return `
Create an AI-readable ${label} reference image from the attached catalog photo.

Recreate only the single ${label} shown in the source image${name ? ` for ${name}` : ""}. Do not add any other elements.

The administrator-supplied construction classification controls whether the face relief projects forward, sits behind the frame, or remains a continuous slab. If source lighting makes the depth direction ambiguous, follow this classification while using the source for the exact visible design.

${constructionRequirements(kind, type)}

${proportions}

Do not design a new style, simplify the ${label}, change its proportions, or add or remove details that are not required by the construction classification.

Preserve:
- Overall proportions
- Outer contour and silhouette
- Construction-specific geometry described above
- Perimeter thickness, outer-edge profile, and permitted bevel shape
- Outer-edge details
- Position and shape of every detail permitted by the construction classification

Make the classified construction and existing profiles easy to read without creating new molding or changing the source design.

Output requirements:
- ${oneItem}
- Straight-on front view
- Centered and fully visible
- Plain dark-neutral gray background that clearly separates the object silhouette
- Neutral matte medium-light gray object finish
- No visible wood grain
- Directional raking studio light from the upper left with soft fill, producing crisp, physically correct highlights and shadows that reveal whether each surface projects forward or recedes
- No perspective angle
- No room, countertop, or cabinet box
- ${noOther}
- No handles, knobs, hinges, or hardware
- No text, labels, logos, or watermark
- No props or additional objects

Geometry accuracy is more important than color or styling.
Return only the finished image.
`.trim();
}

export async function generateCatalogReferenceImage({ kind = "door", name = "", image = "", constructionType = "" } = {}) {
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY.");
  const sourceImage = image || "";
  const base64 = stripDataUrl(sourceImage);
  if (!base64) throw new Error("Upload a catalog image before generating an AI reference.");

  const safeKind = String(kind || "door").toLowerCase() === "drawer" ? "drawer" : "door";
  const mime = getMimeType(sourceImage);
  const form = new FormData();
  form.append("model", "gpt-image-2");
  form.append("prompt", buildPrompt(safeKind, name || "", constructionType));
  form.append("size", safeKind === "drawer" ? "1536x1024" : "1024x1536");
  form.append("quality", "high");
  form.append("image[]", new File([Buffer.from(base64, "base64")], `catalog-${safeKind}-source.${getExt(mime)}`, { type: mime }));

  const openaiResponse = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form
  });
  const result = await openaiResponse.json().catch(() => ({}));
  if (!openaiResponse.ok) {
    throw new Error(result?.error?.message || "OpenAI reference generation failed.");
  }

  const imageBase64 = result?.data?.[0]?.b64_json;
  const imageUrl = result?.data?.[0]?.url;
  if (imageBase64) return `data:image/png;base64,${imageBase64}`;
  if (imageUrl) return imageUrl;
  throw new Error("No AI reference image returned.");
}

export default async function handler(req, res) {
  if (setCorsHeaders(req, res, "POST, OPTIONS")) return;
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!requireAdmin(req, res)) return;

  try {
    const body = req.body || {};
    const image = await generateCatalogReferenceImage({
      kind: body.kind || "door",
      name: body.name || "",
      image: body.image || "",
      constructionType: body.constructionType || ""
    });
    return res.status(200).json({ image });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "AI reference generation failed." });
  }
}
