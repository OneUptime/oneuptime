# Declaring an Incident

Declaring an incident is the moment OneUptime starts keeping score. A record is created, a number is stamped on it, on-call policies fire, and — unless you tell it otherwise — your status page subscribers hear about it. Everything else in the incident lifecycle hangs off that first write.

There are five ways an incident gets into OneUptime, and they all end up in the same place: a row in the `Incident` table with a severity, a current state, and a list of affected resources. The difference is only who fills in the fields — you at 3am, a saved template, a monitor's criteria, your own code calling the API, or somebody outside your team filling in a form.

This page walks through all five — the first four field by field, forms in brief — and then covers what the server fills in for you and what fires the moment the incident exists.

## Five ways an incident gets declared

| If you want to…                                              | Pick                                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Open an incident by hand, filling in everything              | The **Declare Incident** wizard                                             |
| Open a recurring kind of incident with the fields pre-filled | **Create from Template**                                                    |
| Open one automatically when a monitor's checks fail          | A monitor criteria filter with **When filters match, declare an incident.** |
| Open one from your own code, a script, or another tool       | `POST /api/incident`                                                        |
| Let people outside your team report a problem through a link | A [form](/docs/forms/index)                                                 |

All five write the same model, so an incident opened by a probe looks exactly like one a responder opened by hand — apart from a few bookkeeping columns the server sets on automatic ones.

You can also declare an incident from alerts: **Declare Incident** on an alerts list, in an alert's header or on an alert's **Linked Incidents** page opens the same wizard, prefilled from the alerts, and links them to the new incident. A box on the form, ticked by default, also acknowledges the alerts, so they stop escalating. See [Linked Alerts](/docs/incidents/linked-alerts).

## Declaring one by hand

Open **Incidents → All Incidents** and click **Declare Incident** at the top right of the **Incidents** list. That takes you to a card titled **Declare New Incident**, which spreads the form over three steps: **Incident Details**, **Resources Affected** and **On-Call & Roles**, then a summary to review. When your project asks for some of its incident custom fields on create, a fourth step, **Details**, comes right after **Resources Affected**.

**From a resource's own page.** **Declare Incident** on the **Incidents** tab of a monitor, a host, a Kubernetes, Proxmox, Ceph or Docker Swarm cluster, a Docker or Podman host, a vCenter, an IoT fleet, a database or a service opens the same wizard with that resource already picked under **Resources Affected**, ahead of anything a template adds — so a title and a severity are all it takes, and the incident shows on the tab you started from. **Create from Template** on that tab keeps the resource too. The breadcrumbs go back through the resource's tab, and once declared you land on the new incident, as from the incidents list. An inventory item's **Incidents** tab picks the host, service or Kubernetes cluster the item points at, and the breadcrumbs go back through that resource's tab. **Create Alert** on a resource's **Alerts** tab works the same way: from a monitor it fills in the alert's **Monitor**, from anything else **Other Affected Resources**. The resource is looked up with your own permissions: if you cannot read it, or it has been deleted, the form simply opens with nothing picked.

Only the first step has required fields, plus any custom field your admins marked **Required on Create**, which the **Details** step asks for. Every step before the summary has a plain **Next**, and **Declare Incident** is on the summary, the last step. In a hurry, fill in **Incident Details** and press **Next** through the other steps without filling them in: attaching resources, adding on-call policies and assigning roles can also wait for the incident's own pages. Pressing **Enter** in a field walks on too; it never declares before the summary.

**More fields.** The options most incidents never need wait under a **More fields** header at the end of their step, folded; click it to open them. While it is folded, the header names what is inside and shows each option that is set, with its value — set by a template, say, or by a private alert you are declaring from — and it opens by itself when something in it needs fixing. The summary lists one of those options only when it is set.

### Step 1 — Incident Details

- **Title** — required. The one-line summary everyone will see in the list, in Slack, and (if the incident is visible) on your status page. Placeholder: `Incident Title`.
- **Incident Severity** — required. One of the severities configured for your project; new projects are seeded with **Critical Incident**, **Major Incident** and **Minor Incident**.
- **Description** — optional, written in Markdown. This is the field that renders on the status page, so write it for customers rather than for your team. You can edit it later from **Description** in the incident side menu.

Under **More fields**:

- **Declared At** — starts at the moment you opened the page. This is the timestamp every duration on the incident is measured from, so back-date it if you are recording something that started earlier.
- **Initial State** — optional, and empty to start with. Left empty, the incident starts in the state flagged `isCreatedState`, which new projects seed as **Identified** — or in the template's initial state, when you declare from a template. Pick a later state only when you are recording an incident that was already past that point, acknowledged or resolved.
- **Labels** — optional. Labels group related incidents so you can filter by them, and a team whose permissions are restricted to labels only sees the incidents that carry one of its labels.
- **Private Incident** — checkbox, off by default (`isPrivate`). A private incident is visible only to its owner users, the members of its owner teams, project admins and project owners — and it is hidden from every status page, regardless of any other setting, including the status pages it is limited to. The incidents list marks these with a red **Private** pill.

**Writing in the Markdown editor.** The description — like notes, root cause, remediation and rich text custom fields — is written in the Markdown editor. It opens in visual mode, which shows the text formatted; **Markdown** on its toolbar switches to Markdown mode, which shows the Markdown source, and **Visual** switches back. In a list, **Indent** and **Outdent** on its toolbar, or Tab and Shift+Tab, nest an item under the one above it and move it back out; where there is nothing to nest under, and outside a list, Tab moves on to the next field as usual. In visual mode, **Code Block**, **Table** and **Task List** in the middle or at the end of a line split the line at the cursor and put the new block on lines of its own — at the edge of a bold word, a link or inline code too, without leaving empty formatting behind — and **Task List** in a list item adds its task to that item's list rather than as a sub-task. In Markdown mode, **Code Block** and **Table** go in at the cursor, so start a new line for them first, **Task List** turns the cursor's line into a task, and **Numbered List** numbers each level of a nested list from 1. The toolbar stays on one line: forms with the editor open in a wide dialog, so on most screens every button fits, and where they do not — on a phone, or in a narrow window — the buttons that do not fit are under **More formatting** (**⋯**) at the end of the toolbar, in the same order, and each one you pick there goes in where the cursor was. On the narrowest screens the **Markdown** switch moves under it too.

**Undoing.** In visual mode, Ctrl+Z (Cmd+Z on a Mac) takes back your changes one at a time, newest first — what you typed and the editor's own edits alike: an indent or an outdent, a block it put into a line, a formatted or block paste — and Ctrl+Shift+Z (Cmd+Shift+Z) or Ctrl+Y puts them back in the same order. In Markdown mode, Ctrl+Z takes back an indent or an outdent, a list button's change and a formatted paste, but not what the **Code Block**, **Table** and **Horizontal Rule** buttons put in.

**Pasting into it.** Pasting from Word, Google Docs or a OneUptime page — another incident's description, say — keeps the lists and their nesting, the links and the formatting, and pasted `•` bullets become a real list. Links that are only an icon, such as the anchor next to a heading on GitHub, are left out. In visual mode, code or a quote pasted into a line becomes a block of its own, splitting the line, and a list pasted into a list item joins that item's list instead of nesting inside it — pasted into the empty item that Enter leaves, it takes that item's place — while a code block, a quote or a table pasted into an item stays inside it. In Markdown mode, what the paste turns into blocks — code, a quote, a list, a heading, several paragraphs — goes on lines of its own, with a blank line either side, when it lands in the middle of a line, and a list pasted at the end of a list item's line, or after a bare `- `, joins that list at the item's indentation; Markdown you copied as plain text goes in at the cursor exactly as it is. Whatever you paste inside a code block stays exactly as you copied it. Pasting over a selection that spans several items, paragraphs or table cells replaces it, as typing would. In visual mode, a paste or the **Code** button over table cells keeps every cell and column, a paste leaves nothing behind as an empty bullet, quote or code block, and when the selection ends inside a code block, only the rest of that code line joins the text.

**Copying out of a note.** A code block copied from a note or a description pastes back as a code block in its language, and so does a line of one copied with its line break, as a triple-click copies it in Chrome, Edge and Safari. A word or part of a line copied out of a code block pastes as inline code. In Chrome, Edge and Safari, lines copied from a code view drawn as a table — the YAML tab of a Kubernetes resource, the frames of an exception's stack trace — paste as their plain text, indentation kept.

**If the state gives you trouble.** If your project has no state carrying the `isCreatedState` flag, the create call fails and tells you to add a created incident state from settings. That normally only happens on a project whose states were edited heavily — see [Incident States & Severities](/docs/incidents/states-and-severities).

### Step 2 — Resources Affected

- **Resources Affected** — a single search box that attaches monitors, hosts, Kubernetes clusters, Docker and Podman hosts, Proxmox, Ceph and Docker Swarm clusters, vCenters, IoT fleets, databases and services: everything the incident's own **Resources Affected** edit offers. Under the hood these are separate relations on the incident (`monitors`, `hosts`, `kubernetesClusters`, `dockerHosts`, `podmanHosts`, `services` and more), but the form collapses them into one picker.
- **Limit to these status pages** — optional. Left empty, the incident shows on, and notifies the subscribers of, every status page that lists its monitors. Pick pages here and only the picked pages among those are used; the **Labels** tab adds every page with a label at once. The form warns you when a picked page lists none of the incident's monitors, and when the incident is private, which hides it from every status page. See [One Status Page per Audience](/docs/status-pages/one-status-page-per-audience).
- **Notify Status Page Subscribers** — checkbox, on by default. Controls whether subscribers are emailed about the incident being created (`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`). Under it, and again on the summary before you submit, **Will notify** lists the status pages that will be told, with an "up to" subscriber count per channel, and the pages that will not be told and why. When nobody will be told (no monitor is attached, no status page lists the monitors, or the pages have no subscribers yet) it shows nothing, and it warns only when the incident's status page scope is the reason. On the summary, **Preview notification** shows the email each of those status pages' subscribers will get, and **Send test to me** sends it to your own account email; see [Previewing the email before it is sent](/docs/status-pages/subscribers#previewing-the-email-before-it-is-sent). Turn it off for internal noise you still want recorded. The incident then stays quiet by default: new public notes on it, and the state-change modal on its overview page (**Acknowledge**, **Resolve**, or picking another state), start with their own **Notify Status Page Subscribers** checkbox off. The manual form on the **State Timeline** page and the bulk **Change State** action in the incidents list still start with it on.

Under **More fields**:

- **Change Monitor Status to** — optional. Picks a monitor status that is applied to every monitor attached to this incident, so declaring the incident and marking the monitors degraded is one action rather than two. A monitor's status is shared by every status page that lists it, so with status pages picked above, the form reminds you that the change also shows on the pages you did not pick.

**Attach monitors even when it feels redundant.** The link between an incident and a status page runs through the incident's monitors: a status page shows an incident, and notifies its subscribers about it, when one of its resources is one of the incident's monitors. **Limit to these status pages** can only narrow that list, never add to it, and a status page with **Only Show Incidents Scoped to This Page** on shows only the incidents limited to it. An incident with no monitors attached notifies no status page subscriber at all. See [Status Page Resources & Groups](/docs/status-pages/resources-and-groups).

The **Should be visible on status page?** flag (`isVisibleOnStatusPage`) is not on the wizard; it defaults to true. Change it afterwards from **Settings** in the incident side menu, where it is labeled **Visible on Status Page**.

**Declaring hidden and publishing later.** An incident that is hidden from status pages when it is created tells no subscriber, and its notification status reads **Skipped: hidden from status pages**. When you later turn **Visible on Status Page** on, the edit form offers **Notify subscribers that this incident was created**, so the routine of declaring hidden, working out who is affected and then publishing still tells them. It starts ticked while the incident is unresolved and unticked once it is resolved, so publishing an old incident for the record does not announce it as new. It is only offered when the incident was declared with **Notify Status Page Subscribers** on and is not private — so not for an incident reported through a [form](/docs/forms/on-submit), which is declared hidden with it off. Through the API, send `"miscDataProps": {"notifySubscribersOfIncidentCreatedOnPublish": true}` with the update that sets `isVisibleOnStatusPage` to `true`, or set `subscriberNotificationStatusOnIncidentCreated` back to `Pending` yourself.

### Details — your incident custom fields

This step appears only when at least one incident custom field has **Show on Create** turned on at **Incidents → Settings → Custom Fields** — or, when you declare from a template, when the template's **Custom Fields on Create** asks for one. It asks for those fields, in their **Order** — the order they are dragged into on that settings page — with the input their type calls for — a dropdown, a number, a date, a yes/no switch, long text, or rich text in the Markdown editor. It is also left out for someone who cannot read the project's incident custom fields: on OneUptime Cloud they need the **Growth** plan or above, and a role that can view incident custom fields.

- A field marked **Required on Create** must be filled in before you can declare. A required yes/no field — an acknowledgement, say — must be switched on.
- A 0 or a switch left off is an answer, and is saved as one.
- A field whose value is copied from a monitor custom field is not asked once the incident has a monitor, because the value is copied from the monitor when the incident is created.
- Declaring from a template starts the step with the template's values, and the template's values for fields the step does not ask about are kept as they are. A value you clear on the step stays cleared. A template value that no longer fits its field — a dropdown option removed since — is left out rather than refusing the incident.
- Declaring from a template also follows the template's **Custom Fields on Create**. A field it marks **Required** or **Optional** is asked even when the project does not show it on create, a field it marks **Hidden** is not asked — the template's value for it still applies — and a field left on **Default** follows its own **Show on Create** and **Required on Create**. See [Custom fields on create](/docs/incidents/settings#custom-fields-on-create).

**Required on Create** is checked by the dashboard only, and so is a template's **Custom Fields on Create**. Incidents created by monitors, the API, Slack, Microsoft Teams or AI can leave a field empty, and every field stays optional on the incident's **Custom Fields** page afterwards, so fixing one value mid-outage never demands all the others. See [Custom fields](/docs/incidents/settings#custom-fields) for the field types and settings.

### Step 3 — On-Call & Roles

- **On-Call Policy** — a multi-select of the on-call duty policies to execute when this incident is created. This maps to `onCallDutyPolicies` on the incident.
- **Assign Incident Roles** — who takes each role your project defines, one card per role. A role tagged **Primary** that you leave empty is yours: you take it when the incident is declared, and the summary says so. A role that takes one person says so once it has one; a role that takes several keeps its picker.

This is the only place an on-call policy is attached to an incident directly. Severities do not carry an on-call policy — severity is a label, and it only influences paging as a *match criterion* inside an on-call rule. Rules configured at **Incidents → Rules → On-Call Rules** add their policies on top of whatever you pick here; the final set that runs is the deduplicated union of both.

Roles themselves are configured at **Incidents → Settings → Incident Roles**. A new project has one, Incident Commander; add Responder, Communications Lead or whatever else your process needs there. If you pick nobody for Incident Commander, you become it when the incident is declared.

## Declaring from a template

If you keep declaring the same shape of incident — the same title pattern, the same severity, the same on-call policy — save it once as a template.

Click **Create from Template** (the outline button next to **Declare Incident**) and a **Create Incident from Template** modal opens, with a **Select Incident Template** dropdown. Pick a template and the create form opens pre-filled; you can still change anything before submitting. If your project has no templates yet, you get a **No Incident Templates** modal instead, with a **Create Template** button that takes you to **Incidents → Settings → Incident Templates**.

Templates are built with their own four-step wizard — **Template Info**, **Incident Details**, **Resources Affected**, **On-Call** — plus **Custom Fields** and **Custom Fields on Create** steps after **Resources Affected** when your project has incident custom fields. The template's **Owners** and **Labels** are under **More fields** at the end of **Incident Details**. These are the fields:

| Field                           | Purpose                                                |
| ------------------------------- | ------------------------------------------------------ |
| **Template Name**               | How the template is identified in the picker.          |
| **Template Description**        | A note to your future self about when to reach for it. |
| **Title**                       | The title pre-filled onto the incident.                |
| **Description**                 | Markdown description pre-filled onto the incident.     |
| **Incident Severity**           | Severity pre-filled onto the incident.                 |
| **Initial Incident State**      | The state incidents from this template start in.       |
| **Resources Affected**          | Monitors, hosts, clusters and services to attach.      |
| **Limit to these status pages** | Status pages the incident is limited to.               |
| **Change Monitor Status to**    | Monitor status to apply to the attached monitors.      |
| **On-Call Policy**              | Policies to execute when the incident is created.      |
| **Owners**                      | People and teams that own incidents created from this template, picked from one list. |
| **Labels**                      | Labels applied to the incident.                        |
| **Custom Fields**               | Values for the incident's custom fields.               |
| **Custom Fields on Create**     | Which custom fields the **Details** step asks for, and which must be filled in. |

A few quick rules:

- Templates are not editable from the templates list — you create one, then open it to change it.
- A template only fills a field you left empty. On the create page the template is applied as a pre-fill you can overwrite; on the server — for a workflow or a form that declares from a template — a field is filled from the template only when the request left that field `undefined`. Whatever the caller supplied always wins.
- The **Details** step follows the template's **Custom Fields on Create**, as [described above](#details-your-incident-custom-fields).
- Custom field values merge one field at a time. A template's values fill in the custom fields the incident is declared without; a value set on the **Details** step, or sent in the request's `customFields`, always wins — `0`, `false` and `null` included. A field copied from a monitor custom field still takes the monitor's value.
- An existing template's custom field values are on its **Custom Fields** card, next to its other cards.
- The template's **Owners** are added once the incident's Slack and Microsoft Teams channels exist, so a notification rule that invites incident owners to a new channel invites them too. Declaring from a template in the dashboard adds them without the "you were added" notification; a [form](/docs/forms/on-submit) with a template notifies them, and holds the incident's **Incident created** notification until they are added, so it goes to them rather than to the project's owners.

## Declaring automatically from monitor criteria

Most incidents should not need a human to type them in. In a monitor's criteria editor, turn on the toggle **When filters match, declare an incident.** and a **Create Incident** section appears with an **Add Incident** button — one criteria filter can declare more than one incident.

Each entry has:

- **Incident Title** — supports templating; the placeholder suggests something like `{{monitorName}} is down`.
- **Severity** — required.
- **Incident Description** — also templated.
- **On-Call → On-Call Policies** — policies executed when this incident is created.
- **Incident Roles** — pre-assign team members to roles.
- **Ownership & Labels → Owners** (people and teams, picked from one list), **Labels**.
- **More fields → Auto Resolve Incident** (resolves the incident automatically when the criteria stop matching), **Show Incident on Status Page**, **Private Incident** and **Remediation Notes**.

For the full list of `{{variable}}` placeholders you can use in the title, description and remediation notes, see [Incident & Alert Templating](/docs/monitor/incident-alert-templating).

Incidents created this way are tagged by the server: `isCreatedAutomatically` is set, `createdCriteriaId` records which criteria filter fired, and `createdByProbe` records which probe saw it. Everything else about them behaves exactly like a hand-declared incident.

## Declaring through the API

The incident model exposes a standard CRUD endpoint, so `POST /api/incident` creates one. Authenticate with an API key generated at **Project Settings → API Keys**, sent in the `apikey` header — the key identifies the project, so you do not need to pass a project id separately.

```bash
curl -X POST https://oneuptime.com/api/incident \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "title": "Checkout latency above SLO",
      "description": "Investigating elevated p99 latency on the checkout service.",
      "incidentSeverityId": "<incident-severity-id>"
    }
  }'
```

Useful fields on the request body:

- `title` — the only field you really have to supply.
- `declaredAt` — optional here even though the form requires it. Omit it and the server uses the current time.
- `incidentSeverityId` and `currentIncidentStateId` — the server checks that both belong to the same project as the API key, and rejects the request if they do not. The same check applies to the monitor status behind **Change Monitor Status to**.
- `statusPages` — the ids of the status pages to limit the incident to, all from the same project. Leave it out to reach every status page that lists the incident's monitors. `isScopedToStatusPages` is worked out from it, and a value you send for that is ignored. See [One Status Page per Audience](/docs/status-pages/one-status-page-per-audience).
- `customFields` — the incident's custom field values, keyed by each field's name. Each value you send must fit its field — a number for a **Number** field, one of the options for a **Dropdown (single select)** — or the request is refused with a `400` error naming the field. **Required on Create** is not checked here. See [Custom field values through the API](/docs/incidents/settings#custom-field-values-through-the-api).

An API key cannot declare from a template: a request that sends `createdIncidentTemplateId` is refused. OneUptime sets that column itself, for a workflow's **Create One Incident** step and for incidents reported through a [form](/docs/forms/on-submit). To declare from a template over the API, read the template from `/api/incident-templates` and send its values in the request.

Related endpoints are `/api/incident-state`, `/api/incident-severity` and `/api/incident-state-timeline`. The generated [API reference](/reference) has the exact request and response shapes for each, including how relation fields such as monitors are expressed.

## Reporting through a form

The fifth way in is for people outside your team. A form is a page you share as a link: anyone who has it can report a problem without a OneUptime account, and each submission declares an incident. You build what the form asks — a title, a description, a severity, monitors, custom fields, questions of your own — and decide how the answers become the incident: a default severity, an incident template to declare from, and monitors, labels, on-call policies and owners to always add.

Incidents reported this way are declared hidden from status pages, with **Notify Status Page Subscribers** off, so a responder triages them before anything is public, and a private note records who reported them. Forms are a product of their own, under **Forms** in the products menu, and can schedule maintenance events too; see [Forms](/docs/forms/index).

## Incident numbers and prefixes

Every incident gets a sequential number from a per-project counter, assigned by the server at creation time. Two columns hold it: `incidentNumber` (the raw integer) and `incidentNumberWithPrefix` (what you actually see). With no prefix configured, the display value is `#42`.

To change that, go to **Incidents → Settings → Number Prefix** and click **Update**. The **Incident Number Prefix** field previews the number as you type: `INC-` makes it `INC-42`. Leave it empty to keep the default `#`. A new prefix applies to incidents declared after you save; existing incidents keep their numbers. The same dialog has **Incident Episode Number Prefix** for episode numbering. [Number prefixes](/docs/incidents/settings#number-prefixes) lists the rules a prefix follows.

The number appears as the first column of the incidents list, links to the incident, and shows up as **Incident Number** on the incident's **Overview**.

## What happens the moment an incident is declared

The create call does more than write a row. In order:

1. **The server fills the gaps.** `declaredAt` defaults to now, the current state defaults to the project's `isCreatedState` state, and the incident number and prefixed number are assigned from the project counter.
2. **A template is applied**, when a workflow or a form declares the incident from one (`createdIncidentTemplateId`) without naming a state — filling only fields the caller left undefined. The dashboard applies a template in the form instead, before the request is sent.
3. **Privacy rules run**, marking the incident private when a matching rule says so. This is the first rule engine to run, so everything after it sees the right privacy setting.
4. **Owner rules run**, adding the owner users and teams that matching rules name.
5. **Label rules run**, adding labels that match the incident.
6. **On-call rules run.** Every enabled rule at **Incidents → Rules → On-Call Rules** whose criteria match adds its policies to the incident. There is no priority order and no short-circuit — all matching rules fire and the policies are deduplicated.
7. **Runbook rules run**, attaching and starting matching runbooks. See [Runbooks](/docs/runbooks/index).
8. **On-call policies execute.** Every policy on the incident — picked in the wizard, inherited from a template, or added by a rule — is executed in parallel with the event type `IncidentCreated`. One policy failing does not stop the others. An archived policy pages no one: its execution log on the incident says it was not executed because the policy is archived.
9. **Subscribers are queued**, if **Notify Status Page Subscribers** was left on and the incident is visible on the status page. Delivery is handled by a background job, not inline with your request, and goes to the status pages the incident reaches: the ones that list its monitors, narrowed by **Limit to these status pages**, and without the pages that only show incidents limited to them when it is not limited. An archived status page sends nothing. Its progress shows as **Subscriber Notification Status** on the incident's **Overview**: what was sent and what failed on each status page, and **Retry** or **Resend** once it has settled. See [Checking what was sent](/docs/status-pages/subscribers#checking-what-was-sent).
10. **Workflows fire.** The **On Create Incident** trigger starts any workflow built on it. See [Workflows Overview](/docs/workflows/index).

From there the incident is live: it counts toward the **Active Incidents** badge in the Incidents side menu (any state not flagged `isResolvedState` counts as active), it appears on the status pages that carry one of its monitors (only the picked ones, if you limited it), and its **State Timeline** starts recording.

## Where to read next

- [Incidents Overview](/docs/incidents/index) — how the incident model fits together.
- [Incident States & Severities](/docs/incidents/states-and-severities) — what the state flags do and how to add your own.
- [Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed) — public notes, private notes, owners and the activity feed.
- [Incident Settings & Automation](/docs/incidents/settings) — templates, custom fields, roles, rules and workflow triggers.
- [Forms](/docs/forms/index) — letting people outside your team report an incident through a link.
- [Subscribers & Announcements](/docs/status-pages/subscribers) — who hears about the incident you just declared.
- [One Status Page per Audience](/docs/status-pages/one-status-page-per-audience) — limiting an incident to some of the status pages that list its monitors.
- [Incident & Alert Templating](/docs/monitor/incident-alert-templating) — the variables available to auto-declared incidents.
