function getMonthKey() {
  return new Date().toISOString().slice(0, 7);
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

  const data = await response.json();
  return data.result;
}

async function redisSmembers(key) {
  const response = await fetch(
    `${process.env.KV_REST_API_URL}/smembers/${encodeURIComponent(key)}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`
      }
    }
  );

  const data = await response.json();
  return data.result || [];
}

export default async function handler(req, res) {
  try {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      return res.status(500).json({ error: "Missing Redis environment variables." });
    }

    const customerIds = await redisSmembers("customers");
    const monthKey = getMonthKey();

    const customers = [];

    for (const id of customerIds) {
      const customerRaw = await redisGet(`customer:${id}`);
      let customer = {};

      try {
        customer = typeof customerRaw === "string" ? JSON.parse(customerRaw) : customerRaw || {};
      } catch {
        customer = {};
      }

      const used = Number(
        (await redisGet(`visualizer:${id}:${monthKey}:used`)) || 0
      );

      const limit = Number(customer?.limit || 50);

      customers.push({
        ...customer,
        id,
        used,
        remaining: Math.max(limit - used, 0)
      });
    }

    return res.status(200).json({
      customers
    });

  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Could not load customers"
    });
  }
}
