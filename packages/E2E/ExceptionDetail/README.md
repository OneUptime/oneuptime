# Exception detail fixture

An offline harness for the real exception detail pages under
`packages/App/FeatureSet/Dashboard/src/Pages/Exceptions/View`. It bundles the production layout,
side menu, header and all seven pages (Overview, Stack Trace, Occurrences, Context,
Logs, AI Assistance, Settings) with esbuild, replaces only the `ModelAPI` /
`AnalyticsModelAPI` / `API` data boundary and the synthetic user, and serves them on
`127.0.0.1:4221`. No Docker, no database, no sign-in.

The suite covers:

- the header: status, unhandled and error-class badges, relative first/last seen, the
  service, one-click resolve / reopen / archive / unarchive and an inline error when an
  update is refused
- navigation: every page in the side menu, bookmarkable, the header kept, the mobile
  menu, and no sideways scrolling on a phone
- Overview: the occurrence trend (the histogram request is scoped to the fingerprint and
  service, and re-sent per window), its empty and failed states, details, and the latest
  occurrence linking into the investigation
- Stack Trace: the crash point open with its source-mapped snippet, smart / app-only /
  all views, oldest-first order, expand all, the raw tab with line wrapping, unmapped
  frames and the raw-only fallback
- Occurrences: the Traces explorer scoped to the exception — the span list, histogram and
  facets requests all carry `exceptionScope` — and the per-occurrence details table
- Context: the latest occurrence, breadcrumbs (filters, relative / clock time, attribute
  details) and the empty state
- Logs: the Logs explorer on the latest trace, the service scope, and the no-trace and
  no-occurrence cases
- AI Assistance: starting a task through the confirmation, the setup checklist, per-type
  task states, a refused start and the paused state
- Settings: who resolved and archived it, changing both, and deleting the exception

`Fixture/Fixture.js` records every read and write on `window.__exceptionFixture`, so
the assertions check what the page asked for as well as what it drew.

## Run it

```
cd packages/E2E
npm install
npm run test-exception-detail-ui
```

Screenshots land in `output/playwright/exception-detail-ui/`, named `*-synthetic.png`
because every record in them is fabricated.

## Poke at it by hand

```
cd packages/E2E
node ExceptionDetail/Fixture/server.js --watch
```

then open
`http://127.0.0.1:4221/dashboard/10000000-0000-4000-8000-000000000001/exceptions/50000000-0000-4000-8000-000000000001`.
`--watch` rebuilds the bundle when a source file changes. The scenario query
parameters (`?status=`, `?exception=`, `?frames=`, `?occurrence=`, `?ai=`,
`?histogram=`, `?replay=`, `?spans=`, `?fail=`, `?hold=`) are documented at the top of
`Fixture/Fixture.js`.
