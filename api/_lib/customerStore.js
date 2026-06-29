import { getRedis } from "./redisClient.js";

const CUSTOMER_INDEX_KEY = "customers";
const CUSTOMER_INDEX_KEY_V2 = "visualizer:customers:index";
const DEFAULT_MONTHLY_LIMIT = 200;

export function getMonthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

export function cleanCompanyKey(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function customerKey(companyKey) {
  return `customer:${companyKey}`;
}

function customerKeyV2(companyKey) {
  return `visualizer:customer:${companyKey}`;
}

function companyKeyFromRedisKey(key) {
  return String(key || "")
    .replace(/^visualizer:customer:/, "")
    .replace(/^customer:/, "");
}

export function usageKey(companyKey, monthKey = getMonthKey()) {
  return `visualizer:${companyKey}:${monthKey}:used`;
}

export function limitEmailSentKey(companyKey, monthKey = getMonthKey()) {
  return `visualizer:${companyKey}:${monthKey}:limitEmailSent`;
}

function toPositiveInteger(value, fallback = DEFAULT_MONTHLY_LIMIT) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function parseMaybeJson(value) {
  if (!value || typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch (_error) {
    return value;
  }
}

function textValue(...values) {
  const found = values.find(function(value) {
    return value !== undefined && value !== null && String(value).trim() !== "";
  });

  return String(found || "").trim();
}

function normalizeCustomer(input = {}, existing = null) {
  let source = parseMaybeJson(input) || {};
  let existingSource = parseMaybeJson(existing) || null;

  // Some early/manual Redis records stored only a plain string like "0333".
  // Treat that string as the company key instead of crashing the customer list.
  if (typeof source !== "object") {
    source = { companyKey: String(source || "") };
  }

  if (existingSource && typeof existingSource !== "object") {
    existingSource = { companyKey: String(existingSource || "") };
  }

  const branding = source.branding || {};
  const existingBranding = existingSource?.branding || {};

  const companyKey = cleanCompanyKey(source.companyKey || existingSource?.companyKey);

  if (!companyKey) {
    throw new Error("companyKey is required.");
  }

  const now = new Date().toISOString();
  const status = source.status === "archived" ? "archived" : "active";
  const email = textValue(source.email, source.contactEmail, branding.email, branding.contactEmail, existingSource?.email, existingSource?.contactEmail, existingBranding.email, existingBranding.contactEmail);
  const phone = textValue(source.phone, branding.phone, existingSource?.phone, existingBranding.phone);
  const city = textValue(source.city, branding.city, existingSource?.city, existingBranding.city);
  const logoUrl = textValue(source.logoUrl, branding.logoUrl, existingSource?.logoUrl, existingBranding.logoUrl);
  const primaryColor = textValue(source.primaryColor, branding.primaryColor, existingSource?.primaryColor, existingBranding.primaryColor, "#1f2937");
  const accentColor = textValue(source.accentColor, branding.accentColor, existingSource?.accentColor, existingBranding.accentColor, "#f59e0b");
  const websiteUrl = textValue(source.websiteUrl, source.website, branding.websiteUrl, branding.website, existingSource?.websiteUrl, existingSource?.website, existingBranding.websiteUrl, existingBranding.website);
  const estimateUrl = textValue(source.estimateUrl, branding.estimateUrl, existingSource?.estimateUrl, existingBranding.estimateUrl);
  const ctaText = textValue(source.ctaText, branding.ctaText, existingSource?.ctaText, existingBranding.ctaText, "Request an Estimate");

  return {
    companyKey,
    companyName: textValue(source.companyName, existingSource?.companyName, companyKey),
    status,
    monthlyLimit: toPositiveInteger(source.monthlyLimit ?? existingSource?.monthlyLimit),
    plan: textValue(source.plan, existingSource?.plan),
    phone,
    email,
    city,
    estimateUrl,
    logoUrl,
    primaryColor,
    ctaText,
    branding: {
      logoUrl,
      primaryColor,
      accentColor,
      websiteUrl,
      estimateUrl,
      contactEmail: email,
      email,
      phone,
      city,
      ctaText
    },
    notes: String(source.notes ?? existingSource?.notes ?? "").trim(),
    createdAt: existingSource?.createdAt || now,
    updatedAt: now,
    archivedAt: status === "archived" ? existingSource?.archivedAt || now : null
  };
}

function scanCursor(result) {
  if (Array.isArray(result)) return Number(result[0] || 0);
  return Number(result?.cursor || result?.[0] || 0);
}

function scanResultKeys(result) {
  if (Array.isArray(result)) return result[1] || [];
  return result?.keys || result?.result || [];
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
    return await redis.keys(match);
  } catch (_error) {
    return [];
  }
}

async function readIndex(redis) {
  const [existingKeys, v2Keys, scannedExistingKeys, scannedV2Keys, directExistingKeys, directV2Keys] = await Promise.all([
    redis.smembers(CUSTOMER_INDEX_KEY).catch(function() { return []; }),
    redis.smembers(CUSTOMER_INDEX_KEY_V2).catch(function() { return []; }),
    scanKeys(redis, "customer:*"),
    scanKeys(redis, "visualizer:customer:*"),
    keysMatching(redis, "customer:*"),
    keysMatching(redis, "visualizer:customer:*")
  ]);

  return Array.from(new Set([
    ...(existingKeys || []),
    ...(v2Keys || []),
    ...(scannedExistingKeys || []).map(companyKeyFromRedisKey),
    ...(scannedV2Keys || []).map(companyKeyFromRedisKey),
    ...(directExistingKeys || []).map(companyKeyFromRedisKey),
    ...(directV2Keys || []).map(companyKeyFromRedisKey)
  ]))
    .map(function(value) { return String(value || "").trim(); })
    .filter(Boolean)
    .filter(function(value) { return value !== CUSTOMER_INDEX_KEY && value !== CUSTOMER_INDEX_KEY_V2; });
}

async function readCustomerByKey(redis, companyKey) {
  const rawCompanyKey = String(companyKey || "").trim();
  const safeCompanyKey = cleanCompanyKey(rawCompanyKey);
  const candidates = Array.from(new Set([safeCompanyKey, rawCompanyKey].filter(Boolean)));

  for (const candidate of candidates) {
    const existing = await redis.get(customerKey(candidate));
    if (existing) return normalizeCustomer(existing, { companyKey: candidate });

    const v2 = await redis.get(customerKeyV2(candidate));
    if (v2) return normalizeCustomer(v2, { companyKey: candidate });
  }

  return null;
}

async function writeCustomer(redis, customer) {
  await Promise.all([
    redis.sadd(CUSTOMER_INDEX_KEY, customer.companyKey),
    redis.sadd(CUSTOMER_INDEX_KEY_V2, customer.companyKey),
    redis.set(customerKey(customer.companyKey), customer),
    redis.set(customerKeyV2(customer.companyKey), customer)
  ]);
}

async function repairCustomerIndexes(redis, customers) {
  const keys = customers.map(function(customer) {
    return customer.companyKey;
  }).filter(Boolean);

  if (!keys.length) return;

  await Promise.all([
    redis.sadd(CUSTOMER_INDEX_KEY, ...keys),
    redis.sadd(CUSTOMER_INDEX_KEY_V2, ...keys)
  ]).catch(function() {});
}

export async function listCustomers() {
  const redis = getRedis();
  const keys = await readIndex(redis);
  const customers = await Promise.all(
    keys.map(function(companyKey) {
      return readCustomerByKey(redis, companyKey);
    })
  );
  const uniqueCustomers = new Map();

  customers.filter(Boolean).forEach(function(customer) {
    uniqueCustomers.set(customer.companyKey, customer);
  });

  const customerList = Array.from(uniqueCustomers.values())
    .sort(function(a, b) {
      return a.companyName.localeCompare(b.companyName);
    });

  await repairCustomerIndexes(redis, customerList);

  return customerList;
}

export async function getCustomer(companyKey) {
  const redis = getRedis();
  return readCustomerByKey(redis, companyKey);
}

export async function saveCustomer(input) {
  const redis = getRedis();
  const existing = input.companyKey ? await getCustomer(input.companyKey) : null;
  const customer = normalizeCustomer(input, existing);

  await writeCustomer(redis, customer);

  return customer;
}

export async function archiveCustomer(companyKey) {
  const existing = await getCustomer(companyKey);

  if (!existing) {
    throw new Error("Customer not found.");
  }

  return saveCustomer({ ...existing, status: "archived" });
}

export async function getCustomerUsage(companyKey, monthKey = getMonthKey()) {
  const redis = getRedis();
  const safeCompanyKey = cleanCompanyKey(companyKey);
  const used = Number((await redis.get(usageKey(safeCompanyKey, monthKey))) || 0);

  return {
    companyKey: safeCompanyKey,
    monthKey,
    used
  };
}

export async function resetCustomerUsage(companyKey, monthKey = getMonthKey()) {
  const redis = getRedis();
  const safeCompanyKey = cleanCompanyKey(companyKey);

  await redis.set(usageKey(safeCompanyKey, monthKey), 0);
  await redis.del(limitEmailSentKey(safeCompanyKey, monthKey));

  return getCustomerUsage(safeCompanyKey, monthKey);
}
