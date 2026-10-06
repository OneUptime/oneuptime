# Configuration & Permissions

This page covers the settings and access controls worth knowing about once you have a dashboard you want to keep around.

## Owners

A dashboard's **owners** are users and teams you've given explicit access to (on top of their project-wide role).

Under **Dashboard → Owners**:

- Add a **user owner** to give one person extra access to this dashboard.
- Add a **team owner** to give the same to every member of a team.

Use owners when the project-wide read role is too broad — for example, a dashboard with customer-level details that should only be visible to the customer-success team.

## Labels

Labels are tags for organizing dashboards. Apply them under **Dashboard → Overview**.

Common patterns:

- **By team**: `team:platform`, `team:checkout`, `team:growth`.
- **By environment**: `env:prod`, `env:staging`.
- **By purpose**: `purpose:oncall`, `purpose:exec`, `purpose:investigation`.

The **Dashboards** list lets you filter by label, which is the fastest way to find a dashboard in a project that has accumulated a lot of them.

## Permissions

Dashboards work with your project's role-based access control. The relevant permissions:

| Permission           | What it allows                           |
| -------------------- | ---------------------------------------- |
| **Create Dashboard** | Create new dashboards.                   |
| **Read Dashboard**   | View dashboards (in private mode).       |
| **Edit Dashboard**   | Change widgets, variables, and settings. |
| **Delete Dashboard** | Delete a dashboard.                      |

There are matching permissions for dashboard owners and custom domains, so you can grant "manage owners" without granting "edit the dashboard."

Assign these on team permissions under **Products → Teams →** your team **→ Permissions**.

## Access for public dashboards

Who can view a dashboard outside the project is one choice on its **Sharing** page (also **⋯ → Share** on the dashboard itself; see [Sharing & Public Dashboards](/docs/dashboards/sharing)):

1. **Only people in this project** (the default) — the dashboard has no public link; its public address shows a not-found page.
2. **Anyone with the link** — anyone who has the public link can see it, without signing in.
3. **Anyone with the link and a password** — visitors enter a password before the dashboard appears.

Under **More settings** on the same page, the **IP Allowlist** (Scale plan) rejects requests to the public link from any IP address that is not on it. The most locked-down public setup is **Anyone with the link and a password** with an IP allowlist — useful for partner portals where you want both layers.

## Data retention

Dashboards themselves don't expire. The data they show follows your project's retention settings — metrics, logs, and traces are queryable for as long as your plan keeps them. A widget pointed at "the past 90 days" on a plan that keeps 30 days will show whatever's still stored.

## Duplicating a dashboard

To copy a dashboard, open it and go to **Settings → Duplicate Dashboard**. The copy's name is filled in for you: the dashboard's name, numbered past the names the project already has ("Checkout API" is copied as "Checkout API 2", and a copy of that one as "Checkout API 3"). Change it if you like, click **Duplicate Dashboard**, and the copy opens. It has the dashboard's widgets, variables, description and labels. Branding and custom domains stay with the original, and public sharing always starts off, so you can decide whether to turn it on.

This is the right move when you want to fork a template (like "our on-call dashboard") into a service-specific copy.

## Archiving a dashboard

Archive a dashboard you don't use any more but want to keep. An archived dashboard leaves the **Dashboards** list and, if it is public, its public link stops working — its URL and custom domains answer "Dashboard not found". Its widgets, variables, branding, domains and public settings are all kept, so unarchiving it puts it back exactly as it was, public link included.

To archive one dashboard, open it and go to **Settings → Archive dashboard**. To archive several, select them in the **Dashboards** list and choose **Archive**. To bring one back, open **Dashboards → Advanced → Archived**, select it and choose **Unarchive**, or open it and click **Unarchive** on the banner at the top of its pages.

Archiving is the reversible alternative to deleting: reach for it first when you're not sure.

## Deleting a dashboard

Under **Dashboard → Delete**. This can't be undone — the dashboard's layout and any custom domains attached to it are removed. Your telemetry data is unaffected.

If the dashboard is public on a custom domain, the URL stops resolving as soon as you delete it. Move the domain to a different dashboard first if you want to keep the URL working.

## Backup

If you self-host OneUptime, a regular database backup is enough — the dashboard's configuration is stored alongside the rest of your project.

On OneUptime Cloud, backups are handled for you. If you want your own copy, you can read the dashboard via the [OneUptime API](/docs/api-reference/api-reference).

## Where to read next

- [Sharing & Public Dashboards](/docs/dashboards/sharing) — public-mode controls.
- [Variables & Filters](/docs/dashboards/variables) — templating.
- [Widgets](/docs/dashboards/widgets) — the widget catalog.
- [Dashboards Overview](/docs/dashboards/index) — the big picture.
