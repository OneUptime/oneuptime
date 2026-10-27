# Maintenance States

Every scheduled maintenance event is in one **state**: where the work is, from planned to signed off. States decide what OneUptime does with the event: when its monitors stop being checked, what your status pages show, when its reminders stop. This page covers the four states every project starts with, what moves an event between them, and how to add steps of your own.

:::cards
- [The seeded states](#the-seeded-states): Scheduled, Ongoing, Ended and Completed.
- [What moves an event](#what-moves-an-event): The clock, the header, the timeline, chat and the API.
- [States of your own](#states-of-your-own): A step before the work starts, or a check after it.
- [The state timeline](#the-state-timeline): Every state an event has been in, and correcting it.
:::

## How it works

A project's maintenance states are one ordered list, and events only move down it. Where a state sits decides what an event in it counts as: waiting to start, in progress, or over.

```mermaid title="Events only move down the list; where a state sits decides what it counts as"
flowchart TB
    subgraph waiting["Waiting to start"]
        scheduled["Scheduled"]
        confirmed["Confirmed<br/>(your own)"]
    end
    subgraph progress["In progress"]
        ongoing["Ongoing"]
        verifying["Verifying<br/>(your own)"]
    end
    subgraph over["Over"]
        ended["Ended"]
        completed["Completed"]
    end
    scheduled --> confirmed
    confirmed -->|"its Starts At"| ongoing
    ongoing --> verifying
    verifying -->|"its Ends At"| ended
    ended --> completed
```

The `ScheduledMaintenanceState` model has `name`, `description`, `color` and `order`, plus four flags: `isScheduledState`, `isOngoingState`, `isEndedState` and `isResolvedState`. OneUptime reads the flags and the order, never the name, so you can rename **Completed** to "Signed off" and nothing breaks.

> [!TIP]
> The list is under **Scheduled Maintenance → Settings → Event State**. **Settings** starts folded in the side menu: expand it first.

## The seeded states

Every new project starts with four maintenance states, in this order:

| State         | `order` | Flag               | Color     | What it means                                                  |
| ------------- | ------- | ------------------ | --------- | -------------------------------------------------------------- |
| **Scheduled** | `1`     | `isScheduledState` | `#000000` | Every new event starts here, and waits for its start time.     |
| **Ongoing**   | `2`     | `isOngoingState`   | `#ffbf53` | The work is under way, and the event's monitors are not checked. |
| **Ended**     | `3`     | `isEndedState`     | `#4a4a4a` | The window is over, and checks resume.                         |
| **Completed** | `4`     | `isResolvedState`  | `#2ab57d` | Someone signed the work off, and the owners' reminders stop.   |

The four flagged states carry a **Built-in** tag on the settings page. You can rename, recolor and drag them, but they keep their order, and they cannot be deleted: their **Delete** stays locked, and says why.

**Ended** and **Completed** are both over. The difference is who moves the event: OneUptime moves it to **Ended** at its **Ends At**, and a person, a chat button or the API moves it to **Completed** once the work is checked.

## What moves an event

| Way              | Where                                                                                       | What it asks                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **The clock**    | A job that runs every minute                                                                | Nothing: at **Starts At** it moves a waiting event to **Ongoing**, and at **Ends At** an event in progress to **Ended**. |
| **The header**   | The event's **Overview**: the **Mark as {{state}}** buttons, and **Change state to** in its **⋯** menu | A short dialog, **Mark Scheduled Maintenance as {{state}}**, with **Notify Status Page Subscribers** and an optional note under **Add a public note**. |
| **The timeline** | **State Timeline** in the event's side menu                                                 | A row you add by hand, with **Scheduled Maintenance Status** and **Starts At**.                                 |
| **A list row** | The **⋯** menu on an event's row in the list of events: the **Mark as {{state}}** moves and **Change State** | The header's dialog, naming the event. An event another change moved on meanwhile is left alone, and the dialog says why. |
| **Bulk change**  | **Mark as {{state}}** or **Change State** on a selection in the list of events                                       | The state, and one public note added to every event. Events already at or past the state are skipped.         |
| **Chat**         | The buttons on the event's Slack and Microsoft Teams messages                               | The same change, made as you. See [Slack](/docs/workspace-connections/slack#acting-on-incidents-alerts-and-events-from-slack). |
| **The API**      | A row created at `/api/scheduled-maintenance-state-timeline`                                | The state, and whether subscribers are told.                                                                    |

The header's buttons are named after your states. While the event waits, it offers two: one that starts it, named after your ongoing state, and one that ends it, named after your ended state. While the event is in progress, only the second. The **⋯** menu lists every other state after the current one. Someone whose role may not change the event's state sees the buttons locked, with no menu of other states: pointing at one names the permissions that would let them.

## What starting and ending do

An event starts when it moves from a state where it waits into **Ongoing**, or straight into a state of yours placed between **Ongoing** and **Ended**. Then:

- **Its monitors stop being checked**, and change to its **Change Monitor Status to**, if it has one. A monitor you add to the event while it runs changes too.
- **Its status pages list it as in progress**, and its subscribers are told: at its time if **When the event starts** is on, and by hand as the dialog's **Notify Status Page Subscribers** says.
- **Its owners are told**, if they turned the state change notification on, and the event appears under **Ongoing Events**.

An event ends when it moves from a state where it is in progress into **Ended**, **Completed**, or a state of yours placed after **Ended**. Then its monitors are checked again and go back to operational, unless another event in progress still holds them, and its subscribers are told the same way: at its time if **When the event ends** is on, and by hand as the dialog says.

Moving on from **Ongoing** to "Verifying", or from **Ended** to **Completed**, starts or ends nothing again: the event had already started, or ended.

## The header's clock

Before the start, the header counts down to it; while the event runs, it counts how long it has run; once it is over, it says how long it took. When the event misses a boundary by more than two minutes, an amber notice says so:

- **Start overdue**: the event is still waiting after its **Starts At**.
- **Overrunning**: the event is still in progress after its **Ends At**.

The notice names the planned time and the state the event has not reached yet. Right after a boundary the job that moves events may not have run yet, so for the next few minutes the header checks again on its own, and shows the new state without a reload.

## Order is enforced

Every state change is checked against the list, whoever makes it: the dashboard, Slack, Microsoft Teams, the API, Terraform, a workflow or OneUptime itself.

- **Backwards moves are refused**, with a message that names both states: "Scheduled Maintenance cannot transition to Scheduled state from Ongoing state because Scheduled is before Ongoing in the order of scheduled maintenance states."
- **Moving to the state it is already in is refused**: "Scheduled Maintenance state cannot be same as previous state."
- **Pickers offer only the states after the current one**, so nobody is offered a move that would be refused.

To put right a state set by mistake, delete its row on the event's **State Timeline** page; the event goes back to the state of the row before it.

## States of your own

A state you add is a step your team walks through that the seeded four do not name: "Confirmed" before the work starts, "Verifying" after it.

:::steps
### Open the state list

Go to **Scheduled Maintenance → Settings → Event State**. The **Scheduled Maintenance States** card lists your states in their order. Each row shows its color and name, what an event in it **Counts as**, and its description.

### Create the state

Click **Create Scheduled Maintenance State** and fill in its **Name**, **Description** and **Color**. The new state is added just above the completed state.

### Drag it into place

Drag a row by its grip to move it; the new order is saved as you drop it. The **Counts as** column follows the place you drop it in.
:::

A state you add has no flag, so where it sits is what it means:

| Where you place it                      | An event in it                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Between **Scheduled** and **Ongoing**   | Waits for its **Starts At**, as in **Scheduled**, and starts from there at its time.                             |
| Between **Ongoing** and **Ended**       | Is in progress, as in **Ongoing**: its monitors stay unchecked, and it ends at its **Ends At**.                   |
| Between **Ended** and **Completed**     | Is over, but not complete yet: reminders that run until completion keep going.                                   |
| Below **Completed**                     | Is complete, as in **Completed**.                                                                                 |

Keep your states below **Scheduled**: every new event starts there, and an event never moves back up the list, so a state above it is never reached. You move an event into a state of your own from the **⋯** menu in its header, under **Change state to**.

> [!NOTE]
> On OneUptime Cloud, adding or changing maintenance states takes the **Growth** plan or above. Every plan can read them, use them and delete a state you added.

## Archiving a state

Archive a state of your own that your team should stop using, instead of deleting it. Archiving changes no event: an event in the state stays in it and moves on as usual, and its state timeline still shows it.

- **Archive** is in the row's **⋯** menu. It asks first, and lists the measurements and workflows set up to use the state.
- **Nobody can pick it again.** The event's header, **Change State**, Slack and Microsoft Teams leave it out, and the API, Terraform and MCP refuse it. You can still filter events by it.
- **Archived states are listed apart**, in the folded **Archived Scheduled Maintenance States** section under the table. **Unarchive** puts one back as it was.
- **The four built-in states can't be archived**: OneUptime moves events into them. Their **Archive** is locked, with the reason.

## The state timeline

The event's **State Timeline** page is the record of every state it has been in. Its card draws them as a timeline: a band with each state as long as it lasted, and under it every change, newest first. **Table**, in the card's header, lists them as rows instead, with **Scheduled Maintenance Status**, **Starts At**, **Ends At**, **Duration**, whether subscribers were to be notified, and how their notification went.

In the dashboard, rows can be added and deleted, but not edited, and an event always keeps at least one. Through the API, a row's `startsAt` can be corrected, and every measurement worked out from the timeline follows it. Deleting the latest row puts the event back in the state of the row before it.

> [!WARNING]
> Deleting a row rewrites the event's history and every measurement worked out from it. Use it to correct a mistake, not to tidy up.

## Troubleshooting

:::details The header says Start overdue
The event is still waiting more than two minutes after its **Starts At**, so the job that starts events has not moved it yet. Start it yourself with the header's button: a start by hand does everything the job does, its monitors included.
:::

:::details An event cannot be moved back to a state it was in
States only move down the list. Delete the rows after the state you want on the event's **State Timeline** page, newest first.
:::

:::details The completed state is missing from the header's buttons
The header's buttons start and end the event. Completing it is in the **⋯** menu, under **Change state to**.
:::

## Next steps

:::cards
- [Scheduled Maintenance Overview](/docs/scheduled-maintenance/index): Where everything lives, and what an event affects.
- [Creating Maintenance Events](/docs/scheduled-maintenance/creating-events): The form, field by field.
- [Maintenance Rules & Settings](/docs/scheduled-maintenance/settings): Remind owners until an event is completed.
- [Incident States & Severities](/docs/incidents/states-and-severities): The same ordered list, for incidents.
:::
