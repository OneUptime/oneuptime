# Интеграция с ServiceNow

Автоматически открывайте инцидент [ServiceNow](https://www.servicenow.com) при каждом создании инцидента OneUptime — чтобы ITSM и мониторинг оставались синхронизированными.

Эта интеграция является **исходящей**: OneUptime вызывает [Table API](https://docs.servicenow.com/bundle/utah-application-development/page/integrate/inbound-rest/concept/c_TableAPI.html) ServiceNow. Используется OneUptime **[Workflow](/docs/workflows/index)** с триггером **Incident → On Create** и компонентом **API**.

```text
OneUptime Incident → On Create  ──►  API component (POST /api/now/table/incident)  ──►  ServiceNow incident
```

## Предварительные требования

- Экземпляр ServiceNow (`https://your-instance.service-now.com`).
- Пользователь ServiceNow с ролями `rest_api_explorer` / `itil` (или достаточными правами для создания записей `incident`). Basic auth с учётными данными этого пользователя — простейший старт; для продакшена рекомендуется OAuth.
- Проект OneUptime, в котором вы можете создавать рабочие процессы.

## Шаг 1 — Сохраните учётные данные как секрет

Table API ServiceNow принимает **Basic auth**.

1. Закодируйте `username:password` в base64 один раз:

   ```bash
   printf '%s' 'integration_user:password' | base64
   ```

2. В OneUptime перейдите в **Workflows → Global Variables → Create**, назовите переменную `SERVICENOW_AUTH`, вставьте строку base64 и включите **Is Secret**.

## Шаг 2 — Создайте рабочий процесс

1. Откройте **Workflows → Create Workflow**, назовите его `Incidents → ServiceNow` и откройте **Builder**.
2. Добавьте триггер **Incident**, установив **On Create**. Переименуйте его в `Incident`.
3. Добавьте блок **API**, соединённый с триггером:
   - **Method**: `POST`
   - **URL**: `https://your-instance.service-now.com/api/now/table/incident`
   - **Headers**:

     ```text
     Authorization: Basic {{variable.SERVICENOW_AUTH}}
     Content-Type: application/json
     Accept: application/json
     ```

   - **Body**:

     ```json
     {
       "short_description": "OneUptime: {{Incident.title}}",
       "description": "{{Incident.description}}",
       "urgency": "1",
       "impact": "1",
       "correlation_id": "oneuptime-{{Incident._id}}"
     }
     ```

   `correlation_id` сохраняет связь с инцидентом OneUptime — пригодится, если позже добавите шаг разрешения. `urgency`/`impact` в ServiceNow: `1` (высокий), `2` (средний), `3` (низкий).
4. **Сохраните**, включите и создайте тестовый инцидент. Ответ `201 Created` в журналах рабочего процесса вернёт `sys_id` и `number` новой записи (например, `INC0012345`).

## Шаг 3 — Разрешение при разрешении в OneUptime (опционально)

1. Создайте **второй** рабочий процесс с триггером **Incident → On Update** и блоком **Conditions**, проверяющим, что инцидент разрешён.
2. Чтобы обновить нужную запись ServiceNow, вам потребуется её `sys_id`. Либо сохраните его в инциденте OneUptime на Шаге 2 (прочитайте `{{CreateRecord.response-body.result.sys_id}}` и запишите в метку через **Update Incident**), либо найдите запись через `GET` на `/api/now/table/incident?sysparm_query=correlation_id=oneuptime-{{Incident._id}}`.
3. Добавьте блок **API**: **Method** `PATCH`, **URL** `https://your-instance.service-now.com/api/now/table/incident/<sys_id>`, тело `{ "state": "6", "close_code": "Resolved by monitoring", "close_notes": "Resolved in OneUptime" }` (`state` `6` = Resolved в стандартном ITIL-процессе).

## Устранение неполадок

- **`401`** — заново закодируйте `username:password` с помощью `printf` (не `echo`, который добавляет символ новой строки) и обновите `SERVICENOW_AUTH`.
- **`403`** — у пользователя нет прав записи в таблицу `incident`; добавьте роль `itil`.
- **`400`** — имя или значение поля неверно для кастомизаций вашего экземпляра. Проверьте имена полей в **System Definition → Tables → incident**.
- **Экземпляр отклоняет вызов** — некоторые экземпляры ограничивают Table API; убедитесь, что REST включён и ваш IP не заблокирован ACL.

## Что читать дальше

- [Обзор интеграций](/docs/integrations/index) — паттерны и шпаргалка по аутентификации.
- [Jira](/docs/integrations/jira) — тот же исходящий паттерн для Jira.
- [Компонент API](/docs/workflows/components#api) — чтение тела ответа.
