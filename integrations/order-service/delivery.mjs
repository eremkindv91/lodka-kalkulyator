import https from "node:https";
import tls from "node:tls";

const RESPONSE_LIMIT_BYTES = 64 * 1024;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function requestJson(url, { headers, body, timeoutMs, ca }, requestImpl = https.request) {
  const encoded = Buffer.from(JSON.stringify(body), "utf8");
  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    const overallTimer = setTimeout(() => {
      request?.destroy(new Error("upstream-timeout"));
    }, timeoutMs);
    overallTimer.unref?.();
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      callback(value);
    };
    try {
      request = requestImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": encoded.byteLength,
          Accept: "application/json",
          ...headers,
        },
        ca,
      }, (response) => {
        const chunks = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > RESPONSE_LIMIT_BYTES) {
            response.destroy();
            finish(reject, new Error("upstream-response-too-large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (settled) return;
          let json = null;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            finish(reject, new Error("upstream-invalid-json"));
            return;
          }
          finish(resolve, { statusCode: response.statusCode || 0, json });
        });
        response.on("error", (error) => finish(reject, error));
      });
    } catch (error) {
      finish(reject, error);
      return;
    }
    // Ограничиваем как общее время запроса (timer выше), так и простой сокета.
    request.setTimeout(timeoutMs, () => request.destroy(new Error("upstream-timeout")));
    request.on("error", (error) => finish(reject, error));
    request.end(encoded);
  });
}

function telegramConfirmed(response) {
  return response.statusCode >= 200
    && response.statusCode < 300
    && response.json?.ok === true
    && Number.isSafeInteger(response.json?.result?.message_id);
}

function maxConfirmed(response) {
  if (response.statusCode !== 200 || !isObject(response.json)) return false;
  const message = isObject(response.json.message) ? response.json.message : response.json;
  return isObject(message.recipient)
    && Number.isFinite(message.timestamp)
    && isObject(message.body);
}

export function createDeliveryClient(config, { request = requestJson } = {}) {
  const telegramUrl = new URL(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`);
  const maxUrl = new URL("https://platform-api2.max.ru/messages");
  maxUrl.searchParams.set(config.maxRecipient.type, config.maxRecipient.value);
  maxUrl.searchParams.set("disable_link_preview", "true");

  // Node заменяет системные roots при передаче `ca`, поэтому добавляем новый
  // сертификат к встроенному списку, а не передаём его отдельно.
  const maxCa = [...tls.rootCertificates, config.maxCaPem];

  return Object.freeze({
    async telegram(text) {
      const response = await request(telegramUrl, {
        headers: {},
        body: {
          chat_id: config.telegramChatId,
          text,
          disable_web_page_preview: true,
        },
        timeoutMs: config.upstreamTimeoutMs,
      });
      return { ok: telegramConfirmed(response) };
    },

    async max(text) {
      const response = await request(maxUrl, {
        headers: { Authorization: config.maxToken },
        body: { text, notify: true },
        timeoutMs: config.upstreamTimeoutMs,
        ca: maxCa,
      });
      return { ok: maxConfirmed(response) };
    },
  });
}
