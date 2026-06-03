# Интеграция с Opsgenie

Создавайте оповещение [Opsgenie](https://www.atlassian.com/software/opsgenie) при каждом создании инцидента OneUptime и закрывайте его при разрешении в OneUptime.

Эта интеграция является **исходящей**: OneUptime вызывает [Opsgenie Alert API](https://docs.opsgenie.com/docs/alert-api). Используется OneUptime **[Workflow](/docs/workflows/index)** с триггером **Incident → On Create** и компонентом **API**.

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/alerts)  ──►  Opsgenie alert
```

## Предварительные требования

- **API-ключ** Opsgenie из API-интеграции: **Settings → Integrations → Add → API**. Скопируйте ключ.
- Знайте свой регион. Стандартный хост API — `https://api.opsgenie.com`; для аккаунтов ЕС используется `https://api.eu.opsgenie.com`.
- Проект OneUptime, в котором вы можете создавать рабочие процессы.

## Шаг 1 — Сохраните API-ключ

1. Перейдите в **Workflows → Global Variables → Create**.
2. Назовите переменную `OPSGENIE_KEY`, вставьте API-ключ и включите **Is Secret**.

## Шаг 2 — Создайте рабочий процесс «create alert»

1. Откройте **Workflows → Create Workflow**, назовите его `Incidents → Opsgenie` и откройте **Builder**.
2. Добавьте триггер **Incident**, установив **On Create**. Переименуйте его в `Incident`.
3. Добавьте блок **API**, соединённый с триггером:
   - **Method**: `POST`
   - **URL**: `https://api.opsgenie.com/v2/alerts`  *(для ЕС используйте `api.eu.opsgenie.com`)*
   - **Headers**:

     ```text
     Authorization: GenieKey {{variable.OPSGENIE_KEY}}
     Content-Type: application/json
     ```

   - **Body**:

     ```json
     {
       "message": "{{Incident.title}}",
       "alias": "oneuptime-{{Incident._id}}",
       "description": "{{Incident.description}}",
       "priority": "P1",
       "source": "OneUptime"
     }
     ```

   **`alias`** связывает это оповещение Opsgenie с инцидентом OneUptime, чтобы его можно было закрыть позже по псевдониму. Обратите внимание: схема аутентификации Opsgenie — это буквальное слово `GenieKey`, за которым следует пробел и ваш ключ.
4. **Сохраните**, включите и создайте тестовый инцидент. Ответ `202 Accepted` в журналах рабочего процесса означает, что Opsgenie поставил оповещение в очередь.

## Шаг 3 — Закрытие при разрешении в OneUptime (рекомендуется)

1. Создайте **второй** рабочий процесс с именем `Close Opsgenie` с триггером **Incident → On Update**.
2. Добавьте блок **Conditions**, проверяющий, что инцидент теперь разрешён (ветвление по `{{Incident.currentIncidentState.name}}`).
3. Из выхода **Yes** добавьте блок **API**:
   - **Method**: `POST`
   - **URL**: `https://api.opsgenie.com/v2/alerts/oneuptime-{{Incident._id}}/close?identifierType=alias`
   - **Headers**: тот же `Authorization: GenieKey {{variable.OPSGENIE_KEY}}`
   - **Body**: `{ "source": "OneUptime", "note": "Resolved in OneUptime" }`

Opsgenie находит оповещение по псевдониму и закрывает его.

## Сопоставление приоритетов (опционально)

Приоритеты Opsgenie — от `P1` до `P5`. Сопоставьте с уровнями серьёзности OneUptime с помощью ветвей **Conditions** по `{{Incident.incidentSeverity.name}}` перед блоком API.

## Устранение неполадок

- **`401`/`403`** — неверный ключ, неверный хост региона или интеграции не хватает прав на создание оповещений. Убедитесь, что используете ключ **API**-интеграции и соответствующий хост `api`/`api.eu`.
- **Close возвращает `404`** — `alias` в вызове закрытия должен точно совпадать с вызовом создания, и в строке запроса должен присутствовать `identifierType=alias`.
- **Ничего не происходит** — убедитесь, что рабочий процесс **Enabled**.

## Что читать дальше

- [Обзор интеграций](/docs/integrations/index) — паттерны и шпаргалка по аутентификации.
- [PagerDuty](/docs/integrations/pagerduty) — та же идея для PagerDuty.
- [On Call](/docs/on-call/incoming-call-policy) — встроенная эскалация OneUptime.
