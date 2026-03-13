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

function base64ToBlob(base64, mimeType = "image/jpeg") {
  const bytes = Buffer.from(base64, "base64");
  return new Blob([bytes], { type: mimeType });
}

function pickMimeType(dataUrl, fallback = "image/jpeg") {
  if (!dataUrl || typeof dataUrl !== "string") return fallback;
  const match = dataUrl.match(/^data:(.*?);base64,/);
  return match?.[1] || fallback;
}

export default async function handler(req, res) {
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

    const kitchenBase64 = stripDataUrl(image);
    if (!kitchenBase64) {
      return res.status(400).json({ error: "Invalid kitchen image." });
    }

    const kitchenMime = pickMimeType(image, "image/jpeg");

    const hasMainCustom =
      color === "custom main color reference" && !!mainCustomColorImage;
    const hasIslandCustom =
      island === "custom island color reference" && !!islandCustomColorImage;

    const mainCustomBase64 = hasMainCustom
      ? stripDataUrl(mainCustomColorImage)
      : null;
    const islandCustomBase64 = hasIslandCustom
      ? stripDataUrl(islandCustomColorImage)
      : null;

    const mainColorInstruction = hasMainCustom
      ? "Use the uploaded main cabinet reference image as the exact target color and finish for the main cabinets. Match that reference as closely as possible."
      : `Use ${color || "white painted cabinets"} for the main cabinets.`;

    const islandColorInstruction = hasIslandCustom
      ? "Use the uploaded island cabinet reference image as the exact target color and finish for the island cabinets. Match that reference as closely as possible."
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
      ? `Use ${hardware}.`
      : "Use matte black cabinet pulls.";

    const prompt = `
Edit this exact kitchen photo and keep the same room layout, cabinet layout, walls, windows, flooring, countertops, backsplash, sink, appliances, ceiling, lighting direction, and camera angle.

Do not redesign the room structure.
Do not move appliances.
Do not change the size or location of cabinets unless upper cabinet extension is selected.
Do not change countertop layout.
Do not change backsplash layout.
Do not create a different kitchen.

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
    form.append("quality", "high");
    form.append("output_format", "png");

    form.append(
      "image[]",
      base64ToBlob(kitchenBase64, kitchenMime),
      "kitchen.jpg"
    );

    if (hasMainCustom && mainCustomBase64) {
      form.append(
        "image[]",
        base64ToBlob(
          mainCustomBase64,
          pickMimeType(mainCustomColorImage, "image/jpeg")
        ),
        "main-reference.jpg"
      );
    }

    if (hasIslandCustom && islandCustomBase64) {
      form.append(
        "image[]",
        base64ToBlob(
          islandCustomBase64,
          pickMimeType(islandCustomColorImage, "image/jpeg")
        ),
        "island-reference.jpg"
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

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) {
      return res.status(500).json({ error: "No image returned from OpenAI." });
    }

    return res.status(200).json({
      image: `data:image/png;base64,${b64}`
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Server error."
    });
  }
}
