# Configuration & Permissions

This page collects the settings and access-control knobs worth knowing once you have a dashboard you actually want to keep around.

## Ownership

A dashboard's **owners** are the users and teams that are granted explicit permissions on it (separate from the project-wide role).

Under **Dashboard → Owners**:

- Add a **user owner** to grant a specific person extra access to this dashboard.
- Add a **team owner** to grant the same to every member of a team.

Use ownership when the project-wide read role is too broad — e.g., a dashboard with sensitive customer-level detail that should only be visible to the customer-success team.

## Labels

Labels are many-to-many tags for organizing dashboards. Apply them under **Dashboard → Overview**.

Common label patterns:

- **By team**: `team:platform`, `team:checkout`, `team:growth`.
- **By environment**: `env:prod`, `env:staging`.
- **By purpose**: `purpose:oncall`, `purpose:exec`, `purpose:investigation`.

The **Dashboards** list lets you filter by label, which is the fastest way to find a dashboard in a project that's accumulated dozens.

## Permissions

Dashboards are first-class resources in OneUptime's role-based access control. The relevant permissions:

| Permission | Allows |
| --- | --- |
| `CreateDashboard` | Create new dashboards in the project. |
| `ReadDashboard` | View dashboards (in private mode). |
| `EditDashboard` | Modify widgets, variables, settings on a dashboard. |
| `DeleteDashboard` | Delete a dashboard. |

There are matching permissions for the supporting entities: dashboard owners (user / team) and custom domains have their own create / read / edit / delete pairs so you can grant "manage owners" without granting "edit the dashboard itself."

Assign these on project roles under **Project Settings → Teams & Roles**.

## Public-mode access control

Public-mode access (see [Sharing & Public Dashboards](/docs/dashboards/sharing)) is governed by three layers, in order:

1. **Public Dashboard** toggle — if off, the public URL returns a 404.
2. **Master Password** — if set, visitors must enter it before the dashboard renders.
3. **IP Whitelist** (Scale plan) — if set, requests from non-listed IPs receive a 403.

A dashboard can have any combination. The most defensive configuration is "Public on, password set, IP allowlist active" — useful for partner portals where you want all three.

## Retention

Dashboards themselves don't expire. The data they display follows the project's telemetry retention — metrics, logs, and traces are queryable for as long as your plan retains them. A widget pointed at "the past 90 days" on a plan with 30 days of retention will render whatever's still in the store.

## Cloning a dashboard

To duplicate an existing dashboard, open it and use the **Duplicate** action from the dashboards list. The copy includes every widget, variable, and setting except the public-mode configuration (which always starts off — you decide whether to re-enable on the copy).

This is the right pattern when you want to fork a template ("our oncall dashboard") into a service-specific version.

## Deleting a dashboard

Under **Dashboard → Delete**. This is irreversible — the canvas configuration and any custom domain bindings are removed. Telemetry data is unaffected (it lives in the metric / log / trace stores, not on the dashboard).

If a dashboard is published publicly with a custom domain, the public URL stops resolving the moment you delete it. Pull the domain off first if you need to repoint it.

## Migration and backup

For self-hosted installations: the dashboard's full configuration (widgets, variables, settings) lives in the `Dashboard` table in Postgres. A regular database backup is sufficient — there's no separate dashboard export format.

For OneUptime Cloud: regular backups are handled for you. If you want a local copy of a dashboard's configuration, use the [OneUptime API](/docs/api-reference/api-reference) to read the `Dashboard` record.

## Where to read next

- [Sharing & Public Dashboards](/docs/dashboards/sharing) — the public side of access control.
- [Variables & Filters](/docs/dashboards/variables) — templating.
- [Widgets](/docs/dashboards/widgets) — the widget catalog.
- [Dashboards Overview](/docs/dashboards/index) — the conceptual map.
