export const config = {
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

function buildPrompt(kind, name) {
  const label = kind === "drawer" ? "drawer front" : "cabinet door";
  const oneItem = kind === "drawer" ? "Exactly one drawer front" : "Exactly one cabinet door";
  const noOther = kind === "drawer" ? "No cabinet door" : "No drawer front";
  return `
Create an AI-readable ${label} reference image from the attached catalog photo.

Recreate only the single ${label} shown in the source image${name ? ` for ${name}` : ""}. Do not add any other elements.

Do not design a new style, simplify the ${label}, change its proportions, or add or remove details.

Preserve:
- Overall proportions
- Outer frame width
- Rail and stile widths
- Raised center-panel shape if present
- Recessed inner border if present
- Inside and outside profiles
- Bevel shape and depth
- Outer-edge details
- Position and shape of every existing detail

Make the existing profiles more pronounced and easier to read. Clearly emphasize the outer-edge profile, inside profile, recessed border, raised-panel bevel, and panel depth. Use deeper-looking profile transitions, crisp highlights, and controlled shadows without creating new molding or changing the original design.

Output requirements:
- ${oneItem}
- Straight-on front view
- Centered and fully visible
- Plain white background
- Neutral matte white or very light-gray finish
- No visible wood grain
- Clear studio lighting that reveals profile depth
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

export default async function handler(req, res) {
  if (setCorsHeaders(req, res, "POST, OPTIONS")) return;
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!requireAdmin(req, res)) return;

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY." });
    const body = req.body || {};
    const sourceImage = body.image || "";
    const base64 = stripDataUrl(sourceImage);
    if (!base64) return res.status(400).json({ error: "Upload a catalog image before generating an AI reference." });

    const kind = String(body.kind || "door").toLowerCase() === "drawer" ? "drawer" : "door";
    const mime = getMimeType(sourceImage);
    const form = new FormData();
    form.append("model", "gpt-image-2");
    form.append("prompt", buildPrompt(kind, body.name || ""));
    form.append("size", kind === "drawer" ? "1536x1024" : "1024x1536");
    form.append("quality", "high");
    form.append("image[]", new File([Buffer.from(base64, "base64")], `catalog-${kind}-source.${getExt(mime)}`, { type: mime }));

    const openaiResponse = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });
    const result = await openaiResponse.json().catch(() => ({}));
    if (!openaiResponse.ok) {
      return res.status(openaiResponse.status).json({ error: result?.error?.message || "OpenAI reference generation failed." });
    }

    const imageBase64 = result?.data?.[0]?.b64_json;
    const imageUrl = result?.data?.[0]?.url;
    if (imageBase64) return res.status(200).json({ image: `data:image/png;base64,${imageBase64}` });
    if (imageUrl) return res.status(200).json({ image: imageUrl });
    return res.status(500).json({ error: "No AI reference image returned." });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "AI reference generation failed." });
  }
}
