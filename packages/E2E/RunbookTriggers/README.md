# Runbook Triggers fixture

An offline harness for a runbook's real Triggers page
(`packages/App/FeatureSet/Dashboard/src/Pages/Runbook/View/Triggers.tsx`), its
Executions list (`Pages/Runbook/View/Executions.tsx`) and one run's page
(`Pages/Runbook/View/ExecutionView.tsx`). It bundles the production pages with
esbuild, replaces only the `ModelAPI` / `API` data boundary, the plain client
the webhook test calls through, and the synthetic user's permissions, and
serves them on `127.0.0.1:4327`. No Docker, no database, no sign-in.

```sh
cd packages/E2E
npm run test-runbook-triggers-ui
```

The suite drives the page the way a person does:

- a runbook with no schedule: what one does, the docs link, and Set Up
  Schedule; the dialog starting on every weekday at 09:00 on the browser's
  clock, with the next runs under the time zone they are read in; every 2
  hours at :30 picked from its menus, its sentence and next runs, saved as
  its cron with the zone and the default policies, and turned on;
- the day buttons by mouse and by keyboard, the Every day shortcut and the
  time, with the sentence following each;
- a cron expression that cannot run, explained under the field and refused
  before anything is saved, then one that can;
- a schedule paused and turned back on with its switch, saving only that,
  and still saying what it is while paused;
- the webhook switched on: the URL masked until Show, Copy URL copying all of
  it, and the curl example;
- Send Test Request posting the body to the URL with no session, the result
  said beside the button, and the run it started saying Webhook, the caller's
  address and what it was sent;
- a refused test request said in the dialog, which stays open;
- Reset URL asking first, then the new URL;
- a turned-off runbook's notes on both cards, no next runs listed, and
  Settings a link to the runbook's Settings page;
- someone who may edit but not run the runbook: no URL (never even read),
  Edit Schedule locked with the reason on hover, and a schedule they can
  still pause; someone who may only read: both switches locked;
- a phone-width screen, dark mode (`?theme=dark`) and German (`?lang=de`),
  where the next runs are German dates with how far off each is in German;
- the Executions list naming Webhook and Schedule runs, and a webhook run's
  page showing its inputs as text.

`Fixture/Fixture.js` records every save (`updates`), key read and reset and
webhook call (`webhookCalls`, with its URL, body and headers) on
`window.__fixture`, so the assertions check what the page sent as well as what
it drew. The query string steers it - see the comment at the top of
`Fixture/Fixture.js`.
