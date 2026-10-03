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
    const customerHtml = \`
      <div style="margin:0;padding:0;background:#f3f6f8;font-family:Arial,Helvetica,sans-serif;color:#26313b;">
        <div style="max-width:720px;margin:0 auto;padding:28px 14px;">
          <div style="background:#173a57;border-radius:18px 18px 0 0;padding:28px 32px;color:#ffffff;">
            <div style="font-size:28px;font-weight:800;line-height:1.15;">Johnson Cabinetry &amp; Refacing</div>
            <div style="margin-top:7px;font-size:14px;opacity:.9;">Family Owned. Local. Trusted.</div>
          </div>
          <div style="background:#ffffff;border:1px solid #dce4ea;border-top:0;border-radius:0 0 18px 18px;overflow:hidden;">
            <div style="padding:30px 32px 12px;">
              <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b7782;font-weight:700;">Project Estimate</div>
              <h1 style="margin:8px 0 10px;font-size:27px;line-height:1.2;color:#173a57;">Thank you, \${esc(customerName)}.</h1>
              <p style="margin:0;font-size:16px;line-height:1.6;color:#465460;">Thank you for the opportunity to help with your project. Below are the cabinet refacing options we prepared for you.</p>
              \${p.customer?.address ? \`<div style="margin-top:18px;padding:14px 16px;background:#f6f9fb;border-radius:10px;"><div style="font-size:12px;color:#6b7782;text-transform:uppercase;font-weight:700;letter-spacing:.05em;">Project Location</div><div style="margin-top:4px;font-size:15px;font-weight:700;color:#26313b;">\${esc(p.customer.address)} \${esc(p.customer.cityZip || "")}</div></div>\` : ""}
            </div>
            <div style="padding:8px 32px 6px;">
              <h2 style="font-size:20px;color:#173a57;margin:16px 0 12px;">Your Refacing Options</h2>
              <table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0 10px;">
                <tr><td style="padding:16px 18px;background:#f8fafb;border:1px solid #dce4ea;border-radius:12px;"><div style="font-weight:800;color:#173a57;font-size:16px;">Thermofoil</div><div style="font-size:13px;color:#6b7782;margin-top:3px;">Clean, durable and low-maintenance</div></td><td style="padding:16px 18px;background:#f8fafb;border:1px solid #dce4ea;border-radius:12px;text-align:right;white-space:nowrap;font-size:22px;font-weight:800;color:#178253;">\${money(totals.thermo)}</td></tr>
                <tr><td style="padding:16px 18px;background:#f8fafb;border:1px solid #dce4ea;border-radius:12px;"><div style="font-weight:800;color:#173a57;font-size:16px;">Group 1</div><div style="font-size:13px;color:#6b7782;margin-top:3px;">Alder, Beech &amp; Paint Grade Hardwood</div></td><td style="padding:16px 18px;background:#f8fafb;border:1px solid #dce4ea;border-radius:12px;text-align:right;white-space:nowrap;font-size:22px;font-weight:800;color:#178253;">\${money(totals.g1)}</td></tr>
                <tr><td style="padding:16px 18px;background:#f8fafb;border:1px solid #dce4ea;border-radius:12px;"><div style="font-weight:800;color:#173a57;font-size:16px;">Group 2</div><div style="font-size:13px;color:#6b7782;margin-top:3px;">Red Oak, Hickory &amp; Farmhouse Chic</div></td><td style="padding:16px 18px;background:#f8fafb;border:1px solid #dce4ea;border-radius:12px;text-align:right;white-space:nowrap;font-size:22px;font-weight:800;color:#178253;">\${money(totals.g2)}</td></tr>
                <tr><td style="padding:16px 18px;background:#f8fafb;border:1px solid #dce4ea;border-radius:12px;"><div style="font-weight:800;color:#173a57;font-size:16px;">Group 3</div><div style="font-size:13px;color:#6b7782;margin-top:3px;">Maple, Cherry &amp; White Oak</div></td><td style="padding:16px 18px;background:#f8fafb;border:1px solid #dce4ea;border-radius:12px;text-align:right;white-space:nowrap;font-size:22px;font-weight:800;color:#178253;">\${money(totals.g3)}</td></tr>
              </table>
            </div>
            <div style="padding:12px 32px 6px;">
              <h2 style="font-size:20px;color:#173a57;margin:14px 0 12px;">Project Summary</h2>
              <table role="presentation" style="width:100%;border-collapse:collapse;background:#f8fafb;border:1px solid #dce4ea;">
                <tr><td style="padding:12px 15px;border-bottom:1px solid #e3e8ec;">Countertops</td><td style="padding:12px 15px;border-bottom:1px solid #e3e8ec;text-align:right;font-weight:700;">\${money(p.sections?.countertops)}</td></tr>
                <tr><td style="padding:12px 15px;border-bottom:1px solid #e3e8ec;">Pull-Out Shelves</td><td style="padding:12px 15px;border-bottom:1px solid #e3e8ec;text-align:right;font-weight:700;">\${money(p.sections?.pullouts)}</td></tr>
                <tr><td style="padding:12px 15px;">Other Included Services</td><td style="padding:12px 15px;text-align:right;font-weight:700;">\${money(p.sections?.extras)}</td></tr>
              </table>
            </div>
            \${p.customerNotes ? \`<div style="padding:14px 32px 6px;"><h2 style="font-size:20px;color:#173a57;margin:14px 0 10px;">Project Notes</h2><div style="padding:15px 16px;background:#fff8e7;border:1px solid #ead7a3;border-radius:10px;line-height:1.6;">\${esc(p.customerNotes).replace(/\\n/g, "<br>")}</div></div>\` : ""}
            <div style="padding:24px 32px 30px;">
              <div style="background:#173a57;border-radius:14px;padding:22px;color:#ffffff;text-align:center;">
                <div style="font-size:20px;font-weight:800;">Questions or ready to move forward?</div>
                <div style="margin-top:8px;font-size:14px;line-height:1.6;opacity:.95;">We’re happy to review the options with you and answer any questions about your project.</div>
                <div style="margin-top:18px;"><a href="tel:9706520240" style="display:inline-block;background:#178253;color:#ffffff;text-decoration:none;font-weight:800;padding:11px 18px;border-radius:8px;margin:4px;">Call 970-652-0240</a><a href="https://www.jcabinetry.com" style="display:inline-block;background:#ffffff;color:#173a57;text-decoration:none;font-weight:800;padding:11px 18px;border-radius:8px;margin:4px;">Visit jcabinetry.com</a></div>
              </div>
              <p style="margin:22px 0 0;font-size:12px;line-height:1.5;color:#7a858f;text-align:center;">Estimate pricing is based on the project information available at the time of preparation and may be adjusted if scope, selections, dimensions, or field conditions change.</p>
            </div>
          </div>
          <div style="text-align:center;font-size:12px;color:#87919a;padding:14px 20px;">Johnson Cabinetry &amp; Refacing &nbsp;•&nbsp; Colorado Premier Refacing Specialist</div>
        </div>
      </div>
    \`;

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
      subject: `Your Cabinet Refacing Estimate | Johnson Cabinetry & Refacing`,
      reply_to: process.env.JCR_REPLY_TO_EMAIL || "dusty@jcabinetry.com",
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
