# Microsoft Dynamics 365 Integration

Open a **Case** in [Microsoft Dynamics 365](https://www.microsoft.com/dynamics-365) whenever a OneUptime incident is declared, keep that case in step as the incident moves, and let Dynamics push case changes back into OneUptime — all with a [Workflow](/docs/workflows/index). There is no Dynamics-specific block to install: OneUptime talks to the **Dataverse Web API** with the [API component](/docs/workflows/components#api), and Dynamics talks back through a [Webhook trigger](/docs/workflows/triggers#webhook).

```text
OneUptime Incident → On Create  ──►  API Post (token)  ──►  API Post (POST /api/data/v9.2/incidents)  ──►  Dynamics 365 Case

Dynamics 365 Case changed  ──►  Power Automate flow (HTTP)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

This page covers both directions. Build the outbound half first — it is the one that needs the Microsoft Entra ID setup, and once it works the inbound half is a single flow.

## Prerequisites

- A **Dynamics 365** environment containing the **Case** table. Cases come from Dynamics 365 Customer Service; a Dataverse environment without it has no `incident` table to write to.
- The environment's **Web API endpoint**. Find it in the [Power Platform admin center](https://admin.powerplatform.microsoft.com/) under your environment's **Settings → Developer resources**, or in **make.powerapps.com → Settings → Developer resources**. It looks like `https://yourorg.crm.dynamics.com/api/data/v9.2/` — the region segment varies (`crm` for North America, `crm2` for South America, `crm7` for Japan, and so on).
- Rights to register an application in **Microsoft Entra ID** and to create an **application user** in the Dynamics environment. These are usually two different administrators.
- A OneUptime project where you can create workflows and global variables.

> Everything below uses the Dataverse table names, not the labels on the Dynamics forms. A case is the **`incident`** table, its collection in a URL is **`incidents`**, its primary key is **`incidentid`**, and its title column is **`title`**. The case number you see in the UI is **`ticketnumber`**.

## Step 1 — Register an application in Microsoft Entra ID

OneUptime authenticates as an application, not as a person, so it uses the OAuth 2.0 **client credentials** flow.

1. Sign in to the [Azure portal](https://portal.azure.com) as an administrator of the same tenant as your Dynamics environment, and open **Microsoft Entra ID**.
2. Go to **App registrations → New registration**. Give it a name such as `OneUptime Integration`, leave **Supported account types** on **Accounts in this organizational directory only**, and select **Register**.
3. From the app's **Overview** page, copy the **Application (client) ID** and the **Directory (tenant) ID**.
4. Go to **Certificates & secrets → Client secrets → New client secret**. Copy the secret's **Value** — not its ID — before you navigate away. It is never shown again. A client secret can live at most 24 months, so note the expiry somewhere you will see it.

Two things people add here that you do not need:

- **No API permissions.** In the client credentials flow there is no signed-in user, so delegated permissions do nothing. `user_impersonation` under **Dataverse** is a delegated permission and is only for interactive apps. Microsoft Entra ID will happily issue a token for Dataverse with no permissions configured at all — access is decided on the Dynamics side, in Step 2.
- **No admin consent step.** Same reason.

Microsoft prefers a certificate to a client secret for production applications. That option needs the caller to build and sign a JWT assertion itself, which a workflow cannot do, so a client secret is the practical choice here — treat it accordingly: keep it in a secret variable, and rotate it before it expires.

## Step 2 — Create the application user in Dynamics

This is the step that gets skipped, and skipping it produces the most confusing failure in this whole integration: the token request succeeds, and every Dataverse call then fails with `403 Forbidden` and the error code `0x80072560` — *"The user isn't a member of the organization."* Entra ID issues the token without knowing anything about Dynamics; Dynamics then looks for a user row matching the application, and there isn't one.

1. Open the [Power Platform admin center](https://admin.powerplatform.microsoft.com/) and select **Manage → Environments**, then your environment.
2. Select **Settings → Users + permissions → Application users**.
3. Select **+ New app user**, then **+ Add an app**, choose the registration from Step 1, and select **Add**.
4. Pick a **Business unit**, enter an **Email address**, then use the edit icon next to **Security roles**.
5. Assign a **custom** security role with create, read and write privileges on the **Case** table. An application user cannot be given one of the built-in roles — Microsoft requires a custom one. If you do not have a suitable role, copy an existing one and trim it down.
6. Select **Save**, then **Create**.

You can have only one application user per registered application in an environment. Application users are not licensed and are exempt from the environment's security-group membership rules.

## Step 3 — Store the credentials in OneUptime

Go to **Workflows → Global Variables → Create** and add these, turning on **Secret** for the ones marked:

| Name                     | Value                                                       | Secret |
| ------------------------ | ----------------------------------------------------------- | ------ |
| `DYNAMICS_TENANT_ID`     | The Directory (tenant) ID from Step 1                       | No     |
| `DYNAMICS_CLIENT_ID`     | The Application (client) ID from Step 1                     | No     |
| `DYNAMICS_CLIENT_SECRET` | The client secret **Value** from Step 1                     | Yes    |
| `DYNAMICS_URL`           | `https://yourorg.crm.dynamics.com` — no trailing slash      | No     |

Paste the client secret exactly as Entra ID gave it to you. OneUptime encodes the form body for you, so do not URL-encode it by hand.

Reference any of them from a block with `{{global.variables.DYNAMICS_CLIENT_ID}}`. See [Variables](/docs/workflows/variables) for how secrets are scrubbed from run logs.

## Step 4 — Get an access token

Every run fetches its own token. Tokens last 60–90 minutes and the client credentials flow never issues a refresh token, so there is nothing to cache and nothing to renew — one extra HTTP call per run is the whole cost.

1. Open **Workflows → Create Workflow**, name it `Incidents → Dynamics 365`, and open the **Builder**.
2. Click the dashed placeholder, add the **On Create Incident** trigger, and in its **Select Fields** ask for the columns you want to send:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   Leave its **Identifier** as `incident-on-create-1`.

3. Click **Add Component**, add an **API Post (JSON)** block, connect the trigger's **Success** dot to it, and open its settings. Set its **Identifier** to `get-token`, then:

   - **URL**: `https://login.microsoftonline.com/{{global.variables.DYNAMICS_TENANT_ID}}/oauth2/v2.0/token`
   - **Request Headers**:

     ```json
     { "Content-Type": "application/x-www-form-urlencoded" }
     ```

   - **Request Body**:

     ```json
     {
       "client_id": "{{global.variables.DYNAMICS_CLIENT_ID}}",
       "client_secret": "{{global.variables.DYNAMICS_CLIENT_SECRET}}",
       "scope": "{{global.variables.DYNAMICS_URL}}/.default",
       "grant_type": "client_credentials"
     }
     ```

**Type the header name as `Content-Type`, with that exact capitalization.** It is what tells OneUptime to send the body as a form post rather than as JSON, which is the only shape the Microsoft token endpoint accepts. `content-type` in lower case does not match, and the request goes out as JSON and comes back `400`.

The `scope` must be your environment URL followed by `/.default` — that is the confidential-client form. A wrong environment URL here is the usual cause of `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.

The token is now available downstream as:

```text
{{local.components.get-token.returnValues.response-body.access_token}}
```

## Step 5 — Create the case

Add a second **API Post (JSON)** block, connect `get-token`'s **Success** dot to it, and set its **Identifier** to `create-case`.

- **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber`
- **Request Headers**:

  ```json
  {
    "Authorization": "Bearer {{local.components.get-token.returnValues.response-body.access_token}}",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
    "Accept": "application/json",
    "If-None-Match": "null",
    "Prefer": "return=representation"
  }
  ```

- **Request Body**:

  ```json
  {
    "title": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
    "description": "{{local.components.incident-on-create-1.returnValues.model.description}}",
    "caseorigincode": 3,
    "prioritycode": 1,
    "customerid_account@odata.bind": "/accounts(00000000-0000-0000-0000-000000000000)"
  }
  ```

Replace the account GUID with the account these cases belong to. **`customerid` is genuinely required on a case** — it is one of the columns Dataverse enforces on any programmatic write, so a create without it is rejected. Because it can point at either an account or a contact, you never write `customerid@odata.bind`; you write `customerid_account@odata.bind` or `customerid_contact@odata.bind`, and those names are case-sensitive. `title` is a different kind of required: Dynamics forms insist on it, the API does not, so send it anyway.

`Prefer: return=representation` is what makes this usable from a workflow. Without it a successful create answers `204 No Content` and puts the new record's URI in an `OData-EntityId` response header, which you would then have to pick a GUID out of. With it, the response is `201 Created` and carries the record itself, so the next block can read:

```text
{{local.components.create-case.returnValues.response-body.incidentid}}
{{local.components.create-case.returnValues.response-body.ticketnumber}}
```

Now turn the workflow on — **Overview → Edit Workflow → Enabled** — declare a test incident, and read the run under **Runs & Logs**. The `create-case` block should show a `201` and a body containing the new `incidentid`. Changes on the canvas save themselves; there is no Save button.

### Mapping severity and status

Dynamics ships `severitycode` with a single option, "Default Value", so there is no out-of-the-box severity scale to map onto. Use **`prioritycode`** instead, and branch with an **If / Else** block on `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}` if you want per-severity priorities.

| Column           | Values                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `prioritycode`   | `1` High, `2` Normal, `3` Low                                                                                                     |
| `caseorigincode` | `1` Phone, `2` Email, `3` Web, `2483` Facebook, `3986` Twitter, `700610000` IoT                                                   |
| `casetypecode`   | `1` Question, `2` Problem, `3` Request                                                                                            |
| `statecode`      | `0` Active, `1` Resolved, `2` Cancelled                                                                                           |
| `statuscode`     | `1` In Progress, `2` On Hold, `3` Waiting for Details, `4` Researching, `5` Problem Solved, `6` Cancelled, `1000` Information Provided, `2000` Merged |

`statuscode` is customizable, so a tenant may have added its own values. Send integers, not labels.

## Step 6 — Keep the incident and the case findable from each other

Whatever you do later — commenting, resolving, syncing back — needs one of the two systems to hold the other's identifier. Put it on the Dynamics side.

Add a **single line of text** column to the Case table, for example `new_oneuptimeincidentid`, and set it when you create the case:

```json
"new_oneuptimeincidentid": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

Then any later workflow can find the case with a filter:

```text
{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber&$filter=new_oneuptimeincidentid eq '<the incident id>'
```

If you define that column as an **alternate key** on the Case table, you can skip the lookup entirely and `PATCH` straight to `incidents(new_oneuptimeincidentid='<id>')` — an upsert that creates the case if it is missing and updates it if it isn't. The key has to finish building (its state becomes **Active**) before it can be used, and alternate key values cannot contain `/ < > * % & : \ ? + #`. A OneUptime id is a plain UUID, so it is safe.

The reverse direction — storing the Dynamics case id on the OneUptime incident — works too, using an **Update One Incident** block writing to `customFields`. Be careful with it: `customFields` is a single JSON column, so writing it replaces every custom field value on that incident, not just yours. Keeping the link on the Dynamics side avoids that entirely.

## Step 7 — Resolve the case when the incident resolves

Build this as a **second** workflow so a failure here cannot stop cases being opened.

1. **Create Workflow**, name it `Incident resolved → Close Dynamics case`, and add the **On Update Incident** trigger.
2. In the trigger's **Listen on**, put `{"currentIncidentStateId": true}` so the workflow only wakes for state changes rather than every edit. In **Select Fields**, ask for `{"_id": true, "currentIncidentState": {"name": true}}`.
3. Add an **If / Else** block. **Input 1** is `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** is `==`, **Input 2** is `Resolved` — or whatever your project's resolved state is called. See [Incident States & Severities](/docs/incidents/states-and-severities).
4. From the **Yes** branch, repeat the `get-token` block from Step 4.
5. Add an **API Get (JSON)** block, set its **Identifier** to `find-case`, and give it the `$filter` URL from Step 6. A Dataverse query answers with a `value` array, and a workflow reference can index into an array with brackets, so the case id is `{{local.components.find-case.returnValues.response-body.value[0].incidentid}}`.
6. Add an **API Post (JSON)** block that closes the case:

   - **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/CloseIncident`
   - **Request Headers**: the same as Step 5, minus `Prefer`.
   - **Request Body**:

     ```json
     {
       "IncidentResolution": {
         "@odata.type": "Microsoft.Dynamics.CRM.incidentresolution",
         "subject": "Resolved in OneUptime",
         "incidentid@odata.bind": "/incidents(<the case id>)"
       },
       "Status": 5
     }
     ```

     `Status` is a `statuscode` value in the Resolved state — `5` is *Problem Solved*.

     **Test this body against your own environment before you rely on it.** `CloseIncident` takes two parameters, `IncidentResolution` and `Status`, but Microsoft publishes no HTTP example for it — every official sample is C#. The shape above is the conventional translation. If your environment rejects it, try identifying the case with a plain `"incidentid": "<the case id>"` property instead of the `@odata.bind` form, which is how Microsoft's other action examples reference an existing record.

**Why not just `PATCH` the case to `statecode: 1`?** You can — Microsoft documents a `PATCH` of `statecode` and `statuscode` as the Web API equivalent of the older SetState message, and it is the right tool for moving a case between active statuses. What it does not do is create the **Case Resolution** activity that a resolved case in Dynamics 365 Customer Service is expected to have, and it will be refused outright in an environment where an administrator has configured custom status transitions. Use `CloseIncident` to resolve; use `PATCH` for everything else. And whenever you do write `statecode`, set `statuscode` in the same request — otherwise Dynamics quietly applies that state's default status.

`CloseIncident` comes from Dynamics 365 Customer Service rather than base Dataverse, and it is not listed in the Dataverse action reference. If it returns `404`, confirm it exists in your environment by fetching `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/$metadata` and searching for `CloseIncident`.

For anything short of closing the case — a note, a priority bump, a title change — use an **API Patch (JSON)** block against `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents(<the case id>)` with an `If-Match: *` header, which stops an accidental upsert from creating a new case. Send only the columns you are changing.

## Inbound — Dynamics 365 to OneUptime

Now the other direction: someone closes the case in Dynamics, or an agent adds a note, and OneUptime should know.

### Build the receiving workflow first

1. **Create Workflow**, name it `Dynamics 365 → OneUptime`, and add the **Webhook** trigger.
2. Open **Settings** on that workflow and copy the **Webhook Secret Key**. Your URL is:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   On a self-hosted install, swap in your own host. Treat the URL like a password — anyone who has it can start the workflow. You can reset the key from the same page.

3. Add an **If / Else** block that checks a shared secret before anything else happens. **Input 1** is `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** `==`, **Input 2** `{{global.variables.DYNAMICS_WEBHOOK_SECRET}}` — a value you invent and save as a secret global variable.
4. From the **Yes** branch, add an **Update One Incident** block:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: whatever the case change should mean in OneUptime — a state change, a note, a label.

   To move the incident to a state you will need that state's id: a **Find One Incident State** block with the query `{"name": "Resolved"}` gives you `{{local.components.incident-state-find-one-1.returnValues.model._id}}` to write into `currentIncidentStateId`.

Leave it enabled and ready. Now give Dynamics something to call.

### Option A — a Power Automate flow (recommended)

This is the path most teams should take: you control the payload, and there is nothing to install.

1. In [Power Automate](https://make.powerautomate.com), create an **Automated cloud flow**.
2. Trigger: **Microsoft Dataverse → When a row is added, modified or deleted**.

   - **Change type**: `Modified`
   - **Table name**: `Cases`
   - **Scope**: `Organization` — anything narrower only fires for rows owned by you or your business unit.
   - **Select columns**: `statecode,statuscode`. This is an Update-only filter and it is worth getting right. Lookup columns are not supported here, and never list a column that is present on every update (such as the primary key) or the flow fires on every save.

3. Add **Microsoft Dataverse → Get a row by ID**, table `Cases`, row id from the trigger, and a **Select columns** of `incidentid,ticketnumber,title,statecode,statuscode,new_oneuptimeincidentid`.

   This second call is worth its cost. On an update the trigger only carries the columns that changed, so the identifiers you need to match on may simply not be there.

4. Add the built-in **HTTP** action:

   - **Method**: `POST`
   - **URI**: the OneUptime webhook URL from above
   - **Headers**: `Content-Type: application/json` and `X-OneUptime-Secret: <the same secret>`
   - **Body**: build it from the *Get a row by ID* outputs, for example

     ```json
     {
       "oneuptimeIncidentId": "<new_oneuptimeincidentid>",
       "caseId": "<incidentid>",
       "caseNumber": "<ticketnumber>",
       "statecode": "<statecode>",
       "statuscode": "<statuscode>"
     }
     ```

5. Save and turn the flow on.

Worth knowing before you commit to this path:

- The **Microsoft Dataverse connector is premium.** For an automated flow only the flow's owner needs the licence, not everyone the case touches — but the owner's licence lapsing silently stops the flow.
- Dataverse triggers are **push, not polling** — Dynamics registers a callback and fires it. Delivery is normally within seconds; anything past five minutes means the asynchronous service is backed up, which you can see under **Settings → System Jobs** in the admin center.
- Custom headers survive. Power Automate strips several standard header families from HTTP actions (most `Accept-*` and `Content-*` headers, `Host`, `Origin`, `Cookie`), but a header of your own such as `X-OneUptime-Secret` is passed through.
- The flow must live in the same environment as the table it watches.
- Requests count against your tenant's Power Platform request allocation, and connector throttling surfaces as `429` inside the flow run.

### Option B — a native Dataverse webhook

If Power Automate is not available, Dataverse can call OneUptime directly. Register the endpoint with the [Plug-in Registration Tool](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/register-web-hook): **Register New WebHook**, give it the OneUptime URL, choose **HttpHeader** authentication, and add `X-OneUptime-Secret` with your secret. Then register a step on the **incident** table for the **Update** message, with **Filtering Attributes** limited to the columns you care about, stage **PostOperation**, execution mode **Asynchronous**.

Take this route with your eyes open:

- **Ports 80 and 443 only.** A self-hosted OneUptime on any other port cannot be registered.
- **Dataverse does not verify your secret.** It sends the header; rejecting a request that does not carry it is entirely your workflow's job — which is what the **If / Else** block in the receiving workflow is for.
- **The payload is not a friendly JSON object.** It is a serialized `RemoteExecutionContext`, in which `InputParameters` is an *array* of `{key, value}` pairs and the changed row sits under the key `Target` with its columns in a further `Attributes` array. Expect to add a **Run Custom JavaScript** block to flatten it before anything else can read it.
- **Only changed columns are included** on an update, so register a **Post Image** if you need `ticketnumber` or your OneUptime id column.
- **Above 256 KB the interesting parts are stripped** — `InputParameters`, `PreEntityImages` and `PostEntityImages` all go, and the request carries an `x-ms-dynamics-msg-size-exceeded` header. `PrimaryEntityId` and `PrimaryEntityName` survive, so the fallback is to read the row back through the Web API.
- **Delivery is nearly unforgiving.** Dataverse waits 60 seconds for a `2xx` and retries exactly once, only for `502`, `503` and `504`. Anything else — including a `500` from your side — is not retried; it lands as a failed System Job.
- Choose **Asynchronous**. A synchronous step blocks the agent's save on your endpoint, and if the transaction rolls back afterwards the request has already gone out and cannot be recalled.

Classic Dynamics background workflows have no HTTP or webhook step at all, so they are not a third option here.

## Doing the same for alerts

Everything above is written around incidents because that is the common case, but alerts work identically — swap the record type and nothing else changes:

| Incident                                                     | Alert                                               |
| ------------------------------------------------------------ | --------------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`)               | **On Create Alert** (`alert-on-create-1`)           |
| **On Update Incident** (`incident-on-update-1`)               | **On Update Alert** (`alert-on-update-1`)           |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity`  | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**                                   | **Find One Alert State**                            |
| **Update One Incident**                                       | **Update One Alert**                                |

A workflow has exactly one trigger, so incidents and alerts need one workflow each. If the two would do the same work, build the Dynamics half once and call it from both with the **Execute Workflow** component.

## Troubleshooting

Read the failing block in **Runs & Logs** first — both Microsoft endpoints return an explanatory JSON body, and the API component keeps it in `response-body`.

**The token request fails with `400` and `invalid_request` or an unsupported grant type.** The `Content-Type` header is not exactly `Content-Type: application/x-www-form-urlencoded`, so the body went out as JSON. Check the capitalization.

**`400` with `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.** The `scope` is not your environment URL plus `/.default`. Copy the URL from **Developer resources** and drop any trailing slash and any `/api/data/...` path.

**`401 Unauthorized` from Dynamics.** The `Authorization` header is missing, malformed, or the token has expired mid-run. It must read `Bearer <token>` with a single space.

**`403 Forbidden` with `0x80072560`, "The user isn't a member of the organization".** Step 2 was skipped or the application user is bound to a different app registration. The token is fine; the Dynamics-side user is not there.

**`403 Forbidden` with a privilege error.** The application user exists but its custom security role lacks Create, Read or Write on **Case**.

**`400 Bad Request` mentioning the customer.** `customerid` is required. Set `customerid_account@odata.bind` or `customerid_contact@odata.bind`, spelled exactly, with a leading-slash URI such as `/accounts(<guid>)`.

**`404 Not Found` on `/CloseIncident`.** The action is a Dynamics 365 Customer Service action. Search your environment's `$metadata` for it before assuming it is available.

**`412 Precondition Failed` with `DuplicateRecord`.** A duplicate detection rule matched. Either narrow the rule or stop sending the field it matches on.

**`429 Too Many Requests`.** Dataverse's service protection limits — roughly 6,000 requests and 20 minutes of execution time per user in any five-minute window, per web server. The response carries a `Retry-After` in seconds. If a workflow is bursting, put a **Delay** block in it or move the work to a scheduled workflow that batches.

**Nothing arrives on the OneUptime side.** Send a request to the webhook URL yourself with `curl` and check the workflow's **Runs & Logs**. If your own request shows up and Dynamics' does not, the problem is upstream: for Power Automate, look at the flow's own run history; for a native webhook, look at **Settings → System Jobs** filtered to failures.

**The workflow runs but the incident does not change.** An **Update One Incident** block reports `Items Updated: 0` when the query matched nothing — that is a success, not an error. Check that the id in the payload is the OneUptime incident id and that you are querying `_id`.

## Where to read next

- [Integrations Overview](/docs/integrations/index) — the inbound and outbound patterns, and the auth cheat sheet.
- [Jira](/docs/integrations/jira) — the same two-direction build against Jira.
- [Workflows Overview](/docs/workflows/index) and [Authoring a Workflow](/docs/workflows/authoring) — the canvas, identifiers, and turning a workflow on.
- [Components](/docs/workflows/components) — the API blocks, If / Else, and the OneUptime data components.
- [Variables](/docs/workflows/variables) — secrets, and reading one block's output from the next.
- [Configuration & Safety](/docs/workflows/configuration) — webhook security and outbound network access.
- [IP Addresses](/docs/configuration/ip-addresses) — OneUptime's outbound ranges, if Dynamics sits behind an allow list.
