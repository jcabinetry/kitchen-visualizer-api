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
    const { image, color, style, island, hardware } = req.body || {};

    if (!image) {
      return res.status(400).json({ error: "Missing image" });
    }

    const islandInstruction = island
      ? `If the kitchen has an island, change only the island cabinetry to ${island}.`
      : `If the kitchen has an island, keep the island the same finish as the main cabinets unless it already matches naturally.`;

    const hardwareInstruction = hardware
      ? `Use ${hardware} hardware on the cabinet doors and drawer fronts where hardware is visible.`
      : `Keep the existing cabinet hardware style and finish.`;

    const prompt = `Edit this exact kitchen photo. Keep the same room layout, walls, windows, countertops, backsplash, flooring, appliances, sink, lighting, ceiling, and camera angle. Only change the cabinet doors, drawer fronts, cabinet finish, cabinet door style, and cabinet hardware. Use ${color} for the main cabinets. Use ${style}. ${islandInstruction} ${hardwareInstruction} Make it photorealistic and look like the same kitchen, not a different kitchen. Do not redesign the room. Do not move or replace appliances. Do not change counters, floors, walls, or lighting.`;

    const openaiResponse = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        images: [image],
        prompt: prompt,
        size: "1536x1024"
      })
    });

    const data = await openaiResponse.json();

    if (!openaiResponse.ok) {
      return res.status(openaiResponse.status).json({
        error: data?.error?.message || "OpenAI image edit failed",
        details: data
      });
    }

    const imageObject = data?.data?.[0];

    if (!imageObject) {
      return res.status(500).json({ error: "No image returned from OpenAI" });
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

    return res.status(500).json({ error: "Image response format not recognized" });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: String(error)
    });
  }
}
