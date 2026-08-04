# Managing Applications

Everything about a RUM application after the telemetry starts flowing: identity, ownership, labels, retention, archiving and who can see what.

## Auto-discovery and identity

You do not have to create a RUM application. The first time telemetry arrives carrying client attributes and a `service.name`, OneUptime creates one named after that `service.name` and files the telemetry under it.

Identity is `service.name`, matched **case-insensitively** within the project. `Storefront-Web` and `storefront-web` are the same application, not two.

Consequences worth knowing before you pick names:

- **Renaming `service.name` in your app creates a new application.** The old one keeps its history and goes *Disconnected*; the new one starts empty. There is no merge.
- Use one `service.name` per deployable app, not per environment. Distinguish environments with a label (`oneuptime.label.env=production`) so both stay under one application with one history.
- The **Name** shown in the dashboard is editable and starts out equal to the identifier. Editing the name never changes the identifier, so renaming for readability is safe.

You can also create an application by hand from **Resources → Real User Monitoring → Create**, which is useful when you want owners, labels and session-replay settings configured *before* the first real user hits it. Set **App Identifier** to the `service.name` your app will report.

## Connection status

An application is **Connected** while telemetry keeps arriving, and flips to **Disconnected** after 15 minutes without any. `Last Seen` is throttled to one write per minute, so it can trail real traffic by up to a minute — the 15-minute threshold has that slack built in.

A *Disconnected* application is not an error state on its own. A low-traffic internal tool with no visitors overnight is genuinely disconnected.

## Labels

Labels group applications and drive label-based access control. There are three ways one gets attached.

**Manually** — on the create/edit form.

**From telemetry.** Any resource attribute prefixed `oneuptime.label.` is promoted to a project label:

```bash
OTEL_RESOURCE_ATTRIBUTES="service.name=storefront-web,oneuptime.label.team=payments,oneuptime.label.env=production"
```

produces the labels `team:payments` and `env:production`, creating them in the project if they do not exist. The `<dimension>:<value>` form is what keeps `oneuptime.label.team=prod` and `oneuptime.label.env=prod` from collapsing into one label. Names longer than 100 characters are truncated, and empty or non-string values are skipped.

**From a label rule.** See below.

Labels also gate access: a team member restricted to a set of labels can only reach applications carrying one of them.

## Label rules

_RUM → Settings → Label Rules_. A rule attaches labels to matching applications automatically.

| Field | Behaviour |
| --- | --- |
| **Match Labels** | Only applications that already carry at least one of these labels. Leave empty to skip this filter. |
| **Name Regex Pattern** | Case-insensitive regex, matched against the name and the description. |
| **Description Regex Pattern** | Case-insensitive regex, matched against the name and the description. |
| **Labels to Add** | Every selected label is attached. Already-attached labels are not duplicated. |
| **Enabled** | Turn the rule off without deleting it. |

Rules run **when an application is created** — including auto-discovery. They are not retroactive: adding a rule today does not relabel applications discovered last week. Set those by hand, or archive and let them be rediscovered.

Leaving every match field empty matches everything, which is a legitimate way to say "label every new RUM application".

## Owner rules and ownership

_RUM → Settings → Owner Rules_. Same matching fields as label rules, but the outcome is **Owner Teams** and **Owner Users**.

Owners are the people responsible for an application; they are who notifications about it reach. **Notify Owners** controls whether being added by the rule sends a notification — turn it off for a bulk backfill you do not want to page anyone about.

Like label rules, owner rules apply at creation time only.

## Retention

By default a RUM application's telemetry follows the project's retention settings. Two overrides are available per application:

- **Retain Telemetry Data For Days** — a single value for all of this application's telemetry.
- **Telemetry Data Retention Overrides** — per-pillar values (logs, metrics, traces separately). Anything left unset falls back to the application default, then to the project setting.

Session Replay recordings have their **own** retention, set on the session-replay settings and defaulting to 7 days — deliberately much shorter, because a recording is far more sensitive and far larger than a span. Setting a 90-day telemetry retention does not extend recordings.

RUM is often the highest-volume telemetry in a project, because it scales with your users rather than with your servers. A shorter retention here, with a longer one on backend services, is a common and sensible configuration.

## Archiving and deleting

**Archive** hides an application from the main list while it *keeps collecting telemetry*. Use it for an app you no longer actively watch but do not want to lose history for. Archived applications live under **RUM → Archived** and can be unarchived in bulk.

**Delete** — _View Application → Delete Application_ — is permanent and removes the application. If the app is still emitting telemetry, auto-discovery will simply recreate it on the next batch, with none of its previous settings, so stop the instrumentation first.

To erase a specific *user's* data rather than the application, use a session erasure request instead — see [Session Replay](/docs/telemetry/session-replay).

## Permissions

RUM applications are readable by the project-wide Viewer role. Session replay deliberately is **not** — watching a recording of a real person's screen is a separate grant from listing applications.

| Permission | Grants |
| --- | --- |
| `ReadRumApplication` | See applications and their telemetry tabs. |
| `CreateRumApplication` / `EditRumApplication` / `DeleteRumApplication` | Manage applications. |
| `ReadRumSessionReplay` | List recorded sessions and their metadata — not the recording itself. |
| `ReadRumSessionReplayPayload` | Actually play a recording back. |
| `ReadRumSessionReplayAudit` | See who watched which recording. |
| `DeleteRumSessionReplay` | Delete recordings. |
| `CreateRumSessionErasureRequest` / `ReadRumSessionErasureRequest` | File and review erasure requests. |
| `ReadRumApplicationLabelRule` / `ReadRumApplicationOwnerRule` (+ Create/Edit/Delete) | Manage the rules above. |
| `ReadRumApplicationOwnerUser` / `ReadRumApplicationOwnerTeam` (+ Create/Edit/Delete) | Manage owners directly. |

The useful split: a support engineer with `ReadRumApplication` + `ReadRumSessionReplay` can triage *which* sessions errored without being able to watch anyone's screen. Add `ReadRumSessionReplayPayload` only for the people who need to.

Every playback is written to an audit trail visible under the application's **Replay Access Log** tab.

## Alerting on RUM data

There is no separate "RUM monitor" type — RUM telemetry is ordinary logs, metrics and traces, so the existing monitors apply directly:

- [Metrics Monitor](/docs/monitor/metrics-monitor) — alert on a Core Web Vital or any custom metric your app reports.
- [Traces Monitor](/docs/monitor/traces-monitor) — alert on client-side error rate or latency.
- [Logs Monitor](/docs/monitor/logs-monitor) — alert on a pattern in browser logs.
- [Exceptions Monitor](/docs/monitor/exceptions-monitor) — alert on new or spiking client-side exceptions.

Scope the monitor to the application so a backend service with a similar signature does not trigger it.
