export function requireAdmin(req, res) {
  const expectedToken = process.env.ADMIN_API_TOKEN || process.env.ADMIN_TOKEN;

  if (!expectedToken) {
    res.status(500).json({
      error: "Admin API token is not configured. Set ADMIN_API_TOKEN in Vercel."
    });
    return false;
  }

  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  const headerToken = req.headers["x-admin-token"];
  const providedToken = bearerToken || headerToken;

  if (providedToken !== expectedToken) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  return true;
}
