# Settings & Automation

Incident configuration does not live in Project Settings. It lives inside the Incidents product area itself, under **Incidents → Settings** and **Incidents → Rules**, at routes beginning `/dashboard/{projectId}/incidents/settings/`. If you have been hunting through **Project Settings** for incident templates or custom fields, that is why you could not find them.

Both the **Rules** and the **Settings** sections of the Incidents side menu are collapsed by default, so you have to expand them before the items below appear. Everything here is project-scoped: templates, roles, custom fields and rules belong to one project and apply to every incident declared in it.

This page is the reference for that configuration — what each page holds, and which of it runs automatically the moment an incident is created.

## Where incident settings live

Open **Incidents** in the left navigation, then expand **Settings** at the bottom of the side menu.

| Page                     | What you do there                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| **AI**                   | Turn automatic investigation, automatic code fixes and postmortem drafts on or off, and set the optional limits AI works under — none apply until you set them. See [AI SRE](/docs/ai/ai-sre). |
| **Incident State**       | Add, rename, recolor and reorder the states an incident moves through.                       |
| **Incident Severity**    | Add, rename, recolor and reorder severity levels.                                            |
| **Incident Templates**   | Pre-fill a whole incident — title, description, resources, on-call policies, owners, labels. |
| **Note Templates**       | Reusable text for public and private notes.                                                  |
| **Postmortem Templates** | Reusable postmortem structures.                                                              |
| **Custom Fields**        | Define extra fields that appear on every incident.                                           |
| **Incident Roles**       | Define the roles you assign responders to, such as Incident Commander.                       |
| **Measurements**         | Define named durations — time to detect, time to mitigate — computed for every incident.     |
| **Linked Alerts**        | Choose whether the alerts linked to an incident are acknowledged and resolved along with it. Both are on for new projects. |
| **Number Prefix**        | The text in front of incident and episode numbers, such as `INC-` in `INC-42`.               |

**Incident State** and **Incident Severity** are covered in depth on [Incident States & Severities](/docs/incidents/states-and-severities) — the rest of this page picks up from **Incident Templates**. Forms that let people outside your team report incidents are a product of their own: see [Forms](/docs/forms/index).

Expand **Rules** and you get nine more pages: **Grouping Rules**, **On-Call Rules**, **Owner Rules**, **Runbook Rules**, **Auto Remediation Rules**, **Privacy Rules**, **Label Rules**, **SLA Rules** and **Reminder Rules**. Those are covered further down.

## Incident templates

An incident template is a saved skeleton of an incident. Instead of retyping the same title, the same monitor list and the same on-call policy every time the payments cluster wobbles, you save it once and declare from it.

Go to **Incidents → Settings → Incident Templates** (`/dashboard/{projectId}/incidents/settings/templates`). The card is titled **Incident Templates**. Creating one walks you through a six-step wizard, with two more steps when your project has incident custom fields:

- **Template Info** — **Template Name** and **Template Description**. These name the template itself; they never appear on the incident.
- **Incident Details** — **Title**, **Description** (Markdown), **Incident Severity** and **Initial Incident State**. **Initial Incident State** is optional and starts empty; its options are listed in state order. Leave it blank and incidents from this template land in the project's created state.
- **Resources Affected** — the monitors, hosts, clusters and services the incident should be attached to, plus **Limit to these status pages** and **Change Monitor Status to**. **Limit to these status pages** limits incidents declared from the template to some of the status pages that list their monitors — a `Region East outage` template can carry the East site pages. An existing template shows it on a **Status Page Scope** card, with **Edit Status Page Scope**. See [One Status Page per Audience](/docs/status-pages/one-status-page-per-audience).
- **Custom Fields** — only when your project has incident custom fields: the values incidents declared from this template start with. Every field is offered here, not only the ones the **Details** step asks for, and none is required. An existing template has a **Custom Fields** card to change them.
- **Custom Fields on Create** — also only when your project has incident custom fields: which of them the **Details** step asks for when an incident is declared from this template, and which must be filled in. An existing template has a **Custom Fields on Create** card to change them. See [Custom fields on create](#custom-fields-on-create).
- **On-Call** — **On-Call Policy**, the policies to execute when an incident created from this template is declared.
- **Owners** — **Owners**: the people and teams who own incidents declared from the template. **Add owner** opens one list of both, the same list as an incident's **Owners** page; each pick shows as a chip you can remove. An existing template shows them on an **Owners** card.
- **Labels** — **Labels**.

A few quick rules:

- The template list shows only **Name** and **Description**. Rows are not editable or deletable from the list — open a template (`/dashboard/{projectId}/incidents/settings/templates/{modelId}`) to change it.
- Templates support JSON import and export, so you can move one between projects.
- The empty state reads "No incident templates found."

### How a template gets applied

There are two paths, and they merge the same way.

- **In the dashboard** — the **Create from Template** button on the incidents list opens a **Select Incident Template** picker, and the declare page reads the template from the `incidentTemplateId` query string parameter, then pre-fills the form with the template plus its owner teams and owner users. Its **Details** step follows the template's [custom fields on create](#custom-fields-on-create). The owners become the incident's owners without being notified, once the incident's Slack and Microsoft Teams channels exist, so a notification rule that invites incident owners to a new channel invites them too.
- **On the server** — an incident created with `createdIncidentTemplateId` set to a template's id is filled from the template. Only OneUptime itself sets that column: a workflow's **Create One Incident** step, and a [form](/docs/forms/on-submit#the-incident-template) that has an **Incident Template**. An API key or a signed-in user cannot — a request that sends `createdIncidentTemplateId` is refused — so to declare from a template over the API, read it from `/api/incident-templates` and send its values in the request. The server applies the template only when the incident names no state: a workflow that declares from a template must leave `currentIncidentStateId` out.

The important part is the merge rule: **a template only fills a field you left undefined**. Title, description, incident severity, initial incident state, the monitor status behind **Change Monitor Status to**, monitors, hosts, Kubernetes clusters, Docker hosts, Podman hosts, services, on-call policies, labels and status pages are copied from the template only when the caller or the form supplied nothing. Anything you set explicitly always wins. Custom field values merge one field at a time: the template fills in the fields the incident was declared without, and a value you set — `0`, `false` and `null` included — wins over the template's.

**The empty-state dialog points at the wrong place.** If you have no templates yet, the **Create from Template** button shows a **No Incident Templates** dialog. Its text points at Project Settings, but the button routes to **Incidents → Settings → Incident Templates** — that is the real location.

### Custom fields on create

The project's settings decide what the **Details** step asks when an incident is declared: **Show on Create** asks for a field, and **Required on Create** makes it compulsory. A template can change both for the incidents declared from it. Its **Custom Fields on Create** card — and the wizard step of the same name — lists every incident custom field in its **Order**, with one setting each:

| Setting      | When an incident is declared from this template                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Default**  | The field follows its own **Show on Create** and **Required on Create**. The option says which, such as **Default (Required)**.   |
| **Required** | The **Details** step asks for the field, and it must be filled in. A yes/no field must be switched on.                             |
| **Optional** | The step asks for the field, and it can be left empty — even when the project requires it.                                        |
| **Hidden**   | The step does not ask for the field, even when the project shows or requires it. The template's own value for it is still applied. |

On the card, a field the template sets to **Required**, **Optional** or **Hidden** also shows, under its type, what the project does with it: **Project default: Required**, **Project default: Optional** or **Project default: Not Shown**. Everybody who can see the template sees it.

Use it when the incidents of one template need an answer others do not — a customer tier on a `Customer data exposure` template, say — or to keep a question the project asks everywhere out of a template where it does not fit.

- **Keyed by the Template Variable.** Each setting is stored under the field's **Template Variable**, which never changes, so renaming a field keeps its setting. A field that is deleted and created again with the same name gets its setting back — unlike a form's questions, which name a field by its ID, so a field deleted and created again is not asked until it is added again.
- **Edit and Save read them afresh.** **Edit** on the card reads the fields and the template's settings again, with a loader in the dialog meanwhile, and **Save** reads them once more and writes only the fields you changed in it. So a change another admin made to other fields in the meantime is kept — a setting they gave a field created while your dialog was open included — and a change you made to a field deleted meanwhile is not written. The card then lists the fields as they are. If they cannot be read when you press **Edit**, the dialog says why and offers **Try again** instead of **Save**; when you press **Save**, it says why, saves nothing and keeps your choices.
- **Only the dashboard applies them.** Like **Required on Create**, the settings shape the **Declare Incident** form and nothing else. Incidents declared through the API, by a workflow, a monitor, Slack, Microsoft Teams or AI are not held to them, and [forms](/docs/forms/building) ask questions of their own. See [Required on Create is checked by the dashboard only](#required-on-create-is-checked-by-the-dashboard-only).
- **A field copied from a monitor custom field** is still not asked once the incident has a monitor, whatever the template says.
- **Anyone who can edit incident templates can change them** — Project Members and Incident Members included — even for a field a Project Admin made **Required on Create** for the whole project. The project-wide settings themselves need a Project Owner, a Project Admin or the **Edit Incident Custom Field** permission.
- **They travel with the template.** A template's JSON export includes them, and in the project you import it into they apply to the fields with the same **Template Variable**.

Through the API, they are the template's `customFieldSettings`: an object keyed by each field's **Template Variable**, with `Required`, `Optional`, `Hidden` or `Default` for each field.

```json
{
  "customFieldSettings": {
    "impact": "Required",
    "affected_location": "Optional",
    "additional_information": "Hidden"
  }
}
```

A field that is not listed follows its own settings, as with `Default`. A request is refused with a `400` error when a key is not a valid **Template Variable** — lowercase letters, digits and underscores — or a value is not one of the four. A key that matches no field is kept, and ignored.

## Note templates

Note templates give responders canned text for incident updates, so a status page update at 3am is not written from scratch by someone half awake.

Go to **Incidents → Settings → Note Templates** (`/dashboard/{projectId}/incidents/settings/note-templates`). The card is titled **Public or Private Note Templates for Incidents** — one library serves both note types. The create form has two steps:

- **Template Info** — **Template Name** and **Template Description**, both required.
- **Note Details** — the **Note** itself, in Markdown, required: the text a note starts with when the template is picked.

Like incident templates, rows are created and viewed rather than edited inline; open a template to change it.

**Variables.** A note template can carry variables that are filled in with the incident's values when the template is picked, so the author sees — and can still change — the finished text before posting it:

| Variable                            | Filled with                                                        |
| ----------------------------------- | ------------------------------------------------------------------ |
| `{{incident.title}}`                | The incident's title.                                              |
| `{{incident.number}}`               | Its number, for example `INC-42` or `#42`.                         |
| `{{incident.severity}}`             | Its severity.                                                      |
| `{{incident.state}}`                | Its current state.                                                 |
| `{{incident.startedAt}}`            | When it was declared, in the author's time zone, with the zone named. |
| `{{incident.labels}}`               | Its labels, separated by commas.                                   |
| `{{incident.affectedStatusPages}}`  | The status pages it shows on and notifies that the author can see. |
| `{{incident.customFields.<key>}}`   | A custom field's value, by the field's **Template Variable**, which the **Note** editor lists under **Template variables** by the field's name. |

Custom fields used to be written `{{customFields.<key>}}`; templates that still use it are filled in the same way. A variable that has no value, or that is not on the list, stays exactly as written, for the author to fill in. Values are placed as text: an incident title cannot turn into an image, HTML or a link whose text hides where it goes in the posted note, although an address in it still shows as a link to that address. A **Rich text (Markdown)** custom field is placed as the Markdown it is. The custom field, label and status page variables fill in your team's own records, every custom field whether or not it is marked **Include in Subscriber Notifications**, and one library serves public notes too, which are shown on the incident's status pages and emailed to their subscribers. Read the filled-in text before you post a public note.

**Putting a variable in.** You never need to type a variable's name. The **Note** editor offers the variables three ways, and each puts the variable where the cursor is:

- **Template variables**, collapsed under the editor: open it to see every variable with what it is filled with — the project's incident custom fields by name — and click one.
- **Insert variable**, at the end of the editor's toolbar: the same list, with a search box.
- Typing `{{` in the note opens the list under the cursor. Keep typing to narrow it, choose with the arrow keys, and press Enter or Tab to put the variable in; Escape closes the list.

The same list, button and `{{` come with the other templates that have variables: an SLA rule's note reminders, an incident or alert grouping rule's episode title and description, a monitor rule's incident and alert description and remediation notes, an SLO burn rate rule's templates and a status page's custom subscriber notification templates.

Note templates surface where you actually need them: the **Acknowledge Incident** and **Resolve Incident** confirmation dialogs both offer **Select Note Template** next to the **Public Note** field. See [Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed) for how public and private notes differ.

## Postmortem templates

A postmortem template is the skeleton of the write-up you produce after an incident — your headings, your prompts, your standing questions — so every review in the project follows the same shape.

Go to **Incidents → Settings → Postmortem Templates** (`/dashboard/{projectId}/incidents/settings/postmortem-templates`). The card is titled **Postmortem Templates**. The create form has two steps:

- **Template Info** — **Template Name** and **Template Description**, both required.
- **Postmortem Details** — **Postmortem Template**, the body itself, in Markdown, required.

You apply one from the incident, not from settings. Open an incident, choose **Postmortem** in its side menu (`/dashboard/{projectId}/incidents/{incidentId}/postmortem`), and use **Apply Template**. That opens an **Apply Postmortem Template** dialog with a **Select Template** dropdown; picking one loads the template body into the **Postmortem Note** editor, where you edit it before saving. Incident episodes have the same **Postmortem** page and draw on the same template library.

## Custom fields

Custom fields let you carry your own metadata on every incident — an internal service name, a change ticket reference, a customer tier — and ask the same questions every time an incident is declared, such as its impact and when it is expected to be resolved.

Go to **Incidents → Settings → Custom Fields** (`/dashboard/{projectId}/incidents/settings/custom-fields`). The page is titled **Incident Custom Fields** and lists the fields in their **Order**, each by its **Field Name** and **Field Type** alone. **Edit** on a field's row opens the rest of its settings. Each definition has:

- **Field Name** — required, at least two characters. The placeholder suggests a slug-like name such as `internal-service`.
- **Field Description** — optional.
- **Field Type** — required. This chooses how data is entered; the types are listed below. Dropdown types also need their options listed.
- **Dropdown Options** — the values that appear in the dropdown, each with an optional color.
- **Order** — where the field appears among the incident's custom fields: on the incident's **Custom Fields** page, in the **Details** step and in subscriber messages. There is no number to type in: drag a field by the handle at the start of its row to move it up or down, and a new field is added to the end. Dragging is off while a filter or search narrows the list.
- **Show on Create** — asks for the field in the **Details** step when an incident is declared from the dashboard (see [Declaring Incidents](/docs/incidents/declaring-incidents)). An incident template can give any field a starting value, shown on create or not, and can ask for a field or leave it out for the incidents declared from it — see [Custom fields on create](#custom-fields-on-create). [Forms](/docs/forms/building#custom-fields) do not follow it: a form asks only the fields added to it.
- **Required on Create** — offered once **Show on Create** is on. The **Details** step does not let you declare the incident until the field is filled in, and a **Boolean** field must be switched on. The dashboard is the only place this is checked; see [Required on Create is checked by the dashboard only](#required-on-create-is-checked-by-the-dashboard-only).
- **Include in Subscriber Notifications** — sends the field and its value to status page subscribers with the incident's messages: the default email, Slack and Microsoft Teams messages and webhooks, but not SMS. Subscribers are usually outside your team, so only turn it on for fields that are safe to share. See [Incident custom fields in notifications](/docs/status-pages/subscribers#incident-custom-fields-in-notifications).
- **Template Variable** — the key a template reaches the field by, `{{incident.customFields.<key>}}`, in note templates and custom subscriber notification templates. It is made from the field's name when the field is created — lowercase letters, digits and underscores, so `Expected Resolution` becomes `expected_resolution`, with `_2`, `_3` and so on added when another field already has the key — and it does not change when the field is renamed. Nobody sets it by hand: the API ignores a value sent for it. Templates written with the older `{{customFields.<key>}}` keep working. You never need to look it up: the editors that place it — a note template's **Note** and a status page's custom subscriber notification templates for incident events — list every field's variable under **Template variables**, by the field's name.

**Order**, **Show on Create**, **Required on Create**, **Include in Subscriber Notifications** and **Template Variable** exist on incident custom fields only. The custom fields of monitors, alerts, scheduled maintenance events and the other resources do not have them.

Definitions live in their own model; the values live on the incident itself in the `customFields` column. On a single incident you fill them in from **Custom Fields** in the incident side menu (`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`), where the fields are listed in their **Order**. Incident templates keep values for the same fields in their own `customFields`.

**One gap worth knowing.** Incident custom field definitions are the only part of the incident family with no workflow triggers — see the workflow section below.

### Field types

| Field type                   | Entered as                                           | Good for                                           |
| ---------------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| **Text**                     | One line of text                                     | A change ticket reference, an internal service name |
| **Number**                   | A number                                             | Estimated duration in minutes, users affected      |
| **Boolean**                  | A yes/no switch                                      | An acknowledgement, "customer facing"              |
| **Dropdown (single select)** | One option from a list                               | Impact, region                                     |
| **Dropdown (multi-select)**  | Several options from a list                          | Affected systems                                   |
| **Date**                     | A date                                               | A contract renewal date                            |
| **Date and time**            | A date and a time of day                             | Expected resolution                                |
| **Long text**                | Several lines of plain text                          | Affected users or systems, additional information  |
| **Rich text (Markdown)**     | Formatted text, in the Markdown editor with its visual mode | A workaround with links and lists           |

**Long text** and **Rich text (Markdown)** are available for the custom fields of every resource, not only incidents. A rich text value is stored as the Markdown it was written in. There is no radio button or checkbox group type: use a **Dropdown (single select)**, a **Dropdown (multi-select)** or a **Boolean**.

### Required on Create is checked by the dashboard only

**Required on Create** holds back the **Declare Incident** form, and nothing else. Incidents that a monitor, the API, Slack, Microsoft Teams or AI opens cannot fill in a form, so they are created with the field empty. Once an incident exists, every field stays optional on its **Custom Fields** page, so a responder fixing one value mid-outage is never asked for all the others. Treat it as a prompt for the people declaring incidents, not as a promise that every incident has a value.

A template's [custom fields on create](#custom-fields-on-create) are the same: they shape the **Declare Incident** form and nothing else. [Forms](/docs/forms/building#required-questions) are the exception, because the server checks a form's **Required** questions when the form is submitted.

### Custom field values through the API

On `POST /api/incident` and on updates to an incident, `customFields` is an object keyed by each field's **Field Name**:

```json
{
  "customFields": {
    "Impact": "Major",
    "Estimated Duration": 90,
    "Acknowledgement": true,
    "Expected Resolution": "2026-10-01T14:30:00.000Z"
  }
}
```

When a user or an API key creates or updates an incident, each value the request sets or changes must fit its field, or the request is refused with a `400` error that names the field and the value it was sent:

| Field type                                           | Accepts                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| **Text**, **Long text**, **Rich text (Markdown)**    | Text. A number, `true` or `false` is stored as sent.          |
| **Number**                                           | A number, or text that is one, such as `"42"`.                |
| **Boolean**                                          | `true` or `false`, or the text `"true"` or `"false"`.         |
| **Date**, **Date and time**                          | A date, preferably as ISO 8601 text.                          |
| **Dropdown (single select)**                         | One of its options.                                           |
| **Dropdown (multi-select)**                          | A list of its options, or a single option on its own.         |

For a **Dropdown (multi-select)**, the refusal names the first 10 entries that are not among its options, and then how many more there are.

What is not checked, so that existing integrations keep working:

- **Values the request leaves as they are.** The **Custom Fields** card sends every value back when you save one of them, so a value stored before these checks existed, or a dropdown option removed since, never stops you saving the others. A multi-select keeps the entries it already had.
- **Keys that are not the name of an incident custom field**, such as the `jiraIssueKey` that the [Jira integration](/docs/integrations/jira) writes.
- **Empty values.** `null` or an empty string clears a field.
- **Values copied from a monitor custom field**, and writes OneUptime makes itself.
- **Required on Create.** The API never asks for a field.

An incident that a workflow or a form declares from a template (`createdIncidentTemplateId`) starts with the template's custom field values, merged one field at a time under the ones it sends (see [How a template gets applied](#how-a-template-gets-applied)). An API key cannot declare from a template: a request that sends `createdIncidentTemplateId` is refused.

### Renaming a field

Values are stored under the field's name, so renaming a field has to move them. When you save a new **Field Name**, OneUptime moves the field's value to the new name on every incident and every incident template in the project, and updates the saved views of the incidents list that show or filter by the field. The move starts no **On Update Incident** workflow, and it does not change any incident's last-updated time. The field's **Template Variable** stays as it was, so note templates, custom subscriber notification templates and webhook integrations that use it keep working.

Two renames are refused: one onto a name another incident custom field already has (compared without regard to case), and an API request that would rename several fields at once. Workflows and API clients that read or write a value by the field's old name need to be changed to the new one.

After a rename the field holds only its own values. Deleting a field leaves its values on the incidents that had them, so incidents can still hold values under the new name from a field that was deleted; the rename clears those, rather than show them as this field's answers or send them to subscribers. Every incident and template moves together: if the move fails, none of them changes, the field keeps its old name and the save reports an error, so you can simply try again. A field **created** with a deleted field's name is different: it shows the values that field left behind, and sends them to subscribers once **Include in Subscriber Notifications** is on.

Deleting a field leaves the questions that ask for it on every [form](/docs/forms/building#custom-fields) in the project, but they are no longer asked: the form builder marks each one for you to delete. A field created again with the same name is a new field, and is not asked on a form until someone adds it there. Incident templates keep their **Custom Fields on Create** setting for it.

### Terraform

The settings are on the `oneuptime_incident_custom_field` resource as `sort_order`, `show_on_create`, `is_required_on_create` and `include_in_subscriber_notifications`. `variable_key` is read-only: the key OneUptime made when the field was created.

Leave `sort_order` out and a new field goes to the end of the list. Give it the number another field already has and it takes that place, while the fields in the way move one place along. A number no other field has is kept as you wrote it.

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

Every incident gets a number from a per-project counter. Without a prefix it shows as `#42`; with one it shows as `INC-42`. If your team says "INC-42" out loud, make the product say it too. New projects start with `INC-` for incidents and `IE-` for incident episodes.

Go to **Incidents → Settings → Number Prefix** (`/dashboard/{projectId}/incidents/settings/number-prefix`). The **Number Prefix** card has a row for **Incidents** and one for **Incident Episodes**. Each shows its prefix and an example of the number it makes: `INC-`, then **Example:** `INC-42`. A project without a prefix shows **No prefix** and `#42`.

**Update** opens **Edit Number Prefix**, with two fields:

- **Incident Number Prefix** — placeholder `INC-`.
- **Incident Episode Number Prefix** — placeholder `IE-`.

Under each field, **Preview:** shows the number as you type, so you see `OPS-42` before you save `OPS-`. Leave a field empty to go back to `#`. A prefix:

- has up to 20 characters;
- uses letters (of any alphabet), digits and `-` `_` `.` `/` `:` `#` — no spaces, and nothing Markdown, Slack or HTML would read as formatting;
- does not end with a digit, which would run into the number: `SEV1` would make incident 42 `SEV142`.

The dialog says what is wrong before you save, and the API refuses the same prefixes. Spaces around a prefix are trimmed off.

**What a new prefix changes.** Only incidents and episodes created after you save get the new prefix. Each existing one keeps the number it was given: the prefixed value is stored on the incident as `incidentNumberWithPrefix`, which is what the incidents list, the incident header, notifications and the incident's Slack and Microsoft Teams channel names use. The counter carries on: if the last incident was `INC-41` and you switch to `OPS-`, the next one is `OPS-42`.

Project Owners, Project Admins and anyone with **Edit Project** can change the prefixes. Everyone else sees them with the **Update** button locked.

Alerts and scheduled maintenance events have the same page: **Alerts → Settings → Number Prefix** for alert and alert episode numbers (`ALT-` and `AE-` for new projects), and **Scheduled Maintenance → Settings → Number Prefix** for event numbers (`SM-`). In all three, the old **More Settings** address (`…/settings/more`) still works and opens **Number Prefix**.

## Linked alert switches

Linking alerts to an incident never changes their state on its own. Two project switches, on the **Linked Alerts** card of **Incidents → Settings → Linked Alerts** (`/dashboard/{projectId}/incidents/settings/linked-alerts`), let the incident move its linked alerts along with it:

- **Acknowledge Linked Alerts When Incident Is Acknowledged** — acknowledging the incident acknowledges every linked alert that is not acknowledged yet, which stops those alerts' on-call escalations.
- **Resolve Linked Alerts When Incident Is Resolved** — resolving the incident resolves every linked alert that is not resolved yet, except an alert that is still linked to another incident that is not resolved.

Both are on for new projects; a project created before they were on by default keeps the setting it had. Only Project Owners and Project Admins can change them, with the card's **Update** button. States are compared by their order, so custom states count; alerts never move backwards, reopening an incident does not reopen its alerts, and an alert linked to an incident that is already acknowledged or resolved is brought in line as it is linked. Turning a switch on hands the linked alerts' states to the incident: whoever can change an incident's state, or link an alert to an incident that is already acknowledged or resolved, moves the alerts too, without needing permission to edit alerts. [Linked Alerts](/docs/incidents/linked-alerts) has the full rules, including why resolving an alert whose monitor is still failing makes the monitor raise a fresh one.

## Rules that run when an incident is created

**Incidents → Rules** holds nine rule engines. They all do the same job — look at an incident the moment it is created, and act if it matches — but they differ in what they do and in how multiple matching rules resolve.

- **Grouping Rules** — group related incidents into episodes. Rules are evaluated from the top of the list down; drag a rule to change its place. Covered in detail below.
- **On-Call Rules** — execute on-call duty policies for matching incidents. Covered in detail below.
- **Owner Rules** — assign owners automatically.
- **Runbook Rules** — start a [runbook](/docs/runbooks/index) when an incident matches.
- **Auto Remediation Rules** — propose or start remediation runbooks when an incident matches. If an AI investigation is queued for the incident, they run once it finishes, with its analysis in hand. See [AI SRE](/docs/ai/ai-sre).
- **Privacy Rules** — decide whether a matching incident is private.
- **Label Rules** — apply labels automatically.
- **SLA Rules** — track response and resolution times. Rules are evaluated from the top of the list down; drag a rule to change its place.
- **Reminder Rules** — periodically remind incident owners while an incident is still open. Rules are evaluated from the top of the list down and the first matching rule wins; drag a rule to change its place.

**Order semantics are not uniform.** Grouping Rules, SLA Rules and Reminder Rules are order-evaluated, and their lists are put in order by dragging: a new rule is added to the end. On-Call Rules are not — every matching rule fires. Do not assume one model applies to all nine.

The **On-Call Rules**, **Owner Rules**, **Label Rules** and **Privacy Rules** pages are tabbed — an **Incident Rules** tab and an **Episode Rules** tab, each with its own table. Configure the **Incident Rules** tab unless you specifically mean episodes. **Grouping Rules**, **Runbook Rules**, **Auto Remediation Rules**, **SLA Rules** and **Reminder Rules** are single tables.

Owner, Label and Privacy Rules only act on incidents and episodes created after the rule exists. To apply one of them to incidents that are already there, use **Run Now** on the rule's row, on its own page, or from the table's bulk actions — see [Run Rules on Existing Resources](/docs/configuration/run-rules-now). On-Call, Runbook, Auto Remediation, Grouping, SLA and Reminder Rules cannot be run against existing incidents.

## Incident grouping rules

**Incidents → Rules → Grouping Rules** (`/dashboard/{projectId}/incidents/settings/grouping-rules`) puts related incidents into one episode. When a database goes down and 20 monitors open incidents within five minutes, a rule can put all 20 into one episode that your team acknowledges and resolves together. **Alerts → Rules → Grouping Rules** does the same for alerts.

**Start from a template.** A project with no grouping rules sees four ready-made rules in place of the empty list; once there are rules, **Create from Template** on the card opens the same four. **Add Rule** saves one in a single click — enabled, at the end of the list, and applying to every new incident. Edit it afterwards like any other rule.

| Template                                   | Groups                                                     | Time window |
| ------------------------------------------ | ---------------------------------------------------------- | ----------- |
| **Group incidents from the same monitor**  | One episode per monitor                                    | 30 minutes  |
| **Group incidents that happen together**   | One shared episode, whatever the monitor                   | 10 minutes  |
| **Group incidents by severity**            | One episode per severity                                   | 30 minutes  |
| **Group repeats of the same incident**     | One episode per incident title, numbers and case ignored   | 1 hour      |

**Or answer two questions.** **Create Custom Rule**, or the card's create button, opens a form that starts as a working rule:

- **Grouping** — **Group incidents by**: **Monitor**, **Everything Together**, **Severity**, **Title** or **Custom**. Custom adds a **Group By** step with the five switches underneath the answers (monitor, severity, incident title, incident labels and monitor labels; labels group by their exact set). **Only group incidents that arrive close together** is on by default: an incident joins an episode only if it arrives within the time window of the episode's previous incident. Turned off, matching incidents keep joining the open episode until it is resolved. **Name** follows the answer until you type your own, and **Enabled** is on.
- **Which Incidents** — conditions that narrow the rule down. Leave it empty to group every new incident.

**Show advanced settings** adds three steps: **Episode Lifecycle** (reopen recently resolved episodes, wait before resolving an episode, and resolve quiet episodes — each a switch with its minutes), **Details** (the rule's description, the episode title and description templates, showing episodes on status pages, and episode labels) and **On-Call & Ownership** (the on-call policies to run when the rule opens an episode, the default team and user, and episode role assignments). A rule that already uses any of them opens with them shown. The alert form has no status page or episode role settings.

The list's **Grouping** column says what each rule does — "One episode per monitor", "New incidents join while they arrive within 30 minutes of the last one" — with a note for each lifecycle setting that is on, for the on-call policies it runs and for showing episodes on status pages. **Match Criteria** shows which incidents it applies to, and **Status** whether it is on.

## Incident on-call rules

**Incidents → Rules → On-Call Rules** (`/dashboard/{projectId}/incidents/settings/on-call-rules`) is where you make paging automatic. The card, **Incident On-Call Rules**, describes rules that automatically execute on-call duty policies when matching incidents are created. The page has two tabs: **Incident Rules** and **Episode Rules**.

The create form has three steps:

- **Basic Info** — **Name** (the placeholder suggests something like paging the database team for any DB incident), **Description**, and an **Enabled** toggle. The list renders a green **Enabled** or red **Disabled** pill per rule.
- **Match Criteria** — the rule's **Conditions**. Each condition picks a criterion — **Monitors**, **Incident Severities**, **Incident Labels**, **Monitor Labels**, **Incident Title**, **Incident Description**, **Monitor Name** or **Monitor Description** — an operator and a value, and reads like a sentence: "If **Incident Title** contains `database`", "And **Monitor Labels** has any of _Production_".
- **On-Call Policies** — the policies this rule executes.

### How matching resolves

The rules the page ships with itself are worth internalizing:

- With two or more conditions you choose **Match all** (every condition must be true) or **Match any** (one is enough). A rule with no conditions matches every incident.
- A list criterion — **Monitors**, **Incident Severities**, **Incident Labels**, **Monitor Labels** — uses **Has any of**, **Has all of** or **Has none of** the values you pick.
- A text criterion — the incident's title and description, its monitors' names and descriptions — uses **Contains**, **Does not contain**, **Equals**, **Does not equal**, **Starts with** or **Ends with**, ignoring case, or **Matches pattern** / **Does not match pattern** for a case-insensitive regular expression or a `*` wildcard. A new text condition starts on **Contains**.
- **All matching rules fire.** There is no priority and no short-circuit.
- The set of policies that actually executes is the union of every matching rule's policies plus any policies attached to the incident manually or by a template, deduplicated so each policy runs at most once.

Severity is a match criterion here and nowhere else. There is no on-call field on an incident severity — selecting "Critical Incident" does not, by itself, page anyone. If you want severity to drive paging, write an on-call rule that matches on it.

## Attaching on-call policies directly

Rules are not the only route. Every incident carries an on-call policy list of its own, surfaced as the **On-Call Policy** field on the **On-Call** step of the declare wizard and on the **On-Call** step of an incident template. The field description says it plainly: these are the on-call duty policies to execute when this incident is created.

When an incident is created, OneUptime runs label rules, then on-call rules (which merge their matching policies into the incident's list), then runbook rules — and if the resulting list is non-empty, every policy in it is executed. Executions run in parallel and are settled independently, so one policy failing does not stop the others. Each execution is tagged with the incident that triggered it and with the incident-created notification event type.

To see what happened, open the incident and choose **On-Call Executions** in its side menu (`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`).

## Driving incidents from workflows

Workflow triggers for incidents are not hand-written — OneUptime generates them from the data models, so every incident-family model gets **On Create X**, **On Update X** and **On Delete X** components, named from the model's singular name. The headline three are **On Create Incident**, **On Update Incident** and **On Delete Incident**. You'll find them in the **Add Trigger** panel at `/dashboard/{projectId}/workflows`, under **OneUptime resources** → **Incident**; the first two are also under **Popular**.

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
- [Linked Alerts](/docs/incidents/linked-alerts) — linking alerts to incidents and what the linked alert switches do.
- [Forms](/docs/forms/index) — a link anyone can use to report an incident or request maintenance, without a OneUptime account.
- [Subscribers & Announcements](/docs/status-pages/subscribers) — who hears about an incident outside your team.
- [One Status Page per Audience](/docs/status-pages/one-status-page-per-audience) — limiting incidents to some of the status pages that list their monitors.
- [Workflows Overview](/docs/workflows/index) — automating on top of incident triggers.
- [Runbooks Overview](/docs/runbooks/index) — the procedures runbook rules attach.
