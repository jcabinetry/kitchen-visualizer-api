function cleanKey(value) {
  return String(value || "default-company")
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

async function redisGet(key) {
  const response = await fetch(
    `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`
      }
    }
  );

  const data = await response.json().catch(() => ({}));
  return data.result ? JSON.parse(data.result) : null;
}

async function redisSet(key, value) {
  await fetch(
    `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`
      }
    }
  );
}

async function redisSadd(key, value) {
  await fetch(
    `${process.env.KV_REST_API_URL}/sadd/${encodeURIComponent(key)}/${encodeURIComponent(value)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`
      }
    }
  );
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { name, id, limit, plan, email } = req.body || {};

    if (!name || !id) {
      return res.status(400).json({ error: "Missing customer name or ID" });
    }

    const safeId = cleanKey(id);
    const customerKey = `customer:${safeId}`;

    const existingCustomer = await redisGet(customerKey);

    await redisSadd("customers", safeId);

    if (existingCustomer) {
      return res.status(200).json({
        success: true,
        skipped: true,
        customer: existingCustomer
      });
    }

    const customer = {
      companyKey: safeId,
      companyName: name,
      monthlyLimit: Number(limit || 50),
      monthlyPrice: 0,
      plan: plan || "Starter",
      status: "active",
      phone: "",
      email: email || "",
      city: "",
      primaryColor: "#1f2937",
      customerPageUrl: "",
      websiteUrl: "",
      estimateUrl: "",
      logoUrl: "",
      buttonText: "Request an Estimate",
      ctaText: "Request an Estimate",
      notes: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await redisSet(customerKey, customer);

    return res.status(200).json({
      success: true,
      customer
    });

  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Could not register customer"
    });
  }
}
