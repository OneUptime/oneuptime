# What a Submission Creates

Every submission through a form creates one record in your project: an **incident** or a **scheduled maintenance event**. A form's **On Submit** page shows which, and how each field of the new record is filled in — from an answer, from a default, from a setting that always applies, or from the incident template. **Edit Settings** changes the defaults and what always applies.

## What each submission creates

The **What Each Submission Creates** card holds the choice you made when you created the form:

- **Incident** — each submission declares an incident, so your on-call team is told straight away. Use it for problem reports.
- **Scheduled Maintenance** — each submission schedules a maintenance event. Use it for change and maintenance requests.

Choosing the other one asks you to confirm, because the form changes with it:

- The title, description, monitors and labels stay linked: both kinds of record have them.
- Every other linked question — a severity, a status page choice, a custom field of the old kind — becomes a question of the form's own, with the same wording, whose answer is listed on the private note.
- The On Submit settings start over, since an incident's and an event's settings are different.
- A form that now creates maintenance events asks when the maintenance starts and ends.

The questions are saved at once, together with the change. Check them on the **Build** page.

## How a submission becomes an incident

The card lists every field of the new incident and where its value comes from:

| Field                 | Comes from                                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Title**             | The answer to the **Title** question. When the form does not ask it, or it is left empty: the **Default Title**, or else the form's name.                                                      |
| **Description**       | The answer to the **Description** question. When it is not asked or left empty, the incident template's description, if the form has a template.                                              |
| **Severity**          | The submitter's choice, when the form asks for it. Otherwise the form's **Severity** setting, or else the incident template's severity.                                                       |
| **Monitors**          | The monitors the submitter chose, together with the ones the settings always attach. With neither, the incident template's.                                                                   |
| **Labels**            | The labels the submitter chose, together with the ones the settings always add. With neither, the incident template's.                                                                       |
| **Impact Started At** | The answer to **Impact Started At**, when the form asks it.                                                                                                                                  |
| **Incident Template** | The form's **Incident Template** setting. It fills in whatever the answers and the settings leave unset.                                                                                     |
| **On-Call Policies**  | The policies the settings name, executed for every incident the form declares. With none, the incident template's.                                                                           |
| **Owners**            | The people and teams the settings name, together with the template's owners. They are told about every incident.                                                                           |
| **Custom Fields**     | Each custom field question's answer — unless the field copies its value from a monitor custom field and the incident's monitors hold one; the template fills in the rest.                     |
| **Status Pages**      | Never shown on status pages, and subscribers are not told, until someone on your team publishes it.                                                                                          |
| **Other Answers**     | Listed on a private note on the incident, with who submitted it.                                                                                                                             |

**No severity, no incident.** An incident needs a severity. When the form does not ask for one and its settings name none — or the one they named was deleted — and its template sets none either, the **Severity** row warns you, and every submission is refused with "This form cannot create an incident because it has no severity. Please let the team that shared it know." Choose a severity in **Edit Settings**, or a template that sets one.

### The incident template

Pick an **Incident Template** in the settings and every incident the form declares is declared from it, the way the server applies a template anywhere — see [How a template gets applied](/docs/incidents/settings#how-a-template-gets-applied). The answers and the form's settings come first, and the template fills in everything else: the initial state, the description, the severity, the affected resources, on-call policies, owners, labels, custom field values and a monitor status change.

**Mind the monitors.** Declaring an incident on a monitor through a form affects the monitor exactly as declaring an incident on it by hand does: active monitoring on the monitor pauses until the incident is resolved, and a template's **Change Monitor Status to** changes the monitor's status at once — on every status page that lists the monitor, even while the incident itself is hidden. With a form, anybody who has the link can do this. Attach monitors through a form only when every submission should pause them.

### What the incident looks like

An incident declared through a form is an ordinary incident, with a few settings of its own:

- **Hidden from status pages.** **Visible on Status Page** is off, and so is **Notify Status Page Subscribers**. Until a responder publishes it, nothing about the incident reaches a status page or a subscriber — apart from a template's monitor status change, above.
- **Declared by nobody.** The submitter is not a OneUptime user, so no user is recorded as having declared the incident.
- **Its owners are told.** The owners the settings and the template name are added once the incident's Slack and Microsoft Teams channels exist, and are notified — the incident's **Incident created** notification waits until they are its owners, so it goes to them rather than to the project's owners.
- **A private note records the submission** — see [The private note](#the-private-note).

Everything that runs for a new incident runs for these too: privacy, owner, label, on-call and runbook rules, on-call policies, and **On Create Incident** workflows. On-call rules match a form's incidents like any others — including on their title and description, which the submitter wrote.

To publish one after triage, turn **Visible on Status Page** on from the incident's **Settings** page. Read what the submitter wrote first: the title and the description show on status pages. Because the incident was declared with **Notify Status Page Subscribers** off, publishing it does not send the "incident created" notification; to tell subscribers, post a public note with **Notify Status Page Subscribers** ticked — see [Posting a public note](/docs/incidents/notes-owners-and-feed#posting-a-public-note).

## How a submission becomes a scheduled maintenance event

| Field                            | Comes from                                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Title**                        | The answer to the **Title** question. When the form does not ask it, or it is left empty: the **Default Title**, or else the form's name. |
| **Description**                  | The answer to the **Description** question.                                                                                         |
| **Starts At**, **Ends At**       | The answers to **Starts At** and **Ends At**, which every maintenance form asks and requires. The end must be after the start.     |
| **Monitors**                     | The monitors the submitter chose, together with the ones the settings always attach.                                               |
| **Status Pages**                 | The status pages the submitter chose, together with the ones the settings name.                                                     |
| **Labels**                       | The labels the submitter chose, together with the ones the settings always add.                                                     |
| **Owners**                       | The people and teams the settings name. They own every event the form schedules.                                                    |
| **Show on Status Pages**         | **No** unless the settings turn it on.                                                                                              |
| **Notify Subscribers**           | **No** unless the settings turn it on.                                                                                              |
| **Custom Fields**                | Each custom field question's answer — unless the field copies its value from a monitor custom field and the event's monitors hold one. |
| **Other Answers**                | Listed on a private note on the event, with who submitted it.                                                                      |

The event starts in your project's **Scheduled** state and moves on like any other: it becomes ongoing when it starts and ends when it ends.

A submission is somebody's request, and a request is reviewed before it is published. So, unless you change it, the event stays off its status pages until someone on your team shows it, and its subscribers are not told when it is created, starts or ends. **Show on Status Pages** and **Notify Subscribers**, on the **Publishing** step of the settings, change that for every event the form schedules — turn them on only when you trust everyone with the link.

## The On Submit settings

**Edit Settings** opens the settings in steps: **Next** walks on, and **Save Changes** is on the last step. Every step is filled in already, so the step list beside the form opens any of them, the last one included: change a setting on its step, then open the last step and save.

| Step              | Incident form                                                     | Maintenance form                                   |
| ----------------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| **Defaults**      | **Default Title**, **Severity**, **Incident Template**            | **Default Title**                                  |
| **Always Attach** | **Monitors**, **Labels**, **On-Call Policies**                    | **Monitors**, **Status Pages**, **Labels**         |
| **Owners**        | **Owners**                                                        | **Owners**                                         |
| **Publishing**    | —                                                                 | **Show on Status Pages**, **Notify Subscribers**   |

**Owners** is one picker for people and teams: **Add owner** opens one search list of both, and each pick shows as a chip you can remove. Everything the settings name must belong to the form's project, and owners must be members of it. A record deleted after it was chosen is skipped when a submission is created, and the rest still applies.

## The private note

Every submission leaves a private note on what it created:

> Submitted through the form **Report a Problem** by Ada Lovelace (<ada@example.com>).
>
> **Which office are you in?**\
> Berlin

It names the form and the submitter — "Submitted anonymously through the form **Report a Problem**." when the form did not ask who they are — then, when the submission started from one of the form's templates, says which: "Started from the template **Application Outage**." — and then lists the answers to the form's own questions, each under its question, in the form's order. The answers to linked questions are already on the record: its title, its severity, its custom fields. Being private, the note never reaches a status page, but it is posted to the record's Slack and Microsoft Teams channels like any other note.

The address is a link that writes to exactly that address — in the dashboard, in Slack and in the owners' email.

## Hidden questions and templates

A [hidden question](/docs/forms/building#hidden-questions) is answered from the [template](/docs/forms/building#templates) the submission started from — never from the request — and its answer goes exactly where a typed one would: a hidden **Description** becomes the incident's description, a hidden custom field its value, a hidden question of the form's own a line on the private note. A submission that started from no template leaves hidden questions unanswered, and their fields are filled in from the On Submit settings, as for any question left empty. A template deleted while someone had the form open does not stop their submission: it is created as they answered it, without the template's hidden answers.

A template can ask the form's questions [its own way](/docs/forms/building#how-a-template-asks-each-question), and the server holds the submission to the questions as the template it names asks them. A question the template hides is answered from the template, as a hidden question is, even when the form asks it; one the template asks is read from the request, even when the form hides it; and one the template requires must be answered, or the submission is refused and nothing is created.

The answers a template filled in on the page are the submitter's once they submit: the server takes the answers the request sends for the questions the page asks, whatever the template said.

## Text a submitter writes

A submission goes straight to places where text can act on its own — Slack and Microsoft Teams channels, every responder's browser, the owners' emails — and nobody reads it first. So before the record is created:

- **Mentions notify nobody.** In the title, the description and every text answer, anything Slack reads as a mention — such as \<!channel\>, \<!here\> or \<@U0123ABC\> — gets an invisible character after its opening bracket. It reads the same everywhere, but no chat tool acts on it.
- **Images become links.** In the description and in **Rich Text** answers, every image becomes a link to the same address, so nothing is loaded from wherever the submitter chose until a responder clicks it.
- **Diagrams become code.** A code block whose language is `mermaid`, in any spelling, is stored as plain code, so it shows its text rather than drawing a diagram.
- **The title is plain text.** Image syntax and diagram fences in it get the invisible character too, so wherever the title lands — an episode, a chat message, a note template — it loads nothing and draws nothing. The invisible characters count towards the title's limit.

Everything else — links, the rest of the Markdown, dropdown choices, numbers, dates, a ticked checkbox — is stored as the submitter gave it, and the submission keeps the submitter's name and email as typed.

## Where to read next

- [Building a Form](/docs/forms/building) — the questions that feed these fields, hidden questions and templates.
- [Incident Settings & Automation](/docs/incidents/settings) — incident templates and custom fields.
- [Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed) — private notes, public notes and owners.
- [Sharing & Security](/docs/forms/sharing-and-security) — who can submit, and how often.
