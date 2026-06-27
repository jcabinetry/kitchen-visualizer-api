import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { name, id, limit, plan, email } = req.body;

    if (!name || !id) {
      return res.status(400).json({
        error: "Missing customer name or ID",
      });
    }

    const customer = {
      name,
      id,
      limit: Number(limit || 50),
      plan: plan || "Starter",
      email: email || "",
      updatedAt: new Date().toISOString(),
    };

    await redis.sadd("customers", id);
    await redis.set(`customer:${id}`, customer);

    res.status(200).json({
      success: true,
      customer,
    });

  } catch (error) {
    console.error("Register customer error:", error);

    res.status(500).json({
      error: "Could not register customer",
    });
  }
}
