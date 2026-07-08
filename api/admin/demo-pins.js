import { requireAdmin } from "../_lib/adminAuth.js";
import { setCorsHeaders } from "../_lib/cors.js";
import {
  createDemoPin,
  deactivateDemoPin,
  deleteDemoPin,
  isValidDurationHours,
  listDemoPins,
  normalizeDemoPin,
  normalizeDurationHours,
  saveDemoPin
} from "../_lib/demoPinStore.js";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
}

function cleanCompanyName(value) {
  return String(value || "").trim().slice(0, 120);
}

export default async function handler(req, res) {
  if (setCorsHeaders(req, res)) return;
  setNoStore(res);
  if (!requireAdmin(req, res)) return;

  try {
    if (req.method === "GET") {
      const demoPins = await listDemoPins();
      return res.status(200).json({ demoPins });
    }

    if (req.method === "POST") {
      const durationHours = normalizeDurationHours(req.body?.durationHours);
      const companyName = cleanCompanyName(req.body?.companyName);

      if (!isValidDurationHours(durationHours)) {
        return res.status(400).json({ error: "Choose a valid duration." });
      }

      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + durationHours * 60 * 60 * 1000);
      const demoPin = {
        pin: createDemoPin(),
        demoType: "all",
        companyName,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        status: "active"
      };

      await saveDemoPin(demoPin);
      return res.status(200).json({ demoPin });
    }

    if (req.method === "PATCH") {
      const pin = normalizeDemoPin(req.body?.pin);
      const action = String(req.body?.action || "deactivate").trim().toLowerCase();

      if (!pin) return res.status(400).json({ error: "Enter a demo PIN." });
      if (action !== "deactivate") return res.status(400).json({ error: "Unsupported demo PIN action." });

      const demoPin = await deactivateDemoPin(pin);
      return res.status(200).json({ demoPin });
    }

    if (req.method === "DELETE") {
      const pin = normalizeDemoPin(req.body?.pin || req.query?.pin);
      if (!pin) return res.status(400).json({ error: "Enter a demo PIN." });

      const result = await deleteDemoPin(pin);
      return res.status(200).json(result);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Demo PIN request failed." });
  }
}
