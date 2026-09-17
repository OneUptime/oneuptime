# Интеграция с Discord

Публикуйте обновления инцидентов в канал [Discord](https://discord.com). В OneUptime есть встроенный компонент рабочего процесса **Discord**, поэтому это одна из самых быстрых интеграций для настройки.

Эта интеграция является **исходящей**: OneUptime публикует сообщения в канал Discord через URL входящего webhook.

```text
OneUptime Incident → On Create  ──►  Discord component  ──►  message in your channel
```

## Шаг 1 — Создайте webhook в Discord

1. В Discord откройте **Edit Channel → Integrations → Webhooks** для целевого канала.
2. Нажмите **New Webhook**, задайте ему имя (например, `OneUptime`), выберите канал и **Copy Webhook URL**.

## Шаг 2 — Сохраните URL webhook (опционально, но рекомендуется)

1. В OneUptime перейдите в **Рабочие процессы → Глобальные переменные → Создать**.
2. Назовите переменную `DISCORD_WEBHOOK_URL`, вставьте URL и включите **Is Secret**.

Хранение в переменной позволяет переиспользовать её в разных рабочих процессах и менять в одном месте.

## Шаг 3 — Создайте рабочий процесс

1. Откройте **Рабочие процессы → Создать рабочий процесс**, назовите его `Incidents → Discord` и откройте **Конструктор**.
2. Добавьте триггер **Incident**, установив **On Create**. Переименуйте его в `Incident`.
3. Добавьте компонент **Discord**, соединённый с триггером:
   - **URL webhook**: `{{variable.DISCORD_WEBHOOK_URL}}` (или вставьте напрямую).
   - **Сообщение**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Сохраните**, включите и создайте тестовый инцидент. Сообщение появится в вашем канале.

## Альтернатива: компонент API

Если вы предпочитаете не использовать специализированный компонент, блок **API** делает то же самое:

- **Method**: `POST`
- **URL**: `{{variable.DISCORD_WEBHOOK_URL}}`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "content": "New incident: {{Incident.title}}" }`

Это удобно, если хотите использовать более богатые [embeds](https://discord.com/developers/docs/resources/webhook#execute-webhook) Discord — добавьте массив `embeds` в тело.

## Советы

- Используйте **Условия**, чтобы публиковать только для определённых уровней серьёзности — ветвитесь по `{{Incident.incidentSeverity.name}}` перед блоком Discord.
- Добавьте ещё рабочие процессы на **Incident → On Update** для публикации подтверждений и разрешений в тот же канал.

## Что читать дальше

- [Обзор интеграций](/docs/integrations/index) — исходящий паттерн.
- [Telegram](/docs/integrations/telegram) — та же идея для Telegram.
- [Компоненты → Discord](/docs/workflows/components#discord) — справочник по компоненту.
