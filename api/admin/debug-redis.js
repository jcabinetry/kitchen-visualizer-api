import { requireAdmin } from "../_lib/adminAuth.js";
import { setCorsHeaders } from "../_lib/cors.js";
import { getRedis, getRedisConfig } from "../_lib/redisClient.js";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
}

function cleanEnvValue(value) {
  return String(value || "")
    .trim()
    .replace(/^['\"]|['\"]$/g, "");
}

function hostnameFromUrl(value) {
  try {
    return new URL(cleanEnvValue(value)).hostname;
  } catch (_error) {
    return "";
  }
}

function toList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  if (typeof value === "object" && Array.isArray(value.result)) return value.result;
  if (typeof value === "object" && Array.isArray(value.keys)) return value.keys;
  return [value];
}

function scanCursor(result) {
  if (Array.isArray(result)) return Number(result[0] || 0);
  return Number(result?.cursor || result?.[0] || 0);
}

function scanResultKeys(result) {
  if (Array.isArray(result)) return toList(result[1]);
  return toList(result?.keys || result?.result);
}

async function scanKeys(redis, match) {
  if (typeof redis.scan !== "function") return [];

  const keys = [];
  let cursor = 0;

  do {
    const result = await redis.scan(cursor, { match, count: 100 }).catch(function() {
      return [0, []];
    });
    cursor = scanCursor(result);
    keys.push(...scanResultKeys(result));
  } while (cursor !== 0);

  return keys;
}

async function keysMatching(redis, match) {
  if (typeof redis.keys !== "function") return [];

  try {
    return toList(await redis.keys(match));
  } catch (_error) {
    return [];
  }
}

export default async function handler(req, res) {
  if (setCorsHeaders(req, res)) return;
  setNoStore(res);
  if (!requireAdmin(req, res)) return;

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const redis = getRedis();
    const config = getRedisConfig();
    const customersSet = toList(await redis.smembers("customers").catch(function() { return []; }));
    const customerScanKeys = await scanKeys(redis, "customer:*");
    const visualizerCustomerScanKeys = await scanKeys(redis, "visualizer:customer:*");
    const customerDirectKeys = await keysMatching(redis, "customer:*");
    const visualizerCustomerDirectKeys = await keysMatching(redis, "visualizer:customer:*");
    const customerKeys = Array.from(new Set([...customerScanKeys, ...customerDirectKeys]));
    const visualizerCustomerKeys = Array.from(new Set([...visualizerCustomerScanKeys, ...visualizerCustomerDirectKeys]));

    return res.status(200).json({
      redis: {
        upstashRedisRestUrlHostname: hostnameFromUrl(process.env.UPSTASH_REDIS_REST_URL),
        selectedRedisUrlHostname: hostnameFromUrl(config.url),
        hasUpstashRedisRestToken: Boolean(cleanEnvValue(process.env.UPSTASH_REDIS_REST_TOKEN)),
        hasKvRestApiUrl: Boolean(cleanEnvValue(process.env.KV_REST_API_URL)),
        hasKvRestApiToken: Boolean(cleanEnvValue(process.env.KV_REST_API_TOKEN))
      },
      customersSet,
      counts: {
        customersSet: customersSet.length,
        customerKeys: customerKeys.length,
        visualizerCustomerKeys: visualizerCustomerKeys.length
      },
      samples: {
        customerKeys: customerKeys.slice(0, 25),
        visualizerCustomerKeys: visualizerCustomerKeys.slice(0, 25)
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Redis debug failed." });
  }
}
