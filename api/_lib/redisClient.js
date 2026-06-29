import { Redis } from "@upstash/redis";

let redis;

export function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    throw new Error("Missing Upstash Redis environment variables. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel.");
  }

  if (!url.startsWith("https://")) {
    throw new Error("UPSTASH_REDIS_REST_URL must be the Upstash REST URL that starts with https://. It looks like the token may have been pasted into the URL field.");
  }

  if (token.startsWith("https://")) {
    throw new Error("UPSTASH_REDIS_REST_TOKEN must be the Upstash REST token, not the REST URL. It looks like the URL may have been pasted into the token field.");
  }

  return { url, token };
}

export function getRedis() {
  if (redis) return redis;

  redis = new Redis(getRedisConfig());
  return redis;
}
