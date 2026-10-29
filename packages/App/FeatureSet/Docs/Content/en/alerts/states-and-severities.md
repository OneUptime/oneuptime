# Alert States & Severities

Every alert carries a **state**, where your team is with it, and a **severity**, how much it matters. States drive what OneUptime does: who is still paged, what counts as active, when an episode resolves. Severities rank alerts, and rules can match on them. This page is for anyone who sets them up, or wonders why an alert did or did not page.

:::cards
- [The seeded states](#the-seeded-states): Identified, Acknowledged and Resolved, and what each one does.
- [Adding your own states](#adding-your-own-states): A step of your own, such as Investigating.
- [Moving an alert through its states](#moving-an-alert-through-its-states): Every way a state changes.
- [Severities](#the-seeded-severities): High and Low, and adding your own.
:::

## How it works

A project's alert states are one ordered list, and alerts only move down it. Where a state sits decides what an alert in it counts as: not acknowledged yet, acknowledged, or resolved. Alert episodes move through the same list.

```mermaid title="Alerts only move down the list; where a state sits decides what it counts as"
flowchart TB
    subgraph open["Counts as<br/>not acknowledged"]
        identified["Identified"]
    end
    subgraph working["Counts as<br/>acknowledged"]
        acknowledged["Acknowledged"]
        investigating["Investigating<br/>(your own)"]
    end
    subgraph done["Counts as<br/>resolved"]
        resolved["Resolved"]
        closed["Closed<br/>(your own)"]
    end
    identified --> acknowledged
    acknowledged --> investigating
    investigating --> resolved
    resolved --> closed
    identified -. "skip ahead" .-> resolved
```

The `AlertState` model has `name`, `description`, `color` and `order`, plus three flags: `isCreatedState`, `isAcknowledgedState` and `isResolvedState`. OneUptime reads the flags and the order, never the name, so you can rename **Resolved** to "Closed" and nothing breaks. The `AlertSeverity` model has `name`, `description`, `color` and `order`, and no flags.

> [!TIP]
> Both lists are under **Alerts → Settings**, which starts folded in the side menu: expand **Settings** to find **Alert State** and **Alert Severity**.

## The seeded states

Every new project starts with three alert states, in this order:

| State            | `order` | Flag                  | Color     | What it means                                   |
| ---------------- | ------- | --------------------- | --------- | ----------------------------------------------- |
| **Identified**   | `1`     | `isCreatedState`      | `#fd625e` | The state new alerts start in.                  |
| **Acknowledged** | `2`     | `isAcknowledgedState` | `#ffbf53` | Someone is on it, and paging stops.             |
| **Resolved**     | `3`     | `isResolvedState`     | `#2ab57d` | The alert is over and no longer counts as active. |

The three flagged states carry a **Built-in** tag on the settings page. You can rename, recolor and drag them, but they keep their order, created before acknowledged before resolved, and they cannot be deleted: their **Delete** stays locked, and says why.

## What each flag does

| Flag                  | What OneUptime does with it                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | New alerts start here when nobody picks another state: every alert a monitor raises, and every one created with **Initial State** left empty.                                    |
| `isAcknowledgedState` | **Acknowledge** moves an alert here. In this state or any state after it, the alert counts as acknowledged: its on-call policies stop paging and **Acknowledge** is no longer offered. |
| `isResolvedState`     | **Resolve** moves an alert here. In this state or any state after it, the alert counts as resolved: it leaves **Active Alerts**, its reminders stop, and its episode can resolve.  |

## Adding your own states

A state you add is a step your team walks through that the seeded three do not name: "Investigating", "Mitigated", "Closed".

:::steps
### Open the state list

Go to **Alerts → Settings → Alert State**. The **Alert States** card lists your states in their order. Each row shows its color and name, what an alert in it **Counts as**, and its description.

### Create the state

Click **Create Alert State** and fill in its **Name**, **Description** and **Color**. The color is already picked: one no other state uses yet. The new state is added just above the resolved state, so it keeps alerts active.

### Drag it into place

Drag a row by its grip to move it; the new order is saved as you drop it. The **Counts as** column follows: above the acknowledged state an alert is **Not acknowledged**, from it down **Acknowledged**, and from the resolved state down **Resolved**.
:::

A state you add has no flag, so where it sits is what it means. Put a mitigation step between **Acknowledged** and **Resolved**, and a triage step above **Acknowledged**. A state placed below **Resolved** counts as resolved everywhere.

You move an alert into a state of your own from the **⋯** menu in the alert's header, under **Change state to**, which lists every state after the current one. Its confirmation is titled **Mark Alert as {{state}}**, with the state's name in it.

> [!NOTE]
> On OneUptime Cloud, adding or changing alert states and severities takes the **Growth** plan or above. Every plan can read them, use them and delete a state you added.

## Order is enforced

Every state change of an alert is checked against the list, whoever makes it: the dashboard, Slack, Microsoft Teams, the API, Terraform, a workflow or OneUptime itself.

- **Backwards moves are refused**, with a message that names both states: "Alert cannot transition to Acknowledged state from Resolved state because Acknowledged is before Resolved in the order of alert states."
- **Moving to the state it is already in is refused**: "Alert state cannot be same as previous state."
- **Pickers offer only the states after the current one**, so nobody is offered a move that would be refused.

Alert episodes are held to the same list, in their own name ("Episode cannot transition to …"). The one move back up the list is OneUptime's own: a grouping rule that reopens a recently resolved episode. To put right a state set by mistake, delete its row on the alert's **State Timeline** page; the alert goes back to the state of its latest remaining row.

## The seeded severities

Every new project starts with two alert severities, most severe first:

| Severity | `order` | Color     | Seeded description                                                                |
| -------- | ------- | --------- | --------------------------------------------------------------------------------- |
| **High** | `1`     | `#b70400` | Issues causing very high impact to customers. Immediate attention is required.    |
| **Low**  | `2`     | `#ffbf53` | Issues causing low impact to customers.                                           |

Incidents start with three severities and alerts with two. When a monitor recommendation's template says **Critical** or **Warning**, OneUptime maps it onto your first and second alert severity, which in a new project are **High** and **Low**.

## Editing severities

Go to **Alerts → Settings → Alert Severity**. The **Alert Severities** card lists them most severe first; drag a row to change its rank. **Create Alert Severity** adds one at the end of the list, the least severe, with the same **Name**, **Description** and **Color** as a state.

The rank decides which severity wins where OneUptime compares them: an episode's severity rises to that of the most severe alert that joins it. Severities have no flags and no delete lock: any severity can be deleted, the seeded two included.

A severity pages nobody by itself. To page by severity, add an on-call rule whose **Alert Severities** match it: see [Alert Rules & Settings](/docs/alerts/settings). Changing an alert's severity writes an entry to its feed and matches its reminder rule again.

## Archiving a state or severity

Archive a state or severity that your team should stop using, instead of deleting it. Archiving changes no alert. Deleting a state takes its rows out of every alert's history, and a severity can't be deleted while alerts have it.

- **Archive** is in the row's **⋯** menu. It asks first, and lists the rules, measurements, monitor criteria and workflows set up to use the value: they keep using it until you change them.
- **People's own on-call rules stay.** For a severity, the dialog also says how many people have on-call rules for it. Those rules stay as they are, so alerts with it still page those people. On each person's **On-Call Rules** page the archived severity comes last, marked **Archived**: its rules can be changed or removed, but no new one added.
- **Nobody can pick it again.** **Change State**, the alert's header, Slack, Microsoft Teams, rules and monitor criteria leave it out. The API, Terraform and MCP refuse it, naming the value and where to unarchive it.
- **Alerts keep it.** An alert that has it keeps it through every later edit, its state timeline still shows it, and you can still filter by it.
- **Archived values are listed apart**, in the folded **Archived Alert States** or **Archived Alert Severities** section under the table, with who archived each and when. **Unarchive** puts one back as it was.
- **Some can't be archived.** The created, acknowledged and resolved states, and the project's last severity that is not archived. Their **Archive** is locked, with the reason.

**Delete** says what it would do first. While alerts or episodes have the value, the delete is refused and the dialog lists them. Otherwise it lists what the delete would change and offers **Archive instead**. To delete several at once, select them and choose **Delete** under **Bulk Actions**: the dialog says the same for all of them first, the ones that can't be deleted are left as they are, and the rest are deleted.

## Moving an alert through its states

| Way                  | Where                                                                                     | What it asks                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Header buttons**   | The alert's header: **Acknowledge**, **Resolve**, and **Change state to** in its **⋯** menu | A short confirmation, **Acknowledge Alert**, **Resolve Alert** or **Mark Alert as {{state}}**, with an optional note under **Add a private note**. |
| **State timeline**   | **State Timeline** in the alert's side menu                                               | A row you add by hand, with **Alert Status** and **Starts At**.                                                                       |
| **List row** | The **⋯** menu on an alert's row in the alerts list: **Acknowledge**, **Resolve** and **Change State** | The header's confirmation, naming the alert. An alert another change moved on meanwhile is left alone, and the dialog says why. |
| **Bulk change**      | **Acknowledge**, **Resolve** or **Change State** on a selection in the alerts list                                        | The state, and one private note added to every alert. Alerts already at or past the state are skipped.                               |
| **Automatically**    | A monitor, an episode, a linked incident or your own code                                 | **Auto Resolve Alert** on a monitor's criteria, an episode's state change, the incident switches on [Linked Alerts](/docs/incidents/linked-alerts), or a row created at `/api/alert-state-timeline`. |

The header offers **Acknowledge** and **Resolve** while the alert is not acknowledged yet, and only **Resolve** once it is. A resolved alert shows neither. Someone whose role may not change the alert's state sees them locked, with no menu of other states: pointing at one names the permissions that would let them.

## What acknowledging does

An alert is acknowledged from the moment it moves into your acknowledged state, or into any state after it, a resolved one included. Then:

- **On-call stops paging for it.** Its on-call policies do not page the next level.
- **Acknowledge is no longer offered**, in the header or in Slack and Microsoft Teams, where acknowledging it again is refused with "Alert is already acknowledged." or "Alert is already resolved." Someone who answers their page after that has the page acknowledged, and the alert stays where it is.
- **The time to acknowledge is set**, from the first such move: the **Overview**'s first tile, and a measurement that ends when **The alert is acknowledged**.

## What resolving does

An alert is resolved when it moves into your resolved state, or into any state after it. Then:

- **It leaves Active Alerts**, and the side menu's count.
- **Its reminders stop**, whatever its reminder rule says.
- **Its episode can resolve.** An episode resolves on its own once every alert in it is resolved. See [Alert Episodes & Grouping Rules](/docs/alerts/episodes).
- **Its monitor can raise a new alert.** A criteria keeps one open alert at a time; once that one is resolved, the next match opens another.

Moving on from **Resolved** to a state after it, "Closed" say, changes none of this: the alert was resolved already.

## The state timeline

The alert's **State Timeline** page is the record of every state it has been in. Its card draws them as a timeline: a band with each state as long as it lasted, and under it every change, newest first. **Table**, in the card's header, lists them as rows instead, with **Alert Status**, **Starts At**, **Ends At** and **Duration**.

- **View Cause** shows the root cause recorded with that change.
- **View Logs** shows what OneUptime recorded when the alert changed, such as the monitor check that caused it.

Rows can be added and deleted, but not edited, and an alert always keeps at least one. Deleting the latest row puts the alert back in the state of the row before it.

> [!WARNING]
> Deleting a row rewrites the alert's history and every measurement worked out from it. Use it to correct a mistake, not to tidy up.

## The Active Alerts list

**Alerts → Active Alerts** holds every alert whose state sits above your resolved state, and nothing else decides it: not severity, not age, not whether anyone acknowledged it. The red badge beside it in the side menu counts the same alerts.

So a state of your own above **Resolved** keeps alerts in the list, and one below it takes them off, as resolving does. **Active Episodes** works the same way for episodes.

## Next steps

:::cards
- [Alerts Overview](/docs/alerts/index): Where alerts come from and how your team works them.
- [Alert Episodes & Grouping Rules](/docs/alerts/episodes): How an episode's state moves its alerts.
- [Alert Rules & Settings](/docs/alerts/settings): Page and remind by severity.
- [Incident States & Severities](/docs/incidents/states-and-severities): The same lifecycle, for incidents.
:::
