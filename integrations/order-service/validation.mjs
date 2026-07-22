import { createHash } from "node:crypto";

const ORDER_KEYS = new Set([
  "schemaVersion", "id", "createdAt", "site", "boat", "inputDimensions",
  "productionDimensions", "geometry", "manufacturing", "pricing", "customer",
  "consent", "plainText", "svg", "idempotencyKey",
]);
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export class ValidationError extends Error {
  constructor(code, field = null) {
    super(code);
    this.name = "ValidationError";
    this.code = code;
    this.field = field;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertStructuralLimits(value, depth = 0, budget = { nodes: 0 }) {
  budget.nodes += 1;
  if (depth > 20 || budget.nodes > 10_000) {
    throw new ValidationError("structure-too-complex", "body");
  }
  if (Array.isArray(value)) {
    if (value.length > 2_000) throw new ValidationError("structure-too-complex", "body");
    for (const item of value) assertStructuralLimits(item, depth + 1, budget);
    return;
  }
  if (!isObject(value)) return;
  const keys = Object.keys(value);
  if (keys.length > 100 || keys.some((key) => key.length > 100)) {
    throw new ValidationError("structure-too-complex", "body");
  }
  for (const key of keys) assertStructuralLimits(value[key], depth + 1, budget);
}

function requireObject(value, field) {
  if (!isObject(value)) throw new ValidationError("invalid-field", field);
}

function requireString(value, field, min, max) {
  if (typeof value !== "string") throw new ValidationError("invalid-field", field);
  const trimmed = value.trim();
  const length = Array.from(trimmed).length;
  if (length < min || length > max || CONTROL_RE.test(trimmed)) {
    throw new ValidationError("invalid-field", field);
  }
  return trimmed;
}

function requireFinite(value, field, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new ValidationError("invalid-field", field);
  }
}

function validateDimensions(value, field, production = false) {
  requireObject(value, field);
  requireFinite(value.lengthCm, `${field}.lengthCm`, 1, 1_000);
  requireFinite(value.constantWidthCm, `${field}.constantWidthCm`, 1, 500);
  if (!Array.isArray(value.bowStations) || value.bowStations.length < 2 || value.bowStations.length > 100) {
    throw new ValidationError("invalid-field", `${field}.bowStations`);
  }
  for (let index = 0; index < value.bowStations.length; index += 1) {
    const station = value.bowStations[index];
    const stationField = `${field}.bowStations[${index}]`;
    requireObject(station, stationField);
    requireFinite(station.offsetFromBowCm, `${stationField}.offsetFromBowCm`, 0, 1_000);
    requireFinite(
      production ? station.productionWidthCm : station.inputWidthCm,
      `${stationField}.${production ? "productionWidthCm" : "inputWidthCm"}`,
      1,
      500,
    );
  }
}

export function validateOrder(value, headerIdempotencyKey = null, allowedOrigin = null) {
  assertStructuralLimits(value);
  requireObject(value, "body");
  for (const key of Object.keys(value)) {
    if (!ORDER_KEYS.has(key)) throw new ValidationError("unknown-field", key);
  }
  if (value.schemaVersion !== 2) throw new ValidationError("unsupported-schema", "schemaVersion");

  const id = requireString(value.id, "id", 1, 128);
  const bodyKey = requireString(value.idempotencyKey, "idempotencyKey", 1, 128);
  if (!SAFE_ID_RE.test(id) || !SAFE_ID_RE.test(bodyKey)) {
    throw new ValidationError("invalid-field", !SAFE_ID_RE.test(id) ? "id" : "idempotencyKey");
  }
  if (headerIdempotencyKey !== null) {
    const headerKey = requireString(headerIdempotencyKey, "Idempotency-Key", 1, 128);
    if (!SAFE_ID_RE.test(headerKey) || headerKey !== bodyKey) {
      throw new ValidationError("idempotency-key-mismatch", "Idempotency-Key");
    }
  }

  const createdAt = requireString(value.createdAt, "createdAt", 20, 40);
  if (!Number.isFinite(Date.parse(createdAt))) throw new ValidationError("invalid-field", "createdAt");

  requireObject(value.site, "site");
  const siteOrigin = requireString(value.site.origin, "site.origin", 8, 2_048);
  if (allowedOrigin !== null && siteOrigin !== allowedOrigin) {
    throw new ValidationError("site-origin-mismatch", "site.origin");
  }
  requireObject(value.boat, "boat");
  if (!["rigid", "ndnd"].includes(value.boat.floorType)) {
    throw new ValidationError("invalid-field", "boat.floorType");
  }
  if (value.boat.name !== null && value.boat.name !== undefined) {
    requireString(value.boat.name, "boat.name", 1, 160);
  }

  validateDimensions(value.inputDimensions, "inputDimensions", false);
  validateDimensions(value.productionDimensions, "productionDimensions", true);

  requireObject(value.geometry, "geometry");
  requireFinite(value.geometry.areaM2, "geometry.areaM2", 0.01, 100);
  requireFinite(value.geometry.perimeterM, "geometry.perimeterM", 0.01, 1_000);
  requireObject(value.manufacturing, "manufacturing");
  requireObject(value.pricing, "pricing");

  requireObject(value.customer, "customer");
  const name = requireString(value.customer.name, "customer.name", 1, 120);
  const phone = requireString(value.customer.phone, "customer.phone", 7, 40);
  const phoneDigits = phone.replace(/\D/g, "");
  if (phoneDigits.length < 7 || phoneDigits.length > 15 || !/^[+()\d\s.-]+$/.test(phone)) {
    throw new ValidationError("invalid-field", "customer.phone");
  }
  if (value.customer.comment !== undefined && value.customer.comment !== null && value.customer.comment !== "") {
    requireString(value.customer.comment, "customer.comment", 1, 2_000);
  }

  requireObject(value.consent, "consent");
  if (value.consent.dimensionsConfirmed !== true) {
    throw new ValidationError("confirmation-required", "consent.dimensionsConfirmed");
  }
  const plainText = requireString(value.plainText, "plainText", 1, 4_000);
  if (value.svg !== undefined) {
    const svg = requireString(value.svg, "svg", 1, 170_000);
    if (!svg.includes("<svg")) throw new ValidationError("invalid-field", "svg");
  }

  return {
    ...value,
    id,
    idempotencyKey: bodyKey,
    plainText,
    customer: { ...value.customer, name, phone },
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => key !== "createdAt" && key !== "idempotencyKey")
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function orderFingerprint(order) {
  return createHash("sha256").update(JSON.stringify(canonicalize(order))).digest("hex");
}
