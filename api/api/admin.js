const CUSTOMERS_INDEX_KEY = "visualizer:customers:index";
const DEFAULT_LIMIT = 200;

function getMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

function cleanKey(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function redisGet(key) {
  const res = await fetch(
    `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`
      }
    }
  );

  const data = await res.json();
  return data.result;
}

async function redisSet(key, value) {
  await fetch(
    `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`
      }
    }
  );
}

async function getCustomerIndex() {
  const raw = await redisGet(CUSTOMERS_INDEX_KEY);
  if (!raw) return [];

  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveCustomerIndex(keys) {
  const unique = [...new Set(keys.filter(Boolean))];
  await redisSet(CUSTOMERS_INDEX_KEY, JSON.stringify(unique));
}

async function getCustomer(companyKey) {
  const raw = await redisGet(`visualizer:company:${companyKey}`);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveCustomer(customer) {
  await redisSet(
    `visualizer:company:${customer.companyKey}`,
    JSON.stringify(customer)
  );
}

async function listCustomers() {
  const keys = await getCustomerIndex();
  const monthKey = getMonthKey();
  const customers = [];

  for (const key of keys) {
    const customer = await getCustomer(key);

    if (!customer) continue;
    if (customer.status === "archived") continue;

    const usedRaw = await redisGet(`visualizer:${key}:${monthKey}:used`);
    const used = Number(usedRaw || 0);
    const monthlyLimit = Number(customer.monthlyLimit || 0);

    customers.push({
      ...customer,
      used,
      remaining: Math.max(0, monthlyLimit - used)
    });
  }

  customers.sort((a, b) =>
    String(a.companyName || a.companyKey).localeCompare(
      String(b.companyName || b.companyKey)
    )
  );

  return customers;
}

function checkAdmin(req) {
  const required = process.env.ADMIN_API_KEY;

  if (!required) return true;

  return req.headers["x-admin-key"] === required;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return res.status(500).json({
      error: "Missing Redis environment variables."
    });
  }

  if (!checkAdmin(req)) {
    return res.status(401).json({
      error: "Unauthorized admin request."
    });
  }

  try {
    if (req.method === "GET") {
      const customers = await listCustomers();
      return res.status(200).json({ customers });
    }

    if (req.method !== "POST") {
      return res.status(405).json({
        error: "Method not allowed."
      });
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const action = body.action;

    if (action === "createCustomer") {
      const companyKey = cleanKey(body.companyKey || body.companyName);

      if (!companyKey) {
        return res.status(400).json({
          error: "Company key is required."
        });
      }

      const existing = await getCustomer(companyKey);

      if (existing && existing.status !== "archived") {
        return res.status(400).json({
          error: "Customer already exists."
        });
      }

      const customer = {
        companyName: body.companyName || companyKey,
        companyKey,
        monthlyLimit: Number(body.monthlyLimit || DEFAULT_LIMIT),
        phone: body.phone || "",
        email: body.email || "",
        website: body.website || "",
        estimateUrl: body.estimateUrl || body.website || "",
        logoUrl: body.logoUrl || "",
        primaryColor: body.primaryColor || "#1e3a8a",
        plan: body.plan || "Growth",
        status: body.status || "active",
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await saveCustomer(customer);

      const index = await getCustomerIndex();

      if (!index.includes(companyKey)) {
        index.push(companyKey);
        await saveCustomerIndex(index);
      }

      return res.status(200).json({
        ok: true,
        customer
      });
    }

    if (action === "updateCustomer") {
      const companyKey = cleanKey(body.companyKey);

      if (!companyKey) {
        return res.status(400).json({
          error: "Company key is required."
        });
      }

      const existing = await getCustomer(companyKey);

      if (!existing) {
        return res.status(404).json({
          error: "Customer not found."
        });
      }

      const updated = {
        ...existing,
        companyName: body.companyName ?? existing.companyName,
        monthlyLimit: Number(
          body.monthlyLimit || existing.monthlyLimit || DEFAULT_LIMIT
        ),
        phone: body.phone ?? existing.phone,
        email: body.email ?? existing.email,
        website: body.website ?? existing.website,
        estimateUrl: body.estimateUrl ?? body.website ?? existing.estimateUrl,
        logoUrl: body.logoUrl ?? existing.logoUrl,
        primaryColor: body.primaryColor ?? existing.primaryColor,
        plan: body.plan ?? existing.plan,
        status: body.status ?? existing.status,
        companyKey,
        updatedAt: new Date().toISOString()
      };

      await saveCustomer(updated);

      return res.status(200).json({
        ok: true,
        customer: updated
      });
    }

    if (action === "archiveCustomer") {
      const companyKey = cleanKey(body.companyKey);
      const existing = await getCustomer(companyKey);

      if (!existing) {
        return res.status(404).json({
          error: "Customer not found."
        });
      }

      existing.status = "archived";
      existing.archivedAt = new Date().toISOString();
      existing.updatedAt = new Date().toISOString();

      await saveCustomer(existing);

      return res.status(200).json({
        ok: true
      });
    }

    if (action === "resetUsage") {
      const companyKey = cleanKey(body.companyKey);

      if (!companyKey) {
        return res.status(400).json({
          error: "Company key is required."
        });
      }

      const monthKey = getMonthKey();

      await redisSet(`visualizer:${companyKey}:${monthKey}:used`, "0");

      return res.status(200).json({
        ok: true
      });
    }

    return res.status(400).json({
      error: "Unknown admin action."
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Admin server error."
    });
  }
}
