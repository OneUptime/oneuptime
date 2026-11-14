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
- its warnings, why each person is paged and who it can't reach are worded in
  the reader's language from the codes the server sends (#7015); a server from
  before the codes is shown in its own English
- a policy's test that walks every level shows each level it reaches, when it is
  paged and who it pages, and what the whole walk costs at most (#7016), as a
  timeline: a numbered marker for each level and a line down to the next, on
  the left - or on the right, read from the right
- what a test costs, when it sends paid texts or calls: the texts and calls
  listed as the reader's language lists them, the amount as the reader writes
  money
- a phone number in the preview keeps its own direction beside Persian words
- the preview's numbered list of methods counts in Persian digits on a Persian
  page ("۱. ۲."), and in Latin ones on an Arabic page, which writes them by
  choice (#7258)
- a send asks for the severity picked - and, for a policy, whether to walk every
  level - and nothing else
- the result shows each message as it goes out: who acknowledged it, by what and
  how fast; a message that did not go out with why and a link to fix it; the
  channels a test can't be acknowledged from
- once sent, the dialog has one button, Done
- all of it at 1280 and 390 pixels wide, with nothing to scroll sideways, in dark
  mode, in German, and in Persian and Arabic, read from the right

`Fixture/Fixture.js` records every request on `window.__fixture.requests`, so the
assertions check what the dialog sent as well as what it drew. The query string
steers it: `view=policy`, `result=acknowledged|paging|failed`, `cost=1`,
`old=1` (the preview as a server from before #7015 and #7016 sends it),
`lang=de|fa|ar`, `theme=dark`.

## Run it

```
cd packages/E2E
npm install --ignore-scripts
CI=1 npm run test-test-page-ui
```

Screenshots land in `output/playwright/test-page-ui`.
