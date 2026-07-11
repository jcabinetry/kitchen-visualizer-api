import { requireAdmin } from "../_lib/adminAuth.js";
import { setCorsHeaders } from "../_lib/cors.js";
import {
  getGenerationRecord,
  listGenerationRecords
} from "../_lib/generationInspectorStore.js";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
}

export default async function handler(req, res) {
  if (setCorsHeaders(req, res, "GET, OPTIONS")) return;
  setNoStore(res);
  if (!requireAdmin(req, res)) return;

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const generationId = String(req.query?.id || "").trim();
    if (generationId) {
      const generation = await getGenerationRecord(generationId);
      if (!generation) return res.status(404).json({ error: "Generation record not found." });
      return res.status(200).json({ generation });
    }

    const generations = await listGenerationRecords(req.query?.limit || 20);
    return res.status(200).json({ generations });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Could not load generation records." });
  }
}
