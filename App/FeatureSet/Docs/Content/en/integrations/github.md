# GitHub Integration

Open a [GitHub](https://github.com) issue automatically when a OneUptime incident is created — so engineering follow-up is tracked in the repo that owns the affected service.

This integration is **outbound**: OneUptime calls the [GitHub REST API](https://docs.github.com/en/rest/issues/issues). It uses a OneUptime **[Workflow](/docs/workflows/index)** with an **Incident → On Create** trigger and an **API component**.

> **Looking for the deeper GitHub connection?** OneUptime also has a native **GitHub App** integration for connecting code repositories (used by the AI agent and code features). That's configured with environment variables, not workflows — see [GitHub Integration (self-hosted)](/docs/self-hosted/github-integration). This page is specifically about _filing issues from incidents_.

```text
OneUptime Incident → On Create  ──►  API component (POST /repos/{owner}/{repo}/issues)  ──►  GitHub issue
```

## Prerequisites

- A GitHub repository where you want issues filed.
- A token that can create issues:

  - **Fine-grained PAT** scoped to that repo with **Issues: Read and write**, or
  - a **classic PAT** with the `repo` scope.

  Create one at [github.com/settings/tokens](https://github.com/settings/tokens).

- A OneUptime project where you can create workflows.

## Step 1 — Store the token

1. Go to **Workflows → Global Variables → Create**.
2. Name it `GITHUB_TOKEN`, paste the token, and turn on **Is Secret**.

## Step 2 — Build the workflow

1. Open **Workflows → Create Workflow**, name it `Incidents → GitHub Issues`, and open the **Builder**.
2. Add an **Incident** trigger set to **On Create**. Rename it `Incident`.
3. Add an **API** block connected to the trigger:

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

4. **Save**, enable, and create a test incident. A `201 Created` in the workflow logs means the issue was created; the response body contains its `number` and `html_url`.

## Tips

- **GitHub Enterprise Server**: use `https://your-host/api/v3/repos/{owner}/{repo}/issues`.
- **Assignees / milestone**: add `"assignees": ["octocat"]` or `"milestone": 3` to the body.
- **Link back**: read `{{CreateIssue.response-body.html_url}}` and store it on the incident with an **Update Incident** block.

## Troubleshooting

- **`401`** — the token is wrong or expired. Fine-grained tokens must explicitly grant the repo and the **Issues** permission.
- **`403` / rate limit** — include the `User-Agent` header (GitHub rejects requests without one) and check you're not rate-limited.
- **`404`** — the `owner/repo` path is wrong, or the token can't see a private repo.
- **`422`** — a label that doesn't exist is fine (GitHub creates referenced labels), but a malformed body isn't — check your JSON.

## Where to read next

- [Integrations Overview](/docs/integrations/index) — patterns and the auth cheat sheet.
- [GitLab](/docs/integrations/gitlab) — the same idea for GitLab.
- [GitHub Integration (self-hosted)](/docs/self-hosted/github-integration) — the native GitHub App connection.
