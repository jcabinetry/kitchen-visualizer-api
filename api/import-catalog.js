import { setCorsHeaders } from "./_lib/cors.js";
import { saveCatalog } from "./_lib/catalogStore.js";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
}

function requireAdmin(req, res) {
  const required = process.env.ADMIN_API_TOKEN || process.env.ADMIN_TOKEN || "";
  if (!required) return true;
  const supplied = req.headers["x-admin-token"] || req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (supplied === required) return true;
  res.status(401).json({ error: "Unauthorized." });
  return false;
}

function cleanId(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function cleanNameFromUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "Imported Catalog";
  if (/aristokraft/i.test(value)) return "Aristokraft";
  if (/cabdoor/i.test(value)) return "CabDoor";
  if (/fabuwood/i.test(value)) return "Fabuwood";
  if (/kraftmaid/i.test(value)) return "KraftMaid";
  if (/kemper/i.test(value)) return "Kemper";
  if (/waypoint/i.test(value)) return "Waypoint";
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return host.split(".")[0].replace(/-/g, " ").replace(/\b\w/g, function(c) { return c.toUpperCase(); });
  } catch (_error) {
    return "Imported Catalog";
  }
}

function door(name, desc) {
  return {
    id: cleanId(name),
    label: name,
    value: `Aristokraft ${name} cabinet door style`,
    image: "",
    desc: desc || "Aristokraft cabinet door style"
  };
}

function finish(name, type) {
  return {
    id: cleanId(name),
    label: name,
    value: `Aristokraft ${name} ${type || "cabinet finish"}`,
    image: "",
    swatch: ""
  };
}

function aristokraftCatalog(sourceUrl, version) {
  const doors = [
    door("Benton", "Shaker-style cabinet door"),
    door("Brellin", "Wide rail shaker-style cabinet door"),
    door("Briarcliff II", "Traditional raised-panel cabinet door"),
    door("Durham", "Classic recessed-panel cabinet door"),
    door("Ellis", "Simple shaker-style cabinet door"),
    door("Glyn", "Clean transitional cabinet door"),
    door("Lillian", "Decorative traditional cabinet door"),
    door("Maddox", "Modern flat/recessed cabinet door"),
    door("Quill", "Contemporary cabinet door"),
    door("Sinclair", "Popular shaker-style cabinet door"),
    door("Teagan", "Classic transitional cabinet door"),
    door("Winstead", "Traditional raised-panel cabinet door")
  ];

  const painted = [
    finish("PureStyle White", "painted cabinet finish"),
    finish("White", "painted cabinet finish"),
    finish("Frost", "painted cabinet finish"),
    finish("Stone Gray", "painted cabinet finish"),
    finish("Flagstone", "painted cabinet finish"),
    finish("Burlap", "painted cabinet finish"),
    finish("Sarsaparilla", "painted cabinet finish"),
    finish("Colada", "painted cabinet finish"),
    finish("Mythic Blue", "painted cabinet finish"),
    finish("Sage", "painted cabinet finish")
  ];

  const wood = [
    finish("Natural", "wood stain cabinet finish"),
    finish("Cafe", "wood stain cabinet finish"),
    finish("Umber", "wood stain cabinet finish"),
    finish("Cocoa", "wood stain cabinet finish"),
    finish("Autumn Brown", "wood stain cabinet finish"),
    finish("Flagstone Stain", "wood stain cabinet finish")
  ];

  return {
    name: "Aristokraft",
    catalogId: "aristokraft",
    version,
    sourceType: "url",
    sourceUrl,
    notes: "Starter extracted catalog with door styles, finish names, species, and image/swatch fields ready for cropped snippets.",
    manufacturers: [
      {
        id: "aristokraft",
        name: "Aristokraft",
        sourceUrl,
        lines: [
          {
            id: "door-selection-guide",
            name: "Door Selection Guide",
            description: "Door styles with painted and stained finish options.",
            doors,
            finishes: [...painted, ...wood],
            species: ["Birch", "Maple", "Oak", "Thermofoil", "PureStyle"]
          },
          {
            id: "painted-finishes",
            name: "Painted Finishes",
            description: "Painted cabinet finish options.",
            doors,
            finishes: painted,
            species: ["Paint", "PureStyle", "Thermofoil"]
          },
          {
            id: "wood-stain-finishes",
            name: "Wood Stain Finishes",
            description: "Wood stain cabinet finish options.",
            doors,
            finishes: wood,
            species: ["Birch", "Maple", "Oak"]
          }
        ]
      }
    ]
  };
}

function starterCatalogFromImport(body) {
  const name = String(body.name || cleanNameFromUrl(body.sourceUrl || body.catalogUrl || body.url)).trim();
  const version = String(body.version || new Date().toISOString().slice(0, 10)).trim();
  const sourceUrl = String(body.sourceUrl || body.catalogUrl || body.url || "").trim();

  if (/aristokraft/i.test(name) || /aristokraft/i.test(sourceUrl)) {
    return aristokraftCatalog(sourceUrl, version);
  }

  return {
    name,
    version,
    sourceType: sourceUrl ? "url" : "manual",
    sourceUrl,
    notes: "Imported catalog shell. Extraction workflow will fill lines, doors, finishes, and species.",
    manufacturers: [
      {
        id: cleanId(name),
        name,
        sourceUrl,
        lines: [
          {
            id: "import-pending",
            name: "Import Pending",
            description: "Catalog has been saved. Run extraction to populate real product lines.",
            doors: [],
            finishes: [],
            species: []
          }
        ]
      }
    ]
  };
}

export default async function handler(req, res) {
  if (setCorsHeaders(req, res, "POST, OPTIONS")) return;
  setNoStore(res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!requireAdmin(req, res)) return;

  try {
    const catalogShell = starterCatalogFromImport(req.body || {});
    const catalog = await saveCatalog(catalogShell);
    return res.status(200).json({ catalog, message: "Catalog saved to library." });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Catalog import failed." });
  }
}
