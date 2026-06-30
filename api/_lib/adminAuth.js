import crypto from "node:crypto";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function getAdminSecret() {
  return process.env.ADMIN_API_TOKEN || process.env.ADMIN_TOKEN;
}

function signSession(timestamp, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(String(timestamp))
    .digest("hex");
}

export function createAdminSession() {
  const secret = getAdminSecret();
  if (!secret) return "";

  const timestamp = Date.now();
  const signature = signSession(timestamp, secret);
  return `${timestamp}.${signature}`;
}

function isValidAdminSession(sessionToken) {
  const secret = getAdminSecret();
  if (!secret || !sessionToken) return false;

  const [timestampValue, signature] = String(sessionToken).split(".");
  const timestamp = Number(timestampValue);

  if (!timestamp || !signature) return false;
  if (Date.now() - timestamp > SESSION_TTL_MS) return false;

  const expectedSignature = signSession(timestamp, secret);
  if (signature.length !== expectedSignature.length) return false;

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}

export function requireAdmin(req, res) {
  const expectedToken = getAdminSecret();

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
  const sessionToken = req.headers["x-admin-session"];
  const providedToken = bearerToken || headerToken;

  if (providedToken === expectedToken || isValidAdminSession(sessionToken)) {
    return true;
  }

  res.status(401).json({ error: "Unauthorized" });
  return false;
}
