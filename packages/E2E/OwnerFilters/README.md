# Owner filters fixture

An offline harness for **On-Call > Schedules** filtered by its owners - the
maintainer: "I can't filter by Owner/team on /on-call-duty/schedules". It
bundles the production schedules page (`Pages/OnCallDuty/OnCallDutySchedules`)
in the On-Call side menu with esbuild, replaces only the `ModelAPI` / `API` data
boundary and the signed-in member's permissions, and serves it on
`127.0.0.1:4459` (`OWNER_FILTERS_FIXTURE_PORT` moves it). No Docker, no
database, no sign-in.

The project has six schedules:

| Schedule | Owned by |
| --- | --- |
| Payments Primary | the Payments team |
| SRE Weekdays | the SRE team |
| SRE Weekends | the SRE team and Ada Lovelace |
| Database On-Call | Ada Lovelace |
| Bo's Escalation | Bo Chen, a member of the SRE team |
| Nights | nobody |

Ada and Bo are members of the SRE team. A list read answers the Owner chip's
filter (`owners`, an `OwnedBy` - `Common/Types/BaseDatabase/OwnedBy`) as the
server does (`QueryHelper.ownedBy`): a team's schedules are the ones the team
owns, never its members', a person's the ones they own, "is not" the rest
(unowned ones too), "is empty" the unowned, "is not empty" the owned.

`OwnerFilters.spec.ts` checks, in Chromium:

- the Owner and Labels chips over the list, and the Owners column;
- the chip's people and teams, apart, and its search;
- "Loading..." from the moment the chip opens - never "Nothing to show" while
  its people and teams are read (`?delay=<ms>` slows that read);
- a team, a person, both, and the operators is not, is empty and is not empty,
  with the rows that stay and the one filter each read sends - never ids the
  page worked out;
- the chips kept in the address across a reload, and clearing them;
- a filter that matches nothing;
- a 390px phone (no sideways scrolling, the popover and the chip inside the
  screen), dark mode, and German.

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
`http://127.0.0.1:4459/dashboard/10000000-0000-4000-8000-0000000000f1/on-call-duty/schedules`,
adding `?lang=de`, `?theme=dark` or `?delay=1500`.
