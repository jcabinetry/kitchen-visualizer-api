import { getRedis } from "./redisClient.js";

const CUSTOMER_INDEX_KEY = "visualizer:customers:index";
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

function normalizeCustomer(input = {}, existing = null) {
  const companyKey = cleanCompanyKey(input.companyKey || existing?.companyKey);

  if (!companyKey) {
    throw new Error("companyKey is required.");
  }

  const now = new Date().toISOString();
  const status = input.status === "archived" ? "archived" : "active";

  return {
    companyKey,
    companyName: String(input.companyName || existing?.companyName || companyKey).trim(),
    status,
    monthlyLimit: toPositiveInteger(input.monthlyLimit ?? existing?.monthlyLimit),
    branding: {
      logoUrl: String(input.branding?.logoUrl ?? existing?.branding?.logoUrl ?? "").trim(),
      primaryColor: String(input.branding?.primaryColor ?? existing?.branding?.primaryColor ?? "#1f2937").trim(),
      accentColor: String(input.branding?.accentColor ?? existing?.branding?.accentColor ?? "#f59e0b").trim(),
      websiteUrl: String(input.branding?.websiteUrl ?? existing?.branding?.websiteUrl ?? "").trim(),
      contactEmail: String(input.branding?.contactEmail ?? existing?.branding?.contactEmail ?? "").trim()
    },
    notes: String(input.notes ?? existing?.notes ?? "").trim(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    archivedAt: status === "archived" ? existing?.archivedAt || now : null
  };
}

export async function listCustomers() {
  const redis = getRedis();
  const keys = await redis.smembers(CUSTOMER_INDEX_KEY);
  const customers = await Promise.all(
    keys.map(async function(companyKey) {
      return redis.get(customerKey(companyKey));
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
  return redis.get(customerKey(cleanCompanyKey(companyKey)));
}

export async function saveCustomer(input) {
  const redis = getRedis();
  const existing = input.companyKey ? await getCustomer(input.companyKey) : null;
  const customer = normalizeCustomer(input, existing);

  await redis.sadd(CUSTOMER_INDEX_KEY, customer.companyKey);
  await redis.set(customerKey(customer.companyKey), customer);

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
