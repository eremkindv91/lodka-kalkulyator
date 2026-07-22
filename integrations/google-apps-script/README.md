# Резервный endpoint Google Apps Script → Telegram

Это бесплатный **Telegram-only** вариант. Для основной схемы с подтверждённой
доставкой одновременно в Telegram и MAX используйте
[`../order-service`](../order-service/README.md).

Google Apps Script оставлен как резервный путь, потому что он быстро
разворачивается без своего сервера. Для MAX он не подходит: HTTP-клиент Apps
Script не позволяет добавить пользовательский корневой сертификат, а актуальный
API MAX на `platform-api2.max.ru` требует добавить сертификат Минцифры в список
доверенных.

## Настройка

1. Создайте Telegram-бота через [@BotFather](https://t.me/BotFather), сохраните
   токен и нажмите **Start** в диалоге с новым ботом.
2. Получите числовой `chat_id` менеджера через `getUpdates` или
   [@userinfobot](https://t.me/userinfobot).
3. Создайте проект на [script.google.com](https://script.google.com) и вставьте
   содержимое `Code.gs`.
4. В **Project Settings → Script properties** добавьте:

   | Ключ | Значение |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | токен из BotFather |
   | `TELEGRAM_CHAT_ID` | числовой `chat_id` менеджера |
   | `ALLOWED_ORIGIN` | `https://kovrikvlodky.ru` |
   | `SHEET_ID` | необязательно, id Google-таблицы |

5. **Deploy → New deployment → Web app**:
   - *Execute as:* **Me**;
   - *Who has access:* **Anyone**.
6. Вставьте полученный URL `.../exec` в `js/public-config.js` как
   `orderEndpoint` и проверьте тестовую заявку.

Endpoint возвращает `success: true` только после ответа Telegram API с
`ok: true`. Повтор одной заявки определяется по `idempotencyKey`; подтверждённая
заявка повторно в Telegram не отправляется.

## Ограничения

- MAX здесь не подключён.
- Apps Script не раскрывает приложению заголовок `Origin`; проверка
  `ALLOWED_ORIGIN` сверяет поле `site.origin` внутри payload и не является
  полноценной защитой от подделанного запроса.
- Из-за редиректов ContentService чтение ответа браузером иногда работает
  нестабильно. Для коммерческой формы с двумя каналами используйте Node-сервис.
- Токены и `chat_id` нельзя помещать в `public-config.js` или другой файл
  GitHub Pages.
