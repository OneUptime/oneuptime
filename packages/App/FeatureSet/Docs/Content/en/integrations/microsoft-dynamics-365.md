# Microsoft Dynamics 365 Integration

Open a **Case** in [Microsoft Dynamics 365](https://www.microsoft.com/dynamics-365) whenever a OneUptime incident is declared or an alert is created, keep that case in step as the incident or alert moves, and let Dynamics push case changes and notes back into OneUptime — all with a [Workflow](/docs/workflows/index). There is no Dynamics-specific block to install: OneUptime talks to the **Dataverse Web API** with the [API component](/docs/workflows/components#api), and Dynamics talks back through a [Webhook trigger](/docs/workflows/triggers#webhook).

```text
OneUptime Incident → On Create  ──►  API Post (token)  ──►  API Post (POST /api/data/v9.2/incidents)  ──►  Dynamics 365 Case

Dynamics 365 Case changed  ──►  Power Automate flow (HTTP)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

The quickest way in is one of the 13 ready-made Dynamics 365 templates, seven for incidents and six for alerts, described in the next section. The rest of the page builds both directions by hand for incidents, which is also your reference when you want a template to do something different. Build the outbound half first — it is the one that needs the Microsoft Entra ID setup, and once it works the inbound half is a single flow.

## Start from a template

The **Create a workflow** dialog has 13 Dynamics 365 templates, under **Dynamics 365** in its category list: seven for incidents, then six for alerts, each set under its own heading. Each one is a small workflow of its own, so you can take only the records and directions you want — incidents, alerts, or both. They share one convention — a link column on the Case table — so any combination of them works together.

### Incident templates

| Template                                                     | What it does                                                                                                                                                                                         | What it asks for                                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **OneUptime → Dynamics 365**                                 |                                                                                                                                                                                                      |                                                                                  |
| Create a Dynamics 365 case when an incident is declared       | Opens a case for every new incident, with a priority chosen from its severity and the incident's id in the link column. Incidents declared from Dynamics 365, and private incidents, are skipped. | The five Dynamics 365 settings, the customer for new cases, and the OneUptime URL     |
| Resolve the Dynamics 365 case when the incident is resolved   | Closes the linked case as **Problem Solved** when the incident is resolved, recording a Case Resolution as resolving it by hand does. Never reopens a case.                                        | The five Dynamics 365 settings                                                        |
| Copy incident private notes to the Dynamics 365 case          | Adds each new private note to the linked case as a note.                                                                                                                                             | The five Dynamics 365 settings                                                        |
| Copy incident public notes to the Dynamics 365 case           | Adds each new public note to the linked case as a note, so agents can tell customers what the status page says.                                                                                     | The five Dynamics 365 settings                                                        |
| **Dynamics 365 → OneUptime**                                 |                                                                                                                                                                                                      |                                                                                  |
| Declare an incident when a Dynamics 365 case is created       | Declares an incident for each new case, kept off your status pages, with a severity chosen from the case's priority, then writes the incident's id into the case's link column.                  | The five Dynamics 365 settings, and a flow or webhook for new cases                   |
| Resolve the incident when its Dynamics 365 case is resolved   | Resolves the incident when its linked case is resolved.                                                                                                                                              | The five Dynamics 365 settings, and a flow or webhook for case status changes         |
| Add Dynamics 365 case notes to the incident as private notes  | Copies each note an agent adds to a linked case onto the incident as a private note.                                                                                                                 | The five Dynamics 365 settings, and a flow or webhook for new notes                   |

### Alert templates

The alert templates do the same jobs for alerts. There is one fewer, because alerts have no public notes, and **Create an alert when a Dynamics 365 case is created** writes no status page settings, because an alert never reaches a status page.

| Template                                                  | What it does                                                                                                                                                                 | What it asks for                                                             |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **OneUptime → Dynamics 365**                              |                                                                                                                                                                              |                                                                              |
| Create a Dynamics 365 case when an alert is created        | Opens a case for every new alert, including every alert a monitor raises. Alerts created from Dynamics 365, and private alerts, are skipped.                                | The five Dynamics 365 settings, the customer for new cases, and the OneUptime URL |
| Resolve the Dynamics 365 case when the alert is resolved   | Closes the linked case as **Problem Solved** when the alert is resolved.                                                                                                     | The five Dynamics 365 settings                                                    |
| Copy alert private notes to the Dynamics 365 case          | Adds each new private note to the linked case as a note.                                                                                                                     | The five Dynamics 365 settings                                                    |
| **Dynamics 365 → OneUptime**                              |                                                                                                                                                                              |                                                                              |
| Create an alert when a Dynamics 365 case is created        | Creates an alert for each new case, with a severity chosen from the case's priority, then writes the alert's id into the case's link column.                                | The five Dynamics 365 settings, and a flow or webhook for new cases               |
| Resolve the alert when its Dynamics 365 case is resolved   | Resolves the alert when its linked case is resolved.                                                                                                                         | The five Dynamics 365 settings, and a flow or webhook for case status changes     |
| Add Dynamics 365 case notes to the alert as private notes  | Copies each note an agent adds to a linked case onto the alert as a private note.                                                                                            | The five Dynamics 365 settings, and a flow or webhook for new notes               |

None of the OneUptime → Dynamics 365 templates send an incident marked **Private Incident**, or an alert marked **Private Alert**, to Dynamics 365 — not the record, its state or its notes — unless you switch that on. See [Changing what a template does](#changing-what-a-template-does).

**Monitors raise alerts on their own, and can raise a lot of them.** **Create a Dynamics 365 case when an alert is created** opens a case for every one. Unless every alert deserves a case, put an **If / Else** block between the trigger and the rest of the workflow — on `{{local.components.alert-on-create-1.returnValues.model.alertSeverity.name}}`, for example — and connect only its **Yes** side onwards.

### Before you start

The templates need three things in Dynamics 365. The first two are the same as for the manual build below.

1. **An app registration in Microsoft Entra ID**, with a client secret: [Step 1](#step-1-register-an-application-in-microsoft-entra-id). Note its **Directory (tenant) ID**, its **Application (client) ID**, and the secret's **Value**.
2. **An application user for it in your Dynamics 365 environment**: [Step 2](#step-2-create-the-application-user-in-dynamics). Its custom security role needs, at the Organization level:

   - **Case**: Create, Read, Write, Append and Append To.
   - **Note**: Create, Read and Append, for the note templates.
   - **Activity**: Create, Read and Append, because closing a case records a Case Resolution, which is an activity.
   - **Account**, and **Contact** if new cases are filed against a contact: Read and Append To, for the create-case templates.

3. **A link column on the Case table.** Dataverse has nothing like Jira's labels, so a case and a OneUptime record find each other through a column you add:

   1. In [make.powerapps.com](https://make.powerapps.com), pick your environment, open **Tables → Case → Columns**, and select **New column**.
   2. Call it `OneUptime Link`, keep **Data type** as **Single line of text** (plain text), and save. The default maximum length of 100 is plenty: the longest value the templates write is 55 characters.
   3. Open the new column and copy its **Logical name**, such as `new_oneuptimelink`. The prefix comes from your solution's publisher, so yours may be different, like `cr4f2_oneuptimelink`. The templates need the logical name, not the display name.

   Add the column to the Case form if agents should see the link. Nothing else about it needs setting up, and it does not need to be an alternate key.

### What the templates ask for

The **Configure** step of the create wizard asks for up to seven values: every template asks for the first five, the Dynamics 365 settings, and the two create-case templates for the last two as well. It checks the shape of each Dynamics 365 setting before anything is created, and says what to type instead, because a value of the wrong shape is not an error anywhere until a run.

- **Dynamics 365 Environment URL** — your environment's address, such as `https://yourorg.crm.dynamics.com`, from the [Power Platform admin center](https://admin.powerplatform.microsoft.com/) under **Environments**, your environment, **Environment URL**. Only the address: not the **Web API endpoint** that **Developer resources** shows, which ends in `/api/data/v9.2`, and no slash at the end.
- **Directory (Tenant) ID** — from the app registration's **Overview** page.
- **Application (Client) ID** — from the same page.
- **Client Secret Value** — the client secret's **Value** from **Certificates & secrets**. Not its **Secret ID**, which is a GUID: the wizard refuses a GUID here.
- **Case Link Column** — the link column's logical name, such as `new_oneuptimelink`.
- **Customer for New Cases** — only the two create-case templates ask for it. Every case needs a customer, and a OneUptime incident has none, so new cases are all filed against one: paste the id of an account, or `contacts(<id>)` for a contact. Open the record in Dynamics 365; its id is the part after `id=` in the address.
- **OneUptime URL** — only the two create-case templates ask for it: the address you open OneUptime at, such as `https://oneuptime.com`. The case's description links back to the incident or alert with it.

**How the templates sign in.** The wizard does not save the tenant, client ID or secret as variables of their own. It creates one [OAuth 2.0 variable](/docs/workflows/variables#oauth-20-variables-tokens-that-refresh-themselves), `dynamicsAccessToken`, under the workflow's **Workflow Variables**: Client Credentials, the token URL `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token`, the scope `<environment URL>/.default`, and the client secret, sent in the request body, stored encrypted. Every call to Dynamics 365 sends `Authorization: Bearer {{local.variables.dynamicsAccessToken}}`. OneUptime fetches the token the first time a step needs it, fetches a new one before it expires, and replaces it with `[REDACTED]` in run logs and step traces. The token is never in a step's output, which is what fetching it with an API block of your own would do.

To check the sign-in before anything runs, open **Workflow Variables**, click **View** on `dynamicsAccessToken`, and click **Refresh now**. **Access Token Fetched** means the app registration is right. An Entra ID error there names what is wrong, such as `AADSTS7000215: Invalid client secret provided`.

Each workflow keeps its own copy. A client secret lives at most 24 months: when you replace it, open `dynamicsAccessToken` in every Dynamics 365 workflow and use **Update Credentials**.

### Create the workflows

1. Open **Workflows → Create Workflow**. Under **Or start from a template**, choose **Dynamics 365** from the category list, or type `Dynamics` into **Search templates…**, and click the template you want. It opens to show what it does and the settings it will ask for. Click **Use this template**.
2. **Name** is filled in from the template. Change it if you like.
3. **Configure** asks for the values above.
4. Click **Create Workflow**. Every workflow is created **disabled**. Turn it on from **Overview → Edit Workflow → Enabled**.

Start with **Create a Dynamics 365 case when an incident is declared**, or **Create a Dynamics 365 case when an alert is created** for alerts: every other OneUptime → Dynamics 365 template of the same kind finds the case by the link it writes. Enable it, declare a test incident (or create a test alert), and open the workflow's **Logs → Runs**. The run's last step should read `✅ Opened Dynamics 365 case CAS-01001-X1Y2Z3 for INC-42, linked as oneuptime-incident-<id>.`

### Connect the Dynamics 365 → OneUptime templates

The Dynamics 365 → OneUptime templates, three for incidents and three for alerts, start from a [Webhook trigger](/docs/workflows/triggers#webhook), so Dynamics 365 has to be told where to send its events. Do it in this order:

1. Create the workflow and **enable it first**. A disabled workflow refuses deliveries, and they are not queued.
2. Open the workflow's **Builder**, click the **Webhook** trigger block (`webhook-1`), and click **Copy URL** at the top of its settings. The URL looks like this:

   ```text
   https://<your OneUptime host>/workflow/trigger/<webhook secret key>
   ```

3. Have Dynamics 365 post to it, from a Power Automate flow or from a Dataverse webhook.

Each template only needs to be told which row changed. It reads that row back from Dynamics 365 before it does anything, so it never takes a case's title, status or link from the request, and it does not mind which of the two sends it.

**Option A — a Power Automate flow (recommended).** In [Power Automate](https://make.powerautomate.com), create an **Automated cloud flow** with the **Microsoft Dataverse** trigger **When a row is added, modified or deleted**, set as below with **Scope** set to **Organization**, and add the built-in **HTTP** action: **Method** `POST`, **URI** the workflow's URL, a `Content-Type: application/json` header, and the body below, with the row's id picked from the trigger's dynamic content.

| Template                                                         | Change type | Table name | Select columns         | Body                         |
| ---------------------------------------------------------------- | ----------- | ---------- | ---------------------- | ---------------------------- |
| Declare an incident / Create an alert when a case is created     | Added       | Cases      |                        | `{"incidentid": "<Case>"}`   |
| Resolve the incident / alert when its case is resolved           | Modified    | Cases      | `statecode,statuscode` | `{"incidentid": "<Case>"}`   |
| Add case notes to the incident / alert as private notes          | Added       | Notes      |                        | `{"annotationid": "<Note>"}` |

To send only some cases, use the trigger's **Filter rows**, such as `prioritycode eq 1` for High-priority cases only. You can also post the trigger's whole output instead of the small body above: the templates read the row's id from it, and its `SdkMessage`, the same way.

**Option B — a Dataverse webhook.** Register the URL with the [Plug-in Registration Tool](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/register-web-hook): **Register New WebHook**, with **HttpHeader** authentication and a header of your own — the URL itself is the secret. Then register a step on it for each event below, with **Event Pipeline Stage of Execution** set to **PostOperation** and **Execution Mode** to **Asynchronous**.

| Template                                                         | Message                                           | Primary Entity | Filtering Attributes             |
| ---------------------------------------------------------------- | ------------------------------------------------- | -------------- | -------------------------------- |
| Declare an incident / Create an alert when a case is created     | `Create`                                          | `incident`     |                                  |
| Resolve the incident / alert when its case is resolved           | `Close`, and `Update` for status changes by others | `incident`     | `statecode, statuscode` (Update) |
| Add case notes to the incident / alert as private notes          | `Create`                                          | `annotation`   |                                  |

Resolving a case in Dynamics 365 raises the **Close** message, not **Update**, which is why that template needs both. A webhook posts the plug-in execution context, which names the row in `PrimaryEntityId` — or, for **Close**, in its `IncidentResolution` — and the templates read it from there. A Dataverse webhook can only call ports 80 and 443, and it has no row filter of its own: every new case reaches the create template, unless you narrow it with `ONLY_PRIORITIES` (see [Changing what a template does](#changing-what-a-template-does)).

Before you rely on either:

- **Anyone who has the URL can trigger the workflow.** Because the templates read every row back from Dynamics 365, a request can only make one look at a real case or note. It can still make the create templates act on a case that is not linked yet. Keep the URL in the flow or the webhook only. If it leaks, click the **Webhook** trigger in the workflow's **Builder**, click **Reset URL**, and paste the new URL into the flow or the webhook. The old URL stops working at once.
- **Every event is a run**, including the ones a template skips. On OneUptime Cloud each counts toward your plan's workflow runs. Filtering in the flow keeps the number down. See [Plan limits](/docs/workflows/configuration#plan-limits).
- **Using both create-from-case templates?** **Declare an incident when a Dynamics 365 case is created** and **Create an alert when a Dynamics 365 case is created** both act on every case they are sent. Each checks the link column before it creates anything, but two deliveries for the same new case arrive together, so the case can end up with an incident and an alert. Send the two different cases — filter the flows by case type, for example.

### Check that it works

Every template ends in a **Log** step that says what happened, so the last step of a run in **Logs → Runs** is the place to look:

- `✅` — it did its job, and names the case, incident or alert.
- `ℹ️` — it skipped the event on purpose, and says why: the case is not linked to a record of this kind, the note came from the other side, the record is private, the new state has no case status mapped to it.
- `❌` — a call failed. For a Dynamics 365 call, the line includes Dynamics 365's answer.
- `⚠️` — a template that creates a record from a case created it, but Dynamics 365 did not accept the link, so the other templates cannot find it yet. Type the link into the case's column by hand.

If a run stops at the first Dynamics 365 step with `Could not get an OAuth 2.0 access token for {{local.variables.dynamicsAccessToken}}`, the sign-in settings are wrong: the message quotes Microsoft Entra ID's answer. See [How the templates sign in](#what-the-templates-ask-for).

### How the two sides stay linked

The case holds the link. A case that belongs to an incident has `oneuptime-incident-<incident id>` in its link column, and one that belongs to an alert has `oneuptime-alert-<alert id>`. The id is the last part of the record's address in the dashboard.

The create-case templates write it when they open the case, and the create-from-case templates write it once the record exists. Every other template crosses over by it: the OneUptime → Dynamics 365 ones look the case up by its link, and the Dynamics 365 → OneUptime ones read the record's id off the case. To link a case that was opened by hand, type the value into its link column yourself — but only when the record has no case yet.

**A case is linked to an incident or to an alert, never both.** One column serves both kinds. The incident templates ignore a case linked to an alert, and the other way round, and the create-from-case templates leave alone any case whose link column holds anything at all.

A record has one case. The templates that write to the case act only when exactly one case holds the record's link. If the link is copied into a second case, they stop, and each run ends in a skip that names both:

```text
More than one Dynamics 365 case holds the link oneuptime-incident-<id> (CAS-01001-X1Y2Z3, CAS-01002-K4L5M6). Clear it on every case except the one opened for the incident.
```

Incidents and alerts created from a case also keep the case's id and number in `customFields.dynamicsCaseId` and `customFields.dynamicsCaseNumber`. That is how the create-case templates know the record already has a case. They are written when the record is created, because `customFields` is one value, and writing it later would replace every other custom field on the record.

### How the templates avoid loops

Every write in one direction is an event in the other. A note the templates add to a case comes back as a new note, and a private note they add in OneUptime fires the note trigger. Four things stop the echo:

- **Markers in the text.** Every note the templates add to a case is titled `Synced from OneUptime: …`, and the subject of every Case Resolution they record starts the same way. Every note written from Dynamics 365, and the root cause of every state change made from it, starts with `Synced from Dynamics 365`. Each direction skips text that carries the other side's marker. A note someone writes that quotes a marker is skipped too.
- **The link from the first save.** A case OneUptime opens holds its link from the moment it exists, so when its **Create** comes back, the create-from-case template finds it linked and does nothing.
- **`customFields.dynamicsCaseId`.** A record created from a case carries it, and the create-case templates skip such records.
- **States only move forward, on both sides.** Resolving the record closes the case; the case's **Close** then reaches the status template, which finds the record already resolved and changes nothing. When the case is resolved first, the record is resolved, and its update finds the case already resolved. A case that is already resolved or cancelled is never reopened.

Keep the markers when you edit the templates. They are the `FROM_ONEUPTIME` and `FROM_DYNAMICS` constants in the helper block at the top of every script.

### Changing what a template does

Open the workflow's **Builder** and click the block you want to change. The settings you are most likely to want are constants near the top of a script — the **JavaScript Code** of a **Run Custom JavaScript** block, just below the shared helper block. The incident and alert versions keep the same constants in the same blocks.

| Constant                                       | Template, and block                                                               | What it controls                                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SYNC_PRIVATE_INCIDENTS`, `SYNC_PRIVATE_ALERTS` | Every OneUptime → Dynamics 365 template — `prepare-case-1`, `plan-case-1`, `build-note-1` | `false` keeps private records out of Dynamics 365: no case is opened for one, its case is not changed, and its notes are not added. Set it to `true` in each template that should send them.                                                                                        |
| `SEVERITY_TO_PRIORITY`, `DEFAULT_PRIORITY`     | Create a Dynamics 365 case — `prepare-case-1`                                      | The project's severities are spread across the case priorities by their order: the most severe opens a High case (`1`), the least severe a Low one (`3`), and those between Normal ones (`2`). List a severity by name, in lower case, to choose its priority yourself, such as `{ 'major incident': 1 }`. `DEFAULT_PRIORITY` (`2`) is for a severity the project's list does not have, or a project with only one. |
| `CASE_ORIGIN`, `CASE_TYPE`                     | Create a Dynamics 365 case — `prepare-case-1`                                      | The new case's `caseorigincode` (`3`, Web) and `casetypecode` (`2`, Problem). To set any other column, add it to `CASE` in the same script, under its logical name.                                                                                                                  |
| `MAX_TITLE_LENGTH`, `MAX_DESCRIPTION_LENGTH`   | Create a Dynamics 365 case — `prepare-case-1`                                      | The Case table's own limits, 200 and 2000 characters. The description keeps the link back to OneUptime however much is cut. Raise them if your Case table allows more.                                                                                                              |
| `RESOLVED_CASE_STATUS`                         | Resolve the Dynamics 365 case — `plan-case-1`                                      | The status a resolved record closes its case with: `5` is Problem Solved, `1000` Information Provided.                                                                                                                                                                             |
| `STATE_TO_CASE_STATUS`                         | Resolve the Dynamics 365 case — `plan-case-1`                                      | Moves the case when the record reaches another state, by the state's name: `{ Acknowledged: 4 }` moves it to Researching when the incident is acknowledged. Dynamics 365's active statuses are `1` In Progress, `2` On Hold, `3` Waiting for Details and `4` Researching. A resolved state listed here closes the case with the status it names. |
| `PRIORITY_RANK`                                | Create from a Dynamics 365 case — `prepare-incident-1`, `prepare-alert-1`          | Maps a case priority (`1` High, `2` Normal, `3` Low) to `0` (your most severe severity), `1` or `2` (your least severe). Priorities not listed land in the middle. With the two alert severities a new project has, Normal becomes Low unless you change `2: 1` to `2: 0`.        |
| `ONLY_PRIORITIES`                              | Create from a Dynamics 365 case — `prepare-incident-1`, `prepare-alert-1`          | Empty takes every case the flow or webhook sends. `[1]` creates records for High-priority cases only.                                                                                                                                                                               |
| `CASE_STATUS_TO_STATE`, `CASE_STATE_TO_STATE_FLAG` | Resolve when the Dynamics 365 case is resolved — `decide-state-1`             | A case status, by name, to a OneUptime state, such as `{ Researching: 'Acknowledged' }`. Otherwise the case's state decides: Resolved resolves the record. Add `2: 'isResolvedState'` to resolve it when its case is cancelled too.                                                   |
| `MESSAGES`                                     | Every Dynamics 365 → OneUptime template — `read-event-1`                           | The events the template acts on. Add `'Update'` to the note template's list to copy edited notes as well — each edit becomes a new note.                                                                                                                                            |
| `MAX_NOTE_LENGTH`                              | The note templates — `build-note-1`, `read-note-1`                                 | The longest note each one writes: 100,000 characters into Dynamics 365, which is a note's own limit, and 30,000 into OneUptime.                                                                                                                                                    |

State and status names used as keys must be spelled exactly as they are named, capitals included. Keep `{{` out of the code: a script is substituted like any other setting before it runs, so two opening braces in a row would be read as a reference.

### Limitations

- **Microsoft's commercial cloud.** The token URL is `login.microsoftonline.com`. For US Government (GCC High, DoD) or China clouds, open `dynamicsAccessToken`, use **Edit Settings**, and change the token URL to your cloud's sign-in host, such as `login.microsoftonline.us`.
- **Records and cases never move backwards.** Reopening a case changes nothing in OneUptime, and reopening a record is not possible. A case that is already resolved or cancelled is never reopened to be closed again.
- **Notes are plain text.** A note written in Dynamics 365's rich-text editor arrives in OneUptime as text, and a OneUptime note arrives in Dynamics 365 as its raw characters, Markdown and all. Attachments stay in Dynamics 365; the note in OneUptime names the file.
- **Edited notes are not copied** — only new ones, unless you add `'Update'` to `MESSAGES`.
- **Private incidents and alerts stay in OneUptime**, but the Dynamics 365 → OneUptime templates do not check: notes and status changes on a linked case still reach a private record.
- **Every case gets a record.** Unless you filter the flow or set `ONLY_PRIORITIES`, the create-from-case templates create an incident or alert for every new case they are sent — in a busy customer-service environment, that is a lot.
- **The same event can arrive twice.** A Dataverse webhook retries once when OneUptime answers `502`, `503` or `504`. A retried **Create** that arrives after the first run linked the case is left alone; one that arrives while the first run is still going can create a second record.

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

> **Or let an OAuth 2.0 variable do this step.** A token fetched by an API block is that block's output, and the run log shows it. An [OAuth 2.0 variable](/docs/workflows/variables#oauth-20-variables-tokens-that-refresh-themselves) fetches the token for you, fetches a new one before it expires, and keeps it out of the log. Create one from **Workflows → Global Variables**: open the **More** menu (**⋯**) beside the create button, choose **Create OAuth 2.0 Variable**, pick **Microsoft Entra ID**, put your tenant ID in the token URL, enter the client ID and secret, and set the scope to `https://yourorg.crm.dynamics.com/.default`. Then leave out the `get-token` block below, and send `Bearer {{global.variables.DYNAMICS_TOKEN}}` — your variable's name — in the `Authorization` header. The [templates](#start-from-a-template) sign in this way.

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

Now turn the workflow on — **Overview → Edit Workflow → Enabled** — declare a test incident, and read the run under **Logs → Runs**. The `create-case` block should show a `201` and a body containing the new `incidentid`. Changes on the canvas save themselves; there is no Save button.

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

The [templates](#how-the-two-sides-stay-linked) use a column like this too, holding `oneuptime-incident-<id>` or `oneuptime-alert-<id>` rather than the bare id, so one column serves incidents and alerts and a case can never be taken for the wrong kind. If you build your own workflows beside the templates, write the link the same way.

The reverse direction — storing the Dynamics case id on the OneUptime incident — works too, using an **Update One Incident** block writing to `customFields`. Be careful with it: `customFields` is a single JSON column, so writing it replaces every custom field value on that incident, not just yours. Keeping the link on the Dynamics side avoids that entirely.

## Step 7 — Resolve the case when the incident resolves

Build this as a **second** workflow so a failure here cannot stop cases being opened.

1. **Create Workflow**, name it `Incident resolved → Close Dynamics case`, and add the **On Update Incident** trigger.
2. In the trigger's **Listen on**, put `{"currentIncidentStateId": true}` so the workflow only wakes for state changes rather than every edit. In **Select Fields**, ask for `{"_id": true, "currentIncidentState": {"name": true}}`.
3. Add an **If / Else** block. **Value to check** is `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Comparison** is **is equal to**, and **Compare with** is `Resolved` — or whatever your project's resolved state is called. See [Incident States & Severities](/docs/incidents/states-and-severities).
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
2. Open the workflow's **Builder**, click the **Webhook** trigger, and click **Copy URL** at the top of its settings. The URL looks like this:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   On a self-hosted install, the URL has your own host. Treat the URL like a password — anyone who has it can start the workflow. If it leaks, click **Reset URL** in the same place; the old URL stops working at once.

3. Add an **If / Else** block that checks a shared secret before anything else happens. **Value to check** is `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Comparison** is **is equal to**, and **Compare with** is `{{global.variables.DYNAMICS_WEBHOOK_SECRET}}` — a value you invent and save as a secret global variable.
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

Read the failing block in **Logs → Runs** first — both Microsoft endpoints return an explanatory JSON body, and the API component keeps it in `response-body`.

**The token request fails with `400` and `invalid_request` or an unsupported grant type.** The `Content-Type` header is not exactly `Content-Type: application/x-www-form-urlencoded`, so the body went out as JSON. Check the capitalization.

**`400` with `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.** The `scope` is not your environment URL plus `/.default`. Copy the URL from **Developer resources** and drop any trailing slash and any `/api/data/...` path.

**`401 Unauthorized` from Dynamics.** The `Authorization` header is missing, malformed, or the token has expired mid-run. It must read `Bearer <token>` with a single space.

**`403 Forbidden` with `0x80072560`, "The user isn't a member of the organization".** Step 2 was skipped or the application user is bound to a different app registration. The token is fine; the Dynamics-side user is not there.

**`403 Forbidden` with a privilege error.** The application user exists but its custom security role lacks Create, Read or Write on **Case**.

**`400 Bad Request` mentioning the customer.** `customerid` is required. Set `customerid_account@odata.bind` or `customerid_contact@odata.bind`, spelled exactly, with a leading-slash URI such as `/accounts(<guid>)`.

**`404 Not Found` on `/CloseIncident`.** The action is a Dynamics 365 Customer Service action. Search your environment's `$metadata` for it before assuming it is available.

**`412 Precondition Failed` with `DuplicateRecord`.** A duplicate detection rule matched. Either narrow the rule or stop sending the field it matches on.

**`429 Too Many Requests`.** Dataverse's service protection limits — roughly 6,000 requests and 20 minutes of execution time per user in any five-minute window, per web server. The response carries a `Retry-After` in seconds. If a workflow is bursting, put a **Delay** block in it or move the work to a scheduled workflow that batches.

**Nothing arrives on the OneUptime side.** Send a request to the webhook URL yourself with `curl` and check the workflow's **Logs → Runs**. If your own request shows up and Dynamics' does not, the problem is upstream: for Power Automate, look at the flow's own run history; for a native webhook, look at **Settings → System Jobs** filtered to failures.

**The workflow runs but the incident does not change.** An **Update One Incident** block reports `Items Updated: 0` when the query matched nothing — that is a success, not an error. Check that the id in the payload is the OneUptime incident id and that you are querying `_id`.

## Where to read next

- [Integrations Overview](/docs/integrations/index) — the inbound and outbound patterns, and the auth cheat sheet.
- [Jira](/docs/integrations/jira) — the same two-direction build against Jira.
- [Workflows Overview](/docs/workflows/index) and [Authoring a Workflow](/docs/workflows/authoring) — the canvas, identifiers, and turning a workflow on.
- [Components](/docs/workflows/components) — the API blocks, If / Else, and the OneUptime data components.
- [Variables](/docs/workflows/variables) — secrets, and reading one block's output from the next.
- [Configuration & Safety](/docs/workflows/configuration) — webhook security and outbound network access.
- [IP Addresses](/docs/configuration/ip-addresses) — OneUptime's outbound ranges, if Dynamics sits behind an allow list.
