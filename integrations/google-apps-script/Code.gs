/**
 * Упрощённый резервный endpoint: сайт -> Telegram (+ необязательный журнал Sheets).
 *
 * Для одновременной подтверждённой доставки в Telegram и MAX используйте
 * integrations/order-service. Google Apps Script оставлен как бесплатный
 * Telegram-only вариант: его HTTP-клиент не позволяет добавить пользовательский
 * корневой сертификат, который сейчас требуется для API MAX.
 *
 * Script Properties:
 *   TELEGRAM_BOT_TOKEN — токен от @BotFather
 *   TELEGRAM_CHAT_ID   — числовой chat_id менеджера
 *   ALLOWED_ORIGIN     — https://kovrikvlodky.ru
 *   SHEET_ID           — необязательно, id Google-таблицы
 */

var MAX_BODY_CHARS = 200000;
var MAX_MESSAGE_CHARS = 4000;

function doPost(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return json_({ success: false, message: "busy" });

  try {
    if (!e || !e.postData || typeof e.postData.contents !== "string") {
      return json_({ success: false, message: "missing-body" });
    }
    if (e.postData.contents.length > MAX_BODY_CHARS) {
      return json_({ success: false, message: "too-large" });
    }

    var body;
    try { body = JSON.parse(e.postData.contents); }
    catch (err) { return json_({ success: false, message: "bad-json" }); }

    var validationError = validateOrder_(body);
    if (validationError) return json_({ success: false, message: validationError });

    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty("TELEGRAM_BOT_TOKEN");
    var chatId = props.getProperty("TELEGRAM_CHAT_ID");
    var allowedOrigin = props.getProperty("ALLOWED_ORIGIN");
    if (!token || !chatId || !allowedOrigin) {
      return json_({ success: false, message: "delivery-not-configured" });
    }

    // Это проверка согласованности payload, а не защита от подделки Origin:
    // Apps Script Web App не предоставляет заголовки входящего запроса.
    if (!body.site || normalizeOrigin_(body.site.origin) !== normalizeOrigin_(allowedOrigin)) {
      return json_({ success: false, message: "origin-not-allowed" });
    }

    var stateKey = "ORDER_SENT_" + sha256Hex_(body.idempotencyKey);
    var savedOrderNumber = props.getProperty(stateKey);
    if (savedOrderNumber) {
      return json_({
        success: true,
        orderNumber: savedOrderNumber,
        duplicate: true,
        channels: { telegram: true, max: false }
      });
    }

    var telegramResult = sendTelegram_(token, chatId, body.plainText);
    if (!telegramResult.ok) {
      return json_({
        success: false,
        orderNumber: body.id,
        message: "delivery-failed",
        channels: { telegram: false, max: false }
      });
    }

    // Чертёж отправляем фотографией (не критично для успеха: главное — текст доставлен).
    if (body.image) sendPhoto_(token, chatId, body.image, "Чертёж " + body.id);

    // Состояние фиксируется только после подтверждения Telegram API.
    props.setProperty(stateKey, body.id);
    appendToSheet_(props.getProperty("SHEET_ID"), body);

    return json_({
      success: true,
      orderNumber: body.id,
      channels: { telegram: true, max: false }
    });
  } catch (err) {
    return json_({ success: false, message: "server-error" });
  } finally {
    lock.releaseLock();
  }
}

function validateOrder_(body) {
  if (!body || body.schemaVersion !== 2) return "unsupported-schema";
  if (typeof body.id !== "string" || !/^BM-[A-Z0-9-]{6,40}$/.test(body.id)) return "bad-order-id";
  if (typeof body.idempotencyKey !== "string" || body.idempotencyKey.length < 6 || body.idempotencyKey.length > 120) return "bad-idempotency-key";

  var customer = body.customer || {};
  if (typeof customer.name !== "string" || !customer.name.trim() || customer.name.length > 120) return "missing-contacts";
  if (typeof customer.phone !== "string" || !customer.phone.trim() || customer.phone.length > 40) return "missing-contacts";

  var area = body.geometry && body.geometry.areaM2;
  if (typeof area !== "number" || !isFinite(area) || area <= 0 || area > 100) return "missing-order-fields";
  if (typeof body.plainText !== "string" || !body.plainText.trim()) return "missing-order-text";
  return null;
}

function sendTelegram_(token, chatId, text) {
  var safeText = text.length > MAX_MESSAGE_CHARS
    ? text.slice(0, MAX_MESSAGE_CHARS - 24) + "\n\n[текст сокращён]"
    : text;
  var response = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      chat_id: chatId,
      text: safeText,
      disable_web_page_preview: true
    }),
    muteHttpExceptions: true
  });

  var data = {};
  try { data = JSON.parse(response.getContentText() || "{}"); } catch (err) {}
  var code = response.getResponseCode();
  return { ok: code >= 200 && code < 300 && data.ok === true };
}

function sendPhoto_(token, chatId, dataUrl, caption) {
  try {
    var m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(dataUrl);
    if (!m) return { ok: false };
    var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], "chart.jpg");
    var response = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendPhoto", {
      method: "post",
      payload: { chat_id: String(chatId), caption: String(caption || "").slice(0, 1000), photo: blob },
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    return { ok: code >= 200 && code < 300 };
  } catch (err) {
    return { ok: false };
  }
}

function appendToSheet_(sheetId, body) {
  if (!sheetId) return;
  try {
    var sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
    var customer = body.customer || {};
    var pricing = body.pricing || {};
    sheet.appendRow([
      new Date(),
      sheetSafe_(body.id),
      sheetSafe_(customer.name),
      sheetSafe_(customer.phone),
      sheetSafe_(customer.comment || ""),
      sheetSafe_((body.boat && body.boat.floorType) || ""),
      body.geometry.areaM2,
      pricing.finalPriceRub || "",
      (body.manufacturing && body.manufacturing.partCount) || ""
    ]);
  } catch (err) {
    // Журнал необязателен и не меняет подтверждённый статус доставки в Telegram.
  }
}

function sheetSafe_(value) {
  var text = String(value == null ? "" : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function normalizeOrigin_(value) {
  return String(value || "").trim().replace(/\/$/, "").toLowerCase();
}

function sha256Hex_(value) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) {
    var n = (b + 256) % 256;
    return (n < 16 ? "0" : "") + n.toString(16);
  }).join("");
}

function doGet() {
  return json_({ ok: true, service: "kovrikvlodky-telegram-endpoint" });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
