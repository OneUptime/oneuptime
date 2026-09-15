# Monitors and Monitor Rules

An SLO measures the uptime of the monitors attached to it. You can attach monitors by hand, let monitor rules attach every monitor that matches, or both. This page covers the SLO's **Monitors** and **Monitor Rules** pages.

If you have not read it yet, start with the [SLOs Overview](/docs/slo/introduction).

## Which monitors an SLO measures

An SLO measures the union of:

- the monitors you attached by hand, and
- every monitor that at least one of its **enabled** monitor rules matches.

A new SLO starts with no monitors, because the create form does not ask for them. Until it has at least one, it cannot be evaluated: its pages show a **No monitors attached** notice, and its Overview offers the two ways to attach monitors.

## The Monitors page

The SLO's **Monitors** page lists every monitor the SLO measures, with:

- **Current Status** — the monitor's status right now, or **Disabled**, **Probes Not Enabled** or **Probes Disconnected** when the monitor is not being checked.
- **Source** — **Rule** if one of the SLO's monitor rules attached it, **Manual** if someone attached it by hand.
- **Labels** — the monitor's labels.

To change the list by hand:

- **Add Monitors** — pick monitors from the project. Only monitors that are not already attached are offered.
- **Remove** — takes a hand-attached monitor off the SLO. The monitor itself is not changed; it only stops counting towards the SLO's SLI and error budget.

Monitors a rule attached keep a locked **Remove** button whose tooltip explains why: change or disable the rule instead. Adding and removing monitors needs permission to edit the SLO.

While at least one monitor rule is enabled, a banner at the top of the page says the SLO's monitors are managed by its monitor rules, with a **Manage Monitor Rules** link, and **Add Monitors** is turned off.

## Monitor rules

A monitor rule describes the monitors an SLO should measure — "every monitor labelled Production", "every monitor whose name matches `api-*`" — so nobody has to pick them one by one, or remember to add the monitor someone creates next month.

### Creating a rule

1. Open the SLO and go to **Monitor Rules**
2. Click **Create SLO Monitor Rule**
3. Work through the steps:

| Step               | What you set                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Basic Info**     | The **name**, an optional **description** (why these monitors belong to this SLO), and whether the rule is **enabled** (on by default). |
| **Match Criteria** | The conditions a monitor must meet to be attached.                                                                                      |

The rules table shows each rule's name, its match criteria in plain words, and whether it is enabled. **View Monitors** opens the SLO's **Monitors** page.

### Viewing and running a rule

Select **View** on a rule's row to open the rule's own page, with its details (editable with the same form), **Run Now** and **Delete**.

Rules already re-sync the SLO whenever they are saved, so **Run Now** is for picking up anything the SLO missed. It is on the rule's page, on each row, and in the table's bulk actions. Because an SLO measures every monitor that any of its enabled rules matches, running one rule re-evaluates **all** of the SLO's enabled monitor rules together: it attaches the monitors they match and detaches monitors a rule attached that no enabled rule matches any more. Monitors attached by hand are never touched, and a disabled rule does not run. When it finishes, the dialog says how many monitors were attached and detached.

Running a rule needs permission to edit SLO monitor rules. See [Run Rules on Existing Resources](/docs/configuration/run-rules-now).

### Match criteria

Add one or more conditions, then choose how they combine:

- **Match all (AND)** — a monitor must meet every condition.
- **Match any (OR)** — meeting one condition is enough.

Each condition compares one field of the monitor:

| Field                           | Compared with              |
| ------------------------------- | -------------------------- |
| **Monitor Labels**              | The monitor's labels.      |
| **Monitor Name Pattern**        | The monitor's name.        |
| **Monitor Description Pattern** | The monitor's description. |

The operators on offer depend on the field. They can include equality (**Equals**, **Does not equal**), text matching (**Contains**, **Does not contain**, **Starts with**, **Ends with**), pattern matching (**Matches pattern**, **Does not match pattern**) and, for labels, **Has any of**, **Has all of** and **Has none of**.

Patterns accept a regular expression (`^api-.*`) or a `*` wildcard (`*checkout*`). A pattern that is neither — `api-(01` — is rejected when you save, rather than silently matching nothing.

A rule needs at least one condition. To attach every monitor in the project, add a name condition that matches the pattern `.*`.

Some examples:

| You want                                | Conditions                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Every production monitor                | **Monitor Labels** has any of _Production_                                                                               |
| Every API monitor                       | **Monitor Name Pattern** matches pattern `^api-`                                                                         |
| Checkout monitors, but not staging ones | **Match all (AND)**: **Monitor Name Pattern** matches pattern `*checkout*`, and **Monitor Labels** has none of _Staging_ |

### When rules run

- When you create, edit, enable, disable or delete a rule, the SLO's monitors are re-evaluated straight away.
- When a monitor is created, or its labels, name or description change, every monitor rule in the project is checked against it — including labels your monitor label rules give it.
- When a label is deleted, the SLOs whose rules used it are re-evaluated.
- Rules keep an SLO's monitor list current even while the SLO is disabled or archived, so it resumes with the right monitors.

### Which monitors a rule owns

- A monitor is attached while **any** enabled rule matches it, and detached once none does.
- Disabling or deleting a rule detaches the monitors only that rule matched. Monitors another enabled rule still matches stay attached.
- Rules only ever detach monitors a rule attached. A monitor you attached by hand is never taken over by a rule when it happens to match, and never detached when it stops matching or when a rule is deleted. Its **Source** stays **Manual**.

### Picking monitors by hand while rules are enabled

While at least one rule is enabled, the rules manage the SLO's monitors:

- monitors cannot be added by hand;
- monitors a rule attached cannot be removed by hand, because the rule would attach them again;
- monitors attached by hand before the rules were enabled can still be removed.

This holds for the API too, not only the dashboard. Disable every rule to go back to picking monitors yourself.

### Coming from Auto-Add Monitors With Labels

Earlier versions had an **Auto-Add Monitors With Labels** setting on the SLO form. When you upgrade, every SLO that used it gets an enabled monitor rule named **Auto-add monitors with labels** that matches the same labels, so the SLO keeps measuring exactly the monitors it did.

The old setting can still be saved while the upgrade rolls out: from a dashboard tab opened before the upgrade, or by an API client or workflow written for the earlier version. So that an SLO does not quietly lose monitors that way:

- **An SLO with no monitor rules** turns the saved labels into an **Auto-add monitors with labels** rule, and its monitors are re-evaluated straight away. Saving an empty list detaches the monitors the setting attached, as it used to.
- **An SLO that already has monitor rules**, enabled or disabled, ignores labels saved through the old setting, because its rules decide what it measures. Change its monitor rules instead.
- **Creating the first monitor rule** of an SLO whose monitors the old setting attached converts the setting into a rule first, so the new rule is added alongside it rather than replacing it.

A converted rule you delete normally stays deleted. Creating another rule does not bring it back, and neither does saving an out-of-date form with the labels it loaded. Only changing the labels on that form, for an SLO with no monitor rules, does. The exception is a rule whose monitors are still attached after the delete, for example because a server still running the earlier version attached them again during the upgrade: the next monitor change, or the next new rule, converts the labels again. Delete that rule again once the upgrade has finished.

The `monitorLabels` field of the SLO API is deprecated. Use SLO Monitor Rules instead.

## History

Every attach and detach, and every rule that is created, changed or deleted, is posted to the SLO's **Feed**. Rule changes are also recorded in the SLO's **Audit Logs**. See [SLO Feed and Audit Logs](/docs/slo/feed-and-audit-logs).

## Where to read next

- [SLOs Overview](/docs/slo/introduction) — how downtime on several monitors combines, and every page an SLO has.
- [Error Budgets](/docs/slo/error-budget) — what the monitors' downtime spends.
