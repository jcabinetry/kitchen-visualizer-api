import { getRedis } from "./redisClient.js";

const CATALOG_INDEX_KEY = "visualizer:catalogs:index";
const CATALOG_VERSION_PREFIX = "visualizer:catalog:versions:";

export function cleanCatalogId(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function catalogKey(catalogId) {
  return `visualizer:catalog:${catalogId}`;
}

function catalogVersionsKey(catalogId) {
  return `${CATALOG_VERSION_PREFIX}${catalogId}`;
}

function parseMaybeJson(value) {
  if (!value || typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return value;
  }
}

function toList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  if (typeof value === "object" && Array.isArray(value.result)) return value.result;
  return [value];
}

function normalizeCatalog(input = {}, existing = null) {
  let source = parseMaybeJson(input) || {};
  let old = parseMaybeJson(existing) || null;

  if (typeof source !== "object") source = { name: String(source || "") };
  if (old && typeof old !== "object") old = null;

  const now = new Date().toISOString();
  const name = String(source.name || old?.name || "").trim();
  const catalogId = cleanCatalogId(source.catalogId || source.id || old?.catalogId || name);

  if (!catalogId) throw new Error("catalogId or name is required.");

  const manufacturers = Array.isArray(source.manufacturers)
    ? source.manufacturers
    : Array.isArray(old?.manufacturers)
      ? old.manufacturers
      : [];

  return {
    catalogId,
    name: name || catalogId,
    status: source.status === "archived" ? "archived" : "active",
    version: String(source.version || old?.version || "1.0").trim(),
    sourceType: String(source.sourceType || old?.sourceType || "manual").trim(),
    sourceUrl: String(source.sourceUrl || old?.sourceUrl || "").trim(),
    notes: String(source.notes || old?.notes || "").trim(),
    manufacturers,
    createdAt: old?.createdAt || now,
    updatedAt: now
  };
}

export async function listCatalogs() {
  const redis = getRedis();
  const ids = toList(await redis.smembers(CATALOG_INDEX_KEY).catch(function() { return []; }));
  const catalogs = await Promise.all(
    ids.map(function(id) {
      return getCatalog(id).catch(function() { return null; });
    })
  );

  return catalogs
    .filter(Boolean)
    .sort(function(a, b) { return a.name.localeCompare(b.name); });
}

export async function getCatalog(catalogId) {
  const redis = getRedis();
  const safeId = cleanCatalogId(catalogId);
  if (!safeId) return null;
  const raw = await redis.get(catalogKey(safeId));
  if (!raw) return null;
  return normalizeCatalog(raw, { catalogId: safeId });
}

export async function saveCatalog(input) {
  const redis = getRedis();
  const safeId = cleanCatalogId(input.catalogId || input.id || input.name);
  const existing = safeId ? await getCatalog(safeId) : null;
  const catalog = normalizeCatalog(input, existing);

  await Promise.all([
    redis.sadd(CATALOG_INDEX_KEY, catalog.catalogId),
    redis.set(catalogKey(catalog.catalogId), catalog),
    redis.lpush(catalogVersionsKey(catalog.catalogId), {
      version: catalog.version,
      savedAt: catalog.updatedAt,
      sourceType: catalog.sourceType,
      sourceUrl: catalog.sourceUrl,
      manufacturers: catalog.manufacturers
    })
  ]);

  return catalog;
}

export async function archiveCatalog(catalogId) {
  const existing = await getCatalog(catalogId);
  if (!existing) throw new Error("Catalog not found.");
  return saveCatalog({ ...existing, status: "archived" });
}

export async function listCatalogVersions(catalogId, limit = 10) {
  const redis = getRedis();
  const safeId = cleanCatalogId(catalogId);
  if (!safeId) return [];
  return toList(await redis.lrange(catalogVersionsKey(safeId), 0, Math.max(0, limit - 1)).catch(function() { return []; }));
}
