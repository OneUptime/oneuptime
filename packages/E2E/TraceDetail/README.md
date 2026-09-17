# Trace detail fixture

An offline harness for the real trace detail page under
`App/FeatureSet/Dashboard/src/Pages/Traces/View`. It bundles the production layout and
the Trace Explorer (header, waterfall, span panel, operations view, flame graph,
service map and related signals) with esbuild, replaces only the `ModelAPI` /
`AnalyticsModelAPI` / `API` data boundary and the synthetic user, and serves them on
`127.0.0.1:4231`. No Docker, no database, no sign-in.

The suite covers:

- the header: title, error status, duration / spans / services / errors / depth, the
  trace id, the service time breakdown and its chips filtering the waterfall, and the
  error count opening the errors-only view
- the waterfall: tree order and levels, the time axis, error bars, collapse / expand
  (per span and all), keyboard navigation, drag-to-zoom on the overview, zoom buttons,
  resizing the name column, the critical path, and the flame graph and service map views
- search and filters: matches kept in context and marked, next / previous match, `/`
  to focus, matching span ids and service names, stacked filters and clearing them
- the span panel: timing, status message, attributes, parent navigation, events, logs
  and exceptions tabs, attribute search into the traces list, zoom to span, a failed
  span read, the per-span Profile tab, and opening a span from a `?spanId=` link
- the operations view: the rollup, the N+1 flag, sorting, and jumping back into the
  waterfall on the chosen operation
- large and unusual traces: a 501-span trace loading its last span, a 1,250-span trace
  staying virtualised and loading the rest in one request, orphaned spans, an empty
  trace, a failed read and the loading skeleton
- actions and related signals: fix performance with AI (created and refused), logs,
  exceptions, metrics (and a failed metrics read) and the profile flame graph
- a phone-sized screen: no sideways scrolling and the span panel as a sheet

`Fixture/Fixture.js` records every read on `window.__traceFixture`, so the assertions
check what the page asked for as well as what it drew.

## Run it

```
cd E2E
npm install
npm run test-trace-detail-ui
```

Screenshots land in `output/playwright/trace-detail-ui/`, named `*-synthetic.png`
because every record in them is fabricated.

## Poke at it by hand

```
cd E2E
node TraceDetail/Fixture/server.js --watch
```

then open
`http://127.0.0.1:4231/dashboard/10000000-0000-4000-8000-000000000001/traces/view/4bf92f3577b34da6a3ce929d0e0e4736`.
`--watch` rebuilds the bundle when a source file changes. The scenario query
parameters (`?trace=`, `?profile=`, `?fail=`, `?hold=`) are documented at the top of
`Fixture/Fixture.js`.
