import { requireAdmin } from "../_lib/adminAuth.js";
import { setCorsHeaders } from "../_lib/cors.js";
import {
  archiveCustomer,
  deleteCustomer,
  getCustomer,
  getCustomerUsage,
  getMonthKey,
  listCustomers,
  saveCustomer
} from "../_lib/customerStore.js";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
}

export default async function handler(req, res) {
  if (setCorsHeaders(req, res)) return;
  setNoStore(res);
  if (!requireAdmin(req, res)) return;

  try {
    if (req.method === "GET") {
      const monthKey = req.query.month || getMonthKey();
      const customers = await listCustomers();
      const usage = await Promise.all(
        customers.map(function(customer) {
          return getCustomerUsage(customer.companyKey, monthKey);
        })
      );
      const usageByCompany = Object.fromEntries(
        usage.map(function(item) {
          return [item.companyKey, item];
        })
      );
      const customerRows = customers.map(function(customer) {
        return {
          ...customer,
          usage: usageByCompany[customer.companyKey] || {
            companyKey: customer.companyKey,
            monthKey,
            used: 0
          }
        };
      });

      console.log("Admin customers returned", customerRows.length);

      return res.status(200).json({
        monthKey,
        customers: customerRows,
        debug: {
          customersReturned: customerRows.length
        }
      });
    }

    if (req.method === "POST") {
      const customer = await saveCustomer(req.body || {});
      return res.status(200).json({ customer });
    }

    if (req.method === "PATCH") {
      const action = req.body?.action;
      const companyKey = req.body?.companyKey;

      if (action === "archive") {
  const customer = await archiveCustomer(companyKey);
  return res.status(200).json({ customer });
}

if (action === "delete") {
  const result = await deleteCustomer(companyKey);
  return res.status(200).json(result);
}

      const existing = await getCustomer(companyKey);
      if (!existing) return res.status(404).json({ error: "Customer not found." });

      const customer = await saveCustomer({ ...existing, ...req.body });
      return res.status(200).json({ customer });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Customer request failed." });
  }
}
