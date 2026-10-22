# Auto remediation rules fixture

An offline harness for the auto remediation rules on Incidents → AI →
Settings and Alerts → AI → Settings: which new incidents (or alerts)
OneUptime AI fixes, and whether it asks first. The pages
(`packages/App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentAISettings.tsx`
and `Pages/Alerts/Settings/AlertAISettings.tsx`), their More settings fold,
the Auto remediation rules table
(`Components/AutoRemediation/AutoRemediationRulesTable.tsx`), its create and
edit dialogs, the rule's More fields
(`Components/AutoRemediation/AutoRemediationRuleFields.tsx`) and the one
Runner picker (`Components/Runner/RunnerPicker.tsx`) are the production ones.
It bundles them with esbuild, replaces only the `ModelAPI` / `API` data
boundary and the synthetic user's permissions, and serves them on
`127.0.0.1:4395` (`AUTO_REMEDIATION_RULES_FIXTURE_PORT`). No Docker, no
database, no sign-in.

```sh
cd packages/E2E
npm run test-auto-remediation-rules-ui
```

The suite drives the pages the way a person does:

- the Fix step asks one question, Approval, with no OneUptime AI or Runbooks
  choice; More fields is folded under it, and its line says what the defaults
  do in one sentence while a rule keeps them all (OneUptime AI may use any of
  your runbooks, MCP servers and connected repositories, and open pull
  requests in them), then one sentence for each default left;
- open, More fields holds the runbooks OneUptime AI may run ("Any runbook"
  when none is picked) and the Runner OneUptime AI runs the rule's Bash
  commands on: the project's own Runners with how each is doing, the default
  first and tagged (a new rule starts on it, `?defaultRunner=prod`), "No
  Runner" while none is picked, never the AI agent on the cluster or host
  (its line says commands there go through it), never the in-cluster Runner
  the Kubernetes agent chart installed and never a global Runner;
- a rule made without opening More fields is sent as OneUptime AI's, with no
  runbook, no Runner, every repository and both pull requests on; the
  runbooks and the Runner picked are sent, and the folded line names them -
  the Runner by name ("Runner: prod-eu-runner", the default a new rule starts
  on included, with " · Never connected" for one that is not connected), as
  a runbook step's line names its Runner;
- "Run them every time" appears once the rule names runbooks: the rule starts
  them for every match, picks no Runner, and needs a runbook to run;
- a project with no Runner of its own reads No Runner, has nothing to pick,
  and is told where to add one;
- the code repositories OneUptime AI may use ("All connected repositories"
  when none is picked, with a link to Code › Repositories), drawn like the
  Runbooks and MCP Servers pickers beside it (one height, chips, no chevron),
  each hint close under its own box and a field's gap above the next, and
  the rule's two
  pull request switches, Fix pull requests and Telemetry pull requests, on for
  a new rule - they moved here from the AI settings card, which now draws
  fixing alone; picks are sent and counted on the folded line, a saved rule
  keeps them, a project with no repository (`?repositories=0`) or a plan
  without Code (`?repositories=denied`) still saves a rule, and an
  investigation rule names its repositories too, with no Runner;
- picking repositories one at a time (after Escape, a click on the box opens
  the list again), a short name never cut for its GitHub name on a phone
  (`?repositories=many`), the hints opening their pages in a new tab with
  the list read again on coming back (`window.__fixture.connectRepository`),
  a rule saved before the switches moved opening with both on, and a
  repository the reader cannot access kept and named in full on its chip
  (`?hiddenRepository=1`);
- rules saved before this change: the table names each for what it does (its
  runbooks every time, OneUptime AI, and the two older shapes), and editing
  one keeps what it does - a rule that runs its runbooks every time opens
  with them, the switch on and no Runner, and a OneUptime AI rule with its
  runbooks and its Runner, which can go back to No Runner;
- an alert rule asks the same;
- a viewer reads the rules but cannot add or edit one; a phone, dark mode
  (`?theme=dark`) and German (`?lang=de`); the AI card and both rule dialogs
  at 1280px and 390px, light and dark, with nothing off the screen.

`InvestigationRules.spec.ts` drives the investigation rules beside them on the
same page (issue #5074, `?investigationRules=saved` seeds one rule that
investigates right away and one that waits 10 minutes):

- the table's Investigates column says when each rule investigates;
- a new rule asks Match, then Investigate, and starts on Right away, which
  sends no wait; Only if still open after a wait asks the minutes, from 10,
  and sends the ones chosen; a wait the server would refuse (0, 1441, 2.5) is
  stopped in the form;
- a rule that waits opens on its minutes, and Right away clears them (sent as
  null);
- an alert rule asks the same, about alerts; a phone, dark mode and German;
- at 1280px beside the side menu (`?layout=page`, the Dashboard's own frame,
  a card of about 940px), a full table (`?investigationRules=many`: a long
  name, three conditions, waits of up to a day) keeps every column in sight
  in English and in German, and a wait reads on one line in English.

`Fixture/Fixture.js` records every created record (`creates`), every update
(`updates`, with the model, the id and the data) and every delete
(`deletes`) on `window.__fixture`, so the assertions check what the pages
sent as well as what they drew. The query string steers it - see the comment
at the top of `Fixture/Fixture.js`. Screenshots of each state are written to
`output/playwright/auto-remediation-rules-ui/`.
