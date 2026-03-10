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
      style,
      island,
      upperHeight,
      hardware
    } = req.body || {};

    if (!image) {
      return res.status(400).json({ error: "Missing kitchen image" });
    }

    const usingCustomMain = color === "custom main color reference";
    const usingCustomIsland = island === "custom island color reference";

    if (usingCustomMain && !mainCustomColorImage) {
      return res.status(400).json({
        error: "Missing main cabinet finish reference image"
      });
    }

    if (usingCustomIsland && !islandCustomColorImage) {
      return res.status(400).json({
        error: "Missing island finish reference image"
      });
    }

    const images = [
      { image_url: image }
    ];

    if (usingCustomMain && mainCustomColorImage) {
      images.push({ image_url: mainCustomColorImage });
    }

    if (usingCustomIsland && islandCustomColorImage) {
      images.push({ image_url: islandCustomColorImage });
    }

    const mainColorInstruction = usingCustomMain
      ? "Use the uploaded main cabinet reference image as the exact finish reference for the main cabinets. Match the tone, depth, warmth, and wood character as closely as possible. If the reference shows stained wood, keep visible natural wood grain. If the reference shows a smooth painted finish, do not add wood grain."
      : `Use ${color} for the main cabinets.`;

    const islandInstruction = usingCustomIsland
      ? "If the kitchen has an island, use the uploaded island reference image as the exact finish reference for the island cabinetry. Match the tone, depth, warmth, and wood character as closely as possible. If the reference shows stained wood, keep visible natural wood grain. If the reference shows a smooth painted finish, do not add wood grain."
      : island
        ? `If the kitchen has an island, change only the island cabinetry to ${island}.`
        : "If the kitchen has an island, keep the island the same finish as the main cabinets.";

    const upperHeightInstruction =
      upperHeight === "extend upper cabinets to ceiling"
        ? "Extend the existing upper cabinets vertically to the ceiling. Keep the same kitchen layout and make it look natural and realistic."
        : "Keep the existing upper cabinets exactly as they are.";

    const hardwareInstruction = hardware
      ? `Use ${hardware} hardware on visible cabinet doors and drawer fronts.`
      : "Keep the existing cabinet hardware.";

    const prompt = `
Edit this exact kitchen photo.

The first uploaded image is the kitchen to edit.
If additional uploaded images are included, they are finish reference images for the cabinetry.

Keep the same room layout, walls, windows, countertops, backsplash, flooring, appliances, sink, lighting, ceiling, and camera angle.
Do not redesign the room.
Do not move or replace appliances.
Do not change floors, counters, backsplash, walls, or lighting.

Only change:
cabinet finish,
island finish if applicable,
cabinet door style,
upper cabinets only if requested,
and cabinet hardware.

${mainColorInstruction}
Door style should be ${style}.
${upperHeightInstruction}
${islandInstruction}
${hardwareInstruction}

Important:
If a reference image shows dark stained rustic wood, apply that as a realistic stained wood cabinet finish, not paint.
If a reference image shows smooth painted color, apply smooth painted cabinetry with no wood grain.
Keep the result photorealistic and make it look like this same kitchen, just updated.
`;

    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        images,
        prompt,
        size: "1536x1024"
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "OpenAI image edit failed",
        details: data
      });
    }

    const imageObject = data?.data?.[0];

    if (!imageObject) {
      return res.status(500).json({ error: "No image returned." });
    }

    if (imageObject.b64_json) {
      return res.status(200).json({
        image: `data:image/png;base64,${imageObject.b64_json}`
      });
    }

    if (imageObject.url) {
      return res.status(200).json({
        image: imageObject.url
      });
    }

    return res.status(500).json({
      error: "Image response format not recognized."
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error.",
      details: String(error)
    });
  }
}
