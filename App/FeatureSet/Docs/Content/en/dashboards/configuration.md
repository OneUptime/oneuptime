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

| Permission | What it allows |
| --- | --- |
| **Create Dashboard** | Create new dashboards. |
| **Read Dashboard** | View dashboards (in private mode). |
| **Edit Dashboard** | Change widgets, variables, and settings. |
| **Delete Dashboard** | Delete a dashboard. |

There are matching permissions for dashboard owners and custom domains, so you can grant "manage owners" without granting "edit the dashboard."

Assign these on project roles under **Project Settings → Teams & Roles**.

## Access for public dashboards

When you make a dashboard public (see [Sharing & Public Dashboards](/docs/dashboards/sharing)), three settings control who can see it:

1. **Public Dashboard** switch — if off, the public URL returns a 404.
2. **Master Password** — if set, visitors enter a password before the dashboard appears.
3. **IP Whitelist** (Scale plan) — if set, requests from other IPs are rejected.

You can combine any of these. The most locked-down combination is "Public on, password set, IP allowlist active" — useful for partner portals where you want all three layers.

## Data retention

Dashboards themselves don't expire. The data they show follows your project's retention settings — metrics, logs, and traces are queryable for as long as your plan keeps them. A widget pointed at "the past 90 days" on a plan that keeps 30 days will show whatever's still stored.

## Duplicating a dashboard

To copy an existing dashboard, open the dashboards list and pick **Duplicate**. The copy includes every widget, variable, and setting except public sharing — that always starts off so you can decide whether to turn it back on.

This is the right move when you want to fork a template (like "our on-call dashboard") into a service-specific copy.

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
