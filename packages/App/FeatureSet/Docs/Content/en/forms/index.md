# Forms Overview

A form is a page that anyone with its link can fill in, without a OneUptime account. Each submission creates something in your project: an **incident**, for problem reports, or a **scheduled maintenance event**, for change and maintenance requests. You build the form's questions in a drag-and-drop builder, decide how the answers become the record, and share the link with the people who should use it.

Use a form when the people who notice a problem — or who need a change — are not the people who run your incidents and maintenance: support agents, colleagues in another department, a store manager, a customer's operations team. They open the link, answer your questions and press **Submit**. Your team gets an ordinary incident or event, with the answers in its fields and a private note that records who sent it.

:::cards
- [Create your first form](#create-your-first-form): From a blank form to a link you can share.
- [Building a Form](/docs/forms/building): Questions, answer types, hidden questions, templates and branding.
- [What a Submission Creates](/docs/forms/on-submit): How the answers and the settings become an incident or a maintenance event.
- [Sharing & Security](/docs/forms/sharing-and-security): The link, the IP allowlist, rate limits and troubleshooting.
:::

## How a form works

```mermaid title="From a filled-in form to an incident or a maintenance event"
flowchart TB
    submitter["Someone with the link, no account"] --> page["The form's page"]
    page -->|Submit| checks["Protections and answer checks"]
    checks --> submission["Submission, kept with the form"]
    submission --> target{"Each Submission Creates"}
    target -->|Incident| incident["Incident, hidden from status pages"]
    target -->|Scheduled Maintenance| event["Maintenance event, hidden unless set"]
    incident --> response["On-call policies and rules run"]
    incident --> note["Private note: who sent it, other answers"]
    event --> note
```

Every request passes the form's protections first: its own page, rate limits, the IP allowlist and captcha. A submission whose answers fit is kept, and creates one record, filled in from the answers, the form's **On Submit** settings and, for an incident, its incident template. Nothing it creates reaches a status page until your team decides it should.

## At a glance

- **A product of its own** — **Forms** sits in the products menu, at `/dashboard/{projectId}/forms`. Each form has a link of its own, such as `https://oneuptime.com/accounts/form/<share-key>` on OneUptime Cloud.
- **No account needed** — anyone with the link can open the form and submit it, without signing in.
- **A builder, not a settings page** — add your own questions (short answers, paragraphs, dropdowns, dates, checkboxes and more), the fields of what the form creates (title, description, severity, monitors, labels, start and end), your custom fields, and the submitter's name and email. Drag them into order, preview the form, save.
- **You decide where every value comes from** — the **On Submit** page lists every field of the new incident or event next to its source: an answer, a default, a setting that always applies, or the incident template.
- **Hidden until someone publishes it** — incidents from a form are never shown on status pages or sent to subscribers when they are declared; maintenance events are not, unless the form says so.
- **Protected in layers** — an **Accepting Submissions** switch, an optional **IP Allowlist**, a refusal of requests from other websites, rate limits, the instance's captcha, and size limits on every answer.
- **Every submission kept** — each form's **Submissions** page, and **Forms → Submissions** for all of them, list the answers and link to what each submission created.
- **Your own branding** — upload a logo for the top of the form's page and a favicon for the browser tab, in the **Branding** section of the **Build** page. Until you do, the form shows OneUptime's.
- **Templates for common cases** — save named sets of answers, such as **Application Outage** or **Planned Maintenance**, and people pick one at the top of the form to fill it in, or open its own link. One form, and one bookmark, serves a whole team.
- **Hidden questions** — hide a question nobody should have to answer, such as the incident's description, and let each template answer it instead.
- **Duplicate Form** — start a form for another team from one that works, with its questions, templates and settings.

## What a form can create

When you create a form you choose what **Each Submission Creates**. You can change it later on the form's **On Submit** page.

| Each submission creates | Use it for | What happens |
| --- | --- | --- |
| **Incident** | Problem reports | An incident is declared at once, so your on-call policies and rules run and the people on call are told. It stays off status pages until a responder publishes it. |
| **Scheduled Maintenance** | Change and maintenance requests | A maintenance event is scheduled for the window the submitter asks for. Unless the form says otherwise, it stays off its status pages and tells no subscriber. |

Forms start with these two, and more kinds of record will follow.

## Before you begin

- **A plan that includes forms.** On OneUptime Cloud, forms need the **Growth** plan or above. See [Plan](#plan).
- **Permission to create forms.** **Create Form** belongs to project owners and admins, and to the roles you give it. See [Permissions](#permissions).
- **For an incident form, a severity.** Every incident needs one: from a question, from the form's settings or from its incident template. Without one, every submission is refused. See [What a Submission Creates](/docs/forms/on-submit#how-a-submission-becomes-an-incident).

## Create your first form

:::steps
### Create the form

Open **Forms** from the products menu and click **Create Form**. Give the form a name — the heading of its public page, unique in the project — choose what **Each Submission Creates**, and optionally a description in Markdown, shown at the top of the public page.

### Build its questions

The form opens on its **Build** page, already asking for a title, a description and who is submitting — and, for a maintenance form, when the maintenance starts and ends. Add, remove and reorder questions, then click **Save Changes**. See [Building a Form](/docs/forms/building).

### Decide what a submission creates

On **On Submit**, check how a submission becomes an incident or event, and click **Edit Settings** to give it defaults — a severity, an incident template, monitors and labels to always attach, owners to tell. See [What a Submission Creates](/docs/forms/on-submit).

### Add templates, if people report the same cases

On **Templates**, save a template for each case people report often: the form lists them over its questions and fills itself in from the one chosen. See [Templates](/docs/forms/building#templates).

### Share the link

On **Share**, copy the link and send it to the people who should use the form. See [Sharing & Security](/docs/forms/sharing-and-security).
:::

> [!IMPORTANT]
> A new form is **Accepting Submissions** as soon as it is created, but nobody can reach it until you share its link. Set up its questions and protections first.

## A form's pages

| Page | What it holds |
| --- | --- |
| **Build** | The form's name and description, its **Branding** — logo and favicon, folded — and the builder: its questions, the question palette and **Preview**. |
| **Templates** | Named sets of answers people can start the form from, the one it opens with, and each one's own link. |
| **On Submit** | What each submission creates, and how every field of it is filled in. **Edit Settings** changes the defaults and what always applies. |
| **Share** | **Accepting Submissions**, the **Share Link**, the message shown after submitting, and the **IP Allowlist**. |
| **Submissions** | Every submission made through the form, newest first, with its answers and what it created. |
| **Duplicate Form** | Under **Advanced**: a copy of the form, named for you, with its questions, templates, On Submit settings, branding, thank-you message and IP allowlist, and a link of its own. The copy starts turned off, and opens on its builder. |
| **Delete Form** | Deleting the form, under **Advanced**. Its submissions are deleted with it; the incidents and events it created are not. |

The **Developer** section of the form's menu holds its Terraform, API and AI assistant pages, like every other resource.

## Forms and incident templates

A template and a form both save you from typing the same incident twice, but they serve different people:

| | Incident template | Form |
| --- | --- | --- |
| Who uses it | Your team, signed in to OneUptime | Anyone with the link, without an account |
| Where | **Create from Template** on the incidents list | A page of its own, at the form's link |
| What they can change | Every field of the incident, before declaring it | Only the answers to the questions you chose |
| What they see | Your monitors, policies, owners and every field | The form's name, description and questions — and only the options you chose to offer |
| Status pages | Whatever the template and the declare form say | Hidden until a responder publishes the incident |

They work together. Give an incident form an **Incident Template** on its **On Submit** page and every incident it declares is declared from that template: build the template for what your team needs on the incident, and the form for what you want to ask the submitter.

## Submissions

A form's **Submissions** page lists every submission made through it, newest first, with **Submitted At**, **Submitted By** — the name and email the submitter gave, or **Anonymous** — and **Created**, a link to the incident or event it created. **View Answers** shows every answer as the submitter gave it. **Forms → Submissions** lists the submissions of every form in the project.

Submissions are written by the form, never by hand, and cannot be edited. Deleting one removes its answers and the submitter's name and email from the list; the incident or event it created stays, and so does the private note on it, which repeats the submitter's details and the answers. When the incident or event is deleted, its submission stays, and its **Created** column reads **Deleted since**.

> [!WARNING]
> When you remove somebody's personal data, deleting the submission is not enough: edit or delete the private note on the incident or event it created too.

## Permissions

Forms let people outside your team create incidents and maintenance events in your project, so they are managed by project owners and admins, and by the roles you give the **Form** permissions. They are in the **Form** group of the [Permission Reference](/docs/permissions/reference):

| Permission | What it allows | Who has it by default |
| --- | --- | --- |
| **Create Form** | Creating forms, and duplicating them. | Project Owner, Project Admin |
| **Edit Form** | Changing a form: its questions, its branding, its templates, its On Submit settings, **Accepting Submissions**, its link and **IP Allowlist**. | Project Owner, Project Admin |
| **Delete Form** | Deleting a form, and with it its submissions. | Project Owner, Project Admin |
| **Read Form** | Seeing forms, their questions, their settings and their links. | The above, plus Project Member, Viewer, and the incident and scheduled maintenance roles |
| **Read Form Submission** | Seeing the submissions and their answers. | Project Owner, Project Admin |
| **Delete Form Submission** | Deleting submissions. | Project Owner, Project Admin |

Submissions hold what strangers typed — names, email addresses, and answers that may never reach the record — so only project owners and admins see them unless you grant **Read Form Submission**. Anyone who can read a form can see and share its link. Submitting a form needs no permission at all. For how roles and granular permissions combine, see [Users, Teams & Permissions](/docs/permissions/index).

## Plan

On OneUptime Cloud, forms need the **Growth** plan or above, and a form's **IP Allowlist** needs **Scale**, whether it is set when the form is created or edited later. The links of a project below the **Growth** plan, or whose subscription is unpaid, show the not-available message, and nothing is created.

## Forms through the API

Forms are an ordinary API resource at `/api/form`, and their submissions at `/api/form-submission`, which you can read and delete but not create or edit. The [API reference](/reference) has the full request and response shapes.

### Questions and settings

A form's questions are its `fields` column, a JSON list in the order the form asks them, and its On Submit settings its `targetSettings`:

```json
{
  "data": {
    "targetType": "Incident",
    "fields": [
      {
        "id": "what",
        "source": "TargetField",
        "targetField": "title",
        "label": "What is wrong?",
        "isRequired": true
      },
      {
        "id": "office",
        "source": "Question",
        "type": "Dropdown",
        "label": "Which office are you in?",
        "dropdownOptions": "Berlin\nLondon",
        "isRequired": false
      },
      {
        "id": "email",
        "source": "Submitter",
        "submitterField": "Email",
        "label": "Your Email",
        "isRequired": true
      }
    ],
    "targetSettings": {
      "incidentSeverityId": "<severity-id>",
      "labelIds": ["<label-id>"]
    }
  }
}
```

Each question has an `id` of its own — letters, digits, `-` and `_` — a `source`, a `label`, optional `helpText` and `isRequired`:

| `source` | What it asks |
| --- | --- |
| `Question` | A question of the form's own, answered by `type`: `Text`, `LongText`, `Markdown`, `Number`, `Dropdown`, `MultiSelectDropdown`, `Boolean`, `Date` or `DateTime`. A dropdown lists its `dropdownOptions`, one per line. |
| `TargetField` | A field of what the form creates, named by `targetField`: `title`, `description`, `incidentSeverityId`, `monitors`, `labels` and `impactStartedAt` for an incident; `title`, `description`, `startsAt`, `endsAt`, `monitors`, `statusPages` and `labels` for a maintenance event. A field answered by choosing lists the records it offers in `allowedOptionIds`. |
| `TargetCustomField` | One of the incident's or event's custom fields, named by `customFieldId`. |
| `Submitter` | The submitter's `Name` or `Email`, named by `submitterField`. |

A question with `isHidden` set to `true` is not shown on the public page, is never required, and is answered only from the template a submission names.

### Templates in the API

A form's templates are its `templates` column, a JSON list in the order the form lists them. Each template has an `id` of its own — letters, digits, `-` and `_` — a `name` of up to 100 characters, unique within the form, and `answers` keyed by question id, each as a submission sends it: text, a number, `true` or `false`, an option's value, or a list of values for a multi-select. `isDefault` set to `true` makes it the template the form opens with; a form has at most one, and up to 50 templates:

```json
{
  "data": {
    "templates": [
      {
        "id": "outage",
        "name": "Application Outage",
        "isDefault": true,
        "answers": {
          "what": "The application is down",
          "office": "Berlin"
        }
      }
    ]
  }
}
```

The questions, templates and settings are checked whenever they are saved — from the dashboard, the API, Terraform or a workflow — and a list that breaks a rule is refused with a message that names what is wrong. `shareKey`, the key in the form's link, is set by OneUptime when the form is created, and changing it is what **Reset Link** does.

### Branding in the API

A form's branding is its `logoFileId`, `logoAltText` and `faviconFileId`. Upload the image first with `POST /api/file`, in the form's project — with an API key of that project, or signed in as a member of it with its id in the `tenantid` header — sending its `name`, its `fileType`, such as `image/png`, and the bytes base64 in `file`, and set the `_id` it returns. An upload into a project you are not a member of is refused with "You can upload files only to a project you are a member of." Every upload is private: `isPublic` is set by OneUptime, whatever the request says. Each image is checked when the form is saved: it must have been uploaded in the form's project, and a logo must be a PNG, JPEG, GIF, WebP or SVG image of 512 KB or less, a favicon one of those or an ICO of 128 KB or less. Set an id to `null` to go back to OneUptime's. See [Branding](/docs/forms/building#branding).

### Reading submissions

To list a form's submissions:

```bash
curl -X POST https://oneuptime.com/api/form-submission/get-list \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": { "formId": "<form-id>" },
    "select": { "submitterName": true, "submitterEmail": true, "answers": true, "incidentId": true, "scheduledMaintenanceId": true, "createdAt": true },
    "limit": 50,
    "skip": 0
  }'
```

### Workflows

Forms have the generated workflow components — **On Create Form**, **On Update Form** and so on. To act on what a form created, use **On Create Incident** or **On Create Scheduled Maintenance**.

### The public page's own endpoints

The public page talks to two routes that need no API key: `GET /api/form/public/<shareKey>`, which returns the form's name, description and questions — and its logo, the logo's alt text and its favicon, the images base64, when it has them, and its templates, with their answers to the questions the page asks — and `POST /api/form/public/<shareKey>/submit`, which submits it, naming the template the submitter started from in `templateId`. They are the page's own endpoints, not an API to build on: every call goes through the form's protections — see [Sharing & Security](/docs/forms/sharing-and-security) — and they change with the page. To create incidents from your own code, use `POST /api/incident` with an API key — see [Declaring an Incident](/docs/incidents/declaring-incidents).

## Where your incident forms went

Forms replace the **Incident Forms** that lived under **Incidents → Settings → Forms**. Every incident form was moved over when you upgraded, with the same link and the same submissions:

- Its questions became the builder's: the title, the description unless it was hidden, the severity when the submitter could choose it, each custom field it asked — in the order the custom fields were sorted — and **Your Name** and **Your Email**, required unless the form let people report anonymously.
- Its severity and incident template became its **On Submit** defaults.
- Its **Enabled** switch, success message and **IP Allowlist** are unchanged, and so is its link: old `/accounts/incident-form/<share-key>` links open the form at its new address.
- The **Incident Form** permissions became the **Form** ones, for every team and API key that had them.

The old dashboard pages redirect to the new ones.

## Next steps

:::cards
- [Building a Form](/docs/forms/building): Questions, answer types, linked fields, custom fields and the preview.
- [What a Submission Creates](/docs/forms/on-submit): How the answers and the On Submit settings become an incident or a maintenance event.
- [Sharing & Security](/docs/forms/sharing-and-security): The link, the IP allowlist, rate limits, captcha and troubleshooting.
- [Declaring an Incident](/docs/incidents/declaring-incidents): The other ways incidents are declared.
:::
