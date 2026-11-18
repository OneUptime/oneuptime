# The guided website setup, looked at

The guided setup **Know when my website or API is down**
(`packages/App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/`, routed at
`/dashboard/<project>/monitors/setup`) in real Chromium, over the journeys' fixture
(`../Journeys/Fixture`, `../Journeys/README.md`): the whole Dashboard from this branch, a project
made a minute ago, kept in memory, nothing leaving the machine. Issue #7056.

jsdom (`Common/Tests/App/Dashboard/WebsiteDownGuidedSetup.test.tsx`) holds what each step does, and
the journey `website-down-guided` counts what the job costs a newcomer. This suite looks at the
page:

- every step and the summary, walked as a person walks them, at 1280 and 390 pixels, light and
  dark, in German and in Persian (right to left): 8 looks, each step drawn and held to fitting
  its window (`SuiteHelpers/PageFit`'s `expectNoSidewaysScroll`)
- on the way, what the steps gained: how many locations check the address (#7461), **How to
  Reach Me** opening in a tab of its own (#7757), the test page dialog's line under **Severity**
  (#7756), **Show it to customers?** adding the monitor to the project's status page (#7053), and
  the summary's **Get paged by SMS or phone call** (#7370)
- a run left on its test and opened again: back on the test, nothing made twice
- a test page nobody acknowledges (`?test=unanswered`): **Done**, then **I did not get it**
- a self-hosted server that cannot send email yet (`?as=admin&email=off`): the step says so,
  with **Set up email** for its master admin, and **Skip the test** goes on to the summary
- a teammate's monitor already checking the address (`?as=member&seed=teammate-monitor`, #7254):
  named with who made it, linked in a tab of its own, and **Create my own monitor** goes on with
  one of the person's own, leaving the teammate's as it was

The fixture's query parameters this suite uses: `seed=status-page` (a status page showing
nothing yet), `seed=teammate-monitor` (Ada's monitor of `https://acme-commerce.example`),
`as=member`, `as=admin`, `email=off`, `test=unanswered` and `theme=dark`. The reader's language is
set where the Dashboard keeps it (`oneuptimeLang`).

## Run it

```
cd packages/E2E
npm install --ignore-scripts
npm run test-website-down-guided-setup-ui
```

The fixture runs on `127.0.0.1:4853` (`WEBSITE_DOWN_GUIDED_SETUP_FIXTURE_PORT`) and builds into
`output/playwright/website-down-guided-setup-ui/fixture`, apart from the journeys' bundles. The
pictures land in `output/playwright/website-down-guided-setup-ui/`, one per look and moment:
`<language>-<theme>-<width>-<moment>.png`, such as `fa-dark-390-3-test-dialog.png`.
