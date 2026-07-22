/**
 * Приём заявок с сайта kovrikvlodky.ru и пересылка в Telegram (+ запись в Google Sheets).
 *
 * Секреты НЕ в коде — берутся из Script Properties (Настройки проекта → Свойства скрипта):
 *   TELEGRAM_BOT_TOKEN   — токен бота от @BotFather
 *   TELEGRAM_CHAT_ID     — chat_id менеджера (узнать через @userinfobot или getUpdates)
 *   ALLOWED_ORIGIN       — https://kovrikvlodky.ru  (для проверки источника)
 *   SHEET_ID             — (необязательно) id Google-таблицы для журнала заявок
 *
 * Развернуть: Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 * Полученный URL вставить в js/public-config.js → orderEndpoint.
 * Подробно — см. README.md и ORDER_SUBMISSION_SETUP.md.
 */

function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var body = {};
    try { body = JSON.parse(e.postData.contents); } catch (err) {
      return json({ success: false, message: "bad-json" });
    }

    // ограничение размера тела (защита от мусора)
    if (e.postData.contents && e.postData.contents.length > 200000) {
      return json({ success: false, message: "too-large" });
    }

    // минимальная валидация обязательных полей
    var customer = body.customer || {};
    if (!customer.name || !customer.phone) {
      return json({ success: false, message: "missing-contacts" });
    }
    if (!body.id || !body.geometry || typeof body.geometry.areaM2 !== "number") {
      return json({ success: false, message: "missing-order-fields" });
    }

    // идемпотентность по orderId: если уже принимали — вернуть тот же номер
    var cache = CacheService.getScriptCache();
    var seenKey = "order:" + body.id;
    var seen = cache.get(seenKey);
    if (seen) {
      return json({ success: true, orderNumber: seen, duplicate: true });
    }

    var orderNumber = body.id;

    // журнал в Google Sheets (если задан SHEET_ID)
    var sheetId = props.getProperty("SHEET_ID");
    if (sheetId) {
      try {
        var sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
        var p = body.pricing || {};
        sheet.appendRow([
          new Date(),
          orderNumber,
          customer.name,
          customer.phone,
          customer.comment || "",
          (body.boat && body.boat.floorType) || "",
          body.geometry.areaM2,
          p.finalPriceRub || "",
          (body.manufacturing && body.manufacturing.partCount) || ""
        ]);
      } catch (errSheet) { /* журнал не критичен */ }
    }

    // отправка в Telegram
    var token = props.getProperty("TELEGRAM_BOT_TOKEN");
    var chatId = props.getProperty("TELEGRAM_CHAT_ID");
    if (token && chatId) {
      var text = body.plainText || ("Новая заявка " + orderNumber);
      UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
        method: "post",
        payload: { chat_id: chatId, text: text, disable_web_page_preview: true },
        muteHttpExceptions: true
      });
    }

    cache.put(seenKey, orderNumber, 21600); // 6 часов
    return json({ success: true, orderNumber: orderNumber });
  } catch (err) {
    // внутренние детали клиенту не раскрываем
    return json({ success: false, message: "server-error" });
  }
}

function doGet() {
  return json({ ok: true, service: "kovrikvlodky-order-endpoint" });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
