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
    .replace(/^["']|["']$/g, "");
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

function toMoneyNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.round(parsed * 100) / 100;
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

function normalizeCatalogSelections(value, fallback = []) {
  const parsed = parseMaybeJson(value);
  const source = Array.isArray(parsed) ? parsed : Array.isArray(fallback) ? fallback : [];

  return source
    .map(function(item) {
      if (!item || typeof item !== "object") return null;
      const catalogId = String(item.catalogId || item.id || item.name || "").trim();
      const manufacturerId = String(item.manufacturerId || item.manufacturer || catalogId || "").trim();
      const lineIds = Array.isArray(item.lineIds)
        ? item.lineIds.map(String).filter(Boolean)
        : Array.isArray(item.lines)
          ? item.lines.map(function(line) { return typeof line === "string" ? line : line?.id; }).map(String).filter(Boolean)
          : [];

      if (!catalogId && !manufacturerId) return null;

      return {
        catalogId,
        manufacturerId,
        lineIds,
        autoUpdate: item.autoUpdate !== false,
        lockedVersion: item.lockedVersion || ""
      };
    })
    .filter(Boolean);
}


function objectValue(value, fallback = {}) {
  const parsed = parseMaybeJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
}

function fieldText(source, fallback, key) {
  return textValue(source?.[key], fallback?.[key]);
}

function normalizeInternalNotes(source = {}, fallback = {}, legacyNotes = "") {
  return {
    general: textValue(source.general, fallback.general, legacyNotes),
    sales: textValue(source.sales, fallback.sales),
    billing: textValue(source.billing, fallback.billing),
    support: textValue(source.support, fallback.support),
    technical: textValue(source.technical, fallback.technical),
    onboarding: textValue(source.onboarding, fallback.onboarding)
  };
}

function normalizePrivateSection(source = {}, fallback = {}, keys = []) {
  return keys.reduce(function(section, key) {
    section[key] = textValue(source[key], fallback[key]);
    return section;
  }, {});
}
function normalizeCustomer(input = {}, existing = null) {
  let source = parseMaybeJson(input) || {};
  let existingSource = parseMaybeJson(existing) || null;

  if (typeof source !== "object") {
    source = { companyKey: String(source || "") };
  }

  if (existingSource && typeof existingSource !== "object") {
    existingSource = { companyKey: String(existingSource || "") };
  }

  const branding = objectValue(source.branding);
  const existingBranding = objectValue(existingSource?.branding);
  const contactSource = objectValue(source.contact);
  const existingContact = objectValue(existingSource?.contact);
  const addressSource = objectValue(source.address);
  const existingAddress = objectValue(existingSource?.address);
  const publicSource = objectValue(source.public);
  const existingPublic = objectValue(existingSource?.public);
  const billingSource = objectValue(source.billing);
  const existingBilling = objectValue(existingSource?.billing);
  const crmSource = objectValue(source.crm);
  const existingCrm = objectValue(existingSource?.crm);
  const proposalSource = objectValue(source.proposalDefaults);
  const existingProposal = objectValue(existingSource?.proposalDefaults);
  const supportSource = objectValue(source.support);
  const existingSupport = objectValue(existingSource?.support);
  const notesSource = objectValue(source.internalNotes);
  const existingNotes = objectValue(existingSource?.internalNotes);

  const companyKey = cleanCompanyKey(source.companyKey || existingSource?.companyKey);

  if (!companyKey) {
    throw new Error("companyKey is required.");
  }

  const now = new Date().toISOString();
  const statusValue = textValue(source.status, existingSource?.status, "active");
  const status = statusValue === "archived" ? "archived" : "active";
  const email = textValue(contactSource.email, source.email, source.contactEmail, branding.email, branding.contactEmail, existingContact.email, existingSource?.email, existingSource?.contactEmail, existingBranding.email, existingBranding.contactEmail);
  const phone = textValue(contactSource.phone, source.phone, branding.phone, existingContact.phone, existingSource?.phone, existingBranding.phone);
  const city = textValue(addressSource.city, source.city, branding.city, existingAddress.city, existingSource?.city, existingBranding.city);
  const logoUrl = textValue(branding.logoUrl, source.logoUrl, existingBranding.logoUrl, existingSource?.logoUrl);
  const primaryColor = textValue(branding.primaryColor, source.primaryColor, existingBranding.primaryColor, existingSource?.primaryColor, "#1f2937");
  const secondaryColor = textValue(branding.secondaryColor, source.secondaryColor, existingBranding.secondaryColor, existingSource?.secondaryColor, "#64748b");
  const backgroundColor = textValue(branding.backgroundColor, source.backgroundColor, existingBranding.backgroundColor, existingSource?.backgroundColor, "#f8fafc");
  const cardColor = textValue(branding.cardColor, source.cardColor, existingBranding.cardColor, existingSource?.cardColor, "#ffffff");
  const accentColor = textValue(branding.accentColor, source.accentColor, existingBranding.accentColor, existingSource?.accentColor, "#f59e0b");
  const websiteUrl = textValue(publicSource.websiteUrl, source.websiteUrl, source.website, source.customerPageUrl, branding.websiteUrl, branding.website, branding.customerPageUrl, existingPublic.websiteUrl, existingSource?.websiteUrl, existingSource?.website, existingSource?.customerPageUrl, existingBranding.websiteUrl, existingBranding.website, existingBranding.customerPageUrl);
  const estimateUrl = textValue(publicSource.estimateUrl, source.estimateUrl, branding.estimateUrl, existingPublic.estimateUrl, existingSource?.estimateUrl, existingBranding.estimateUrl);
  const ctaText = textValue(branding.ctaText, source.ctaText, source.buttonText, existingBranding.ctaText, existingBranding.buttonText, existingSource?.ctaText, existingSource?.buttonText, "Request an Estimate");
  const catalogSelections = normalizeCatalogSelections(source.catalogSelections, existingSource?.catalogSelections);
  const selectedCatalogs = catalogSelections.map(function(item) { return item.catalogId; }).filter(Boolean);
  const internalNotes = normalizeInternalNotes(notesSource, existingNotes, source.notes ?? existingSource?.notes ?? "");

  return {
    companyKey,
    companyName: textValue(source.companyName, existingSource?.companyName, companyKey),
    status,
    monthlyLimit: toPositiveInteger(source.monthlyLimit ?? existingSource?.monthlyLimit),
    monthlyPrice: toMoneyNumber(source.monthlyPrice ?? source.price ?? source.subscriptionPrice ?? existingSource?.monthlyPrice ?? existingSource?.price ?? existingSource?.subscriptionPrice, 0),
    plan: textValue(source.plan, existingSource?.plan),
    contact: {
      name: fieldText(contactSource, existingContact, "name"),
      title: fieldText(contactSource, existingContact, "title"),
      email,
      phone
    },
    address: {
      street: fieldText(addressSource, existingAddress, "street"),
      city,
      state: fieldText(addressSource, existingAddress, "state"),
      postalCode: fieldText(addressSource, existingAddress, "postalCode"),
      serviceArea: fieldText(addressSource, existingAddress, "serviceArea")
    },
    public: {
      websiteUrl,
      estimateUrl
    },
    phone,
    email,
    city,
    websiteUrl,
    customerPageUrl: websiteUrl,
    estimateUrl,
    logoUrl,
    primaryColor,
    secondaryColor,
    accentColor,
    backgroundColor,
    cardColor,
    ctaText,
    catalogSelections,
    selectedCatalogs,
    branding: {
      logoUrl,
      primaryColor,
      secondaryColor,
      accentColor,
      backgroundColor,
      cardColor,
      websiteUrl,
      customerPageUrl: websiteUrl,
      estimateUrl,
      contactEmail: email,
      email,
      phone,
      city,
      ctaText,
      buttonText: ctaText
    },
    billing: normalizePrivateSection(billingSource, existingBilling, ["status", "renewalDate", "paymentMethodSummary", "notes"]),
    crm: normalizePrivateSection(crmSource, existingCrm, ["leadSource", "stage", "dealValue", "owner", "followUpDate", "notes"]),
    proposalDefaults: normalizePrivateSection(proposalSource, existingProposal, ["template", "packageTier", "disclaimer", "taxRate", "notes"]),
    support: normalizePrivateSection(supportSource, existingSupport, ["status", "priority", "owner", "lastContactAt", "notes"]),
    internalNotes,
    notes: internalNotes.general,
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

export async function deleteCustomer(companyKey) {
  const redis = getRedis();
  const safeCompanyKey = cleanCompanyKey(companyKey);

  if (!safeCompanyKey) {
    throw new Error("companyKey is required.");
  }

  await Promise.all([
    redis.srem(CUSTOMER_INDEX_KEY, safeCompanyKey),
    redis.srem(CUSTOMER_INDEX_KEY_V2, safeCompanyKey),
    redis.del(customerKey(safeCompanyKey)),
    redis.del(customerKeyV2(safeCompanyKey))
  ]);

  const extraKeys = await upstashCommand(["KEYS", `visualizer:${safeCompanyKey}:*`]).catch(function() { return []; });
  const keysToDelete = toList(extraKeys).filter(Boolean);

  if (keysToDelete.length) {
    await upstashCommand(["DEL", ...keysToDelete]);
  }

  return { companyKey: safeCompanyKey, deleted: true };
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
