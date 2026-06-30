import { setCorsHeaders } from "../_lib/cors.js";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
}

export default async function handler(req, res) {
  if (setCorsHeaders(req, res)) return;
  setNoStore(res);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const expectedPassword = process.env.ADMIN_PASSWORD_LOG_IN_API_TOKEN;

  if (!expectedPassword) {
    return res.status(500).json({
      error: "Admin login password is not configured. Set ADMIN_PASSWORD_LOG_IN_API_TOKEN in Vercel."
    });
  }

  const providedPassword = String(req.body?.password || "").trim();

  if (providedPassword !== expectedPassword) {
    return res.status(401).json({ error: "Wrong admin password." });
  }

  return res.status(200).json({ success: true });
}
