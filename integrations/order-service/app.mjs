import http from "node:http";
import { createDeliveryClient } from "./delivery.mjs";
import { OrderStateStore, StateCapacityError } from "./state.mjs";
import { orderFingerprint, validateOrder, ValidationError } from "./validation.mjs";

export const MAX_BODY_BYTES = 200 * 1024;
const BODY_TIMEOUT_MS = 10_000;

class HttpError extends Error {
  constructor(statusCode, code, field = null) {
    super(code);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.field = field;
  }
}

class LocalRateLimiter {
  constructor({ limit, windowMs }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.clients = new Map();
    this.operations = 0;
  }

  consume(clientKey, now = Date.now()) {
    this.operations += 1;
    if (this.operations % 1_000 === 0) {
      for (const [key, entry] of this.clients) {
        if (now - entry.startedAt >= this.windowMs) this.clients.delete(key);
      }
    }
    let entry = this.clients.get(clientKey);
    if (!entry || now - entry.startedAt >= this.windowMs) {
      entry = { startedAt: now, count: 0 };
      this.clients.set(clientKey, entry);
    }
    entry.count += 1;
    const resetAfterMs = Math.max(0, this.windowMs - (now - entry.startedAt));
    return {
      allowed: entry.count <= this.limit,
      remaining: Math.max(0, this.limit - entry.count),
      resetAfterMs,
    };
  }
}

function applyBaseHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function applyCors(request, response, allowedOrigin) {
  response.setHeader("Vary", "Origin");
  const origin = request.headers.origin;
  if (origin !== allowedOrigin) return false;
  response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  return true;
}

function sendJson(response, statusCode, value) {
  if (response.writableEnded) return;
  const body = Buffer.from(JSON.stringify(value), "utf8");
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.byteLength,
  });
  response.end(body);
}

function clientKey(request, trustProxy) {
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length <= 512) {
      const first = forwarded.split(",", 1)[0].trim();
      if (first) return first;
    }
  }
  return request.socket.remoteAddress || "unknown";
}

function readBody(request) {
  const declaredLength = request.headers["content-length"];
  if (declaredLength !== undefined) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new HttpError(400, "invalid-content-length");
    }
    if (Number(declaredLength) > MAX_BODY_BYTES) {
      throw new HttpError(413, "body-too-large");
    }
  }

  return new Promise((resolve, reject) => {
    let bytes = 0;
    let settled = false;
    const chunks = [];
    const timer = setTimeout(() => finish(reject, new HttpError(408, "body-timeout")), BODY_TIMEOUT_MS);
    timer.unref?.();

    function cleanup() {
      clearTimeout(timer);
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("aborted", onAborted);
      request.off("error", onError);
    }

    function finish(callback, value) {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    }

    function onData(chunk) {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        finish(reject, new HttpError(413, "body-too-large"));
        request.resume();
        return;
      }
      chunks.push(chunk);
    }

    function onEnd() {
      finish(resolve, Buffer.concat(chunks).toString("utf8"));
    }

    function onAborted() {
      finish(reject, new HttpError(400, "request-aborted"));
    }

    function onError() {
      finish(reject, new HttpError(400, "request-error"));
    }

    request.on("data", onData);
    request.on("end", onEnd);
    request.on("aborted", onAborted);
    request.on("error", onError);
  });
}

function parseOrderBody(text, idempotencyHeader, allowedOrigin) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid-json");
  }
  try {
    return validateOrder(parsed, idempotencyHeader, allowedOrigin);
  } catch (error) {
    if (error instanceof ValidationError) {
      throw new HttpError(400, error.code, error.field);
    }
    throw error;
  }
}

class OrderProcessor {
  constructor({ store, delivery, logger }) {
    this.store = store;
    this.delivery = delivery;
    this.logger = logger;
    this.inFlight = new Map();
  }

  async submit(order) {
    const fingerprint = orderFingerprint(order);
    const active = this.inFlight.get(order.idempotencyKey);
    if (active) {
      if (active.fingerprint !== fingerprint) throw new HttpError(409, "idempotency-conflict");
      return active.promise;
    }

    const promise = this.#process(order, fingerprint);
    this.inFlight.set(order.idempotencyKey, { fingerprint, promise });
    try {
      return await promise;
    } finally {
      const current = this.inFlight.get(order.idempotencyKey);
      if (current?.promise === promise) this.inFlight.delete(order.idempotencyKey);
    }
  }

  async #process(order, fingerprint) {
    let record = this.store.get(order.idempotencyKey);
    if (record && record.fingerprint !== fingerprint) {
      throw new HttpError(409, "idempotency-conflict");
    }
    if (!record) {
      try {
        record = this.store.create({
          key: order.idempotencyKey,
          fingerprint,
          orderNumber: order.id,
        });
      } catch (error) {
        if (error instanceof StateCapacityError) throw new HttpError(503, "state-capacity-reached");
        throw error;
      }
      await this.store.persist();
    }

    for (const channel of ["telegram", "max"]) {
      const channelState = record.channels[channel];
      if (channelState.delivered) continue;
      channelState.attempts += 1;
      let delivered = false;
      try {
        const result = await this.delivery[channel](order.plainText);
        delivered = result?.ok === true;
      } catch {
        // Ошибка провайдера намеренно не попадает в лог: URL Telegram содержит токен,
        // а ответы провайдера могут содержать данные адресата.
        this.logger?.warn?.(`delivery-${channel}-failed`);
      }
      if (delivered) {
        channelState.delivered = true;
        channelState.deliveredAt = new Date().toISOString();
      }
      record.updatedAt = new Date().toISOString();
      await this.store.persist();
    }

    const complete = record.channels.telegram.delivered && record.channels.max.delivered;
    if (complete && !record.completedAt) {
      record.completedAt = new Date().toISOString();
      record.updatedAt = record.completedAt;
      await this.store.persist();
    }
    return {
      success: complete,
      orderNumber: record.orderNumber,
      channels: {
        telegram: record.channels.telegram.delivered,
        max: record.channels.max.delivered,
      },
      ...(complete ? {} : { message: "delivery-incomplete" }),
    };
  }
}

function contentTypeAllowed(request) {
  const value = request.headers["content-type"];
  if (typeof value !== "string") return false;
  const mediaType = value.split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json" || mediaType === "text/plain";
}

export function createOrderService({ config, delivery, store, logger = console } = {}) {
  if (!config) throw new Error("config is required");
  const stateStore = store || new OrderStateStore({
    file: config.stateFile,
    maxEntries: config.stateMaxEntries,
    ttlMs: config.stateTtlMs,
  });
  const deliveryClient = delivery || createDeliveryClient(config);
  const processor = new OrderProcessor({ store: stateStore, delivery: deliveryClient, logger });
  const limiter = new LocalRateLimiter({
    limit: config.rateLimitMax,
    windowMs: config.rateLimitWindowMs,
  });

  const server = http.createServer(async (request, response) => {
    applyBaseHeaders(response);
    let pathname;
    try {
      pathname = new URL(request.url || "/", "http://service.local").pathname;
    } catch {
      sendJson(response, 400, { success: false, message: "invalid-url" });
      return;
    }

    if (request.method === "GET" && (pathname === "/health" || pathname === "/healthz")) {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (pathname !== "/orders") {
      sendJson(response, 404, { success: false, message: "not-found" });
      return;
    }

    if (!applyCors(request, response, config.allowedOrigin)) {
      sendJson(response, 403, {
        success: false,
        message: request.headers.origin === undefined ? "origin-required" : "origin-forbidden",
      });
      return;
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key",
        "Access-Control-Max-Age": "600",
      });
      response.end();
      return;
    }

    if (request.method !== "POST") {
      response.setHeader("Allow", "POST, OPTIONS");
      sendJson(response, 405, { success: false, message: "method-not-allowed" });
      return;
    }

    const rate = limiter.consume(clientKey(request, config.trustProxy));
    response.setHeader("RateLimit-Limit", String(config.rateLimitMax));
    response.setHeader("RateLimit-Remaining", String(rate.remaining));
    if (!rate.allowed) {
      response.setHeader("Retry-After", String(Math.max(1, Math.ceil(rate.resetAfterMs / 1_000))));
      sendJson(response, 429, { success: false, message: "rate-limit-exceeded" });
      return;
    }

    if (!contentTypeAllowed(request)) {
      sendJson(response, 415, { success: false, message: "unsupported-media-type" });
      return;
    }

    try {
      const text = await readBody(request);
      const header = request.headers["idempotency-key"];
      if (Array.isArray(header)) throw new HttpError(400, "invalid-idempotency-header");
      const order = parseOrderBody(text, header ?? null, config.allowedOrigin);
      const result = await processor.submit(order);
      sendJson(response, result.success ? 200 : 502, result);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(response, error.statusCode, {
          success: false,
          message: error.code,
          ...(error.field ? { field: error.field } : {}),
        });
        return;
      }
      logger?.error?.("order-processing-failed");
      sendJson(response, 503, { success: false, message: "service-unavailable" });
    }
  });

  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  return server;
}
