# GitLab Integration

Open a [GitLab](https://gitlab.com) issue automatically when a OneUptime incident is created — so engineering follow-up lands in the project that owns the affected service.

This integration is **outbound**: OneUptime calls the [GitLab REST API](https://docs.gitlab.com/ee/api/issues.html). It uses a OneUptime **[Workflow](/docs/workflows/index)** with an **Incident → On Create** trigger and an **API component**. It works the same on GitLab.com and self-managed GitLab.

```text
OneUptime Incident → On Create  ──►  API component (POST /projects/{id}/issues)  ──►  GitLab issue
```

## Prerequisites

- A GitLab project and its **Project ID** (shown on the project's overview page, under the project name).
- An access token that can create issues — a **Project**, **Group**, or **Personal Access Token** with the `api` scope: **Settings → Access Tokens**.
- A OneUptime project where you can create workflows.

## Step 1 — Store the token

1. Go to **Workflows → Global Variables → Create**.
2. Name it `GITLAB_TOKEN`, paste the token, and turn on **Is Secret**.

## Step 2 — Build the workflow

1. Open **Workflows → Create Workflow**, name it `Incidents → GitLab Issues`, and open the **Builder**.
2. Add an **Incident** trigger set to **On Create**. Rename it `Incident`.
3. Add an **API** block connected to the trigger:
   - **Method**: `POST`
   - **URL**: `https://gitlab.com/api/v4/projects/12345678/issues`  *(replace `12345678` with your Project ID; for self-managed, use your own host)*
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

4. **Save**, enable, and create a test incident. A `201 Created` in the workflow logs means the issue was created; the response body contains its `iid` and `web_url`.

## Tips

- **Self-managed GitLab**: replace `https://gitlab.com` with your instance URL; the `/api/v4/...` path stays the same.
- **Project path instead of ID**: you can URL-encode the path — e.g. `group%2Fproject` — in place of the numeric ID.
- **Assignee / due date**: add `"assignee_ids": [42]` or `"due_date": "2026-01-31"` to the body.
- **Link back**: read `{{CreateIssue.response-body.web_url}}` and store it on the incident with an **Update Incident** block.

## Troubleshooting

- **`401`** — the token is invalid or expired, or lacks the `api` scope.
- **`404`** — the Project ID is wrong, or the token can't access a private project.
- **`400`** — a required field is missing or malformed; `title` is required.

## Where to read next

- [Integrations Overview](/docs/integrations/index) — patterns and the auth cheat sheet.
- [GitHub](/docs/integrations/github) — the same idea for GitHub.
- [API component](/docs/workflows/components#api) — reading the response body.
