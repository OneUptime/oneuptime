# Metrics AI fixture

An offline harness for Metrics' real AI tab: Metrics' layout with its tabs
and breadcrumbs (`packages/App/FeatureSet/Dashboard/src/Pages/Metrics/Layout.tsx`)
and its AI section (`Pages/Metrics/AI`: the side menu, Insights, a finding's
page with Fix with AI, Logs and Settings). It bundles the production
components with esbuild, replaces only the `API` / `ModelAPI` /
`AnalyticsModelAPI` data boundary and the synthetic user, and serves them on
`127.0.0.1:4463`. No Docker, no database, no sign-in.

Behind the data boundary, `Fixture/MetricFindings.js` answers the pages'
reads the way the server does: OneUptime has found four problems in the
project's metrics - checkout's request counter records 12,000 different
user.id values an hour (no fix yet), checkout's request duration histogram
puts 95% of its values in its smallest bucket (a pull request OneUptime
opened on its own), worker sends 1,234 metrics named like job.{id}.duration,
and payments sends traces but no metrics. Each title and each finding's
evidence are drawn with Common's `getMetricInsightTitle` and
`buildMetricInsightDetail`, as the detector writes them. Fix with AI is
offered by Common's `getTelemetryAiFixOffer`, as
`MetricInsightFix.getSuggestion` decides it.

The suite covers, on a laptop and on a phone, light and dark:

- the AI tab between Insights and Setup Guide, lit on every AI page, and the
  side menu's Insights, Logs and Settings;
- Settings: the switch on by default, what pull requests need under it, the
  switch saved when flipped, the AI rules under More settings and a new
  rule's Match, Investigate and Fix in the words of metric problems, no
  repository connected, and Enable AI off;
- Insights: the three kinds of finding, the empty state and the one shown
  while the switch is off;
- a finding: its evidence as the detector writes it, with no attribute's
  values; Open in Metrics (the metric for the service, from the hour it was
  found in, or the service's metric list searched for names with ids); Open
  in Traces for a service with no metrics; Fix with AI saying what the pull
  request does, a repository picked when none was found to hold the code,
  and every reason it is not offered; and no Create Monitor on any of them;
- Logs: every investigation and pull request, newest first, a page at a
  time, nothing yet and a read that failed.

## Run it

```
cd packages/E2E
npm install
npm run test-metrics-ai-ui
```

Screenshots land in `output/playwright/metrics-ai-ui/`, named
`*-synthetic.png` because every record in them is fabricated.

## Poke at it by hand

```
cd packages/E2E
node MetricsAi/Fixture/server.js --watch
```

then open `http://127.0.0.1:4463/dashboard/10000000-0000-4000-8000-000000000001/metrics/ai/insights`.
Scenarios are query parameters, listed at the top of `Fixture/MetricFindings.js`.
