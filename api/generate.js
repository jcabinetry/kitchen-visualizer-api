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
    const { image, color, style } = req.body || {};

    if (!image) {
      return res.status(400).json({ error: "Missing image" });
    }

    const prompt = `Edit this exact kitchen photo. Keep the same room layout, walls, windows, countertops, backsplash, flooring, appliances, sink, lighting, and camera angle. Only change the cabinet doors, drawer fronts, cabinet finish, and cabinet style. Use ${color}. Use ${style}. Make it look photorealistic and like the same kitchen, not a different kitchen.`;

    const openaiResponse = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        images: [
          {
            image_url: image
          }
        ],
        prompt,
        size: "1024x1024"
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
