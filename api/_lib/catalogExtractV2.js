import pdfParse from "pdf-parse";

const MAX_SOURCE_TEXT = 55000;
const MAX_OUTPUT_TOKENS = 12000;

export function slug(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);
}

export function parseSources(body = {}) {
  const joined = [body.sourceUrl, body.catalogUrl, body.url, body.sourceUrls]
    .flat()
    .filter(Boolean)
    .join("\n");
  return Array.from(new Set(joined.split(/\n+/).map(v => v.trim()).filter(Boolean)));
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function imageUrlsFromHtml(html, baseUrl) {
  const found = [];
  const pattern = /(?:src|href)=["']([^"']+\.(?:jpg|jpeg|png|webp))(?:\?[^"']*)?["']/gi;
  let match;
  while ((match = pattern.exec(String(html || "")))) {
    try { found.push(new URL(match[1], baseUrl).href); } catch (_error) {}
  }
  return Array.from(new Set(found)).slice(0, 120);
}

function prioritizeText(text) {
  const lines = String(text || "")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const important = /door|style|finish|finishes|color|colour|paint|stain|species|wood|maple|oak|cherry|hickory|alder|birch|walnut|thermofoil|laminate|mdf|hdf|collection|classic|base|wall|available|selection|palette|panel|shaker|slab|raised|recessed/i;
  const picked = [];
  lines.forEach((line, index) => {
    if (important.test(line)) picked.push(lines[index - 2], lines[index - 1], line, lines[index + 1], lines[index + 2]);
  });
  return [lines.slice(0, 400).join("\n"), Array.from(new Set(picked.filter(Boolean))).join("\n"), lines.slice(-250).join("\n")].join("\n\n").slice(0, MAX_SOURCE_TEXT);
}

export async function readCatalogSource(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "user-agent": "Mozilla/5.0 Cabinet Visualizer Catalog Engine" }
  });
  if (!response.ok) throw new Error(`Could not read ${url}`);
  const contentType = response.headers.get("content-type") || "";
  const bytes = await response.arrayBuffer();
  const lower = url.toLowerCase();
  const isPdf = contentType.includes("pdf") || lower.includes(".pdf");

  if (isPdf) {
    const parsed = await pdfParse(Buffer.from(bytes));
    return { url, kind: "pdf", text: parsed.text || "", textChars: String(parsed.text || "").length, images: [] };
  }

  const html = new TextDecoder().decode(bytes);
  return { url, kind: "html", text: stripHtml(html), textChars: html.length, images: imageUrlsFromHtml(html, url) };
}

export async function readCatalogSources(urls) {
  const results = [];
  for (const url of urls) {
    try { results.push(await readCatalogSource(url)); }
    catch (error) { results.push({ url, kind: "error", text: `ERROR: ${error.message}`, textChars: 0, images: [] }); }
  }
  return results;
}

function parseJsonFromText(value) {
  const raw = String(value || "").trim();
  try { return JSON.parse(raw); } catch (_error) {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI did not return JSON.");
  return JSON.parse(match[0]);
}

async function callAiExtractor({ name, sources }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  const text = sources.map((source, index) => {
    return `SOURCE ${index + 1}\nURL: ${source.url}\nTYPE: ${source.kind}\nTEXT:\n${prioritizeText(source.text)}`;
  }).join("\n\n---\n\n");
  const images = sources.flatMap(source => source.images || []).slice(0, 100);
  const prompt = `You are Catalog Extraction Engine v2 for a cabinet visualizer. Extract a complete cabinet manufacturer catalog from all supplied sources. Some sources are door catalogs, some are color/finish guides, and some are spec sheets. Merge them into one catalog. Return JSON only in this shape: {"lines":[{"name":"collection or product line","description":"short description","doors":[{"name":"door style name","description":"short useful description","image":"exact image url only if obvious, otherwise empty"}],"finishes":[{"name":"finish/color name","description":"paint/stain/species notes if available","swatch":"exact image url only if obvious, otherwise empty"}],"species":["wood/species/material names"]}],"notes":"brief extraction notes"}. Extract as many real names as possible. Do not invent marketing names. If finishes are shared across lines, copy them to each relevant line. Manufacturer/catalog name: ${name}. Candidate image URLs: ${images.join("\n")}. Source text: ${text}`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: process.env.CATALOG_EXTRACT_MODEL || "gpt-4.1-mini", input: prompt, max_output_tokens: MAX_OUTPUT_TOKENS })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "AI extraction failed.");
  return parseJsonFromText(data.output_text || JSON.stringify(data));
}

function fallbackExtract(name, sources) {
  const text = sources.map(source => source.text || "").join("\n");
  const candidates = Array.from(new Set(String(text).match(/\b[A-Z][A-Za-z0-9'&. -]{2,34}\b/g) || []));
  const finishRegex = /white|gray|grey|black|brown|natural|stain|paint|maple|oak|cherry|hickory|alder|birch|walnut|pecan|cognac|espresso|slate|linen|cotton|dove|moon|cappuccino|cider|clove|java|mist|sage|navy|blue|sand|burlap|fawn|toast|umber|cocoa|vanilla|cream|almond|chiffon|pebble|riverbed|driftwood/i;
  const doorRegex = /shaker|slab|raised|recessed|panel|arch|square|mission|miter|bead|cathedral|flat|overlay|drawer/i;
  const stop = /^(The|And|For|With|Door|Doors|Style|Styles|Finish|Finishes|Color|Colors|Cabinet|Cabinets|Kitchen|Classic|Selection|Guide|Page|Table|Contents|Available|Shown|See|Also|All|New|Use|Base|Wall)$/i;
  const finishes = candidates.filter(v => finishRegex.test(v) && !stop.test(v)).slice(0, 140).map(name => ({ name, description: "Catalog finish", swatch: "" }));
  const doors = candidates.filter(v => doorRegex.test(v) && !finishRegex.test(v) && !stop.test(v)).slice(0, 140).map(name => ({ name, description: "Catalog door style", image: "" }));
  const species = Array.from(new Set((text.match(/\b(Maple|Oak|Cherry|Hickory|Alder|Birch|Walnut|Thermofoil|Laminate|MDF|HDF)\b/gi) || []).map(v => v[0].toUpperCase() + v.slice(1).toLowerCase())));
  return { lines: [{ name: "Catalog Extracted", description: "Fallback extraction from catalog text.", doors, finishes, species }], notes: "Fallback extraction used." };
}

export function normalizeExtractedCatalog(name, extracted) {
  const lines = Array.isArray(extracted?.lines) ? extracted.lines : [];
  return lines.map((line, index) => {
    const lineName = String(line.name || `Catalog Line ${index + 1}`).trim();
    return {
      id: slug(lineName) || `line-${index + 1}`,
      name: lineName,
      description: String(line.description || "").trim(),
      doors: (Array.isArray(line.doors) ? line.doors : []).map(door => {
        const label = String(door.name || door.label || "").trim();
        return { id: slug(label), label, value: `${name} ${label} cabinet door style`, image: door.image || "", thumbnail: door.image || "", desc: String(door.description || "Catalog door style").trim() };
      }).filter(door => door.label),
      finishes: (Array.isArray(line.finishes) ? line.finishes : []).map(finish => {
        const label = String(finish.name || finish.label || "").trim();
        const image = finish.swatch || finish.image || "";
        return { id: slug(label), label, value: `${name} ${label} cabinet finish`, image, swatch: image, thumbnail: image, desc: String(finish.description || "Catalog finish").trim() };
      }).filter(finish => finish.label),
      species: Array.isArray(line.species) ? Array.from(new Set(line.species.map(String).filter(Boolean))) : []
    };
  }).filter(line => line.doors.length || line.finishes.length || line.species.length);
}

export async function extractCatalogV2({ name, sourceUrls }) {
  const sources = await readCatalogSources(sourceUrls);
  let extracted;
  try { extracted = await callAiExtractor({ name, sources }); }
  catch (error) { extracted = { ...fallbackExtract(name, sources), notes: `AI failed: ${error.message}. Fallback extraction used.` }; }

  let lines = normalizeExtractedCatalog(name, extracted);
  if (!lines.length) {
    extracted = fallbackExtract(name, sources);
    lines = normalizeExtractedCatalog(name, extracted);
  }

  const stats = {
    sources: sourceUrls.length,
    textChars: sources.reduce((sum, source) => sum + (source.textChars || String(source.text || "").length), 0),
    imageCandidates: sources.flatMap(source => source.images || []).length,
    lines: lines.length,
    doors: lines.reduce((sum, line) => sum + line.doors.length, 0),
    finishes: lines.reduce((sum, line) => sum + line.finishes.length, 0),
    species: Array.from(new Set(lines.flatMap(line => line.species || []))).length
  };

  return { lines, sources, stats, notes: extracted.notes || "Catalog Extraction Engine v2 complete." };
}
