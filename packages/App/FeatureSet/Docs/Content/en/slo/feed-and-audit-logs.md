# SLO Feed and Audit Logs

An SLO keeps two records of its history, and they answer different questions:

- The **Feed** answers "what happened to this SLO?" — status changes, burn rate alerts and incidents, and changes to the SLO, its rules, monitors and owners, written for the people who look after it.
- The **Audit Logs** answer "who changed what, exactly?" — every change a person made, field by field, for review and compliance.

If you have not read it yet, start with the [SLOs Overview](/docs/slo/introduction).

## The SLO feed

The feed is on the SLO's **Feed** page, and its latest items are under **Recent activity** on the SLO's **Overview**. Items link to the SLO, monitors, alerts and incidents they mention, and most have a **More Information** section with the numbers or the before-and-after values.

| Event                                        | Posted when                                                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **SLO created**                              | The SLO is created. Lists its target, compliance window, SLI, at-risk threshold, description and the default burn rate rules it started with.                            |
| **SLO updated**                              | The name, description, labels, target, compliance window, timezone, at-risk threshold, multi-monitor mode or downtime statuses change. Shows each old and new value.     |
| **SLO enabled / disabled**                   | Evaluation is turned on or off.                                                                                                                                          |
| **SLO archived / restored**                  | The SLO is archived or unarchived.                                                                                                                                       |
| **Status changed**                           | An evaluation moves the SLO to a new status. Shows the SLI, error budget, burn rate and at-risk threshold behind it, and for **Paused** or **Misconfigured** the reason. |
| **Burn rate alert raised**                   | A burn rate rule creates an alert. Links to the alert and shows the burn rates that fired it.                                                                            |
| **Burn rate incident declared**              | A burn rate rule declares an incident. Links to the incident and shows the burn rates that fired it.                                                                     |
| **Burn rate alert / incident resolved**      | A rule's alert or incident closes — resolved automatically, or resolved by hand while auto-resolve was off.                                                              |
| **Burn rate rule added / changed / removed** | Someone creates, edits or deletes a burn rate rule. The default rules a new SLO starts with are described in the **SLO created** item instead.                           |
| **Monitor rule added / changed / removed**   | Someone creates, edits or deletes a monitor rule. A save that changes nothing meaningful is not posted.                                                                  |
| **Monitors attached / detached**             | Monitors are added to or removed from the SLO, by hand or by a monitor rule. Long lists are shortened to the first few monitors "and N more".                            |
| **Owner added / removed**                    | A user or team is added to or removed from the SLO's owners.                                                                                                             |

A few details:

- Items say who made the change when a person did. Changes made by OneUptime itself — an evaluation, a monitor rule attaching a monitor — and changes made through the API or an automation carry no user.
- An alert or incident a rule picks up again because it was already open is not posted twice.
- For a **private** alert or incident, the raised or declared item leaves out its title, number and link, because everyone who can read the SLO can read its feed. It still says a private record was created and shows the burn rates that fired it.
- The feed is append-only: nobody can edit or delete its items. It is not permanent, though: on OneUptime Cloud, feed items older than three years are removed.

## Audit logs

The SLO's **Audit Logs** page lists changes made to:

- the SLO itself — its details, settings, labels, monitors, and archiving;
- its **burn rate rules**;
- its **monitor rules**;
- its **owner users** and **owner teams**.

Changes to burn rate rules, monitor rules and owners are recorded against the rule or owner and roll up to the SLO, so the SLO's page shows its whole history in one place, and each entry links to the page it belongs to. Changes to related items such as labels or monitors are recorded with their names, not only their IDs.

### What is not recorded

- **Evaluation results.** The SLI, error budget, burn rate, status and evaluation times change every few minutes. They are left out of audit logs; their history is on the **Overview**, the **Metrics** page and the **Feed**.
- **Changes made by OneUptime itself** — for example a monitor rule attaching or detaching a monitor — unless **Store System Events** is turned on for the project. The **Feed** records monitor attaches and detaches either way.

### Turning audit logs on

Audit logs are an Enterprise feature: they need the **Enterprise** plan on OneUptime Cloud, or the Enterprise Edition on a self-hosted installation. On other plans, the SLO's **Audit Logs** page explains how to get it.

They are also off by default for each project. To turn them on:

1. Go to **Project Settings** → **Audit Logs** → **Settings**
2. Turn on **Enable Audit Logs**
3. Optionally set **Retention (days)** and **Store System Events**

While audit logging is off, the SLO's **Audit Logs** page shows **Audit logging is off** with a link to turn it on. Entries recorded before it was turned off stay visible. A change to these settings applies within about a minute.

The project's full audit log, across every resource, is under **Project Settings** → **Audit Logs** → **Audit Logs**.

## Where to read next

- [SLOs Overview](/docs/slo/introduction) — every page an SLO has.
- [Monitors and Monitor Rules](/docs/slo/monitor-rules) — what attaches and detaches monitors.
- [Burn Rate Alerts and Incidents](/docs/slo/burn-rate-alerts) — what raises and resolves the alerts and incidents in the feed.
