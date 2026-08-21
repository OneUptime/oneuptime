# Settings & Automation

Incident configuration does not live in Project Settings. It lives inside the Incidents product area itself, under **Incidents → Settings** and **Incidents → Rules**, at routes beginning `/dashboard/{projectId}/incidents/settings/`. If you have been hunting through **Project Settings** for incident templates or custom fields, that is why you could not find them.

Both the **Rules** and the **Settings** sections of the Incidents side menu are collapsed by default, so you have to expand them before the items below appear. Everything here is project-scoped: templates, roles, custom fields and rules belong to one project and apply to every incident declared in it.

This page is the reference for that configuration — what each page holds, and which of it runs automatically the moment an incident is created.

## Where incident settings live

Open **Incidents** in the left navigation, then expand **Settings** at the bottom of the side menu.

| Page                     | What you do there                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| **Incident State**       | Add, rename, recolor and reorder the states an incident moves through.                       |
| **Incident Severity**    | Add, rename, recolor and reorder severity levels.                                            |
| **Incident Templates**   | Pre-fill a whole incident — title, description, resources, on-call policies, owners, labels. |
| **Note Templates**       | Reusable text for public and private notes.                                                  |
| **Postmortem Templates** | Reusable postmortem structures.                                                              |
| **Custom Fields**        | Define extra fields that appear on every incident.                                           |
| **Measurements**         | Define named durations — time to detect, time to mitigate — computed for every incident.     |
| **Incident Roles**       | Define the roles you assign responders to, such as Incident Commander.                       |
| **More Settings**        | The incident and incident episode number prefixes.                                           |

**Incident State** and **Incident Severity** are covered in depth on [Incident States & Severities](/docs/incidents/states-and-severities) — the rest of this page picks up from **Incident Templates**.

Expand **Rules** and you get eight more pages: **Grouping Rules**, **On-Call Rules**, **Owner Rules**, **Runbook Rules**, **Privacy Rules**, **Label Rules**, **SLA Rules** and **Reminder Rules**. Those are covered further down.

## Incident templates

An incident template is a saved skeleton of an incident. Instead of retyping the same title, the same monitor list and the same on-call policy every time the payments cluster wobbles, you save it once and declare from it.

Go to **Incidents → Settings → Incident Templates** (`/dashboard/{projectId}/incidents/settings/templates`). The card is titled **Incident Templates**. Creating one walks you through a six-step wizard:

- **Template Info** — **Template Name** and **Template Description**. These name the template itself; they never appear on the incident.
- **Incident Details** — **Title**, **Description** (Markdown), **Incident Severity** and **Initial Incident State**. **Initial Incident State** is optional and starts empty; its options are listed in state order. Leave it blank and incidents from this template land in the project's created state.
- **Resources Affected** — the monitors, hosts, clusters and services the incident should be attached to, plus **Change Monitor Status to**.
- **On-Call** — **On-Call Policy**, the policies to execute when an incident created from this template is declared.
- **Owners** — **Owner - Teams** and **Owner - Users**.
- **Labels** — **Labels**.

A few quick rules:

- The template list shows only **Name** and **Description**. Rows are not editable or deletable from the list — open a template (`/dashboard/{projectId}/incidents/settings/templates/{modelId}`) to change it.
- Templates support JSON import and export, so you can move one between projects.
- The empty state reads "No incident templates found."

### How a template gets applied

There are two paths, and they behave the same way.

- **From the dashboard** — the **Create from Template** button on the incidents list opens a **Select Incident Template** picker, and the declare page reads the template from the `incidentTemplateId` query string parameter, then pre-fills the form with the template plus its owner teams and owner users.
- **From the API** — pass `createdIncidentTemplateId` on `POST /api/incident` and the server fills the incident from the template.

The important part is the merge rule: **a template only fills a field you left undefined**. Title, description, incident severity, initial incident state, the monitor status behind **Change Monitor Status to**, monitors, hosts, Kubernetes clusters, Docker hosts, Podman hosts, services, on-call policies and labels are copied from the template only when the caller or the form supplied nothing. Anything you set explicitly always wins.

**The empty-state dialog points at the wrong place.** If you have no templates yet, the **Create from Template** button shows a **No Incident Templates** dialog. Its text points at Project Settings, but the button routes to **Incidents → Settings → Incident Templates** — that is the real location.

## Note templates

Note templates give responders canned text for incident updates, so a status page update at 3am is not written from scratch by someone half awake.

Go to **Incidents → Settings → Note Templates** (`/dashboard/{projectId}/incidents/settings/note-templates`). The card is titled **Public or Private Note Templates for Incidents** — one library serves both note types. The create form has two steps:

- **Template Info** — **Template Name** and **Template Description**, both required.
- **Note Details** — the note body itself, in Markdown, required.

Like incident templates, rows are created and viewed rather than edited inline; open a template to change it.

Note templates surface where you actually need them: the **Acknowledge Incident** and **Resolve Incident** confirmation dialogs both offer **Select Note Template** next to the **Public Note** field. See [Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed) for how public and private notes differ.

## Postmortem templates

A postmortem template is the skeleton of the write-up you produce after an incident — your headings, your prompts, your standing questions — so every review in the project follows the same shape.

Go to **Incidents → Settings → Postmortem Templates** (`/dashboard/{projectId}/incidents/settings/postmortem-templates`). The card is titled **Postmortem Templates**. The create form has two steps:

- **Template Info** — **Template Name** and **Template Description**, both required.
- **Postmortem Details** — **Postmortem Template**, the body itself, in Markdown, required.

You apply one from the incident, not from settings. Open an incident, choose **Postmortem** in its side menu (`/dashboard/{projectId}/incidents/{incidentId}/postmortem`), and use **Apply Template**. That opens an **Apply Postmortem Template** dialog with a **Select Template** dropdown; picking one loads the template body into the **Postmortem Note** editor, where you edit it before saving. Incident episodes have the same **Postmortem** page and draw on the same template library.

## Custom fields

Custom fields let you carry your own metadata on every incident — an internal service name, a change ticket reference, a customer tier.

Go to **Incidents → Settings → Custom Fields** (`/dashboard/{projectId}/incidents/settings/custom-fields`). The page is titled **Incident Custom Fields**. Each definition has:

- **Field Name** — required, at least two characters. The placeholder suggests a slug-like name such as `internal-service`.
- **Field Description** — optional.
- **Field Type** — required. This chooses how data is entered. Dropdown types also need their options listed.
- **Dropdown Options** — the values that appear in the dropdown, each with an optional color.

Definitions live in their own model; the values live on the incident itself in the `customFields` column. On a single incident you fill them in from **Custom Fields** in the incident side menu (`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`).

**One gap worth knowing.** Incident custom field definitions are the only part of the incident family with no workflow triggers — see the workflow section below.

## Measurements

A measurement is a named duration between two points in an incident's life, computed for every incident automatically. "Time to Detect", "Time to Mitigate" and "Time to Resolve" are measurements. They are definitions you write once, not numbers somebody reads off a timeline.

Go to **Incidents → Settings → Measurements** (`/dashboard/{projectId}/incidents/settings/measurements`). Each definition has a **name**, a permanent **key**, a **starting point** and an **ending point**.

Alerts and scheduled maintenance events have the same feature, at **Alerts → Settings → Measurements** and **Scheduled Maintenance → Settings → Measurements**. Everything below applies to all three, with each domain's own vocabulary.

### Choosing the two ends

An end is either a timestamp on the incident or a point in its state timeline.

| Ending point            | Resolves to                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------- |
| **Impact Started At**   | When customer impact actually began. Blank until someone records it.                |
| **Declared At**         | When the incident was declared. Defaults to the moment it was created.              |
| **Created At**          | Row creation time.                                                                  |
| **Timeline Start**      | The origin the built-in incident metrics use. Pick this to match those numbers.     |
| **State Entered**       | The moment a specific state was entered.                                            |
| **State Role Entered**  | The moment whichever state is the acknowledged (or created, or resolved) one was entered. |
| **Postmortem Posted At**| When the postmortem was published.                                                  |

**State Entered** pins one state by id. **State Role Entered** follows the role instead, so it keeps working if you later rename or replace the state that plays that part.

When a state is entered more than once — a reopened incident — **Occurrence** decides which entry counts. **First** matches how the built-in metrics behave. **Last** follows a reopen through to the final entry.

### What a measurement reports

| Status             | Meaning                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------- |
| **Recorded**       | Both ends resolved. The duration is on the incident and charted.                           |
| **Pending**        | An end has not happened yet, but still can.                                                 |
| **Not Applicable** | An end can never resolve — the state was skipped, or the timestamp was never recorded.      |
| **Invalid**        | Both ends resolved, but the end is before the start. Your recorded timestamps disagree.     |

Only **Recorded** values become metric points. A skipped milestone writes nothing rather than a zero, so it cannot drag an average towards it.

**Invalid** is the status worth watching. It is what a measurement says when the timeline it was computed from is wrong — for example an end 17 minutes before its start. That is deliberately louder than a plausible-looking number nobody questions.

### Impact Started At, and why it is blank

**Impact Started At** is a field on the incident, editable from the incident page. It is blank by default and OneUptime never fills it in.

That is the point. `Declared At` records when OneUptime found out, which for a monitor-triggered incident is when the criteria were processed — not when impact began. If "Time to Detect" defaulted its start to the same timestamp its end uses, every incident would report zero and the chart would read "we detect instantly". A blank field and a **Not Applicable** measurement say the true thing: nobody has recorded when this started.

### Correcting a wrong timestamp

Every measurement is recomputed from scratch whenever the data underneath it changes — a state timeline entry created, edited or deleted, or `Impact Started At`, `Declared At` or `Postmortem Posted At` corrected on the incident. Nothing is patched incrementally, so there is no stale value to repair.

The **Starts At** field on a state timeline entry is editable. If an incident was acknowledged at 09:12 but the entry says 09:29, correct the entry and every measurement derived from it moves with it.

### Charts, API and Terraform

Each enabled measurement writes a metric named `oneuptime.incident.measurement.<key>`, which appears in the dashboard chart picker once its first value is written. Alerts use `oneuptime.alert.measurement.<key>` and scheduled maintenance uses `oneuptime.scheduled-maintenance.measurement.<key>`.

Definitions are ordinary API resources, so the Terraform provider manages them as `oneuptime_incident_measurement`, `oneuptime_alert_measurement` and `oneuptime_scheduled_maintenance_measurement`. Computed values are read-only and surface as data sources.

The **key** is permanent because it is part of the metric name — changing it would orphan the series. Rename the measurement freely; the key stays.

### Migrating from another incident platform

If you are coming from a tool with declarative measurement definitions, these map across directly:

| Their measurement       | Set it up here as                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------- |
| Time to Detect          | Impact Started At → Declared At                                                     |
| Time to Acknowledge     | Timeline Start → State Role Entered (acknowledged)                                  |
| Time to Mitigate        | Timeline Start → State Entered (a **Mitigated** state you add between Acknowledged and Resolved) |
| Time to Resolve         | Timeline Start → State Role Entered (resolved)                                      |

Time to Mitigate needs a state that does not exist by default. Add it on **Incidents → Settings → Incident State** — the ordered list lets you insert a state between two existing ones, and everything after it shifts down.

**One thing to know about history.** A definition you create today fills in for past incidents in the background, and those stored values appear on each incident. Charted history fills forward from the moment you create the definition; individual past incidents also refresh on their next state change.

## Incident roles

Incident roles are the named jobs you assign people to during a response. Define them at **Incidents → Settings → Incident Roles** (`/dashboard/{projectId}/incidents/settings/roles`); the card description gives Incident Commander and Responder as examples.

Roles are definitions only. You assign people to them per incident — the declare wizard has an **Incident Roles** step with an **Assign Incident Roles** field, and each incident has a **Roles** page in its side menu.

## Number prefixes

Every incident gets a number. By default it renders as `#42`. If your team says "INC-42" out loud, make the product say it too.

Go to **Incidents → Settings → More Settings** (`/dashboard/{projectId}/incidents/settings/more`). The card is **Number Prefix** and holds two fields on the project:

- **Incident Number Prefix** — up to 20 characters, placeholder `INC-`. Set it and incident `#42` displays as `INC-42`.
- **Incident Episode Number Prefix** — the same idea for incident episode numbers, placeholder `IE-`.

Leave either empty to keep the default `#` prefix; the unset field displays `# (default)`. Save with **Update**. The prefixed value is stored on the incident as `incidentNumberWithPrefix`, which is what the incidents list and the incident header render.

## Rules that run when an incident is created

**Incidents → Rules** holds eight rule engines. They all do the same job — look at an incident the moment it is created, and act if it matches — but they differ in what they do and in how multiple matching rules resolve.

- **Grouping Rules** — group related incidents into episodes. Rules are evaluated in priority order; lower priority numbers go first.
- **On-Call Rules** — execute on-call duty policies for matching incidents. Covered in detail below.
- **Owner Rules** — assign owners automatically.
- **Runbook Rules** — start a [runbook](/docs/runbooks/index) when an incident matches.
- **Privacy Rules** — decide whether a matching incident is private.
- **Label Rules** — apply labels automatically.
- **SLA Rules** — track response and resolution times. Rules are evaluated in order; lower order numbers go first.
- **Reminder Rules** — periodically remind incident owners while an incident is still open. Rules are evaluated in order and the first matching rule wins.

**Order semantics are not uniform.** Grouping Rules, SLA Rules and Reminder Rules are order-evaluated. On-Call Rules are not — every matching rule fires. Do not assume one model applies to all eight.

The **On-Call Rules**, **Owner Rules**, **Label Rules** and **Privacy Rules** pages are tabbed — an **Incident Rules** tab and an **Episode Rules** tab, each with its own table. Configure the **Incident Rules** tab unless you specifically mean episodes. **Grouping Rules**, **Runbook Rules**, **SLA Rules** and **Reminder Rules** are single tables.

## Incident on-call rules

**Incidents → Rules → On-Call Rules** (`/dashboard/{projectId}/incidents/settings/on-call-rules`) is where you make paging automatic. The card, **Incident On-Call Rules**, describes rules that automatically execute on-call duty policies when matching incidents are created. The page has two tabs: **Incident Rules** and **Episode Rules**.

The create form has three steps:

- **Basic Info** — **Name** (the placeholder suggests something like paging the database team for any DB incident), **Description**, and an **Enabled** toggle. The list renders a green **Enabled** or red **Disabled** pill per rule.
- **Match Criteria** — **Monitors**, **Incident Severities**, **Incident Labels**, **Monitor Labels**, plus case-insensitive regular expression fields for the incident title, incident description, monitor name and monitor description.
- **On-Call Policies** — the policies this rule executes.

### How matching resolves

The rules the page ships with itself are worth internalizing:

- A rule matches only when **all** of the criteria you filled in pass. Criteria you left empty are skipped, not failed.
- Within a single list criterion — **Monitors**, **Incident Severities**, **Incident Labels**, **Monitor Labels** — matching is any-of.
- The pattern fields are case-insensitive regular expressions.
- **All matching rules fire.** There is no priority and no short-circuit.
- The set of policies that actually executes is the union of every matching rule's policies plus any policies attached to the incident manually or by a template, deduplicated so each policy runs at most once.

Severity is a match criterion here and nowhere else. There is no on-call field on an incident severity — selecting "Critical Incident" does not, by itself, page anyone. If you want severity to drive paging, write an on-call rule that matches on it.

## Attaching on-call policies directly

Rules are not the only route. Every incident carries an on-call policy list of its own, surfaced as the **On-Call Policy** field on the **On-Call** step of the declare wizard and on the **On-Call** step of an incident template. The field description says it plainly: these are the on-call duty policies to execute when this incident is created.

When an incident is created, OneUptime runs label rules, then on-call rules (which merge their matching policies into the incident's list), then runbook rules — and if the resulting list is non-empty, every policy in it is executed. Executions run in parallel and are settled independently, so one policy failing does not stop the others. Each execution is tagged with the incident that triggered it and with the incident-created notification event type.

To see what happened, open the incident and choose **On-Call Executions** in its side menu (`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`).

## Driving incidents from workflows

Workflow triggers for incidents are not hand-written — OneUptime generates them from the data models, so every incident-family model gets **On Create X**, **On Update X** and **On Delete X** components, named from the model's singular name. The headline three are **On Create Incident**, **On Update Incident** and **On Delete Incident**, and you'll find them under the **Incident** category in the **Add Component** panel at `/dashboard/{projectId}/workflows`.

The same generation gives you triggers for the configuration itself: **On Create Incident State**, **On Update Incident Severity**, **On Create Incident Template**, **On Create Incident Note Template**, **On Create Incident State Timeline**, **On Create Incident Public Note**, **On Create Incident Internal Note**, **On Create Incident On-Call Rule**, **On Create Incident Role**, **On Create Incident Member** and more. Each model also gets matching action components — **Find One Incident**, **Create One Incident**, **Update One Incident**, **Delete One Incident** and their many-row equivalents — so a trigger and an action with similar names sit side by side in the same category. **On Create Incident** starts a workflow; **Create One Incident** opens one.

A few details that matter when you wire these up:

- **On Update X** takes an optional **Listen on** argument that narrows the trigger to updates touching specific fields. Leave it blank to fire on any change. If an update arrives without a record of which fields moved, the filter is skipped and the workflow runs anyway.
- **On Create X** and **On Update X** both take a required **Select Fields** argument; **On Delete X** takes no arguments.
- All three expose a single **Success** out-port, and each accepts an ID argument so you can run the workflow by hand against one record.
- Names come from the model's singular name, not its table name — which is why you see **On Create Incident Team Owner** and **On Create Incident User Owner** rather than the table-shaped names.
- There are no triggers for incident custom field definitions. That model is the one member of the incident family with workflows disabled.

For building the rest of the workflow, see [Authoring a Workflow](/docs/workflows/authoring) and [Variables](/docs/workflows/variables).

## Where to read next

- [Incidents Overview](/docs/incidents/index) — how the incident feature fits together.
- [Declaring an Incident](/docs/incidents/declaring-incidents) — the declare wizard, templates and the API.
- [Incident States & Severities](/docs/incidents/states-and-severities) — the state and severity settings pages and what the flags do.
- [Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed) — where note templates get used.
- [Subscribers & Announcements](/docs/status-pages/subscribers) — who hears about an incident outside your team.
- [Workflows Overview](/docs/workflows/index) — automating on top of incident triggers.
- [Runbooks Overview](/docs/runbooks/index) — the procedures runbook rules attach.
