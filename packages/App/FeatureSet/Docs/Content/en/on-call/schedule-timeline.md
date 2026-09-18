# Schedule Timeline

The Schedule Timeline shows every on-call schedule in your project on one week or month grid: a row per schedule, a column per day. It answers "who is on call across my team, or the whole organization, this week?" without opening each schedule. The shifts are the ones OneUptime pages people with, including user overrides.

## Where to find it

- **On-Call Duty** > **Schedule Timeline** shows every schedule you can see, grouped by owning team. The **Timeline View** button on **On-Call Schedules** opens the same page.
- **Teams** > a team > **On-Call Schedules** shows only the schedules that team owns.

A team owns a schedule when it is listed on the schedule's **Owners** tab. Schedules without an owning team are grouped under **No owner team**.

## Reading the timeline

- Each bar is a shift. A person has the same colour on every schedule. Past shifts are faded.
- The line under each schedule name says who is on call now, or warns that nobody is.
- A bar marked **⇄** is an override. The thin lane below it names the person whose shift is being covered.
- Hatched amber blocks are coverage gaps: an alert that escalates to that schedule then pages nobody.
- The red line is now. Hover over any bar or gap for its details.

## Week, month and time zone

Switch between **Week** and **Month**, move with the arrows and return with **Today**. Times are shown in your own time zone; the time-zone button shows the timeline in any other zone without changing when anyone is on call. The timeline covers 180 days back and 365 days ahead, and past shifts are recomputed from each schedule's current setup.

## Finding what you need

- **Search** matches schedule names, team names and the people on call.
- The team filter narrows the view to one team or to **My teams**; **Schedules I'm on** keeps only schedules you are part of.
- Click **with no one on call now** or **with coverage gaps** to see only those schedules.
- Click a person under the grid, or one of their bars, to highlight all of their shifts.

## Who sees what

The timeline respects the same permissions and label restrictions as **On-Call Schedules**. It shows up to 250 schedules at a time; a team's **On-Call Schedules** page lists every schedule that team owns.
