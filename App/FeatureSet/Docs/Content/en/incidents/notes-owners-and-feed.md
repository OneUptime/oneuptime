# Notes, Owners & Feed

Every incident accumulates a written record while you work it. Some of that record is for your customers — the update that goes out on the status page at 02:14 saying you've found the bad deploy. The rest is for your team — the stack trace someone pasted, the graph that finally made sense, the decision to fail over.

OneUptime keeps those two audiences apart. **Public Notes** publish to your status page and can notify subscribers. **Private Notes** (the `IncidentInternalNote` model) stay inside the dashboard. Underneath both sits the **Incident Feed**, an append-only timeline that records everything that happened to the incident, and the **Owners** list, which decides who gets told.

All of it hangs off the incident's left side menu: **Notes → Public Notes**, **Notes → Private Notes**, and **Team → Owners**. The feed lives on the incident **Overview** page.

## Public notes vs private notes

The two note types look similar in the dashboard and behave very differently.

- **Public notes** — the `IncidentPublicNote` model, served to status pages as part of the incident timeline. They carry a **Posted At** date you can set yourself and a **Notify Status Page Subscribers** checkbox.
- **Private notes** — the `IncidentInternalNote` model. Nothing in the status page app reads them. They have no posted-at field (the list is stamped and sorted by `createdAt`) and no subscriber fields at all, so a private note can never trigger a subscriber notification.

**What "private" actually means.** It means "not published to the status page" — not "restricted to a smaller group of people". Both note types share the same read permissions, so anyone who can read the incident can read its private notes. If you need to restrict who can see an incident at all, use the **Private Incident** flag (`isPrivate`) on the incident itself, which hides the incident from every status page and limits it to the incident's owner users, the members of its owner teams, and project admins and owners.

**Owners see both.** The owner notification job queries public and private notes together. A private note is private from your subscribers, not from the people responding.

| If you want to…                                        | Pick             |
| ------------------------------------------------------ | ---------------- |
| Tell customers what you know and when you'll know more | **Public Note**  |
| Backdate an update you already sent somewhere else     | **Public Note**  |
| Record a hypothesis, a command you ran, or a dead end  | **Private Note** |
| Attach a heap dump or an internal dashboard screenshot | **Private Note** |

## Posting a public note

Open **Notes → Public Notes** in the incident side menu and create a note. The card explains that what you write here shows up on the status page; the empty state reads that no public notes have been created for this incident so far.

| Field                              | Purpose                                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Public Incident Note**           | The body, in Markdown. Required. The form reminds you the note is visible on your status page and links a cheatsheet. |
| **Attachments**                    | Files shared with subscribers on the status page. Optional.                                                           |
| **Notify Status Page Subscribers** | Checkbox, on by default. Turn it off to publish quietly.                                                              |
| **Posted At**                      | Required date and time, defaulting to now, shown in your current timezone.                                            |

**Posted At is the note's real timestamp.** Status pages sort and display public notes by `postedAt`, not by when you typed them — so if you're catching the status page up on an update you sent 40 minutes ago, set **Posted At** to when it actually happened. If a note arrives through the API without one, OneUptime stamps the current time.

The list shows who wrote each note, its **Posted At**, the rendered Markdown with its attachments, and a **Subscriber Notification Status** column. You can filter by **Created By**, **Note**, and **Created At**.

## Posting a private note

**Notes → Private Notes** is deliberately plainer. There are only two fields:

- **Private Incident Note** — Markdown body, required. The form says outright that this is private to your team and is not visible on the status page.
- **Attachments** — files meant for the incident response team.

No **Posted At**, no subscriber checkbox — the note is stamped when it is created.

## Attachments on notes

Both note types accept file attachments through an **Attachments** field, and both render an attachment list under the note body with a per-file **Download attachment** link.

Where they diverge is who can fetch the file:

- **Public note attachments** are downloadable by status page visitors through a status page route, alongside the note itself.
- **Private note attachments** are only reachable through the authenticated dashboard API. There is no status page route for them.

That makes attachments the same public/private decision as the note text. A customer-facing timeline image goes on a public note; a config dump goes on a private one.

## Generating a note with AI

Both note pages carry a **Generate with AI** button. It sends the incident to your project's AI provider and drops the generated Markdown into the note editor, where you edit it before saving — nothing is published automatically.

- **Generate Public Note with AI** — described as analyzing the incident data to produce a customer-facing note. Templates include **Status Update** and **Resolution Notice**.
- **Generate Private Note with AI** — produces an internal technical note instead. Templates include **Investigation Update** and **Technical Analysis**.

Behind the button, the dashboard posts to `/incident/generate-note-from-ai/{incidentId}` with the chosen template and a note type of `public` or `internal`.

## Note templates

If your team writes the same three updates every outage, save them once. Both note pages have a **Create from Template** button that opens a **Create Note from Template** picker with a **Select Note Template** dropdown.

Templates are shared between public and private notes: a single template list serves both, and the same template can be inserted into either kind of note.

You manage them at **Incidents → Settings → Note Templates** — the card is titled **Public or Private Note Templates for Incidents** and its form has a **Template Info** step (**Template Name** and **Template Description**, both required) and a **Note Details** step for the body. If you click **Create from Template** before creating any, OneUptime tells you none exist yet; note that the message points at Project Settings, but the page actually lives under **Incidents → Settings → Note Templates**.

## Posting notes from Slack or Microsoft Teams

If you've connected a workspace, responders never have to leave the channel. Both Slack and Microsoft Teams expose an add-note action that opens a modal with a dropdown offering **Public Note** or **Private Note** plus a text box, and writes the result straight onto the incident.

Two details worth knowing:

- **Duplicate protection** — each note records the Slack message it came from (`postedFromSlackMessageId`, formatted `channel_id:message_ts`), so several people reacting to the same message produce one note, not five.
- **Notes echo back** — posting either kind of note also pushes a message into the connected incident channel, because the note's feed item is created with workspace notification enabled.

## When a public note actually reaches subscribers

Creating a public note with **Notify Status Page Subscribers** on does not by itself guarantee an email goes out. The note has to clear a chain of checks, and every failure records a specific reason rather than erroring:

1. **Notify Status Page Subscribers** must be on. If it isn't, the note is stamped as skipped the moment it's created.
2. The note must belong to an incident that still exists.
3. The incident must have at least one monitor attached — with no monitors there is no status page resource to route the note to.
4. The incident's **Visible on Status Page** flag (`isVisibleOnStatusPage`) must be true.
5. Each status page the incident reaches must have **Show Incidents** (`showIncidentsOnStatusPage`) turned on.
6. Each subscriber must pass their own preferences — not unsubscribed, and subscribed to this resource and to the `Incident` event type where the page lets subscribers choose.

**Notifications are not instant.** The job that sends them runs once a minute, so expect up to about a minute between saving the note and mail leaving. That is what the **Sending Soon** label means.

The **Subscriber Notification Status** column tracks the whole journey:

| Status                       | What it means                                          |
| ---------------------------- | ------------------------------------------------------ |
| **Notifications skipped.**   | One of the gates above closed. The reason is recorded. |
| **Sending Soon**             | Queued, waiting for the next run of the send job.      |
| **Notifications Being Sent** | The job is working through the subscriber list.        |
| **Notifications Sent**       | Every subscriber notification went out.                |
| **Failed**                   | The job threw; the error is stored with the note.      |

Click **more details** on the status to open **Notification Status Details**. Where a resend makes sense, that modal's button is **Retry**, which puts the note back in the pending state so the next run picks it up again.

The actual message subscribers get is templated per status page and per channel — email, SMS, Slack and Microsoft Teams each have their own template for the **Subscriber Incident Note Created** event, with variables for the status page name and URL, the details link, the resources affected, the incident severity and title, the note body, and a per-subscriber unsubscribe link. See [Subscribers & Announcements](/docs/status-pages/subscribers) for how those templates and channels are configured.

## The incident feed

The **Incident Feed** card sits at the bottom of the left column on the incident **Overview** page. It's the story of the incident in order: every item is an icon, the avatar and name of whoever caused it, a relative timestamp with the exact local time on hover, and a Markdown body. Items are sorted oldest first.

Some items carry extra detail — an owner notification lists everyone who was mailed, for example. Those show a **More Information** button that opens a **More Information** panel.

The card header also has an **Actions** menu so you can act without leaving the timeline:

- **Execute Runbook** — start a [runbook](/docs/runbooks/index) against this incident.
- **Execute On-Call Policy** — page a policy on demand.
- **Add Public Note** — the same four fields as the Public Notes page, in a modal.
- **Add Private Note** — note body and attachments only.

Next to it, **Refresh** re-fetches the feed.

**The feed is append-only, and it is not your audit log.** The API allows creating and reading feed items but not updating or deleting them, so nobody can quietly rewrite the history of an incident. It is not permanent either: on billed installations, feed rows older than three years are removed. For a durable record of who changed what, use **Audit → Audit Logs** in the incident side menu.

## What the feed records

Feed items are written by the incident service itself, by both note services, by the state timeline, by owner and member changes, by the rule engines, by on-call execution, by the AI investigation and postmortem runners, and by the notification cron jobs. The event types cover:

- **The incident itself** — `IncidentCreated`, `IncidentUpdated`, `IncidentStateChanged`.
- **Notes and write-ups** — `PublicNote`, `PrivateNote`, `RootCause`, `RemediationNotes`, `PostmortemNote`.
- **People** — `OwnerUserAdded`, `OwnerTeamAdded`, `OwnerUserRemoved`, `OwnerTeamRemoved`, `IncidentMemberAdded`, `IncidentMemberRemoved`.
- **Notifications** — `OwnerNotificationSent`, `SubscriberNotificationSent`, `OnCallPolicy`, `OnCallNotification`.
- **Automation** — `LabelRuleExecuted`, `OwnerRuleExecuted`, `PrivacyRuleExecuted`, `OnCallRuleExecuted`, `AutoRemediation`.

Each type gets its own icon, so you can scan a long feed and pick out the state changes from the chatter. AI-generated root cause analysis is marked distinctly and rendered in a restricted Markdown mode.

Feeds respect incident privacy: for private incidents, feed reads are filtered the same way the incident is.

## Owners

Owners are the people and teams responsible for an incident. They are the notification target for everything that happens to it — and they're the reason an incident doesn't go unnoticed while everyone assumes someone else is on it.

Open **Team → Owners** in the incident side menu. The **Owners** card shows a count badge and describes owners as the people and teams responsible for this incident who are notified about changes, with a running count like "2 people · 1 team". Owners render as overlapping avatars; hovering one shows the person's email or marks the entry as a **Team**.

- Click **Add owner** to open a picker with a search box for people or teams.
- Click the remove control on an avatar to open the **Remove owner** confirmation, then **Remove**.
- With no owners yet, the card says so and invites you to add a teammate or a team so they get notified about changes.

Owner users and owner teams are separate records — adding a team makes every member of that team an owner for notification purposes without listing them individually.

## How owners get assigned

There are four routes onto the owners list:

- **From an incident template** — templates carry **Owner - Teams** and **Owner - Users** fields, described as the teams and users who own the incident and will be notified when it is created or updated. Creating an incident from the template prefills them. See [Declaring an Incident](/docs/incidents/declaring-incidents).
- **From Incident Owner Rules** — matching rules add owners automatically at creation time.
- **At creation through the API** — owner users and teams passed with the create call are added immediately, with a flag that controls whether they get the "you were added" email.
- **By hand** — the **Add owner** control on the **Owners** page, at any point during the incident.

Adding the same person twice is safe; owners already assigned are not duplicated.

## Incident owner rules

**Incident Owner Rules** auto-assign owner users and teams when matching incidents are created — the routing layer that means a database incident lands on the database team without anyone thinking about it. You'll find them with the rest of the incident automation covered in [Incident Settings & Automation](/docs/incidents/settings).

The rule form has three steps — **Basic Info**, **Match Criteria** and **Owners** — and the owners step holds two sections:

- **Owners to Assign** — pick **Owner Teams** and **Owner Users**. When the rule matches, every selected user and team is added as an owner, and already-assigned owners are not duplicated.
- **Inherit Owners** — assign owners from related entities instead of naming them. **Inherit Owners From Monitors** makes every owner of the incident's monitors an owner of the incident, and **Inherit Owners From Hosts**, **… From Kubernetes Clusters**, **… From Docker Hosts**, **… From Podman Hosts** and **… From Services** do the same for those resources.

A **Notify Owners** toggle controls whether people find out. Leave it on for real routing; turn it off to add owners silently — useful when a rule is a bookkeeping convenience rather than a page.

Every rule execution is written to the incident feed, so you can always tell whether a person was added by a rule or by a human.

## What owners get notified about

Five jobs notify owners, each running once a minute:

- **Incident created** — subject `[New Incident {number}] - {title}`.
- **A note was posted** — for public *and* private notes, subject `[Update Incident {number}] - {title}`.
- **The incident state changed** — see [Incident States & Severities](/docs/incidents/states-and-severities).
- **You were added as an owner** — subject `You have been added as the owner of Incident {number} - {title}`.
- **Still unresolved** — a reminder driven by the incident's next-reminder time, subject `[Reminder] Incident {number} is still {state} - {title}`.

Each notification is built for email, SMS, voice call, push and WhatsApp and handed to the user's notification settings, which decide what actually gets sent. Every recipient can turn off each of these individually — the per-user settings are worded as sending you the incident created, note posted, state changed, owner added, member assigned, and still-open reminder notifications. Somebody who only wants a call for state changes can have exactly that.

**Ownerless incidents are not silent.** If an incident has no owners at all, the notification jobs fall back to the project's owners, so nothing is dropped on the floor. Every person notified is also appended to the matching feed item, so you can see afterwards exactly who was told and at which address.

## Where to read next

- [Incidents Overview](/docs/incidents/index) — what an incident is and how the pieces fit together.
- [Declaring an Incident](/docs/incidents/declaring-incidents) — creating incidents by hand, from templates, and from monitors.
- [Incident States & Severities](/docs/incidents/states-and-severities) — the state machine that drives half the feed.
- [Incident Settings & Automation](/docs/incidents/settings) — owner rules, note templates, and the rest of the automation.
- [Subscribers & Announcements](/docs/status-pages/subscribers) — where public notes end up and who receives them.
- [Status Pages Overview](/docs/status-pages/index) — the customer-facing side of an incident.
