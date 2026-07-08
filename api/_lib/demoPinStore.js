import { getRedis } from "./redisClient.js";

const DEMO_PIN_PREFIX = "visualizer:demo-pin:";
const DEMO_TYPES = new Set(["showroom", "lead", "custom", "all"]);
const DURATIONS = new Set([24, 48, 72, 168, 336, 720]);

function pinKey(pin) {
  return DEMO_PIN_PREFIX + String(pin || "").trim();
}

export function normalizeDemoType(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeDurationHours(value) {
  const hours = Number(value);
  return Number.isFinite(hours) ? hours : 0;
}

export function normalizeDemoPin(value) {
  return String(value || "").trim();
}

export function isValidDemoType(value) {
  return DEMO_TYPES.has(normalizeDemoType(value));
}

export function isValidDurationHours(value) {
  return DURATIONS.has(normalizeDurationHours(value));
}

export function createDemoPin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function saveDemoPin(record) {
  const redis = getRedis();
  const ttlSeconds = Math.max(60, Math.ceil((new Date(record.expiresAt).getTime() - Date.now()) / 1000));
  await redis.set(pinKey(record.pin), record, { ex: ttlSeconds });
  return record;
}

export async function getDemoPin(pin) {
  const redis = getRedis();
  const record = await redis.get(pinKey(pin));
  if (!record) return null;
  if (Date.now() >= new Date(record.expiresAt).getTime()) return null;
  return record;
}

export async function deactivateDemoPin(pin) {
  const safePin = normalizeDemoPin(pin);
  const record = await getDemoPin(safePin);
  if (!record) throw new Error("Demo PIN not found or expired.");
  const updated = {
    ...record,
    status: "inactive",
    deactivatedAt: new Date().toISOString()
  };
  await saveDemoPin(updated);
  return updated;
}

export async function deleteDemoPin(pin) {
  const redis = getRedis();
  const safePin = normalizeDemoPin(pin);
  if (!safePin) throw new Error("Demo PIN is required.");
  await redis.del(pinKey(safePin));
  return { pin: safePin, deleted: true };
}
