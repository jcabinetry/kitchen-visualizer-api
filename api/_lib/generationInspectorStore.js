import { getRedis } from "./redisClient.js";

const GENERATION_INDEX_KEY = "generation-inspector:index";
const GENERATION_PREFIX = "generation-inspector:record:";
const MAX_RECORDS = 50;
const TTL_SECONDS = 60 * 60 * 24 * 14;

function recordKey(id) {
  return GENERATION_PREFIX + String(id || "").trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeRecord(record) {
  return {
    generationId: String(record?.generationId || ""),
    timestamp: record?.timestamp || new Date().toISOString(),
    updatedAt: record?.updatedAt || record?.timestamp || new Date().toISOString(),
    status: record?.status || "captured",
    model: record?.model || record?.payload?.model || "",
    promptVersion: record?.promptVersion || record?.payload?.promptVersion || "",
    quality: record?.quality || record?.payload?.quality || "",
    attachmentStatus: record?.attachmentStatus || record?.payload?.attachmentStatus || null,
    summary: record?.summary || {},
    prompt: record?.prompt || "",
    payload: record?.payload || {},
    referenceImages: toArray(record?.referenceImages),
    result: record?.result || null,
    warnings: toArray(record?.warnings),
    error: record?.error || null
  };
}

export async function saveGenerationRecord(record) {
  const normalized = normalizeRecord(record);
  if (!normalized.generationId) return null;
  const redis = getRedis();
  await Promise.all([
    redis.set(recordKey(normalized.generationId), normalized, { ex: TTL_SECONDS }),
    redis.lpush(GENERATION_INDEX_KEY, normalized.generationId)
  ]);
  await redis.ltrim(GENERATION_INDEX_KEY, 0, MAX_RECORDS - 1).catch(function() {});
  return normalized;
}

export async function updateGenerationRecord(generationId, patch) {
  const redis = getRedis();
  const key = recordKey(generationId);
  const existing = await redis.get(key).catch(function() { return null; });
  const next = normalizeRecord({
    ...(existing || {}),
    ...(patch || {}),
    generationId,
    updatedAt: new Date().toISOString()
  });
  await redis.set(key, next, { ex: TTL_SECONDS });
  return next;
}

export async function getGenerationRecord(generationId) {
  if (!generationId) return null;
  const redis = getRedis();
  const record = await redis.get(recordKey(generationId)).catch(function() { return null; });
  return record ? normalizeRecord(record) : null;
}

export async function listGenerationRecords(limit = 20) {
  const redis = getRedis();
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), MAX_RECORDS);
  const ids = await redis.lrange(GENERATION_INDEX_KEY, 0, safeLimit - 1).catch(function() { return []; });
  const uniqueIds = Array.from(new Set(toArray(ids).filter(Boolean)));
  const records = await Promise.all(uniqueIds.map(getGenerationRecord));
  return records.filter(Boolean);
}
