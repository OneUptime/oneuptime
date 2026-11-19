# Owner filters fixture

An offline harness for **On-Call > Schedules** filtered by its owners - the
maintainer: "I can't filter by Owner/team on /on-call-duty/schedules". It
bundles the production schedules page (`Pages/OnCallDuty/OnCallDutySchedules`)
in the On-Call side menu with esbuild, replaces only the `ModelAPI` / `API` data
boundary and the signed-in member's permissions, and serves it on
`127.0.0.1:4481` (`OWNER_FILTERS_FIXTURE_PORT` moves it). No Docker, no
database, no sign-in.

The project has six schedules:

| Schedule         | Owned by                          |
| ---------------- | --------------------------------- |
| Payments Primary | the Payments team                 |
| SRE Weekdays     | the SRE team                      |
| SRE Weekends     | the SRE team and Ada Lovelace     |
| Database On-Call | Ada Lovelace                      |
| Bo's Escalation  | Bo Chen, a member of the SRE team |
| Nights           | nobody                            |

Ada and Bo are members of the SRE team. A list read answers the Owner chip's
filter (`owners`, an `OwnedBy` - `Common/Types/BaseDatabase/OwnedBy`) as the
server does (`QueryHelper.ownedBy`): a team's schedules are the ones the team
owns, never its members', a person's the ones they own, "is not" the rest
(unowned ones too), "is empty" the unowned, "is not empty" the owned.

`OwnerFilters.spec.ts` checks, in Chromium:

- the Owner and Labels chips over the list, and the Owners column;
- the chip's people and teams, apart, and its search;
- the chip's people and teams drawn as the Owners column draws them - the same
  colour for the same person, a team as a dark tile with a people badge - in
  the list and in the chip once picked;
- "Loading..." from the moment the chip opens - never "Nothing to show" while
  its people and teams are read (`?delay=<ms>` slows that read);
- a read of the people that fails (`?fail=people`): "Couldn't load this list."
  with Try again, which reads them once more;
- a team, a person, both, and the operators is not, is empty and is not empty,
  with the rows that stay and the one filter each read sends - never ids the
  page worked out;
- the chips kept in the address across a reload, and clearing them;
- a filter that matches nothing;
- a 390px phone (no sideways scrolling, the popover and the chip inside the
  screen - every chip's popover, Labels right of Owner too, 16px from the
  screen's edge), dark mode, and German.

`ScheduleUsedBy.spec.ts` checks a schedule's own Overview
(`/on-call-duty/schedules/<id>`, the production
`Pages/OnCallDuty/OnCallDutySchedule`) and its **Used by** card (#7438): with
`?usedBy=used`, the on-call policies that page Payments Primary, each a link
with the escalation rules of it that page the schedule under its name, and one
more the member may not see counted and never named; without it, that nobody on
the schedule is paged and where to add it - at 1280 and 390 pixels, light and
dark, in German and in Persian right to left.

`OwnerTooltip.spec.ts` checks the first row's owner tooltip (#9769): hovering
Payments Primary's owner shows a tooltip drawn on the page's body, inside the
window, showing at all four corners and pointing at its avatar - above it on a
laptop, across the list's top edge while the list scrolls sideways (1150px),
following its avatar as the list and the page scroll, below it at the window's
top edge, in dark mode on the dark surface, in Persian right to left, and on a
card at 820px. On a 390px phone a card leaves the owners out, so there is no
owner tooltip there to cut off.

`OwnerTapOnTouch.spec.ts` checks a card's owner on a touch screen (#9866): at 820,
1024 and 844 pixels wide, where the rows are cards that keep their owners, the first
tap on Payments Primary's owner shows its tooltip, whole, and the schedules list stays
- it stays once the finger lifts; a second tap on the owner, or a tap elsewhere on the
card, opens the schedule; a tap away from the card puts the tooltip away. In the dark
theme and in Persian, right to left, as well. A mouse's click on a table row's owner
still opens the schedule at once.

`Fixture/Fixture.js` records every list read on `window.__fixture.listRequests`
and every read of a table it does not model on `window.__fixture.unhandled` (the
suite fails on any).

## Run it

```
cd packages/E2E
npm install
npm run test-owner-filters-ui
```

Screenshots land in `output/playwright/owner-filters-ui/`.

## Poke at it by hand

```
cd packages/E2E
node OwnerFilters/Fixture/server.js
```

Then open
`http://127.0.0.1:4481/dashboard/10000000-0000-4000-8000-0000000000f1/on-call-duty/schedules`,
adding `?lang=de`, `?theme=dark`, `?delay=1500` or `?fail=people`; or a
schedule's Overview,
`http://127.0.0.1:4481/dashboard/10000000-0000-4000-8000-0000000000f1/on-call-duty/schedules/60000000-0000-4000-8000-000000000001`,
adding `?usedBy=used`, `?lang=de|fa` or `?theme=dark`.
