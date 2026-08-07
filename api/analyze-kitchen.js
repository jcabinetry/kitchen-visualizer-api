import { analyzeCabinetRegions, createCabinetEditMask } from "./_lib/cabinetMask.js";

export const config = {
  maxDuration: 30,
  api: { bodyParser: { sizeLimit: "15mb" } }
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  try {
    const image = req.body?.image;
    if (!image) return res.status(400).json({ error: "Missing kitchen image." });
    const analysis = await analyzeCabinetRegions(image);
    const [mask, upperMask, baseMask] = await Promise.all([
      createCabinetEditMask(image, analysis.regions),
      createCabinetEditMask(image, analysis.regions.filter(region => region.group === "upper")),
      createCabinetEditMask(image, analysis.regions.filter(region => region.group === "base"))
    ]);
    return res.status(200).json({ mask, upperMask, baseMask, regions: analysis.regions, faceCount: analysis.faceCount });
  } catch (error) {
    const message = error?.name === "AbortError" ? "Kitchen analysis timed out. Upload the photo again." : (error?.message || "Kitchen analysis failed.");
    return res.status(500).json({ error: message });
  }
}
