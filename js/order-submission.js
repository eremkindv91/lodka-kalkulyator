/*
 * Адаптер отправки заявки на внешний безопасный endpoint (например, Google Apps Script).
 * Секретов здесь нет — только POST на публично заданный URL. Бэкенд сам шлёт в Telegram.
 * Возвращает { success, orderNumber?, message? }. Никогда не бросает — сеть/таймаут → success:false.
 */
(function (root) {
  "use strict";

  function submitOrder(endpoint, payload, opts) {
    opts = opts || {};
    var timeoutMs = opts.timeoutMs || 20000;
    if (!endpoint) return Promise.resolve({ success: false, message: "no-endpoint" });

    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, timeoutMs);

    return fetch(endpoint, {
      method: "POST",
      // text/plain => "простой" запрос без CORS-preflight (совместимо с Google Apps Script). Тело — JSON-строка.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    })
      .then(function (res) {
        clearTimeout(timer);
        return res.text().then(function (text) {
          var data = {};
          try { data = text ? JSON.parse(text) : {}; } catch (e) { data = {}; }
          if (res.ok && data && data.success) {
            return { success: true, orderNumber: data.orderNumber || null };
          }
          return { success: false, message: (data && data.message) || ("http-" + res.status) };
        });
      })
      .catch(function (err) {
        clearTimeout(timer);
        return { success: false, message: err && err.name === "AbortError" ? "timeout" : "network" };
      });
  }

  var api = { submitOrder: submitOrder };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrderSubmission = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
