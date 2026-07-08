import { setCorsHeaders } from "../_lib/cors.js";
import { getDemoPin, isValidDemoType, normalizeDemoType } from "../_lib/demoPinStore.js";

const PERMANENT_DEMO_KEY = "DOOBIE85";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
}

function normalizePin(value) {
  return String(value || "").trim();
}

function normalizePermanentKey(value) {
  return normalizePin(value).replace(/\s+/g, "").toUpperCase();
}

export default async function handler(req, res) {
  if (setCorsHeaders(req, res)) return;
  setNoStore(res);

  if (req.method !== "POST") {
    return res.status(405).json({ valid: false, error: "Method not allowed" });
  }

  try {
    const pin = normalizePin(req.body?.pin);
    const demoType = normalizeDemoType(req.body?.demoType);

    if (!pin || !isValidDemoType(demoType) || demoType === "all") {
      return res.status(400).json({ valid: false, error: "Enter a valid demo PIN." });
    }

    if (normalizePermanentKey(pin) === PERMANENT_DEMO_KEY) {
      return res.status(200).json({ valid: true, demoType, access: "all", permanent: true });
    }

    const demoPin = await getDemoPin(pin);

    if (!demoPin) {
      return res.status(403).json({ valid: false, error: "PIN not found or expired." });
    }

    if (demoPin.demoType !== "all" && demoPin.demoType !== demoType) {
      return res.status(403).json({ valid: false, error: "This PIN is for a different demo." });
    }

    if (demoPin.status !== "active") {
      return res.status(403).json({ valid: false, error: "This PIN is no longer active." });
    }

    if (Date.now() >= new Date(demoPin.expiresAt).getTime()) {
      return res.status(403).json({ valid: false, error: "This PIN has expired." });
    }

    return res.status(200).json({ valid: true, demoType, access: demoPin.demoType, expiresAt: demoPin.expiresAt });
  } catch (error) {
    return res.status(400).json({ valid: false, error: error?.message || "Demo PIN validation failed." });
  }
}
