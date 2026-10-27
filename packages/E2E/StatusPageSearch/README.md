# Public status page resource search

Run `npm run test-status-page-search-ui` from `packages/E2E` after installing its and
`Common`'s dependencies and Playwright Chromium.

This suite builds the actual public Overview and its search, nested resource
groups, rollups and history charts. Only the overview API response is replaced
with deterministic, serialized model data: 40 resources across four nesting
levels, each with 90 days of history and an outage. It needs no database or
running OneUptime services. The fixture listens only on `127.0.0.1`, on port
4200 unless `STATUS_PAGE_SEARCH_FIXTURE_PORT` names another.

Desktop and mobile Chromium cover rapid `0660` typing, clearing then typing a
new query, no results, Escape/focus, case/whitespace matching, group/description
matches, collapse restoration and refreshing status while a filter is active.
They also check hover/focus history tooltips and keyboard access to the day dialog.
The rapid-input test attaches timing diagnostics without machine-dependent
performance assertions. Artifacts are under `output/playwright/status-page-search`.

`/?maintenance=1` adds the page's scheduled maintenance to the overview (#5236):
Database 0660's upgrade, completed, on the day of the outage two days ago, and
patching of Service 0039, in progress now. `MaintenanceHistory.spec.ts` checks,
on both projects, the blue band on the days an event touched, the maintenance in
a day's tooltip and dialog with its link to the event's page, and "Under
maintenance" beside a resource while an event runs. `FixtureState.ts` types what
`Fixture.js` keeps on `window` for both specs.

This checks real browser rendering and client interactions; backend overview
queries and the deployed app's routing/authentication are outside this fixture.
