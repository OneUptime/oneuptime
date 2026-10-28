# Metrics AI fixture

An offline harness for Metrics' real AI tab: Metrics' layout with its tabs
and breadcrumbs (`packages/App/FeatureSet/Dashboard/src/Pages/Metrics/Layout.tsx`)
and its AI section (`Pages/Metrics/AI`: the side menu, Insights, a finding's
page with Fix with AI, Logs and Settings) - and Metrics' own Insights tab
(`Pages/Metrics/List`, `Components/Metrics/MetricsDashboard`: the services
reporting metrics, a card each). It bundles the production
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
  time, nothing yet and a read that failed;
- the names a large estate has (`?names=long`): titles and names in code
  wrap inside their card, a long service name in Details ends in an
  ellipsis instead of losing its start, a log entry's kind stays on one
  line, and nothing scrolls sideways.

`MetricsInsights.spec.ts` draws the Insights tab's service cards at every
width - 1440, 1280, 1024 and 768 on the laptop project, 390 on the phone -
from the reads `Fixture/MetricsInsights.js` answers (`?insights=busy`, the
default: seven services and the points no service sent; `long`: the names a
large estate has; `one`; `empty`; and `?fail=metrics`):

- a card each, the busiest first, each one link (to the service's metrics,
  or for the unattributed points to the viewer) with no link inside it;
- the cards of a row end on one line, and their three rows - the service,
  its figures, its names - start on one line, three across from 1024, two
  at 768 and one on a phone;
- nothing in a card runs past it and nothing scrolls sideways: a service's
  name takes two lines at most, its whole name under the pointer, and a
  metric's name of sixty characters wraps inside its chip after its own
  dots;
- dark cards in the dark theme, no metrics in the range, and a read that
  fails.

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
