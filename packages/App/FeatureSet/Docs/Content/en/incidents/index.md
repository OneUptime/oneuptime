# Incidents Overview

An incident in OneUptime is the record your team rallies around when something breaks. It carries a number, a title, a severity, a current state, the resources it affects, and everything your team writes down while responding — notes, root cause, remediation steps, and an append-only feed of who did what.

Incidents are what turn a monitor going red into a coordinated response. Declaring one pages the right on-call rotation, adds owners who get notified about every change, starts runbooks, and — if you want it to — posts the outage to your public status page so customers stop opening tickets asking whether you already know.

You can declare an incident by hand at 3am, or let a monitor declare it for you the moment its criteria match. Either way the incident is the same object, with the same lifecycle, and the same paper trail at the end.

## At a glance

- **Top-level feature** — **Incidents** in the dashboard's left navigation, at `/dashboard/{projectId}/incidents`.
- **Three seeded states** — **Identified**, **Acknowledged** and **Resolved** are created for every new project. You can add your own; the three seeded ones can be renamed and recolored but never deleted.
- **Three seeded severities** — **Critical Incident**, **Major Incident** and **Minor Incident**. Severity is a label with a color and an order — it carries no behavior of its own.
- **Four ways in** — the **Declare Incident** wizard, **Create from Template**, a monitor criteria rule, or `POST /api/incident`.
- **Numbered per project** — every incident gets an incident number, rendered as `#42` by default or with your own prefix, like `INC-42`.
- **Two kinds of notes** — private notes (internal notes) for your team, public notes for status page subscribers.
- **Settings live under Incidents, not Project Settings** — states, severities, templates, custom fields and the rule engines are all at **Incidents → Settings** and **Incidents → Rules**.

## Key terms

A handful of words show up on every other page in this section. Get these straight first.

| Term                   | What it means                                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Incident**           | The record itself — title, description, severity, current state, affected resources, and everything written on it during the response.              |
| **Incident state**     | Where the incident is in its lifecycle. A project-scoped row with a name, color and `order`, plus the flags that give it meaning.                   |
| **Incident severity**  | How bad it is. A project-scoped row with a name, color and `order`. Purely a classification — nothing in the product treats one severity specially. |
| **Incident number**    | A per-project counter shown as `#42`, or with a prefix you configure, as `INC-42`.                                                                  |
| **Resources affected** | The monitors, hosts, Kubernetes clusters, Docker hosts, services and other infrastructure you attach to the incident.                               |
| **Public note**        | An update written for status page readers and subscribers. It renders on the status page timeline.                                                  |
| **Private note**       | An internal note (the `IncidentInternalNote` model) for the responding team. It never reaches a status page.                                        |
| **Owner**              | A user or team responsible for the incident. Owners get notified when it is created, when notes are posted, and when the state changes.             |
| **Incident feed**      | The append-only activity timeline on the incident's **Overview**, recording state changes, notes, owner changes, rule executions and notifications. |
| **State timeline**     | The record of which state the incident was in, when, and for how long — with the subscriber notification status for each transition.                |

## The three states OneUptime seeds for every project

When a project is created, OneUptime seeds exactly three incident states, in this order:

| State            | Order | Color              | What it means                                                             |
| ---------------- | ----- | ------------------ | ------------------------------------------------------------------------- |
| **Identified**   | 1     | Red (`#fd625e`)    | The state a brand-new incident lands in. This is the created state.       |
| **Acknowledged** | 2     | Yellow (`#ffbf53`) | Somebody has picked the incident up and is working on it.                 |
| **Resolved**     | 3     | Green (`#2ab57d`)  | The incident is over. Resolving it is what takes it off your status page. |

The names are just labels — what actually drives behavior are three booleans on the state row: `isCreatedState`, `isAcknowledgedState` and `isResolvedState`. Only one state per project is expected to hold each flag.

That distinction matters more than it sounds:

- `isCreatedState` decides where a new incident starts. If no state is explicitly selected on create, OneUptime looks for the project's created state and uses it.
- `isAcknowledgedState` and `isResolvedState` drive the **Acknowledge** and **Resolve** buttons in the incident header, the two stat tiles on the incident **Overview**, and the **Active Incidents** count badge in the side menu.
- **Active Incidents** is defined purely as "the current state is not the resolved state". Any custom state you add is therefore active unless it is the resolved one.

**Note the naming.** The first seeded state is named **Identified**, even though several descriptions inside the product still call it the created state. If you are looking for "Created" in your project's state list, it is the row named **Identified**.

You can add your own states at **Incidents → Settings → Incident State**. New states are appended to the end of the ordered list and you can drag to reorder. The three flagged states cannot be deleted — OneUptime blocks it — but you can rename and recolor them, which is why the UI reads state names dynamically.

Order is enforced, not cosmetic: an incident cannot move to a state that sits earlier in the order than its current one.

Full detail lives in [Incident States & Severities](/docs/incidents/states-and-severities).

## The three severities OneUptime seeds for every project

Every new project also gets three severities:

| Severity              | Order | Color              | What it means                                              |
| --------------------- | ----- | ------------------ | ---------------------------------------------------------- |
| **Critical Incident** | 1     | Maroon (`#b70400`) | Very high customer impact, needing an immediate response.  |
| **Major Incident**    | 2     | Red (`#fd625e`)    | Significant impact, usually needing an immediate response. |
| **Minor Incident**    | 3     | Yellow (`#ffbf53`) | Low impact, usually handled in working hours.              |

The full seeded descriptions are in [Incident States & Severities](/docs/incidents/states-and-severities).

Severities have `name`, `description`, `color` and `order` and nothing else. There are no flags, and no code path treats "Critical Incident" differently from any other row. Severity is how humans triage, and it is available as a match criterion when you write on-call rules — but choosing a severity does not, on its own, page anyone.

Edit or add severities at **Incidents → Settings → Incident Severity**.

## The life of an incident

### 1. It gets declared

Four routes lead to the same object:

- **By hand** — from the Incidents list, click **Declare Incident**. That opens the **Declare New Incident** wizard, five steps long: **Incident Details**, **Resources Affected**, **Incident Roles**, **On-Call**, **More**.
- **From a template** — click **Create from Template** and pick a saved **Incident Template**. Templates prefill title, description, severity, initial state, resources, on-call policies, owners and labels.
- **From a monitor** — a monitor criteria rule with the "declare an incident" toggle enabled creates the incident automatically the moment its filters match. Titles and descriptions there support `{{variable}}` templating.
- **Over the API** — `POST /api/incident` with an API key. The server fills in `declaredAt`, the created state, and the incident number for you.

See [Declaring an Incident](/docs/incidents/declaring-incidents) for the field-by-field walkthrough.

### 2. The right people find out

On creation OneUptime runs the automation you configured: label rules, on-call rules, owner rules and runbook rules. Any on-call duty policies attached to the incident — manually, from a template, or merged in by a matching on-call rule — are executed in parallel.

Owners are notified by email, SMS, call, push and WhatsApp, subject to each user's own notification preferences. If an incident has no owners at all, the notification falls back to the project owners rather than being dropped.

If the incident is visible on a status page and subscriber notifications are enabled, subscribers get told too. Notifications are cron-driven and run every minute, so expect up to about a minute of delay rather than an instant send.

### 3. Your team works it

Responders acknowledge the incident, attach affected resources, run runbooks, assign incident roles, and write things down as they learn them — private notes for the team, public notes for customers, plus the **Root Cause** and **Remediation** pages when the picture gets clearer. Everything they do lands in the **Incident Feed** on the **Overview** page.

### 4. It gets resolved

Clicking **Resolve** moves the incident to the resolved state, stamps the state timeline, stops the duration clock, and removes the incident from the active section of any status page it was showing on. Nothing else has to change for that to happen — the resolved state flag is what the status page query looks at.

After that you can write a postmortem and, optionally, publish it to the status page.

## Where incidents live in the dashboard

Open **Incidents** in the left navigation. Its side menu is organized into sections:

| Section       | What you do there                                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**  | **All Incidents** and **Active Incidents** — the latter carries a red badge with the count of incidents that are not in the resolved state.                                |
| **Episodes**  | Incident episodes, a separate grouping feature with its own pages.                                                                                                         |
| **AI**        | **Investigation** and **Remediation** — automatic investigation and auto-remediation settings.                                                                             |
| **Workspace** | **Slack** and **Microsoft Teams** connections for incidents.                                                                                                               |
| **Rules**     | The rule engines: **Grouping Rules**, **On-Call Rules**, **Owner Rules**, **Runbook Rules**, **Privacy Rules**, **Label Rules**, **SLA Rules**, **Reminder Rules**.        |
| **Settings**  | **Incident State**, **Incident Severity**, **Incident Templates**, **Note Templates**, **Postmortem Templates**, **Custom Fields**, **Incident Roles**, **More Settings**. |

**Rules** and **Settings** are collapsed by default — expand them to find the pages the rest of these docs refer to. Incident configuration is not under Project Settings; it all lives here.

The incidents list itself shows **Incident Number**, **Title**, **State**, **Severity**, **Resources Affected**, **Declared**, **Duration**, **Labels** and **Owners**, with a **Change State** bulk action for closing several at once.

## What each page on an incident shows

Open an incident and you get a left side menu, grouped like this:

- **Overview** — the **Incident Details** card (title, severity, labels, incident number, declared at, declared by, on-call policies), an **Affected Resources** card, and the **Incident Feed**. Above them, stat tiles for time to acknowledge, time to resolve, and total **Duration**.
- **State Timeline** — every state the incident has been in, with **Starts At**, **Ends At**, **Duration** and the subscriber notification status for each transition. **View Cause** and **View Logs** explain why each change happened.
- **SLA** — SLA tracking for this incident.
- **Description**, **Root Cause**, **Remediation** — three markdown pages. The description is the one that shows on your status page.
- **Runbooks** — runbook executions attached to this incident.
- **Postmortem** — the write-up, which you can optionally publish to the status page.
- **Roles**, **On-Call Executions**, **Owners** — who is on it, which policies fired, and who gets notified.
- **Notification Logs**, **AI Logs**, **Audit Logs** — what was sent and what changed.
- **Private Notes** and **Public Notes** — under the **Notes** section of the side menu.
- **Custom Fields**, **Settings**, **Delete Incident** — under **Advanced**. The **Settings** page holds **Visible on Status Page**, **Private Incident** and the **Reminders** card.

[Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed) covers the collaboration pages in depth.

## How incidents fit with the rest of OneUptime

- **Monitors spot the problem; incidents record it.** A monitor criteria rule can declare an incident automatically, pre-filling title, severity, on-call policies, owners, labels and remediation notes. See [Incident and Alert Templating](/docs/monitor/incident-alert-templating) for the variables available there.
- **On-call policies do the paging.** Attach policies on the **On-Call** step of the declare wizard, on a template, or through **Incidents → Rules → On-Call Rules**. Every matching rule fires — the executed set is the union of all matches plus anything attached directly, deduplicated.
- **Runbooks tell people what to do.** Runbook rules attach a procedure automatically when a matching incident is created, and responders can start one by hand from the incident. See [Runbooks Overview](/docs/runbooks/index).
- **Status pages tell customers.** An incident shows in a status page's active list when the page has incidents enabled, the incident is marked visible on the status page, and its current state is not the resolved state. Private incidents are hidden from every status page, always. See [Status Pages Overview](/docs/status-pages/index).
- **Workflows automate around it.** The **On Create Incident**, **On Update Incident** and **On Delete Incident** triggers let you build no-code automation on top of the incident lifecycle. See [Workflows Overview](/docs/workflows/index).

## Where to read next

- [Declaring an Incident](/docs/incidents/declaring-incidents) — the wizard, templates, monitor criteria and the API.
- [Incident States & Severities](/docs/incidents/states-and-severities) — the state flags, custom states and severity classification.
- [Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed) — public and private notes, owners, and the activity feed.
- [Incident Settings & Automation](/docs/incidents/settings) — templates, custom fields, number prefixes and the rule engines.
- [Status Pages Overview](/docs/status-pages/index) — how incidents reach your customers.
- [Subscribers & Announcements](/docs/status-pages/subscribers) — who gets notified when an incident moves.
