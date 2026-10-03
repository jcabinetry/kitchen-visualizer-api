import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function text(value, fallback = "") {
  const s = String(value ?? "").trim();
  return s || fallback;
}

function esc(value) {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function money(value) {
  const n = Number(value) || 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(n);
}

function rows(items = []) {
  return items
    .filter((x) => Number(x.qty) > 0)
    .map((x) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${esc(x.name)}</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${esc(x.qty)}</td></tr>`)
    .join("");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const p = req.body || {};
    const customerEmail = text(p.customer?.email);
    const customerName = text(p.customer?.name, "Customer");

    if (!customerEmail || !customerEmail.includes("@")) {
      return res.status(400).json({ error: "Enter a valid customer email address first." });
    }

    const totals = p.totals || {};
    const customerHtml = `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937;max-width:700px;margin:auto;">
        <h2 style="color:#173a57;margin-bottom:4px;">Johnson Cabinetry &amp; Refacing</h2>
        <p style="margin-top:0;color:#6b7280;">Estimate for ${esc(customerName)}</p>
        ${p.customer?.address ? `<p><strong>Project:</strong> ${esc(p.customer.address)} ${esc(p.customer.cityZip || "")}</p>` : ""}
        <h3 style="color:#173a57;">Your 4 Refacing Price Options</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:10px;border-bottom:1px solid #e5e7eb;"><strong>Thermofoil</strong></td><td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;">${money(totals.thermo)}</td></tr>
          <tr><td style="padding:10px;border-bottom:1px solid #e5e7eb;"><strong>Group 1</strong><br><span style="color:#6b7280;font-size:12px;">Alder, Beech &amp; Paint Grade Hardwood</span></td><td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;">${money(totals.g1)}</td></tr>
          <tr><td style="padding:10px;border-bottom:1px solid #e5e7eb;"><strong>Group 2</strong><br><span style="color:#6b7280;font-size:12px;">Red Oak, Hickory &amp; Farmhouse Chic</span></td><td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;">${money(totals.g2)}</td></tr>
          <tr><td style="padding:10px;"><strong>Group 3</strong><br><span style="color:#6b7280;font-size:12px;">Maple, Cherry &amp; White Oak</span></td><td style="padding:10px;text-align:right;font-weight:700;">${money(totals.g3)}</td></tr>
        </table>
        <h3 style="color:#173a57;">Included Work</h3>
        <p><strong>Countertops:</strong> ${money(p.sections?.countertops)}</p>
        <p><strong>Pull-Out Shelves:</strong> ${money(p.sections?.pullouts)}</p>
        <p><strong>Other Services:</strong> ${money(p.sections?.extras)}</p>
        ${p.customerNotes ? `<p><strong>Notes:</strong><br>${esc(p.customerNotes).replace(/\n/g, "<br>")}</p>` : ""}
        <p style="margin-top:24px;">Questions or ready to move forward? Contact Johnson Cabinetry &amp; Refacing.</p>
        <p>970-652-0240<br>www.jcabinetry.com</p>
        <p style="font-size:12px;color:#6b7280;">This is an estimate and may be revised if field conditions or scope change.</p>
      </div>
    `;

    const internalHtml = `
      <div style="font-family:Arial,sans-serif;line-height:1.45;color:#111827;max-width:800px;margin:auto;">
        <h2>JCR Internal Estimate Record</h2>
        <p><strong>Date:</strong> ${esc(p.savedAt || new Date().toISOString())}</p>
        <p><strong>Customer:</strong> ${esc(customerName)}<br>
        <strong>Address:</strong> ${esc(p.customer?.address)} ${esc(p.customer?.cityZip)}<br>
        <strong>Phone:</strong> ${esc(p.customer?.phone)}<br>
        <strong>Email:</strong> ${esc(customerEmail)}<br>
        <strong>Salesperson:</strong> ${esc(p.customer?.salesperson)}</p>

        <h3>Cabinet Measurements</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td>Base Cabinets (LF)</td><td style="text-align:right;">${esc(p.measurements?.baseLF)}</td></tr>
          <tr><td>30&quot; &amp; Under Uppers (LF)</td><td style="text-align:right;">${esc(p.measurements?.upper30)}</td></tr>
          <tr><td>36&quot; Uppers (LF)</td><td style="text-align:right;">${esc(p.measurements?.upper36)}</td></tr>
          <tr><td>42&quot; Uppers (LF)</td><td style="text-align:right;">${esc(p.measurements?.upper42)}</td></tr>
          <tr><td>Pantry / Tall (LF)</td><td style="text-align:right;">${esc(p.measurements?.pantryLF)}</td></tr>
          <tr><td>Doors</td><td style="text-align:right;">${esc(p.measurements?.doorCount)}</td></tr>
          <tr><td>Drawer Fronts</td><td style="text-align:right;">${esc(p.measurements?.drawerCount)}</td></tr>
        </table>

        <h3>Cabinet Add-Ons</h3>
        <table style="width:100%;border-collapse:collapse;">${rows(p.details?.cabinetExtras)}</table>

        <h3>Countertops</h3>
        <p><strong>Square Feet:</strong> ${esc(p.countertop?.sqft)}<br>
        <strong>Level:</strong> ${esc(p.countertop?.levelLabel)}</p>
        <table style="width:100%;border-collapse:collapse;">${rows(p.details?.counterExtras)}</table>

        <h3>Pull-Out Shelves</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr><th align="left">Width</th><th align="left">Depth</th><th align="right">Qty</th><th align="right">Scoops</th></tr>
          ${(p.details?.pullouts || []).map((x) => `<tr><td>${esc(x.width)}</td><td>${esc(x.depth)}</td><td align="right">${esc(x.qty)}</td><td align="right">${esc(x.scoops)}</td></tr>`).join("")}
        </table>

        <h3>Other Services</h3>
        <table style="width:100%;border-collapse:collapse;">${rows([...(p.details?.flooring || []), ...(p.details?.misc || [])])}</table>

        <h3>Final Totals</h3>
        <p>Thermofoil: <strong>${money(totals.thermo)}</strong><br>
        Group 1: <strong>${money(totals.g1)}</strong><br>
        Group 2: <strong>${money(totals.g2)}</strong><br>
        Group 3: <strong>${money(totals.g3)}</strong></p>

        ${p.internalNotes ? `<h3>Job Notes</h3><p>${esc(p.internalNotes).replace(/\n/g, "<br>")}</p>` : ""}
      </div>
    `;

    const customerResult = await resend.emails.send({
      from: "Johnson Cabinetry & Refacing <onboarding@resend.dev>",
      to: [customerEmail],
      subject: `Your Estimate | Johnson Cabinetry & Refacing`,
      html: customerHtml
    });

    if (customerResult.error) {
      return res.status(500).json({ error: customerResult.error.message || "Customer email failed." });
    }

    const ownerTo = process.env.JCR_ESTIMATE_RECORD_EMAIL || "dusty@jcabinetry.com";
    const ownerResult = await resend.emails.send({
      from: "JCR Estimator <onboarding@resend.dev>",
      to: [ownerTo],
      subject: `Estimate Record | ${customerName}`,
      html: internalHtml
    });

    if (ownerResult.error) {
      return res.status(500).json({ error: ownerResult.error.message || "Internal record email failed." });
    }

    return res.status(200).json({
      success: true,
      customerId: customerResult.data?.id || null,
      ownerId: ownerResult.data?.id || null
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Email failed." });
  }
}
