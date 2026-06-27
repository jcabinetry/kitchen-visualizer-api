export default async function handler(req, res) {
  try {
    const { Redis } = await import("@upstash/redis");

    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    const customerIds = await redis.smembers("customers");

    const now = new Date();

    const monthKey =
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const customers = [];

    for (const id of customerIds) {
      const customer = await redis.get(`customer:${id}`);

      const used = Number(
        (await redis.get(`usage:${id}:${monthKey}`)) || 0
      );

      const limit = Number(customer?.limit || 50);

      customers.push({
        ...customer,
        used,
        remaining: Math.max(limit - used, 0),
      });
    }

    return res.status(200).json({
      customers,
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: error.message,
    });
  }
}
