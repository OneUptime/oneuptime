# Label and Owner Rules

Label rules and owner rules organize your SLOs for you. A **label rule** attaches labels to every SLO that matches it, and an **owner rule** adds owner users and teams to it — so a new checkout SLO is labelled _Checkout_ and owned by the checkout team without anyone having to remember.

Both are project-wide. Find them in the SLO list's side menu, under **Settings** → **Label Rules** and **Settings** → **Owner Rules**.

If you have not read it yet, start with the [SLOs Overview](/docs/slo/introduction).

## Label rules

A label rule has a name, an optional description, whether it is **enabled**, its match criteria, and the **Labels to Add**.

When the rule matches an SLO, every label in **Labels to Add** is attached to it. Labels the SLO already has are not added twice, and when several rules match, the SLO gets all of their labels.

Label rules can be exported to a file and imported into another project — see [Import and Export Label Rules](/docs/configuration/label-rule-import-export).

## Owner rules

An owner rule has a name, an optional description, whether it is **enabled**, whether to **Notify Owners**, its match criteria, and the **Owner Teams** and **Owner Users** to add.

When the rule matches an SLO, every user and team on the rule is added as an owner. Owners the SLO already has are skipped, and when several rules match, the SLO gets all of their owners. SLO owners are who hears about the SLO — see [Error Budgets](/docs/slo/error-budget) for the notifications they get.

- **Notify Owners** is on by default: the owners the rule adds get the same "you were added as an owner" notification as an owner added by hand. Turn it off to add owners silently.
- A user who is no longer a member of the project, or a team from another project, is never added. The rule's other owners still are.

## Match criteria

Add one or more conditions, then choose how they combine:

- **Match all (AND)** — an SLO must meet every condition.
- **Match any (OR)** — meeting one condition is enough.

Each condition compares one field of the SLO:

| Field                       | Compared with          |
| --------------------------- | ---------------------- |
| **SLO Labels**              | The SLO's labels.      |
| **SLO Name Pattern**        | The SLO's name.        |
| **SLO Description Pattern** | The SLO's description. |

The operators on offer depend on the field. They can include equality (**Equals**, **Does not equal**), text matching (**Contains**, **Does not contain**, **Starts with**, **Ends with**), pattern matching (**Matches pattern**, **Does not match pattern**) and, for labels, **Has any of**, **Has all of** and **Has none of**.

Patterns accept a regular expression (`^checkout-.*`) or a `*` wildcard (`*checkout*`). A pattern that is neither — `checkout-(01` — is rejected when you save, rather than silently matching nothing.

A rule with no conditions matches every SLO.

Some examples:

| You want                                     | Conditions                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Every SLO for the checkout service           | **SLO Name Pattern** matches pattern `*checkout*`                                                                  |
| Every production SLO                         | **SLO Labels** has any of _Production_                                                                             |
| Checkout SLOs, but not the ones for staging  | **Match all (AND)**: **SLO Name Pattern** matches pattern `*checkout*`, and **SLO Labels** has none of _Staging_   |

## When rules run

- **When an SLO is created** — from the dashboard or through the API. Every enabled label rule is applied first, then every enabled owner rule, so an owner rule can match a label that a label rule has just attached.
- **When you run a rule** with **Run Now** — see below.

Editing an SLO does not apply the rules again, and a rule never removes anything: not labels or owners someone added by hand, and not ones it added itself. A disabled rule does nothing.

## Run a rule on existing SLOs

A rule you write today applies to the SLOs created after it. To apply it to the SLOs you already have, select **Run Now** on the rule's row, or select **View** and then **Run Now** on the rule's own page. You can also select several rules and run them from the table's bulk actions.

Running a rule evaluates every SLO in the project, archived SLOs included, and reports how many it matched and how many it changed. Owners a run adds are notified only when you choose to notify them in the run dialog and the rule has **Notify Owners** turned on. See [Run Rules on Existing Resources](/docs/configuration/run-rules-now).

## History

Whenever a rule changes an SLO, the SLO's **Feed** records which rules did it. Owners added by a rule also get the usual "added as an owner" feed item each, so the feed says who was added and why. See [SLO Feed and Audit Logs](/docs/slo/feed-and-audit-logs).

## Permissions

Label rules and owner rules have their own permissions in the **SLO** group: **Create**, **Edit**, **Delete** and **Read SLO Label Rule**, and the same four for **SLO Owner Rule**. Project owners and admins have them all.

To run a rule you also need permission to edit SLOs, and to run an owner rule, permission to add SLO user and team owners, because a run changes every SLO in the project.

## Where to read next

- [SLOs Overview](/docs/slo/introduction) — every page an SLO has, and the SLO list.
- [Run Rules on Existing Resources](/docs/configuration/run-rules-now) — how Run Now works for every rule type.
- [Import and Export Label Rules](/docs/configuration/label-rule-import-export) — copying label rules between projects.
