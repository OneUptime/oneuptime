# Jira Integration

Open a [Jira](https://www.atlassian.com/software/jira) issue whenever a OneUptime incident is declared, keep it in step as the incident moves, and let Jira push status changes back into OneUptime — all with a [Workflow](/docs/workflows/index). There is no Jira-specific block to install: OneUptime calls Jira's REST API with the [API component](/docs/workflows/components#api), and Jira calls back into a [Webhook trigger](/docs/workflows/triggers#webhook).

```text
OneUptime Incident → On Create  ──►  API Post (POST /rest/api/3/issue)  ──►  Jira issue

Jira issue transitioned  ──►  Automation rule (Send web request)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

The quickest way in is one of the nine ready-made Jira templates, described in the next section. The rest of the page builds both directions by hand, which is also your reference when you want a template to do something different. Everything up to the inbound section is written for **Jira Cloud**; a section near the end lists what changes on **Jira Data Center**.

> Atlassian has been renaming things in Jira Cloud: a **project** is now a **space** in much of the UI, and an **issue** is a **work item**. Tenants are on both vocabularies, so where the wording matters below you will find both.

## Start from a template

The workflow picker has nine Jira templates, grouped under **Jira**. Each one is a small workflow of its own, so you can take only the directions you want. They share one convention — a label on the Jira issue — so any combination of them works together.

| Template                                                          | What it does                                                                                                                                                                  | What it asks for                                                |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **OneUptime → Jira**                                              |                                                                                                                                                                               |                                                                 |
| Create a Jira issue when an incident is declared                  | Files an issue for every new incident and labels it with the incident's id. Incidents declared from Jira, and private incidents, are skipped.                                 | Site URL, API token, project key, issue type, OneUptime URL     |
| Move the Jira issue when the incident is acknowledged or resolved | Moves the linked issue forward: to an In Progress status when the incident is acknowledged, and to a Done status when it is resolved. Never moves it back.                    | Site URL, API token                                             |
| Copy private notes to the Jira issue                              | Posts each new private note as a comment on the linked issue — an internal comment in Jira Service Management.                                                                | Site URL, API token                                             |
| Copy public notes to the Jira issue                               | Posts each new public note as a comment on the linked issue.                                                                                                                  | Site URL, API token                                             |
| Comment on the Jira issue when the incident is edited             | When the incident's title, description, severity, root cause or remediation notes change, posts how the incident now stands — an internal comment in Jira Service Management. | Site URL, API token                                             |
| **Jira → OneUptime**                                              |                                                                                                                                                                               |                                                                 |
| Declare an incident when a Jira issue is created                  | Declares an incident for each new issue, with a severity chosen from the issue's priority, then labels the issue to link the two.                                             | Site URL, API token, and a Jira webhook for **Issue created**   |
| Acknowledge or resolve the incident when its Jira issue moves     | Acknowledges the incident when its linked issue moves to an In Progress status, and resolves it when the issue moves to a Done status.                                        | A Jira webhook for **Issue updated**                            |
| Add Jira comments to the incident as private notes                | Copies each comment on a linked issue onto the incident as a private note.                                                                                                    | Site URL, API token, and a Jira webhook for **Comment created** |
| Add Jira issue changes to the incident as private notes           | Notes each edit to a linked issue — priority, assignee, summary and so on — on the incident as a private note. Status changes are left to the template above.                 | A Jira webhook for **Issue updated**                            |

None of the OneUptime → Jira templates send an incident marked [**Private Incident**](/docs/incidents/declaring-incidents#step-5-more) to Jira — not the incident, its state, its notes or its edits — unless you switch that on. See [Limitations](#limitations).

### What the templates ask for

The **Configure** step of the create wizard asks for up to five values. The table above shows which ones each template needs.

- **Jira Site URL** — your site, such as `https://your-domain.atlassian.net`, with no trailing slash. With a scoped API token (below), which includes every service account token, use `https://api.atlassian.com/ex/jira/<cloudId>` instead. Your `cloudId` is in the JSON at `https://your-domain.atlassian.net/_edge/tenant_info`.
- **Jira API Token (base64 of email:token)** — not the token on its own, but the account's email and token encoded together, which is how Jira Cloud takes Basic auth:

  1. Create a token for a dedicated Jira user — an ordinary Atlassian account used only by the integration — rather than for a person: issues and comments are attributed to the token's owner. Sign in as that user and create the token at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens). A classic token (**Create API token**) works with your site URL. A scoped token (**Create API token with scopes**) only works with the `api.atlassian.com` address above; the classic scopes `read:jira-work` and `write:jira-work` cover every call the templates make.

     An Atlassian **service account** works too, set up differently. An organization admin creates it, and its token, in [admin.atlassian.com](https://admin.atlassian.com) under **Directory → Service accounts**, not at id.atlassian.com. That token is always scoped, so **Jira Site URL** must be the `https://api.atlassian.com/ex/jira/<cloudId>` address, and the email you encode in the next step is the service account's own, not the admin's. Give the service account access to Jira and the project permissions listed below, as you would any user.

  2. Encode that account's email and the token:

     ```bash
     printf '%s' 'jira-bot@example.com:your_api_token' | base64 | tr -d '\n'
     ```

     Use `printf`, not `echo`: `echo` appends a newline, the newline is encoded along with everything else, and Jira no longer accepts the credentials. On your site URL that seldom shows up as a `401`; [Limitations](#limitations) describes what it does look like, and how to test the value. The `tr` at the end keeps the output on one line — GNU `base64` on Linux wraps every 76 characters, and a current Atlassian token is long enough to be wrapped.

  3. Paste the output into this field.

  Tokens expire, a year after creation by default. Note the date somewhere; [Limitations](#limitations) describes what an expired token looks like.

- **Jira Project Key** — the project (space) new issues are filed in: the `OPS` in `OPS-123`.
- **Jira Issue Type** — the type of issue to create, spelled exactly as it is in that project, such as `Task`, `Bug` or `Incident`.
- **OneUptime URL** — the address you open OneUptime at: `https://oneuptime.com`, or your own host. The issue's description links back to the incident with it.

The account behind the token needs **Browse Projects**, **Create Issues**, **Edit Issues**, **Add Comments** and **Transition Issues** in that project. Between them, the templates search for, create, label, comment on and transition issues. Registering the webhooks further down needs a Jira administrator.

### Create the workflows

1. Open **Workflows → Create Workflow**. Under **Start from**, pick a card from the **Jira** group. Typing `Jira` into **Search templates…** narrows the list.
2. **Name** is filled in from the template. Change it if you like.
3. **Configure** asks for the values above. They are saved as that workflow's own variables, under **Workflow Variables** in its left menu. The API token is saved as a secret: it is redacted from **Runs & Logs**, and it only ever goes into the `Authorization` header of the Jira calls.
4. Click **Create Workflow**. Every workflow is created **disabled**. Turn it on from **Overview → Edit Workflow → Enabled**.

Start with **Create a Jira issue when an incident is declared**. Every other OneUptime → Jira template finds the issue by the label this one adds. Enable it, declare a test incident, and open the workflow's **Runs & Logs**: the run's last step should read `✅ Created Jira issue` and name the new issue.

Each workflow keeps its own copy of these values. When you replace the token, update `jiraBasicAuthToken` under **Workflow Variables** in every Jira workflow that asked for it.

### Connect the webhook templates

The four Jira → OneUptime templates start from a [Webhook trigger](/docs/workflows/triggers#webhook), so Jira has to be told where to send its events. Do it in this order:

1. Create the workflow and **enable it first**. A disabled workflow answers Jira with `400`, and Jira does not retry a delivery that was refused with a `4xx` like that. Events sent before you enable the workflow are lost, not queued.
2. Open the workflow's **Builder**, click the **Webhook** trigger block (`webhook-1`), and copy the URL from its **Documentation** card:

   ```text
   https://<your OneUptime host>/workflow/trigger/<webhook secret key>
   ```

3. In Jira, go to **Settings → System → WebHooks** (under **Advanced**) and click **Create a WebHook**. Paste the URL, tick the event from the table below — the events are grouped under **Issue related events** — and enter a JQL filter so only your project's issues fire it. Leave **Exclude body** unticked; the workflow reads everything from the body.

| Template                                                      | Jira event          | JQL filter                                                   |
| ------------------------------------------------------------- | ------------------- | ------------------------------------------------------------ |
| Declare an incident when a Jira issue is created              | **Issue created**   | `project = OPS AND (labels is EMPTY OR labels != oneuptime)` |
| Acknowledge or resolve the incident when its Jira issue moves | **Issue updated**   | `project = OPS`                                              |
| Add Jira comments to the incident as private notes            | **Comment created** | `project = OPS`                                              |
| Add Jira issue changes to the incident as private notes       | **Issue updated**   | `project = OPS`                                              |

Replace `OPS` with your project key. The filter on the declare template keeps the issues OneUptime opened from reaching it at all. The template would skip them anyway, but an event that never arrives costs no run. `labels != oneuptime` on its own would also drop every issue that has no labels, which is why `labels is EMPTY` is there.

The other three only act on linked issues, so `project = OPS AND labels = oneuptime` is a tighter filter for them if you want fewer runs.

Each workflow has its own URL, so each needs its own Jira webhook. Two templates on **Issue updated** mean two webhooks.

Before you rely on it:

- **Jira only calls HTTPS, on its allowed ports.** OneUptime Cloud is fine. A self-hosted install has to be reachable from the internet over HTTPS on a port from Jira's list — see [Or use a Jira webhook instead](#or-use-a-jira-webhook-instead).
- **Anyone who has the URL can trigger the workflow.** Jira's webhooks carry nothing a workflow can verify, so the URL is the only secret. Someone who has it can declare incidents — the declare template asks Jira whether the issue they name exists and is not linked yet, but takes the title, description and priority from the request — and can move or add notes to incidents whose id or Jira issue key they know. Keep the URL in Jira only. If it leaks, click **Reset Secret Key** on the workflow's **Settings** page and paste the new URL into the Jira webhook.
- **Every event is a run.** On OneUptime Cloud each delivery counts toward your plan's workflow runs, including the ones a template skips. The JQL filter is what keeps that number down. See [Plan limits](/docs/workflows/configuration#plan-limits).

### Check that it works

Every template ends in a **Log** step that says what happened, so the last step of a run in **Runs & Logs** is the place to look:

- `✅` — it did its job, and names the issue or incident.
- `ℹ️` — it skipped the event on purpose, and says why: the issue is not linked, the note came from Jira, the incident is private, the new state has no Jira status mapped to it.
- `❌` — a call failed. For a Jira call, the line includes Jira's answer.
- `⚠️` — the declare template declared the incident, but Jira did not accept the link labels, so the other templates cannot find it yet.

A skipped run still ends **Executed**. Skips are normal: most Jira events are not ones a given template acts on. See [Runs & Logs](/docs/workflows/runs-and-logs).

### How the two sides stay linked

Jira holds the link. An issue that belongs to an incident carries two labels:

- `oneuptime`, which marks the issue as linked.
- `oneuptime-incident-<incident id>`, which names the incident. The id is the last part of the incident's address in the dashboard, `/dashboard/<project id>/incidents/<incident id>`.

**Create a Jira issue when an incident is declared** adds both labels when it files the issue. **Declare an incident when a Jira issue is created** adds both to the issue once the incident exists. Every other template crosses over by these labels: the OneUptime → Jira ones search Jira for the incident's label, and the Jira → OneUptime ones read the incident id off the issue's labels. So do not rename or remove them. To link an issue that was opened by hand, add the two labels to it yourself — but only when the incident has no issue yet.

An incident has one issue. The templates that post to or move the issue act only when exactly one issue carries the incident's label. Cloning an issue in Jira copies its labels, both of them, so a clone of a linked issue claims the same incident. From then on those templates stop, and each run ends in a skip that names both issues:

```text
More than one Jira issue is labelled oneuptime-incident-<id> (OPS-17, OPS-30). A cloned issue copies the label: remove it from every issue except the one filed for the incident.
```

The other direction has no such check. Status changes, comments and edits on the clone reach the incident as if they were made on the original. So when you clone a linked issue, remove both labels from the clone.

Incidents declared from Jira also record the issue key in `customFields.jiraIssueKey`. That is how **Create a Jira issue when an incident is declared** knows the incident already has an issue.

The link lives in Jira, not on the incident, because of how `customFields` works: it is one JSON value, so a workflow that writes one key into it replaces every other custom field on the incident (see [Step 3](#step-3-carry-the-incident-id-into-jira)). The declare template can write `jiraIssueKey` safely only because it does so when the incident is created, when there is nothing there to replace.

### How the templates avoid loops

Every write in one direction is an event in the other. A comment the templates post in Jira comes back as a **Comment created** webhook, and a note they add in OneUptime fires the note trigger. Three things stop the echo:

- **Markers in the text.** Every comment the templates post in Jira starts with `Synced from OneUptime`. Every note written from Jira, and the root cause of every state change made from Jira, starts with `Synced from Jira`. Each direction skips text that contains the other side's marker: a Jira comment containing `Synced from OneUptime` is not copied back, and a note containing `Synced from Jira` is not posted to Jira. A comment someone writes that quotes a marker is skipped too.
- **Labels on new issues.** Issues OneUptime opened carry the `oneuptime` label, and the declare template skips any issue that has it — the JQL filter above keeps them from reaching it at all. Before it declares anything, the declare template also asks Jira for the issue's labels, rather than trusting the event. Incidents declared from Jira carry `customFields.jiraIssueKey`, and the create template skips those.
- **States only move forward, on both sides.** The status template (**Acknowledge or resolve the incident when its Jira issue moves**) writes a new row on the incident's state timeline, the same as the **Resolve** button does, and only ever to a state later in the order than the current one. The transition template (**Move the Jira issue when the incident is acknowledged or resolved**) never moves an issue back either. When the incident is resolved from Jira, the transition template finds the issue already Done and stops. When the incident is resolved in OneUptime and the issue moves to Done, the status template finds the incident already resolved and changes nothing.

Keep the markers when you edit the templates. They are the `FROM_ONEUPTIME` and `FROM_JIRA` constants in the helper block at the top of every script. Change the words around them as you like, but a comment or note written without its marker is copied straight back.

### How the transition template picks a status

Jira has no "move to Done" call. An issue moves by a transition, and which transitions it has depends on its workflow and its current status. So **Move the Jira issue when the incident is acknowledged or resolved** reads the transitions open to the issue and chooses one by the status it leads to:

- **Only forward.** Jira sorts statuses into three categories, To Do, In Progress and Done, and the template never picks a transition into an earlier category than the issue's current one — not even for a status you named in `STATE_TO_JIRA_STATUS`. Acknowledging an incident whose issue is already Done ends in `Jira issue OPS-17 is already Done, so it was not moved back to an In Progress status.`
- **The usual names first.** For a resolved incident, a status named Done, Resolved, Closed, Complete, Completed or Fixed wins. For an acknowledged one, In Progress or Work in Progress wins. A status with any other name in the right category is used when it is the only one that fits.
- **Never a guess that drops the work.** A status whose name reads like Canceled, Declined, Rejected, Won't Do, Duplicate, Obsolete, Waiting, Pending, Escalated, On Hold or Blocked is never chosen unless `STATE_TO_JIRA_STATUS` names it. So a Jira Service Management request that can go to Resolved or to Canceled goes to Resolved.
- **Two ways to the same status.** When two transitions lead to one status, it takes the one without a screen.

When that still leaves it unsure, it moves nothing and says why. Either two different statuses fit equally well:

```text
Jira issue OPS-17 could move to Released or Deployed for a Done status. Name the one to use in STATE_TO_JIRA_STATUS.
```

or none of the transitions is one it may pick on its own:

```text
Jira issue OPS-17 has no transition from In Review to a Done status that can be chosen without naming it in STATE_TO_JIRA_STATUS.
```

Either way, name the status in `STATE_TO_JIRA_STATUS` at the top of the `plan-transition-1` script, keyed by your OneUptime state names:

```javascript
const STATE_TO_JIRA_STATUS = {
  Resolved: "Resolved",
  Acknowledged: "In Progress",
};
```

A state listed there moves the issue to that status by name, whatever its category, as long as that is not backwards.

### Changing what a template does

Open the workflow's **Builder** and click the block you want to change. The settings you are most likely to want are constants near the top of a script — the **JavaScript Code** of a **Run Custom JavaScript** block, just below the shared helper block:

| Constant                          | Template, and block                                                                           | What it controls                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STATE_TO_JIRA_STATUS`            | Move the Jira issue when the incident is acknowledged or resolved — `plan-transition-1`       | Maps a OneUptime state name to a Jira status name, such as `{ Resolved: 'Resolved', Acknowledged: 'In Progress' }`. States not listed go by meaning: acknowledged moves the issue to an In Progress status, resolved to a Done one, and any other state is skipped. Name a status here when the run log asks you to — see [How the transition template picks a status](#how-the-transition-template-picks-a-status). |
| `PREFERRED_STATUS`, `NEVER_GUESS` | Move the Jira issue when the incident is acknowledged or resolved — `plan-transition-1`       | The status names the template prefers when it goes by meaning, and the ones it never picks unless `STATE_TO_JIRA_STATUS` names them. Both are regular expressions matched against the status name, ignoring case.                                                                                                                                                                                                    |
| `SYNC_PRIVATE_INCIDENTS`          | Every OneUptime → Jira template — `prepare-issue-1`, `plan-transition-1` or `build-comment-1` | `false` keeps incidents marked **Private Incident** out of Jira: no issue is filed for one, its issue is not moved, and neither its notes nor its edits are posted. Set it to `true` to send them anyway. Each template has its own copy, so set it in every template that should send them.                                                                                                                         |
| `JIRA_STATUS_TO_STATE`            | Acknowledge or resolve the incident when its Jira issue moves — `decide-state-1`              | Maps a Jira status name to a OneUptime state name, such as `{ 'In Review': 'Monitoring' }`. Statuses not listed go by Jira's status category: In Progress acknowledges the incident, Done resolves it, and To Do maps to nothing.                                                                                                                                                                                    |
| `PRIORITY_RANK`                   | Declare an incident when a Jira issue is created — `prepare-incident-1`                       | Maps a Jira priority, written in lowercase, to `0` (your most severe severity), `1` or `2` (your least severe), with the ones in between spread across the range. Priorities not listed land in the middle.                                                                                                                                                                                                          |
| `EVENTS`                          | Add Jira comments to the incident as private notes — `read-comment-1`                         | The comment events that become notes. Add `'comment_updated'` to also copy edits — each edit becomes a new note — and tick **Comment updated** on the Jira webhook as well.                                                                                                                                                                                                                                          |
| `IGNORED_FIELDS`                  | Add Jira issue changes to the incident as private notes — `read-changes-1`                    | The Jira fields, in lowercase, whose changes are not worth a note. A change is left out when either its field id or its name is listed, which is how `'rank'` catches Rank, a custom field that arrives as an id like `customfield_10019`. Status is on the list because the status template handles it.                                                                                                             |

State and status names used as keys must be spelled exactly as they are named, capitals included. Keep `{{` out of the code: a script is substituted like any other setting before it runs, so two opening braces in a row would be read as a reference.

To send more fields on new issues, edit the **Request Body** of the `create-issue-1` block in **Create a Jira issue when an incident is declared**. It holds the issue's project, issue type, summary, labels and description, and you can add a priority, components, an assignee or custom fields inside `fields`, in the shapes [Filling in more fields](#filling-in-more-fields) describes. Keep both labels. The wording of the summary and description is in the `prepare-issue-1` script.

Private notes and incident-edit comments are marked internal by the `properties` entry, `sd.public.comment`, in the **Request Body** of their `post-comment-1` block. Only Jira Service Management reads it. Delete it only if customers should see those comments.

### Limitations

- **Jira Cloud only.** The templates call the Jira Cloud REST API v3 with Basic auth. Data Center has no v3 and takes a personal access token as `Bearer`, so every API block needs the v2 adjustments in [Jira Data Center](#jira-data-center): `/rest/api/2/...` paths, plain strings instead of Atlassian Document Format bodies, and the header. The `find-issue-1` blocks change the most: Data Center has no `/search/jql`, so they must `POST` to `/rest/api/2/search` instead.
- **Incidents declared from Jira are quiet.** They are created hidden from your status pages and without notifying status page subscribers, because an issue's text was not written for customers. They stay that way until someone changes it: turn on **Visible on Status Page** on the incident's **Settings** page (see [Keeping an incident off the status page](/docs/incidents/states-and-severities#keeping-an-incident-off-the-status-page)), or change `isVisibleOnStatusPage` and `shouldStatusPageSubscribersBeNotifiedOnIncidentCreated` in the template's `create-incident-1` block.
- **Private incidents stay in OneUptime.** The OneUptime → Jira templates skip an incident marked **Private Incident**: no issue is filed for it, its issue is not moved, and neither its notes nor its edits are posted. Each skip says so in **Runs & Logs**. To send them anyway, set `SYNC_PRIVATE_INCIDENTS` to `true` in the template's script (see [Changing what a template does](#changing-what-a-template-does)). Making an incident private later stops the sync from then on, but does not take back what Jira already has. The Jira → OneUptime templates do not check, so comments, edits and status changes on a linked issue still reach a private incident.
- **Incidents never move backwards, and neither do issues.** Reopening a Jira issue changes nothing in OneUptime, and a status in the To Do category maps to no state at all. See [Order is a real constraint](/docs/incidents/states-and-severities#order-is-a-real-constraint-not-a-display-preference). The transition template likewise never moves an issue to an earlier status category, not even for a status named in `STATE_TO_JIRA_STATUS`.
- **A cloned issue claims the same incident.** A clone copies both link labels. The templates that post to or move the issue then stop with a skip naming both issues, and the clone's comments and changes reach the incident, until the labels are removed from the clone. See [How the two sides stay linked](#how-the-two-sides-stay-linked).
- **The first few seconds can miss the issue.** Jira's search is eventually consistent, so a note, state change or edit made in the first seconds after an incident is declared can fail to find the new issue and end in the `No Jira issue is labelled …` skip. That run is not retried. The same applies just after an incident is declared from Jira, until its labels are added.
- **Private and public mean different things in Jira.** In a Jira Service Management project, private notes and incident-edit comments (which carry the root cause and remediation) become internal comments, while public notes become comments the customer can see. In any other kind of project, all of them are ordinary comments that anyone who can see the issue can read.
- **Formatting does not cross over.** Notes are posted to Jira as plain text, so Markdown arrives as its raw characters. Jira's rich text arrives in OneUptime as the wiki markup Jira's webhooks send, such as `*bold*`.
- **A bad or expired token rarely says so.** On your site URL, Jira usually answers a call it cannot authenticate as it would an anonymous visitor, not with a `401`. So a wrong, mistyped or expired token shows up as one of these:

  - the create template's `The target project doesn't exist or you don't have permission to create issues in it`, a `400`
  - `Issue does not exist or you do not have permission to see it`, a `404`, from a step that reads an issue
  - the skip `No Jira issue is labelled oneuptime-incident-<id>, or the Jira credentials cannot see it.`, because a search Jira cannot authenticate finds nothing rather than failing

  A plain `401` is mostly what the `api.atlassian.com` address answers. To test the value you pasted, send it to `/rest/api/3/myself`, which needs a signed-in account: it answers with that account's name and email when the value works, and `401` when it does not.

  ```bash
  curl -H 'Authorization: Basic <the encoded value>' https://your-domain.atlassian.net/rest/api/3/myself
  ```

  If it does not work, create a new token, encode it again, and update `jiraBasicAuthToken` in every Jira workflow.

- **The same event can arrive twice.** Jira retries a delivery that failed with a server error or timed out. On the rare occasion that OneUptime had already started the run, the comment and issue-change templates add a second note. The declare template does not declare a second incident: before it declares anything, it asks Jira for the issue's labels, and by the time a retry arrives, the first run has labelled the issue. The same check stops a request that names an issue already linked. It cannot help when the first run declared the incident but Jira refused the labels — that run ends in a `⚠️` line saying so, and you should add the labels by hand.
- **Incidents only.** The templates do not cover alerts. [Doing the same for alerts](#doing-the-same-for-alerts) describes building the same thing by hand.

## Prerequisites

- A Jira Cloud site (`https://your-domain.atlassian.net`) and a project to file issues in. Note its **project key** — the `OPS` in `OPS-1234`.
- A Jira account that can create issues in that project, and an **API token** for it from [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens). Use a dedicated Jira user — an ordinary Atlassian account used only by the integration — rather than a person's own, because issues created this way are attributed to the token's owner. An Atlassian service account works too, with the scoped token and `api.atlassian.com` address described under [What the templates ask for](#what-the-templates-ask-for).
- Permission to create automation rules in that project, for the inbound half.
- A OneUptime project where you can create workflows and global variables.

## Step 1 — Store the Jira credentials as a secret

Jira Cloud's REST API takes **Basic auth** built from your Atlassian account email and an API token, base64-encoded together.

1. Encode `email:api_token` once:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

   Use `printf`, not `echo`. `echo` appends a newline, the newline is encoded along with everything else, and Jira stops accepting the credentials for reasons that are invisible in the string you pasted — usually without a `401` (see [Troubleshooting](#troubleshooting)). On Linux, also add `-w 0` to `base64`: GNU `base64` wraps its output every 76 characters, and a current Atlassian token is long enough to be wrapped.

2. In OneUptime, go to **Workflows → Global Variables → Create**. Name it `JIRA_AUTH`, paste the base64 string as **Content**, and turn on **Secret**.
3. Add a second, non-secret variable `JIRA_URL` holding `https://your-domain.atlassian.net` with no trailing slash.

Any block can now use `Basic {{global.variables.JIRA_AUTH}}` as its `Authorization` header, and the token never appears in the workflow or its run logs. See [Variables](/docs/workflows/variables).

Two things about Atlassian API tokens that will eventually bite an integration nobody is watching:

- **They expire.** Tokens are created with a lifetime of one day to one year, one year by default, and there is no refresh — an expired token has to be replaced by hand on the same page and re-encoded into `JIRA_AUTH`. Put the expiry date in a calendar somewhere. When a workflow that has worked for months starts reporting that a project or issue does not exist, or finding nothing — or answering `401` through `api.atlassian.com` — this is why.
- **A scoped token needs a different base URL.** The token page offers **Create API token with scopes** as well as the classic **Create API token**. Scoped tokens are the more secure choice, but they are not addressed at your site: they go to `https://api.atlassian.com/ex/jira/<cloudId>`, so `JIRA_URL` becomes that instead, and every path below hangs off it unchanged. Your `cloudId` is in the JSON at `https://your-domain.atlassian.net/_edge/tenant_info`. A scoped token sent to `your-domain.atlassian.net` simply fails.

If your organization is on Atlassian's centralized user management, there is a third option that sidesteps the expiry problem: an [OAuth 2.0 credential for a service account](https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts/). It gives you a client id and secret rather than a token, and a workflow exchanges them for a short-lived access token at the start of each run — the same two-block shape the [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) page uses, with an **API Post (JSON)** block fetching the token and everything after it sending `Bearer <token>`. Nothing has to be replaced by hand a year later. Atlassian's page has the exact token request; the API base URL is `https://api.atlassian.com`.

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

**Without one.** Put it in a label instead. Labels take no spaces, and a OneUptime id is a plain UUID, so `oneuptime-incident-<id>` is a valid label:

```json
"labels": ["oneuptime", "oneuptime-incident-{{local.components.incident-on-create-1.returnValues.model._id}}"]
```

These are the same two labels the [templates](#start-from-a-template) use, so a workflow you build by hand and the templates can find each other's issues. The inbound workflow then has to pick that label out of the list, which is a couple of lines in a **Run Custom JavaScript** block. The custom field is tidier if you can have one.

While you are here, it is worth adding a link on the Jira issue back to the incident. An **API Post (JSON)** block after `create-issue`, pointed at `{{global.variables.JIRA_URL}}/rest/api/3/issue/{{local.components.create-issue.returnValues.response-body.key}}/remotelink`, with:

```json
{
  "globalId": "system=https://oneuptime.com&id={{local.components.incident-on-create-1.returnValues.model._id}}",
  "object": {
    "url": "https://oneuptime.com/dashboard/{{local.components.incident-on-create-1.returnValues.model.projectId.value}}/incidents/{{local.components.incident-on-create-1.returnValues.model._id}}",
    "title": "OneUptime incident #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}"
  }
}
```

gives everyone in Jira a one-click route back. Add `projectId` to the trigger's **Select Fields** for this, and keep the `.value` after it: a column holding another record's id arrives as `{"_type": "ObjectID", "value": "..."}`, and without `.value` the URL gets that whole object as JSON. The incident's own `_id` is a plain string, so it needs nothing. The `globalId` is what makes the call safe to repeat: Jira updates the link that already carries that id instead of adding a second one. Because an update also nulls anything you leave out, always send the whole `object`, not a patch of it.

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
    "jql": "project = OPS AND labels = \"oneuptime-incident-{{local.components.incident-on-update-1.returnValues.model._id}}\"",
    "maxResults": 1
  }
  ```

  If you used a custom field rather than a label, the clause becomes `cf[10050] ~ \"...\"` with your own field id.

The issue id is then `{{local.components.find-issue.returnValues.response-body.issues[0].id}}`, and every endpoint below takes an id just as happily as a key.

Three things about this endpoint are worth knowing. **Post the JQL, do not put it in the URL** — a query string containing `=` inside a value is truncated on its way out of a workflow, and JQL is nothing but `=` signs. **The query must be bounded**: a bare `order by key desc` is rejected with `400`, which is why the `project =` clause is there. And `/rest/api/3/search/jql` is the current endpoint on Cloud — the older `/rest/api/3/search` has been removed there, so do not reach for it. Data Center is the other way round: it has no `/search/jql`, and searches with `POST /rest/api/2/search`.

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

| Cloud                                             | Data Center                                                                                                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/rest/api/3/...`                                 | `/rest/api/2/...` — there is no v3 on Data Center                                                                                                                 |
| `POST /rest/api/3/search/jql` to search with JQL  | `POST /rest/api/2/search` — there is no `/search/jql` on Data Center. The body keeps `jql`, `fields` and `maxResults`; send `expand` as a list, `["transitions"]` |
| `description` as an Atlassian Document Format doc | `description` as a plain string in wiki markup                                                                                                                    |
| `Authorization: Basic base64(email:api_token)`    | `Authorization: Bearer <personal access token>`                                                                                                                   |
| API token from id.atlassian.com                   | **Profile → Personal access tokens → Create token** on your own Jira account                                                                                      |
| Automation action **Send web request**            | Automation action **Send outgoing web request**                                                                                                                   |

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

## Doing the same for alerts

Everything above is written around incidents because that is the common case, but alerts work identically — swap the record type and nothing else changes:

| Incident                                 | Alert                                       |
| ---------------------------------------- | ------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`) | **On Create Alert** (`alert-on-create-1`)   |
| **On Update Incident** (`incident-on-update-1`) | **On Update Alert** (`alert-on-update-1`)   |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity` | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**              | **Find One Alert State**                    |
| **Update One Incident**                  | **Update One Alert**                        |

A workflow has exactly one trigger, so incidents and alerts need one workflow each. If the two would do the same work, build the Jira half once and call it from both with the **Execute Workflow** component.

## Troubleshooting

Open the failing block in **Runs & Logs** first. Jira returns a JSON body naming exactly what it rejected, and the API component keeps it in `response-body`.

**`401 Unauthorized`.** Re-encode `email:api_token` with `printf` and update `JIRA_AUTH`; a trailing newline from `echo` is the usual cause. Then confirm the account owning the token can create issues in that project. On Data Center, check you are sending `Bearer`, not `Basic`. On a Cloud site URL, bad credentials more often look like the next entry.

**Jira says a project or issue that exists does not, or a search finds nothing.** On a Cloud site URL this is usually the credentials, not the data: Jira answers a call it cannot authenticate much as it would an anonymous visitor. Send the encoded value to `/rest/api/3/myself` as [Limitations](#limitations) shows. If that answers `401`, re-encode it or replace the token. If it answers with the right account, that account is missing a permission in the project: **Browse Projects** to see its issues, **Create Issues** to file one.

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
