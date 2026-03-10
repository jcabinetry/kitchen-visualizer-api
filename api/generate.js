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
      hardware,
      mainReferenceType,
      islandReferenceType
    } = req.body || {};

    if (!image) {
      return res.status(400).json({ error: "Missing kitchen image" });
    }

    const using_custom_main = color === "custom_main_color_reference";
    const using_custom_island = island === "custom_island_color_reference";

    if (using_custom_main && !mainCustomColorImage) {
      return res.status(400).json({
        error: "Missing main cabinet finish reference image"
      });
    }

    if (using_custom_island && !islandCustomColorImage) {
      return res.status(400).json({
        error: "Missing island finish reference image"
      });
    }

    const main_color_instruction = using_custom_main
      ? mainReferenceType === "wood finish"
        ? "Match the main cabinets to the uploaded main cabinet reference image as a stained wood cabinet finish. Preserve visible wood grain, wood tone, and stain character. Do not interpret it as painted cabinets."
        : "Match the main cabinets to the uploaded main cabinet reference image as a smooth painted cabinet finish. Do not show visible wood grain."
      : `Use ${color} for the main cabinets.`;

    const island_instruction = using_custom_island
      ? islandReferenceType === "wood finish"
        ? "If the kitchen has an island, match the island cabinetry to the uploaded island reference image as a stained wood cabinet finish. Preserve visible wood grain, wood tone, and stain character. Do not interpret it as painted cabinets."
        : "If the kitchen has an island, match the island cabinetry to the uploaded island reference image as a smooth painted cabinet finish. Do not show visible wood grain."
      : island
        ? `If the kitchen has an island, change only the island cabinetry to ${island}.`
        : "If the kitchen has an island, keep the island the same finish as the main cabinets.";

    const upper_height_instruction =
      upperHeight === "extend upper cabinets to ceiling"
        ? "Extend the existing upper cabinets vertically to the ceiling. Keep the same kitchen layout and make it look natural and realistic."
        : "Keep the existing upper cabinets exactly as they are.";

    const hardware_instruction = hardware
      ? `Use ${hardware} hardware on visible cabinet doors and drawer fronts.`
      : "Keep the existing cabinet hardware.";

    const prompt = `Edit this exact kitchen photo. Keep the same room layout, walls, windows, countertops, backsplash, flooring, appliances, sink, lighting, ceiling, and camera angle. Only change cabinet finish, island finish if applicable, cabinet door style, upper cabinets only if requested, and cabinet hardware. ${main_color_instruction} Door style should be ${style}. ${upper_height_instruction} ${island_instruction} ${hardware_instruction} Keep the same kitchen and make the result photorealistic. If a custom reference is marked as paint finish, use a smooth painted cabinet finish with no visible wood grain. If a custom reference is marked as wood finish, use a stained wood cabinet finish with visible natural wood grain. Do not redesign the room. Do not move or replace appliances. Do not change floors, counters, backsplash, walls, or lighting.`;

    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        images: [
          { image_url: image }
        ],
        prompt: prompt,
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

    const image_object = data?.data?.[0];

    if (!image_object) {
      return res.status(500).json({ error: "No image returned." });
    }

    if (image_object.b64_json) {
      return res.status(200).json({
        image: `data:image/png;base64,${image_object.b64_json}`
      });
    }

    if (image_object.url) {
      return res.status(200).json({
        image: image_object.url
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
