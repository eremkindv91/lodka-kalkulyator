# Приём заявок → Telegram (Google Apps Script)

Бесплатный бэкенд без своего сервера: принимает заявку с сайта, пишет её в Google-таблицу и присылает менеджеру в Telegram.

## Шаги

1. **Создайте Telegram-бота**
   - В Telegram напишите [@BotFather](https://t.me/BotFather) → `/newbot` → задайте имя.
   - Скопируйте **токен** бота.
   - Откройте своего бота и нажмите **Start** (иначе бот не сможет вам писать).

2. **Узнайте свой chat_id**
   - Напишите боту [@userinfobot](https://t.me/userinfobot) — он пришлёт ваш `id` (число).
   - Это `TELEGRAM_CHAT_ID` менеджера (@richywonderr).

3. **Создайте проект Apps Script**
   - [script.google.com](https://script.google.com) → **New project**.
   - Вставьте содержимое `Code.gs`.

4. **Добавьте секреты** (Project Settings → **Script properties**):
   | Ключ | Значение |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | токен из BotFather |
   | `TELEGRAM_CHAT_ID` | ваш chat_id |
   | `ALLOWED_ORIGIN` | `https://kovrikvlodky.ru` |
   | `SHEET_ID` | (необязательно) id Google-таблицы для журнала |

5. **Опубликуйте веб-приложение**
   - **Deploy → New deployment → Web app**.
   - *Execute as:* **Me**, *Who has access:* **Anyone**.
   - Скопируйте URL веб-приложения (`https://script.google.com/macros/s/…/exec`).

6. **Впишите URL на сайт**
   - В `js/public-config.js` укажите:
     ```js
     orderEndpoint: "https://script.google.com/macros/s/…/exec"
     ```
   - Закоммитьте и запушьте. На сайте кнопка станет **«Отправить заявку»**, и заявки будут приходить вам в Telegram.

## Важно про CORS

Сайт отправляет запрос как «простой» (`text/plain`), чтобы не упираться в CORS-preflight. Apps Script принимает заявку и шлёт в Telegram в любом случае. Если браузер по каким-то причинам не сможет прочитать ответ, сайт покажет ошибку — но заявка всё равно может дойти. Для гарантированного подтверждения в браузере надёжнее endpoint с полноценными CORS-заголовками (например, Cloudflare Worker). До настройки endpoint на сайте работает кнопка **«Написать в Telegram @richywonderr»** — заявка уходит вручную одним касанием.

## Секреты

Токен бота и chat_id хранятся **только** в Script Properties, не в этом репозитории и не во фронтенде.
