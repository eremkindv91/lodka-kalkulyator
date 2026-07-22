import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { submitOrder } = require("../js/order-submission.js");

test("submitOrder: возвращает подтверждённые каналы и номер", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        success: true,
        orderNumber: "BM-TEST01",
        channels: { telegram: true, max: true }
      })
    };
  };

  try {
    const result = await submitOrder("https://orders.example/orders", { id: "BM-TEST01" });
    assert.deepEqual(result, {
      success: true,
      orderNumber: "BM-TEST01",
      channels: { telegram: true, max: true }
    });
    assert.equal(captured.url, "https://orders.example/orders");
    assert.equal(captured.options.method, "POST");
    assert.equal(captured.options.headers["Content-Type"], "text/plain;charset=utf-8");
    assert.deepEqual(JSON.parse(captured.options.body), { id: "BM-TEST01" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("submitOrder: сохраняет сведения о частичной доставке при ошибке backend", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 502,
    text: async () => JSON.stringify({
      success: false,
      orderNumber: "BM-TEST02",
      message: "delivery-failed",
      channels: { telegram: true, max: false }
    })
  });

  try {
    const result = await submitOrder("https://orders.example/orders", { id: "BM-TEST02" });
    assert.deepEqual(result, {
      success: false,
      orderNumber: "BM-TEST02",
      message: "delivery-failed",
      channels: { telegram: true, max: false }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("submitOrder: без endpoint не выполняет сетевой запрос", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("unexpected");
  };

  try {
    assert.deepEqual(await submitOrder("", { id: "BM-TEST03" }), {
      success: false,
      message: "no-endpoint"
    });
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("submitOrder: таймаут действует до полного чтения ответа", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => ({
    ok: true,
    status: 200,
    text: () => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    })
  });

  try {
    assert.deepEqual(await submitOrder("https://orders.example/orders", { id: "BM-TEST04" }, { timeoutMs: 20 }), {
      success: false,
      message: "timeout"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
