import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { createOrderService, MAX_BODY_BYTES } from "../integrations/order-service/app.mjs";
import { loadConfig } from "../integrations/order-service/config.mjs";
import { createDeliveryClient } from "../integrations/order-service/delivery.mjs";
import {
  DEFAULT_STATE_TTL_MS,
  OrderStateStore,
  StateCapacityError,
} from "../integrations/order-service/state.mjs";

const ALLOWED_ORIGIN = "https://shop.example";

function testConfig(overrides = {}) {
  return {
    allowedOrigin: ALLOWED_ORIGIN,
    stateFile: null,
    stateMaxEntries: 1_000,
    rateLimitMax: 100,
    rateLimitWindowMs: 60_000,
    trustProxy: false,
    ...overrides,
  };
}

function order(overrides = {}) {
  return {
    schemaVersion: 2,
    id: "BM-TEST-001",
    createdAt: "2026-07-22T12:00:00.000Z",
    site: { origin: ALLOWED_ORIGIN, appVersion: "test" },
    boat: { name: "Тестовая лодка", floorType: "rigid" },
    inputDimensions: {
      lengthCm: 220,
      constantWidthCm: 80,
      bowStations: [
        { id: "bow-0", offsetFromBowCm: 0, inputWidthCm: 30 },
        { id: "bow-1", offsetFromBowCm: 10, inputWidthCm: 40 },
      ],
    },
    productionDimensions: {
      lengthCm: 220,
      constantWidthCm: 80,
      bowStations: [
        { id: "bow-0", offsetFromBowCm: 0, inputWidthCm: 30, productionWidthCm: 30 },
        { id: "bow-1", offsetFromBowCm: 10, inputWidthCm: 40, productionWidthCm: 40 },
      ],
      adjustments: { widthDeltaCm: 0, lengthDeltaCm: 0 },
    },
    geometry: { areaM2: 1.6, perimeterM: 6.1, polygonPointsCm: [] },
    manufacturing: { partCount: 2, requiresManagerSplitConfirmation: true },
    pricing: { currency: "RUB", finalPriceRub: 4090 },
    customer: { name: "Тест", phone: "+7 900 000-00-00", comment: "" },
    consent: { dimensionsConfirmed: true },
    plainText: "ЗАЯВКА BM-TEST-001\nТест\n+7 900 000-00-00",
    idempotencyKey: "draft-test-001",
    ...overrides,
  };
}

async function start(t, delivery, config = testConfig()) {
  const logger = { warn() {}, error() {} };
  const server = createOrderService({ config, delivery, logger });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function post(base, payload, headers = {}) {
  const response = await fetch(`${base}/orders`, {
    method: "POST",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "Content-Type": "text/plain;charset=utf-8",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
  return { response, json: await response.json() };
}

test("CORS: разрешает настроенный origin и отклоняет чужой", async (t) => {
  let deliveryCalls = 0;
  const delivery = {
    telegram: async () => { deliveryCalls += 1; return { ok: true }; },
    max: async () => { deliveryCalls += 1; return { ok: true }; },
  };
  const base = await start(t, delivery);

  const preflight = await fetch(`${base}/orders`, {
    method: "OPTIONS",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,idempotency-key",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
  assert.equal(preflight.headers.get("access-control-allow-methods"), "POST, OPTIONS");

  const forbidden = await fetch(`${base}/orders`, {
    method: "OPTIONS",
    headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" },
  });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers.get("access-control-allow-origin"), null);

  const missingOrigin = await fetch(`${base}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(order()),
  });
  assert.equal(missingOrigin.status, 403);
  assert.equal((await missingOrigin.json()).message, "origin-required");
  assert.equal(deliveryCalls, 0);
});

test("validation: отклоняет неверные поля и тело больше 200 КБ до доставки", async (t) => {
  let calls = 0;
  const delivery = {
    telegram: async () => { calls += 1; return { ok: true }; },
    max: async () => { calls += 1; return { ok: true }; },
  };
  const base = await start(t, delivery);

  const invalid = await post(base, order({ customer: { name: "Тест", phone: "123", comment: "" } }));
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.json.field, "customer.phone");

  const mismatchedSite = await post(base, order({
    site: { origin: "https://evil.example", appVersion: "test" },
  }));
  assert.equal(mismatchedSite.response.status, 400);
  assert.equal(mismatchedSite.json.message, "site-origin-mismatch");
  assert.equal(mismatchedSite.json.field, "site.origin");

  const oversized = await fetch(`${base}/orders`, {
    method: "POST",
    headers: { Origin: ALLOWED_ORIGIN, "Content-Type": "application/json" },
    body: "x".repeat(MAX_BODY_BYTES + 1),
  });
  assert.equal(oversized.status, 413);
  assert.equal(calls, 0);
});

test("config: хранит состояние 7 дней по умолчанию", () => {
  const env = {
    ALLOWED_ORIGIN,
    TELEGRAM_BOT_TOKEN: "telegram-token",
    TELEGRAM_CHAT_ID: "1",
    MAX_BOT_TOKEN: "max-token",
    MAX_USER_ID: "42",
    MAX_CA_PEM: "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----",
  };
  assert.equal(loadConfig(env).stateTtlMs, DEFAULT_STATE_TTL_MS);
  assert.equal(loadConfig({ ...env, STATE_TTL_MS: "60000" }).stateTtlMs, 60_000);
  assert.throws(
    () => loadConfig({ ...env, STATE_TTL_MS: "59999" }),
    /STATE_TTL_MS должна быть в диапазоне/,
  );
});

test("state TTL: создание освобождает место после истечения срока", () => {
  let now = Date.parse("2026-07-22T12:00:00.000Z");
  const store = new OrderStateStore({ maxEntries: 1, ttlMs: 1_000, now: () => now });
  store.create({ key: "old", fingerprint: "fingerprint-old", orderNumber: "BM-OLD" });

  now += 999;
  assert.throws(
    () => store.create({ key: "early", fingerprint: "fingerprint-early", orderNumber: "BM-EARLY" }),
    StateCapacityError,
  );

  now += 1;
  const current = store.create({
    key: "current",
    fingerprint: "fingerprint-current",
    orderNumber: "BM-CURRENT",
  });
  assert.equal(store.get("old"), null);
  assert.equal(store.get("current"), current);
});

test("state TTL: загрузка отбрасывает просроченные записи", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "eva-order-state-"));
  const file = join(directory, "state.json");
  t.after(() => rm(directory, { recursive: true, force: true }));

  let now = Date.parse("2026-07-22T12:00:00.000Z");
  const original = new OrderStateStore({ file, maxEntries: 1, ttlMs: 1_000, now: () => now });
  original.create({ key: "old", fingerprint: "fingerprint-old", orderNumber: "BM-OLD" });
  await original.persist();

  now += 1_000;
  const reloaded = new OrderStateStore({ file, maxEntries: 1, ttlMs: 1_000, now: () => now });
  reloaded.create({ key: "current", fingerprint: "fingerprint-current", orderNumber: "BM-CURRENT" });
  await reloaded.persist();

  assert.equal(reloaded.get("old"), null);
  assert.equal(reloaded.get("current").orderNumber, "BM-CURRENT");
  const persisted = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(persisted.records.map((record) => record.key), ["current"]);
});

test("idempotency: параллельные и повторные запросы доставляются один раз", async (t) => {
  const calls = { telegram: 0, max: 0 };
  const delivery = {
    telegram: async () => {
      calls.telegram += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { ok: true };
    },
    max: async () => { calls.max += 1; return { ok: true }; },
  };
  const base = await start(t, delivery);
  const payload = order();

  const [first, concurrent] = await Promise.all([post(base, payload), post(base, payload)]);
  assert.equal(first.response.status, 200);
  assert.equal(concurrent.response.status, 200);

  const repeated = await post(base, { ...payload, createdAt: "2026-07-22T12:01:00.000Z" });
  assert.equal(repeated.response.status, 200);
  assert.equal(repeated.json.success, true);
  assert.deepEqual(calls, { telegram: 1, max: 1 });
});

test("partial retry: повторно вызывает только провалившийся канал", async (t) => {
  const calls = { telegram: 0, max: 0 };
  const delivery = {
    telegram: async () => { calls.telegram += 1; return { ok: true }; },
    max: async () => {
      calls.max += 1;
      return { ok: calls.max >= 2 };
    },
  };
  const base = await start(t, delivery);

  const first = await post(base, order());
  assert.equal(first.response.status, 502);
  assert.equal(first.json.success, false);
  assert.deepEqual(first.json.channels, { telegram: true, max: false });

  const retry = await post(base, order({ createdAt: "2026-07-22T12:02:00.000Z" }));
  assert.equal(retry.response.status, 200);
  assert.equal(retry.json.success, true);
  assert.deepEqual(retry.json.channels, { telegram: true, max: true });
  assert.deepEqual(calls, { telegram: 1, max: 2 });
});

test("MAX delivery: использует официальный endpoint, Authorization и добавочный CA", async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    if (url.hostname === "api.telegram.org") {
      return { statusCode: 200, json: { ok: true, result: { message_id: 1 } } };
    }
    return {
      statusCode: 200,
      json: { recipient: { user_id: 42 }, timestamp: 1, body: { text: "ok" } },
    };
  };
  const client = createDeliveryClient({
    telegramToken: "000000:fake-token-for-tests-only",
    telegramChatId: "1",
    maxToken: "fake-max-token-for-tests-only",
    maxRecipient: { type: "user_id", value: "42" },
    maxCaPem: "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n",
    upstreamTimeoutMs: 2_000,
  }, { request });

  assert.equal((await client.telegram("test")).ok, true);
  assert.equal((await client.max("test")).ok, true);
  const maxCall = calls[1];
  assert.equal(maxCall.url.origin + maxCall.url.pathname, "https://platform-api2.max.ru/messages");
  assert.equal(maxCall.url.searchParams.get("user_id"), "42");
  assert.equal(maxCall.url.searchParams.has("access_token"), false);
  assert.equal(maxCall.options.headers.Authorization, "fake-max-token-for-tests-only");
  assert.equal(maxCall.options.ca.length, tls.rootCertificates.length + 1);
  assert.equal(maxCall.options.ca.at(-1), "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n");
});
