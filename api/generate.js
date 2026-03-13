export const config = {
  api: {
    bodyParser: {
      sizeLimit: "25mb"
    }
  }
};

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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

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
      hardware
    } = req.body || {};

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

    const hasIslandCustom =
      island === "custom island color reference" && !!islandCustomColorImage;

    const mainBase64 = hasMainCustom ? stripDataUrl(mainCustomColorImage) : null;
    const islandBase64 = hasIslandCustom ? stripDataUrl(islandCustomColorImage) : null;

    const mainMime = hasMainCustom ? getMimeType(mainCustomColorImage, "image/jpeg") : "image/jpeg";
    const islandMime = hasIslandCustom ? getMimeType(islandCustomColorImage, "image/jpeg") : "image/jpeg";

    const mainExt = getExt(mainMime);
    const islandExt = getExt(islandMime);

    const mainColorInstruction = hasMainCustom
      ? "Use the uploaded main cabinet reference image as the exact target color and finish for the main cabinets. Match that uploaded reference as closely as possible. Prioritize the uploaded reference over any generic interpretation."
      : `Use ${color || "white painted cabinets"} for the main cabinets.`;

    const islandColorInstruction = hasIslandCustom
      ? "Use the uploaded island cabinet reference image as the exact target color and finish for the island cabinets. Match that uploaded reference as closely as possible. Prioritize the uploaded reference over any generic interpretation."
      : island
        ? `Use ${island} for the island cabinets.`
        : "Use the same finish as the main cabinets for the island cabinets.";

    const doorInstruction = style
      ? `Use ${style} for the cabinet doors.`
      : "Use shaker cabinet doors.";

    const upperInstruction = upperHeight
      ? `${upperHeight}.`
      : "Keep existing upper cabinets exactly as they are.";

    const hardwareInstruction = hardware
      ? `Use ${hardware} for the cabinet hardware.`
      : "Use matte black cabinet pulls for the cabinet hardware.";

    const prompt = `
Edit this exact kitchen photo and keep the same room layout, cabinet layout, walls, windows, flooring, countertops, backsplash, sink, appliances, ceiling, lighting direction, and camera angle.

Do not redesign the room structure.
Do not move appliances.
Do not change countertop layout.
Do not change backsplash layout.
Do not create a different kitchen.
Do not change cabinet sizes or positions unless upper cabinet extension is selected.

Only change cabinet finish, island finish, cabinet door style, cabinet hardware, and upper cabinet height if selected.

${mainColorInstruction}
${islandColorInstruction}
${doorInstruction}
${upperInstruction}
${hardwareInstruction}

If a natural wood finish is selected, preserve realistic wood grain, stain depth, and species character.
If a custom reference image is provided, prioritize matching that uploaded reference image over generic color interpretation.
Make the result photorealistic and believable as a real cabinet refacing or kitchen remodel preview.
Keep this the same kitchen, not a different kitchen.
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
          `main-reference.${mainExt}`,
          { type: mainMime }
        )
      );
    }

    if (hasIslandCustom && islandBase64) {
      form.append(
        "image[]",
        new File(
          [Buffer.from(islandBase64, "base64")],
          `island-reference.${islandExt}`,
          { type: islandMime }
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
        error: result?.error?.message || result?.message || "OpenAI image edit failed."
      });
    }

    const imageBase64 = result?.data?.[0]?.b64_json;
    const imageUrl = result?.data?.[0]?.url;

    if (imageBase64) {
      return res.status(200).json({
        image: `data:image/png;base64,${imageBase64}`
      });
    }

    if (imageUrl) {
      return res.status(200).json({
        image: imageUrl
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
