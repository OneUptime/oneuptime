# Status Pages Overview

A status page is the public face of everything you monitor: one URL your customers can open instead of emailing you to ask whether it's just them. It shows the current state of the services you choose to expose, the incidents you're working on, the maintenance you have planned, and any announcement you want to pin to the top.

When something breaks at 2am, the status page is the first thing your support queue links to. It is also the thing your subscribers get notified from — so it is worth setting up before you need it, not during the outage.

Status pages live under **Status Pages** in the dashboard's left navigation, in the **essentials** group. Everything on this page is per-status-page: a project can run as many of them as it likes — a public one for customers, a private one for an internal audience, a per-region one for a specific market.

## At a glance

- **Created with two fields.** A new status page only asks for **Name** and **Description**. Resources, branding and domains are all configured afterwards.
- **Resources are what visitors see.** Each row on the page is a **Status Page Resource** — a monitor (or monitor group) with its own display name, tooltip and uptime options. Groups split a long page into sections and can be nested.
- **A preview URL from day one.** Every status page gets a preview link so you can look at it before a custom domain exists.
- **Visitor-facing routes are gated by settings.** Incidents, episodes, announcements and scheduled events each appear only while their switch in **What your status page shows** (on **Advanced Settings**) is on, and the subscribe page only while **Show Subscriber Page** is on.
- **Who can see it is one choice.** Anyone with the link, only people who sign in (private users, SAML SSO or OIDC), or anyone with the password — on the page's **Access** screen, with an optional IP allowlist under **More settings**.
- **Subscribers get told automatically.** Email, SMS, Slack, Microsoft Teams and webhook subscribers can all follow a page, each channel behind its own toggle.

## Key terms

| Term              | What it means                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Status page**   | One public (or private) page, with its own branding, domains, resources and subscribers. The `StatusPage` model.                    |
| **Resource**      | One row visitors see — a monitor or monitor group surfaced on the page with a display name and uptime options.                      |
| **Group**         | A named section that holds resources. Groups nest inside other groups, and each level rolls up the status of everything beneath it. |
| **Announcement**  | A message you post to one or more status pages, with a start time and an optional end time.                                         |
| **Subscriber**    | Someone (or something) following the page over email, SMS, Slack, Microsoft Teams or a webhook.                                     |
| **Custom domain** | A domain of yours — `status.example.com` — pointed at the page with a CNAME and an SSL certificate.                                 |
| **Private user**  | An account that can log in to a private status page. Separate from your OneUptime project users.                                    |

## Creating a status page

1. Open **Status Pages → All Status Pages** and click **Create Status Page**.
2. In the **Create New Status Page** modal, fill in **Name** (required, at least two characters) and, optionally, **Description**.
3. Click **Create Status Page**.

That's the whole create form. The list you land back on shows **Name**, **Description**, **Labels** and **Owners**, and can be filtered by **Status Page ID**, **Name** and **Description**.

Open the new page and you land on its **Overview** screen, which carries two cards: **Status Page Preview URL** with a link to the page itself, and **Status Page Details** where you can edit the name, description and labels you just set.

Next, in rough order of usefulness:

- Add resources so the page has something on it — see [Status Page Resources & Groups](/docs/status-pages/resources-and-groups).
- Set the page title, favicon, logo and cover, then attach a custom domain — see [Status Page Branding & Domains](/docs/status-pages/branding-and-domains).
- Decide which channels people can subscribe on — see [Subscribers & Announcements](/docs/status-pages/subscribers).
- Tune what appears on the page under **Advanced Settings**.

## Where everything lives

Once a status page is open, its own left side menu is grouped into nine sections. Use this as a map for the rest of this documentation group.

| Section               | What's in it                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Basic**             | **Overview**, **Announcements**, **Owners**.                                                                                                   |
| **Resources**         | A single **Resources** screen — groups on the left, the selected group's monitors on the right — and **Monitor Rules**.                       |
| **Subscribers**       | **Email Subscribers**, **SMS Subscribers**, **Slack Subscribers**, **MS Teams Subscribers**, **Webhook Subscribers**, **Subscriber Settings**. |
| **Notification Logs** | **Notification Logs** — what was sent to subscribers.                                                                                          |
| **Branding**          | **Branding** (logo, title, favicon, links, footer, colors and languages, on one page), **Custom Domains**, **HTML, CSS & JavaScript**.         |
| **Security**          | **Access** (who can see the page), **Private Users**, **SSO**, **OIDC**, **SCIM**.                                                             |
| **AI**                | **MCP**.                                                                                                                                       |
| **Developer**         | **Terraform**, **API**, **AI Assistants** — the page as code.                                                                                  |
| **Advanced**          | **Embedded Status**, **Reports**, **Custom Fields**, **Advanced Settings**, **Audit Logs**, **Delete Status Page**.                            |

Only **Basic** and **Resources**, what the page shows, start open. Every other section starts collapsed, like the rarely used sections of every menu in OneUptime: click a section's title to show its pages. A section opens by itself whenever you are on one of its pages, such as **Advanced Settings** or **Email Subscribers**.

Two naming quirks worth knowing before you go looking:

- The **Resources** item is only labeled **Resources** when the project has monitor groups enabled. Otherwise it reads **Monitors**. It is the same screen either way.
- There is no separate Groups page. Groups and resources were merged, and the old `/groups` route now redirects to the resources screen.

Outside an individual page, the **Status Pages** section itself lists **All Status Pages**, and a **More** section holds **Announcements**. A collapsed **Settings** section holds **Announcement Templates**, **Subscriber Templates**, **Custom Fields**, **Owner Rules** and **Label Rules**, which are project-wide and shared across every status page. A collapsed **Advanced** section holds **Archived**: the status pages you took offline (see [Archiving a status page](#archiving-a-status-page)).

**Label Rules** and **Owner Rules** label new status pages and give them owners. A rule takes two steps — **Match**, the conditions a status page must meet, then **Labels** (or **Owners**), what the rule adds — and its **Name** is filled in from what you pick. A new rule has to add at least one label or owner; editing one never insists, and the list marks an older rule that adds nothing **Adds nothing**. See [Label and Owner Rules](/docs/configuration/label-and-owner-rules).

## What visitors see

The public page is its own app, with a small set of routes:

- `/` — the **Overview**.
- `/incidents` and `/incidents/:id` — the incident list and a single incident.
- `/announcements` and `/announcements/:id`.
- `/scheduled-events` and `/scheduled-events/:id`.
- `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams`, `/subscribe/webhooks`.
- `/rss` — the feed.
- `/login`, `/sso` and `/master-password` — only relevant on a private page.

The top nav bar always shows **Overview**; the rest appear only when enabled. **Incidents**, **Announcements** and **Scheduled Events** each need their toggle on; **Subscribe** needs both **Show Subscriber Page** and at least one subscriber channel enabled. A private page also gets a **Logout** item.

A single incident, episode, announcement or scheduled event opens only when the page would list it, whatever its history window: a private incident or episode, one hidden from status pages, a scheduled event hidden from status pages, or an announcement scheduled for later is not found by its link either.

### The overview page

The overview is the page most visitors ever see. Top to bottom it renders:

1. **Any live announcements** — announcements whose start time has passed and whose end time hasn't.
2. **An overall status banner** — a single line summarizing whether all or only some resources are affected.
3. **An overall uptime percent**, if you turned it on: at the end of the overall status banner, while every resource is operational. Off by default.
4. **The resource groups**, each with its resources, their current status, and their uptime history bars.
5. **Active Incidents**.
6. **Scheduled Maintenance Events**.

A brand-new page with nothing on it shows an empty state telling you to add resources from the dashboard — which is your cue to head to the **Resources** screen.

The overview a visitor is shown is at most 15 seconds old, and anything you take off the page leaves it within a second: an incident, episode or scheduled event you hide from status pages, make private, limit to other pages or delete, an announcement you end, move to later or delete, a public note you delete, and a resource, group or monitor you remove from the page or delete. Other edits, such as a new title, show within those 15 seconds.

For what puts an incident on this page in the first place, and what takes it off again, see [Incident States & Severities](/docs/incidents/states-and-severities).

## Choosing what shows on the page

What visitors see is set in one card: **What your status page shows**, on **Status Pages → your page → Advanced → Advanced Settings**. It has a row for each list the page can show, then **Uptime History** (with the overall uptime percent and which statuses count as downtime) and the "Powered by OneUptime" line. There is no Edit button: a switch saves the moment you flip it, a number of days when you leave its box or press Enter, and a pick from a list the moment you make it.

- **Show Incidents** (`showIncidentsOnStatusPage`) — on by default. Under it, **Show the last … days** (`showIncidentHistoryInDays`, default 14) is how far back the incident list reaches, and **Show Incident Labels** (`showIncidentLabelsOnStatusPage`) is off by default.
- **Only Show Incidents Scoped to This Page** (`onlyShowScopedIncidents`) — also in the incidents row, off by default. Turn it on and the page shows, and notifies its subscribers about, only the incidents limited to it with **Limit to these status pages**. Incidents that are not limited to any page, including the ones a monitor, Slack, Microsoft Teams, the API or AI opens on its own, never reach it until someone adds the page to them. It also decides which incidents bring their episodes onto the page, so it stays when **Show Incidents** is off. For pages that share monitors but serve different audiences, see [One Status Page per Audience](/docs/status-pages/one-status-page-per-audience).
- **Show Episodes** (`showEpisodesOnStatusPage`) — on by default, with **Show the last … days** (`showEpisodeHistoryInDays`, default 14) and **Show Episode Labels** (`showEpisodeLabelsOnStatusPage`, off by default). Episodes are their own model with their own endpoints, not a view of incidents.
- **Show Announcements** (`showAnnouncementsOnStatusPage`) — on by default, with **Show the last … days** (`showAnnouncementHistoryInDays`, default 14).
- **Show Scheduled Maintenance Events** (`showScheduledMaintenanceEventsOnStatusPage`) — on by default, with **Show the last … days** (`showScheduledEventHistoryInDays`, default 14) and **Show Event Labels** (`showScheduledEventLabelsOnStatusPage`, off by default).
- **Uptime History** — everything about the page's uptime, in one row:
  - **Show the last … days** (`showUptimeHistoryInDays`) is the length of the uptime bar next to each resource. Defaults to 90 and must be between 1 and 90. Every **Show Uptime %** and **Show Status History Chart** option on a resource or group reads this number, and so does the overall uptime percent.
  - **Show Overall Uptime Percent** (`showOverallUptimePercentOnStatusPage`) — off by default. Turn it on and the overall status banner ends with one uptime percentage for the whole page, the average of its resources and groups, while everything is operational. While it is on, **Precision** (`overallUptimePercentPrecision`) picks how many decimals it shows: `99%`, `99.9%`, `99.99%` (the default) or `99.999%`. Each resource and group has its own precision.
  - **Counts as downtime** (`downtimeMonitorStatuses`) — the monitor statuses whose time counts against every uptime percentage on the page: each resource's, each group's and the overall one. Each status is a chip in its own color. Add one from the list or take one off with its **×**, and the change is saved at once. A new status page starts with every status of the project that is not operational. At least one status stays: the last one can't be taken off, because with none every uptime on the page would read 100%.
- **Show Powered By OneUptime Branding** — on by default, so the visitor footer reads "Powered by OneUptime". Turn it off to hide the line. The column stores it the other way round, as `hidePoweredByOneUptimeBranding`.

**A list that is off** is gone from the page, with its item in the nav bar if it has one; its public endpoint refuses, and the page's subscribers are not notified about that kind of event. Its row then shows only its switch: how far back a hidden list goes, and whether it shows labels, change nothing.

**Plans.** On OneUptime Cloud, a setting your plan cannot change shows the plan it needs beside it. The four list switches, the three labels switches and the episodes' history need **Growth**; showing the overall uptime percent and hiding the "Powered by OneUptime" line need **Scale**. The other history windows, **Uptime History**, **Precision**, **Counts as downtime** and **Only Show Incidents Scoped to This Page** can be changed on every plan, and each saves on its own: a page whose overall uptime percent is already on can change its precision on any plan. Putting a setting back the way a new page has it — showing a list again, hiding labels or the overall uptime percent, showing the "Powered by OneUptime" line, the episodes' history back to 14 days — works on every plan, so nothing a trial changed stays that way for want of a plan: the switch says it can still go back, and which plan it takes to change it again.

Whether the page shows a **Subscribe** item (**Show Subscriber Page**, `showSubscriberPageOnStatusPage`, on by default), and which channels visitors can subscribe by, are not set on this screen: both are in the **Channels** card on **Subscribers → Subscriber Settings** (see [Subscription channels](/docs/status-pages/subscribers#subscription-channels)).

Below the card are **Export Status Page as JSON**, which downloads the status page's own settings as a file you can import again, and **Archive status page** (see [Archiving a status page](#archiving-a-status-page)). The overall uptime percent and the downtime statuses used to be two cards of their own here, each behind an **Edit** button; they are rows of the card now.

**Where the colors are.** The uptime bar colors are not here — the **Default Bar Color** and the bar-color rules are under **More settings** on **Status Pages → your page → Branding → Branding**. There is no theme or brand-color setting anywhere; anything beyond those controls is done with **Custom CSS**.

## Previewing before you go live

The **Overview** screen of every status page carries a **Status Page Preview URL** card with a link straight to the page. Use it while you're still adding resources and before any custom domain exists.

Behind the scenes, every public route has a preview twin under `/status-page/{statusPageId}/...` — a preview overview, a preview incident list, a preview subscribe page, and so on. That means a URL or screenshot taken from the dashboard preview will not match what a customer sees once a custom domain is attached, so double-check any link you paste into a runbook or an email.

## Restricting who can see the page

Not every status page is for the public. Who can see a page is one choice, the first card on **Status Pages → your page → Security → Access**, **Who can see this status page**:

- **Anyone with the link** — the page is public. Every new status page starts here.
- **Only people who sign in** — visitors land on `/login` and sign in as a private user, or with your SSO or OIDC provider (see below). Under the choice, the card lists the sign-in set up for the page — how many private users it has, and whether SSO and OIDC are on, each linking to its screen — and, while it is the choice, says so when nobody can sign in yet.
- **Anyone with the password** — visitors land on `/master-password` and unlock the page with one password you share with them. Nobody needs an account. Picking it asks for the password in the same dialog when the page has none; when it has one, you can keep it or type a new one. Afterwards **Change Password** under the choice replaces it. The password is stored as a hash and can't be shown again, and people who entered the old one can keep viewing the page for up to 7 days.

Picking a choice asks you to confirm, saying what changes for visitors, and saves at once. There is no Edit button.

**Images.** An image in what the page shows — a public note, an announcement, a description — is opened by its own long, unguessable address, which works without signing in, so that the emails your subscribers get can show it too. The page itself still asks for the sign-in or the password.

**What it stores.** The choice is three columns, which the API and Terraform read and write as before: `isPublicStatusPage`, `enableMasterPassword` and `masterPassword`. Visitors are asked for the password only on a page that is not public, with `enableMasterPassword` on and a password set; a private page with the switch on but no password is a sign-in page. Picking **Anyone with the link** also turns `enableMasterPassword` off, since a public page never asks for it. The **Access** screen writes only the columns a choice changes.

**Plans.** On OneUptime Cloud, making a page private needs the **Growth** plan: on a lower plan the two private choices show the plan they need and can't be picked. Making it public again — **Anyone with the link** — works on every plan, so a page left private when a trial ended, or after a move to a lower plan, can always be opened up; the dialog says that making it private again needs **Growth**. Moving between **Only people who sign in** and **Anyone with the password** works on every plan, and so does **Change Password**.

### Private users

Add the people who may sign in on **Status Pages → your page → Security → Private Users**. There's an **Add in Bulk** action — paste a list of email addresses and each one gets an invitation email. Private users have their own forgot-password and reset-password flow, separate from your OneUptime project accounts.

**Private users and the password don't stack.** While **Anyone with the password** is the choice, private users can't sign in — they enter the password too — and the **Private Users** screen says so, with a link back to **Access**.

### SSO and OIDC

For a private page tied to your identity provider, **Status Pages → your page → Security → SSO** configures SAML: you enter the sign-on URL, issuer and x509 certificate, and the signature and digest methods are filled in under **More fields**. **Status Pages → your page → Security → OIDC** configures OpenID Connect: you enter the issuer, client ID and secret, and the discovery URL, scopes and claim names are filled in under **More fields**. **SCIM** provisions private users from the IdP automatically. On OneUptime Cloud all three need the Scale plan or above. On a self-hosted installation, SSO and OIDC are part of every edition, and SCIM needs the [Enterprise Edition](/docs/self-hosted/enterprise).

Under the providers, the **SSO Settings** card holds the **Require SSO for Login** switch (`requireSsoForLogin`, off by default), which saves the moment you flip it. Turning it on asks first, because from then on private users can't sign in with an email and password: only people your SSO or OIDC provider lets in can see the page. Test SSO with the link on that screen before you turn it on. It matters only while **Only people who sign in** is the choice, and the **Access** screen lists it as **SSO required** under that choice. On OneUptime Cloud, turning it on needs the **Scale** plan, and turning it off works on every plan. A page that still requires SSO after a Scale trial ends, or after a move to a lower plan, keeps requiring it until someone turns it off: its **SSO** and **OIDC** pages show the switch under the plan's upsell for that.

### IP allowlist

Under **More settings** on **Access**, the **IP Allowlist** card (the `ipWhitelist` column) limits a page to known networks. It applies whoever the page is open to: a visitor from any other address is refused, even with the password or a private user account. Enter one entry per line — an IPv4 or IPv6 address, or an IPv4 range such as `10.0.0.0/8`; a line that is neither is refused when you save. Leave it empty to let every address in. While the list is in force, the folded **More settings** header shows **IP Allowlist** with the number of entries it holds. On OneUptime Cloud, changing it needs the **Scale** plan; emptying it works on every plan.

## The embeddable badge and the RSS feed

Two ways to surface status somewhere other than the page itself.

**Embedded status badge.** Turn on **Enable Embedded Status Badge** (`enableEmbeddedOverallStatus`, off by default) in the **Embedded Status Badge** card on **Status Pages → your page → Advanced → Embedded Status**. It pairs with an `embeddedOverallStatusToken` and serves the badge from `/badge/:statusPageId`, so you can drop the current overall status into your docs, your app's footer or a marketing page.

**RSS feed.** Every status page serves `/rss` — a feed titled "{status page name} Updates" whose items are prefixed `Incident: `, `Announcement: ` and `Scheduled Maintenance: `. Handy for people who would rather pipe your updates into a reader or a chat bot than subscribe by email.

If you'd rather pull the data yourself, the status page is backed by public read endpoints for the overview, incidents, scheduled maintenance events, announcements and episodes — see [Public API](/docs/status-pages/public-api).

## Archiving a status page

Archive a status page to take it offline without deleting it. An archived status page:

- **Is offline.** Its URL, its custom domains, its embedded badge, its public API and its MCP server all answer as if the page did not exist ("Status Page not found"), so a visitor cannot tell an archived page from one that was never there. The dashboard preview link stops working too.
- **Sends nothing to its subscribers.** No incident, episode, maintenance or announcement notifications, no reports, and no subscription confirmations. Nobody can subscribe to it.
- **Leaves the Status Pages list.** Find it under **Status Pages → Advanced → Archived**.
- **Keeps everything.** Its resources, groups, branding, domains, private users and subscribers are kept, so unarchiving puts the page back online exactly as it was.

To archive one status page, open it and go to **Advanced → Advanced Settings → Archive status page**. To archive several, select them in the **Status Pages** list and choose **Archive**. To bring one back, open **Status Pages → Advanced → Archived**, select it and choose **Unarchive**, or open it and click **Unarchive** on the banner at the top of its pages.

## Where to read next

- [Status Page Resources & Groups](/docs/status-pages/resources-and-groups) — putting monitors on the page and organizing them into sections.
- [Status Page Branding & Domains](/docs/status-pages/branding-and-domains) — logo, favicon, footer, custom code, and pointing your own domain at the page.
- [Subscribers & Announcements](/docs/status-pages/subscribers) — the five subscriber channels, double opt-in, and posting announcements.
- [One Status Page per Audience](/docs/status-pages/one-status-page-per-audience) — a status page per client, site or region, and deciding per incident which of them hear about it.
- [Public API](/docs/status-pages/public-api) — reading status page data programmatically.
- [Incidents Overview](/docs/incidents/index) — the events that show up on the page.
- [Incident States & Severities](/docs/incidents/states-and-severities) — what makes an incident appear on a status page and what takes it off.
