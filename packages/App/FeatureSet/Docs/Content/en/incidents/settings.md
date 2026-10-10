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
| **Incident Roles**       | Define the roles you assign responders to, such as Incident Commander.                       |
| **Measurements**         | Time how long things take, like time to acknowledge or time to resolve, on every incident.    |
| **Linked Alerts**        | Choose whether the alerts linked to an incident are acknowledged and resolved along with it. Both are on for new projects. |
| **Number Prefix**        | The text in front of incident and episode numbers, such as `INC-` in `INC-42`.               |

What OneUptime AI does on its own is not set here: it has a section of its own, **Incidents → AI**, at routes beginning `/dashboard/{projectId}/incidents/ai/`. Its **Settings** page switches investigating new incidents, fixing them automatically (off until you turn it on), with the fix and missing-telemetry pull requests that are part of fixing drawn under it, and drafting postmortems on or off, each saving as soon as you flip it; the investigation rules and auto remediation rules that narrow which incidents are investigated and fixed, and the optional limits AI works under, are folded under **More settings**, and none apply until you set them. **Insights** and **Logs** are next to it: what AI learned from your incidents, and everything it did. See [AI SRE](/docs/ai/ai-sre).

**Incident State** and **Incident Severity** are covered in depth on [Incident States & Severities](/docs/incidents/states-and-severities) — the rest of this page picks up from **Incident Templates**. Forms that let people outside your team report incidents are a product of their own: see [Forms](/docs/forms/index).

Expand **Rules** and you get eight more pages: **Grouping Rules**, **On-Call Rules**, **Owner Rules**, **Runbook Rules**, **Privacy Rules**, **Label Rules**, **SLA Rules** and **Reminder Rules**. Those are covered further down.

## Incident templates

An incident template is a saved skeleton of an incident. Instead of retyping the same title, the same monitor list and the same on-call policy every time the payments cluster wobbles, you save it once and declare from it.

Go to **Incidents → Settings → Incident Templates** (`/dashboard/{projectId}/incidents/settings/templates`). The card is titled **Incident Templates**. Creating one walks you through a four-step wizard, with two more steps when your project has incident custom fields. Only the first two ask for anything you have to answer: **Next** walks the optional steps after them, and **Create Incident Template** is on the last step.

- **Template Info** — **Template Name** and **Template Description**. These name the template itself; they never appear on the incident.
- **Incident Details** — **Title**, **Description** (Markdown) and **Incident Severity**. Under **More fields**, whose folded header names the three and shows each one that is set:
  - **Initial Incident State** — the state incidents declared from the template start in. It starts empty, as on the declare form, and its options are listed in state order. Left empty, as its placeholder says, they start in the usual starting state: the project's created state, the one every new incident starts in. A template saved with a state keeps it.
  - **Owners** — the people and teams who own incidents declared from the template. **Add owner** opens one list of both, the same list as an incident's **Owners** page; each pick shows as a chip you can remove. An existing template shows them on an **Owners** card.
  - **Labels** — the labels incidents declared from the template start with.
- **Resources Affected** — as on the declare form: **Monitors**, then **Change Monitor Status to**, then **Other Affected Resources** for the hosts, clusters and services, with **Limit to these status pages** under **More fields**. A template always asks for **Change Monitor Status to**, monitors picked or not: it also applies to the monitors picked when an incident is declared from the template, where the declare form shows it as soon as the first monitor is picked. An existing template's **Affected Resources** card asks the same way, and shows the status the template picks, or **Monitors keep their status.** when it picks none. **Limit to these status pages** limits incidents declared from the template to some of the status pages that list their monitors — a `Region East outage` template can carry the East site pages. An existing template shows it on a **Status Page Scope** card, with **Edit Status Page Scope**. See [One Status Page per Audience](/docs/status-pages/one-status-page-per-audience).
- **Custom Fields** — only when your project has incident custom fields: the values incidents declared from this template start with. Every field is offered here, not only the ones the **Details** step asks for, and none is required. An existing template has a **Custom Fields** card to change them.
- **Custom Fields on Create** — also only when your project has incident custom fields: which of them the **Details** step asks for when an incident is declared from this template, and which must be filled in. An existing template has a **Custom Fields on Create** card to change them. See [Custom fields on create](#custom-fields-on-create).
- **On-Call** — **On-Call Policy**, the policies to execute when an incident created from this template is declared.

A few quick rules:

- The template list shows only **Name** and **Description**. Rows are not editable or deletable from the list — open a template (`/dashboard/{projectId}/incidents/settings/templates/{modelId}`) to change it.
- Everyone who can edit a template can change its details and its affected resources, **Initial Incident State** and **Change Monitor Status to** included: Project Owners, Project Admins and Project Members, Incident Admins and Incident Members, and a role with **Edit Incident Template**.
- Templates support JSON import and export, so you can move one between projects.
- With no templates, the list says **No incident templates found** with **Create Incident Template** right under it.

### How a template gets applied

There are two paths, and they merge the same way.

- **In the dashboard** — the **Create from Template** button on the incidents list opens a **Select Incident Template** picker, and the declare page reads the template from the `incidentTemplateId` query string parameter, then pre-fills the form with the template plus its owner teams and owner users. Its **Details** step follows the template's [custom fields on create](#custom-fields-on-create). The owners become the incident's owners without being notified, once the incident's Slack and Microsoft Teams channels exist, so a notification rule that invites incident owners to a new channel invites them too.
- **On the server** — a [form](/docs/forms/on-submit#the-incident-template) that has an **Incident Template**, and a workflow's **Create One Incident** step with an **Incident Template** picked, declare the incident from the template on the server. The step reads the template as a Project Admin of the workflow's project, so a template from another project, or one that was deleted, is refused, and on a plan that doesn't include incident templates the step is refused with the plan it needs. The template's owners become the incident's owners, as they do on the dashboard. See [Declaring an incident from a template](/docs/workflows/components#declaring-an-incident-from-a-template).

An incident declared on the server records the template in `createdIncidentTemplateId`. Only OneUptime sets that column, for a form or a workflow step that names a template: an API key or a signed-in user cannot, and a request that sends `createdIncidentTemplateId` is refused. To declare from a template over the API, read it from `/api/incident-templates` and send its values in the request.

The important part is the merge rule: **a template only fills a field you left undefined**. Title, description, incident severity, initial incident state, the monitor status behind **Change Monitor Status to**, monitors, hosts, Kubernetes clusters, Docker hosts, Podman hosts, services, on-call policies, labels and status pages are copied from the template only when the caller or the form supplied nothing. Anything you set explicitly always wins, a state included: an incident that names its state starts in it and still takes everything else from the template, as on the dashboard. Custom field values merge one field at a time: the template fills in the fields the incident was declared without, and a value you set — `0`, `false` and `null` included — wins over the template's.

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

Go to **Incidents → Settings → Note Templates** (`/dashboard/{projectId}/incidents/settings/note-templates`). The card is titled **Public or Private Note Templates for Incidents** — one library serves both note types. The create form is one page:

- **Template Name** and **Template Description**, both required.
- The **Note** itself, in Markdown, required: the text a note starts with when the template is picked.

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

Note templates surface where you actually need them: the **Acknowledge Incident** and **Resolve Incident** confirmation dialogs both offer **Select Note Template** above the **Public Note** field, folded under **Add a public note**. See [Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed) for how public and private notes differ.

## Postmortem templates

A postmortem template is the skeleton of the write-up you produce after an incident — your headings, your prompts, your standing questions — so every review in the project follows the same shape.

Go to **Incidents → Settings → Postmortem Templates** (`/dashboard/{projectId}/incidents/settings/postmortem-templates`). The card is titled **Postmortem Templates**. The create form is one page:

- **Template Name** and **Template Description**, both required.
- **Postmortem Template**, the body itself, in Markdown, required.

You apply one from the incident, not from settings. Open an incident, choose **Postmortem** in its side menu (`/dashboard/{projectId}/incidents/{incidentId}/postmortem`), and use **Apply Template**. That opens an **Apply Postmortem Template** dialog with a **Select Template** dropdown; picking one loads the template body into the **Postmortem Note** editor, where you edit it before saving. Incident episodes have the same **Postmortem** page and draw on the same template library. **Apply Template** is shown only once the project has a postmortem template; with just one, it is already picked. The editor opens on the incident's postmortem as it stands, with the template as its note, so whether it is on the status page, when it was published and its attachments stay as they were.

## Custom fields

Custom fields let you carry your own metadata on every incident — an internal service name, a change ticket reference, a customer tier — and ask the same questions every time an incident is declared, such as its impact and when it is expected to be resolved.

Go to **Incidents → Settings → Custom Fields** (`/dashboard/{projectId}/incidents/settings/custom-fields`). The page is titled **Incident Custom Fields** and lists the fields in their **Order**, each by its **Field Name** and **Field Type** alone. **Edit** on a field's row opens the rest of its settings.

Creating a field asks for its **Field Name**, **Field Description** and **Field Type** on one page — and, for a dropdown type, its options, right under the type. A new field's values are typed in. Everything else is under **More fields**, which starts folded whether you create a field or edit one; folded, its header names what is in it and shows what is set. To make a field that copies its value from a monitor custom field instead, open the **More** menu (**⋯**) next to **Create Incident Custom Field** and choose **Create Mapped Custom Field** — see [Fields copied from a monitor](#fields-copied-from-a-monitor).

Each definition has:

- **Field Name** — required, at least two characters. The placeholder suggests a slug-like name such as `internal-service`.
- **Field Description** — optional.
- **Field Type** — required. This chooses how data is entered; the types are listed below. Dropdown types also need their options listed.
- **Dropdown Options** — the values that appear in the dropdown, each with an optional color: the small button beside an option shows its color and opens the same named colors as every other color field, with **No color** first and **Custom color** for an exact code. Drag an option by the handle at the start of its row to change where it is listed. Options can be added, renamed and taken out after incidents have values; see [Changing a dropdown's options](#changing-a-dropdowns-options).
- **Order** — where the field appears among the incident's custom fields: on the incident's **Custom Fields** page, in the **Details** step and in subscriber messages. There is no number to type in: drag a field by the handle at the start of its row to move it up or down, and a new field is added to the end. Dragging is off while a filter or search narrows the list.
- **Show on Create** — under **More fields**. Asks for the field in the **Details** step when an incident is declared from the dashboard (see [Declaring Incidents](/docs/incidents/declaring-incidents)). An incident template can give any field a starting value, shown on create or not, and can ask for a field or leave it out for the incidents declared from it — see [Custom fields on create](#custom-fields-on-create). [Forms](/docs/forms/building#custom-fields) do not follow it: a form asks only the fields added to it.
- **Required on Create** — under **More fields**, offered once **Show on Create** is on. The **Details** step does not let you declare the incident until the field is filled in, and a **Boolean** field must be switched on. The dashboard is the only place this is checked; see [Required on Create is checked by the dashboard only](#required-on-create-is-checked-by-the-dashboard-only).
- **Include in Subscriber Notifications** — under **More fields**. Sends the field and its value to status page subscribers with the incident's messages: the default email, Slack and Microsoft Teams messages and webhooks, but not SMS. Subscribers are usually outside your team, so only turn it on for fields that are safe to share. See [Incident custom fields in notifications](/docs/status-pages/subscribers#incident-custom-fields-in-notifications).
- **Template Variable** — the key a template reaches the field by, `{{incident.customFields.<key>}}`, in note templates and custom subscriber notification templates. It is made from the field's name when the field is created — lowercase letters, digits and underscores, so `Expected Resolution` becomes `expected_resolution`, with `_2`, `_3` and so on added when another field already has the key — and it does not change when the field is renamed. Nobody sets it by hand: the API ignores a value sent for it. Templates written with the older `{{customFields.<key>}}` keep working. You never need to look it up: the editors that place it — a note template's **Note** and a status page's custom subscriber notification templates for incident events — list every field's variable under **Template variables**, by the field's name. A field's **Edit** form also shows it, read only, at the bottom of **More fields**, with a button that copies it.

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

### Fields copied from a monitor

A custom field can take its value from a custom field of the incident's monitors instead of having it typed in — a region or a customer tier your monitors already record, say. To make one, open the **More** menu (**⋯**) next to **Create Incident Custom Field** and choose **Create Mapped Custom Field**. It asks for three things:

- **Monitor Field** — the monitor custom field to copy. Every one is offered, each with its type under its name. The new field gets that type, and a dropdown's options, so the two always match.
- **Field Name** — starts as the monitor field's name, until you type another.
- **Field Description** — optional.

The value is filled in when an incident is created with a monitor, and kept up to date when the monitor's value changes. When an incident's monitors hold different values, a single-value field is left as it is and a multi-select field gets all of them. Copying never clears a value: an incident without a monitor keeps whatever is typed on it, and clearing the monitor's value leaves the copies alone. The **Details** step does not ask for a copied field once the incident has a monitor.

To copy an existing field's value from a monitor, change which monitor field it copies, or go back to typing it in, open **Edit** on the field's row and use **Map Value From** under **More fields**. Alert and scheduled maintenance custom fields can copy from their monitors the same way.

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

An incident that a form or a workflow's **Create One Incident** step declares from a template (`createdIncidentTemplateId`) starts with the template's custom field values, merged one field at a time under the ones it sends (see [How a template gets applied](#how-a-template-gets-applied)). An API key cannot declare from a template: a request that sends `createdIncidentTemplateId` is refused.

### Renaming a field

Values are stored under the field's name, so renaming a field has to move them. When you save a new **Field Name**, OneUptime moves the field's value to the new name on every incident and every incident template in the project, and updates the saved views of the incidents list that show or filter by the field. The move starts no **On Update Incident** workflow, and it does not change any incident's last-updated time. The field's **Template Variable** stays as it was, so note templates, custom subscriber notification templates and webhook integrations that use it keep working.

Two renames are refused: one onto a name another incident custom field already has (compared without regard to case), and an API request that would rename several fields at once. Workflows and API clients that read or write a value by the field's old name need to be changed to the new one.

After a rename the field holds only its own values. Deleting a field leaves its values on the incidents that had them, so incidents can still hold values under the new name from a field that was deleted; the rename clears those, rather than show them as this field's answers or send them to subscribers. Every incident and template moves together: if the move fails, none of them changes, the field keeps its old name and the save reports an error, so you can simply try again. A field **created** with a deleted field's name is different: it shows the values that field left behind, and sends them to subscribers once **Include in Subscriber Notifications** is on.

Deleting a field leaves the questions that ask for it on every [form](/docs/forms/building#custom-fields) in the project, but they are no longer asked: the form builder marks each one for you to delete. A field created again with the same name is a new field, and is not asked on a form until someone adds it there. Incident templates keep their **Custom Fields on Create** setting for it.

### Changing a dropdown's options

A **Dropdown (single select)** or **Dropdown (multi-select)** field's options can be changed at any time: open **Edit** on the field's row. An incident stores the text of the option it was given, so what a change does to the incidents that have an option depends on the change:

| What you do to an option            | What happens to the incidents that have it                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Add** one                         | Nothing. It is offered from now on.                                                                                |
| **Rename** it (change its text)     | They show the new name. Under the option, the form says how many incidents will.                                   |
| **Take it out** (the bin beside it) | They keep it, shown as _no longer an option_, unless you pick another option for them under **No longer options**. |
| **Drag** it by its handle           | Nothing. Only the order the options are listed in changes.                                                         |

When the form opens it counts how many incidents have each value. **No longer options** lists every option you take out that an incident still has, and every value incidents have that was never an option (one written through the API, say), each with how many incidents have it. For each one, keep it as it is or pick the option those incidents should have instead. **Undo** puts back an option you took out by mistake.

When you save, a renamed option and a value you pick an option for are moved: on every incident and incident template in the project, in the saved views of the incidents list that filter by it, and in the answers [form templates](/docs/forms/building) give for the field. Like a renamed field, the move starts no **On Update Incident** workflow and changes no incident's last-updated time; if it fails, nothing moves and the field keeps its old options. Workflows, API clients and Terraform configurations that write an option by its old text need the new text.

An incident whose value its field no longer offers shows the value, marked _no longer an option_, on its **Custom Fields** page and in the incidents list. Editing its other fields keeps it; pick another option to change it.

The custom fields of every other resource work the same way: monitors, alerts, scheduled maintenance events, status pages, on-call policies, teams, team members and inventory items. Renaming an option of a monitor field, or adding one, does the same to the incident, alert and scheduled maintenance fields that copy it (see [Fields copied from a monitor](#fields-copied-from-a-monitor)), so they keep offering every value they copy.

Through the API, send the new list as `dropdownOptions`, and the renames in `miscDataProps`:

```json
{
  "data": { "dropdownOptions": "Facility Alpha\nFacility B" },
  "miscDataProps": {
    "renamedDropdownOptions": [{ "from": "Facility A", "to": "Facility Alpha" }]
  }
}
```

Each `to` must be one of the field's options once it is saved, and each `from` can be renamed only once. Without `renamedDropdownOptions` the list changes and every stored value stays as it is, which is also what changing `dropdown_options` in Terraform does.

### Terraform

The settings are on the `oneuptime_incident_custom_field` resource as `sort_order`, `show_on_create`, `is_required_on_create` and `include_in_subscriber_notifications`. `variable_key` is read-only: the key OneUptime made when the field was created.

Leave `sort_order` out and a new field goes to the end of the list. Give it the number another field already has and it takes that place, while the fields in the way move one place along. A number no other field has is kept as you wrote it.

## Measurements

A measurement is the time between two moments in an incident. **Time to acknowledge** is the time from when an incident is declared until someone acknowledges it; **time to resolve** runs from when it is declared until it is resolved. You set a measurement up once, and OneUptime works it out for every incident, past incidents included, and charts it, so you can see whether your team is getting faster.

Go to **Incidents → Settings → Measurements** (`/dashboard/{projectId}/incidents/settings/measurements`) and choose **Create Incident Measurement**. Each definition has a **name**, a **starting point** and an **ending point**. Its permanent **key** is made from the name as you type it — "Time to Detect" gets `time-to-detect` — so there is nothing to fill in. To pick a key of your own, choose **Edit** next to it before you create the measurement.

Alerts and scheduled maintenance events have the same feature, at **Alerts → Settings → Measurements** and **Scheduled Maintenance → Settings → Measurements**. Everything below applies to all three, with each one's own moments.

### Ready-made measurements

The form opens on **What do you want to measure?**. Pick one of these and its name, description and both moments are filled in: **Next** shows the moments, and the measurement is created from that last step.

| Where                 | Measurement              | Starts when                           | Ends when                         |
| --------------------- | ------------------------ | ------------------------------------- | --------------------------------- |
| Incidents             | **Time to acknowledge**  | The incident is declared              | The incident is acknowledged      |
| Incidents             | **Time to resolve**      | The incident is declared              | The incident is resolved          |
| Incidents             | **Time to postmortem**   | The incident is resolved              | The postmortem is published       |
| Alerts                | **Time to acknowledge**  | The alert is created                  | The alert is acknowledged         |
| Alerts                | **Time to resolve**      | The alert is created                  | The alert is resolved             |
| Scheduled maintenance | **Start delay**          | The maintenance is scheduled to start | The maintenance starts            |
| Scheduled maintenance | **Overrun**              | The maintenance is scheduled to end   | The maintenance ends              |
| Scheduled maintenance | **Maintenance duration** | The maintenance starts                | The maintenance ends              |

Choose **Something else** to pick the two moments yourself. A name you typed is kept when you pick one of these.

### Choosing the two moments

The second step, **Start and End**, has **Starts when** and **Ends when**. Each lists the moments a measurement can start or end at, in plain words. A new measurement starts when the incident is declared, so most of the time you only pick where it ends.

| Moment                                  | When it happens                                                              | Stored in the API as                                  |
| --------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| **The incident is declared**            | When the incident started in OneUptime: when it was created, unless someone set an earlier time. | `Declared At` (`Timeline Start` is the same instant)  |
| **The incident is acknowledged**        | When it reaches your acknowledged state, or any state after it (a resolve straight from the start counts too). | `State Role Entered`, role `Acknowledged`             |
| **The incident is resolved**            | When it reaches your resolved state.                                         | `State Role Entered`, role `Resolved`                 |
| **The postmortem is published**         | When the incident's postmortem is published.                                 | `Postmortem Posted At`                                |
| **The incident enters a state you pick** | Any of your incident states. The form then asks which one.                  | `State Entered`, with the state                       |
| **Impact starts**                       | When customers were first affected — see below.                              | `Impact Started At`                                   |
| **The incident enters its first state** | When it reaches the state new incidents start in, such as Identified.        | `State Role Entered`, role `Created`                  |
| **The incident is created in OneUptime** | Usually the same moment it is declared.                                     | `Created At`                                          |

Alerts start from **The alert is created** and have no postmortem; scheduled maintenance adds **The maintenance is scheduled to start** and **to end**, the planned window, next to **The maintenance starts**, **ends** and **is completed**.

Reaching **acknowledged** or **resolved** follows whichever state plays that part, so it keeps working if you rename or replace the state. **A state you pick** is pinned to that one state.

### More fields

A few options most measurements never change are folded under **More fields** at the end of the **Start and End** step, set to the defaults the API uses too. Folded, its header names them and shows the ones that are changed.

- **If the start happens more than once** and **If the end happens more than once** appear for a moment that reaches a state. A reopened incident can reach the same state again. **Use the first time** is the default and matches the built-in incident timings; **Use the last time** follows a reopened incident to its final pass.
- **Show durations in** is the unit the measurement's charts use. **Automatic** is the default: it charts seconds, which charts show as seconds, minutes, hours or days as the numbers grow. **Minutes**, **Hours** or **Days** keep a chart in one unit. Every point is written in the unit you pick, and changing it rewrites the measurement's points in the new one.
- **Chart summary** is how **View Chart** sums up many incidents: **Average** by default, or **Median**, the 90th, 95th or 99th percentile, **Longest** or **Shortest**.
- **Show on incident pages** puts the measurement in the **Measurements** card on each incident's page (see below). It is on by default; turn it off for a measurement you only want to chart. Alerts and scheduled maintenance call it **Show on alert pages** and **Show on maintenance event pages**.

Editing a measurement adds an **Enabled** switch: turn it off to stop measuring incidents. The numbers already recorded are kept.

### What a measurement reports

| Status             | Meaning                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------- |
| **Recorded**       | Both moments happened. The duration is on the incident and charted.                       |
| **Pending**        | A moment has not happened yet, but still can — the incident is still open.               |
| **Not Applicable** | A moment can never happen — the state was skipped, or the time was never recorded.        |
| **Invalid**        | Both moments happened, but the end is before the start. Your recorded times disagree.     |

Only **Recorded** values become chart points. A skipped moment writes nothing rather than a zero, so it cannot drag an average towards it.

**Invalid** is the status worth watching. It is what a measurement says when the timeline it was worked out from is wrong — for example an end 17 minutes before its start. That is deliberately louder than a plausible-looking number nobody questions.

### On each incident's page

Each incident's page shows its own measurements in a **Measurements** card, right under **Incident Details**, in the order of the list on this settings page. Each one says what it measures — **Declared → Acknowledged** — and what it reads for this incident:

| It reads                      | When                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A duration, like **4 minutes** | Both moments happened (**Recorded**). It is in the measurement's unit: **Automatic** reads like the page's other timings, **1 hour, 5 minutes**, and **Hours** reads **1.5 hours**. |
| **Running for 12 minutes**    | The clock has started and the end has not happened yet. It counts up while the page is open.                                    |
| **Not started yet**           | The start has not happened yet, or is a time still ahead, like a maintenance event's scheduled start.                           |
| **Not reached**               | The incident is resolved, and the moment the measurement waited for never came — an incident resolved without being acknowledged. |
| **Not measured**              | A moment can never happen (**Not Applicable**), with the reason, like a skipped state.                                          |
| **Ends before it starts**     | The recorded times disagree (**Invalid**), with how far apart they are.                                                         |
| **Not worked out yet**        | OneUptime has not worked it out for this incident yet, as just after the measurement was created. |

A measurement whose start or end you change keeps showing its old value on each incident until OneUptime has worked it out again, as its chart does. Right after a state change from the incident's header, the card reads the new values as soon as OneUptime has worked them out, usually at once.

Alerts and scheduled maintenance events have the same card on their pages. For a maintenance event, **Not reached** comes once the event has ended. The card is left out when no enabled measurement has **Show on incident pages** on, and for someone who may not read measurements.

### Impact Started At, and why it is blank

**Impact Started At** is a field on the incident, and on the alert. It is blank by default and OneUptime never fills it in. It is recorded by an incident form that asks when impact started (see [Forms](/docs/forms/index)), or through the API. Until it is recorded, a measurement that starts or ends at **Impact starts** has no number for that incident.

That is the point. `Declared At` records when OneUptime found out, which for a monitor-triggered incident is when the criteria were processed — not when impact began. If "Time to Detect" defaulted its start to the same timestamp its end uses, every incident would report zero and the chart would read "we detect instantly". A blank field and a **Not Applicable** measurement say the true thing: nobody has recorded when this started.

### Correcting a wrong timestamp

Every measurement is worked out again from scratch whenever the data underneath it changes — a state timeline entry created, edited or deleted, or `Impact Started At`, `Declared At` or `Postmortem Posted At` corrected on the incident. Nothing is patched incrementally, so there is no stale value to repair.

The **Starts At** field on a state timeline entry is editable. If an incident was acknowledged at 09:12 but the entry says 09:29, correct the entry and every measurement derived from it moves with it.

### Charts, API and Terraform

Choose **View Chart** on a measurement to open its chart in the metric explorer, over the past month, summed up its way. Each enabled measurement writes a metric named `oneuptime.incident.measurement.<key>`, which you can also add to any dashboard. Alerts use `oneuptime.alert.measurement.<key>` and scheduled maintenance uses `oneuptime.scheduled-maintenance.measurement.<key>`. The list's **Key** column, hidden by default, shows each measurement's key.

Definitions are ordinary API resources, so the Terraform provider manages them as `oneuptime_incident_measurement`, `oneuptime_alert_measurement` and `oneuptime_scheduled_maintenance_measurement`. Computed values are read-only and surface as data sources. Left out, the options under **More fields** take the same defaults as in the dashboard: `unit` is `seconds` (or `minutes`, `hours`, `days`), `aggregation_type` is `Avg` (or `P50`, `P90`, `P95`, `P99`, `Max`, `Min`), and `start_state_occurrence` and `end_state_occurrence` are `First` (or `Last`). `show_on_incident_view` (`show_on_alert_view`, `show_on_scheduled_maintenance_view`) is `true`.

The **key** is permanent because it is part of the metric name — changing it would orphan the series. Rename the measurement freely; the key stays.

Over the API and in Terraform the key can be left out too: it is made from the name, with `-2`, `-3` and so on added when another measurement of the project already has it. A key you do send is kept as you wrote it. It must be lowercase letters, numbers and hyphens, starting with a letter or a number, at most 50 characters, and no other measurement of the project may have it.

### Migrating from another incident platform

If you are coming from a tool with declarative measurement definitions, these map across directly:

| Their measurement       | Set it up here as                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| Time to Detect          | **Something else**: **Impact starts** → **The incident is declared**                                |
| Time to Acknowledge     | The ready-made **Time to acknowledge**                                                              |
| Time to Mitigate        | **Something else**: **The incident is declared** → **The incident enters a state you pick**, a **Mitigated** state you add between Acknowledged and Resolved |
| Time to Resolve         | The ready-made **Time to resolve**                                                                  |

Time to Mitigate needs a state that does not exist by default. Add it on **Incidents → Settings → Incident State** — a new state is added just above the resolved state, and you can drag it anywhere between the others.

**One thing to know about history.** A measurement you create today is worked out for past incidents too, in the background: the value on each incident and its point on the chart. Changing where a measurement starts or ends, or its unit, works it out again for every incident. To keep the old numbers, create a new measurement instead.

## Incident roles

Incident roles are the named jobs you assign people to during a response. Define them at **Incidents → Settings → Incident Roles** (`/dashboard/{projectId}/incidents/settings/roles`). The table lists each role's name and description.

A new project starts with one role, **Incident Commander**, the person in charge of the response. OneUptime fills it for you: when you declare an incident from the dashboard without picking anyone for the role, you become its Incident Commander, and an incident that still has none gets the first person who changes its state, unless they already hold another role on it. Incident Commander can be renamed, but not deleted, and it is always held by one person. Its **Delete** is locked, and says why.

Add the other roles your team uses, such as Responder, Communications Lead or Scribe, with **Create Incident Role**. The form is one page: a name and a description, then **More fields**, folded, with **Allow Multiple Users**, the role's icon and its colour. A new role's colour is already picked, one the roles in the list don't use yet, and the icon is optional, so you only open **More fields** to change them. A role is held by one person per incident unless you turn on **Allow Multiple Users**. Projects created by earlier versions of OneUptime also started with Responder, Communications Lead and Observer. They keep them until you delete them.

Roles are definitions only. You assign people to them per incident — the declare wizard asks on its **On-Call & Roles** step, with an **Assign Incident Roles** field, and each incident has a **Roles** page in its side menu. A monitor's criteria and an incident grouping rule can pick people for them ahead of time. Every one of these forms asks with the same cards, one per role: a role tagged **Primary** is Incident Commander or another primary role, and a role that takes one person drops its picker once it has one. On an incident's **Roles** card, a role that takes several people offers **Add More**.

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

Both are on for new projects; a project created before they were on by default keeps the setting it had. Each is a switch that saves as soon as you flip it. Only Project Owners and Project Admins can change them; for everyone else the switches are locked and say which permission they need. States are compared by their order, so custom states count; alerts never move backwards, reopening an incident does not reopen its alerts, and an alert linked to an incident that is already acknowledged or resolved is brought in line as it is linked. Turning a switch on hands the linked alerts' states to the incident: whoever can change an incident's state, or link an alert to an incident that is already acknowledged or resolved, moves the alerts too, without needing permission to edit alerts. [Linked Alerts](/docs/incidents/linked-alerts) has the full rules, including why resolving an alert whose monitor is still failing makes the monitor raise a fresh one.

## Rules that run when an incident is created

**Incidents → Rules** holds eight rule engines, and **Incidents → AI → Settings** two more, under **More settings**: **Auto Remediation Rules** and **Investigation Rules**. They all do the same job — look at an incident the moment it is created, and act if it matches — but they differ in what they do and in how multiple matching rules resolve.

- **Grouping Rules** — group related incidents into episodes. Rules are evaluated from the top of the list down; drag a rule to change its place. Covered in detail below.
- **On-Call Rules** — execute on-call duty policies for matching incidents. Covered in detail below.
- **Owner Rules** — assign owners automatically.
- **Runbook Rules** — start a [runbook](/docs/runbooks/index) when an incident matches.
- **Auto Remediation Rules**, under **AI** → **Settings** — which new incidents are fixed while **Fix new incidents automatically** is on, and how: by OneUptime AI or with the rule's runbooks, asking before fixing or not. With no rule, every new incident is fixed. If an AI investigation is queued for the incident, they run once it finishes, with its analysis in hand.
- **Investigation Rules**, under **AI** → **Settings** — which new incidents OneUptime AI investigates. With no rule, every one is. See [AI SRE](/docs/ai/ai-sre).
- **Privacy Rules** — decide whether a matching incident is private.
- **Label Rules** — apply labels automatically.
- **SLA Rules** — track response and resolution times. Rules are evaluated from the top of the list down; drag a rule to change its place.
- **Reminder Rules** — periodically remind incident owners while an incident is still open. Rules are evaluated from the top of the list down and the first matching rule wins; drag a rule to change its place. An incident's rule is matched again, and the wait for its next reminder starts over, when its severity or labels change or its **Send reminders** switch is flipped. Saving the severity and labels it already has — every save of the **Incident Details** card sends them — leaves its next reminder where it was. Alerts work the same way.

**Order semantics are not uniform.** Grouping Rules, SLA Rules and Reminder Rules are order-evaluated, and their lists are put in order by dragging: a new rule is added to the end. On-Call Rules are not — every matching rule fires. Do not assume one model applies to all ten.

The **On-Call Rules**, **Owner Rules**, **Label Rules** and **Privacy Rules** pages are tabbed — an **Incident Rules** tab and an **Episode Rules** tab, each with its own table. Configure the **Incident Rules** tab unless you specifically mean episodes. **Grouping Rules**, **Runbook Rules**, **Auto Remediation Rules**, **Investigation Rules**, **SLA Rules** and **Reminder Rules** are single tables.

Owner, Label and Privacy Rules only act on incidents and episodes created after the rule exists. To apply one of them to incidents that are already there, use **Run Now** on the rule's row, on its own page, or from the table's bulk actions — see [Run Rules on Existing Resources](/docs/configuration/run-rules-now). On-Call, Runbook, Auto Remediation, Investigation, Grouping, SLA and Reminder Rules cannot be run against existing incidents.

**A new rule starts on.** Creating a rule does not ask whether it should be enabled: it starts enabled, exactly as one created through the API or Terraform does, and every other switch on the form starts the way the API would store it — **Notify Owners** on an owner rule is on, for example. To pause a rule without deleting it, switch **Enabled** off on its edit form; the list shows a green **Enabled** or red **Disabled** pill for each rule. Grouping rules are the exception: their create form shows the **Enabled** switch, already on.

**A rule names only your project's records.** The monitors, labels, severities, on-call policies, roles and teams a rule picks are your project's, and the people are its members — the form's pickers offer nothing else. Rules saved through the API, Terraform or a workflow are held to the same: a rule that names a record from another project, a record that does not exist, or someone who is not a member of the project is refused, and the error names the field and the id. Editing a rule checks only what the edit adds, so a rule that names someone who has since left the project can still be saved. When a rule runs, it adds only your project's own teams as owners and pages only your project's own on-call policies.

## Incident label and owner rules

**Incidents → Rules → Label Rules** attaches labels to new incidents that match, and **Owner Rules** adds owner users and teams to them. **Alerts → Rules** and **Scheduled Maintenance → Rules** have the same two pages and work the same way. Creating a rule takes two steps: **Match**, the conditions an incident must meet, then **Labels** (or **Owners**), what the rule adds. Its **Name** is filled in from what you pick until you type a name of your own, and the optional **Description** (and an owner rule's **Notify Owners**) waits under **More fields**.

**A rule can inherit.** Under **Labels to Add** (or **Owners**), the folded **Inherit Labels** (or **Inherit Owners**) section holds six switches that also hand on the labels (or owners) of the incident's monitors, hosts, Kubernetes clusters, Docker hosts, Podman hosts and services. A rule that inherits can leave **Labels to Add** empty, and is then named after what it inherits from (_Inherit labels from monitors, hosts_); a new rule that neither names nor inherits anything cannot be saved — from the form, the API or Terraform. Episode rules, on the **Episode Rules** tab, have no inherit switches.

**Older rules that add nothing** — saved before OneUptime asked what they add — can still be renamed, switched off or deleted, and the list marks each one **Adds nothing**. [Label and Owner Rules](/docs/configuration/label-and-owner-rules) covers the form step by step.

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

Everything else a rule can do is folded under **More fields**, at the end of the **Grouping** step, in three groups: **On-Call & Ownership** (the on-call policies to run when the rule opens an episode, **Episode Owners**, and episode role assignments), **Episode Lifecycle** (reopen recently resolved episodes, wait before resolving an episode, and resolve quiet episodes — each a switch with its minutes) and **Details** (the rule's description, the episode title and description templates, showing episodes on status pages, and episode labels). Folded, its header names what it holds, and each setting a rule uses is a chip that says what it is set to — "On-Call Duty Policies: 2", "Reopen recently resolved episodes: 30 minutes" — so editing a rule never hides what it does. Opening it adds no step: **Create Incident Grouping Rule** is on **Which Incidents**, the last step. The alert form has no status page or episode role settings.

The list's **Grouping** column says what each rule does — "One episode per monitor", "New incidents join while they arrive within 30 minutes of the last one" — with a note for each lifecycle setting that is on, for the on-call policies it runs and for showing episodes on status pages. **Match Criteria** shows which incidents it applies to, and **Status** whether it is on.

**Episode Owners** is one picker for people and teams, opened with **Add owner**. Each one you pick becomes an owner of every episode the rule opens: listed on the episode's **Owners** page and notified like any other owner. Only your project's teams and members can be picked, and the API refuses a rule that names a team from another project or someone who is not a member. Someone who leaves the project later is skipped, and someone whose invitation is still pending becomes an owner of the episodes opened after they join. Owners apply to episodes the rule opens after you save; episodes it opened before keep the owners they have.

Rules saved before the form asked for owners may still have a default team and user, which the form used to ask for as Default Assign To Team and Default Assign To User. Nothing in OneUptime showed that default assignee, so it made no one responsible. Editing such a rule says so on the folded **More fields** header — a **Default assignee** chip, and a sentence under it asking you to settle it — and opening the fold shows a **Default assignee** line under **Episode Owners** that names them: **Add as owners** makes them owners of the episodes the rule opens from then on, and **Remove** drops the old setting. Either takes effect when you save. Until someone does, the rule keeps it: the API still returns it as `defaultAssignToUser` and `defaultAssignToTeam`, and each new episode still carries it as `assignedToUser` and `assignedToTeam` while it names a member and one of your project's teams, but it does not make anyone an owner or send anyone a notification.

## Incident on-call rules

**Incidents → Rules → On-Call Rules** (`/dashboard/{projectId}/incidents/settings/on-call-rules`) is where you make paging automatic. The card, **Incident On-Call Rules**, describes rules that automatically execute on-call duty policies when matching incidents are created. The page has two tabs: **Incident Rules** and **Episode Rules**.

The create form has three steps:

- **Basic Info** — **Name** (the placeholder suggests something like paging the database team for any DB incident) and **Description**. The rule starts enabled; its edit form adds the **Enabled** switch, and the list renders a green **Enabled** or red **Disabled** pill per rule.
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

Rules are not the only route. Every incident carries an on-call policy list of its own, surfaced as the **On-Call Policy** field on the **On-Call & Roles** step of the declare wizard and on the **On-Call** step of an incident template. The field description says it plainly: these are the on-call duty policies to execute when this incident is created.

When an incident is created, OneUptime runs label rules, then on-call rules (which merge their matching policies into the incident's list), then runbook rules — and if the resulting list is non-empty, every policy in it is executed. Executions run in parallel and are settled independently, so one policy failing does not stop the others. Each execution is tagged with the incident that triggered it and with the incident-created notification event type.

To see what happened, open the incident and choose **On-Call Executions** in its side menu (`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`).

## Driving incidents from workflows

Workflow triggers for incidents are not hand-written — OneUptime generates them from the data models, so every incident-family model gets **On Create X**, **On Update X** and **On Delete X** components, named from the model's singular name. The headline three are **On Create Incident**, **On Update Incident** and **On Delete Incident**. You'll find them in the **Add Trigger** panel at `/dashboard/{projectId}/workflows`, under **OneUptime resources** → **Incident**; the first two are also under **Popular**.

The same generation gives you triggers for the configuration itself: **On Create Incident State**, **On Update Incident Severity**, **On Create Incident Template**, **On Create Incident Note Template**, **On Create Incident State Timeline**, **On Create Incident Public Note**, **On Create Incident Internal Note**, **On Create Incident On-Call Rule**, **On Create Incident Role**, **On Create Incident Member** and more. Each model also gets matching action components — **Find One Incident**, **Create One Incident**, **Update One Incident**, **Delete One Incident** and their many-row equivalents — so a trigger and an action with similar names sit side by side in the same category. **On Create Incident** starts a workflow; **Create One Incident** opens one.

A few details that matter when you wire these up:

- **On Update X** takes an optional **Listen on** argument that narrows the trigger to updates that change specific fields, whatever they change to: a switch turned off or a field cleared counts too. A field saved with the value it already has is not a change, so an edit form that sends it back with every save does not wake the workflow. Leave it blank to fire on any change. If an update arrives without a record of which fields changed, the filter is skipped and the workflow runs anyway.
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
