# Jira Integration

Open a [Jira](https://www.atlassian.com/software/jira) issue automatically whenever a OneUptime incident is created — so engineering work is tracked where your developers already live, with a link back to the incident.

This integration is **outbound**: OneUptime calls Jira's REST API. It uses a OneUptime **[Workflow](/docs/workflows/index)** with an **Incident → On Create** trigger and an **API component**. You can optionally add an **inbound** path so closing the Jira issue resolves the OneUptime incident.

```text
OneUptime Incident → On Create  ──►  API component (POST /rest/api/3/issue)  ──►  Jira issue
```

## Prerequisites

- A Jira Cloud site (`https://your-domain.atlassian.net`) and a project to file issues in — note its **project key** (e.g. `OPS`).
- A Jira account that can create issues, and an **API token** for it from [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
- A OneUptime project where you can create workflows.

> Using **Jira Data Center / Server** (self-managed)? The flow is identical — use your own base URL and a [Personal Access Token](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html) with a `Bearer` auth header instead of Basic auth. The `/rest/api/2/issue` endpoint accepts a plain-text description, which makes templating simpler.

## Step 1 — Store your Jira credentials as a secret

Jira Cloud uses **Basic auth** with your email and API token, base64-encoded.

1. Base64-encode `email:api_token` once. On macOS/Linux:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

2. In OneUptime, go to **Workflows → Global Variables → Create**.
3. Name it `JIRA_AUTH`, paste the base64 string as the value, and turn on **Is Secret**.

Now you can use `Basic {{variable.JIRA_AUTH}}` as an auth header and the token never appears in the workflow or its logs.

## Step 2 — Build the workflow

1. Open **Workflows → Create Workflow**, name it `Incidents → Jira`, and open the **Builder**.
2. Drag an **Incident** trigger onto the canvas and choose the **On Create** event. Rename it `Incident`.
3. Drag an **API** block and connect the trigger to it. Configure:
   - **Method**: `POST`
   - **URL**: `https://your-domain.atlassian.net/rest/api/3/issue`
   - **Headers**:

     ```text
     Authorization: Basic {{variable.JIRA_AUTH}}
     Content-Type: application/json
     ```

   - **Body** (Jira Cloud v3 uses the Atlassian Document Format for the description):

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

   Replace `OPS` with your project key and `Bug` with an issue type that exists in that project.
4. **Save.** Leave the workflow disabled until you've tested it.

## Step 3 — Test it

1. Turn the workflow **Enabled** on.
2. Create a test incident in OneUptime (or trigger one from a monitor).
3. Open the workflow's **Logs** tab. The **API** block should show a `201` status and a response body containing the new issue's `key` (for example `OPS-1234`).
4. Check Jira — the issue is there.

If the API block returns an error, expand it in the logs — Jira's response explains exactly which field it rejected. See [Troubleshooting](#troubleshooting).

## Step 4 — Link the incident back to the issue (recommended)

It's useful to store the Jira issue key on the incident so people can jump between them.

- The API block's response is available as `{{CreateIssue.response-body.key}}` (if you named the block `CreateIssue`).
- Add an **Update Incident** block after it and write the key into a label, a custom field, or a note on the incident.

This also makes the optional two-way sync below possible.

## Two-way sync (optional)

To resolve the OneUptime incident when someone closes the Jira issue, add an **inbound** workflow:

1. Create a second workflow that starts with a **Webhook** trigger and copy its URL.
2. In Jira, go to **Project settings → Automation → Create rule**:
   - **Trigger**: *Issue transitioned* to **Done** (or *Issue resolved*).
   - **Action**: *Send web request* → method `POST`, URL = your workflow webhook URL, body includes the issue key and OneUptime incident id, e.g.:

     ```json
     { "issueKey": "{{issue.key}}", "status": "resolved" }
     ```

3. In the workflow, use a **Find Incident** block to locate the incident by the stored key, then an **Update Incident** block to move it to your resolved state.

If you stored the Jira key on the incident in Step 4, matching is straightforward. See [Components → OneUptime data components](/docs/workflows/components#oneuptime-data-components).

## Customizing the issue

A few common tweaks to the API block's body:

- **Priority** — add `"priority": { "name": "High" }` inside `fields`. You can branch on `{{Incident.incidentSeverity.name}}` with **Conditions** to map OneUptime severities to Jira priorities.
- **Labels** — add `"labels": ["oneuptime", "incident"]`.
- **Assignee** — add `"assignee": { "id": "<accountId>" }` (Jira Cloud uses account IDs, not usernames).
- **Custom fields** — add `"customfield_XXXXX": "..."` using the field's ID from your Jira admin.

To discover the exact field names a project expects, call Jira's `GET /rest/api/3/issue/createmeta` endpoint once from your browser or `curl`.

## Troubleshooting

**`401 Unauthorized`.**
- Re-encode `email:api_token` and update the `JIRA_AUTH` variable. A trailing newline is the usual culprit — use `printf` (not `echo`) when encoding.
- Confirm the account owning the API token can create issues in the project.

**`400 Bad Request` mentioning a field.**
- The issue type or a required field is wrong. Check the project's **issue type** name and whether it has required custom fields. Use `createmeta` (above) to see what's mandatory.

**`404 Not Found`.**
- Double-check the base URL and that you're hitting `/rest/api/3/issue` (Cloud) or `/rest/api/2/issue` (Server/Data Center).

**The description shows as a single line / looks odd.**
- v3 requires the Atlassian Document Format shown above. If you'd rather send plain text, use the `/rest/api/2/issue` endpoint with `"description": "{{Incident.description}}"` as a plain string.

## Where to read next

- [Integrations Overview](/docs/integrations/index) — the inbound/outbound patterns and the auth cheat sheet.
- [API component](/docs/workflows/components#api) — methods, headers, and reading the response.
- [Variables](/docs/workflows/variables) — secrets and incident fields.
- [PagerDuty](/docs/integrations/pagerduty) and [ServiceNow](/docs/integrations/servicenow) — the same outbound pattern for other tools.
