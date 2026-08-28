# Jira Integration

Open a [Jira](https://www.atlassian.com/software/jira) issue whenever a OneUptime incident is declared, keep it in step as the incident moves, and let Jira push status changes back into OneUptime — all with a [Workflow](/docs/workflows/index). There is no Jira-specific block to install: OneUptime calls Jira's REST API with the [API component](/docs/workflows/components#api), and Jira calls back into a [Webhook trigger](/docs/workflows/triggers#webhook).

```text
OneUptime Incident → On Create  ──►  API Post (POST /rest/api/3/issue)  ──►  Jira issue

Jira issue transitioned  ──►  Automation rule (Send web request)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

This page builds both directions. Everything up to the inbound section is written for **Jira Cloud**; a section near the end lists what changes on **Jira Data Center**.

> Atlassian has been renaming things in Jira Cloud: a **project** is now a **space** in much of the UI, and an **issue** is a **work item**. Tenants are on both vocabularies, so where the wording matters below you will find both.

## Prerequisites

- A Jira Cloud site (`https://your-domain.atlassian.net`) and a project to file issues in. Note its **project key** — the `OPS` in `OPS-1234`.
- A Jira account that can create issues in that project, and an **API token** for it from [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens). Use a service account rather than a person's — issues created this way are attributed to the token's owner.
- Permission to create automation rules in that project, for the inbound half.
- A OneUptime project where you can create workflows and global variables.

## Step 1 — Store the Jira credentials as a secret

Jira Cloud's REST API takes **Basic auth** built from your Atlassian account email and an API token, base64-encoded together.

1. Encode `email:api_token` once:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

   Use `printf`, not `echo`. `echo` appends a newline, the newline is encoded along with everything else, and Jira answers `401` for reasons that are invisible in the string you pasted.

2. In OneUptime, go to **Workflows → Global Variables → Create**. Name it `JIRA_AUTH`, paste the base64 string as **Content**, and turn on **Secret**.
3. Add a second, non-secret variable `JIRA_URL` holding `https://your-domain.atlassian.net` with no trailing slash.

Any block can now use `Basic {{global.variables.JIRA_AUTH}}` as its `Authorization` header, and the token never appears in the workflow or its run logs. See [Variables](/docs/workflows/variables).

Two things about Atlassian API tokens that will eventually bite an integration nobody is watching:

- **They expire.** Tokens are created with a lifetime of one day to one year, one year by default, and there is no refresh — an expired token has to be replaced by hand on the same page and re-encoded into `JIRA_AUTH`. Put the expiry date in a calendar somewhere. When a workflow that has worked for months starts answering `401`, this is why.
- **A scoped token needs a different base URL.** The token page offers **Create API token with scopes** as well as the classic **Create API token**. Scoped tokens are the more secure choice, but they are not addressed at your site: they go to `https://api.atlassian.com/ex/jira/<cloudId>`, so `JIRA_URL` becomes that instead, and every path below hangs off it unchanged. Your `cloudId` is in the JSON at `https://your-domain.atlassian.net/_edge/tenant_info`. A scoped token sent to `your-domain.atlassian.net` simply fails.

## Step 2 — Open a Jira issue for every incident

1. Open **Workflows → Create Workflow**, name it `Incidents → Jira`, and open the **Builder**.
2. Click the dashed placeholder block and add the **On Create Incident** trigger. In its **Select Fields**, ask for the columns you want to send:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   Leave its **Identifier** as `incident-on-create-1` — that is the name later blocks refer to it by.

3. Click **Add Component**, add an **API Post (JSON)** block, and drag from the trigger's **Success** dot to the new block's input dot. Open it, set its **Identifier** to `create-issue`, and fill in:

   - **URL**: `{{global.variables.JIRA_URL}}/rest/api/3/issue`
   - **Request Headers**:

     ```json
     {
       "Authorization": "Basic {{global.variables.JIRA_AUTH}}",
       "Accept": "application/json"
     }
     ```

   - **Request Body**:

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
         "labels": ["oneuptime"],
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 {
                   "type": "text",
                   "text": "{{local.components.incident-on-create-1.returnValues.model.description}}"
                 }
               ]
             }
           ]
         }
       }
     }
     ```

   Replace `OPS` with your project key and `Bug` with an issue type that exists in that project. Both can also be given by id — `{"id": "10000"}` — which is what Atlassian's own examples use and what you should prefer if two issue types in your site share a name. The `createmeta` calls further down hand you those ids.

The description looks heavy because Jira Cloud's v3 API takes rich text as **Atlassian Document Format** — a document tree, not a string. The shape above is the minimum valid document: one paragraph holding one text node. The same applies to `environment` and to any multi-line text custom field; single-line text custom fields still take a plain string.

Now turn the workflow on from **Overview → Edit Workflow → Enabled**, declare a test incident, and open **Runs & Logs**. The `create-issue` block should show a `201` and a body containing the new issue's `id`, `key` and `self`. Changes on the canvas save themselves — there is no Save button, and a disabled workflow cannot run at all, not even by hand.

The new issue key is available to any block after this one:

```text
{{local.components.create-issue.returnValues.response-body.key}}
```

### Filling in more fields

A few common additions inside `fields`:

- **Priority** — `"priority": { "id": "20000" }`, using a priority id from your site. To map OneUptime severities onto Jira priorities, put an **If / Else** block between the trigger and the API block and branch on `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}`.
- **Assignee** — `"assignee": { "id": "<accountId>" }`. Jira Cloud identifies people by Atlassian account id; `username` and `userKey` were removed from the Cloud API years ago.
- **Labels** — `"labels": ["oneuptime", "sev1"]`, a flat array of strings. Labels cannot contain spaces.
- **Components** — `"components": [{ "id": "10000" }]`.
- **Custom fields** — `"customfield_10034": "..."`, using the field's own id. The value's shape follows the field's type: a single-select takes `{"value": "red"}`, a multi-select an array of ids, a multi-line text field an Atlassian Document Format document.

To find what a project actually requires, ask Jira rather than guessing. List the issue types in a project, then the fields for one of them:

```bash
curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes'

curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes/10001'
```

The second call lists every field that issue type accepts, which of them are required, and the exact `customfield_NNNNN` ids. To read the ids off an issue you already have, fetch it with `?expand=names`.

## Step 3 — Carry the incident id into Jira

Both halves of a two-way sync need one system to hold the other's identifier, and Jira is the better place to keep it: OneUptime's `customFields` column is a single JSON blob, so writing one value from a workflow replaces every custom field on that incident.

**With a Jira admin.** Add a short text custom field — call it *OneUptime Incident ID* — to the project's create screen, find its id with `createmeta`, and set it alongside everything else:

```json
"customfield_10050": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

**Without one.** Put it in a label instead. Labels take no spaces, and a OneUptime id is a plain UUID, so `oneuptime-<id>` is a valid label:

```json
"labels": ["oneuptime", "oneuptime-{{local.components.incident-on-create-1.returnValues.model._id}}"]
```

The inbound workflow then has to pick that label out of the list, which is a couple of lines in a **Run Custom JavaScript** block. The custom field is tidier if you can have one.

While you are here, it is worth adding a link on the Jira issue back to the incident. An **API Post (JSON)** block after `create-issue`, pointed at `{{global.variables.JIRA_URL}}/rest/api/3/issue/{{local.components.create-issue.returnValues.response-body.key}}/remotelink`, with:

```json
{
  "globalId": "system=https://oneuptime.com&id={{local.components.incident-on-create-1.returnValues.model._id}}",
  "object": {
    "url": "https://oneuptime.com/dashboard/{{local.components.incident-on-create-1.returnValues.model.projectId}}/incidents/{{local.components.incident-on-create-1.returnValues.model._id}}",
    "title": "OneUptime incident #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}"
  }
}
```

gives everyone in Jira a one-click route back. Add `projectId` to the trigger's **Select Fields** for this. The `globalId` is what makes the call safe to repeat: Jira updates the link that already carries that id instead of adding a second one. Because an update also nulls anything you leave out, always send the whole `object`, not a patch of it.

## Step 4 — Comment and transition as the incident moves

Build this as a **second** workflow, so a failure here can never stop issues being opened.

1. **Create Workflow**, name it `Incident updates → Jira`, and add the **On Update Incident** trigger.
2. In **Listen on**, put `{"currentIncidentStateId": true}`. The trigger then only fires for state changes instead of every edit. In **Select Fields**, ask for `{"_id": true, "currentIncidentState": {"name": true}}`.
3. Add an **If / Else** block: **Input 1** `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** `==`, **Input 2** `Resolved` — or whatever your project's resolved state is called. See [Incident States & Severities](/docs/incidents/states-and-severities).

From the **Yes** branch you first have to find the issue you opened in Step 2. Ask Jira for it by the id you stored in Step 3, with an **API Post (JSON)** block whose **Identifier** is `find-issue`:

- **URL**: `{{global.variables.JIRA_URL}}/rest/api/3/search/jql`
- **Request Body**:

  ```json
  {
    "jql": "project = OPS AND labels = \"oneuptime-{{local.components.incident-on-update-1.returnValues.model._id}}\"",
    "maxResults": 1
  }
  ```

  If you used a custom field rather than a label, the clause becomes `cf[10050] ~ \"...\"` with your own field id.

The issue id is then `{{local.components.find-issue.returnValues.response-body.issues[0].id}}`, and every endpoint below takes an id just as happily as a key.

Three things about this endpoint are worth knowing. **Post the JQL, do not put it in the URL** — a query string containing `=` inside a value is truncated on its way out of a workflow, and JQL is nothing but `=` signs. **The query must be bounded**: a bare `order by key desc` is rejected with `400`, which is why the `project =` clause is there. And `/rest/api/3/search/jql` is the current endpoint — the older `/rest/api/3/search` is deprecated and on its way out, so do not reach for it.

**Leaving a comment** is a single **API Post (JSON)** block to `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/comment`, with an Atlassian Document Format body just like the description:

```json
{
  "body": {
    "type": "doc",
    "version": 1,
    "content": [
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "Resolved in OneUptime." }]
      }
    ]
  }
}
```

**Moving the issue** takes two calls, because a transition is identified by an id that differs between workflows and, on some boards, between issues.

1. An **API Get (JSON)** block on `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/transitions` returns the transitions available *from the issue's current status*, each with an `id` and a `name`, and a `to` object naming the status it leads to.
2. An **API Post (JSON)** block to the same URL performs one:

   ```json
   { "transition": { "id": "31" } }
   ```

A successful transition answers `204` with no body. If you would rather not read the list at runtime, call it once by hand for an issue in the right status and hard-code the id — just remember it is tied to that workflow, so an admin editing the Jira workflow can break it silently.

## Inbound — Jira to OneUptime

Now the other direction: someone moves the issue to Done, and the OneUptime incident should follow.

### Build the receiving workflow first

1. **Create Workflow**, name it `Jira → OneUptime`, and add the **Webhook** trigger.
2. Open that workflow's **Settings** and copy the **Webhook Secret Key**. Your URL is:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   Self-hosted installs use their own host. Treat the URL like a password — anyone who has it can start the workflow — and reset the key from that same page if it leaks.

3. Add an **If / Else** block that checks a shared secret before anything else runs. **Input 1** is `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** `==`, **Input 2** is `{{global.variables.JIRA_WEBHOOK_SECRET}}` — a value you invent and save as a secret global variable.
4. From the **Yes** branch, add an **Update One Incident** block:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: what the Jira change should mean here — usually a state change.

   Moving an incident needs the target state's id, which a **Find One Incident State** block with the query `{"name": "Resolved"}` will give you as `{{local.components.incident-state-find-one-1.returnValues.model._id}}`. Write that into `currentIncidentStateId`.

Leave the workflow enabled. Now give Jira something to call.

### Send the event from a Jira automation rule

1. In Jira, open the project's automation rules: **Space settings → Automation** on newer tenants, **Project settings → Automation** on older ones. For a rule spanning several projects use **Settings → System → Global automation**, which needs the *Administer Jira* global permission.
2. **Create rule**, and pick the **Work item transitioned** trigger — **Issue transitioned** on older tenants. Set it to run when the status moves *to* **Done**.

   Use this trigger, not *Work item updated*: the update trigger deliberately excludes status changes.

3. Add the **Send web request** action and configure it:

   - **Web request URL**: the OneUptime webhook URL from above.
   - **HTTP method**: `POST`
   - **Headers**: `Content-Type` / `application/json`, and `X-OneUptime-Secret` / your shared secret. Use the **Hide** option on the secret's value so other rule editors cannot read it — note that hiding is irreversible for that value, and hidden values are lost if the rule is exported or duplicated.
   - **Web request body**: **Custom format**, so you control the shape:

     ```json
     {
       "oneuptimeIncidentId": "{{issue.customfield_10050}}",
       "issueKey": "{{issue.key}}",
       "summary": "{{issue.summary}}",
       "status": "{{issue.status.name}}"
     }
     ```

     If you used a label instead of a custom field in Step 3, send `"labels": "{{issue.labels}}"` and pull the id out with a **Run Custom JavaScript** block on the OneUptime side.

4. Turn the rule on, move a test issue to Done, and check both sides: the rule's own audit log in Jira, and **Runs & Logs** in OneUptime.

Things worth knowing before you rely on this:

- **The destination port is restricted.** Send web request only reaches ports 80, 8080, 443, 6017, 8443, 8444, 7990, 8090, 8085, 8060, 8900 and 9900. OneUptime Cloud is on 443; a self-hosted install on an unusual port cannot be called this way.
- **There is no request signing.** The action has no HMAC option, so a shared secret in a header over HTTPS is the mechanism Atlassian documents. The **If / Else** check in Step 3 of the receiving workflow is what makes that worth having.
- **Rule runs are metered.** Jira Cloud counts successful rule executions against a monthly allowance that depends on your plan — 100 on Free, 1,700 on Standard, 1,000 × users on Premium, unlimited on Enterprise. A rule that fires on every transition in a busy project adds up.
- **Values are not URL-encoded** for you. That only matters if you send a form-encoded body; the JSON above is fine.
- **Atlassian publishes its egress ranges** at [ip-ranges.atlassian.com](https://ip-ranges.atlassian.com) if your OneUptime install sits behind an allow list. They change, so poll the feed rather than pinning addresses.

### Or use a Jira webhook instead

A Jira admin can register a webhook directly under **Settings → System → Advanced → WebHooks**, choosing the events to send and, optionally, a JQL query that narrows which issues fire it. Compared with an automation rule:

- The payload is Jira's own, not yours: `webhookEvent`, `issue_event_type_name`, the full `issue`, and a `changelog` whose `items` array holds the before-and-after of every changed field. For a status change you want the entry where `field` is `status`. Reading that inside a workflow usually means a **Run Custom JavaScript** block.
- Webhooks **can** be signed — give the webhook a secret and Jira sends an `X-Hub-Signature` header holding an HMAC of the request body — but a workflow cannot check it. The signature covers the exact bytes Jira sent, and the Webhook trigger hands the workflow a body that has already been parsed into JSON, so there is nothing left to hash. If you want the request authenticated, use an automation rule with a shared-secret header instead.
- The URL must be HTTPS on a port from Jira's own list, which is *not* the same list the automation action uses — port 80 is not allowed here.
- Delivery is retried up to five times with a five to fifteen minute backoff, so your workflow must tolerate the same event arriving twice.

Webhooks registered by an app through `/rest/api/3/webhook` are a different thing again: they expire 30 days after registration unless refreshed. The admin-registered ones above do not expire.

## Jira Data Center

Self-managed Jira works the same way with a handful of substitutions. **Jira Server** reached end of support in February 2024 and receives no fixes, so treat Data Center as the self-managed target.

| Cloud                                             | Data Center                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/rest/api/3/...`                                 | `/rest/api/2/...` — there is no v3 on Data Center                            |
| `description` as an Atlassian Document Format doc | `description` as a plain string in wiki markup                               |
| `Authorization: Basic base64(email:api_token)`    | `Authorization: Bearer <personal access token>`                              |
| API token from id.atlassian.com                   | **Profile → Personal access tokens → Create token** on your own Jira account |
| Automation action **Send web request**            | Automation action **Send outgoing web request**                              |

So the create-issue block becomes a `POST` to `/rest/api/2/issue` with:

```json
{
  "fields": {
    "project": { "key": "OPS" },
    "issuetype": { "name": "Bug" },
    "summary": "OneUptime #123: Checkout is down",
    "description": "Plain text goes straight in here."
  }
}
```

which is simpler to template — no document tree.

Other differences to plan for:

- **Personal access tokens** exist from Jira Core and Jira Software 8.14 and Jira Service Management 4.15. They expire — 365 days by default — and the UI flags one as *Expires soon* five days out. Basic auth with a username and password still works on Data Center, but a few failed logins trigger a CAPTCHA that locks the account out of the REST API entirely until a human clears it in a browser, which is a bad way to discover a typo. Prefer a token.
- **Automation is bundled** from Jira Data Center 10.0. Before that it was the separately installed Automation for Jira app. Its outgoing request has a default timeout of 3000 ms, tunable with the `outgoing.webhook.timeout.ms` property.
- **Webhooks** are registered at **Administration → System → Advanced → WebHooks**, and JQL scoping is supported. Keep those filters narrow: Jira evaluates every registered webhook's JQL on the thread that raised the event, so a dozen loose filters slow down the user action that triggered them.
- **From Data Center 10.0 webhook delivery is asynchronous** and there is no synchronous option, so events can arrive out of order. Make the receiving workflow idempotent.
- **Jira 10 dropped the `$` in webhook URL variables** — `${issue.id}` became `{issue.id}` — and moved the webhook REST resource from `/rest/webhooks/1.0/webhook` to `/rest/jira-webhook/1.0/webhooks`.

## Troubleshooting

Open the failing block in **Runs & Logs** first. Jira returns a JSON body naming exactly what it rejected, and the API component keeps it in `response-body`.

**`401 Unauthorized`.** Re-encode `email:api_token` with `printf` and update `JIRA_AUTH`; a trailing newline from `echo` is the usual cause. Then confirm the account owning the token can create issues in that project. On Data Center, check you are sending `Bearer`, not `Basic`.

**`400 Bad Request` naming a field.** The issue type does not exist in the project, or the project has a required field you are not sending. Run the `createmeta` calls above against that project and issue type and compare.

**`400` complaining about `description`.** On Cloud v3 the description must be an Atlassian Document Format document, not a string. Either send the document shown above, or switch that block to `/rest/api/2/issue` and send plain text.

**`404 Not Found`.** Check the base URL and the API version — `/rest/api/3/...` on Cloud, `/rest/api/2/...` on Data Center.

**`429 Too Many Requests`.** Jira is rate limiting. The response carries `Retry-After` in seconds and a `RateLimit-Reason` naming which limit you hit. Writes against a single issue are capped tightly — on the order of twenty in two seconds — so a workflow that comments and transitions in quick succession can trip it on one issue alone. Put a **Delay** block between the calls, or move bulk work to a scheduled workflow.

**The transition call returns `400`.** The transition id is not valid from the issue's *current* status. Fetch `/transitions` for that issue and use an id from the response.

**The automation rule shows as successful but nothing reaches OneUptime.** Check the port first — see the restricted list above. Then send a request to the webhook URL yourself with `curl` and see whether it appears in **Runs & Logs**; if yours arrives and Jira's does not, the problem is on Jira's side.

**The workflow runs but the incident does not change.** An **Update One Incident** block reports `Items Updated: 0` when its query matched nothing, and that counts as success, not an error. Check the id in the payload really is the OneUptime incident id and that you are querying `_id`.

**A `{{...}}` reference shows up literally in a Jira issue.** An unresolved reference is passed through as text rather than blanked. The run log names any reference that did not resolve — usually a mistyped block identifier or a renamed variable.

## Where to read next

- [Integrations Overview](/docs/integrations/index) — the inbound and outbound patterns, and the auth cheat sheet.
- [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) — the same two-direction build against Dynamics.
- [Workflows Overview](/docs/workflows/index) and [Authoring a Workflow](/docs/workflows/authoring) — the canvas, identifiers, and turning a workflow on.
- [Components](/docs/workflows/components) — the API blocks, If / Else, and the OneUptime data components.
- [Variables](/docs/workflows/variables) — secrets, and reading one block's output from the next.
- [Configuration & Safety](/docs/workflows/configuration) — webhook security and outbound network access.
- [ServiceNow](/docs/integrations/servicenow) and [PagerDuty](/docs/integrations/pagerduty) — the same outbound pattern for other tools.
