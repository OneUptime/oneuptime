# Escalation Rules

An on-call policy pages people in levels. Each escalation rule is one level: who gets paged, and how long to wait for somebody to acknowledge before the next level is paged. A policy's rules are listed, in order, on its **Escalation Rules** page.

## Who gets paged first

When you create an on-call policy on the **On-Call Policies** page, the form asks for its **Name** and **Who gets paged first?**. The question uses the same picker as **Notify**: on-call schedules, teams and people, as many as you need. Whoever you pick becomes the policy's first escalation rule, **Level 1**, which waits **30 minutes** for an acknowledgement before the next level is paged. The new policy then opens on its **Escalation Rules** page, where you can add more levels.

**Who gets paged first?** is optional. Leave it empty and the policy starts without escalation rules: it pages nobody until you add one, and its overview says so. The description and the labels wait under **More fields**. The question is asked only of people who may add escalation rules.

## Adding an escalation rule

Open the on-call policy, choose **Escalation Rules** in its side menu and click **Add Escalation Rule**. The dialog is one short page that asks two things:

- **Notify** — who gets paged at this level. One picker covers on-call schedules, teams and people: click **Add responder**, search, and pick as many as you need. Add at least one.
  - An **on-call schedule** pages whoever is on call in it when the level runs, not a fixed person.
  - A **team** pages every member of the team.
  - A **person** is paged directly.
- **Escalate after (in minutes)** — how long to wait for an acknowledgement before the next level is paged. It starts at **30 minutes**; change it to whatever suits the level.

Everything else waits under **More fields**, folded until you open it:

- **Name** — optional. A rule you do not name is called after its level: the first rule of a policy is **Level 1**, the second **Level 2**, and so on. The name field shows the name the rule will get.
- **Description** — optional notes, such as who this level pages and why.

Folded, the header of **More fields** names the two and shows the ones the rule has: a description, or a name of your own.

## How the levels page people

When an incident or alert reaches the policy, **Level 1** pages its responders straight away. If nobody acknowledges within its wait, **Level 2** is paged, and so on down the list. Once the last level's wait has passed with no acknowledgement, the policy starts again from **Level 1** if its **Repeat Policy** (below the rules) says to repeat, as many times as it allows, and otherwise stops.

An incident, alert or episode that is created already acknowledged or resolved — recorded after the fact — runs none of its policies: no one is paged, and its feed says so, naming them. See [Declared already acknowledged or resolved](/docs/incidents/declaring-incidents#declared-already-acknowledged-or-resolved).

The summary at the top of the **Escalation Rules** page shows the whole ladder: when each level is paged, who it pages, and what happens after the last one. A level whose responders cannot all be paged says so on its card; click the label to see who and why.

Each person a level pages is reached the way their own on-call rules say: **User Settings** > **On-Call Rules**, with a tab for incidents, incident episodes, alerts and alert episodes, and a card per severity listing which notification method is tried and after how long. A project admin can see and change a member's rules under **Users** > the member > **On-Call Rules**.

SMS, phone calls, WhatsApp and Telegram start off in a new project: on OneUptime Cloud every message is paid from the project's balance, and a self-hosted installation needs a Twilio account or a Telegram bot set up first. Until a channel is on, nobody in the project can add a method on it. Only a project owner, a **Billing Admin** or someone with the **Manage Billing** permission can turn one on, in the **Notification Channels** card on **Project Settings > Notifications > Notification Settings** — a project admin cannot. Everyone else is told exactly who can, wherever a channel is off: above their own list of methods on it, on their setup checklist, and in the message they get when something needs it.

## Editing, reordering and deleting rules

- **Edit rule** opens the same one-page dialog, filled in with the rule as it is: its responders, its wait, and its name and description under **More fields**. Add or remove responders and save. Clearing the name gives the rule its level's name again.
- **Move up** and **Move down** in a rule's **⋯** menu change its level. A rule named after its level keeps a name that matches its place: when **Level 3** moves up past **Level 2**, the two swap names. A name you chose, such as **Managers**, stays the same wherever the rule goes.
- **Delete rule** asks first and says what the level pages. Deleting a level moves the levels below it up, and rules named after their level are renamed to match.

## Creating rules with the API or Terraform

Escalation rules are the `/api/on-call-duty-policy-escalation-rule` resource; the people, teams and schedules a rule pages are the `/api/on-call-duty-policy-escalation-rule-user`, `-team` and `-schedule` resources.

- A rule created without a `name` is named after its level, as in the dashboard: **Level 3** for a rule that becomes the third level of its policy. Terraform's escalation rule resource still takes a name.
- `escalateAfterInMinutes` has no default outside the dashboard. A rule created without it does not wait: the next level is paged as soon as this one has run. Set it explicitly — 30 is what the dashboard suggests.
- Renaming rules that are named after their level happens when you move or delete rules in the dashboard. Changing `order` through the API or Terraform changes only the order.
- Creating an on-call policy at `/api/on-call-duty-policy` with `onCallSchedules`, `teams` or `users` (lists of ids) in its `miscDataProps` gives it its first escalation rule, as the dashboard does: **Level 1**, paging them, with an `escalateAfterInMinutes` of 30. Every id must belong to the project and the caller must be allowed to create escalation rules, or the policy is not created. A policy created without them has no rules, as before; Terraform's policy resource does not send them.
