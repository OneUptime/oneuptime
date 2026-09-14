# Public status page resource search

Run `npm run test-status-page-search-ui` from `E2E` after installing its and
`Common`'s dependencies and Playwright Chromium.

This suite builds the actual public Overview and its search, nested resource
groups, rollups and history charts. Only the overview API response is replaced
with deterministic, serialized model data: 40 resources across four nesting
levels, each with 90 days of history and an outage. It needs no database or
running OneUptime services. The fixture listens only on `127.0.0.1:4200`.

Desktop and mobile Chromium cover rapid `0660` typing, clearing then typing a
new query, no results, Escape/focus, case/whitespace matching, group/description
matches, collapse restoration and refreshing status while a filter is active.
They also check hover/focus history tooltips and keyboard access to the day dialog.
The rapid-input test attaches timing diagnostics without machine-dependent
performance assertions. Artifacts are under `output/playwright/status-page-search`.

This checks real browser rendering and client interactions; backend overview
queries and the deployed app's routing/authentication are outside this fixture.
