# Test Page fixture

An offline harness for sending a test page (#6811): the production
`packages/App/FeatureSet/Dashboard/src/Components/OnCallTestPage` card, button,
dialog and result, as User Settings shows "Test your pages" and a policy's
escalation rules show "Test this policy". It bundles them with esbuild, replaces
only the `ModelAPI` / `API` data boundary and the signed-in user, and serves them
on `127.0.0.1:4293`. No Docker, no database, no sign-in.

The suite pins:

- the dialog says what a test will send before it does: each method in the order
  a real page reaches it, and where to, for the person themselves; for a policy,
  who its first level pages and how, and who it can't reach and why
- what a test costs, when it sends paid texts or calls
- a send asks for the severity picked - and, for a policy, whether to walk every
  level - and nothing else
- the result shows each message as it goes out: who acknowledged it, by what and
  how fast; a message that did not go out with why and a link to fix it; the
  channels a test can't be acknowledged from
- once sent, the dialog has one button, Done
- all of it at 1280 and 390 pixels wide, with nothing to scroll sideways, in dark
  mode and in German

`Fixture/Fixture.js` records every request on `window.__fixture.requests`, so the
assertions check what the dialog sent as well as what it drew. The query string
steers it: `view=policy`, `result=acknowledged|paging|failed`, `cost=1`,
`lang=de`, `theme=dark`.

## Run it

```
cd packages/E2E
npm install --ignore-scripts
CI=1 npm run test-test-page-ui
```

Screenshots land in `output/playwright/test-page-ui`.
