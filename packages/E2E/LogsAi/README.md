# Logs AI fixture

An offline harness for Logs' real AI tab: Logs' layout with its tabs and
breadcrumbs (`packages/App/FeatureSet/Dashboard/src/Pages/Logs/Layout.tsx`)
and its AI section (`Pages/Logs/AI`: the side menu, Insights, a finding's
page with Fix with AI, Activity and Settings). It bundles the production
components with esbuild, replaces only the `API` / `ModelAPI` /
`AnalyticsModelAPI` data boundary and the synthetic user, and serves them on
`127.0.0.1:4436`. No Docker, no database, no sign-in.

Behind the data boundary, `Fixture/LogFindings.js` answers the pages' reads
the way the server does: OneUptime has found four problems in the project's
logs - checkout logs one payment error 1,240 times in an hour (no fix yet),
POST /charge in payments fails without logging (a pull request OneUptime
opened on its own), one cache line is 62% of billing's logs, and billing's
logs carry no trace context. Each finding's title and evidence are what the
detector writes (Common's `getLogInsightTitle` and `buildLogInsightDetail`),
and no record holds a log line as it was logged: a finding keeps a
message's pattern. Fix with AI is offered by Common's
`getTelemetryAiFixOffer`, as `LogInsightFix.getSuggestion` decides it.

The suite covers, on a laptop and on a phone, light and dark:

- the AI tab between Insights and Setup Guide, lit on every AI page, and the
  side menu's Insights, Activity and Settings (Activity, not Logs: inside
  Logs, a page called Logs would read as log lines);
- Settings: the switch on by default, what pull requests need under it, the
  switch saved when flipped, the AI rules under More settings and a new
  rule's Match, Investigate and Fix in the words of log problems (an error
  log's pull request waits for the code at fault), no repository connected,
  and Enable AI off;
- Insights: the three kinds of finding, the empty state and the one shown
  while the switch is off;
- a finding: its evidence as the detector writes it, Open in Logs (the
  error's lines at Error and Fatal by the message's own words, a noisy
  line's at the severity it was logged at, the service's logs for missing
  trace context, from the hour it was found in), Open in Traces for a
  failure that writes no log line, Fix with AI saying what the pull request
  does, a repository picked when none was found to hold the code, and every
  reason it is not offered; Create Monitor opening Monitor Create on an
  error log, and not drawn on missing logging or a noisy log;
- Activity: every investigation and pull request, newest first, a page at a
  time - each done investigation saying what OneUptime AI found (the error
  log's found its cause outside the code, so no pull request opened on its
  own) - nothing yet and a read that failed.

## Run it

```
cd packages/E2E
npm install
npm run test-logs-ai-ui
```

Screenshots land in `output/playwright/logs-ai-ui/`, named `*-synthetic.png`
because every record in them is fabricated.

## Poke at it by hand

```
cd packages/E2E
node LogsAi/Fixture/server.js --watch
```

then open `http://127.0.0.1:4436/dashboard/10000000-0000-4000-8000-000000000001/logs/ai/insights`.
Scenarios are query parameters, listed at the top of `Fixture/LogFindings.js`.
