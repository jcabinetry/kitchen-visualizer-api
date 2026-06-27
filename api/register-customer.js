function cleanKey(value) {
  return String(value || "default-company")
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
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
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      return res.status(500).json({ error: "Missing Redis environment variables." });
    }

    const { name, id, limit, plan, email } = req.body || {};

    if (!name || !id) {
      return res.status(400).json({ error: "Missing customer name or ID" });
    }

    const safeId = cleanKey(id);

    const customer = {
      name,
      id: safeId,
      limit: Number(limit || 50),
      plan: plan || "Starter",
      email: email || "",
      updatedAt: new Date().toISOString()
    };

    await redisSadd("customers", safeId);
    await redisSet(`customer:${safeId}`, customer);

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
