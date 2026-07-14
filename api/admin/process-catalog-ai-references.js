import { setCorsHeaders } from "../_lib/cors.js";
import { processCatalogAiReferenceJobs } from "../_lib/catalogAiReferenceQueue.js";

export const config = {
  maxDuration: 300
};

function requireRunner(req, res) {
  const required = process.env.ADMIN_API_TOKEN || process.env.ADMIN_TOKEN || "";
  const cronSecret = process.env.CRON_SECRET || "";
  const supplied = req.headers["x-admin-token"] || req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const userAgent = String(req.headers["user-agent"] || "");
  const isCron = req.headers["x-vercel-cron"] === "1" || /vercel-cron/i.test(userAgent);

  if (isCron) return true;
  if (cronSecret && supplied === cronSecret) return true;
  if (required && supplied === required) return true;

  res.status(401).json({ error: "Unauthorized." });
  return false;
}

export default async function handler(req, res) {
  if (setCorsHeaders(req, res, "GET, POST, OPTIONS")) return;
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!requireRunner(req, res)) return;

  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit || req.body?.limit || 1), 3));
    const result = await processCatalogAiReferenceJobs({ limit });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Catalog AI reference processing failed." });
  }
}
