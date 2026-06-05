# Интеграция с Telegram

Отправляйте обновления инцидентов в чат или группу [Telegram](https://telegram.org). В OneUptime есть встроенный компонент рабочего процесса **Telegram**, поэтому настройка выполняется быстро.

Эта интеграция является **исходящей**: OneUptime отправляет сообщения через бота Telegram.

```text
OneUptime Incident → On Create  ──►  Telegram component  ──►  message in your chat
```

## Шаг 1 — Создайте бота и получите его токен

1. В Telegram напишите [@BotFather](https://t.me/BotFather) и отправьте `/newbot`.
2. Следуйте подсказкам. BotFather выдаст вам **токен бота** вида `123456789:AA...`.

## Шаг 2 — Узнайте ваш ID чата

1. Добавьте бота в группу (или начните с ним личный чат) и отправьте ему любое сообщение.
2. Откройте `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` в браузере.
3. Найдите `"chat":{"id":...}` в ответе — это число и есть ваш **ID чата** (ID групп отрицательные).

## Шаг 3 — Сохраните секреты

1. В OneUptime перейдите в **Workflows → Global Variables → Create**.
2. Создайте `TELEGRAM_BOT_TOKEN` (секрет) и `TELEGRAM_CHAT_ID`.

## Шаг 4 — Создайте рабочий процесс

1. Откройте **Workflows → Create Workflow**, назовите его `Incidents → Telegram` и откройте **Builder**.
2. Добавьте триггер **Incident**, установив **On Create**. Переименуйте его в `Incident`.
3. Добавьте компонент **Telegram**, соединённый с триггером:
   - **Bot token**: `{{variable.TELEGRAM_BOT_TOKEN}}`
   - **Chat ID**: `{{variable.TELEGRAM_CHAT_ID}}`
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Сохраните**, включите и создайте тестовый инцидент. Сообщение придёт в ваш чат.

## Альтернатива: компонент API

Блок **API** тоже подойдёт:

- **Method**: `POST`
- **URL**: `https://api.telegram.org/bot{{variable.TELEGRAM_BOT_TOKEN}}/sendMessage`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "chat_id": "{{variable.TELEGRAM_CHAT_ID}}", "text": "New incident: {{Incident.title}}" }`

## Советы

- Бот видит сообщения только после добавления в группу и при разрешающем **режиме конфиденциальности** — если `getUpdates` пуст, сначала напишите боту или отключите режим конфиденциальности через BotFather.
- Используйте **Conditions** для фильтрации по уровню серьёзности перед отправкой.
- Добавьте `"parse_mode": "Markdown"` в тело API (или используйте форматирование компонента) для жирного текста и ссылок.

## Что читать дальше

- [Обзор интеграций](/docs/integrations/index) — исходящий паттерн.
- [Discord](/docs/integrations/discord) — та же идея для Discord.
- [Компоненты → Telegram](/docs/workflows/components#telegram) — справочник по компоненту.
