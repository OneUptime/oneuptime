# Exceptions AI fixture

An offline harness for Exceptions' real AI tab: Exceptions' layout with its
tabs and breadcrumbs (`packages/App/FeatureSet/Dashboard/src/Pages/Exceptions/Layout.tsx`)
and its AI section (`Pages/Exceptions/AI`: the side menu, Insights, a
finding's page with Fix with AI, Logs and Settings). It bundles the
production components with esbuild, replaces only the `API` / `ModelAPI` /
`AnalyticsModelAPI` data boundary and the synthetic user, and serves them on
`127.0.0.1:4398`. No Docker, no database, no sign-in.

Behind the data boundary, `Fixture/ExceptionFindings.js` answers the pages'
reads the way the server does: OneUptime has found three problems in the
project's exceptions - a new TypeError in checkout raised in its own code
(no fix yet), a spike of PaymentDeclinedError in payments (a pull request
OneUptime opened on its own, to handle that expected error better) and
edge's exceptions, which carry no stack trace. Fix with AI is offered by
Common's `getTelemetryAiFixOffer`, with the pull request it would be, as
`ExceptionInsightFix.getSuggestion` decides it.

The suite covers, on a laptop and on a phone, light and dark:

- the AI tab between Insights and Setup Guide, lit on every AI page, and the
  side menu's Insights, Logs and Settings;
- Settings: the switch on by default, what pull requests need under it, the
  switch saved when flipped, the AI rules under More settings and a new
  rule's Match, Investigate and Fix in the words of exceptions (a pull
  request opens on its own once the code is found at fault, or an expected
  error to handle better), no repository connected, and Enable AI off;
- Insights: the three kinds of finding, the empty state and the one shown
  while the switch is off;
- a finding: its evidence as the detector writes it (drawn with Common's
  `buildNewExceptionDetail` and `buildExceptionStackTraceDetail`, the frames
  of your own code included), View Exception Group, Open in Exceptions (a
  service's unresolved exceptions over the day it was read), Fix with AI
  saying what the pull request does - a fix, better handling of an expected
  error, or stack traces recorded - a repository picked when none was found
  to hold the code, and every reason it is not offered; Create Monitor on a
  new exception, and none on missing stack traces;
- Logs: every investigation and pull request, newest first, a page at a
  time, nothing yet and a read that failed.

## Run it

```
cd packages/E2E
npm install
npm run test-exceptions-ai-ui
```

Screenshots land in `output/playwright/exceptions-ai-ui/`, named
`*-synthetic.png` because every record in them is fabricated.

## Poke at it by hand

```
cd packages/E2E
node ExceptionsAi/Fixture/server.js --watch
```

then open `http://127.0.0.1:4398/dashboard/10000000-0000-4000-8000-000000000001/exceptions/ai/insights`.
Scenarios are query parameters, listed at the top of `Fixture/ExceptionFindings.js`.
