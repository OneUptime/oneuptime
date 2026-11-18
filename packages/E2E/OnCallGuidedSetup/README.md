# The guided on-call setup, looked at

The guided setup **Page the right person when something breaks**
(`packages/App/FeatureSet/Dashboard/src/Components/GuidedSetup/OnCall/`, routed at
`/dashboard/<project>/on-call-duty/setup`) in real Chromium, over the journeys' fixture
(`../Journeys/Fixture`, `../Journeys/README.md`): the whole Dashboard from this branch, a project
made a minute ago, kept in memory, nothing leaving the machine. Issue #7152.

jsdom (`Common/Tests/App/Dashboard/OnCallGuidedSetup.test.tsx`) holds what each step does, and
the journey `paged-by-phone-guided` counts what the job costs a newcomer. This suite looks at the
page:

- every step and the summary, walked as a person walks them, at 1280 and 390 pixels, light and
  dark, in German and in Persian (right to left): 8 looks, each step drawn and held to fitting
  its window (`SuiteHelpers/PageFit`'s `expectNoSidewaysScroll`)
- on the way, what the steps gained: **Get the app**'s codes and **Use this browser** in a
  browser that blocks notifications, which the step says in its own words (#7149); **Invite by
  email**, and the step left open on the invited person until they can be reached (#7150); the
  step named **Who is paged first?** (#7372); and the summary saying the order a page reaches
  each person (#7154)
- a member who may not turn SMS and calls on (`?as=member`): no button for it, told who can
- a self-hosted server's master admin with no Twilio (`?as=admin`): told so, with **Set up SMS
  and calls** to the Admin Dashboard

The fixture's query parameters this suite uses: `billing=on` (OneUptime Cloud), `seed=phones`
(SMS and calls on, with money in the balance), `as=member`, `as=admin` and `theme=dark`. The
reader's language is set where the Dashboard keeps it (`oneuptimeLang`).

## Run it

```
cd packages/E2E
npm install --ignore-scripts
npm run test-on-call-guided-setup-ui
```

The fixture runs on `127.0.0.1:4852` (`ON_CALL_GUIDED_SETUP_FIXTURE_PORT`) and builds into
`output/playwright/on-call-guided-setup-ui/fixture`, apart from the journeys' bundles. The
pictures land in `output/playwright/on-call-guided-setup-ui/`, one per look and moment:
`<language>-<theme>-<width>-<moment>.png`, such as `fa-dark-390-2-who-invite.png`.
