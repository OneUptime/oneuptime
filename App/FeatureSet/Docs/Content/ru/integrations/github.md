# Интеграция с GitHub

Автоматически открывайте задачу [GitHub](https://github.com) при создании инцидента OneUptime — чтобы инженерные задачи отслеживались в репозитории, ответственном за затронутый сервис.

Эта интеграция является **исходящей**: OneUptime вызывает [GitHub REST API](https://docs.github.com/en/rest/issues/issues). Используется OneUptime **[Workflow](/docs/workflows/index)** с триггером **Incident → On Create** и компонентом **API**.

> **Ищете более глубокую интеграцию с GitHub?** У OneUptime также есть нативная интеграция **GitHub App** для подключения репозиториев кода (используется ИИ-агентом и функциями работы с кодом). Она настраивается через переменные окружения, а не через рабочие процессы — см. [Интеграция с GitHub (self-hosted)](/docs/self-hosted/github-integration). Эта страница посвящена исключительно *созданию задач на основе инцидентов*.

```text
OneUptime Incident → On Create  ──►  API component (POST /repos/{owner}/{repo}/issues)  ──►  GitHub issue
```

## Предварительные требования

- Репозиторий GitHub, в котором нужно создавать задачи.
- Токен, позволяющий создавать задачи:
  - **Fine-grained PAT** с доступом к этому репозиторию и разрешением **Issues: Read and write**, или
  - **classic PAT** с областью `repo`.

  Создайте токен на [github.com/settings/tokens](https://github.com/settings/tokens).
- Проект OneUptime, в котором вы можете создавать рабочие процессы.

## Шаг 1 — Сохраните токен

1. Перейдите в **Workflows → Global Variables → Create**.
2. Назовите переменную `GITHUB_TOKEN`, вставьте токен и включите **Is Secret**.

## Шаг 2 — Создайте рабочий процесс

1. Откройте **Workflows → Create Workflow**, назовите его `Incidents → GitHub Issues` и откройте **Builder**.
2. Добавьте триггер **Incident**, установив **On Create**. Переименуйте его в `Incident`.
3. Добавьте блок **API**, соединённый с триггером:
   - **Method**: `POST`
   - **URL**: `https://api.github.com/repos/your-org/your-repo/issues`
   - **Headers**:

     ```text
     Authorization: Bearer {{variable.GITHUB_TOKEN}}
     Accept: application/vnd.github+json
     X-GitHub-Api-Version: 2022-11-28
     User-Agent: OneUptime
     ```

   - **Body**:

     ```json
     {
       "title": "OneUptime incident: {{Incident.title}}",
       "body": "{{Incident.description}}\n\nFiled automatically from OneUptime.",
       "labels": ["incident", "oneuptime"]
     }
     ```

4. **Сохраните**, включите и создайте тестовый инцидент. Ответ `201 Created` в журналах рабочего процесса означает, что задача создана; тело ответа содержит её `number` и `html_url`.

## Советы

- **GitHub Enterprise Server**: используйте `https://your-host/api/v3/repos/{owner}/{repo}/issues`.
- **Исполнители / веха**: добавьте `"assignees": ["octocat"]` или `"milestone": 3` в тело.
- **Обратная ссылка**: прочитайте `{{CreateIssue.response-body.html_url}}` и сохраните на инциденте с помощью блока **Update Incident**.

## Устранение неполадок

- **`401`** — токен неверный или истёкший. Fine-grained токены должны явно предоставлять доступ к репозиторию и разрешение **Issues**.
- **`403` / ограничение скорости** — включите заголовок `User-Agent` (GitHub отклоняет запросы без него) и проверьте, не превышено ли ограничение скорости.
- **`404`** — путь `owner/repo` неверный или токен не может видеть приватный репозиторий.
- **`422`** — несуществующая метка — нормально (GitHub создаёт упомянутые метки), но неверно сформированное тело — нет; проверьте JSON.

## Что читать дальше

- [Обзор интеграций](/docs/integrations/index) — паттерны и шпаргалка по аутентификации.
- [GitLab](/docs/integrations/gitlab) — та же идея для GitLab.
- [Интеграция с GitHub (self-hosted)](/docs/self-hosted/github-integration) — нативное подключение GitHub App.
