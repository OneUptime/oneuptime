# Shared rows and bulk actions, next: screenshots

Before and after shots for the pull request of the follow-up block "Shared rows
and bulk actions, next" (from #5344). Every shot is the production component on
an offline fixture in headless Chromium, with the Inter font:

- `tables-phone-*`: the BulkActions fixture's Workflows list and the
  ModelTables fixture's Monitors list (`?rows=30`: 34 monitors, ten a page) at
  390px. `-before` is master's build; the German and Persian shots come from
  `packages/E2E/ModelTables/CardsBulkLine.spec.ts`.
- `exceptions-*`: the ChartTimeZoom fixture's exceptions list at
  `?pageSize=2` (five exceptions, three pages), from
  `packages/E2E/ChartTimeZoom/ExceptionRowActions.spec.ts`.
- `security-tools-1280-*`: Security Events > Connections, Your security tools,
  on the SecurityEventsEmptyStates fixture (`?tools=rows`) at 1280px. `-before`
  is master's build; `-after` comes from
  `packages/E2E/SecurityEventsEmptyStates/SecurityEventsEmptyStates.spec.ts`.
- `ui-review-*`: the UI review's before and after shots. The exceptions list
  is the ChartTimeZoom fixture built with review-only patches (a busy
  project's 4,213 or 12,345 exceptions, every-match reads held or failed,
  the Dashboard's German and Persian locales); the band over a table's cards
  is the ModelTables fixture's Monitors list (`?rows=30`) at 390px.
  `-before` is the builder's branch, `-after` the review's.
