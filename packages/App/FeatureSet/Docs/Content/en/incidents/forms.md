# Incident Forms

An incident form is a page that anyone with its link can fill in to report a problem, without a OneUptime account. Each submission declares an incident in your project, with the answers to the questions you chose, and the incident stays hidden from your status pages until a responder has looked at it.

Use a form when the people who notice a problem are not the people who run your incidents: support agents, colleagues in another department, a store manager, a partner's operations team. They open the link, say what is wrong and press **Submit**. Your team gets an incident like any other — declared from your incident template, if you gave the form one — with the reporter's name and email on a private note.

## At a glance

- **Set up under Incidents → Settings → Forms** — each form has a link of its own, such as `https://oneuptime.com/accounts/incident-form/<share-key>` on OneUptime Cloud.
- **No account needed** — anyone with the link can open the form and submit it, without a OneUptime account and without signing in.
- **You choose the questions** — **Title** is always asked, the description is **Required**, **Optional** or **Hidden**, the severity is the form's or the reporter's, and no custom field is asked until you add it.
- **Declared from a template, if you like** — the form's severity (or the one the reporter chooses) and the reporter's title, description and answers come first, and the template fills in everything else, from on-call policies and owners to monitors and a monitor status change.
- **Hidden until published** — incidents from a form are not shown on status pages and do not notify subscribers when they are declared. A private note records who reported them.
- **Protected in layers** — an **Enabled** switch, an optional **IP Allowlist**, a refusal of requests from other websites, rate limits, the instance's captcha, and size limits on every answer.
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

The public page shows the form's name and description, then the questions below, then **Submit**. It is in the reporter's language when OneUptime has it — the language they last chose in OneUptime on that browser, or else the one their browser asks for — and in English otherwise. The messages quoted on this page are the English ones.

For the title, the description and every text question, an answer of nothing but spaces, tabs or line breaks is empty: a required question answered that way is refused on the page, before anything is sent.

### Title and description

**Title** is always asked and always required, with the hint "A short summary of what is wrong." It becomes the incident's title.

The **Description Question** setting on the **Form Settings** card decides the **Description** question:

- **Optional** — the default. The question is asked and may be left empty.
- **Required** — the question is asked and must be answered.
- **Hidden** — the question is not asked.

The description is written in the Markdown editor, without image upload: somebody without an account cannot upload files. It becomes the incident's description. When the question is hidden or left empty, the incident takes the description of the form's template, if it has one. The editor — here and in every **Rich text (Markdown)** question — shows its own words in the reporter's language too: an empty box says "Type your content here..." in its visual mode, and "Type your markdown here..." in Markdown mode.

### Severity

Every incident a form declares gets the form's **Severity**, unless **Let Reporter Choose Severity** is on. Then the form asks a **Severity** question listing your project's incident severities, and the one the reporter picks is used. Leave it off when reporters should not decide how urgently you are paged: your on-call rules can match on severity.

The template's **Incident Severity** is used only when the form has no severity of its own — after the form's severity was deleted, for example. With neither, every submission is refused with "This form cannot declare an incident because it has no severity. Please let the team that shared it know." Give the form a severity again.

### Custom fields

A form asks no incident custom field until you add it. Open the **Questions** card, edit it, and set each field to:

- **Not Asked** — the default. The field is left off the form.
- **Optional** — the field is asked and may be left empty.
- **Required** — the field is asked and must be answered. A required yes/no field must be switched on.

This is deliberately different from **Show on Create**, which asks for a field in the dashboard's **Details** step. A form is public: every field it asks shows its name and description to anyone with the link, and a dropdown shows every one of its options — internal team names, customer tiers, system names. So a form only asks the fields you chose for it, and a custom field created later stays off every form until you add it there.

The fields are asked in the order the **Questions** card lists them — by their **Order**, the order they are dragged into at **Incidents → Settings → Custom Fields** — each with the input its type calls for, and the answers are checked the way values sent through the API are: a number for a **Number** field, one of the options for a dropdown. The server checks the **Required** ones too, so they hold even for a request made without the page. Answers become the incident's custom field values, on its **Custom Fields** page like any others.

**A field copied from a monitor custom field is not asked when the form's incident template attaches monitors.** The incident takes the monitor's value, as it does when you declare from the dashboard, where the **Declare Incident** form does not ask such a field once the incident has a monitor. The field is left off the public form and is not required, and an answer sent for it anyway is ignored. With no template, or a template without monitors, it is asked as you set it. The **Questions** card says so next to such a field: "Copied from a monitor custom field: not asked when the form's incident template attaches monitors, because the incident takes the monitor's value."

A form's questions are keyed by each field's **Template Variable**, which never changes, so renaming a field keeps it on the form. A template's [Custom Fields on Create](/docs/incidents/settings#custom-fields-on-create) do not apply to forms: the **Questions** card decides what a form asks.

Deleting an incident custom field takes it off the questions of every form in the project, and saving the **Questions** card drops any question whose field no longer exists. A field created later with the same name is not asked until you add it on the card again — unlike a template's **Custom Fields on Create**, which keep their setting for it.

**Edit** on the **Questions** card reads the fields and the form's questions afresh, with a loader in the dialog meanwhile, and **Save** reads them once more and writes only the fields you changed in it. So a change another admin made to other fields in the meantime is kept — a question they gave a field created while your dialog was open included — and a change you made to a field deleted meanwhile is not written. The card then lists the fields as they are. If they cannot be read when you press **Edit**, the dialog says why and offers **Try again** instead of **Save**; when you press **Save**, it says why, saves nothing and keeps your choices.

### Reporter details

**Your Name** and **Your Email** ask who is reporting. With **Require Reporter Details** on — the default — both must be filled in. Turn it off and both become optional, so people can report anonymously.

The email must be one ordinary address, such as `ada@example.com` — not a name with the address in angle brackets, not a list of addresses and not a `mailto:` link. The page refuses anything else with "Email is not valid." before sending it, as the server would.

The name and email are kept on the form's submission and in a private note on the incident, so your team can follow up. OneUptime never emails the reporter.

### What the reporter sees after submitting

The page shows "Thank you — your report was submitted." and the incident's number — "Your report is incident INC-42." — followed by the form's **Success Message**, if you wrote one. Keyboard and screen reader focus moves to that heading, so the confirmation and the number are read out. The success message is Markdown: use it to say what happens next, and where to go when it is urgent. **Submit another report** opens an empty form. The reporter gets no email and no way back to the incident.

## The incident template

Pick an **Incident Template** on the **Incident Settings** card and every incident the form declares is declared from that template, the way the server applies a template anywhere — see [How a template gets applied](/docs/incidents/settings#how-a-template-gets-applied). The form's severity (or the one the reporter chooses) and the reporter's title, description and answers come first, and the template fills in everything else:

- **Initial Incident State** — when the template has none, the incident lands in the project's created state.
- The description, when the form did not ask for one or the reporter left it empty.
- **Resources Affected** — monitors, hosts, Kubernetes clusters, Docker hosts, Podman hosts and services.
- **Limit to these status pages** and **Change Monitor Status to**.
- **On-Call Policy** — the policies are executed as soon as the incident is declared, so a report pages people.
- **Owner - Teams** and **Owner - Users** — added as owners of the incident once its Slack and Microsoft Teams channels exist, so a notification rule that invites incident owners to a new channel invites them too. The incident's **Incident created** notification waits until they are added, so it goes to them rather than to the project's owners, and those who turned on **Added as incident owner** in their notification settings are told they were added as well. See [What owners get notified about](/docs/incidents/notes-owners-and-feed#what-owners-get-notified-about).
- **Labels**.
- **Custom Fields** — the template's values fill in every field the reporter did not answer: the fields the form does not ask, and optional questions left empty. An answer the reporter gave always wins, an unticked yes/no question included. A field copied from a monitor custom field takes the monitor's value instead — see [Custom fields](#custom-fields).

**Mind the monitors.** Declaring an incident on a monitor through a form affects the monitor exactly as declaring an incident on it by hand from the dashboard does. Active monitoring on the monitor pauses until the incident is resolved, so it is not checked in the meantime, and **Change Monitor Status to** changes the monitor's status at once. A monitor's status shows on every status page that lists the monitor, even while the incident itself is hidden. With a form, anybody who has the link can do this. Attach monitors to a form's template only when every report should pause them, and leave **Change Monitor Status to** empty unless every report should change the status your customers see.

## What the incident looks like

An incident reported through a form is an ordinary incident, declared with a few settings of its own:

- **Hidden from status pages.** **Visible on Status Page** is off, and **Notify Status Page Subscribers** is off. Until a responder publishes it, nothing about the incident reaches a status page or a subscriber — apart from a template's monitor status change, above.
- **Not private**, unless one of your privacy rules makes it private.
- **Declared by nobody.** The reporter is not a OneUptime user, so no user is recorded as having declared the incident.
- **A private note records the reporter**: "Reported through the incident form **Report a problem** by Ada Lovelace (<ada@example.com>)." The address is a link that writes to exactly that address — in the dashboard, in Slack and in the owners' "note posted" email. It is written between angle brackets, as here, when it holds nothing but letters, digits, apostrophes and `.`, `-`, `_`, `~`, `$`, `*` or `+`. An address with any other character in it, such as `!`, `#`, `%`, `?` or `^`, is written as an ordinary Markdown link instead, and every such character but `!` is percent-encoded in its `mailto:` address, so every renderer links the whole address. With only a name or only an address, the note gives that one; with neither, it says the incident was reported anonymously.
- **The answers are its fields.** The title, the description and the custom field values are the ones the reporter gave, stored as [Text a reporter writes](#text-a-reporter-writes) describes, with the template's filling in the rest.

Everything that runs for a new incident runs for these too: privacy, owner, label, on-call and runbook rules, on-call policies, and **On Create Incident** workflows. On-call rules match a form's incidents like any others — including on their title and description, which the reporter wrote.

### Text a reporter writes

A report goes straight to places where text can act on its own — the incident's Slack and Microsoft Teams channels, every responder's browser, the owners' emails — and nobody reads it first. So before the incident is stored:

- **Mentions notify nobody.** In the title, the description and every text answer, anything Slack reads as a mention — such as \<!channel\>, \<!here\> or \<@U0123ABC\> — gets an invisible character after its opening bracket. It reads the same everywhere, but no chat tool reads it as a mention. Only what Slack acts on is changed: an HTML comment such as \<!-- note --\>, a \<!DOCTYPE html\> declaration or a PowerShell comment such as \<# ... #\> is stored exactly as typed. The form's name and the reporter's name are treated the same way in the private note, where any Markdown in them shows as typed.
- **Images become links.** In the description and in **Rich text (Markdown)** answers, every image becomes a link to the same address, so nothing is loaded from wherever the reporter chose until a responder clicks it: `![](https://example.com/status.png)` is stored as `\![https://example.com/status.png](https://example.com/status.png)`. An image without alt text takes its address, cut to 80 characters, as the link's text. Image syntax in code is stored exactly as typed where every renderer reads it as code — in a code block whose opening fence is at the very beginning of a line that follows a blank line, or of the text — and so is image syntax that nothing after it could complete, such as `vec![1, 2]`. In any other code, image syntax reads the same, but an invisible character between its `!` and its `[` stops it being an image. That character is really there: a copy of the code keeps it.
- **Diagrams become code.** The dashboard draws a diagram only for a code block whose language is exactly `mermaid`. In a report, a code block whose language holds `mermaid` in any form — in capitals, inside a longer word such as `-language-mermaid`, or with a letter written as a character reference — is stored as a `text` one, and any other `mermaid` on a code block's opening line gets an invisible character before it, so the block shows its code rather than drawing a diagram.

A description or **Rich text (Markdown)** answer longer than 1,000 characters is not read as Markdown for this, only scanned — just as safe, but less tidy. An image in it still becomes a link, and one without alt text still takes its address as the link's text when the address is on the same line. A code block whose fence begins a line after a blank line, as above, is still left as typed, but in other code only image syntax on an indented line, or in a code span that does not run over a line break, gets the invisible character. Anywhere else, image syntax gets a backslash before its `!`, which shows when it is in code, such as a code block in a list or a quote, or in raw HTML. A `mermaid` code block whose fence does not begin a line after a blank line — one in a list or a quote, say — keeps its language, with an invisible character before `mermaid`, and shows as code.

Links, the rest of the Markdown and every other answer — a dropdown option, a number, a date, a yes/no — are stored as the reporter gave them, and the submission keeps the reporter's name and email as typed.

A reporter's title is plain text, but OneUptime places an incident's title into Markdown in many places — an episode's title, chat messages, note templates — so `![` and any `mermaid` after a code fence's backticks in it get the invisible character too. Wherever the title lands, it loads nothing and draws nothing, and it still reads exactly as typed, in an email subject or a text message as well. The invisible characters count towards the title's limit, so a title of nearly 500 characters full of mentions or image syntax can be refused with "Title cannot be more than 500 characters."

Where the feed and chat messages place an incident's title into Markdown — its **Incident Created** item, the item that records a new title, the items for joining or leaving an episode, the note reminders of SLA rules, Microsoft Teams bot replies and on-call messages in Slack and Microsoft Teams — OneUptime escapes `\`, `[`, `]` and \< in the title, for every incident, not only a form's. There, the title can never become an image, raw HTML, a Slack mention such as \<!here\> or a link whose text hides where it goes. It is not always shown exactly as typed, though: an address in it, such as `https://example.com/reset`, still shows as a link to that same address, and `*`, `_`, `~` and backticks can still format it. Where the title is the text of a link to the incident or episode — in the summaries posted to Slack and Microsoft Teams, and the Microsoft Teams bot's list of active incidents — `*`, `_` and backticks in it are escaped as well, so they do not format it there.

### Publishing it

Once a responder has triaged the report and it should be public, turn **Visible on Status Page** on from the incident's **Settings** page. Read what the reporter wrote first: the title and the description show on status pages, and custom fields marked **Include in Subscriber Notifications** go out in subscriber messages. Edit them before you publish.

Because the incident was declared with **Notify Status Page Subscribers** off, publishing it does not send the notification that it was created: the edit form does not offer **Notify subscribers that this incident was created** for it (see [Step 5 — More](/docs/incidents/declaring-incidents#step-5-more)). To tell subscribers, post a public note and tick its **Notify Status Page Subscribers** checkbox, which starts off on such an incident — see [Posting a public note](/docs/incidents/notes-owners-and-feed#posting-a-public-note).

## Sharing the link

The **Share Link** card shows the form's link:

- **Copy Link** copies it.
- **Open Form** opens the form in a new tab, the way reporters see it.
- **Reset Link** gives the form a new link, after you confirm. The old link stops working at once and shows the not-available message, so everybody you shared it with needs the new one. Use it when a link has spread further than it should.

Anyone with the link can open the form and submit it, without a OneUptime account and without signing in. Being signed in changes nothing: OneUptime knows who reported only from the name and email typed into the form. So treat the link like a phone number for your on-call team. Share it where the people who should report will find it — an intranet page, a support runbook, a pinned chat message — and not on a public website, unless you want reports from anyone.

The link carries a random key of its own, not the form's ID. On a self-hosted installation it is served from your own OneUptime host, and works only at the address `HTTP_PROTOCOL` and `HOST` configure. Opened at another name for the server, or at its IP address, the form's requests are refused as coming from another website, and the page says "This form can only be opened from an allowed network." Passkey sign-in works only at that address too.

### Turning a form off

To stop taking reports, turn **Enabled** off on the **Form Details** card. The link then shows "This form is not available. It may have been turned off, or the link may be out of date.", and the **Share Link** card reminds you: "This form is turned off, so its link shows a 'not available' message." Turn it back on and the same link works again.

## Protections

A form is open to anyone with its link, and each submission can page your on-call team, so every request passes several checks:

- **Enabled** must be on — see [Turning a form off](#turning-a-form-off).
- The request must come from the form's own page, not from another website — see [Requests from other websites](#requests-from-other-websites).
- It must come from an address on the **IP Allowlist**, when the form has one.
- It must be within the rate limits.
- A submission must pass the captcha, when the instance has captcha turned on.
- Every answer must be within the size limits and fit its question.

### IP allowlist

To limit a form to your own networks, fill in **IP Allowlist** on the **Access** card, one entry per line: an IPv4 address such as `203.0.113.7`, an IPv6 address such as `2001:db8::7`, or an IPv4 range in CIDR notation such as `10.0.0.0/8`. IPv6 ranges are not supported — list each IPv6 address on a line of its own. An IPv6 address matches however it is written, in capitals or with its zeros spelled out. An IPv4 address, though, must be written as one: written the IPv6 way, such as `::ffff:203.0.113.7` — as a server that also listens on IPv6 may log an IPv4 visitor — it is refused, and the message gives the plain address to write instead. OneUptime compares an IPv4 visitor by its IPv4 address, however that address reached it, so the list's IPv4 entries and ranges match it. Only requests from those addresses can open or submit the form, and everybody else sees "This form can only be opened from an allowed network." A request whose address OneUptime cannot tell is refused too. Leave the list empty to allow every address: a `/0` range does not, and is refused.

The list is checked whenever it is saved — from the dashboard, the API, Terraform or a workflow — and a line that could never match is refused with a message that names it. A list whose second line is an IPv6 range, for example, is refused with:

"IP Allowlist: line 2 ("2001:db8::/32") is an IPv6 range, and only IPv4 ranges are supported - list each IPv6 address on a line of its own. Put one IPv4 or IPv6 address, or one IPv4 range such as 10.0.0.0/8, on each line."

The first five lines that are not valid are named. The list is kept exactly as you wrote it.

On OneUptime Cloud, editing the IP allowlist needs the **Scale** plan, like the IP allowlist of a [public dashboard](/docs/dashboards/sharing).

### Requests from other websites

A browser tells a server which page sent a request. When another website's page makes a visitor's browser open or submit a form, the request is refused with "This form can only be used from its own page." — before any rate limit counts it, and whatever the link, so the answer says nothing about which forms exist. Without this, any website could have the browsers of people inside your allowed networks submit your form, or use up their network's rate limits.

A request is refused when its `Sec-Fetch-Site` header is there and says anything but `same-origin` or `none`, or when its `Origin` header is there and is not your OneUptime address — `HTTP_PROTOCOL` and `HOST`, such as `https://oneuptime.example.com`, with the port when `HOST` has one. A submission must also be sent as JSON (`application/json`): one sent as a web page's form fields, or as plain text, is refused with "The request must be a JSON object holding the form's answers in "data".", again before anything is counted.

Reading a form also needs the header the form's page adds to every request it makes, `X-OneUptime-Incident-Form: 1`. Without a script, a page cannot have a browser add a header to a request, and another website's script that adds one gives itself away with its `Origin`. So a read without the header is refused the same way, before anything is counted — even over plain HTTP, where a browser sends another site's image or link request with neither `Sec-Fetch-Site` nor `Origin`, and such a page could otherwise use up the read limits of everybody behind its visitors' address. That includes the API's address opened in a browser's address bar, and `curl` or a script that leaves the header out. A submission needs no such header: a browser always sends one with its `Origin`, and it must be JSON. Requests that no browser page sent — `curl`, a script, a server — carry neither `Sec-Fetch-Site` nor `Origin`, and still meet every other check.

These checks cannot tell your OneUptime's own pages from a page the browser takes for one of them: a page on a host name somebody pointed at your OneUptime server's address, over plain HTTP (DNS rebinding — over HTTPS, the certificate gives it away), or the [custom JavaScript](/docs/status-pages/branding-and-domains#custom-html-css-and-javascript) of a status page on a custom domain your OneUptime serves. Holding a form's link, such a page can read the form — its name, description, questions and dropdown options — through the browser of a visitor inside the form's **IP Allowlist**, but it cannot submit it: a submission carries that page's own `Origin`, and is refused. OneUptime does not check the `Host` header against its address, which would break installations behind a proxy that rewrites it. So an allowlist stops others from reporting through a form, but not a page like that from reading its questions.

### Rate limits

Opening a form and submitting it are limited per network address, and submitting is limited per form as well:

- **Opening a form** — per form from one address, and per address across every form, with room for a whole office opening the link at once. Past either, the page shows "Too many requests. Please try again later." If the rate limiter cannot be reached, forms still open.
- **Submitting, per address** — per form from one address, and per address across every form. Past either, the reporter sees "Too many submissions from your network. Please wait a few minutes and try again." Everybody behind one address — an office network, a VPN gateway — shares these limits, and every submission counts, even one that is then refused for a wrong answer.
- **Submitting, per form** — how many incidents one form may declare in an hour, from every address together, so even reports from many addresses at once can only page you a limited number of times an hour. Only a submission that passed every other check counts, right before its incident is declared: a refused request never uses it up. Past it, everybody sees "This form is receiving too many reports right now. Please try again later." until the hour is over.

Every limit answers `429` with a `Retry-After` header, in seconds, until its window ends, and the page tells the reporter when to try again. The windows are fixed, not rolling: with the defaults, the per-form limit starts again on every full hour and the per-address submission limits every quarter of an hour. A request refused as coming from another website, or as not being JSON, is refused before it is counted. If the rate limiter cannot be reached, submissions are refused rather than let through: the API answers `503`, and the reporter sees "Reports cannot be accepted right now. Please try again in a few minutes."

On a self-hosted installation, these environment variables of the OneUptime app change the limits:

| Variable                                                     | Default | What it sets                                                                  |
| ------------------------------------------------------------ | ------- | ----------------------------------------------------------------------------- |
| `INCIDENT_FORM_RATE_LIMIT_WINDOW_SECONDS`                    | `60`    | The window for opening forms, in seconds.                                     |
| `INCIDENT_FORM_RATE_LIMIT_PER_FORM_AND_IP_PER_WINDOW`        | `120`   | How often one address may open one form per window.                           |
| `INCIDENT_FORM_RATE_LIMIT_PER_IP_PER_WINDOW`                 | `600`   | How often one address may open forms per window, across every form.           |
| `INCIDENT_FORM_SUBMIT_RATE_LIMIT_WINDOW_SECONDS`             | `900`   | The window for the per-address submission limits, in seconds.                 |
| `INCIDENT_FORM_SUBMIT_RATE_LIMIT_PER_FORM_AND_IP_PER_WINDOW` | `10`    | Submissions to one form from one address per window.                          |
| `INCIDENT_FORM_SUBMIT_RATE_LIMIT_PER_IP_PER_WINDOW`          | `30`    | Submissions from one address per window, across every form.                   |
| `INCIDENT_FORM_SUBMIT_RATE_LIMIT_PER_FORM_WINDOW_SECONDS`    | `3600`  | The window for the per-form limit, in seconds.                                |
| `INCIDENT_FORM_SUBMIT_RATE_LIMIT_PER_FORM_PER_WINDOW`        | `60`    | Incidents one form may declare per window, from every address together.       |

Neither `config.env` nor the Helm chart's values pass them on: add them to the environment of the `app` container yourself — with `app.extraEnv`, or the chart-wide `extraEnv`, in the Helm chart, or in a `docker-compose.override.yml` for Docker Compose. `TRUSTED_PROXY_HOPS` decides which address the per-address limits count.

### Captcha

When your OneUptime instance has hCaptcha turned on, the form shows a captcha, and a submission that has not passed it is refused. There is no per-form setting. A self-hosted installation turns captcha on with `CAPTCHA_ENABLED`, `CAPTCHA_SITE_KEY` and `CAPTCHA_SECRET_KEY` — the same settings that protect sign-up. Without it, the rate limits and the IP allowlist carry the load.

### Size limits

| Question                  | Limit                                                                        |
| ------------------------- | ---------------------------------------------------------------------------- |
| **Title**                 | 1 to 500 characters, not counting spaces at either end.                      |
| **Description**           | Up to 20,000 characters.                                                     |
| A custom field's answer   | Up to 10,000 characters of text.                                             |
| A multi-select answer     | Up to 100 choices, or as many as the field has options, when that is more.   |
| **Your Name**             | Up to 100 characters.                                                        |
| **Your Email**            | A valid email address, up to 100 characters.                                 |

A submission that breaks a limit, leaves out a required answer or gives an answer that does not fit its field is refused with a message that says which, and no incident is created. A severity must be one of your project's, and answers to fields the form does not ask are ignored. Only a multi-select takes a list, and only a list of its options: a list sent for another field is refused ("Impact takes one answer, not a list."), and so are lists or objects inside a multi-select's answer ("Affected Systems takes a list of its options, not lists or objects within it.") and a list past the limit above ("Affected Systems cannot have more than 100 choices."). An answer that is an object is refused before anything reads it ("Impact takes one answer, not an object.", or "Affected Systems takes a list of its options, not an object." for a multi-select), while an answer of `null` counts as no answer.

## Submissions

The **Submissions** card lists the reports made through the form, with **Submitted At**, **Reporter Name**, **Reporter Email** and **Incident**. **View Incident** opens a report's incident.

Submissions are written by the form, never by hand, and cannot be edited. Delete one to remove the reporter's name and email from the list; the incident stays. The incident's private note repeats the name and email, so when you remove somebody's personal data, edit or delete that note too.

A submission is listed only for the people who can see its incident:

- **A private incident's submission** is listed only for the people who can see that incident.
- **A role scoped to Owned** lists only the submissions of the incidents its holder owns, personally or through a team, and a role scoped to **Labels** only those of the incidents that carry its labels.
- **Deleting an incident** keeps its submission, without the link to the incident. Nothing then records whether that incident was private, so from then on only project owners and project admins see the submission, and only they can delete it. To remove a reporter's details as an incident admin, delete the submission before the incident.
- **Deleting a form** deletes its submissions too. The incidents it declared stay.

## Permissions

A form lets people outside your team page your on-call team, so forms are managed by incident admins. Forms have six granular permissions of their own, in the **Incident** group of the [Permission Reference](/docs/permissions/reference):

| Permission                          | What it allows                                                                                         | Roles that include it                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| **Create Incident Form**            | Creating forms.                                                                                        | Project Owner, Project Admin, Incident Admin                                                          |
| **Edit Incident Form**              | Changing a form: its settings, its questions, **Enabled**, the **IP Allowlist** and **Reset Link**.     | Project Owner, Project Admin, Incident Admin                                                          |
| **Delete Incident Form**            | Deleting a form, and with it its submissions.                                                          | Project Owner, Project Admin, Incident Admin                                                          |
| **Read Incident Form**              | Seeing forms, their settings and their links.                                                          | All of the above, plus Project Member, Viewer, Incident Member and Incident Viewer                    |
| **Delete Incident Form Submission** | Deleting the submissions of the incidents you can see.                                                 | Project Owner, Project Admin, Incident Admin                                                          |
| **Read Incident Form Submission**   | Seeing a form's **Submissions**, for the incidents you can see.                                        | Project Owner, Project Admin, Project Member, Viewer, Incident Admin, Incident Member, Incident Viewer |

Project Members and Incident Members can declare incidents and edit incident templates, but not create or change forms. Anyone who can read a form can see and share its link. Submitting a form needs no permission at all. A submission whose incident was deleted is listed, and can be deleted, only by project owners and project admins — see [Submissions](#submissions). For how roles and granular permissions combine, see [Users, Teams & Permissions](/docs/permissions/index).

## Plan

On OneUptime Cloud, incident forms need the **Growth** plan or above, like incident templates, and editing a form's **IP Allowlist** needs **Scale**. The links of a project below the **Growth** plan, or whose subscription is unpaid, show the not-available message, and nothing is declared.

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

`customFieldSettings` holds the **Questions**, keyed by each field's **Template Variable**: `Required` and `Optional` ask a field, and a field that is not listed is not asked — as with `Hidden` or `Default`. `descriptionSetting` is `Required`, `Optional` or `Hidden`. `ipWhitelist` holds the **IP Allowlist**, one entry per line, and is checked as described in [IP allowlist](#ip-allowlist) whoever writes it. `shareKey`, the key in the form's link, is set by OneUptime when the form is created, and changing it is what **Reset Link** does.

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

The list holds only the submissions of the incidents the key can see, as the dashboard's does. Forms have the generated workflow components — **On Create Incident Form**, **On Update Incident Form** and so on — and submissions have none. To act on a reported incident, use **On Create Incident**. The [API reference](/reference) has the full request and response shapes.

### The public page's own endpoints

The public page talks to two routes that need no API key: `GET /api/incident-form/public/<shareKey>`, which returns the form's name, description and questions, and `POST /api/incident-form/public/<shareKey>/submit`, which submits it. They are the page's own endpoints, not an API to build on: every call goes through the form's protections, and they change with the page. A request another website's page sent gets a `403`, and so does a read without the page's `X-OneUptime-Incident-Form: 1` header; the submit route takes only a JSON body, whose `captchaToken` may be at most 16,384 characters long. To declare incidents from your own code, use `POST /api/incident` with an API key — see [Declaring through the API](/docs/incidents/declaring-incidents#declaring-through-the-api).

## Troubleshooting

### The link says the form is not available

"This form is not available. It may have been turned off, or the link may be out of date." The page gives the same answer whatever the reason, so it never tells a stranger whether a form exists:

- **Enabled** is off on the **Form Details** card.
- The link was replaced with **Reset Link**. Share the new one.
- The form was deleted.
- On OneUptime Cloud, the project is below the **Growth** plan, or its subscription is unpaid.
- The link was cut short when it was copied.

### The form can only be opened from an allowed network

"This form can only be opened from an allowed network." The reporter's address is not on the form's **IP Allowlist**: add their network, or empty the list. An IPv6 network can only be listed address by address. On a self-hosted installation behind a proxy or load balancer, check `TRUSTED_PROXY_HOPS` — when it is too low, OneUptime sees your proxy's address instead of the reporter's. The page says the same when the form was opened at another address than your OneUptime's own — see the next entry.

### The form can only be used from its own page

"This form can only be used from its own page." is what the API answers a request that a page other than your OneUptime's own had a browser send: another website, or the form opened at another name for your server or at its IP address. The form's page shows "This form can only be opened from an allowed network." for it. It is also the answer to a read of a form without the header the form's page sends — the API's address opened in a browser's address bar, say. Open the link exactly as the **Share Link** card shows it. On a self-hosted installation, `HTTP_PROTOCOL` and `HOST` must be the address people open OneUptime at.

### Too many submissions from your network

"Too many submissions from your network. Please wait a few minutes and try again." Everybody behind one address — an office network, a VPN gateway — shares the per-address limits, which matters during a large outage, when many people report at once. Ask them to wait a few minutes; the page says when to try again, and the first report is usually enough. On a self-hosted installation, check `TRUSTED_PROXY_HOPS` as above: when it is too low, every reporter shares your proxy's address. Opening forms too often from one address shows "Too many requests. Please try again later." for the same reason.

### This form is receiving too many reports

"This form is receiving too many reports right now. Please try again later." The form has declared as many incidents this hour as it may, from every address together. It is not about the reporter's network, and `TRUSTED_PROXY_HOPS` does not change it. Reports are taken again from the next full hour, and the page says when. During a real outage, the reports you already have are usually enough. If the reports are not genuine because the link spread further than it should, **Reset Link** stops the old link at once and starts the new one with a fresh allowance; everybody who should report then needs the new link. A self-hosted installation can change the limit — see [Rate limits](#rate-limits).

### Reports cannot be accepted right now

"Reports cannot be accepted right now. Please try again in a few minutes." The rate limiter could not be reached, so submissions are refused rather than let through uncounted. Opening the form still works. On a self-hosted installation, check that Valkey, the cache the rate limiter counts in, is up and reachable from the OneUptime app.

### A submission is refused

The message says what is wrong: a required answer is missing or only spaces, an answer is too long or does not fit its field, or the email address is not one ordinary address. "Captcha verification failed. Please try again." means the captcha was not passed, or has expired: solve it again. On a self-hosted installation where every submission fails the captcha, check that `CAPTCHA_SITE_KEY` and `CAPTCHA_SECRET_KEY` are both set — sign-up fails the same way.

### A custom field is not on the form

Custom fields are **Not Asked** until you add them on the form's **Questions** card, whatever their **Show on Create** and **Required on Create** say. A field copied from a monitor custom field is also left off while the form's template attaches monitors, and a field deleted and created again is not asked until you add it again. See [Custom fields](#custom-fields).

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
