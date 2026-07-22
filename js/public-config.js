/*
 * ПУБЛИЧНАЯ конфигурация фронтенда. Здесь можно хранить ТОЛЬКО публичные значения (URL, username).
 * НИКОГДА не помещать сюда bot token, пароли, API-секреты — файл виден всем в браузере.
 *
 * orderEndpoint — адрес безопасного Node-бекенда integrations/order-service,
 *   который принимает заявку и дублирует её в Telegram и MAX. Пока пусто → сайт работает в режиме
 *   «Подготовить заявку» (без ложной отправки). Как настроить — см. ORDER_SUBMISSION_SETUP.md.
 * telegramContact — username менеджера в Telegram (без @) для кнопки «Написать в Telegram».
 */
window.BOAT_MAT_PUBLIC_CONFIG = {
  // Заполнить после деплоя order-service и настройки секретов, например:
  // orderEndpoint: "https://orders.example.ru/orders",
  orderEndpoint: "",
  siteUrl: "https://kovrikvlodky.ru",
  telegramContact: "richywonderr",
  // Email менеджера для кнопки «Отправить на email» (mailto с текстом заявки).
  orderEmail: "rwsales.shop@gmail.com"
};
