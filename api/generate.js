export const config = {
  api: {
    bodyParser: {
      sizeLimit: "25mb"
    }
  }
};

const DEFAULT_MONTHLY_LIMIT = 200;
const ALERT_EMAIL_FORM = "https://formspree.io/f/xaqzgvyk";

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    throw new Error("Missing Upstash Redis environment variables. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel.");
  }

  if (!url.startsWith("https://")) {
    throw new Error("UPSTASH_REDIS_REST_URL must be the Upstash REST URL that starts with https://. It looks like the token may have been pasted into the URL field.");
  }

  if (token.startsWith("https://")) {
    throw new Error("UPSTASH_REDIS_REST_TOKEN must be the Upstash REST token, not the REST URL. It looks like the URL may have been pasted into the token field.");
  }

  return { url, token };
}

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

function cleanKey(value) {
  return String(value || "default-company")
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

async function redisGet(key) {
  const redis = getRedisConfig();
  const response = await fetch(
    `${redis.url}/get/${encodeURIComponent(key)}`,
    {
      headers: {
        Authorization: `Bearer ${redis.token}`
      }
    }
  );

  const data = await response.json();
  return data.result;
}

async function redisSet(key, value) {
  const redis = getRedisConfig();
  await fetch(
    `${redis.url}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redis.token}`
      }
    }
  );
}

async function redisIncr(key) {
  const redis = getRedisConfig();
  const response = await fetch(
    `${redis.url}/incr/${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redis.token}`
      }
    }
  );

  const data = await response.json();
  return Number(data.result || 0);
}

async function sendLimitEmail({
  companyKey,
  companyName,
  used,
  limit,
  customerName,
  customerEmail,
  customerPhone
}) {
  const alertSentKey = `visualizer:${companyKey}:${getMonthKey()}:limitEmailSent`;
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
      company: companyName,
      companyKey,
      used,
      limit,
      customerName: customerName || "-",
      customerEmail: customerEmail || "-",
      customerPhone: customerPhone || "-",
      message: `${companyName} has reached the monthly visualizer limit of ${limit} previews.`
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
      countertop,
      backsplash,
      flooring,

      companyKey,
      companyName,
      monthlyLimit,

      customerName,
      customerEmail,
      customerPhone
    } = req.body || {};

    getRedisConfig();

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "Missing OPENAI_API_KEY."
      });
    }

    const safeCompanyKey = cleanKey(companyKey);
    const safeCompanyName = companyName || safeCompanyKey;
    const safeMonthlyLimit = Math.max(
      1,
      parseInt(monthlyLimit ?? DEFAULT_MONTHLY_LIMIT, 10) || DEFAULT_MONTHLY_LIMIT
    );

    const monthKey = getMonthKey();
    const usageKey = `visualizer:${safeCompanyKey}:${monthKey}:used`;

    const usedNow = Number((await redisGet(usageKey)) || 0);

    console.log({
      companyKey: safeCompanyKey,
      limit: safeMonthlyLimit,
      usedNow
    });

    if (usedNow >= safeMonthlyLimit) {
      sendLimitEmail({
        companyKey: safeCompanyKey,
        companyName: safeCompanyName,
        used: usedNow,
        limit: safeMonthlyLimit,
        customerName,
        customerEmail,
        customerPhone
      }).catch(function(err) {
        console.log("Limit email failed:", err?.message || err);
      });

      return res.status(403).json({
        error: "This account has reached its monthly preview limit. Please contact support to continue using the visualizer.",
        used: usedNow,
        limit: safeMonthlyLimit
      });
    }

    if (!image) {
      return res.status(400).json({ error: "Missing kitchen image." });
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

    const mainBase64 = hasMainCustom
      ? stripDataUrl(mainCustomColorImage)
      : null;

    const baseBase64 = hasBaseCustom
      ? stripDataUrl(islandCustomColorImage)
      : null;

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

    const selectedCountertop = countertop || "";
    const selectedBacksplash = backsplash || "";
    const selectedFlooring = flooring || "";

    const countertopInstruction = selectedCountertop
      ? `Replace only the visible countertop surfaces with ${selectedCountertop}. Preserve the exact countertop shape, edge, thickness, overhang, sink cutout, appliance openings, seams, shadows, and layout.`
      : "Keep the existing countertops unchanged.";

    const backsplashInstruction = selectedBacksplash
      ? `Replace only the visible backsplash area with ${selectedBacksplash}. Preserve outlets, windows, trim, cabinets, countertops, wall layout, shadows, and perspective.`
      : "Keep the existing backsplash unchanged.";

    const flooringInstruction = selectedFlooring
      ? `Replace only the visible flooring with ${selectedFlooring}. Preserve the floor perspective, plank or tile scale, shadows, cabinets, appliances, furniture, rugs, walls, and room layout.`
      : "Keep the existing flooring unchanged.";

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

Only change cabinet finish colors, hardware appearance, and the countertop, backsplash, or flooring only when those options are selected.

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

This includes:
- every upper cabinet door
- every upper cabinet side panel
- every upper face frame
- every upper rail
- every upper stile
- every upper filler strip
- every upper cabinet trim piece

BASE / LOWER CABINET FINISH:
Apply this finish to every lower cabinet:
${baseColorText}

This includes:
- every lower cabinet door
- every lower drawer front
- every drawer stack
- every sink base door
- every range-side lower cabinet
- every dishwasher-side lower panel
- every exposed side panel
- every exposed end panel
- every lower face frame
- every lower rail
- every lower stile
- every lower filler strip
- every toe kick
- every island cabinet
- every peninsula cabinet
- every lower cabinet trim piece

BASE CABINET CONSISTENCY:
Every cabinet below the countertop must match the selected base/lower finish.

Do not leave any lower cabinet door in the old finish.
Do not leave any lower drawer front in the old finish.
Do not leave any lower face frame in the old finish.
Do not leave any toe kick in the old finish.
Do not leave any exposed side panel in the old finish.
Do not leave any left-side lower cabinet in the old finish.
Do not leave any sink-base lower cabinet in the old finish.
Do not leave any range-side lower cabinet in the old finish.
Do not leave any dishwasher-side lower cabinet in the old finish.

The entire lower cabinet run must look professionally refinished together as one continuous cabinet group.

DOOR STYLE:
The customer selected this door style:
${selectedStyle}

Use this only as a light visual/profile reference.

Do NOT redraw or restructure the cabinet layout to force the door style.
Do NOT change the number of cabinet doors.
Do NOT change the number of drawer fronts.
Do NOT change the size or position of doors or drawers.

If applying the selected door style would change the original layout, preserve the original layout instead.

UPPER CABINET HEIGHT:
${selectedUpperHeight}

Only follow this if it can be done without changing the rest of the kitchen layout.

HARDWARE:
Use this hardware style:
${selectedHardware}

Keep hardware placement close to the original layout.

COUNTERTOP INSTRUCTION:
${countertopInstruction}

BACKSPLASH INSTRUCTION:
${backsplashInstruction}

FLOORING INSTRUCTION:
${flooringInstruction}

IMPORTANT MATERIAL RULE:
If countertops, backsplash, or flooring are set to Keep Existing or are blank, leave that surface unchanged.
If a new countertop, backsplash, or flooring option is selected, change only that selected surface and preserve everything else.

DO NOT CHANGE:
- appliances
- walls except the selected backsplash area if backsplash is selected
- sink
- faucet
- windows
- trim
- decor
- lighting
- ceiling
- room dimensions
- camera angle
- perspective

FINAL SELF-CHECK:
Before final output, inspect every cabinet below the countertop from left to right.

If any lower cabinet door, drawer front, panel, frame, filler, toe kick, or exposed side is still the original finish, recolor it to the selected base/lower finish before finalizing.

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

    if (updatedUsed >= safeMonthlyLimit) {
      await sendLimitEmail({
        companyKey: safeCompanyKey,
        companyName: safeCompanyName,
        used: updatedUsed,
        limit: safeMonthlyLimit,
        customerName,
        customerEmail,
        customerPhone
      });
    }

    if (imageBase64) {
      return res.status(200).json({
        image: `data:image/png;base64,${imageBase64}`,
        used: updatedUsed,
        limit: safeMonthlyLimit
      });
    }

    if (imageUrl) {
      return res.status(200).json({
        image: imageUrl,
        used: updatedUsed,
        limit: safeMonthlyLimit
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
