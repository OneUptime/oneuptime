# Building a Form

A form's **Build** page is where you decide what it asks, and how its page looks. The questions are on the left, in the order the public page shows them; **Add a Question**, on the right, lists everything you can add. Select a question to edit it where it is, drag it to move it, and click **Save Changes** when the form reads the way you want. Above the questions, folded, is the form's [Branding](#branding): its logo and favicon. Named sets of answers people can start the form from are on its **Templates** page — see [Templates](#templates).

## The builder

- **The form's header** shows its name and description as the public page will. **Edit Name and Description** changes them.
- **The questions** are cards. Each shows the question as people will see it, with a badge that says what it is linked to — **Incident · Severity**, **Custom Field · Region**, **Submitter · Email**, or its answer type for a question of the form's own. A red asterisk marks a required question, and a **Hidden** badge a [hidden](#hidden-questions) one.
- **Select a card** to edit it: its question, help text, answer type and options, whether it is required or hidden, and the buttons to duplicate or delete it. **Done** closes it.
- **Drag a card by its handle** to move it, or use **Move Up** and **Move Down** on the selected card — on a phone, or from the keyboard.
- **Add a Question** inserts the new question after the selected one, or at the end, and selects it.
- **Save Changes** saves every change at once. Until you save, the builder says **Unsaved changes** and offers **Discard Changes**, and the browser asks before you leave the page. A form can have up to 50 questions.

People who may read a form but not edit it see the builder read-only.

## Branding

**Branding**, folded above the questions, is how the form's page looks: your logo at the top of the page, above the form's name, and your favicon in the browser tab while the form is open. Until you upload your own, the form shows the OneUptime logo and favicon.

Folded, the section lists **Logo** and **Favicon** — drawn as set once the form has its own — and says which OneUptime ones are still in force. Open it to see both as the page shows them: the logo as it sits at the top of the page, and the favicon in a browser tab beside the form's name, which is the tab's title.

**Edit Branding** changes them in one dialog:

| Field             | What it is                                                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Logo**          | Shown at the top of the form's page, above its name, in place of the OneUptime logo. A PNG, JPEG, GIF, WebP or SVG image of 512 KB or less. Remove it to go back to the OneUptime logo. |
| **Logo Alt Text** | What the logo says, read out by screen readers: usually your organization's name. Asked once there is a logo. Leave it empty and screen readers skip the logo — the form's name follows it anyway. Removing the logo clears it too. |
| **Favicon**       | The icon in the browser tab while the form is open, in place of the OneUptime favicon. A PNG, JPEG, GIF, WebP, SVG or ICO image of 128 KB or less; a square PNG, SVG or ICO works best. Remove it to go back to the OneUptime favicon. |

The logo keeps the height of the OneUptime logo it replaces, and a wide one is fitted to the page's width. Every image is checked when it is saved — from the dashboard, the API, Terraform or a workflow: it must have been uploaded in the form's own project, be one of the types above, and be no larger than its limit. A logo that is not one of those images is refused with "The logo must be a PNG, JPEG, GIF, WebP or SVG image.", one that is too large with "The logo must be 512 KB or smaller.", and one whose upload is gone — or that was uploaded in another project — with "The logo's file could not be found. Upload the logo again." A favicon is refused the same way, with "The favicon must be a PNG, JPEG, GIF, WebP, SVG or ICO image.", "The favicon must be 128 KB or smaller." and "The favicon's file could not be found. Upload the favicon again."

**Preview** shows the logo as the page does. People who may read a form but not edit it see its branding without **Edit Branding**. The logo and favicon reach the form's page only inside the form itself — see [Sharing & Security](/docs/forms/sharing-and-security#what-protects-a-form).

## What you can add

The palette has four groups.

### Questions of the form's own

| Answer type       | What the submitter gives                     |
| ----------------- | -------------------------------------------- |
| **Short Answer**  | One line of text.                            |
| **Paragraph**     | Several lines of text.                       |
| **Rich Text**     | Text with formatting and links.              |
| **Number**        | A number.                                    |
| **Dropdown**      | One choice from a list.                      |
| **Multi-Select**  | Any number of choices from a list.           |
| **Checkbox**      | A box to tick, such as a confirmation.       |
| **Date**          | A day.                                       |
| **Date and Time** | A day and a time.                            |

A dropdown or multi-select lists the **Options** you give it, each with an optional color (the button beside an option opens a set of named colors, with **Custom color** for an exact code), between one and 100 of them. Switching a question between **Dropdown** and **Multi-Select** keeps its options; a question that becomes one starts with two you can rename, and one that stops being one drops them. **Duplicate** copies a question of the form's own, right below it.

The answers to these questions are kept with the submission and listed on the private note of what the form creates — they do not fill in a field of it. To fill in a field, add the field itself, from the next two groups.

### Fields of what the form creates

The fields of an incident, or of a scheduled maintenance event, that a submitter can answer. The answer becomes the field's value.

| Incident field        | Answered with                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------- |
| **Title**             | One line, up to 500 characters.                                                              |
| **Description**       | Rich text, up to 20,000 characters.                                                          |
| **Severity**          | One of your incident severities.                                                             |
| **Monitors**          | Any of the monitors you offer — the incident's affected monitors.                            |
| **Labels**            | Any of the labels you offer.                                                                 |
| **Impact Started At** | A date and time: when the problem started, as the submitter remembers it.                    |

| Scheduled maintenance field | Answered with                                                    |
| --------------------------- | ---------------------------------------------------------------- |
| **Title**                   | One line, up to 100 characters.                                  |
| **Description**             | Rich text, up to 20,000 characters.                              |
| **Starts At**               | A date and time. Always asked and always required.              |
| **Ends At**                 | A date and time after **Starts At**. Always asked and required. |
| **Monitors**                | Any of the monitors you offer.                                   |
| **Status Pages**            | Any of the status pages you offer.                               |
| **Labels**                  | Any of the labels you offer.                                     |

Each field can be asked once; the palette marks the ones already on the form **Added**. A field the form does not ask — or that is left empty — is filled in from the form's [On Submit settings](/docs/forms/on-submit).

**Choices Offered.** A public page must not list your whole project to strangers, so a field answered by choosing records offers only the ones you pick. **Monitors**, **Labels** and **Status Pages** list exactly the choices you offer, and are not asked until you offer at least one. **Severity** offers every incident severity unless you narrow it, since severities are not secret. Answers outside the offered choices are refused.

### Custom fields

Your incident custom fields — or scheduled maintenance custom fields, for a maintenance form — each one a question whose answer becomes the field's value. The question takes its type and options from the custom field, and starts with its name as the question and its description as the help text, which you can change.

A form asks only the custom fields you add to it, whatever **Show on Create** says: every field a form asks shows its name, description and options to anyone with the link. When a custom field is deleted, its question stays on the form but is no longer asked, and its card says so — delete the question. A field created again with the same name is a new field: add it again.

A custom field that copies its value from a monitor custom field says so on its card: when the incident or event has monitors that agree on a value for it, that value replaces the submitter's answer.

### Submitter

**Your Name** and **Your Email** ask who is submitting. They are kept with the submission and named on the private note, so your team can follow up, and are never shown on the incident or event itself. OneUptime never emails the submitter. Leave them out, or make them optional, to take anonymous submissions.

The email must be one ordinary address, such as `ada@example.com` — not a name with the address in angle brackets, and not a list of addresses. Name and email are up to 100 characters each.

## A new form's questions

A new form starts with the questions it should almost always ask, so it works the moment it is created: the **Title**, required; the **Description**; for a maintenance form, **Starts At** and **Ends At**; and **Your Name** and **Your Email**, required. Their wording is in your dashboard's language. Change, hide or remove them as you like — except a maintenance event's start and end, without which no event can be scheduled. When your own questions say everything, hide the **Description** rather than leave a box nobody should type in: see [Hidden questions](#hidden-questions).

## Required questions

**Required** means the form cannot be submitted without an answer. An answer of nothing but spaces, tabs or line breaks counts as no answer, and a required **Checkbox** must be ticked. The server checks every required question again when the form is submitted, so a request made without the page is held to them too.

A question that is not required may be left empty: its field is then filled in from the On Submit settings, as if the form had not asked it.

## Hidden questions

Turn on **Hidden** on a card and the question is no longer shown on the form. Nobody is asked it, so it is never required, and a submission cannot answer it — the request is not even read for it. Only the [template](#templates) a submission starts from answers it, and it stays unanswered when the submitter starts from no template, or from one that leaves it empty.

Hide a question when its answer is your team's to decide, not the submitter's:

- **The incident's Description**, when the questions you added say everything. Hidden, it no longer invites people to type there; give each template the standard text you send for its case, or let incidents start without one.
- **A custom field your workflows or rules read**, such as a notification type, set by each template.
- **A question of the form's own** whose answer only your team needs on the private note.

A hidden question keeps its place, its label and its settings, so you can show it again at any time. A field the form's target cannot be created without — a maintenance event's **Starts At** and **Ends At** — cannot be hidden. A hidden question's answer is checked and stored exactly as a typed answer would be, and kept with the submission.

## Templates

A form's **Templates** page holds named sets of answers people can start the form from — one for each case your team reports often, such as **Application Outage**, **Planned Maintenance** or **Service Restored** — so one form, and one link, serves them all.

- **Add Template** opens the form's own questions, hidden ones included and none of them required: fill in what the template should answer, and leave the rest to the person submitting. A hidden question says so under it.
- **Default** makes it the template the form opens with. Only one template can be the default, and a form whose only template is its default is simply a pre-filled form.
- Each template lists what it fills in, and has **Edit**, **Duplicate** — a copy right after it, named like **Application Outage 2** — **Move Up** and **Move Down**, for the order the form lists them in, and **Delete**.
- **Copy Link** copies the template's own link, which opens the form with it filled in. See [Sharing & Security](/docs/forms/sharing-and-security#a-link-for-each-template).

On the public page, a form with templates lists them over its questions, under **Start from a template**. Choosing one fills the form in; the submitter can still change any answer before submitting, and choosing another starts the form over from that one. The page opens with the template its link names, otherwise with the default, otherwise with none. **Preview** lists the templates and opens on the default too.

Every answer of every template is checked against its question when the templates are saved — an option the question offers, a record the form offers, text that fits — and saving is refused with a message that names the template and the problem, whether it comes from the dashboard, the API or Terraform. A template's name is up to 100 characters and unique within the form, and a form has up to 50 templates. When you later change the questions, a template's answer to a question you removed, or that no longer fits it, is simply not used, and the next save of that template drops it.

## When the builder flags a question

A card with something wrong says what, in amber:

- **This custom field was deleted, so the question is not asked.** The public page leaves the question out. Delete it.
- **Choose at least one to offer, or the question is not asked.** Pick the monitors, labels or status pages it offers.
- **Add at least one option.** A dropdown or multi-select has nothing to choose from.
- **Write the question.** The question has no text.

The form cannot be saved while a question has one of the last three: **Save Changes** says which question and what is wrong, and the preview leaves such a question out. Saving checks the questions as a whole too, and is refused with a message that names the problem when, for example, two questions ask for the same field, or a maintenance form does not ask when the maintenance starts and ends — whether the questions come from the builder, the API, Terraform or a workflow.

## Preview

**Preview** opens the form exactly as people see it at its link — the same logo, questions, inputs, options and checks, its list of templates, and no hidden question — and lets you fill it in. Nothing you enter there is submitted: **Submit** only checks your answers, and **Fill It In Again** starts over. The preview shows the questions as they are in the builder, saved or not, and says when it leaves a flagged question out.

## What the submitter sees

The public page shows the form's logo — the OneUptime logo until you upload yours — then the form's name and description, its templates if it has any, the questions it does not hide, and **Submit**, and the browser tab shows the form's name and its favicon. It is in the submitter's language when OneUptime has it — the language they last chose in OneUptime on that browser, or else the one their browser asks for — and in English otherwise. Your questions, options and help texts are shown as you wrote them.

After submitting, the page says "Thank you — your response was submitted." and gives the number of what was created — "Your reference number is INC-42." — followed by the form's thank-you message, if you wrote one on the **Share** page. **Submit another response** opens an empty form. The submitter gets no email and no way back to the incident or event.

## Size limits

| Answer                         | Limit                                                                     |
| ------------------------------ | ------------------------------------------------------------------------- |
| An incident's **Title**        | 500 characters, not counting spaces at either end.                         |
| A maintenance event's **Title** | 100 characters.                                                          |
| **Description**                | 20,000 characters.                                                         |
| Any other text answer          | 10,000 characters.                                                         |
| A multi-select answer          | 100 choices.                                                               |
| **Your Name**, **Your Email**  | 100 characters each.                                                       |

A submission that breaks a limit, leaves out a required answer or gives an answer that does not fit its question is refused with a message that says which, and nothing is created. Answers to questions the form does not ask are ignored.

## Where to read next

- [What a Submission Creates](/docs/forms/on-submit) — how the answers and the On Submit settings become an incident or a maintenance event.
- [Sharing & Security](/docs/forms/sharing-and-security) — sharing the link, a link for each template, and what protects them.
- [Incident Settings & Automation](/docs/incidents/settings) — incident custom fields and templates.
