# Интеграция с GitLab

Автоматически открывайте задачу [GitLab](https://gitlab.com) при создании инцидента OneUptime — чтобы инженерные задачи попадали в проект, ответственный за затронутый сервис.

Эта интеграция является **исходящей**: OneUptime вызывает [GitLab REST API](https://docs.gitlab.com/ee/api/issues.html). Используется OneUptime **[Workflow](/docs/workflows/index)** с триггером **Incident → On Create** и компонентом **API**. Работает одинаково на GitLab.com и self-managed GitLab.

```text
OneUptime Incident → On Create  ──►  API component (POST /projects/{id}/issues)  ──►  GitLab issue
```

## Предварительные требования

- Проект GitLab и его **Project ID** (отображается на странице обзора проекта, под именем проекта).
- Токен доступа с правом создания задач — **Project**, **Group** или **Personal Access Token** с областью `api`: **Settings → Access Tokens**.
- Проект OneUptime, в котором вы можете создавать рабочие процессы.

## Шаг 1 — Сохраните токен

1. Перейдите в **Workflows → Global Variables → Create**.
2. Назовите переменную `GITLAB_TOKEN`, вставьте токен и включите **Is Secret**.

## Шаг 2 — Создайте рабочий процесс

1. Откройте **Workflows → Create Workflow**, назовите его `Incidents → GitLab Issues` и откройте **Builder**.
2. Добавьте триггер **Incident**, установив **On Create**. Переименуйте его в `Incident`.
3. Добавьте блок **API**, соединённый с триггером:
   - **Method**: `POST`
   - **URL**: `https://gitlab.com/api/v4/projects/12345678/issues`  *(замените `12345678` на ваш Project ID; для self-managed используйте свой хост)*
   - **Headers**:

     ```text
     PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}
     Content-Type: application/json
     ```

   - **Body**:

     ```json
     {
       "title": "OneUptime incident: {{Incident.title}}",
       "description": "{{Incident.description}}\n\nFiled automatically from OneUptime.",
       "labels": "incident,oneuptime"
     }
     ```

4. **Сохраните**, включите и создайте тестовый инцидент. Ответ `201 Created` в журналах рабочего процесса означает, что задача создана; тело ответа содержит её `iid` и `web_url`.

## Советы

- **Self-managed GitLab**: замените `https://gitlab.com` на URL вашего экземпляра; путь `/api/v4/...` остаётся прежним.
- **Путь проекта вместо ID**: можно закодировать путь в URL — например, `group%2Fproject` — вместо числового ID.
- **Исполнитель / дата выполнения**: добавьте `"assignee_ids": [42]` или `"due_date": "2026-01-31"` в тело.
- **Обратная ссылка**: прочитайте `{{CreateIssue.response-body.web_url}}` и сохраните на инциденте с помощью блока **Update Incident**.

## Устранение неполадок

- **`401`** — токен недействителен или истёк, либо отсутствует область `api`.
- **`404`** — Project ID неверный или токен не может получить доступ к приватному проекту.
- **`400`** — обязательное поле отсутствует или неверно сформировано; поле `title` является обязательным.

## Что читать дальше

- [Обзор интеграций](/docs/integrations/index) — паттерны и шпаргалка по аутентификации.
- [GitHub](/docs/integrations/github) — та же идея для GitHub.
- [Компонент API](/docs/workflows/components#api) — чтение тела ответа.
