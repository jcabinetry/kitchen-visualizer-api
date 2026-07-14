import sharp from "sharp";
import { getRedis } from "./redisClient.js";
import { getCatalog, saveCatalog } from "./catalogStore.js";
import { generateCatalogReferenceImage } from "../generate-catalog-reference.js";

const QUEUE_KEY = "visualizer:catalog-ai-reference-jobs:queue";
const JOB_PREFIX = "visualizer:catalog-ai-reference-job:";

function jobKey(id) {
  return `${JOB_PREFIX}${id}`;
}

function parseMaybeJson(value) {
  if (!value || typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return value;
  }
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function makeJobId(catalogId, manufacturerIndex, lineIndex, doorIndex, kind) {
  return [catalogId, manufacturerIndex, lineIndex, doorIndex, kind].join(":");
}

function getDoorByJob(catalog, job) {
  return catalog
    ?.manufacturers?.[job.manufacturerIndex]
    ?.lines?.[job.lineIndex]
    ?.doors?.[job.doorIndex] || null;
}

async function compressReferenceImage(dataUrl, kind) {
  if (!String(dataUrl || "").startsWith("data:image/")) return dataUrl;
  const base64 = String(dataUrl).split(",")[1] || "";
  if (!base64) return dataUrl;

  const image = sharp(Buffer.from(base64, "base64")).rotate();
  const metadata = await image.metadata().catch(() => ({}));
  const maxWidth = kind === "drawer" ? 900 : 900;
  const width = metadata.width || 0;
  const pipeline = width > maxWidth ? image.resize({ width: maxWidth, withoutEnlargement: true }) : image;
  const output = await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  return `data:image/jpeg;base64,${output.toString("base64")}`;
}

export function findMissingCatalogAiReferenceJobs(catalog) {
  const jobs = [];
  (catalog.manufacturers || []).forEach(function(manufacturer, manufacturerIndex) {
    (manufacturer.lines || []).forEach(function(line, lineIndex) {
      (line.doors || []).forEach(function(door, doorIndex) {
        const catalogId = catalog.catalogId;
        if ((door.image || door.thumbnail) && !(door.aiDoorReference || door.aiImage)) {
          jobs.push({
            id: makeJobId(catalogId, manufacturerIndex, lineIndex, doorIndex, "door"),
            catalogId,
            manufacturerIndex,
            lineIndex,
            doorIndex,
            kind: "door",
            doorLabel: door.label || door.name || ""
          });
        }
        if ((door.drawerImage || door.drawerThumbnail) && !(door.aiDrawerReference || door.aiDrawerImage)) {
          jobs.push({
            id: makeJobId(catalogId, manufacturerIndex, lineIndex, doorIndex, "drawer"),
            catalogId,
            manufacturerIndex,
            lineIndex,
            doorIndex,
            kind: "drawer",
            doorLabel: door.label || door.name || ""
          });
        }
      });
    });
  });
  return jobs;
}

export async function enqueueMissingCatalogAiReferenceJobs(catalog) {
  const redis = getRedis();
  const now = new Date().toISOString();
  const jobs = findMissingCatalogAiReferenceJobs(catalog);
  let queued = 0;

  for (const job of jobs) {
    const key = jobKey(job.id);
    const existing = parseMaybeJson(await redis.get(key).catch(() => null));
    if (existing && ["queued", "running", "complete"].includes(existing.status)) continue;

    await redis.set(key, {
      ...job,
      status: "queued",
      attempts: Number(existing?.attempts || 0),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    });
    await redis.rpush(QUEUE_KEY, job.id);
    queued += 1;
  }

  return { queued, pending: jobs.length };
}

export async function processCatalogAiReferenceJobs({ limit = 1 } = {}) {
  const redis = getRedis();
  const processed = [];
  const errors = [];
  const max = Math.max(1, Math.min(Number(limit) || 1, 3));

  for (let index = 0; index < max; index += 1) {
    const jobId = await redis.lpop(QUEUE_KEY).catch(() => null);
    if (!jobId) break;

    const key = jobKey(jobId);
    const job = parseMaybeJson(await redis.get(key).catch(() => null));
    if (!job || job.status === "complete") continue;

    const now = new Date().toISOString();
    await redis.set(key, { ...job, status: "running", attempts: Number(job.attempts || 0) + 1, updatedAt: now });

    try {
      const catalog = await getCatalog(job.catalogId);
      if (!catalog) throw new Error("Catalog not found.");
      const door = getDoorByJob(catalog, job);
      if (!door) throw new Error("Door style not found.");

      const source = job.kind === "drawer"
        ? (door.drawerImage || door.drawerThumbnail || "")
        : (door.image || door.thumbnail || "");
      const existingReference = job.kind === "drawer"
        ? (door.aiDrawerReference || door.aiDrawerImage || "")
        : (door.aiDoorReference || door.aiImage || "");

      if (!hasValue(source)) throw new Error("Source image is missing.");
      if (hasValue(existingReference)) {
        await redis.set(key, { ...job, status: "complete", completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), skipped: true });
        processed.push({ id: job.id, status: "complete", skipped: true });
        continue;
      }

      const generated = await generateCatalogReferenceImage({
        kind: job.kind,
        name: door.label || door.name || job.doorLabel || "",
        image: source
      });
      const compressed = await compressReferenceImage(generated, job.kind);

      if (job.kind === "drawer") {
        door.aiDrawerReference = compressed;
        door.aiDrawerImage = compressed;
      } else {
        door.aiDoorReference = compressed;
        door.aiImage = compressed;
      }

      await saveCatalog(catalog);
      await redis.set(key, { ...job, status: "complete", completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      processed.push({ id: job.id, status: "complete" });
    } catch (error) {
      const failed = { ...job, status: "failed", error: error?.message || "AI reference job failed.", updatedAt: new Date().toISOString() };
      await redis.set(key, failed);
      errors.push({ id: job.id, error: failed.error });
    }
  }

  return { processed, errors };
}
