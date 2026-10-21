# Runbooks menu fixture

An offline harness for the Runbooks side menu after AI Access went. It mounts
the real Runbooks route group (`packages/App/FeatureSet/Dashboard/src/Routes/RunbookRoutes.tsx`:
the Runbooks layout, its side menu `Pages/Runbook/SideMenu.tsx`, the real list
pages and the forwarding of AI Access's old address) and the real Settings
route group (for the oldest address of the same page) at their real
addresses, as `App.tsx` does. It bundles them with esbuild, replaces only the
`ModelAPI` / `API` data boundary and the signed-in user - a project with no
runbooks, executions, Runners or variables yet - and serves them on
`127.0.0.1:4388` (`RUNBOOKS_MENU_FIXTURE_PORT` moves it). No Docker, no
database, no sign-in.

```sh
cd packages/E2E
npm run test-runbooks-menu-ui
```

AI Access (Runbooks → Runners → AI Access) held the runbook credentials
OneUptime AI's own commands reached a host or a Kubernetes cluster with.
Hosts and clusters have AI agents of their own now, so the page and the
credentials are gone, and the Runners, which had a folded section of their
own beside it, are an entry of the menu's first section. What the suite
checks, in Chromium, that jsdom cannot (the jest suites `RunnerNavigation`
and `RunbookRunnerRoutes` in packages/Common and `RunnersLiveUnderRunbooks`
in packages/App read the menu and the routes in code):

- at a laptop's 1280 pixels the sections read Runbooks, Settings and
  Developer; Runbooks is open and lists Runbooks, Executions and Runners, in
  that order, Runners with its icon and drawn above the folded Settings
  section, which holds Global Variables, Owner Rules and Label Rules; no
  entry, word or address of AI Access is left;
- Runners leads to the real Runners page, marked in the menu, under the
  Runbooks › Runners breadcrumb;
- AI Access's old address (`…/runbooks/runner-credentials`) opens the
  Runners in one hop, keeping its query string, and Back does not bounce
  through it; Project Settings' Runner Credentials (`…/settings/runner-credentials`)
  opens them too;
- the keyboard goes from Executions to Runners to the Settings section, with
  no fold in between, and Enter on Runners opens its page;
- at a phone's 390 pixels the menu opens to the same three entries, with no
  AI Access, and neither the page nor the open menu runs off the screen;
  Runners leads to its page and the menu's summary names it;
- in German (`?lang=de`) the entry is the Runners' German name
  (Runbook-Agents) and no AI Access is left in either language; in dark mode
  (`?theme=dark`) the entry reads against the menu.

The suite fails on an uncaught page error, or a request that leaves the
fixture server. The reads the real pages make are recorded on
`window.__runbooksMenuFixture.reads` for whoever debugs a run.

Screenshots land in `output/playwright/runbooks-menu-ui/`, named
`*-synthetic.png` because every record in them is fabricated by
`Fixture/Fixture.js`.
