import { setCorsHeaders } from "./_lib/cors.js";
import { saveCatalog } from "./_lib/catalogStore.js";
import pdfParse from "pdf-parse";

const MAX_TEXT = 120000;
const MAX_IMAGES = 80;

function slug(value) {
  return String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 90);
}

function requireAdmin(req, res) {
  const required = process.env.ADMIN_API_TOKEN || process.env.ADMIN_TOKEN || "";
  if (!required) return true;
  const supplied = req.headers["x-admin-token"] || req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (supplied === required) return true;
  res.status(401).json({ error: "Unauthorized." });
  return false;
}

function sourceUrls(body = {}) {
  const joined = [body.sourceUrl, body.catalogUrl, body.url, body.sourceUrls].flat().filter(Boolean).join("\n");
  return Array.from(new Set(joined.split(/\n+/).map(v => v.trim()).filter(Boolean)));
}

function stripHtml(html) {
  return String(html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function imageUrlsFromHtml(html, baseUrl) {
  const found = [];
  const pattern = /(?:src|href)=["']([^"']+\.(?:jpg|jpeg|png|webp))(?:\?[^"']*)?["']/gi;
  let match;
  while ((match = pattern.exec(String(html || "")))) {
    try { found.push(new URL(match[1], baseUrl).href); } catch (_e) {}
  }
  return Array.from(new Set(found)).slice(0, MAX_IMAGES);
}

function compactCatalogText(text) {
  const raw = String(text || "").replace(/\r/g, "\n");
  const lines = raw.split(/\n+/).map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const keywords = /door|style|finish|color|colour|paint|stain|species|wood|maple|oak|cherry|hickory|alder|birch|thermofoil|laminate|classic|collection|available|selection|palette|drawer|panel|shaker/i;
  const picked = [];
  for (let i = 0; i < lines.length; i++) {
    if (keywords.test(lines[i])) {
      picked.push(lines[i - 2], lines[i - 1], lines[i], lines[i + 1], lines[i + 2]);
    }
  }
  const joined = Array.from(new Set(picked.filter(Boolean))).join("\n");
  const front = lines.slice(0, 350).join("\n");
  const back = lines.slice(-350).join("\n");
  return [front, joined, back].join("\n\n--- KEY CATALOG LINES ---\n\n").slice(0, MAX_TEXT);
}

async function readSource(url) {
  const response = await fetch(url, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0 Cabinet Visualizer Catalog Extractor" } });
  if (!response.ok) throw new Error(`Could not read catalog source: ${url}`);
  const contentType = response.headers.get("content-type") || "";
  const arrayBuffer = await response.arrayBuffer();
  const isPdf = contentType.includes("pdf") || url.toLowerCase().includes(".pdf");
  if (isPdf) {
    const parsed = await pdfParse(Buffer.from(arrayBuffer));
    return { url, kind: "pdf", text: parsed.text || "", images: [] };
  }
  const html = new TextDecoder().decode(arrayBuffer);
  return { url, kind: "html", text: stripHtml(html), images: imageUrlsFromHtml(html, url) };
}

async function readAllSources(urls) {
  const results = [];
  for (const url of urls) {
    try { results.push(await readSource(url)); }
    catch (error) { results.push({ url, kind: "error", text: `ERROR: ${error.message}`, images: [] }); }
  }
  return results;
}

function parseJson(text) {
  const raw = String(text || "").trim();
  try { return JSON.parse(raw); } catch (_e) {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI did not return JSON.");
  return JSON.parse(match[0]);
}

function option(name, kind, brand) {
  const label = String(name || "").trim();
  return kind === "finish"
    ? { name: label, description: `${brand} catalog finish`, swatch: "" }
    : { name: label, description: `${brand} catalog door style`, image: "" };
}

function heuristicExtract(name, sources) {
  const text = sources.map(s => s.text || "").join("\n");
  const words = Array.from(new Set(String(text).match(/\b[A-Z][A-Za-z0-9'&. -]{2,34}\b/g) || []));
  const stop = /^(The|And|For|With|Door|Doors|Style|Styles|Finish|Finishes|Color|Colors|Cabinet|Cabinets|Kitchen|Bathroom|Classic|Selection|Guide|Page|Table|Contents|Available|Shown|See|Also|All|New|Use|Base|Wall)$/i;
  const finishWords = /white|gray|grey|black|brown|natural|stain|paint|maple|oak|cherry|hickory|alder|birch|pecan|cognac|espresso|slate|linen|cotton|dove|moon|cappuccino|cider|clove|java|mist|sage|navy|blue|sand|burlap|fawn|toast|umber|cocoa|vanilla|cream|almond|chiffon|pebble|riverbed|driftwood/i;
  const doorWords = /shaker|slab|raised|recessed|panel|arch|square|mission|miter|bead|beaded|cathedral|flat|door|routed|overlay|drawer/i;
  const finishes = words.filter(w => finishWords.test(w) && !stop.test(w)).slice(0, 120).map(w => option(w, "finish", name));
  const doors = words.filter(w => doorWords.test(w) && !finishWords.test(w) && !stop.test(w)).slice(0, 120).map(w => option(w, "door", name));
  const species = Array.from(new Set((text.match(/\b(Maple|Oak|Cherry|Hickory|Alder|Birch|Walnut|Thermofoil|Laminate|MDF|HDF)\b/gi) || []).map(s => s[0].toUpperCase() + s.slice(1).toLowerCase())));
  return { lines: [{ name: "Catalog Extracted", description: "Heuristic fallback extraction from PDF text.", doors, finishes, species }], notes: "AI returned no usable items, so a fallback extraction was used." };
}

async function callOpenAI({ name, sources }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  const sourceText = sources.map((s, i) => `SOURCE ${i + 1}: ${s.url}\nTYPE: ${s.kind}\nTEXT:\n${compactCatalogText(s.text)}`).join("\n\n---\n\n").slice(0, MAX_TEXT);
  const imageCandidates = sources.flatMap(s => s.images || []).slice(0, MAX_IMAGES);
  const prompt = `Extract a cabinet manufacturer catalog for a cabinet visualizer. Return JSON only. Extract as many real catalog items as possible from the text, including door styles, finishes/colors, and species. Do not return empty arrays if names are present. Shape: {"lines":[{"name":"line or collection","description":"short description","doors":[{"name":"door style name","description":"short description","image":""}],"finishes":[{"name":"finish/color name","description":"paint/stain/species info if available","swatch":""}],"species":["species names"]}],"notes":"brief notes"}. Manufacturer/catalog: ${name}. Candidate image URLs: ${imageCandidates.join("\n")}. Catalog text:\n${sourceText}`;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: process.env.CATALOG_EXTRACT_MODEL || "gpt-4.1-mini", input: prompt, max_output_tokens: 12000 })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "OpenAI extraction failed.");
  return parseJson(data.output_text || JSON.stringify(data));
}

function normalize(name, extracted) {
  const lines = Array.isArray(extracted?.lines) ? extracted.lines : [];
  return lines.map((line, index) => {
    const lineName = String(line.name || `Catalog Line ${index + 1}`).trim();
    const doors = Array.isArray(line.doors) ? line.doors : [];
    const finishes = Array.isArray(line.finishes) ? line.finishes : [];
    return {
      id: slug(lineName) || `line-${index + 1}`,
      name: lineName,
      description: String(line.description || "").trim(),
      doors: doors.map(d => {
        const label = String(d.name || d.label || "").trim();
        return { id: slug(label), label, value: `${name} ${label} cabinet door style`, image: d.image || "", thumbnail: d.image || "", desc: String(d.description || "Cabinet door style").trim() };
      }).filter(d => d.label),
      finishes: finishes.map(f => {
        const label = String(f.name || f.label || "").trim();
        const img = f.swatch || f.image || "";
        return { id: slug(label), label, value: `${name} ${label} cabinet finish`, image: img, swatch: img, thumbnail: img, desc: String(f.description || "Cabinet finish").trim() };
      }).filter(f => f.label),
      species: Array.isArray(line.species) ? line.species.map(String).filter(Boolean) : []
    };
  }).filter(l => l.doors.length || l.finishes.length || l.species.length);
}

export default async function handler(req, res) {
  if (setCorsHeaders(req, res, "POST, OPTIONS")) return;
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!requireAdmin(req, res)) return;

  try {
    const body = req.body || {};
    const name = String(body.name || "Imported Catalog").trim();
    const catalogId = slug(body.catalogId || name);
    const urls = sourceUrls(body);
    if (!catalogId) throw new Error("Manufacturer name is required.");
    if (!urls.length) throw new Error("At least one catalog source URL is required.");
    const sources = await readAllSources(urls);
    let extracted = await callOpenAI({ name, sources });
    let lines = normalize(name, extracted);
    if (!lines.length) {
      extracted = heuristicExtract(name, sources);
      lines = normalize(name, extracted);
    }
    if (!lines.length) throw new Error("No doors, finishes, or species were extracted. Try adding another source link.");
    const catalog = await saveCatalog({
      catalogId,
      name,
      version: String(body.version || new Date().toISOString().slice(0, 10)),
      sourceType: urls.length > 1 ? "multi-source-ai" : "single-source-ai",
      sourceUrl: urls[0],
      sourceUrls: urls,
      notes: extracted.notes || "AI catalog extraction complete.",
      extraction: { status: "extracted", updatedAt: new Date().toISOString(), sourceCount: urls.length, textChars: sources.reduce((sum, s) => sum + String(s.text || "").length, 0), imageCandidateCount: sources.flatMap(s => s.images || []).length },
      manufacturers: [{ id: slug(name), name, sourceUrl: urls[0], sourceUrls: urls, lines }]
    });
    return res.status(200).json({ catalog, message: "AI catalog extraction complete." });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Catalog extraction failed." });
  }
}
