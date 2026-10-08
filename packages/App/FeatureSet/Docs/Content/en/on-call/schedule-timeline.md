# Schedule Timeline

The Schedule Timeline shows every on-call schedule in your project on one week or month grid: a row per schedule, a column per day. It answers "who is on call across my team, or the whole organization, this week?" without opening each schedule.

The shifts on the timeline are the ones OneUptime pages people with, user overrides included: the timeline, the escalation rules and the calendar feeds all read them from the same place.

```mermaid title="One set of shifts behind the timeline, paging and calendar feeds"
flowchart TB
    subgraph setup["Each schedule"]
        direction LR
        layers["Layers and rotations"]
        overrides["User overrides"]
    end
    layers --> shifts["Who is on call, and when"]
    overrides --> shifts
    shifts --> timeline["Schedule Timeline"]
    shifts --> paging["Escalation rules page them"]
    shifts --> feeds["Calendar feeds"]
```

## Open the timeline

- **On-Call Duty** > **Schedule Timeline** shows every schedule you can see, grouped by owning team. The **Timeline View** button on **On-Call Schedules** opens the same page.
- **Teams** > a team > **On-Call Schedules** shows only the schedules that team owns.

A team owns a schedule when it is listed on the schedule's **Owners** page. Schedules without an owning team are grouped under **No owner team**. Turn **Group by team** off to see all schedules in one list, sorted by name.

## Read the grid

| On the grid | What it means |
| --- | --- |
| A bar | A shift: who is on call, from when to when. A person has the same colour on every schedule. |
| A faded bar | A shift in the past. |
| A bar marked **⇄** | An override: someone is covering a shift. The thin lane below it names the person whose shift is covered, struck through. |
| A hatched amber block | A coverage gap: nobody is on call. An alert that escalates to that schedule then pages nobody. |
| The red line | Now. |
| The line under a schedule's name | Who is on call now, or **No one on call now**. |

Hover over any bar or gap, or move to it with the keyboard, for its details.

Under the grid, **On call this week** (**On call this month** in the month view) lists everyone who is on call in the range. Hover over a name to see how long they are on call, across how many schedules.

## Change the range and the time zone

- Switch between **Week** and **Month**, move with the arrows and return with **Today**.
- Times are shown in your own time zone. The time zone button opens **View timeline in timezone**, which shows the timeline in any other zone without changing when anyone is on call: each schedule still hands off in its own time zone.
- The timeline covers 180 days back and 365 days ahead.

> [!NOTE]
> Past shifts are recomputed from each schedule's current setup, so they show the rotation as it is set up now, which can differ from who was actually paged at the time. For the hours people actually spent on call, use **On-Call Duty** > **Reports** > **User On Call Time**.

## Find a schedule or a person

- **Search** matches schedule names, team names and the people on call.
- The team filter narrows the view to one team or to **My teams**; **Schedules I'm on** keeps only the schedules you are part of.
- Above the grid, click **with no one on call now** or **with coverage gaps this week** (**this month** in the month view) to see only those schedules. Click it again to see them all.
- Click a person under the grid, or one of their bars, to highlight all of their shifts. **Clear highlight** undoes it, and **Clear filters** resets the search and the filters.

## Who sees what

| Applies to | Rule |
| --- | --- |
| Permissions | The same permissions and label restrictions as **On-Call Schedules**, plus permission to read schedule layers. |
| Overrides | Whose shift an override covers is only shown to people who can read user overrides. Everyone else still sees who is paged. |
| Number of schedules | Up to 250 schedules at a time, sorted by name. A team's **On-Call Schedules** page narrows it to the schedules that team owns. |
| Plan | On OneUptime Cloud, the timeline needs the **Growth** plan, like on-call schedules. |

## Next steps

:::cards
- [On-Call Schedules](/docs/on-call/schedules): Set up who takes turns, layers and on-call hours.
- [Calendar Feeds](/docs/on-call/calendar-feeds): Put your shifts in Google Calendar, Outlook or Apple Calendar.
- [Escalation Rules](/docs/on-call/escalation-rules): Decide who each level of an on-call policy pages.
:::
