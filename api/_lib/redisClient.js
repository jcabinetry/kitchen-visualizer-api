import { Redis } from "@upstash/redis";

let redis;

function cleanEnvValue(value) {
  return String(value || "")
    .trim()
    .replace(/^['\"]|['\"]$/g, "");
}

function firstMatching(values, predicate) {
  return values.map(cleanEnvValue).find(function(value) {
    return value && predicate(value);
  });
}

export function getRedisConfig() {
  const candidates = [
    process.env.UPSTASH_REDIS_REST_URL,
    process.env.KV_REST_API_URL,
    process.env.UPSTASH_REDIS_REST_TOKEN,
    process.env.KV_REST_API_TOKEN
  ];

  const url = firstMatching(candidates, function(value) {
    return value.startsWith("https://");
  });

  const token = firstMatching(candidates, function(value) {
    return !value.startsWith("https://") && !value.startsWith("rediss://");
  });

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
