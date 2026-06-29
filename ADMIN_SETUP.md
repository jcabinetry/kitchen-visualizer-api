# Admin Dashboard Setup

This repo includes an owner admin dashboard for managing cabinet visualizer customers.

## Files

- `admin.html` - browser-based owner dashboard.
- `api/admin/customers.js` - admin API for listing, creating, editing, and archiving customers.
- `api/admin/usage.js` - admin API for reading and resetting monthly usage.
- `api/_lib/adminAuth.js` - shared admin token protection.
- `api/_lib/cors.js` - shared CORS headers.
- `api/_lib/redisClient.js` - shared Upstash Redis client.
- `api/_lib/customerStore.js` - shared customer and usage data helpers.

## Required Vercel Environment Variables

Keep the existing variables already used by `api/generate.js`:

- `OPENAI_API_KEY`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

Add this admin variable:

- `ADMIN_API_TOKEN` - a strong private token used to open and use the admin dashboard.

Optional:

- `ADMIN_ALLOWED_ORIGIN` - set this to your deployed domain to restrict browser access. If omitted, the admin API allows any origin, but still requires `ADMIN_API_TOKEN`.

## How To Use

1. Deploy the project to Vercel.
2. Open `/admin.html` on the deployed site.
3. Enter the `ADMIN_API_TOKEN` when prompted.
4. Create or edit customer records.
5. Reset monthly usage when needed.

## Redis Keys

The admin dashboard supports the existing Upstash customer keys already used by the project:

- `customers`
- `customer:{companyKey}`

For forward compatibility, customer saves also mirror data to these names:

- `visualizer:customers:index`
- `visualizer:customer:{companyKey}`

Usage keys remain compatible with the existing generator:

- `visualizer:{companyKey}:{YYYY-MM}:used`
- `visualizer:{companyKey}:{YYYY-MM}:limitEmailSent`

## Current Scope

The existing visualizer endpoint still accepts customer settings from the website request. The next architecture step is to update `api/generate.js` so it can look up `companyKey` in Redis and use stored settings such as `companyName` and `monthlyLimit` automatically.
