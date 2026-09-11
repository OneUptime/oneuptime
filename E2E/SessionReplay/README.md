# Session replay UI regression tests

Run the targeted browser suite from `E2E`:

```sh
npm run test-session-replay-ui
```

The suite builds and serves the production RUM application layout, navigation,
recording list, documentation, policy and player on `127.0.0.1:4212`. It needs
repository dependencies and the Playwright Chromium browser installed. It does
not need a running backend, an account, telemetry credentials or external data.

Only the API boundary and the synthetic user's permission snapshot are replaced.
The shared table, facet dropdowns, routes, player controls, event rail, manifest
parser, binary chunk decoder and lazy-loaded rrweb player run unchanged. The
recording is a synthetic checkout page containing moving rrweb DOM mutations,
clicks, a failed request, a client error, a rage click and navigation events.

Coverage includes semantic table markup, the separate Session Replay menu group,
facet combinations and request values, URL restoration, search guidance,
installation versus filtered empty states, retry, cursor pagination, sort resets,
actual reconstructed footage advancing, pause/seek/speed, visibility of speed
options, event search and details, rail collapse, keyboard tab navigation, and
mobile overflow and controls.

Screenshots are written to `output/playwright/session-replay-ui/`. They are
production UI screenshots with synthetic data, not screenshots of a separate
mockup. Failure traces and screenshots are under its `test-results` directory.

For the separate full-stack ingest-to-playback contract, run the existing suite
against a complete development stack:

```sh
HOST=dev.oneuptime.com npx playwright test \
  Tests/Dashboard/SessionReplay.spec.ts --project=chromium
```

That suite exercises real project onboarding, telemetry keys, ingest,
storage, playback and audit events. The offline UI suite does not substitute
for this backend integration coverage.
