# Интеграция с PagerDuty

Вызывайте инцидент [PagerDuty](https://www.pagerduty.com) при каждом создании инцидента OneUptime и разрешайте его при разрешении в OneUptime. Удобно, когда PagerDuty управляет вашими расписаниями эскалации и дежурств, а мониторинг OneUptime должен их питать.

Эта интеграция является **исходящей**: OneUptime вызывает [Events API v2](https://developer.pagerduty.com/docs/events-api-v2/overview/) PagerDuty. Используется OneUptime **[Workflow](/docs/workflows/index)** с триггером **Incident → On Create** и компонентом **API**.

> У OneUptime есть собственные встроенные дежурства и эскалация — см. [On Call](/docs/on-call/incoming-call-policy). Используйте эту интеграцию только если хотите, чтобы события также поступали в PagerDuty.

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/enqueue)  ──►  PagerDuty incident
```

## Предварительные требования

- Сервис PagerDuty с интеграцией **Events API v2**. В PagerDuty: **Service → Integrations → Add integration → Events API v2**. Скопируйте **Integration Key** (также называемый *routing key*).
- Проект OneUptime, в котором вы можете создавать рабочие процессы.

## Шаг 1 — Сохраните ключ маршрутизации

1. Перейдите в **Workflows → Global Variables → Create**.
2. Назовите переменную `PAGERDUTY_ROUTING_KEY`, вставьте ключ интеграции и включите **Is Secret**.

## Шаг 2 — Создайте рабочий процесс «trigger»

1. Откройте **Workflows → Create Workflow**, назовите его `Incidents → PagerDuty` и откройте **Builder**.
2. Добавьте триггер **Incident**, установив **On Create**. Переименуйте его в `Incident`.
3. Добавьте блок **API**, соединённый с триггером:
   - **Method**: `POST`
   - **URL**: `https://events.pagerduty.com/v2/enqueue`
   - **Headers**: `Content-Type: application/json`
   - **Body**:

     ```json
     {
       "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
       "event_action": "trigger",
       "dedup_key": "oneuptime-{{Incident._id}}",
       "payload": {
         "summary": "{{Incident.title}}",
         "source": "OneUptime",
         "severity": "critical",
         "custom_details": {
           "description": "{{Incident.description}}"
         }
       }
     }
     ```

   **`dedup_key`** связывает этот инцидент PagerDuty с инцидентом OneUptime, чтобы его можно было разрешить позже. Использование ID инцидента OneUptime делает ключ уникальным и предсказуемым.
4. **Сохраните**, включите и создайте тестовый инцидент. Ответ `202` в журналах рабочего процесса означает, что PagerDuty принял событие.

## Шаг 3 — Разрешение при разрешении в OneUptime (рекомендуется)

1. Добавить второй триггер **Incident** в **тот же** рабочий процесс? Нет — у рабочего процесса один триггер. Вместо этого создайте **второй** рабочий процесс с именем `Resolve PagerDuty` с триггером **Incident → On Update**.
2. Добавьте блок **Conditions**, чтобы проверить, что инцидент теперь разрешён (ветвление по состоянию инцидента / `{{Incident.currentIncidentState.name}}` равно имени вашего состояния разрешения).
3. Из выхода **Yes** добавьте блок **API** в PagerDuty с тем же **`dedup_key`** и `event_action` равным `resolve`:

   ```json
   {
     "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
     "event_action": "resolve",
     "dedup_key": "oneuptime-{{Incident._id}}"
   }
   ```

PagerDuty находит инцидент по `dedup_key` и закрывает его.

## Сопоставление уровней серьёзности (опционально)

Параметр `severity` PagerDuty принимает значения `critical`, `error`, `warning` или `info`. Чтобы сопоставить с уровнями серьёзности OneUptime, добавьте ветви **Conditions** по `{{Incident.incidentSeverity.name}}` перед блоком API и отправляйте разное тело из каждой.

## Входящий путь (опционально)

Чтобы сделать наоборот — открыть инцидент OneUptime из события PagerDuty — добавьте рабочий процесс с триггером **Webhook** и укажите его URL в [V3 webhook](https://developer.pagerduty.com/docs/webhooks/v3-overview/) PagerDuty (или в Events Orchestration), затем используйте **Create Incident**. См. [входящий паттерн](/docs/integrations/index#inbound-another-tool-sends-data-into-oneuptime).

## Устранение неполадок

- **`400` с `"invalid routing key"`** — интеграция должна быть **Events API v2**, а не старый Events API v1 или другой тип. Скопируйте ключ заново.
- **Разрешение ничего не закрывает** — `dedup_key` в вызове разрешения должен точно совпадать с вызовом триггера.
- **Ничего в журналах** — убедитесь, что рабочий процесс **Enabled** и триггер установлен на **On Create**.

## Что читать дальше

- [Обзор интеграций](/docs/integrations/index) — паттерны и шпаргалка по аутентификации.
- [On Call](/docs/on-call/incoming-call-policy) — встроенная эскалация OneUptime.
- [Opsgenie](/docs/integrations/opsgenie) — та же идея для Opsgenie.
