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

function door(name, desc, image = "") {
  return {
    id: cleanId(name),
    label: name,
    value: `Aristokraft ${name} cabinet door style`,
    image,
    desc: desc || "Aristokraft cabinet door style"
  };
}

function finish(name, type, swatch = "") {
  return {
    id: cleanId(name),
    label: name,
    value: `Aristokraft ${name} ${type || "cabinet finish"}`,
    image: swatch,
    swatch
  };
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function assetUrl(sourceUrl, path) {
  try {
    return new URL(path, sourceUrl).href;
  } catch (_error) {
    return "";
  }
}

async function imageExists(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok && String(response.headers.get("content-type") || "").startsWith("image/");
  } catch (_error) {
    return false;
  }
}

async function discoverFlipbookImages(sourceUrl) {
  const found = [];
  if (!sourceUrl) return found;

  try {
    const htmlResponse = await fetch(sourceUrl, { cache: "no-store" });
    const html = await htmlResponse.text().catch(function() { return ""; });
    const matches = html.match(/(?:src|href)=["']([^"']+\.(?:jpg|jpeg|png|webp))(?:\?[^"']*)?["']/gi) || [];
    matches.forEach(function(match) {
      const inner = match.match(/["']([^"']+)/)?.[1];
      if (inner) found.push(assetUrl(sourceUrl, inner));
    });
  } catch (_error) {}

  found.push(assetUrl(sourceUrl, "files/assets/cover/1.jpg"));

  const candidates = [];
  for (let i = 1; i <= 36; i += 1) {
    const padded = String(i).padStart(4, "0");
    candidates.push(assetUrl(sourceUrl, `files/assets/mobile/pages/page${padded}.jpg`));
    candidates.push(assetUrl(sourceUrl, `files/assets/common/page-html5-substrates/page${padded}_1.jpg`));
  }

  const checks = await Promise.all(candidates.map(async function(url) {
    return (await imageExists(url)) ? url : "";
  }));

  return unique([...found, ...checks]);
}

async function aristokraftCatalog(sourceUrl, version) {
  const catalogImages = await discoverFlipbookImages(sourceUrl);
  const coverImage = catalogImages[0] || "";
  const doorPageImages = catalogImages.slice(1, 14);
  const finishPageImages = catalogImages.slice(14, 30);

  const doorData = [
    ["Benton", "Shaker-style cabinet door"],
    ["Brellin", "Wide rail shaker-style cabinet door"],
    ["Briarcliff II", "Traditional raised-panel cabinet door"],
    ["Durham", "Classic recessed-panel cabinet door"],
    ["Ellis", "Simple shaker-style cabinet door"],
    ["Glyn", "Clean transitional cabinet door"],
    ["Lillian", "Decorative traditional cabinet door"],
    ["Maddox", "Modern flat/recessed cabinet door"],
    ["Quill", "Contemporary cabinet door"],
    ["Sinclair", "Popular shaker-style cabinet door"],
    ["Teagan", "Classic transitional cabinet door"],
    ["Winstead", "Traditional raised-panel cabinet door"]
  ];

  const doors = doorData.map(function(item, index) {
    return door(item[0], item[1], doorPageImages[index] || coverImage);
  });

  const paintedNames = ["PureStyle White", "White", "Frost", "Stone Gray", "Flagstone", "Burlap", "Sarsaparilla", "Colada", "Mythic Blue", "Sage"];
  const woodNames = ["Natural", "Cafe", "Umber", "Cocoa", "Autumn Brown", "Flagstone Stain"];

  const painted = paintedNames.map(function(name, index) {
    return finish(name, "painted cabinet finish", finishPageImages[index] || coverImage);
  });

  const wood = woodNames.map(function(name, index) {
    return finish(name, "wood stain cabinet finish", finishPageImages[index + painted.length] || coverImage);
  });

  return {
    name: "Aristokraft",
    catalogId: "aristokraft",
    version,
    sourceType: "url",
    sourceUrl,
    notes: `Imported with ${doors.length} door styles, ${painted.length + wood.length} finishes, and ${catalogImages.length} discovered catalog image assets. Exact cropped door/swatch snippets can replace page-level images as the image cropper is added.`,
    extraction: {
      sourceUrl,
      imageAssets: catalogImages,
      extractedAt: new Date().toISOString(),
      status: catalogImages.length ? "assets-discovered" : "starter-data-only"
    },
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

async function starterCatalogFromImport(body) {
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
    const catalogShell = await starterCatalogFromImport(req.body || {});
    const catalog = await saveCatalog(catalogShell);
    return res.status(200).json({
      catalog,
      message: catalog.extraction?.status === "assets-discovered"
        ? "Catalog imported with discovered image assets."
        : "Catalog saved to library."
    });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Catalog import failed." });
  }
}
