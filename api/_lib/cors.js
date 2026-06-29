export function setCorsHeaders(req, res, methods = "GET, POST, OPTIONS") {
  const allowedOrigin = process.env.ADMIN_ALLOWED_ORIGIN || "*";

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return true;
  }

  return false;
}
