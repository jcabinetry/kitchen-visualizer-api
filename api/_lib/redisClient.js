import { Redis } from "@upstash/redis";

let redis = null;

function clean(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

export function getRedisConfig() {
  const url = clean(process.env.UPSTASH_REDIS_REST_URL);
  const token = clean(process.env.UPSTASH_REDIS_REST_TOKEN);

  if (!url.startsWith("https://")) {
    throw new Error(
      "UPSTASH_REDIS_REST_URL is missing or invalid."
    );
  }

  if (!token) {
    throw new Error(
      "UPSTASH_REDIS_REST_TOKEN is missing."
    );
  }

  return {
    url,
    token
  };
}

export function getRedis() {
  if (redis) {
    return redis;
  }

  const config = getRedisConfig();

  redis = new Redis({
    url: config.url,
    token: config.token
  });

  return redis;
}
