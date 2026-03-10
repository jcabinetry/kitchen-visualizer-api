import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { customerEmail, previewImage } = req.body || {};

    if (!customerEmail || !previewImage) {
      return res.status(400).json({ error: "Missing email or preview image." });
    }

    const imageBase64 = previewImage.includes(",")
      ? previewImage.split(",")[1]
      : previewImage;

    await resend.emails.send({
      from: "Johnson Cabinetry and Refacing <dusty@jcabinetry.com>",
      to: [customerEmail],
      subject: "Your Kitchen Preview | Johnson Cabinetry and Refacing",
      html: `
        <p>Thank you for using our kitchen visualizer.</p>
        <p>Attached is the preview of your kitchen based on the selections you made.</p>
        <p>If you would like to talk through your options or schedule a free estimate, please call Johnson Cabinetry and Refacing at 970-652-0240. We are here to help.</p>
        <p>
          Johnson Cabinetry and Refacing<br>
          970-652-0240<br>
          www.jcabinetry.com
        </p>
      `,
      attachments: [
        {
          filename: "kitchen-preview.png",
          content: imageBase64
        }
      ]
    });

    await resend.emails.send({
      from: "Johnson Cabinetry and Refacing <dusty@jcabinetry.com>",
      to: ["dusty@jcabinetry.com"],
      subject: "New Visualizer Lead | Johnson Cabinetry and Refacing",
      html: `
        <p>A customer requested their kitchen preview by email.</p>
        <p><strong>Customer email:</strong> ${customerEmail}</p>
        <p>The preview image is attached.</p>
      `,
      attachments: [
        {
          filename: "kitchen-preview.png",
          content: imageBase64
        }
      ]
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({
      error: "Email failed.",
      details: String(error)
    });
  }
}
