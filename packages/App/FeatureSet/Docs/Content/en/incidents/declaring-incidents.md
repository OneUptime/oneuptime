# Declaring an Incident

Declaring an incident is the moment OneUptime starts keeping score. A record is created, a number is stamped on it, on-call policies fire, and — unless you tell it otherwise — your status page subscribers hear about it. Everything else in the incident lifecycle hangs off that first write.

There are four ways an incident gets into OneUptime, and they all end up in the same place: a row in the `Incident` table with a severity, a current state, and a list of affected resources. The difference is only who fills in the fields — you at 3am, a saved template, a monitor's criteria, or your own code calling the API.

This page walks through all four, field by field, and then covers what the server fills in for you and what fires the moment the incident exists.

## Four ways an incident gets declared

| If you want to…                                              | Pick                                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Open an incident by hand, filling in everything              | The **Declare Incident** wizard                                             |
| Open a recurring kind of incident with the fields pre-filled | **Create from Template**                                                    |
| Open one automatically when a monitor's checks fail          | A monitor criteria filter with **When filters match, declare an incident.** |
| Open one from your own code, a script, or another tool       | `POST /api/incident`                                                        |

All four write the same model, so an incident opened by a probe looks exactly like one a responder opened by hand — apart from a few bookkeeping columns the server sets on automatic ones.

You can also declare an incident from alerts: **Declare Incident** on an alerts list, in an alert's header or on an alert's **Linked Incidents** page opens the same wizard, prefilled from the alerts, and links them to the new incident. A box on the form, ticked by default, also acknowledges the alerts, so they stop escalating. See [Linked Alerts](/docs/incidents/linked-alerts).

## Declaring one by hand

Open **Incidents → All Incidents** and click **Declare Incident** at the top right of the **Incidents** list. That takes you to a card titled **Declare New Incident**, which spreads the form over five steps: **Incident Details**, **Resources Affected**, **Incident Roles**, **On-Call** and **More**. When your project asks for some of its incident custom fields on create, a sixth step, **Details**, comes right after **Resources Affected**. The submit button at the end also reads **Declare Incident**.

Only the first step has required fields, plus any custom field your admins marked **Required on Create**. If you are in a hurry, fill in **Incident Details** and submit — you can attach resources, assign roles and add on-call policies from the incident's own pages afterwards.

### Step 1 — Incident Details

- **Title** — required. The one-line summary everyone will see in the list, in Slack, and (if the incident is visible) on your status page. Placeholder: `Incident Title`.
- **Description** — optional, written in Markdown. This is the field that renders on the status page, so write it for customers rather than for your team. You can edit it later from **Description** in the incident side menu.
- **Declared At** — required in the form, defaulted to now. This is the timestamp every duration on the incident is measured from, so back-date it if you are recording something that started earlier.
- **Incident Severity** — required. One of the severities configured for your project; new projects are seeded with **Critical Incident**, **Major Incident** and **Minor Incident**.
- **Incident State** — optional. Leave it alone and the incident lands in the state flagged `isCreatedState`, which new projects seed as **Identified**. Set it only when you are recording an incident that was already past that point.

**If the state dropdown gives you trouble.** If your project has no state carrying the `isCreatedState` flag, the create call fails and tells you to add a created incident state from settings. That normally only happens on a project whose states were edited heavily — see [Incident States & Severities](/docs/incidents/states-and-severities).

### Step 2 — Resources Affected

- **Resources Affected** — a single search box that attaches monitors, hosts, Kubernetes clusters, Docker hosts, Podman hosts and services. Under the hood these are separate relations on the incident (`monitors`, `hosts`, `kubernetesClusters`, `dockerHosts`, `podmanHosts`, `services` and more), but the form collapses them into one picker.
- **Limit to these status pages** — optional. Left empty, the incident shows on, and notifies the subscribers of, every status page that lists its monitors. Pick pages here and only the picked pages among those are used; the **Labels** tab adds every page with a label at once. The form warns you when a picked page lists none of the incident's monitors. See [One Status Page per Audience](/docs/status-pages/one-status-page-per-audience).
- **Change Monitor Status to** — optional. Picks a monitor status that is applied to every monitor attached to this incident, so declaring the incident and marking the monitors degraded is one action rather than two. A monitor's status is shared by every status page that lists it, so with status pages picked above, the form reminds you that the change also shows on the pages you did not pick.

**Attach monitors even when it feels redundant.** The link between an incident and a status page runs through the incident's monitors: a status page shows an incident, and notifies its subscribers about it, when one of its resources is one of the incident's monitors. **Limit to these status pages** can only narrow that list, never add to it, and a status page with **Only Show Incidents Scoped to This Page** on shows only the incidents limited to it. An incident with no monitors attached notifies no status page subscriber at all. See [Status Page Resources & Groups](/docs/status-pages/resources-and-groups).

### Details — your incident custom fields

This step appears only when at least one incident custom field has **Show on Create** turned on at **Incidents → Settings → Custom Fields**. It asks for those fields, in their **Order** (fields without one come last), with the input their type calls for — a dropdown, a number, a date, a yes/no switch, long text, or rich text in the Markdown editor. It is also left out for someone who cannot read the project's incident custom fields: on OneUptime Cloud they need the **Growth** plan or above, and a role that can view incident custom fields.

- A field marked **Required on Create** must be filled in before you can declare. A required yes/no field — an acknowledgement, say — must be switched on.
- A 0 or a switch left off is an answer, and is saved as one.
- A field whose value is copied from a monitor custom field is not asked once the incident has a monitor, because the value is copied from the monitor when the incident is created.
- Declaring from a template starts the step with the template's values, and the template's values for fields the step does not ask about are kept as they are. A value you clear on the step stays cleared. A template value that no longer fits its field — a dropdown option removed since — is left out rather than refusing the incident.

**Required on Create** is checked by the dashboard only. Incidents created by monitors, the API, Slack, Microsoft Teams or AI can leave a field empty, and every field stays optional on the incident's **Custom Fields** page afterwards, so fixing one value mid-outage never demands all the others. See [Custom fields](/docs/incidents/settings#custom-fields) for the field types and settings.

### Step 3 — Incident Roles

- **Assign Incident Roles** — assign team members to the roles your project defines. Some roles accept more than one user.

Roles themselves are configured at **Incidents → Settings → Incident Roles**, where you define the roles that can be assigned during response — Incident Commander, Responder, and whatever else your process needs. If you skip this step, an Incident Commander is auto-assigned on the first state change if nobody holds the role yet.

### Step 4 — On-Call

- **On-Call Policy** — a multi-select of the on-call duty policies to execute when this incident is created. This maps to `onCallDutyPolicies` on the incident.

This is the only place an on-call policy is attached to an incident directly. Severities do not carry an on-call policy — severity is a label, and it only influences paging as a *match criterion* inside an on-call rule. Rules configured at **Incidents → Rules → On-Call Rules** add their policies on top of whatever you pick here; the final set that runs is the deduplicated union of both.

### Step 5 — More

- **Labels** — optional and an advanced feature: team members with access to these labels are the ones who can access the incident.
- **Notify Status Page Subscribers** — checkbox, on by default. Controls whether subscribers are emailed about the incident being created (`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`). Under it, and again on the summary before you submit, **Will notify** lists the status pages that will be told, with an "up to" subscriber count per channel, and the pages that will not be told and why. Turn it off for internal noise you still want recorded. The incident then stays quiet by default: new public notes on it, and the state-change modal on its overview page (**Acknowledge**, **Resolve**, or picking another state), start with their own **Notify Status Page Subscribers** checkbox off. The manual form on the **State Timeline** page and the bulk **Change State** action in the incidents list still start with it on.
- **Private Incident** — checkbox, off by default (`isPrivate`). A private incident is visible only to its owner users, the members of its owner teams, project admins and project owners — and it is hidden from every status page, regardless of any other setting, including the status pages it is limited to. The incidents list marks these with a red **Private** pill.

The **Should be visible on status page?** flag (`isVisibleOnStatusPage`) is not on the wizard; it defaults to true. Change it afterwards from **Settings** in the incident side menu, where it is labeled **Visible on Status Page**.

**Declaring hidden and publishing later.** An incident that is hidden from status pages when it is created tells no subscriber, and its notification status reads **Skipped: hidden from status pages**. When you later turn **Visible on Status Page** on, the edit form offers **Notify subscribers that this incident was created**, so the routine of declaring hidden, working out who is affected and then publishing still tells them. It starts ticked while the incident is unresolved and unticked once it is resolved, so publishing an old incident for the record does not announce it as new. It is only offered when the incident was declared with **Notify Status Page Subscribers** on and is not private. Through the API, send `"miscDataProps": {"notifySubscribersOfIncidentCreatedOnPublish": true}` with the update that sets `isVisibleOnStatusPage` to `true`, or set `subscriberNotificationStatusOnIncidentCreated` back to `Pending` yourself.

## Declaring from a template

If you keep declaring the same shape of incident — the same title pattern, the same severity, the same on-call policy — save it once as a template.

Click **Create from Template** (the outline button next to **Declare Incident**) and a **Create Incident from Template** modal opens, with a **Select Incident Template** dropdown. Pick a template and the create form opens pre-filled; you can still change anything before submitting. If your project has no templates yet, you get a **No Incident Templates** modal instead, with a **Create Template** button that takes you to **Incidents → Settings → Incident Templates**.

Templates are built with their own six-step wizard — **Template Info**, **Incident Details**, **Resources Affected**, **On-Call**, **Owners**, **Labels** — plus a **Custom Fields** step after **Resources Affected** when your project has incident custom fields. These are the fields:

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
| **Owner - Teams**               | Teams that own incidents created from this template.   |
| **Owner - Users**               | Users that own incidents created from this template.   |
| **Labels**                      | Labels applied to the incident.                        |
| **Custom Fields**               | Values for the incident's custom fields.               |

A few quick rules:

- Templates are not editable from the templates list — you create one, then open it to change it.
- A template only fills a field you left empty. On the create page the template is applied as a pre-fill you can overwrite; on the API, the server fills a field from the template only when the request left that field `undefined`. Whatever the caller supplied always wins.
- Custom field values merge one field at a time. A template's values fill in the custom fields the incident is declared without; a value set on the **Details** step, or sent in the request's `customFields`, always wins — `0`, `false` and `null` included. A field copied from a monitor custom field still takes the monitor's value.
- An existing template's custom field values are on its **Custom Fields** card, next to its other cards.

## Declaring automatically from monitor criteria

Most incidents should not need a human to type them in. In a monitor's criteria editor, turn on the toggle **When filters match, declare an incident.** and a **Create Incident** section appears with an **Add Incident** button — one criteria filter can declare more than one incident.

Each entry has:

- **Incident Title** — supports templating; the placeholder suggests something like `{{monitorName}} is down`.
- **Severity** — required.
- **Incident Description** — also templated.
- **On-Call → On-Call Policies** — policies executed when this incident is created.
- **Incident Roles** — pre-assign team members to roles.
- **Ownership & Labels → Owner Teams**, **Owner Users**, **Labels**.
- **Advanced Options → Auto Resolve Incident** (resolves the incident automatically when the criteria stop matching), **Show Incident on Status Page**, **Private Incident** and **Remediation Notes**.

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
- `createdIncidentTemplateId` — apply a saved template. Any field you leave out is filled from the template; any field you send is kept as-is. Custom field values merge one field at a time.

Related endpoints are `/api/incident-state`, `/api/incident-severity` and `/api/incident-state-timeline`. The generated [API reference](/reference) has the exact request and response shapes for each, including how relation fields such as monitors are expressed.

## Incident numbers and prefixes

Every incident gets a sequential number from a per-project counter, assigned by the server at creation time. Two columns hold it: `incidentNumber` (the raw integer) and `incidentNumberWithPrefix` (what you actually see). With no prefix configured, the display value is `#42`.

To change that, go to **Incidents → Settings → More Settings**. The **Number Prefix** card has an **Incident Number Prefix** field (up to 20 characters, placeholder `INC-`) — set it and the same incident renders as `INC-42`. Leave it empty to keep the default `#`. The card also carries **Incident Episode Number Prefix** for episode numbering.

The number appears as the first column of the incidents list, links to the incident, and shows up as **Incident Number** on the incident's **Overview**.

## What happens the moment an incident is declared

The create call does more than write a row. In order:

1. **The server fills the gaps.** `declaredAt` defaults to now, the current state defaults to the project's `isCreatedState` state, and the incident number and prefixed number are assigned from the project counter.
2. **A template is applied**, if `createdIncidentTemplateId` was supplied — filling only fields the caller left undefined.
3. **Privacy rules run**, marking the incident private when a matching rule says so. This is the first rule engine to run, so everything after it sees the right privacy setting.
4. **Owner rules run**, adding the owner users and teams that matching rules name.
5. **Label rules run**, adding labels that match the incident.
6. **On-call rules run.** Every enabled rule at **Incidents → Rules → On-Call Rules** whose criteria match adds its policies to the incident. There is no priority order and no short-circuit — all matching rules fire and the policies are deduplicated.
7. **Runbook rules run**, attaching and starting matching runbooks. See [Runbooks](/docs/runbooks/index).
8. **On-call policies execute.** Every policy on the incident — picked in the wizard, inherited from a template, or added by a rule — is executed in parallel with the event type `IncidentCreated`. One policy failing does not stop the others.
9. **Subscribers are queued**, if **Notify Status Page Subscribers** was left on and the incident is visible on the status page. Delivery is handled by a background job, not inline with your request, and goes to the status pages the incident reaches: the ones that list its monitors, narrowed by **Limit to these status pages**, and without the pages that only show incidents limited to them when it is not limited.
10. **Workflows fire.** The **On Create Incident** trigger starts any workflow built on it. See [Workflows Overview](/docs/workflows/index).

From there the incident is live: it counts toward the **Active Incidents** badge in the Incidents side menu (any state not flagged `isResolvedState` counts as active), it appears on the status pages that carry one of its monitors (only the picked ones, if you limited it), and its **State Timeline** starts recording.

## Where to read next

- [Incidents Overview](/docs/incidents/index) — how the incident model fits together.
- [Incident States & Severities](/docs/incidents/states-and-severities) — what the state flags do and how to add your own.
- [Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed) — public notes, private notes, owners and the activity feed.
- [Incident Settings & Automation](/docs/incidents/settings) — templates, custom fields, roles, rules and workflow triggers.
- [Subscribers & Announcements](/docs/status-pages/subscribers) — who hears about the incident you just declared.
- [One Status Page per Audience](/docs/status-pages/one-status-page-per-audience) — limiting an incident to some of the status pages that list its monitors.
- [Incident & Alert Templating](/docs/monitor/incident-alert-templating) — the variables available to auto-declared incidents.
