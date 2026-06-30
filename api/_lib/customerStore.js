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

function cleanEnvValue(value) {
  return String(value || "")
    .trim()
    .replace(/^['\"]|['\"]$/g, "");
}

function redisRestConfig() {
  const url = cleanEnvValue(process.env.UPSTASH_REDIS_REST_URL);
  const token = cleanEnvValue(process.env.UPSTASH_REDIS_REST_TOKEN);

  if (!url || !url.startsWith("https://") || !token) {
    throw new Error("Missing Upstash Redis REST URL or token.");
  }

  return { url, token };
}

async function upstashCommand(command) {
  const { url, token } = redisRestConfig();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });
  const data = await response.json().catch(function() { return {}; });

  if (!response.ok || data.error) {
    throw new Error(data.error || "Upstash Redis command failed.");
  }

  return data.result;
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

function toList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  if (typeof value === "object" && Array.isArray(value.result)) return value.result;
  if (typeof value === "object" && Array.isArray(value.keys)) return value.keys;
  return [value];
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

async function readIndex() {
  const [existingKeys, v2Keys] = await Promise.all([
    upstashCommand(["SMEMBERS", CUSTOMER_INDEX_KEY]).catch(function() { return []; }),
    upstashCommand(["SMEMBERS", CUSTOMER_INDEX_KEY_V2]).catch(function() { return []; })
  ]);

  return Array.from(new Set([
    ...toList(existingKeys),
    ...toList(v2Keys)
  ]))
    .map(function(value) { return String(value || "").trim(); })
    .map(companyKeyFromRedisKey)
    .filter(Boolean)
    .filter(function(value) { return value !== CUSTOMER_INDEX_KEY && value !== CUSTOMER_INDEX_KEY_V2; });
}

async function readCustomerByKey(companyKey) {
  const rawCompanyKey = String(companyKey || "").trim();
  const safeCompanyKey = cleanCompanyKey(companyKeyFromRedisKey(rawCompanyKey));
  const candidates = Array.from(new Set([safeCompanyKey, companyKeyFromRedisKey(rawCompanyKey), rawCompanyKey].filter(Boolean)));

  for (const candidate of candidates) {
    const existing = await upstashCommand(["GET", customerKey(candidate)]).catch(function() { return null; });
    if (existing) return normalizeCustomer(existing, { companyKey: candidate });

    const v2 = await upstashCommand(["GET", customerKeyV2(candidate)]).catch(function() { return null; });
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
  const keys = await readIndex();
  const customers = await Promise.all(
    keys.map(function(companyKey) {
      return readCustomerByKey(companyKey);
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
  return readCustomerByKey(companyKey);
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