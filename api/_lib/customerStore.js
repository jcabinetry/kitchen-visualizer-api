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

function normalizeCustomer(input = {}, existing = null) {
  const source = parseMaybeJson(input) || {};
  const existingSource = parseMaybeJson(existing) || null;
  const existingBranding = existingSource?.branding || {};

  const companyKey = cleanCompanyKey(source.companyKey || existingSource?.companyKey);

  if (!companyKey) {
    throw new Error("companyKey is required.");
  }

  const now = new Date().toISOString();
  const status = source.status === "archived" ? "archived" : "active";
  const branding = source.branding || {};

  return {
    companyKey,
    companyName: String(source.companyName || existingSource?.companyName || companyKey).trim(),
    status,
    monthlyLimit: toPositiveInteger(source.monthlyLimit ?? existingSource?.monthlyLimit),
    plan: String(source.plan || existingSource?.plan || "").trim(),
    branding: {
      logoUrl: String(branding.logoUrl ?? source.logoUrl ?? existingBranding.logoUrl ?? existingSource?.logoUrl ?? "").trim(),
      primaryColor: String(branding.primaryColor ?? source.primaryColor ?? existingBranding.primaryColor ?? existingSource?.primaryColor ?? "#1f2937").trim(),
      accentColor: String(branding.accentColor ?? source.accentColor ?? existingBranding.accentColor ?? "#f59e0b").trim(),
      websiteUrl: String(branding.websiteUrl ?? source.website ?? source.websiteUrl ?? existingBranding.websiteUrl ?? existingSource?.website ?? "").trim(),
      estimateUrl: String(branding.estimateUrl ?? source.estimateUrl ?? existingBranding.estimateUrl ?? existingSource?.estimateUrl ?? "").trim(),
      contactEmail: String(branding.contactEmail ?? source.email ?? source.contactEmail ?? existingBranding.contactEmail ?? existingSource?.email ?? "").trim(),
      phone: String(branding.phone ?? source.phone ?? existingBranding.phone ?? existingSource?.phone ?? "").trim()
    },
    notes: String(source.notes ?? existingSource?.notes ?? "").trim(),
    createdAt: existingSource?.createdAt || now,
    updatedAt: now,
    archivedAt: status === "archived" ? existingSource?.archivedAt || now : null
  };
}

async function readIndex(redis) {
  const [existingKeys, v2Keys] = await Promise.all([
    redis.smembers(CUSTOMER_INDEX_KEY).catch(function() { return []; }),
    redis.smembers(CUSTOMER_INDEX_KEY_V2).catch(function() { return []; })
  ]);

  return Array.from(new Set([...(existingKeys || []), ...(v2Keys || [])]))
    .map(cleanCompanyKey)
    .filter(Boolean);
}

async function readCustomerByKey(redis, companyKey) {
  const safeCompanyKey = cleanCompanyKey(companyKey);
  const existing = await redis.get(customerKey(safeCompanyKey));
  if (existing) return normalizeCustomer(existing);

  const v2 = await redis.get(customerKeyV2(safeCompanyKey));
  if (v2) return normalizeCustomer(v2);

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

export async function listCustomers() {
  const redis = getRedis();
  const keys = await readIndex(redis);
  const customers = await Promise.all(
    keys.map(function(companyKey) {
      return readCustomerByKey(redis, companyKey);
    })
  );

  return customers
    .filter(Boolean)
    .sort(function(a, b) {
      return a.companyName.localeCompare(b.companyName);
    });
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
