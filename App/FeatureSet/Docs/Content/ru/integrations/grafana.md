# Интеграция с Grafana

Преобразуйте оповещения [Grafana](https://grafana.com) в инциденты OneUptime. Grafana оценивает правила оповещений на ваших дашбордах; OneUptime фиксирует, эскалирует и отслеживает их.

Эта интеграция является **входящей**: система оповещений Grafana отправляет данные в OneUptime **[Workflow](/docs/workflows/index)**, начинающийся с **триггера Webhook**, через **контактную точку Webhook** Grafana.

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Предварительные требования

- Grafana 9+ с включёнными [унифицированными оповещениями](https://grafana.com/docs/grafana/latest/alerting/) (по умолчанию в современной Grafana).
- Grafana должна иметь возможность обращаться к вашему экземпляру OneUptime по HTTPS.
- Проект OneUptime, в котором вы можете создавать рабочие процессы.

## Шаг 1 — Создайте рабочий процесс в OneUptime

1. Откройте **Workflows → Create Workflow**, назовите его `Grafana → Incidents` и откройте **Builder**.
2. Добавьте триггер **Webhook** и **скопируйте его URL**. Переименуйте блок в `Grafana`.
3. Добавьте блок **Conditions**, соединённый с триггером:
   - **Left**: `{{Grafana.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. Из выхода **Yes** добавьте блок **Create Incident**:
   - **Title**: `{{Grafana.Request Body.title}}`
   - **Description**: `{{Grafana.Request Body.message}}`
   - **Severity**: выберите один (или ветвитесь по `{{Grafana.Request Body.commonLabels.severity}}`).
5. **Сохраните** (оставьте отключённым до тестирования).

Нагрузка webhook Grafana следует формату Alertmanager — она включает `status`, массив `alerts`, `commonLabels` и `commonAnnotations`, а также удобные поля `title` и `message` верхнего уровня.

## Шаг 2 — Настройте контактную точку Grafana

1. В Grafana перейдите в **Alerting → Contact points → Add contact point**.
2. **Name**: `OneUptime`. **Integration**: **Webhook**.
3. **URL**: вставьте URL webhook вашего рабочего процесса. **HTTP Method**: `POST`.
4. Сохраните контактную точку.
5. Перейдите в **Alerting → Notification policies** и направьте нужные оповещения (или политику по умолчанию) на контактную точку **OneUptime**.

## Шаг 3 — Протестируйте

1. Включите рабочий процесс.
2. На экране контактной точки используйте **Test** для отправки примера уведомления или дождитесь срабатывания реального правила оповещения.
3. Проверьте вкладку **Logs** рабочего процесса и список **Incidents**.

## Разрешение при восстановлении (опционально)

Когда оповещение сбрасывается, Grafana отправляет ещё одно уведомление со значением `status: resolved`. Добавьте вторую ветвь **Conditions** (`status == resolved`), найдите соответствующий инцидент и переведите его в состояние разрешено с помощью **Update Incident**.

## Примечания

- **Устаревшие оповещения (Grafana 8 и ниже)** отправляют другую нагрузку (`ruleName`, `state`, `evalMatches`). Если вы используете устаревшие оповещения, ссылайтесь на `{{Grafana.Request Body.ruleName}}` и `{{Grafana.Request Body.state}}` и ветвитесь по `state == alerting`.
- Можно вообще не использовать систему оповещений Grafana и настроить мониторинг тех же метрик прямо в OneUptime — см. [Монитор метрик](/docs/monitor/metrics-monitor).

## Устранение неполадок

- **Запуск не появляется** — убедитесь, что Grafana может достичь URL (проверьте серверные журналы Grafana) и рабочий процесс **Enabled**.
- **Пустые поля** — проверьте вывод триггера на вкладке **Logs**; ссылайтесь на поля, существующие для вашей версии системы оповещений.

## Что читать дальше

- [Обзор интеграций](/docs/integrations/index) — входящий паттерн.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — схожий формат нагрузки.
- [Монитор метрик](/docs/monitor/metrics-monitor) — мониторинг метрик в OneUptime напрямую.
