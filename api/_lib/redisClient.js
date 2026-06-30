import { Redis } from "@upstash/redis";

let redis;

function cleanEnvValue(value) {
  return String(value || "")
    .trim()
    .replace(/^['\"]|['\"]$/g, "");
}

function firstValidUrl(...values) {
  return values.map(cleanEnvValue).find(function(value) {
    return value.startsWith("https://");
  });
}

function firstValidToken(...values) {
  return values.map(cleanEnvValue).find(function(value) {
    return value && !value.startsWith("https://") && !value.startsWith("rediss://");
  });
}

export function getRedisConfig() {
  const url = firstValidUrl(
    process.env.UPSTASH_REDIS_REST_URL,
    process.env.KV_REST_API_URL,
    process.env.KV_URL
  );

  const token = firstValidToken(
    process.env.UPSTASH_REDIS_REST_TOKEN,
    process.env.KV_REST_API_TOKEN,
    process.env.KV_REST_API_READ_ONLY_TOKEN
  );

  if (!url || !token) {
    throw new Error("Missing valid Upstash Redis REST credentials. Set an https:// REST URL and REST token in Vercel.");
  }

  return { url, token };
}

export function getRedis() {
  if (redis) return redis;

  redis = new Redis(getRedisConfig());
  return redis;
}
