import OpenAI from "openai";

export default async function handler(req, res) {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const { image, style } = req.body;

  const prompt = `Transform this kitchen with ${style} cabinet style, modern refacing, new hardware, and updated color. Keep the layout identical.`;

  const result = await client.images.generate({
    model: "gpt-image-1",
    prompt: prompt,
    image: image,
    size: "1024x1024"
  });

  res.status(200).json({
    image: result.data[0].url
  });
}
