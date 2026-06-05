# Интеграция с Jira

Автоматически открывайте задачу [Jira](https://www.atlassian.com/software/jira) при каждом создании инцидента в OneUptime — чтобы инженерная работа отслеживалась там, где уже работают ваши разработчики, со ссылкой обратно на инцидент.

Эта интеграция является **исходящей**: OneUptime вызывает REST API Jira. Используется OneUptime **[Workflow](/docs/workflows/index)** с триггером **Incident → On Create** и компонентом **API**. Опционально можно добавить **входящий** путь, чтобы закрытие задачи Jira разрешало инцидент в OneUptime.

```text
OneUptime Incident → On Create  ──►  API component (POST /rest/api/3/issue)  ──►  Jira issue
```

## Предварительные требования

- Сайт Jira Cloud (`https://your-domain.atlassian.net`) и проект для создания задач — запомните его **ключ проекта** (например, `OPS`).
- Учётная запись Jira с правом создавать задачи и **API-токен** для неё из [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
- Проект OneUptime, в котором вы можете создавать рабочие процессы.

> Используете **Jira Data Center / Server** (self-managed)? Процесс идентичен — используйте свой собственный базовый URL и [Personal Access Token](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html) с заголовком авторизации `Bearer` вместо Basic auth. Конечная точка `/rest/api/2/issue` принимает описание в виде простого текста, что упрощает шаблонизацию.

## Шаг 1 — Сохраните учётные данные Jira как секрет

Jira Cloud использует **Basic auth** с адресом электронной почты и API-токеном в кодировке base64.

1. Закодируйте `email:api_token` в base64 один раз. На macOS/Linux:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

2. В OneUptime перейдите в **Workflows → Global Variables → Create**.
3. Назовите переменную `JIRA_AUTH`, вставьте строку base64 в качестве значения и включите **Is Secret**.

Теперь вы можете использовать `Basic {{variable.JIRA_AUTH}}` как заголовок авторизации, и токен никогда не появится в рабочем процессе или его журналах.

## Шаг 2 — Создайте рабочий процесс

1. Откройте **Workflows → Create Workflow**, назовите его `Incidents → Jira` и откройте **Builder**.
2. Перетащите триггер **Incident** на холст и выберите событие **On Create**. Переименуйте его в `Incident`.
3. Перетащите блок **API** и соедините триггер с ним. Настройте:
   - **Method**: `POST`
   - **URL**: `https://your-domain.atlassian.net/rest/api/3/issue`
   - **Headers**:

     ```text
     Authorization: Basic {{variable.JIRA_AUTH}}
     Content-Type: application/json
     ```

   - **Body** (Jira Cloud v3 использует Atlassian Document Format для описания):

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime incident: {{Incident.title}}",
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 { "type": "text", "text": "{{Incident.description}}" }
               ]
             }
           ]
         }
       }
     }
     ```

   Замените `OPS` на ключ вашего проекта, а `Bug` — на тип задачи, существующий в этом проекте.
4. **Сохраните.** Оставьте рабочий процесс отключённым до завершения тестирования.

## Шаг 3 — Протестируйте

1. Включите рабочий процесс (**Enabled**).
2. Создайте тестовый инцидент в OneUptime (или вызовите его через монитор).
3. Откройте вкладку **Logs** рабочего процесса. Блок **API** должен показать статус `201` и тело ответа, содержащее `key` новой задачи (например, `OPS-1234`).
4. Проверьте Jira — задача там.

Если блок API возвращает ошибку, разверните её в журналах — ответ Jira точно объяснит, какое поле было отклонено. См. [Устранение неполадок](#устранение-неполадок).

## Шаг 4 — Добавьте ссылку на задачу в инцидент (рекомендуется)

Полезно хранить ключ задачи Jira в инциденте, чтобы можно было легко переходить между ними.

- Ответ блока API доступен как `{{CreateIssue.response-body.key}}` (если вы назвали блок `CreateIssue`).
- Добавьте после него блок **Update Incident** и запишите ключ в метку, пользовательское поле или заметку к инциденту.

Это также делает возможной опциональную двустороннюю синхронизацию ниже.

## Двусторонняя синхронизация (опционально)

Чтобы разрешать инцидент в OneUptime при закрытии задачи Jira, добавьте **входящий** рабочий процесс:

1. Создайте второй рабочий процесс с триггером **Webhook** и скопируйте его URL.
2. В Jira перейдите в **Project settings → Automation → Create rule**:
   - **Trigger**: *Issue transitioned* в **Done** (или *Issue resolved*).
   - **Action**: *Send web request* → метод `POST`, URL = URL webhook вашего рабочего процесса, тело содержит ключ задачи и ID инцидента OneUptime, например:

     ```json
     { "issueKey": "{{issue.key}}", "status": "resolved" }
     ```

3. В рабочем процессе используйте блок **Find Incident** для поиска инцидента по сохранённому ключу, затем блок **Update Incident**, чтобы перевести его в состояние разрешено.

Если вы сохранили ключ Jira в инциденте на Шаге 4, совпадение выполняется легко. См. [Компоненты → Компоненты данных OneUptime](/docs/workflows/components#oneuptime-data-components).

## Настройка задачи

Несколько распространённых изменений в теле блока API:

- **Приоритет** — добавьте `"priority": { "name": "High" }` в `fields`. Ветвясь по `{{Incident.incidentSeverity.name}}` с помощью **Conditions**, можно сопоставлять уровни серьёзности OneUptime с приоритетами Jira.
- **Метки** — добавьте `"labels": ["oneuptime", "incident"]`.
- **Исполнитель** — добавьте `"assignee": { "id": "<accountId>" }` (Jira Cloud использует ID учётных записей, а не имена пользователей).
- **Пользовательские поля** — добавьте `"customfield_XXXXX": "..."`, используя ID поля из администрирования Jira.

Чтобы узнать точные имена полей, ожидаемых проектом, однажды вызовите конечную точку Jira `GET /rest/api/3/issue/createmeta` из браузера или `curl`.

## Устранение неполадок

**`401 Unauthorized`.**
- Заново закодируйте `email:api_token` и обновите переменную `JIRA_AUTH`. Замыкающий символ новой строки — самая частая причина: используйте `printf` (не `echo`) при кодировании.
- Убедитесь, что учётная запись, которой принадлежит API-токен, может создавать задачи в проекте.

**`400 Bad Request` с указанием поля.**
- Тип задачи или обязательное поле указаны неверно. Проверьте **имя типа задачи** в проекте и наличие обязательных пользовательских полей. Используйте `createmeta` (выше), чтобы посмотреть обязательные поля.

**`404 Not Found`.**
- Перепроверьте базовый URL и убедитесь, что используете `/rest/api/3/issue` (Cloud) или `/rest/api/2/issue` (Server/Data Center).

**Описание отображается в одну строку / выглядит странно.**
- v3 требует Atlassian Document Format, показанный выше. Если вы предпочитаете отправлять простой текст, используйте конечную точку `/rest/api/2/issue` со значением `"description": "{{Incident.description}}"` как обычной строкой.

## Что читать дальше

- [Обзор интеграций](/docs/integrations/index) — входящий/исходящий паттерны и шпаргалка по аутентификации.
- [Компонент API](/docs/workflows/components#api) — методы, заголовки и чтение ответа.
- [Переменные](/docs/workflows/variables) — секреты и поля инцидента.
- [PagerDuty](/docs/integrations/pagerduty) и [ServiceNow](/docs/integrations/servicenow) — тот же исходящий паттерн для других инструментов.
