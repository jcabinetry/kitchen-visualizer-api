import { requireAdmin } from "../_lib/adminAuth.js";
import { setCorsHeaders } from "../_lib/cors.js";
import {
  createDemoPin,
  isValidDurationHours,
  normalizeDurationHours,
  saveDemoPin
} from "../_lib/demoPinStore.js";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
}

export default async function handler(req, res) {
  if (setCorsHeaders(req, res)) return;
  setNoStore(res);
  if (!requireAdmin(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const durationHours = normalizeDurationHours(req.body?.durationHours);

    if (!isValidDurationHours(durationHours)) {
      return res.status(400).json({ error: "Choose a valid duration." });
    }

    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + durationHours * 60 * 60 * 1000);
    const demoPin = {
      pin: createDemoPin(),
      demoType: "all",
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: "active"
    };

    await saveDemoPin(demoPin);
    return res.status(200).json({ demoPin });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Demo PIN generation failed." });
  }
}
