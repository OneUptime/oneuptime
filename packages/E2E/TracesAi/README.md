# Traces AI fixture

An offline harness for Traces' real AI tab: Traces' layout with its tabs and
breadcrumbs (`packages/App/FeatureSet/Dashboard/src/Pages/Traces/Layout.tsx`)
and its AI section (`Pages/Traces/AI`: the side menu, Insights, a finding's
page with Fix with AI, Logs and Settings). It bundles the production
components with esbuild, replaces only the `API` / `ModelAPI` /
`AnalyticsModelAPI` data boundary and the synthetic user, and serves them on
`127.0.0.1:4392`. No Docker, no database, no sign-in.

Behind the data boundary, `Fixture/TraceFindings.js` answers the pages' reads
the way the server does: OneUptime has found three problems in the project's
traces - GET /orders in checkout runs the same database query 40 times (no
fix yet), POST /checkout fails 12% of the time (a pull request OneUptime
opened on its own) and edge's requests have no spans inside them. Fix with
AI is offered by Common's `getTelemetryAiFixOffer`, as
`TraceInsightFix.getSuggestion` decides it.

The suite covers, on a laptop and on a phone, light and dark:

- the AI tab between Insights and Setup Guide, lit on every AI page, and the
  side menu's Insights, Logs and Settings;
- Settings: the switch on by default, what pull requests need under it, the
  switch saved when flipped, the AI rules under More settings and a new
  rule's Match, Investigate and Fix in the words of trace problems (a failing
  operation's pull request waits for the code at fault), no repository
  connected, and Enable AI off;
- Insights: the three kinds of finding, the empty state and the one shown
  while the switch is off;
- a finding: its evidence as the detector writes it (drawn with Common's
  `buildTraceInsightDetail`), Open in Traces (the operation's spans, only
  the failed ones for a failing operation, from the hour it was found in),
  Fix with AI saying what the pull request does, a repository picked when
  none was found to hold the code - stacked above the button in the
  finding page's narrow rail - and every reason it is not offered; Create
  Monitor opening Monitor Create on a failing operation, disabled with its
  reason on a slow one, and not drawn on missing tracing;
- Logs: every investigation and pull request, newest first, a page at a
  time, nothing yet and a read that failed.

## Run it

```
cd packages/E2E
npm install
npm run test-traces-ai-ui
```

Screenshots land in `output/playwright/traces-ai-ui/`, named `*-synthetic.png`
because every record in them is fabricated.

## Poke at it by hand

```
cd packages/E2E
node TracesAi/Fixture/server.js --watch
```

then open `http://127.0.0.1:4392/dashboard/10000000-0000-4000-8000-000000000001/traces/ai/insights`.
Scenarios are query parameters, listed at the top of `Fixture/TraceFindings.js`.
