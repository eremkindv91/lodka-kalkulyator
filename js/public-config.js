/*
 * ПУБЛИЧНАЯ конфигурация фронтенда. Здесь можно хранить ТОЛЬКО публичные значения (URL, username).
 * НИКОГДА не помещать сюда bot token, пароли, API-секреты — файл виден всем в браузере.
 *
 * orderEndpoint — адрес безопасного бекенда (например, веб-приложение Google Apps Script),
 *   который принимает заявку и пересылает её в Telegram. Пока пусто → сайт работает в режиме
 *   «Подготовить заявку» (без ложной отправки). Как настроить — см. ORDER_SUBMISSION_SETUP.md.
 * telegramContact — username менеджера в Telegram (без @) для кнопки «Написать в Telegram».
 */
window.BOAT_MAT_PUBLIC_CONFIG = {
  orderEndpoint: "",
  siteUrl: "https://kovrikvlodky.ru",
  telegramContact: "richywonderr"
};
