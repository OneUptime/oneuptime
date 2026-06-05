# Интеграция с Prometheus Alertmanager

Преобразуйте уведомления [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) в инциденты OneUptime. Prometheus оценивает ваши правила оповещений, Alertmanager маршрутизирует их, а OneUptime фиксирует и эскалирует.

Эта интеграция является **входящей**: Alertmanager отправляет `POST` в OneUptime **[Workflow](/docs/workflows/index)**, который начинается с **триггера Webhook**.

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Предварительные требования

- Окружение Prometheus + Alertmanager, в котором вы можете редактировать `alertmanager.yml`.
- Alertmanager должен иметь возможность обращаться к вашему экземпляру OneUptime по HTTPS.
- Проект OneUptime, в котором вы можете создавать рабочие процессы.

## Шаг 1 — Создайте рабочий процесс в OneUptime

1. Откройте **Workflows → Create Workflow**, назовите его `Alertmanager → Incidents` и откройте **Builder**.
2. Добавьте триггер **Webhook** и **скопируйте его URL**. Переименуйте блок в `Alertmanager`.
3. Добавьте блок **Conditions**, соединённый с триггером:
   - **Left**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. Из выхода **Yes** добавьте блок **Create Incident**:
   - **Title**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Description**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Severity**: выберите один (или сначала ветвитесь по `{{Alertmanager.Request Body.commonLabels.severity}}`).
5. **Сохраните** (оставьте отключённым до тестирования).

> **О сгруппированных оповещениях.** Alertmanager группирует оповещения и отправляет **массив** `alerts`. `commonLabels` и `commonAnnotations` выше — это поля, общие для всей группы, что идеально подходит для одного инцидента на уведомление. Если вы хотите **один инцидент на оповещение**, добавьте блок [Custom Code](/docs/workflows/components#custom-code), который перебирает `Request Body.alerts` и создаёт инцидент для каждого. Настройте группировку с помощью `group_by` в маршруте.

## Шаг 2 — Настройте Alertmanager

Добавьте получатель webhook, указывающий на URL рабочего процесса, и направьте на него оповещения. В `alertmanager.yml`:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://<your-workflow-webhook-url>"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 3h
```

Перезагрузите Alertmanager (`curl -X POST http://localhost:9093/-/reload` или перезапустите его).

## Шаг 3 — Протестируйте

1. Включите рабочий процесс.
2. Отправьте тестовое оповещение — например, с помощью `amtool`:

   ```bash
   amtool alert add test_alert severity=warning --annotation=summary="Test from Alertmanager" --alertmanager.url=http://localhost:9093
   ```

3. Проверьте вкладку **Logs** рабочего процесса и список **Incidents**.

## Разрешение при восстановлении (опционально)

При `send_resolved: true` Alertmanager также отправляет `POST` при сбросе оповещения, на этот раз со значением `status: resolved`. Добавьте вторую ветвь **Conditions** (`status == resolved`), найдите соответствующий инцидент (совпадение по `commonLabels.alertname`) и переведите его в состояние разрешено с помощью **Update Incident**.

## Устранение неполадок

- **Запуск не появляется** — убедитесь, что Alertmanager может достичь URL (проверьте его журналы на наличие ошибок доставки) и что рабочий процесс **Enabled**.
- **Поля инцидента пустые** — разные правила задают разные аннотации. Проверьте вывод триггера на вкладке **Logs** и ссылайтесь на поля, которые реально существуют (`commonAnnotations` или `annotations` отдельных оповещений).
- **Слишком много инцидентов** — увеличьте `group_by`/`group_interval`, чтобы Alertmanager объединял связанные оповещения.

## Что читать дальше

- [Обзор интеграций](/docs/integrations/index) — входящий паттерн.
- [Grafana](/docs/integrations/grafana) — та же идея для оповещений Grafana.
- [Триггер Webhook](/docs/workflows/triggers#webhook) — как работает принимающий URL.
