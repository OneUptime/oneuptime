# Интеграция с Datadog

Преобразуйте оповещения мониторов [Datadog](https://www.datadoghq.com) в инциденты OneUptime, чтобы обнаружение Datadog питало реагирование на инциденты и страницы статуса OneUptime.

Эта интеграция является **входящей**: [интеграция Webhooks](https://docs.datadoghq.com/integrations/webhooks/) Datadog отправляет данные в OneUptime **[Workflow](/docs/workflows/index)**, начинающийся с **триггера Webhook**.

```text
Datadog monitor alerts  ──►  Webhook integration  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Предварительные требования

- Аккаунт Datadog, в котором вы можете настраивать интеграции и мониторы.
- Проект OneUptime, в котором вы можете создавать рабочие процессы.

## Шаг 1 — Создайте рабочий процесс в OneUptime

1. Откройте **Workflows → Create Workflow**, назовите его `Datadog → Incidents` и откройте **Builder**.
2. Добавьте триггер **Webhook** и **скопируйте его URL**. Переименуйте блок в `Datadog`.
3. Добавьте блок **Conditions**, соединённый с триггером:
   - **Left**: `{{Datadog.Request Body.transition}}`
   - **Operator**: `==`
   - **Right**: `Triggered`
4. Из выхода **Yes** добавьте блок **Create Incident**:
   - **Title**: `{{Datadog.Request Body.title}}`
   - **Description**: `{{Datadog.Request Body.body}}\nHost: {{Datadog.Request Body.host}}\n{{Datadog.Request Body.link}}`
   - **Severity**: выберите один.
5. **Сохраните** (оставьте отключённым до тестирования).

## Шаг 2 — Создайте webhook в Datadog

1. В Datadog перейдите в **Integrations → Webhooks** (установите интеграцию **Webhooks**, если ещё не установлена).
2. **Добавьте webhook**:
   - **Name**: `oneuptime` (это станет `@webhook-oneuptime`).
   - **URL**: URL webhook вашего рабочего процесса.
   - **Payload** — Datadog позволяет задать тело JSON с помощью [переменных шаблона](https://docs.datadoghq.com/integrations/webhooks/#usage):

     ```json
     {
       "title": "$EVENT_TITLE",
       "body": "$TEXT_ONLY_MSG",
       "alert_type": "$ALERT_TYPE",
       "transition": "$ALERT_TRANSITION",
       "id": "$ALERT_ID",
       "host": "$HOSTNAME",
       "link": "$LINK",
       "priority": "$PRIORITY"
     }
     ```

3. Сохраните webhook.

## Шаг 3 — Направьте оповещения монитора на webhook

Добавьте имя webhook в мониторы, которые хотите пересылать. В **notification message** каждого монитора включите:

```text
{{#is_alert}}@webhook-oneuptime{{/is_alert}}
{{#is_recovery}}@webhook-oneuptime{{/is_recovery}}
```

Это отправляет в OneUptime как оповещение, так и восстановление. (Чтобы пересылать всё, можно также добавить `@webhook-oneuptime` в монитор без условий.)

## Шаг 4 — Протестируйте

1. Включите рабочий процесс.
2. В мониторе используйте **Test Notifications → Alert** или дождитесь реального срабатывания монитора.
3. Проверьте вкладку **Logs** рабочего процесса и список **Incidents**.

## Разрешение при восстановлении (опционально)

`$ALERT_TRANSITION` принимает значение `Recovered` при сбросе монитора. Добавьте вторую ветвь **Conditions** (`transition == Recovered`), найдите соответствующий инцидент (совпадение по отправленному `id`) и переведите его в состояние разрешено с помощью **Update Incident**.

## Устранение неполадок

- **Запуск не появляется** — убедитесь, что сообщение монитора содержит `@webhook-oneuptime` и рабочий процесс **Enabled**.
- **Поля пустые** — Datadog подставляет только те переменные шаблона, которые применимы к событию. Проверьте вывод триггера на вкладке **Logs** и скорректируйте нагрузку webhook.
- **Дублирующиеся инциденты** — монитор с повторными уведомлениями (renotify) отправляет несколько событий `Triggered`; дедуплицируйте через проверку **Find Incident** по `id` перед созданием.

## Что читать дальше

- [Обзор интеграций](/docs/integrations/index) — входящий паттерн.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) и [Grafana](/docs/integrations/grafana) — другие входящие источники.
- [Триггер Webhook](/docs/workflows/triggers#webhook) — как работает принимающий URL.
