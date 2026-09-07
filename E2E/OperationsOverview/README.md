# Operational overview browser tests

Run `npm run test-operations-overview-ui` from `E2E`. Install Chromium with
`npx playwright install chromium` if it is not already available.

This suite renders the actual incident, alert, and scheduled maintenance overview
pages inside their actual route layouts, including `ModelPage`, breadcrumbs, side
navigation, state transition forms, detail editors, feeds, and resource displays.
The fixture uses the repository's browser build configuration and bundled Tailwind.
It starts automatically without Docker, a database, or network access.

The fixture supplies synthetic model records, a synthetic project session, and
permissions. Model API reads and writes are replaced with in-memory operations.
Optional telemetry viewers, AI investigation/remediation, runbooks, monitor
snapshots, and incident member role assignment are omitted at their import
boundaries; those integrations are outside this layout suite. Screenshots are
explicitly labelled as previews with synthetic data. These tests exercise browser
integration and presentation; they do not claim backend end-to-end coverage.

Coverage includes desktop and phone layout/reading order, real detail editing,
state transitions and cancellation, keyboard skip links, missing dates, empty
feeds, expandable activity history, long titles, narrow viewport overflow, completed event duration, and
visible load errors. Browser exceptions fail the tests.

Desktop and phone screenshots for each event type are written to
`output/playwright/operations-overview` and attached to Playwright results.
Failure traces and screenshots are retained in that directory's `test-results`.

For interactive inspection, start `node OperationsOverview/server.js` from `E2E`
and open one of the following routes on `http://127.0.0.1:4201`:

- `/dashboard/10000000-0000-4000-8000-000000000001/incidents/20000000-0000-4000-8000-000000000001`
- `/dashboard/10000000-0000-4000-8000-000000000001/alerts/20000000-0000-4000-8000-000000000001`
- `/dashboard/10000000-0000-4000-8000-000000000001/scheduled-maintenance-events/20000000-0000-4000-8000-000000000001`

Add `?scenario=long-title`, `?scenario=missing-data`, `?scenario=long-feed`, or `?scenario=resolved`
to inspect edge cases. The incident route also supports `?scenario=load-error`.
