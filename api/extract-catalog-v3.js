import { setCorsHeaders } from "./_lib/cors.js";
import { saveCatalog, cleanCatalogId } from "./_lib/catalogStore.js";

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

function parseJson(text) {
  const raw = String(text || "").trim();
  try { return JSON.parse(raw); } catch (_e) {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI did not return JSON.");
  return JSON.parse(match[0]);
}

async function fetchSource(url) {
  const response = await fetch(url, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0 Cabinet Visualizer Catalog Engine V3" } });
  if (!response.ok) throw new Error(`Could not read source: ${url}`);
  const contentType = response.headers.get("content-type") || "";
  const bytes = await response.arrayBuffer();
  const isPdf = contentType.includes("pdf") || url.toLowerCase().includes(".pdf");
  return { url, isPdf, contentType, bytes };
}

async function uploadPdfToOpenAI(source, index) {
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("file", new Blob([source.bytes], { type: "application/pdf" }), `catalog-source-${index + 1}.pdf`);
  const response = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "OpenAI PDF upload failed.");
  return data.id;
}

async function htmlToText(source) {
  const html = new TextDecoder().decode(source.bytes);
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 60000);
}

async function callOpenAIV3({ name, sources }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  const content = [{ type: "input_text", text: `You are Catalog Extraction Engine V3 for a cabinet visualizer. Read the attached PDF catalogs and source text visually and semantically. Extract cabinet lines/collections, every door style, every finish/color/stain/paint, species/materials, and any obvious image/swatch references. Return JSON only with this shape: {"lines":[{"name":"collection or product line","description":"short description","doors":[{"name":"door style name","description":"short description","image":""}],"finishes":[{"name":"finish/color name","description":"paint/stain/species notes","swatch":""}],"species":["wood/material names"]}],"notes":"brief extraction notes"}. Do not invent names. If a catalog has a shared finish palette, copy it to relevant lines. Manufacturer/catalog name: ${name}.` }];
  const uploadedFileIds = [];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    content.push({ type: "input_text", text: `SOURCE ${i + 1}: ${source.url}` });
    if (source.isPdf) {
      const fileId = await uploadPdfToOpenAI(source, i);
      uploadedFileIds.push(fileId);
      content.push({ type: "input_file", file_id: fileId });
    } else {
      content.push({ type: "input_text", text: await htmlToText(source) });
    }
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.CATALOG_EXTRACT_MODEL || "gpt-4.1-mini",
      input: [{ role: "user", content }],
      max_output_tokens: 16000
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "OpenAI V3 extraction failed.");
  return { extracted: parseJson(data.output_text || JSON.stringify(data)), uploadedFileIds };
}

function normalize(name, extracted) {
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

function statsFor(lines, sources) {
  return {
    sources: sources.length,
    pdfSources: sources.filter(s => s.isPdf).length,
    lines: lines.length,
    doors: lines.reduce((sum, line) => sum + line.doors.length, 0),
    finishes: lines.reduce((sum, line) => sum + line.finishes.length, 0),
    species: Array.from(new Set(lines.flatMap(line => line.species || []))).length
  };
}

export default async function handler(req, res) {
  if (setCorsHeaders(req, res, "POST, OPTIONS")) return;
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!requireAdmin(req, res)) return;

  try {
    const body = req.body || {};
    const name = String(body.name || "Imported Catalog").trim();
    const catalogId = cleanCatalogId(body.catalogId || slug(name));
    const urls = sourceUrls(body);
    if (!catalogId) throw new Error("Manufacturer name is required.");
    if (!urls.length) throw new Error("Add at least one catalog source link.");

    const sources = [];
    for (const url of urls) sources.push(await fetchSource(url));
    const { extracted, uploadedFileIds } = await callOpenAIV3({ name, sources });
    const lines = normalize(name, extracted);

    const catalog = await saveCatalog({
      catalogId,
      name,
      version: String(body.version || new Date().toISOString().slice(0, 10)),
      sourceType: urls.length > 1 ? "catalog-engine-v3-multi" : "catalog-engine-v3",
      sourceUrl: urls[0],
      sourceUrls: urls,
      notes: extracted.notes || "Catalog Extraction Engine V3 complete.",
      extraction: { engine: "v3", status: lines.length ? "ready" : "needs-review", updatedAt: new Date().toISOString(), openAiFileIds: uploadedFileIds },
      stats: statsFor(lines, sources),
      manufacturers: [{ id: slug(name), name, sourceUrl: urls[0], sourceUrls: urls, lines }]
    });

    return res.status(200).json({ catalog, message: lines.length ? "Catalog Extraction Engine V3 complete." : "Catalog saved but no lines were extracted yet." });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Catalog extraction failed." });
  }
}
