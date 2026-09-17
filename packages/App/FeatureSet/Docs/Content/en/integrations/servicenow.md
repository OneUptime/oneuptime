# ServiceNow Integration

Open a [ServiceNow](https://www.servicenow.com) incident automatically whenever a OneUptime incident is created — so ITSM and monitoring stay in step.

This integration is **outbound**: OneUptime calls the ServiceNow [Table API](https://docs.servicenow.com/bundle/utah-application-development/page/integrate/inbound-rest/concept/c_TableAPI.html). It uses a OneUptime **[Workflow](/docs/workflows/index)** with an **Incident → On Create** trigger and an **API component**.

```text
OneUptime Incident → On Create  ──►  API component (POST /api/now/table/incident)  ──►  ServiceNow incident
```

## Prerequisites

- A ServiceNow instance (`https://your-instance.service-now.com`).
- A ServiceNow user with the `rest_api_explorer` / `itil` roles (or enough rights to create `incident` records). Basic auth with this user's credentials is the simplest start; OAuth is recommended for production.
- A OneUptime project where you can create workflows.

## Step 1 — Store credentials as a secret

ServiceNow's Table API accepts **Basic auth**.

1. Base64-encode `username:password` once:

   ```bash
   printf '%s' 'integration_user:password' | base64
   ```

2. In OneUptime, go to **Workflows → Global Variables → Create**, name it `SERVICENOW_AUTH`, paste the base64 string, and turn on **Is Secret**.

## Step 2 — Build the workflow

1. Open **Workflows → Create Workflow**, name it `Incidents → ServiceNow`, and open the **Builder**.
2. Add an **Incident** trigger set to **On Create**. Rename it `Incident`.
3. Add an **API** block connected to the trigger:

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

   `correlation_id` keeps a link back to the OneUptime incident — handy if you later add a resolve step. ServiceNow `urgency`/`impact` use `1` (high), `2` (medium), `3` (low).

4. **Save**, enable, and create a test incident. A `201 Created` response in the workflow logs returns the new record's `sys_id` and `number` (for example `INC0012345`).

## Step 3 — Resolve on OneUptime resolve (optional)

1. Create a **second** workflow with an **Incident → On Update** trigger and a **Conditions** block that checks the incident is resolved.
2. To update the right ServiceNow record you need its `sys_id`. Either store it on the OneUptime incident in Step 2 (read `{{CreateRecord.response-body.result.sys_id}}` and write it to a label with **Update Incident**), or look the record up first with a `GET` on `/api/now/table/incident?sysparm_query=correlation_id=oneuptime-{{Incident._id}}`.
3. Add an **API** block: **Method** `PATCH`, **URL** `https://your-instance.service-now.com/api/now/table/incident/<sys_id>`, body `{ "state": "6", "close_code": "Resolved by monitoring", "close_notes": "Resolved in OneUptime" }` (`state` `6` = Resolved in the default ITIL workflow).

## Troubleshooting

- **`401`** — re-encode `username:password` with `printf` (not `echo`, which adds a newline) and update `SERVICENOW_AUTH`.
- **`403`** — the user lacks rights to write the `incident` table; add the `itil` role.
- **`400`** — a field name or value is wrong for your instance's customizations. Check field names in **System Definition → Tables → incident**.
- **The instance rejects the call** — some instances restrict the Table API; confirm REST is enabled and your IP isn't blocked by an ACL.

## Where to read next

- [Integrations Overview](/docs/integrations/index) — patterns and the auth cheat sheet.
- [Jira](/docs/integrations/jira) — the same outbound pattern for Jira.
- [API component](/docs/workflows/components#api) — reading the response body.
