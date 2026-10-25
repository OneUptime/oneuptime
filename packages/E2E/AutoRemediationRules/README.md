# AI rules fixture

An offline harness for the AI rules on Incidents → AI → Settings and Alerts →
AI → Settings: which new incidents (or alerts) OneUptime AI investigates, and
whether - and how - it fixes them. The investigation rules and the auto
remediation rules became one AI rule: "Should incident investigation rule and
remediation rule be the same entity ... Since its not possible to remediate
without investigation" - the maintainer. The pages
(`packages/App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentAISettings.tsx`
and `Pages/Alerts/Settings/AlertAISettings.tsx`), their More settings fold,
the AI rules table (`Components/AISettings/AiRulesTable.tsx`), its create and
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

`AutoRemediationRules.spec.ts` drives a rule the way a person does:

- a rule asks a step each: Match (all incidents to start with), Investigate
  (right away to start with) and Fix - one question with three answers,
  Don't fix, Ask before fixing (a new rule's) and Fix without asking, with no
  OneUptime AI or Runbooks choice - then its name; More fields is folded
  under it, and its line says what the defaults do in one sentence while a
  rule keeps them all (OneUptime AI may use any of your runbooks, MCP servers
  and connected repositories, and open pull requests in them), then one
  sentence for each default left;
- a rule made without opening More fields investigates right away and asks
  before fixing - both said in the create - as OneUptime AI's, with no
  runbook, no Runner, every repository and both pull requests on;
- Don't fix makes a rule that only investigates, what an investigation rule
  was: More fields keeps the code repositories, the MCP servers and the LLM
  provider OneUptime AI investigates with, and drops the runbooks, the Runner
  and the pull requests; an answer taken back keeps what was picked;
- open, More fields holds, in this order, the code repositories, the MCP
  servers, the LLM provider, the runbooks OneUptime AI may run ("Any
  runbook" when none is picked), "Run them every time" once the rule names
  runbooks, the Runner OneUptime AI runs the rule's Bash commands on (the
  project's own Runners with how each is doing, the default first and tagged
  - a new rule starts on it, `?defaultRunner=prod` - and the Global Runner,
  which a rule that picks none shows, never the AI agent on the cluster or
  host and never the in-cluster Runner the Kubernetes agent chart
  installed), the two pull requests and the description; the repositories
  come first, the one field every rule shows, so the fold stays open
  whatever the Fix answer;
- "If there are no runners, it should use the global runner by default"
  (the maintainer): a rule that picks no Runner shows "Global Runner ·
  Connected", with the line that OneUptime AI runs no Bash commands there,
  which every project shares, and how to have them run - pick one of your
  Runners, or, with none (`?runners=0`), add one under Runbooks › Runners,
  linked in a new tab; picking the Global Runner saves no Runner, and there
  is nothing to clear; a Global Runner not heard from lately
  (`?globalRunners=disconnected`) is shown so, and nothing of the rule's
  waits on it; a project that turned global Runners off
  (`?useGlobalRunners=0`), or a server with none (`?globalRunners=0`),
  reads "No Runner" as before, and a pick clears back to it; the field at
  1280px and 390px, light and dark, with Runners and without, the menu
  open, and in German and Persian (`?lang=fa`, right to left);
- a Runner picked is always named on the folded line ("Runner:
  prod-eu-runner", with " · Never connected" for one that is not connected);
  the Global Runner, the field's default, is never named there;
- the code repositories ("All connected repositories" when none is picked,
  with a link to Code › Repositories), drawn like the Runbooks and MCP
  Servers pickers (one height, chips, no chevron), each hint close under its
  own box and a field's gap above the next; picks are sent and counted on the
  folded line, a saved rule keeps them, a project with no repository
  (`?repositories=0`) or a plan without Code (`?repositories=denied`) still
  saves a rule, picking one at a time works after Escape, a short name is
  never cut for its GitHub name on a phone (`?repositories=many`), the hints
  open their pages in a new tab with the list read again on coming back
  (`window.__fixture.connectRepository`), and a repository the reader cannot
  access is kept and named in full on its chip (`?hiddenRepository=1`);
- the rules that were auto remediation rules (`?rules=saved`): the table's one
  column, "Investigates and fixes", says when each investigates - right away
  for the one merged with an investigation rule, "Doesn't investigate" for
  the others - and how it fixes (its runbooks every time, OneUptime AI, and
  the two older shapes); editing one keeps what it does; a rule that only
  fixes says so on its Investigate step, and "Investigate too" makes it
  investigate right away, while Don't fix is refused for it; an older rule
  says what it still does, and "Fix like a new rule" makes it ask first;
- an alert rule asks the same;
- the LLM provider OneUptime AI uses for what a rule starts
  (`?providers=project|none|denied`, `?rulePick=opus|gone`): the field's one
  line; the empty box naming the provider an empty field uses; the folded
  line naming it only while there is more than one to pick from; a pick sent
  with the rule and named on the folded line, and cleared back to none; a
  pick no longer available, with its warning; a locked box; a provider added
  on LLM Providers in another tab (`window.__fixture.addProvider`) picked on
  return; a rule that only runs its runbooks every time and does not
  investigate uses none, while a new one that runs them every time still
  investigates with one;
- a viewer reads the rules but cannot add or edit one; a phone, dark mode
  (`?theme=dark`) and German (`?lang=de`); the AI card and the rule dialog,
  for a rule that fixes and one that doesn't, at 1280px and 390px, light and
  dark, with nothing off the screen.

`InvestigationRules.spec.ts` drives a rule's Investigate step (issue #5074,
`?investigationRules=saved` seeds the two rules the upgrade made of a lane's
investigation rules: one that investigates right away and one that waits 10
minutes, both fixing nothing):

- the table's one column says when each rule investigates, and under it that
  it doesn't fix;
- a new rule asks Match, then Investigate, and starts on Right away, which
  sends no wait; Only if still open after a wait asks the minutes, from 10,
  and sends the ones chosen; a wait the server would refuse (0, 1441, 2.5)
  is stopped on the step;
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
