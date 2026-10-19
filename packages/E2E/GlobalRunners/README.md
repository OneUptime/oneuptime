# Global Runners fixture

An offline harness for the pages that show global Runners, the Runners
OneUptime runs for every project: Runbooks → Runners
(`packages/App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/Runners.tsx`), a
runbook's Steps page with its Runner picker (`Pages/Runbook/View/Steps.tsx`,
`Components/Runner/RunnerPicker.tsx`) and Runbooks → Settings → Global
Variables (`Pages/Runbook/Variables.tsx`). It bundles the production pages
with esbuild,
replaces only the `ModelAPI` / `API` data boundary and the synthetic user's
permissions, and serves them on `127.0.0.1:4361`. No Docker, no database, no
sign-in.

```sh
cd packages/E2E
npm run test-global-runners-ui
```

The suite drives the pages the way a person does:

- Runbooks → Runners on a server that runs global Runners: the Global Runners
  card first and read-only (no Create, no row actions), the bundled one
  connected, with a one-line description; Custom Runners below it, whose
  empty state says "Add a Runner of your own" with Create Runner, and no "no
  Runners" box anywhere; the Global Runners in This Project card at the
  bottom, whose Use global Runners switch is on and is named once;
- turning the switch off asks first: Cancel saves nothing, confirming saves
  `useGlobalRunners: false` and both cards say what the project does instead;
  turning it back on saves without asking; the keyboard does the same;
- a global Runner that is not heard from says Disconnected or Never connected;
  someone who may only read sees the switch locked;
- a server with no global Runner: one Runners card, as before, and a master
  admin is told where global Runners are added (Admin Dashboard → Global
  Runners, in a new tab);
- a JavaScript step starts on Global Runner, offered first with what it is;
  the keyboard picks one of the project's own and the mouse picks Global
  Runner again, and Save Steps sends the Runner the step picked (`""` for
  Global Runner);
- a Bash step offers only the project's own Runners, and with none says what
  to do, with a link to Runbooks › Runners in a new tab; a Runner added there
  (`window.__fixture.addCustomRunner()`) is offered as soon as the window gets
  focus again, with nothing saved; a project that turned global Runners off,
  or a server with none, picks one of the project's own and is told why;
- a JavaScript step on Global Runner offers the timeout range it gets (1–300
  seconds) and says a longer one is cut short, and one of the project's own
  the hour it had; with no global Runner connected, the picker says the step
  fails if none picks it up;
- each folded step says where it runs: "JavaScript on Global Runner", "Bash
  script, needs a Runner", "JavaScript on prod-eu-west-1" once picked, and in
  German;
- the Global Variables list says which secret variables global Runners may
  use; a new secret starts usable by them while the project uses them, and
  closed to them when it does not; a server with no global Runner never asks;
- a phone (nothing runs off the screen, the open picker fits), dark mode
  (`?theme=dark`) and German (`?lang=de`).

`Fixture/Fixture.js` records every save (`updates`, with the model, the id and
the data) and every created record (`creates`) on `window.__fixture`, so the
assertions check what the pages sent as well as what they drew. The query
string steers it - see the comment at the top of `Fixture/Fixture.js`.
Screenshots of each state are written to
`output/playwright/global-runners-ui/`.
