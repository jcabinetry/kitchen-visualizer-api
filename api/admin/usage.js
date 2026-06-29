import { requireAdmin } from "../_lib/adminAuth.js";
import { setCorsHeaders } from "../_lib/cors.js";
import {
  cleanCompanyKey,
  getCustomerUsage,
  getMonthKey,
  resetCustomerUsage
} from "../_lib/customerStore.js";

export default async function handler(req, res) {
  if (setCorsHeaders(req, res)) return;
  if (!requireAdmin(req, res)) return;

  try {
    const companyKey = cleanCompanyKey(req.query.companyKey || req.body?.companyKey);
    const monthKey = req.query.month || req.body?.month || getMonthKey();

    if (!companyKey) {
      return res.status(400).json({ error: "companyKey is required." });
    }

    if (req.method === "GET") {
      const usage = await getCustomerUsage(companyKey, monthKey);
      return res.status(200).json({ usage });
    }

    if (req.method === "POST") {
      if (req.body?.action !== "reset") {
        return res.status(400).json({ error: "Unsupported usage action." });
      }

      const usage = await resetCustomerUsage(companyKey, monthKey);
      return res.status(200).json({ usage });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Usage request failed." });
  }
}
