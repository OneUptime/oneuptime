# Incident Forms

An incident form is a page that anyone with its link can fill in to report a problem, without a OneUptime account. Each submission declares an incident in your project, with the answers to the questions you chose, and the incident stays hidden from your status pages until a responder has looked at it.

Use a form when the people who notice a problem are not the people who run your incidents: support agents, colleagues in another department, a store manager, a partner's operations team. They open the link, say what is wrong and press **Submit**. Your team gets an incident like any other — declared from your incident template, if you gave the form one — with the reporter's name and email on a private note.

## At a glance

- **Set up under Incidents → Settings → Forms** — each form has a link of its own, such as `https://oneuptime.com/accounts/incident-form/<share-key>` on OneUptime Cloud.
- **No account needed** — anyone with the link can open the form and submit it, without a OneUptime account and without signing in.
- **You choose the questions** — **Title** is always asked, the description is **Required**, **Optional** or **Hidden**, the severity is the form's or the reporter's, and no custom field is asked until you add it.
- **Declared from a template, if you like** — everything an incident template sets applies, from on-call policies and owners to monitors and a monitor status change.
- **Hidden until published** — incidents from a form are not shown on status pages and do not notify subscribers when they are declared. A private note records who reported them.
- **Protected in layers** — an **Enabled** switch, an optional **IP Allowlist**, rate limits, the instance's captcha, and size limits on every answer.
- **Every report kept** — the form's **Submissions** list links each report to its incident.

## Forms and incident templates

A template and a form both save you from typing the same incident twice, but they serve different people:

|                      | Incident template                                    | Incident form                                           |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| Who uses it          | Your team, signed in to OneUptime                    | Anyone with the link, without an account                |
| Where                | **Create from Template** on the incidents list       | A page of its own, at the form's link                   |
| What they can change | Every field of the incident, before declaring it     | Only the answers to the questions you chose             |
| What they see        | Your monitors, policies, owners and every field      | The form's name and description, and its questions      |
| Status pages         | Whatever the template and the declare form say       | Hidden until a responder publishes the incident         |

They work together. Give a form an **Incident Template** and every incident reported through it is declared from that template: build the template for what your team needs on the incident, and the form for what you want to ask the reporter.

## Creating a form

Go to **Incidents → Settings → Forms** (`/dashboard/{projectId}/incidents/settings/forms`). **Forms** sits right after **Incident Templates** in the **Settings** section of the Incidents side menu, which is collapsed by default. The card is titled **Incident Forms**.

Click **Create Incident Form** and give the form:

- a name — the heading of the public page, and unique in the project;
- a description — optional, in Markdown, shown at the top of the public page;
- a **Severity** — required, the severity of the incidents the form declares;
- an **Incident Template** — optional; see [The incident template](#the-incident-template).

Then open the form. Its page holds the rest of the settings, in cards:

| Card                  | What it holds                                                                        |
| --------------------- | ------------------------------------------------------------------------------------ |
| **Form Details**      | The name, the description and **Enabled**, which decides whether the link works.     |
| **Share Link**        | The link, with **Copy Link**, **Open Form** and **Reset Link**.                      |
| **Incident Settings** | **Severity**, **Let Reporter Choose Severity** and **Incident Template**.            |
| **Form Settings**     | **Description Question**, **Require Reporter Details** and **Success Message**.      |
| **Questions**         | Which incident custom fields the form asks, and which of them must be answered.      |
| **Access**            | The **IP Allowlist**.                                                                |
| **Submissions**       | Every report made through the form, with a link to its incident.                     |

A new form is **Enabled** as soon as it is created, but nobody can reach it until you share its link. Set up its questions and protections first.

## The questions

The public page shows the form's name and description, then the questions below, then **Submit**.

### Title and description

**Title** is always asked and always required, with the hint "A short summary of what is wrong." It becomes the incident's title.

The **Description Question** setting on the **Form Settings** card decides the **Description** question:

- **Optional** — the default. The question is asked and may be left empty.
- **Required** — the question is asked and must be answered.
- **Hidden** — the question is not asked.

The description is written in the Markdown editor, without image upload: somebody without an account cannot upload files. It becomes the incident's description. When the question is hidden or left empty, the incident takes the description of the form's template, if it has one.

### Severity

Every incident a form declares gets the form's **Severity**, unless **Let Reporter Choose Severity** is on. Then the form asks a **Severity** question listing your project's incident severities, and the one the reporter picks is used. Leave it off when reporters should not decide how urgently you are paged: your on-call rules can match on severity.

The template's **Incident Severity** is used only when the form has no severity of its own — after the form's severity was deleted, for example.

### Custom fields

A form asks no incident custom field until you add it. Open the **Questions** card, edit it, and set each field to:

- **Not Asked** — the default. The field is left off the form.
- **Optional** — the field is asked and may be left empty.
- **Required** — the field is asked and must be answered. A required yes/no field must be switched on.

This is deliberately different from **Show on Create**, which asks for a field in the dashboard's **Details** step. A form is public: every field it asks shows its name and description to anyone with the link, and a dropdown shows every one of its options — internal team names, customer tiers, system names. So a form only asks the fields you chose for it, and a custom field created later stays off every form until you add it there.

The fields are asked in their **Order**, each with the input its type calls for, and the answers are checked the way values sent through the API are: a number for a **Number** field, one of the options for a dropdown. The server checks the **Required** ones too, so they hold even for a request made without the page. Answers become the incident's custom field values, on its **Custom Fields** page like any others.

A form's questions are keyed by each field's **Template Variable**, which never changes, so renaming a field keeps it on the form. A template's [Custom Fields on Create](/docs/incidents/settings#custom-fields-on-create) do not apply to forms: the **Questions** card decides what a form asks.

### Reporter details

**Your Name** and **Your Email** ask who is reporting. With **Require Reporter Details** on — the default — both must be filled in, and the email must be a valid address. Turn it off and both become optional, so people can report anonymously.

The name and email are kept on the form's submission and in a private note on the incident, so your team can follow up. OneUptime never emails the reporter.

### What the reporter sees after submitting

The page shows "Thank you — your report was submitted." and the incident's number — "Your report is incident INC-42." — followed by the form's **Success Message**, if you wrote one. The success message is Markdown: use it to say what happens next, and where to go when it is urgent. The reporter gets no email and no way back to the incident.

## The incident template

Pick an **Incident Template** on the **Incident Settings** card and every incident the form declares is declared from that template, the way the server applies a template anywhere — see [How a template gets applied](/docs/incidents/settings#how-a-template-gets-applied). The reporter's answers win, and the template fills in the rest:

- **Initial Incident State** — when the template has none, the incident lands in the project's created state.
- The description, when the form did not ask for one or the reporter left it empty.
- **Resources Affected** — monitors, hosts, Kubernetes clusters, Docker hosts, Podman hosts and services.
- **Limit to these status pages** and **Change Monitor Status to**.
- **On-Call Policy** — the policies are executed as soon as the incident is declared, so a report pages people.
- **Owner - Teams** and **Owner - Users** — added as owners of the incident, and notified.
- **Labels**.
- **Custom Fields** — the template's values fill in the fields the form does not ask, and the reporter's answers win over them.

**Mind the monitors.** Declaring an incident on a monitor through a form affects the monitor exactly as declaring an incident on it by hand from the dashboard does. Active monitoring on the monitor pauses until the incident is resolved, so it is not checked in the meantime, and **Change Monitor Status to** changes the monitor's status at once. A monitor's status shows on every status page that lists the monitor, even while the incident itself is hidden. With a form, anybody who has the link can do this. Attach monitors to a form's template only when every report should pause them, and leave **Change Monitor Status to** empty unless every report should change the status your customers see.

## What the incident looks like

An incident reported through a form is an ordinary incident, declared with a few settings of its own:

- **Hidden from status pages.** **Visible on Status Page** is off, and **Notify Status Page Subscribers** is off. Until a responder publishes it, nothing about the incident reaches a status page or a subscriber — apart from a template's monitor status change, above.
- **Not private**, unless one of your privacy rules makes it private.
- **Declared by nobody.** The reporter is not a OneUptime user, so no user is recorded as having declared the incident.
- **A private note records the reporter**, such as "Reported through the incident form **Report a problem** by Ada Lovelace (ada@example.com)". When there are no reporter details, the note says the incident was reported anonymously.
- **The answers are its fields.** The title, the description and the custom field values are the ones the reporter gave, with the template's filling in the rest.

Everything that runs for a new incident runs for these too: privacy, owner, label, on-call and runbook rules, on-call policies, and **On Create Incident** workflows. On-call rules match a form's incidents like any others — including on their title and description, which the reporter wrote.

### Publishing it

Once a responder has triaged the report and it should be public, turn **Visible on Status Page** on from the incident's **Settings** page. Read what the reporter wrote first: the title and the description show on status pages, and custom fields marked **Include in Subscriber Notifications** go out in subscriber messages. Edit them before you publish.

Because the incident was declared with **Notify Status Page Subscribers** off, publishing it does not send the notification that it was created: the edit form does not offer **Notify subscribers that this incident was created** for it (see [Step 5 — More](/docs/incidents/declaring-incidents#step-5-more)). To tell subscribers, post a public note and tick its **Notify Status Page Subscribers** checkbox, which starts off on such an incident — see [Posting a public note](/docs/incidents/notes-owners-and-feed#posting-a-public-note).

## Sharing the link

The **Share Link** card shows the form's link:

- **Copy Link** copies it.
- **Open Form** opens the form in a new tab, the way reporters see it.
- **Reset Link** gives the form a new link, after you confirm. The old link stops working at once and shows the not-available message, so everybody you shared it with needs the new one. Use it when a link has spread further than it should.

Anyone with the link can open the form and submit it, without a OneUptime account and without signing in. Being signed in changes nothing: OneUptime knows who reported only from the name and email typed into the form. So treat the link like a phone number for your on-call team. Share it where the people who should report will find it — an intranet page, a support runbook, a pinned chat message — and not on a public website, unless you want reports from anyone.

The link carries a random key of its own, not the form's ID. On a self-hosted installation it is served from your own OneUptime host.

### Turning a form off

To stop taking reports, turn **Enabled** off on the **Form Details** card. The link then shows "This form is not available. It may have been turned off, or the link may be out of date.", and the **Share Link** card reminds you: "This form is turned off, so its link shows a 'not available' message." Turn it back on and the same link works again.

## Protections

A form is open to anyone with its link, and each submission can page your on-call team, so every request passes several checks:

- **Enabled** must be on — see [Turning a form off](#turning-a-form-off).
- The request must come from an address on the **IP Allowlist**, when the form has one.
- It must be within the rate limits.
- A submission must pass the captcha, when the instance has captcha turned on.
- Every answer must be within the size limits and fit its question.

### IP allowlist

To limit a form to your own networks, fill in **IP Allowlist** on the **Access** card, one IP address or CIDR range per line — such as `203.0.113.7` or `10.0.0.0/8`. Only requests from those addresses can open or submit the form, and everybody else sees "This form can only be opened from an allowed network." A request whose address OneUptime cannot tell is refused too. Leave the list empty to allow every address.

On OneUptime Cloud, editing the IP allowlist needs the **Scale** plan, like the IP allowlist of a [public dashboard](/docs/dashboards/sharing).

### Rate limits

Opening a form and submitting it are both rate limited by network address. Submitting has tight limits: per form from one address, per address across every form, and per form across every address — so even reports from many addresses at once can only page you a limited number of times an hour. Past a limit, the reporter sees "Too many submissions from your network. Please wait a few minutes and try again." and the API answers `429` with a `Retry-After` header. If the rate limiter itself cannot be reached, submissions are refused rather than let through.

### Captcha

When your OneUptime instance has hCaptcha turned on, the form shows a captcha, and a submission that has not passed it is refused. There is no per-form setting. A self-hosted installation turns captcha on with `CAPTCHA_ENABLED`, `CAPTCHA_SITE_KEY` and `CAPTCHA_SECRET_KEY` — the same settings that protect sign-up. Without it, the rate limits and the IP allowlist carry the load.

### Size limits

| Question                  | Limit                                                     |
| ------------------------- | --------------------------------------------------------- |
| **Title**                 | 1 to 500 characters, not counting spaces at either end.   |
| **Description**           | Up to 20,000 characters.                                  |
| A custom field's answer   | Up to 10,000 characters of text.                          |
| **Your Name**             | Up to 100 characters.                                     |
| **Your Email**            | A valid email address, up to 254 characters.              |

A submission that breaks a limit, leaves out a required answer or gives an answer that does not fit its field is refused with a message that says which, and no incident is created. A severity must be one of your project's, and answers to fields the form does not ask are ignored.

## Submissions

The **Submissions** card lists the reports made through the form, with **Submitted At**, **Reporter Name**, **Reporter Email** and **Incident**. **View Incident** opens a report's incident.

Submissions are written by the form, never by hand, and cannot be edited. Delete one to remove the reporter's name and email from the list; the incident stays. The incident's private note repeats the name and email, so when you remove somebody's personal data, edit or delete that note too.

- **Deleting an incident** keeps its submission, without the link to the incident.
- **Deleting a form** deletes its submissions too. The incidents it declared stay.
- **A private incident's submission** is listed only for the people who can see that incident.

## Permissions

A form lets people outside your team page your on-call team, so forms are managed by incident admins. Forms have six granular permissions of their own, in the **Incident** group of the [Permission Reference](/docs/permissions/reference):

| Permission                          | What it allows                                                                                         | Roles that include it                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| **Create Incident Form**            | Creating forms.                                                                                        | Project Owner, Project Admin, Incident Admin                                                          |
| **Edit Incident Form**              | Changing a form: its settings, its questions, **Enabled**, the **IP Allowlist** and **Reset Link**.     | Project Owner, Project Admin, Incident Admin                                                          |
| **Delete Incident Form**            | Deleting a form, and with it its submissions.                                                          | Project Owner, Project Admin, Incident Admin                                                          |
| **Read Incident Form**              | Seeing forms, their settings and their links.                                                          | All of the above, plus Project Member, Viewer, Incident Member and Incident Viewer                    |
| **Delete Incident Form Submission** | Deleting submissions.                                                                                  | Project Owner, Project Admin, Incident Admin                                                          |
| **Read Incident Form Submission**   | Seeing a form's **Submissions**.                                                                       | Project Owner, Project Admin, Project Member, Viewer, Incident Admin, Incident Member, Incident Viewer |

Project Members and Incident Members can declare incidents and edit incident templates, but not create or change forms. Anyone who can read a form can see and share its link. Submitting a form needs no permission at all. For how roles and granular permissions combine, see [Users, Teams & Permissions](/docs/permissions/index).

## Plan

On OneUptime Cloud, incident forms need the **Growth** plan or above, like incident templates, and editing a form's **IP Allowlist** needs **Scale**. The links of a project below the **Growth** plan show the not-available message.

## Forms through the API

Forms are an ordinary API resource at `/api/incident-form`, and their submissions at `/api/incident-form-submission`, which you can read and delete but not create or edit. Changing a form is a `PUT /api/incident-form/<form-id>` with the columns to change under `data`:

```json
{
  "data": {
    "descriptionSetting": "Required",
    "allowReporterToChooseSeverity": false,
    "isReporterDetailsRequired": true,
    "customFieldSettings": {
      "impact": "Required",
      "affected_location": "Optional"
    }
  }
}
```

`customFieldSettings` holds the **Questions**, keyed by each field's **Template Variable**: `Required` and `Optional` ask a field, and a field that is not listed is not asked — as with `Hidden` or `Default`. `descriptionSetting` is `Required`, `Optional` or `Hidden`. `shareKey`, the key in the form's link, is set by OneUptime when the form is created, and changing it is what **Reset Link** does.

To list a form's submissions:

```bash
curl -X POST https://oneuptime.com/api/incident-form-submission/get-list \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": { "incidentFormId": "<form-id>" },
    "select": { "reporterName": true, "reporterEmail": true, "incidentId": true, "createdAt": true },
    "limit": 50,
    "skip": 0
  }'
```

Forms have the generated workflow components — **On Create Incident Form**, **On Update Incident Form** and so on — and submissions have none. To act on a reported incident, use **On Create Incident**. The [API reference](/reference) has the full request and response shapes.

### The public page's own endpoints

The public page talks to two routes that need no API key: `GET /api/incident-form/public/<shareKey>`, which returns the form's name, description and questions, and `POST /api/incident-form/public/<shareKey>/submit`, which submits it. They are the page's own endpoints, not an API to build on: every call goes through the form's protections, and they change with the page. To declare incidents from your own code, use `POST /api/incident` with an API key — see [Declaring through the API](/docs/incidents/declaring-incidents#declaring-through-the-api).

## Troubleshooting

### The link says the form is not available

"This form is not available. It may have been turned off, or the link may be out of date." The page gives the same answer whatever the reason, so it never tells a stranger whether a form exists:

- **Enabled** is off on the **Form Details** card.
- The link was replaced with **Reset Link**. Share the new one.
- The form was deleted.
- On OneUptime Cloud, the project is below the **Growth** plan.
- The link was cut short when it was copied.

### The form can only be opened from an allowed network

"This form can only be opened from an allowed network." The reporter's address is not on the form's **IP Allowlist**: add their network, or empty the list. On a self-hosted installation behind a proxy or load balancer, check `TRUSTED_PROXY_HOPS` — when it is too low, OneUptime sees your proxy's address instead of the reporter's.

### Too many submissions from your network

"Too many submissions from your network. Please wait a few minutes and try again." Everybody behind one address — an office network, a VPN gateway — shares the per-address limit, which matters during a large outage, when many people report at once. Ask them to wait a few minutes; the first report is usually enough. On a self-hosted installation, check `TRUSTED_PROXY_HOPS` as above: when it is too low, every reporter shares your proxy's address.

### A submission is refused

The message says what is wrong: a required answer is missing, an answer is too long or does not fit its field, or the email address is not valid. "Captcha verification failed. Please try again." means the captcha was not passed, or has expired: solve it again. On a self-hosted installation where every submission fails the captcha, check that `CAPTCHA_SITE_KEY` and `CAPTCHA_SECRET_KEY` are both set — sign-up fails the same way.

### A custom field is not on the form

Custom fields are **Not Asked** until you add them on the form's **Questions** card, whatever their **Show on Create** and **Required on Create** say. See [Custom fields](#custom-fields).

### The incident is not on the status page

That is by design: incidents from a form are declared hidden, and their subscribers are not notified. See [Publishing it](#publishing-it).

### Nobody was paged

A form's incident executes the template's **On-Call Policy** and whatever your on-call rules add, like any other incident. With no template, or a template without on-call policies, and no matching on-call rule, nobody is paged. Give the form a template with an on-call policy, or write an on-call rule that matches its incidents — by a label the template adds, for example.

### A monitor stopped being checked

The form's template attaches the monitor, and declaring a manual incident on a monitor pauses its active monitoring until the incident is resolved. Resolve the incident, or remove the monitor from its **Resources Affected**. See [The incident template](#the-incident-template).

## Where to read next

- [Declaring an Incident](/docs/incidents/declaring-incidents) — the other ways incidents are declared, and what runs when one is.
- [Incident Settings & Automation](/docs/incidents/settings) — incident templates, custom fields and the rules that run on every new incident.
- [Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed) — private notes, public notes and owners.
- [Subscribers & Announcements](/docs/status-pages/subscribers) — who hears about an incident once it is published.
- [Users, Teams & Permissions](/docs/permissions/index) — roles, granular permissions and scope.
