# Escalation Rules

An on-call policy pages people in levels. Each escalation rule is one level: who gets paged, and how long to wait for somebody to acknowledge before the next level is paged. A policy's rules are listed, in order, on its **Escalation Rules** page.

## Adding an escalation rule

Open the on-call policy, choose **Escalation Rules** in its side menu and click **Add Escalation Rule**. The dialog is one short page that asks two things:

- **Notify** — who gets paged at this level. One picker covers on-call schedules, teams and people: click **Add responder**, search, and pick as many as you need. Add at least one.
  - An **on-call schedule** pages whoever is on call in it when the level runs, not a fixed person.
  - A **team** pages every member of the team.
  - A **person** is paged directly.
- **Escalate after (in minutes)** — how long to wait for an acknowledgement before the next level is paged. It starts at **30 minutes**; change it to whatever suits the level.

Everything else waits under **Advanced**, folded until you open it:

- **Name** — optional. A rule you do not name is called after its level: the first rule of a policy is **Level 1**, the second **Level 2**, and so on. The name field shows the name the rule will get.
- **Description** — optional notes, such as who this level pages and why.

The header of **Advanced** says **Configured** when the rule has a description or a name of your own.

## How the levels page people

When an incident or alert reaches the policy, **Level 1** pages its responders straight away. If nobody acknowledges within its wait, **Level 2** is paged, and so on down the list. Once the last level's wait has passed with no acknowledgement, the policy starts again from **Level 1** if its **Repeat Policy** (below the rules) says to repeat, as many times as it allows, and otherwise stops.

The summary at the top of the **Escalation Rules** page shows the whole ladder: when each level is paged, who it pages, and what happens after the last one. A level whose responders cannot all be paged says so on its card; click the label to see who and why.

## Editing, reordering and deleting rules

- **Edit rule** opens the same one-page dialog, filled in with the rule as it is: its responders, its wait, and its name and description under **Advanced**. Add or remove responders and save. Clearing the name gives the rule its level's name again.
- **Move up** and **Move down** in a rule's **⋯** menu change its level. A rule named after its level keeps a name that matches its place: when **Level 3** moves up past **Level 2**, the two swap names. A name you chose, such as **Managers**, stays the same wherever the rule goes.
- **Delete rule** asks first and says what the level pages. Deleting a level moves the levels below it up, and rules named after their level are renamed to match.

## Creating rules with the API or Terraform

Escalation rules are the `/api/on-call-duty-policy-escalation-rule` resource; the people, teams and schedules a rule pages are the `/api/on-call-duty-policy-escalation-rule-user`, `-team` and `-schedule` resources.

- A rule created without a `name` is named after its level, as in the dashboard: **Level 3** for a rule that becomes the third level of its policy. Terraform's escalation rule resource still takes a name.
- `escalateAfterInMinutes` has no default outside the dashboard. A rule created without it does not wait: the next level is paged as soon as this one has run. Set it explicitly — 30 is what the dashboard suggests.
- Renaming rules that are named after their level happens when you move or delete rules in the dashboard. Changing `order` through the API or Terraform changes only the order.
