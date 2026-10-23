# Security operations fixture

An offline harness for the Security Events SOC pages, on a month of synthetic security work:

| Page                 | Route (from `RouteMap`)                                                           | Production components                                                                      |
| -------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Overview             | `SECURITY_EVENTS_OVERVIEW` `/dashboard/:projectId/security-events/overview`       | `Pages/SecurityEvents/{Layout,Overview}`, `SecurityOverview/*`                             |
| Open Cases           | `SECURITY_CASES` `.../security-events/cases`                                      | `Pages/SecurityEvents/Cases`, `SecurityCasesTable` inside `ModelTable`                     |
| Assigned to Me       | `SECURITY_CASES_ASSIGNED_TO_ME` `.../security-events/cases/assigned-to-me`        | the same, with the list `SecurityCaseQueueViews` gives the page                            |
| Unassigned           | `SECURITY_CASES_UNASSIGNED` `.../security-events/cases/unassigned`                | the same                                                                                   |
| Closed Cases         | `SECURITY_CASES_CLOSED` `.../security-events/cases/closed`                        | the same                                                                                   |
| All Cases            | `SECURITY_CASES_ALL` `.../security-events/cases/all`                              | the same                                                                                   |
| A case               | `SECURITY_CASE_VIEW` `.../security-events/cases/:id`                              | `Pages/SecurityEvents/CaseView`, `SecurityCase/*`, `EventNotes`, `SecurityPlaybookRunCard` |
| Entities             | `SECURITY_EVENTS_ENTITIES` `.../security-events/entities`                         | `Pages/SecurityEvents/Entities`                                                            |
| Detection Rules      | `SECURITY_EVENTS_DETECTION_RULES` `.../security-events/detection-rules`           | `Pages/SecurityEvents/DetectionRules`, `DetectionRuleSummary`                              |
| Rule Library         | `SECURITY_EVENTS_RULE_LIBRARY` `.../security-events/rule-library`                 | `Pages/SecurityEvents/RuleLibrary`                                                         |
| Threat Intel         | `SECURITY_EVENTS_THREAT_INTEL` `.../security-events/threat-intel`                 | `Pages/SecurityEvents/ThreatIntel`, `ThreatIntelRecommendedLists`                          |
| ATT&CK Coverage      | `SECURITY_EVENTS_ATTACK_COVERAGE` `.../security-events/attack-coverage`           | `Pages/SecurityEvents/AttackCoverage`                                                      |
| Playbooks            | `SECURITY_PLAYBOOKS` `.../security-events/playbooks`                              | `Pages/SecurityEvents/Playbooks`                                                           |
| A playbook           | `SECURITY_PLAYBOOK_VIEW` `.../security-events/playbooks/:id`                      | `Pages/SecurityEvents/PlaybookView`, `SecurityPlaybookStepsEditor`                         |
| Waiting for Approval | `SECURITY_PLAYBOOK_RUNS_WAITING_FOR_APPROVAL` `.../security-events/playbook-runs` | `Pages/SecurityEvents/PlaybookRuns`, with the runs `SecurityPlaybookRunViews` gives it     |
| Playbook Runs        | `SECURITY_PLAYBOOK_RUNS` `.../security-events/playbook-runs/all`                  | the same                                                                                   |
| AI Settings          | `SECURITY_EVENTS_SETTINGS_AI` `.../security-events/ai/settings`                   | `Pages/SecurityEvents/AISettings`, `AISettings/ProjectAiSwitchesCard`, `ProjectAiNotice`   |

`Fixture/server.js` bundles the production layout (breadcrumbs, the Security Events side menu) and
the pages with esbuild, serves them with the same Tailwind build, `tailwind.config`, Inter font and
`Theme.css` production uses, and listens on `127.0.0.1:4234` (`SECURITY_OPERATIONS_FIXTURE_PORT`).
No Docker, no database, no sign-in.

## What is real and what is stubbed

Real: the layout and side menu, every page above, the tables, cards, charts, the case header and
status steps, the playbook step editor and run cards, the approval dialog, `PermissionGate`, and
the overview's numbers: the fixture answers `POST /security-case/overview` with what
`computeSecurityOverviewMetrics` (the function the server calls) works out from its own rows.

Stubbed:

- The data boundary: `ModelAPI` and `API` answer from in-memory tables, filtered by the queries the
  pages send (`Includes`, `IsNull`, equality) and sorted. `AnalyticsModelAPI` answers Threat Intel's
  Indicators table, and only it. `POST /security-case/top-entities`,
  `/security-case/entity-activity` and `/security-playbook-run/:id/approve|reject` answer as the
  server would; approving the held step runs the rest of its playbook at once. The Overview's set-up
  routes answer as `SecuritySetup` does, on the fixture's own tables: `/security-case/setup/status`
  counts the connections, your logs, the rules, the open cases and the playbooks;
  `/security-case/setup/turn-on-recommended` turns your logs on and adds the recommended rules and
  Enrich New Cases, knowing a project's rule by its Sigma id or its name, and answers what it could
  not do (`problems`); `/security-case/setup/test` opens CASE-150, the brute force case a test attack
  opens.
- OneUptime AI's routes answer as the server would on the fixture's own triages: CASE-142 (the
  spray, Likely Malicious, suggesting Contain Compromised Okta Users, whose run on it waits for
  an approval), CASE-138 (Likely Malicious, suggesting Critical over its High and Enrich New
  Cases, whose run on it failed), CASE-139 (Inconclusive) and CASE-137 (Likely Benign) carry the
  read on their `ai*` columns, as the runner writes it.
  `POST /security-case/:id/ai-triage` answers each one's finished run and the checks its report
  cites; `/ai-triage/evidence` answers a cited check's rows, pinned to when the triage read them;
  `/ai-triage/start` on CASE-141 (not read yet) starts a run the fixture walks one status read at a
  time - queued, two checks, done - and, done, writes the read onto the case.
  `POST /detection-rule/draft-with-ai` answers a counting correlation for any description of a
  sentence or more, and `POST /ai-chat/providers` OneUptime Cloud's provider.
- The signed-in user ("Maya Chen" of a generic "Acme Commerce" workspace), her teammates and her
  permissions. Profile pictures are drawn as initials. The fixture header says the data is
  synthetic ("Preview workspace · Synthetic data"). Every name, domain and address is made up
  (`*.example` domains, documentation IP ranges).
- Realtime: nothing pushes changes.
- The menu's other pages (Events, Correlate, Connections, Setup Guide) render a small stub page,
  inside the real layout and its side menu.

The clock is pinned: the spec fixes the browser clock to `2026-10-14T12:00:00Z`, and the month of
history is laid out from it with a seeded generator, so every run draws the same pages.

## Scenarios

| Parameter   | Values                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `?theme=`   | `dark` adds `html.dark` (done in `server.js`, before the bundle runs)                                                                                                                                                                                                                                                                                                                                                              |
| `?empty=`   | `1`: a project that has set nothing up - no cases, detections, playbooks or rules                                                                                                                                                                                                                                                                                                                                                  |
| `?quiet=`   | `1`: a project that has set Security up (a connection, its logs, rules, playbooks) and that nothing has happened to: no cases, detections or runs                                                                                                                                                                                                                                                                                  |
| `?role=`    | `owner` (default) or `viewer`: Security Viewer only, so it reads but cannot decide a held step                                                                                                                                                                                                                                                                                                                                     |
| `?lists=`   | `all`: the project reads every free list already, so Threat Intel shows no Free Lists card                                                                                                                                                                                                                                                                                                                                         |
| `?ai=`      | `off`: the project's Enable AI is off, so no AI card, AI Verdict, Draft with AI or AI trigger is drawn, and AI Settings says AI is off                                                                                                                                                                                                                                                                                             |
| `?sources=` | `silent`: the sources sent their last security event three days ago and nothing since (the Overview's top says when, and the Sources cell says it in amber)                                                                                                                                                                                                                                                                        |
| `?fail=`    | `status` or `overview`: the Overview's set-up figures, or its overview, cannot be read the first time (a 500); Try again reads them again and they answer                                                                                                                                                                                                                                                                          |
| `?setup=`   | Turn on recommended that cannot do everything: `partly` (the first click leaves Password spraying and Enrich New Cases undone, the Rule Library's first Add of Password spraying fails, and the Playbooks page's first template is refused by the role; the next click, Add or pick does them) or `fail` (the first click cannot reach the server; the next one turns everything on)                                               |
| `?triage=`  | the case AI card's other states: `failed` (CASE-141's only triage stopped with an error), `provider`, `credits` or `limit` (no LLM provider, no AI credits, the daily AI limit: nothing can be triaged), `injection` (CASE-137's data held text written to steer an AI; its benign read set aside for Inconclusive), `retry` (CASE-142's latest triage stopped; the read before it stays) and `auto-off` (Triage new cases is off) |

## What the fixture records

`window.__securityOperationsFixture` holds `getItemRequests`, `listRequests`, `countRequests`,
`apiRequests`, `realtimeSubscriptions`, `creates`, `updates`, `deletes` and `unhandled`. Anything a
page reads that the fixture does not model lands in `unhandled`; the spec's `afterEach` fails when
that list is not empty.

## What the spec covers

`SecurityOperations.spec.ts`:

- **Overview**: one card at the top - a band that says what needs someone now under Needs
  attention, each count a link in words that agree with it ("1 playbook step"), or All quiet; and
  under it the pipeline (sources, detections, cases, playbooks, each cell a link to its page); the
  KPIs and the queue's counts from the same rows; the three routes it reads; dark theme. The card
  in both themes at 1280 and 390: the band, then four cells on one hairline grid in one row with a
  chevron centred on each line between them, two by two on a phone with none, nothing scrolling
  sideways, each thing waiting for someone on one line at 1280; the band's disc on the same left
  edge as the cells' names and the figures' card below; All quiet's test attack on the band's
  right on a laptop and under its words (which keep the band's width) on a tablet and a phone;
  a project nothing watches (Get started put away) says so in grey, never All quiet, its Detections
  cell opens the Rule Library, and Set up Security brings Get started back for good; sources that
  went silent (`?sources=silent`) are said beside All quiet and in amber on the Sources cell; the
  set-up figures (`?fail=status`) or the overview (`?fail=overview`) that cannot be read say so in
  the product's words with Try again, which reads them again; a test attack from the quiet band
  turns it to Needs attention and keeps the line to its case; each cell opens its part's page.
  A new project sets Security up from Get started in two clicks - Turn on recommended, then Send a
  test attack, whose case opens - in light, dark and on a phone; a click that cannot do everything
  (`?setup=partly`) names each thing it could not do with why, says the rest is on and makes Try
  again the main button, which does only what is left; a click that fails whole (`?setup=fail`) says
  so in the card, in the product's words; both read inside the card in dark and on a phone; a project set up and quiet reads
  All quiet and charts nothing.
- **The case pages**: Open Cases, each case with what raised it and what it is about; each page
  from the side menu lists what its name says (Unassigned names the team a case was handed to,
  Assigned to Me has no Assignee column, Closed Cases reads by verdict and when each closed); at
  1280 each list's title, search and buttons share one line with the description under them; at
  1440 every column fits the card beside the side menu; at 1024 and 390 nothing runs off the page
  and the header's search stays inside the card.
- **A case**: header, status steps, detections, the held run with Approve and Reject, timeline,
  entities, ATT&CK and notes; approving the held step posts the decision with its comment and the
  run finishes; a Security Viewer cannot decide it; dark theme and a phone.
- **Playbooks**: the list (steps, status, trigger and minimum priority) fits its card; a template
  becomes a working playbook in one click, built as Turn on recommended builds Enrich New Cases, and one
  that cannot be added says why in the amber box; a playbook's
  settings read in full; its steps and latest runs; Waiting for Approval, at the runs page's old
  address, lists the run held for a decision, and Playbook Runs every run; an empty runs page says
  what it is for in its empty state only.
- **Detections**: ATT&CK coverage counts what the enabled rules cover and its matrix scrolls inside
  its card; the rule library marks the rules the project has (a renamed one by its Sigma id) and
  the recommended ones, filters to them and adds the missing ones in one click, its description
  running under its two buttons the card's whole width, and narrows by one select beside its search;
  an Add Rule that cannot add its rule says why on its card; an Add All or Add Recommended Rules that
  cannot add one names it with why in a box it brings into view, adds the rest, and adding again
  adds only it; Detections is a section of
  pages, each its own address and entry; the side menu is eight sections of pages, the ones set up
  once folded, its Workspace section listing only the connected Slack, and on a phone it names the
  section and the page; entities ranks what the findings name.
- **Detection rules and threat intel**: Detection Rules names each rule's kind (Single event,
  Sequence, First seen) and says what it means on hover; a single rule pasted into the form counts
  by Group By Field, Distinct Count Field and Match Count Threshold, while a correlation is said in
  a sentence under its YAML - the rules it reads by their titles, its fields as code - named after
  its own title, and leaves those three out. Threat Intel's Free Lists offer each free list with
  its publisher, schedule and terms on one line, end every tile alike, mark the one the project
  reads as Added, and add another in one click as a list feed the feeds table lists by its source;
  a project that reads every list (`?lists=all`) has no Free Lists card; a Security Viewer cannot
  add one; the feeds table leaves the interval and Last Evaluated to Customize Columns, each row a
  line or two; a new feed asks its source first, then only that source's settings (a list's
  confidence under More fields; Google SecOps with nowhere to connect from says where). Both pages
  in dark and on a phone.
- **OneUptime AI**: a triaged case leads with the AI card - its read, the playbook it suggests and
  a cited report, above the detections; a citation opens the check behind it and re-runs it on the
  case's own route with the triage's run; a suggested playbook whose run on the case is still
  going shows that run's status in place of Run playbook; Run playbook (its last run failed) opens
  the run dialog on the suggested playbook and runs nothing; Triage with AI on a case nobody has
  read shows each check as it runs,
  then the read, and Set priority sets the suggested priority; the case lists show each case's read
  beside its title; Draft with AI writes a Sigma correlation into the detection rule form from a
  sentence, names the rule after it and saves nothing; Security Events → AI → Settings is one
  switch, Triage new cases, that saves as it flips; the card in the dark theme and on a phone (the
  suggested playbook named in full); with the project's AI off (`?ai=off`) none of it is drawn and
  nothing asks.
- **OneUptime AI when a triage cannot run, or was steered** (`?triage=`): the card's buttons sit
  on the content's edge in both themes; a project out of AI credits, at its daily AI limit or
  with no LLM provider says so in place of Triage again, with the fix for who may make it and who
  can for a Security Viewer; a triage that stopped says why and Try again reads the case; text
  written to steer an AI is said first, once (the report leaves out the runner's own heads-up),
  and the read keeps no suggestion; a later triage that stopped keeps the read before it and says
  why it stopped; a Security Viewer sees Triage with AI greyed with who can beside it, and no
  Triage again or Set priority on a read; with new cases not triaged on their own the card links
  to the switch; Close Case names the AI read over
  the verdict it starts on, and nothing of it with AI off; the timeline has the triage; Draft
  with AI's box has one action and an x beside its question.
- **Every page at 1280, 1024, 768 and 390**: none scrolls sideways.

Every test pins the clock and puts up a network fence that aborts anything leaving the fixture
server; `afterEach` fails a test on an uncaught page error, an aborted request, or anything in the
fixture's `unhandled`.

## Run it

```
cd packages/E2E
npm install
npm run test-security-operations-ui
```

Playwright reuses a server already listening on port 4234 outside CI. If one from another checkout
might be running, stop it first or run with `CI=1`.

Screenshots (2x) land in `output/playwright/security-operations-ui/`, named `*-synthetic.png`
because everything in them is fabricated: among them `overview-desktop`, `overview-dark`,
`overview-top-1280`, `overview-top-1280-dark`, `overview-top-390`, `overview-top-390-dark`,
`overview-not-watched`, `overview-sources-silent`, `overview-sources-silent-dark`,
`overview-status-failed`, `overview-failed`, `overview-test-attack-from-band`,
`side-menu-desktop`, `side-menu-dark`, `side-menu-mobile`, `overview-turn-on-partly`,
`overview-turn-on-partly-dark`, `overview-turn-on-partly-phone`, `overview-turn-on-partly-phone-dark`,
`overview-turn-on-failed`, `rule-library-add-failed`, `rule-library-add-all-failed`,
`playbook-template-failed`, `cases-desktop`, `cases-tablet`,
`cases-mobile`, each case page at 1280 in both themes and at 390 (`cases-open-1280-light`,
`cases-unassigned-1280-dark`, `cases-closed-390-light` and the rest), `case-desktop`, `case-dark`,
`case-mobile`, `playbooks-desktop`, `playbook-desktop`, `playbook-runs-waiting-desktop`,
`playbook-runs-desktop`, `playbook-runs-empty`, `attack-coverage-desktop`, `rule-library-desktop`,
`rule-library-category-*`, `entities-desktop`, `detection-rules-desktop`,
`detection-rule-correlation-form-desktop`, `detection-rules-dark`, `detection-rules-phone`,
`threat-intel-desktop`, `threat-intel-feed-source-desktop`, `threat-intel-dark`,
`threat-intel-phone`, and OneUptime AI's: `case-ai-desktop`, `case-ai-evidence-desktop`,
`case-ai-not-triaged-desktop`, `case-ai-triaging-desktop`, `case-ai-triaged-desktop`,
`case-ai-dark`, `case-ai-phone`, `case-ai-phone-dark`, `cases-ai-desktop`,
`detection-rule-ai-draft-desktop`, `detection-rule-ai-drafted-desktop`, `ai-settings-desktop`,
`ai-settings-dark`, `ai-settings-phone`, `ai-settings-ai-off-desktop`, `case-ai-limit-desktop`,
`case-ai-provider-desktop`, `case-ai-failed-desktop`, `case-ai-injection-desktop`,
`case-ai-injection-phone-dark` and `case-close-ai-read-desktop`.

## Poke at it by hand

```
cd packages/E2E
node SecurityOperations/Fixture/server.js --watch
```

then open `http://127.0.0.1:4234/dashboard/10000000-0000-4000-8000-000000000001/security-events/overview`,
adding the scenario parameters above. `--watch` rebuilds the bundle when a source file changes;
refresh the browser. A browser outside Playwright uses the real clock, so the history is laid out
from today.
