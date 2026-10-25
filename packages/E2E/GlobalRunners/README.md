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
- each step's Runner sits under its More fields, whose folded line names it
  ("Runner: Global Runner", "Runner: prod-eu-west-1"); a step that cannot run
  as it is - a Bash step with no Runner and no project default - starts with
  that fold open, on the Runner;
- a JavaScript step starts on Global Runner, offered first with what it is;
  the keyboard picks one of the project's own and the mouse picks Global
  Runner again, and Save Steps sends the Runner the step picked (`""` for
  Global Runner);
- a Bash step offers the project's own Runners and shows the Global Runner
  last, greyed out, saying it runs JavaScript steps only; with no Runner of
  its own it says what to do, with a link to Runbooks › Runners in a new tab;
  a Runner added there (`window.__fixture.addCustomRunner()`) is offered as
  soon as the window gets focus again, with nothing saved; a project that
  turned global Runners off, or a server with none, picks one of the
  project's own and is told why;
- a project with a default Runner (`&default=1`): every step that picked no
  Runner runs on it - the Bash step too - and says so, folded; the picker
  offers it first ("prod-eu-west-1 · Project default · Connected") and the
  Global Runner next, whose pick saves `"global"`; a default that is not
  connected (`&default=2`) is said so; Runbooks › Runners marks the default
  with a pill, and Set as Project Default / Stop Using as Project Default in
  a Runner's ⋯ menu ask first, saying which steps move, with a Runner that
  is not connected said so in a warning of its own; a Runner with Runs
  Runbooks off (`&norunbooks=1`) cannot be made the default; a Runner's own
  page has a Project Default card, after Runner Status, whose switch asks,
  then saves - on office-runner's page (`&runner=2`) its line names the
  Runner that is the default now, or says why it is locked; a long name
  (`&longname=1`) ends in an ellipsis in the list, the pill under it;
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
- Create Runner is one page, with what a Runner may run - Runs Runbooks -
  folded under More fields, and never asks about AI: a code repository's
  settings in Code pick a Runner for AI code fixes, and an auto remediation
  rule picks the Runner OneUptime AI runs its commands on; the Runners list
  shows no AI code fix capability; a Runner's own page (`?page=runner&custom=1`)
  lists the code repositories that pick it in its Runner Details, where the
  switch was, each linked to its settings in Code, or says none does and
  where a repository picks its Runner (`&picks=0`); on a phone its Setup
  Instructions show the command;
- a phone (nothing runs off the screen, the open picker fits), dark mode
  (`?theme=dark`) and German (`?lang=de`);
- in a project with no Runner of its own, each step's Runner field at 1280px
  and 390px, light and dark: the JavaScript step on Global Runner, saying
  what runs there, and the Bash step never on it, saying it needs a Runner of
  your own and where to add one, with the open menu on the screen.

`Fixture/Fixture.js` records every save (`updates`, with the model, the id and
the data) and every created record (`creates`) on `window.__fixture`, so the
assertions check what the pages sent as well as what they drew. The query
string steers it - see the comment at the top of `Fixture/Fixture.js`.
Screenshots of each state are written to
`output/playwright/global-runners-ui/`.
