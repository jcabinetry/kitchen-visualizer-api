export const config = {
  api: {
    bodyParser: {
      sizeLimit: "25mb"
    }
  }
};

const MONTHLY_LIMIT = 200;
const COMPANY_KEY = "johnson-cabinetry";
const COMPANY_NAME = "Johnson Cabinetry & Refacing";
const ALERT_EMAIL_FORM = "https://formspree.io/f/xaqzgvyk";

function stripDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const parts = dataUrl.split(",");
  return parts.length > 1 ? parts[1] : null;
}

function getMimeType(dataUrl, fallback = "image/jpeg") {
  if (!dataUrl || typeof dataUrl !== "string") return fallback;
  const match = dataUrl.match(/^data:(.*?);base64,/);
  return match ? match[1] : fallback;
}

function getExt(mime) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

function getMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

async function redisGet(key) {
  const response = await fetch(
    `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`
      }
    }
  );
  const data = await response.json();
  return data.result;
}

async function redisSet(key, value) {
  await fetch(
    `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`
      }
    }
  );
}

async function redisIncr(key) {
  const response = await fetch(
    `${process.env.KV_REST_API_URL}/incr/${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`
      }
    }
  );
  const data = await response.json();
  return Number(data.result || 0);
}

async function sendLimitEmail({ used, limit, customerName, customerEmail }) {
  const alertSentKey = `visualizer:${COMPANY_KEY}:${getMonthKey()}:limitEmailSent`;
  const alreadySent = await redisGet(alertSentKey);

  if (alreadySent === "yes") return;

  await fetch(ALERT_EMAIL_FORM, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      subject: "Visualizer monthly limit reached",
      company: COMPANY_NAME,
      companyKey: COMPANY_KEY,
      used,
      limit,
      customerName: customerName || "-",
      customerEmail: customerEmail || "-",
      message: `${COMPANY_NAME} has reached the monthly visualizer limit of ${limit} previews.`
    })
  });

  await redisSet(alertSentKey, "yes");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      image,
      mainCustomColorImage,
      islandCustomColorImage,
      color,
      island,
      style,
      upperHeight,
      hardware,
      customerName,
      customerEmail
    } = req.body || {};

    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      return res.status(500).json({ error: "Missing Redis environment variables." });
    }

    const monthKey = getMonthKey();
    const usageKey = `visualizer:${COMPANY_KEY}:${monthKey}:used`;

    const usedNow = Number((await redisGet(usageKey)) || 0);

    if (usedNow >= MONTHLY_LIMIT) {
      await sendLimitEmail({
        used: usedNow,
        limit: MONTHLY_LIMIT,
        customerName,
        customerEmail
      });

      return res.status(403).json({
        error: "This account has reached its monthly preview limit. Please contact Johnson Cabinetry & Refacing to continue using the visualizer.",
        used: usedNow,
        limit: MONTHLY_LIMIT
      });
    }

    if (!image) {
      return res.status(400).json({ error: "Missing kitchen image." });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY." });
    }

    const kitchenBase64 = stripDataUrl(image);
    if (!kitchenBase64) {
      return res.status(400).json({ error: "Invalid kitchen image." });
    }

    const kitchenMime = getMimeType(image, "image/jpeg");
    const kitchenExt = getExt(kitchenMime);

    const hasMainCustom =
      color === "custom main color reference" && !!mainCustomColorImage;

    const hasBaseCustom =
      (island === "custom base cabinet color reference" ||
        island === "custom island color reference") &&
      !!islandCustomColorImage;

    const mainBase64 = hasMainCustom ? stripDataUrl(mainCustomColorImage) : null;
    const baseBase64 = hasBaseCustom ? stripDataUrl(islandCustomColorImage) : null;

    const mainMime = hasMainCustom
      ? getMimeType(mainCustomColorImage, "image/jpeg")
      : "image/jpeg";

    const baseMime = hasBaseCustom
      ? getMimeType(islandCustomColorImage, "image/jpeg")
      : "image/jpeg";

    const mainExt = getExt(mainMime);
    const baseExt = getExt(baseMime);

    const upperColorText = hasMainCustom
      ? "the uploaded upper cabinet reference image"
      : color || "white painted cabinets";

    const baseColorText = hasBaseCustom
      ? "the uploaded base/lower cabinet reference image"
      : island || "the same finish as the upper cabinets";

    const selectedStyle = style || "shaker cabinet doors";
    const selectedUpperHeight =
      upperHeight || "Keep existing upper cabinets exactly as they are.";
    const selectedHardware = hardware || "matte black cabinet pulls";

    const prompt = `
Edit this exact kitchen photo.

This is a cabinet refacing color preview, NOT a remodel.

The original uploaded kitchen photo is the source of truth.

MOST IMPORTANT RULE:
Preserve the exact existing cabinet layout and geometry.

Do NOT:
- redesign the kitchen
- change any door into a drawer
- change any drawer into a door
- add doors
- add drawers
- remove doors
- remove drawers
- change cabinet sizes
- change cabinet positions
- move seams
- move rails
- move stiles
- move face-frame openings
- change appliance openings
- change the camera angle
- change the perspective
- change the room shape

Only change cabinet finish colors and hardware appearance.

CABINET GROUPS:
Treat the cabinets as exactly two finish groups.

GROUP 1: UPPER / WALL CABINETS
Upper cabinets means every cabinet mounted above the countertops.

GROUP 2: BASE / LOWER CABINETS
Base cabinets means every cabinet surface below the countertops across the entire kitchen.

This does NOT mean island only.
This does NOT mean peninsula only.
This does NOT mean only the right-side cabinets.
This means ALL lower cabinets from left to right.

UPPER CABINET FINISH:
Apply this finish to every upper cabinet:
${upperColorText}

BASE / LOWER CABINET FINISH:
Apply this finish to every lower cabinet:
${baseColorText}

Every cabinet below the countertop must match the selected base/lower finish.

DOOR STYLE:
The customer selected this door style:
${selectedStyle}

Use this only as a light visual/profile reference.
Do NOT redraw or restructure the cabinet layout to force the door style.

UPPER CABINET HEIGHT:
${selectedUpperHeight}

HARDWARE:
Use this hardware style:
${selectedHardware}

DO NOT CHANGE countertops, backsplash, appliances, flooring, walls, sink, faucet, windows, trim, decor, lighting, ceiling, room dimensions, camera angle, or perspective.

The result must look like the exact same kitchen photo with the existing cabinets professionally refinished.
`.trim();

    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("prompt", prompt);
    form.append("size", "1536x1024");

    form.append(
      "image[]",
      new File(
        [Buffer.from(kitchenBase64, "base64")],
        `kitchen.${kitchenExt}`,
        { type: kitchenMime }
      )
    );

    if (hasMainCustom && mainBase64) {
      form.append(
        "image[]",
        new File(
          [Buffer.from(mainBase64, "base64")],
          `upper-reference.${mainExt}`,
          { type: mainMime }
        )
      );
    }

    if (hasBaseCustom && baseBase64) {
      form.append(
        "image[]",
        new File(
          [Buffer.from(baseBase64, "base64")],
          `base-reference.${baseExt}`,
          { type: baseMime }
        )
      );
    }

    const openaiResponse = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: form
    });

    const result = await openaiResponse.json();

    if (!openaiResponse.ok) {
      return res.status(openaiResponse.status).json({
        error:
          result?.error?.message ||
          result?.message ||
          "OpenAI image edit failed."
      });
    }

    const imageBase64 = result?.data?.[0]?.b64_json;
    const imageUrl = result?.data?.[0]?.url;

    const updatedUsed = await redisIncr(usageKey);

    if (updatedUsed >= MONTHLY_LIMIT) {
      await sendLimitEmail({
        used: updatedUsed,
        limit: MONTHLY_LIMIT,
        customerName,
        customerEmail
      });
    }

    if (imageBase64) {
      return res.status(200).json({
        image: `data:image/png;base64,${imageBase64}`,
        used: updatedUsed,
        limit: MONTHLY_LIMIT
      });
    }

    if (imageUrl) {
      return res.status(200).json({
        image: imageUrl,
        used: updatedUsed,
        limit: MONTHLY_LIMIT
      });
    }

    return res.status(500).json({
      error: "No image returned from OpenAI."
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Server error."
    });
  }
}
