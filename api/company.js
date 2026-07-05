import { setCorsHeaders } from "./_lib/cors.js";
import { cleanCompanyKey, getCustomer } from "./_lib/customerStore.js";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
}

function publicCompany(customer) {
  const branding = customer.branding || {};

return {
  companyName: customer.companyName || customer.companyKey,
  companyKey: customer.companyKey,
  monthlyLimit: customer.monthlyLimit,
  phone: customer.phone || branding.phone || "",
  email: customer.email || branding.email || branding.contactEmail || "",
  city: customer.city || branding.city || "",
  estimateUrl: customer.estimateUrl || branding.estimateUrl || branding.websiteUrl || "",
  logoUrl: customer.logoUrl || branding.logoUrl || "",
  primaryColor: customer.primaryColor || branding.primaryColor || "#1f2937",
  secondaryColor: customer.secondaryColor || branding.secondaryColor || "#64748b",
  accentColor: customer.accentColor || branding.accentColor || "#2563eb",
  backgroundColor: customer.backgroundColor || branding.backgroundColor || "#f8fafc",
  cardColor: customer.cardColor || branding.cardColor || "#ffffff",
  branding: {
    ...branding,
    primaryColor: customer.primaryColor || branding.primaryColor || "#1f2937",
    secondaryColor: customer.secondaryColor || branding.secondaryColor || "#64748b",
    accentColor: customer.accentColor || branding.accentColor || "#2563eb",
    backgroundColor: customer.backgroundColor || branding.backgroundColor || "#f8fafc",
    cardColor: customer.cardColor || branding.cardColor || "#ffffff"
  },
  ctaText: customer.ctaText || branding.ctaText || "Request an Estimate"
};
}

export default async function handler(req, res) {
  if (setCorsHeaders(req, res)) return;
  setNoStore(res);

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const companyKey = cleanCompanyKey(req.query.companyKey);

    if (!companyKey) {
      return res.status(400).json({ error: "Company key missing." });
    }

    const customer = await getCustomer(companyKey);

    if (!customer) {
      return res.status(404).json({ error: "Company not found." });
    }

    if (customer.status === "archived") {
      return res.status(403).json({ error: "This visualizer is not active." });
    }

    return res.status(200).json(publicCompany(customer));
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Company lookup failed." });
  }
}
