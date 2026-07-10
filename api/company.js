import { setCorsHeaders } from "./_lib/cors.js";
import { cleanCompanyKey, getCustomer } from "./_lib/customerStore.js";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
}

function publicCompany(customer) {
  const branding = customer.branding || {};
  const publicData = customer.public || {};

  const phone = customer.phone || customer.contact?.phone || branding.phone || "";
  const email = customer.email || customer.contact?.email || branding.email || branding.contactEmail || "";
  const city = customer.city || customer.address?.city || branding.city || "";
  const websiteUrl = publicData.websiteUrl || customer.websiteUrl || customer.customerPageUrl || branding.websiteUrl || branding.customerPageUrl || "";
  const estimateUrl = publicData.estimateUrl || customer.estimateUrl || branding.estimateUrl || websiteUrl || "";
  const logoUrl = customer.logoUrl || branding.logoUrl || "";
  const primaryColor = customer.primaryColor || branding.primaryColor || "#1f2937";
  const secondaryColor = customer.secondaryColor || branding.secondaryColor || "#64748b";
  const accentColor = customer.accentColor || branding.accentColor || "#2563eb";
  const backgroundColor = customer.backgroundColor || branding.backgroundColor || "#f8fafc";
  const cardColor = customer.cardColor || branding.cardColor || "#ffffff";
  const ctaText = customer.ctaText || branding.ctaText || branding.buttonText || "Request an Estimate";

  return {
    companyName: customer.companyName || customer.companyKey,
    companyKey: customer.companyKey,
    monthlyLimit: customer.monthlyLimit,
    phone,
    email,
    city,
    websiteUrl,
    customerPageUrl: websiteUrl,
    estimateUrl,
    logoUrl,
    primaryColor,
    secondaryColor,
    accentColor,
    backgroundColor,
    cardColor,
    catalogSelections: Array.isArray(customer.catalogSelections) ? customer.catalogSelections : [],
    selectedCatalogs: Array.isArray(customer.selectedCatalogs) ? customer.selectedCatalogs : [],
    branding: {
      logoUrl,
      primaryColor,
      secondaryColor,
      accentColor,
      backgroundColor,
      cardColor,
      websiteUrl,
      customerPageUrl: websiteUrl,
      estimateUrl,
      contactEmail: email,
      email,
      phone,
      city,
      ctaText,
      buttonText: ctaText
    },
    ctaText
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
