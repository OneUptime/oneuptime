# Status Pages Overview

A status page is the public face of everything you monitor: one URL your customers can open instead of emailing you to ask whether it's just them. It shows the current state of the services you choose to expose, the incidents you're working on, the maintenance you have planned, and any announcement you want to pin to the top.

When something breaks at 2am, the status page is the first thing your support queue links to. It is also the thing your subscribers get notified from — so it is worth setting up before you need it, not during the outage.

Status pages live under **Status Pages** in the dashboard's left navigation, in the **essentials** group. Everything on this page is per-status-page: a project can run as many of them as it likes — a public one for customers, a private one for an internal audience, a per-region one for a specific market.

## At a glance

- **Created with two fields.** A new status page only asks for **Name** and **Description**. Resources, branding and domains are all configured afterwards.
- **Resources are what visitors see.** Each row on the page is a **Status Page Resource** — a monitor (or monitor group) with its own display name, tooltip and uptime options. Groups split a long page into sections and can be nested.
- **A preview URL from day one.** Every status page gets a preview link so you can look at it before a custom domain exists.
- **Visitor-facing routes are gated by settings.** Incidents, announcements, scheduled events and the subscribe page each appear only when their toggle on **Advanced Settings** is on.
- **Three ways to make it private.** Private users, a master password, or SAML SSO / OIDC — plus an IP whitelist.
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
| **Resources**         | A single **Resources** screen — groups on the left, the selected group's monitors on the right.                                                |
| **Subscribers**       | **Email Subscribers**, **SMS Subscribers**, **Slack Subscribers**, **MS Teams Subscribers**, **Webhook Subscribers**, **Subscriber Settings**. |
| **Notification Logs** | **Notification Logs** — what was sent to subscribers.                                                                                          |
| **Audit**             | **Audit Logs**.                                                                                                                                |
| **Branding**          | **Essential Branding**, **HTML, CSS & JavaScript**, **Custom Domains**, **Header**, **Footer**, **Overview Page**, **Languages**.              |
| **Security**          | **Private Users**, **SSO**, **OIDC**, **SCIM**, **Authentication Settings**.                                                                   |
| **AI**                | **MCP**.                                                                                                                                       |
| **Advanced**          | **Monitor Rules**, **Embedded Status**, **Reports**, **Custom Fields**, **Advanced Settings**, **Delete Status Page**.                         |

Two naming quirks worth knowing before you go looking:

- The **Resources** item is only labeled **Resources** when the project has monitor groups enabled. Otherwise it reads **Monitors**. It is the same screen either way.
- There is no separate Groups page. Groups and resources were merged, and the old `/groups` route now redirects to the resources screen.

Outside an individual page, the **Status Pages** section itself has a **More** section with **Announcements**, and a collapsed **Settings** section holding **Announcement Templates**, **Subscriber Templates**, **Custom Fields**, **Owner Rules** and **Label Rules** — these are project-wide, shared across every status page.

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

### The overview page

The overview is the page most visitors ever see. Top to bottom it renders:

1. **Any live announcements** — announcements whose start time has passed and whose end time hasn't.
2. **An overall status banner** — a single line summarizing whether all or only some resources are affected.
3. **An overall uptime percent**, if you turned it on. Off by default.
4. **The resource groups**, each with its resources, their current status, and their uptime history bars.
5. **Active Incidents**.
6. **Scheduled Maintenance Events**.

A brand-new page with nothing on it shows an empty state telling you to add resources from the dashboard — which is your cue to head to the **Resources** screen.

For what puts an incident on this page in the first place, and what takes it off again, see [Incident States & Severities](/docs/incidents/states-and-severities).

## Choosing what shows on the page

Most of the display switches live in one place: **Status Pages → your page → Advanced → Advanced Settings**. Each card has its own **Edit Settings** button.

**Incident Settings**:

- **Show Incidents** (`showIncidentsOnStatusPage`) — on by default. Turning it off also removes the **Incidents** nav item.
- **Show Incident History (in days)** (`showIncidentHistoryInDays`) — how far back the incident list reaches. Defaults to 14.
- **Show Incident Labels** (`showIncidentLabelsOnStatusPage`) — off by default.

**Episode Settings** — the same three switches for incident episodes: **Show Episodes** (`showEpisodesOnStatusPage`, on by default), **Show Episode History (in days)** (default 14), and **Show Episode Labels** (off by default). Episodes are their own model with their own endpoints, not a view of incidents.

**Announcement Settings**:

- **Show Announcements** (`showAnnouncementsOnStatusPage`) — on by default.
- **Show Announcement History (in days)** (`showAnnouncementHistoryInDays`) — defaults to 14.

**Scheduled Event Settings**:

- **Show Scheduled Maintenance Events** (`showScheduledMaintenanceEventsOnStatusPage`) — on by default.
- **Show Scheduled Event History (in days)** (`showScheduledEventHistoryInDays`) — defaults to 14.
- **Show Event Labels** (`showScheduledEventLabelsOnStatusPage`) — off by default.

**Uptime History Settings**:

- **Show Uptime History (in days)** (`showUptimeHistoryInDays`) — the length of the uptime bar next to each resource. Defaults to 90 and must be between 1 and 90. Every **Show Uptime %** and **Show Status History Chart** option on a resource or group reads this number.

**Subscriber Settings**:

- **Show Subscriber Page** (`showSubscriberPageOnStatusPage`) — on by default, plus the five per-channel enable toggles. The same channel toggles also appear on the dedicated **Subscriber Settings** screen under the **Subscribers** section; treat that one as the canonical place to set them.

**Powered By OneUptime Branding**:

- **Hide Powered By OneUptime Branding** — off by default, so the visitor footer reads "Powered by OneUptime" until you turn this on.

**Where the colors are.** The uptime bar colors are not here — the **Default Bar Color**, the bar-color rules, the **Downtime Monitor Statuses** and **Show Overall Uptime Percent** all live on **Status Pages → your page → Branding → Overview Page**. There is no theme or brand-color setting anywhere; anything beyond those controls is done with **Custom CSS**.

## Previewing before you go live

The **Overview** screen of every status page carries a **Status Page Preview URL** card with a link straight to the page. Use it while you're still adding resources and before any custom domain exists.

Behind the scenes, every public route has a preview twin under `/status-page/{statusPageId}/...` — a preview overview, a preview incident list, a preview subscribe page, and so on. That means a URL or screenshot taken from the dashboard preview will not match what a customer sees once a custom domain is attached, so double-check any link you paste into a runbook or an email.

## Restricting who can see the page

Not every status page is for the public. All the controls sit under the **Security** section.

### Private users

Turn **Is Visible to Public** off on **Status Pages → your page → Security → Authentication Settings** (the `isPublicStatusPage` column). Visitors then land on `/login` and have to sign in.

Add the people who may sign in on **Status Pages → your page → Security → Private Users**. There's an **Add in Bulk** action — paste a list of email addresses and each one gets an invitation email. Private users have their own forgot-password and reset-password flow, separate from your OneUptime project accounts.

### Master password

**Authentication Settings** also has a **Master Password** card with a **Require Master Password** toggle and the password itself. Visitors then hit `/master-password` and unlock the page with a single shared secret.

**Master password and private users don't stack.** While the master password is on, private-user authentication is disabled, and the **Private Users** screen shows a banner telling you so.

### SSO and OIDC

For a private page tied to your identity provider, **Status Pages → your page → Security → SSO** configures SAML (sign-on URL, issuer, x509 certificate, signature and digest methods) and **Status Pages → your page → Security → OIDC** configures OpenID Connect (discovery URL, issuer, client ID and secret, scopes, claim names). **SCIM** provisions private users from the IdP automatically. These are gated behind a plan feature, so they may not be available on every installation.

An **SSO Settings** card exposes **Force SSO for Login** (`requireSsoForLogin`, off by default). Test your SSO configuration before you turn it on — if it doesn't work you will lock yourself out of the status page.

### IP whitelist

**Authentication Settings** carries an **IP Whitelist** card as well, backed by the `ipWhitelist` column, for pages that should only answer from known networks.

## The embeddable badge and the RSS feed

Two ways to surface status somewhere other than the page itself.

**Embedded status badge.** Turn on **Enable Embedded Status Badge** (`enableEmbeddedOverallStatus`, off by default) in the **Embedded Status Badge** card on **Status Pages → your page → Advanced → Embedded Status**. It pairs with an `embeddedOverallStatusToken` and serves the badge from `/badge/:statusPageId`, so you can drop the current overall status into your docs, your app's footer or a marketing page.

**RSS feed.** Every status page serves `/rss` — a feed titled "{status page name} Updates" whose items are prefixed `Incident: `, `Announcement: ` and `Scheduled Maintenance: `. Handy for people who would rather pipe your updates into a reader or a chat bot than subscribe by email.

If you'd rather pull the data yourself, the status page is backed by public read endpoints for the overview, incidents, scheduled maintenance events, announcements and episodes — see [Public API](/docs/status-pages/public-api).

## Where to read next

- [Status Page Resources & Groups](/docs/status-pages/resources-and-groups) — putting monitors on the page and organizing them into sections.
- [Status Page Branding & Domains](/docs/status-pages/branding-and-domains) — logo, favicon, footer, custom code, and pointing your own domain at the page.
- [Subscribers & Announcements](/docs/status-pages/subscribers) — the five subscriber channels, double opt-in, and posting announcements.
- [Public API](/docs/status-pages/public-api) — reading status page data programmatically.
- [Incidents Overview](/docs/incidents/index) — the events that show up on the page.
- [Incident States & Severities](/docs/incidents/states-and-severities) — what makes an incident appear on a status page and what takes it off.
