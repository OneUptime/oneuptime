# Security operations fixture

An offline harness for the Security Events SOC pages, on a month of synthetic security work:

| Page                 | Route (from `RouteMap`)                                                                   | Production components                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Overview             | `SECURITY_EVENTS_OVERVIEW` `/dashboard/:projectId/security-events/overview`               | `Pages/SecurityEvents/{Layout,Overview}`, `SecurityOverview/*`                               |
| Open Cases           | `SECURITY_CASES` `.../security-events/cases`                                              | `Pages/SecurityEvents/Cases`, `SecurityCasesTable` inside `ModelTable`                       |
| Assigned to Me       | `SECURITY_CASES_ASSIGNED_TO_ME` `.../security-events/cases/assigned-to-me`                | the same, with the list `SecurityCaseQueueViews` gives the page                              |
| Unassigned           | `SECURITY_CASES_UNASSIGNED` `.../security-events/cases/unassigned`                        | the same                                                                                     |
| Closed Cases         | `SECURITY_CASES_CLOSED` `.../security-events/cases/closed`                                | the same                                                                                     |
| All Cases            | `SECURITY_CASES_ALL` `.../security-events/cases/all`                                      | the same                                                                                     |
| A case               | `SECURITY_CASE_VIEW` `.../security-events/cases/:id`, its Overview                        | `Pages/SecurityEvents/CaseView/{Layout,SideMenu,Index}`, `SecurityCase/*`                    |
| A case's pages       | `SECURITY_CASE_VIEW_*` `.../cases/:id/{timeline,detections,entities,playbook-runs,...}`   | `Pages/SecurityEvents/CaseView/*`, `EventNotes`, `SecurityPlaybookRunCard`, `AuditLogsTable` |
| Story                | `SECURITY_CASE_VIEW_STORY` `.../cases/:id/story`                                          | `Pages/SecurityEvents/CaseView/Story`, `SecurityCase/Context/*`                              |
| Connected Signals    | `SECURITY_CASE_VIEW_CONNECTED_SIGNALS` `.../cases/:id/connected-signals`                  | `Pages/SecurityEvents/CaseView/ConnectedSignals`, `SecurityConnections/*`                    |
| Entity Risk          | `SECURITY_EVENTS_ENTITY_RISK` `.../security-events/entity-risk` (and the old `entities`)  | `Pages/SecurityEvents/EntityRisk`, `EntityRisk/*`, `EntityLookupCard` under the list         |
| Protected Entities   | `SECURITY_PROTECTED_ENTITIES` `.../security-events/protected-entities`                    | `Pages/SecurityEvents/ProtectedEntities`                                                     |
| Detection Rules      | `SECURITY_EVENTS_DETECTION_RULES` `.../security-events/detection-rules`                   | `Pages/SecurityEvents/DetectionRules`, `DetectionRuleSummary`                                |
| Rule Exceptions      | `SECURITY_EVENTS_RULE_EXCEPTIONS` `.../security-events/rule-exceptions`                   | `Pages/SecurityEvents/RuleExceptions`, `SecurityEvents/RuleExceptions/*`                     |
| Rule Library         | `SECURITY_EVENTS_RULE_LIBRARY` `.../security-events/rule-library`                         | `Pages/SecurityEvents/RuleLibrary`                                                           |
| Threat Intel         | `SECURITY_EVENTS_THREAT_INTEL` `.../security-events/threat-intel`                         | `Pages/SecurityEvents/ThreatIntel`, `ThreatIntelRecommendedLists`                            |
| ATT&CK Coverage      | `SECURITY_EVENTS_ATTACK_COVERAGE` `.../security-events/attack-coverage`                   | `Pages/SecurityEvents/AttackCoverage`, `AttackCoverageTactics`, `AttackCoverageMatrix`       |
| Playbooks            | `SECURITY_PLAYBOOKS` `.../security-events/playbooks`                                      | `Pages/SecurityEvents/Playbooks`, `SecurityPlaybookTemplatePicker`                           |
| A playbook           | `SECURITY_PLAYBOOK_VIEW` `.../security-events/playbooks/:id`                              | `Pages/SecurityEvents/PlaybookView`, `SecurityPlaybookStepsEditor`                           |
| Approvals            | `SECURITY_PLAYBOOK_RUNS_WAITING_FOR_APPROVAL` `.../security-events/playbook-runs`         | `Pages/SecurityEvents/PlaybookRuns`, with the runs `SecurityPlaybookRunViews` gives it       |
| Playbook Runs        | `SECURITY_PLAYBOOK_RUNS` `.../security-events/playbook-runs/all`                          | the same                                                                                     |
| AI Settings          | `SECURITY_EVENTS_SETTINGS_AI` `.../security-events/ai/settings`                           | `Pages/SecurityEvents/AISettings`, `AISettings/ProjectAiSwitchesCard`, `ProjectAiNotice`     |
| Case Priorities      | `SECURITY_EVENTS_SETTINGS_CASE_PRIORITIES` `.../security-events/settings/case-priorities` | `Pages/SecurityEvents/Settings/CasePriorities`, `StateSettings/*`, `ArchivableValue/*`       |
| Case Statuses        | `SECURITY_EVENTS_SETTINGS_CASE_STATUSES` `.../security-events/settings/case-statuses`     | `Pages/SecurityEvents/Settings/CaseStatuses`, the same                                       |

`Fixture/server.js` bundles the production layout (breadcrumbs, the Security Events side menu) and
the pages with esbuild, serves them with the same Tailwind build, `tailwind.config`, Inter font and
`Theme.css` production uses, and listens on `127.0.0.1:4234` (`SECURITY_OPERATIONS_FIXTURE_PORT`).
No Docker, no database, no sign-in.

## What is real and what is stubbed

Real: the layout and side menu, every page above, the tables, cards, charts, the case header and
status steps, the playbook step editor and run cards, the approval dialog, `PermissionGate`, and
the overview's numbers: the fixture answers `POST /security-case/overview` with what
`computeSecurityOverviewMetrics` (the function the server calls) works out from its own rows, and
with the project's priorities and statuses as the server hands them over.

The project's case priorities and statuses are rows of their own (`SecurityCasePriority`,
`SecurityCaseStatus`): a new project's, as every project has them from its creation
(`DEFAULT_SECURITY_CASE_PRIORITIES`, `DEFAULT_SECURITY_CASE_STATUSES`), and with `?values=custom`
the project's own beside them. Cases and playbooks name them by id, and a read joins the
relations the pages select (a case's `securityCaseStatus` and `securityCasePriority`, a playbook's
`minimumSecurityCasePriority`), so an edit reads back at once.

Stubbed:

- The data boundary: `ModelAPI` and `API` answer from in-memory tables, filtered by the queries the
  pages send (`Includes`, `IsNull`, equality) and sorted. `AnalyticsModelAPI` answers Threat Intel's
  Indicators table, and only it. `POST /security-case/entity-activity` (Look Up an Entity, a
  case's Entities, an entity's page) and `/security-playbook-run/:id/approve|reject` answer as the
  server would - a value starting `never-seen` is one no event names, left out of the answer as
  the server leaves it out; the overview's answer carries the riskiest entities as the server reads them
  (`SecurityRiskiestEntities`: the risk rows with a score, by the score, ties in id order, with the
  project's threshold and how many have risk); approving the held step runs the rest of its
  playbook at once. The Overview's set-up routes answer as `SecuritySetup` does, on the fixture's own tables: `/security-case/setup/status`
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
- `POST /security-case-priority/:id/usage` and `/security-case-status/:id/usage`, which the
  Archive and Delete dialogs ask first, answer what uses the value as the server counts it: the
  cases that have it, and for a priority the playbooks that run from it.
- A case's Story and Impact: `POST /security-case-context/story` and `/impact` answer as the
  server would (`Fixture/CaseContextFixture.js`), around the case's window, from its own rows (its
  detections, playbook runs, notes and milestones), the records Connected Signals lists for it and
  the security events naming each open case's entities - the spray's 412 failed Okta sign-ins and
  the success among them, build-runner-07's lookups of the known-bad domain, the PowerShell under
  web-03's web server: told in runs and merged on one time axis by `SecurityCaseStoryItems`, each
  record's last change and the internet verdict worked out by `SecurityCaseImpactFacts`.
  build-runner-07 is on the service map and on the Engineering Tools status page, web-03's Checkout
  API on Acme Commerce Status. Those two status pages and two runbooks are rows of their own, for a
  playbook step to pick.
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
| `?quiet=`   | `1`: a project that has set Security up (a connection, its logs, rules, playbooks) and that nothing has happened to: no cases, detections or runs; `risk`: the same, but its rules' alerts scored its entities, so the Overview shows Riskiest Entities alone                                                                                                                                                                      |
| `?role=`    | `owner` (default) or `viewer`: Security Viewer only, so it reads but cannot decide a held step                                                                                                                                                                                                                                                                                                                                     |
| `?lists=`   | `all`: the project reads every free list already, so Threat Intel shows no Free Lists card                                                                                                                                                                                                                                                                                                                                         |
| `?ai=`      | `off`: the project's Enable AI is off, so no AI card, AI Verdict, Draft with AI or AI trigger is drawn, and AI Settings says AI is off                                                                                                                                                                                                                                                                                             |
| `?sources=` | `silent`: the sources sent their last security event three days ago and nothing since (the Overview's top says when, and the Sources cell says it in amber)                                                                                                                                                                                                                                                                        |
| `?fail=`    | `status` or `overview`: the Overview's set-up figures, or its overview, cannot be read the first time (a 500); Try again reads them again and they answer                                                                                                                                                                                                                                                                          |
| `?values=`  | `custom`: the project made its case statuses and priorities its own - Triage after New, a retired (archived) Escalated after Investigating, Eradicating after Contained, Closed - Duplicate after Closed, and Emergency above Critical; CASE-142 sits in Eradicating, CASE-138 in Triage and CASE-139 in Escalated                                                                                                                 |
| `?setup=`   | Turn on recommended that cannot do everything: `partly` (the first click leaves Password spraying and Enrich New Cases undone, the Rule Library's first Add of Password spraying fails, and the Playbooks page's first template is refused by the role; the next click, Add or pick does them) or `fail` (the first click cannot reach the server; the next one turns everything on)                                               |
| `?refuse=`  | case numbers, comma separated (`138`): the server refuses every change to those cases, as a role scoped to labels the reader lacks does, so Bulk Actions names the cases it could not change and why                                                                                                                                                                                                                               |
| `?triage=`  | the case AI card's other states: `failed` (CASE-141's only triage stopped with an error), `provider`, `credits` or `limit` (no LLM provider, no AI credits, the daily AI limit: nothing can be triaged), `injection` (CASE-137's data held text written to steer an AI; its benign read set aside for Inconclusive), `retry` (CASE-142's latest triage stopped; the read before it stays) and `auto-off` (Triage new cases is off) |
| `?lang=`    | `de`, `es`, `fr`, `it`, `pt`, `nl`, `ru`, `ja` or `fa` (right to left): the Dashboard's words and its times ("vor 9 Minuten") in that language; the case lists are measured in the widest of them |
| `?team=`    | `long`: the SOC team is "Security Operations Center - Tier 2 Escalations (EMEA)", wherever a list or a picker names it |

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
  1440 every column fits the card beside the side menu, each case's line saying when its last
  detection fired ("3 detections, the last 9 minutes ago") with no Last Detection column, and
  Closed Cases saying when each closed; at a 1280 laptop every list fits its card in German,
  French, Dutch and Russian (`?lang=`), German's button reading "Sicherheitsfall eröffnen", each
  case's line keeping its time whole ("vor 5 Stunden") and OneUptime AI's read on a line of its
  own under it; a team with a long name (`?team=long`) cut short with "...", the lists still inside
  their card; at 1024 and 390 nothing runs off the page and the header's search stays inside the
  card.
- **Working cases from the queue**: each row's ⋯ offers the moves its case takes - Assign to
  Me, Assign to Someone Else, Change Status and Change Priority beside View, Delete last; none
  of the assigning on a closed case, no Assign to Me on the reader's own. "Assign to Someone
  Else", longer than the 14rem menu, wraps balanced ("Assign to" over "Someone Else"), and in a
  right-to-left page each item's icon keeps its gap to the label. Assign to Me takes a
  case off Unassigned and the menu counts it at once; Assign to Someone Else picks one person
  or one team in one picker (a team takes the case into its queue and the person comes off it);
  Change Status into a closing status asks what Close Case asks (OneUptime AI's read over the
  verdict, the closing note) and the case leaves the open list - the case's own status, first
  in the list and marked Current, takes the menu's first focus as a quiet grey row, not the
  indigo of a pick; Change Priority shows the case's own as Current; Bulk Actions' Assign to
  Someone Else names the case the server refused (`?refuse=138`) with why; a row's Assign to Me
  the server refuses says "Could not assign CASE-138" in a dialog whose backdrop covers every
  row's action cells; a Security Viewer sees every move locked with what it takes; the
  case's own header hands it on and moves its status from any of its pages; the row's ⋯, the
  assign dialog and its picker, and the bulk bar at 1280 and 390, in both themes.
- **A case**: a side menu of its own (Overview: Overview, Timeline; Investigation: Story,
  Detections, Entities, Connected Signals, Playbooks; Notes: Private Notes; Advanced, folded: Audit
  Logs, Delete Case), each
  part of the case a page of its own at an address under the case's, its entry lit and its trail
  named for the case; the Overview has the header in full (status steps, who has it), the
  figures, the AI card, the Impact and ATT&CK, and every other page the header compact, with every
  action, the case read once for them all; the Impact of the known-bad domain case - reachable from
  the internet on the public address build-runner-07 reports, the record it names, what that calls
  and is called by, its monitor and status page, its owners and the release before the attack,
  the record itself behind Show what is at risk, also on a phone in the dark - and the spray's,
  not known to be reachable, never a guess; the spray's Story, oldest first - its detections, its
  failed sign-ins told as one run of 413, its playbook runs, notes and milestones - narrowed to the
  attack or the response, a detection opening the case's Detections; a link straight to any page
  opens it; the held run with
  Approve and Reject, counted beside Playbooks until approving it runs the rest; Edit Case asks
  what Open Security Case asks, in the reader's words; Delete Case asks first; a Security Viewer reads every page and is shown why it cannot change one; a case
  that is not there says so; the header at a laptop's width (actions on the title's line) and on
  a phone (buttons filling their rows, the ⋯ in the corner); every page at 1280 and 390, both
  themes.
- **Playbooks**: the list leads the page (steps, status, trigger and minimum priority) and fits
  its card, no card of templates above it; Create from Template, in the card's ⋯, lists the
  templates across the dialog (it closes with Close), each one the project has marked Added with
  View to open its playbook; a project with
  no playbook (`?empty=1`) has the templates as its empty list, with Create a blank playbook; a
  template becomes a working playbook in one click, built as Turn on recommended builds Enrich New
  Cases, and one that cannot be added says why in the amber box; a playbook's page is named for it
  in the trail and the tab, its settings read in full; a step's dialog named by its place and what
  it does ("Schritt 4 bearbeiten: Notiz hinzufügen"); its steps and latest runs, each run named by
  its case and folded to a line but the one waiting for approval; a run's Approve and Reject (or
  Cancel Run) keep its title's line at 1280, at the card's right, and drop under its words on a
  phone; Approvals, at the runs page's old
  address, lists the run held for a decision, and Playbook Runs every run, each a line of how far
  it got - the failed one Stopped at step 2 in red, its reason under Show steps; an empty runs
  page says what it is for in its empty state only.
- **Detections**: ATT&CK Coverage counts what the enabled rules cover and opens on the tactics, a
  row each with how many of its techniques the rules cover and how many more the Rule Library
  would, opening on its techniques under a heading per state, each tile counting its rules (the
  legend is the matrix's); an Overview tactic bar opens its tactic there
  (`?tactic=`); the matrix, behind the By tactic / Matrix switch (`?view=matrix`), scrolls inside
  its card; a box says how many techniques the Rule Library covers that the rules do not and opens
  the rules not added; on a phone and in dark; the rule library marks the rules the project has
  (a renamed one by its Sigma id) and the recommended ones, filters to them and adds the missing ones in one click, its description
  running under its two buttons the card's whole width, and narrows by one select beside its search;
  an Add Rule that cannot add its rule says why on its card; an Add All or Add Recommended Rules that
  cannot add one names it with why in a box it brings into view, adds the rest, and adding again
  adds only it; Detections is a section of
  pages, each its own address and entry; the side menu is nine sections of pages, the ones set up
  once folded (Settings among them), its Workspace section listing only the connected Slack, and on
  a phone it names the section and the page; every entry in sight, a counted one too, and a
  case's, keeps its whole name beside a tablet's 224px menu in English, German, Spanish, French,
  Italian, Portuguese, Dutch, Japanese and Persian (`?lang=`), and at 1440 in English, German and
  French; the old Entities address opens Entity Risk, the one ranking of who is riskiest, with Look
  Up an Entity under its list - its box and Look Up one height on one line, any value (a domain
  too) over 30 days, its counts on a line under it and Open in Correlate at the result's end,
  opening Correlate over the same 30 days, and a value no event names (`never-seen...`) said to be
  not seen, with nothing to correlate - and nothing sideways on a phone; the Overview's Riskiest
  Entities is the top of Entity Risk's list, in its order, by its scores and levels (at the
  project's threshold too), each row its value with its kind under it and its level's pill
  beside its score, the whole row opening the entity's own page with Entity Risk lit, the rest of
  the list a click away (Open Entity Risk when the card shows them all), a month whose only news
  is risk (`?quiet=risk`) showing Riskiest Entities alone, and risk that could not be read
  (`?riskiest=fail`) said so with Try again, in both themes and on a phone; in Persian
  (`?lang=fa`) each value reads as written, in an isolate that starts where its line does and
  cuts a long value at its own end, as Entity Risk's own list cuts its values.
- **Case priorities and statuses** (`?values=custom`): Settings → Case Statuses lists the
  project's statuses in order, what a case in each counts as, the four built-in ones tagged and the
  retired one folded under the table; Case Priorities lists Emergency above the five a detection
  opens a case at, which detections open at each, the built-in ones tagged; a new project's are the
  built-in ones; both pages in both themes at 1280 and 390, every name whole; a case's status steps
  are the project's statuses with the retired one left out, each whole at 1280 and 390 in both
  themes; a case still in a retired status keeps it in its place; moving a case into the project's
  own closing status asks for the verdict first and saves that status; the queue and the overview
  name the statuses as the project does.
- **Detection rules and threat intel**: both lead with their lists - their How it works card
  folds once the list has rows - and each row's one button is Edit, with Create Monitor (and a
  feed's Update Credentials) in its ⋯. Detection Rules fits 1280 without scrolling sideways, its
  Last Match how long ago (the date under the pointer) and Last Evaluated in Customize Columns, and
  names each rule's kind (Single event,
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

## Entity risk

Three more pages, with their own spec, `EntityRisk.spec.ts`:

| Page         | Route (from `RouteMap`)                                                             | Production components                                                         |
| ------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Entity Risk  | `SECURITY_EVENTS_ENTITY_RISK` `.../security-events/entity-risk`                     | `Pages/SecurityEvents/EntityRisk`, `SecurityEvents/EntityRisk/*`, the guide   |
| An entity    | `SECURITY_EVENTS_ENTITY_RISK_VIEW` `.../security-events/entity-risk/entity?value=`  | `Pages/SecurityEvents/EntityRiskView`, `EntityRiskSources`, `EntityRiskCases` |
| Risk Scoring | `SECURITY_EVENTS_SETTINGS_RISK_SCORING` `.../security-events/settings/risk-scoring` | `Pages/SecurityEvents/Settings/RiskScoring`                                   |

`Fixture/EntityRiskFixture.js` lays out the project's Entity Criticality list (the CFO Extreme,
`fin-ws-*` High, `dc-*` Extreme, the vulnerability scanner at `192.0.2.15` Low) and the risk row
of each user, host and address the month's findings named, worked out from their sources with the
server's own arithmetic (`computeEntityRisk`, `findEntityCriticalityRule`, `updateRiskHistory`):
the spray's address at 125, the CFO at 200 (100 of findings, weighed twice), the finance
workstation Falcon caught at 113, down to a locked-out account at 25, and a laptop whose one
source went quiet over a week ago at 0 (kept for its history, listed nowhere). The sources are the
fixture's own rules, feeds and products. The cases about one entity are grouped on it, as
`SecurityCaseIngest` groups them (`entity:<value>`), so an entity's page finds them;
`POST /security-case/entity-activity` answers an entity only its risk names from its sources; a
Reset Risk deletes the row; and an edit form saves onto the row it edits (`updates`).

| Parameter     | Values                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `?riskcases=` | `off`: the project opens no case from risk (as a project made before entity risk): Entity Risk says so above its list          |
| `?threshold=` | the project's risk threshold (100 when left out), which every level, meter and the guide read                                  |
| `?riskcase=`  | `1`: a.ng's risk reached the threshold 20 minutes ago and opened CASE-143, a case of Entity Risk's own, with its one detection |
| `?riskiest=`  | `fail`: the overview could not read the riskiest entities; the Overview's Riskiest Entities says so, with Try again           |

`EntityRisk.spec.ts` covers: the list (the riskiest first, each level against the threshold,
criticality beside the kind, what found it and when, ATT&CK left to Customize Columns, one read of
the rows with risk, the guide folded to its title row over a list with rows), each entity one card
on a phone (its risk under it, no field names), a row opening its entity's page with Entity Risk
lit in the menu and the entity named in the trail and the tab; the levels and guide at another
threshold; the note and the way to Risk Scoring when risk opens no case; a new project's empty
list; an entity's page (the score worked out, criticality weighing it, each source, the month, the
activity, the cases about it, Open in Correlate and Search Its Events at the header's right at
every width, as a case's actions are), Reset Risk under the header's ⋯ asking first and clearing
the row, locked with why for a Security Viewer; a quiet entity's month, an unscored one's activity
and a page that names no entity, with its way to Entity Risk; Risk Scoring's
switch saving as it flips, the threshold refused out of range in the product's words and saved, Add
Entity, and a Security Viewer changing nothing; the Risk column of a case's Entities (under the
value, named, beside the case's menu and on a phone); the case Entity Risk opens, its detection
and its entity's page; a detection rule's Risk Points under More fields; and every page at 1280,
1024, 768 and 390, both themes at 1280 and 390. Its screenshots are named `entity-risk-*` and
`risk-scoring-*`.

## Connected Signals

What a case names in the rest of OneUptime, on its own page and on an entity's, with its own spec,
`ConnectedSignals.spec.ts`. `Fixture/ConnectionsFixture.js` lays out the project's records - the
hosts `build-runner-07` (at `198.51.100.23`, its own logs carrying CASE-141's DNS lookups, an alert
open on it, a monitor and a fix in the hour), `web-03` (two incidents open, three monitors),
`web-03.staging.acme-commerce.example` and `fin-ws-112.corp.acme-commerce.example`, and the member
Kai Morgan (`k.morgan@acme-commerce.example`, one of the spray's targets) - and answers
`POST /security-case/connections` the way the server works it out, with the server's own rules
(`Common/Utils/SecurityCase/SecurityConnectionMatch`): a host by the name it reports, a public
address only it holds or the logs it sent, a member by their email, a short form of a name only
possibly; the case's window around its detections, an entity's the hour around its last event; and
nothing said to be not in OneUptime that a kind of record the reader could not read may hold.

| Parameter       | Values                                                                                                                                                                                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `?connections=` | `fail`: the first read fails (a 500), Try again reads it; `partial`: the role cannot read users and the clusters could not be read, Try again reads them; `busy`: a case naming one record of every kind, every fact a record can have, four possible matches and more records than are shown |
| `?lang=`        | `de`, `ja` or `fa` (right to left): the Dashboard's German, Japanese or Persian words                                                                                                                                                                                                         |

`ConnectedSignals.spec.ts` covers: the page under Investigation after Entities, its entry lit and
its trail named for the case; the spray's member, by their email, with what OneUptime does not know;
the build runner by its name, its address and its logs, its signals opening Logs, Traces, Metrics,
Topology and Inventory on it and the case's window, the alert, monitor and fix on it; a host only
possibly the one named, with its pill and why, and nothing open on it; exact connections first; a
read that fails and its Try again; what the role keeps from it and what failed, with nothing called
not in OneUptime that may be; a Security Viewer; every record whole inside its card at 1280 and 390
in both themes and at 1024 and 768 beside the case's menu; a busy case's facts, one item a line,
their labels beside them from 32rem of a record's width and above them below it, the possible
matches under their own heading, in both themes and in Persian; German; Persian at 1280 and 390,
right to left; and an entity's page. Its screenshots are named `case-connected-signals-*` and
`entity-connected-signals-*`.

## Rule exceptions and Run on Past Events

What a detection rule skips, and what it would have found over past events, with their own spec,
`RuleExceptions.spec.ts`. `Fixture/RuleExceptionsFixture.js` lays out an exception in every state
a row can be in: on Brute force from one IP address, the vulnerability scanners' range
`10.20.0.0/16` (no expiry), the backup job's account `svc-backup` (until in 30 days) and the red
team exercise's window tomorrow (upcoming); on Password spraying, the process `backup.exe`
(expired); on Repeated failed sign-ins, last week's penetration test (ended); and on MFA push
fatigue, `*.lab.acme-commerce.example`, added through the API. A new exception is saved on its
rule's id, as the server stores the relation the form's dropdown sends. `POST
/detection-rule/retrohunt` answers what the server's statement would: by default, for the week
(fewer firings over a day, more over a month), 42 firings for three addresses, with what the
rule's active exceptions kept out; a correlation's YAML as a correlation, each group with what
happened.

| Parameter     | Values                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `?retrohunt=` | `quiet`: it would not have fired, 12 matching events none of whose runs reached the threshold; `noisy`: 1,680 firings for 64 addresses, the 50 that fired most listed; `fail`: the YAML is refused (a 400) |

`RuleExceptions.spec.ts` covers: the list under Detections, its entry lit and its trail, four
columns that fit beside the menu at 1280 (what it skips and its kind, the rule, why with who added
it and when, the status and until or since when); one card each on a phone; Persian, right to
left, with every status in Persian and the status line wrapping rather than running under the
row's actions; a Security Viewer, Add locked and Run on Past Events still open; a rule's count of
active exceptions under its name; the row's run of tuning actions before Create Monitor; View
Exceptions landing on the list filtered to the rule; Add Exception from a rule's row, saved with
its kind's fields only, and the count reading it at once; a value of only `*` refused under its
field; a time window's fields; Run on Past Events from a row (the firings, a day's rate, who for,
what the exceptions kept out, the request, another period), a noisy rule's advice and Show all, a
quiet rule's near miss, a refused run, a correlation's groups, and the run under the form's YAML
with "The rule changed after this run."; Add Exception on a case's detection, started with the
rule and the address it grouped by, and none on a threat intel match. Its screenshots are named
`rule-exceptions-*`, `rule-retrohunt-desktop` and `rule-exception-from-detection`.

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
`cases-unassigned-1280-dark`, `cases-closed-390-light` and the rest), `case-desktop`, each page
of a case at 1280 in both themes and at 390 (`case-overview-1280-light`,
`case-playbook-runs-1280-dark`, `case-entities-390-light`, `case-entities-390-dark` and the rest),
`case-header-390-light`, `case-header-390-dark`, `case-side-menu-mobile`, `case-not-found`,
`case-impact-desktop`, `case-impact-390-dark`, `case-story-desktop`,
the queue's moves at 1280 and 390 in both themes (`cases-row-menu-1280-light`,
`cases-assign-dialog-390-dark`, `cases-assign-picker-1280-dark`, `cases-bulk-actions-390-light`
and the rest) and `cases-bulk-assign-result`,
`playbooks-desktop`, `playbooks-empty`, `playbooks-templates-dialog`, `playbook-desktop`,
`playbook-runs-waiting-desktop`, `playbook-runs-desktop`, `playbook-runs-empty`,
`attack-coverage-desktop`, `attack-coverage-tactic-open`, `attack-coverage-matrix`,
`attack-coverage-phone`, `attack-coverage-dark`, `rule-library-desktop`,
`rule-library-category-*`, `entity-risk-lookup-desktop`, `entity-risk-lookup-not-seen`,
`entity-risk-lookup-phone`, `overview-riskiest-entities-risk-only`,
`overview-riskiest-entities`, `overview-riskiest-entities-failed`,
`overview-riskiest-entities-dark`, `overview-riskiest-entities-phone`,
`overview-riskiest-entities-fa-1280`, `overview-riskiest-entities-fa-390`, `detection-rules-desktop`,
`detection-rule-correlation-form-desktop`, `detection-rules-dark`, `detection-rules-phone`,
`threat-intel-desktop`, `threat-intel-feed-source-desktop`, `threat-intel-dark`,
`threat-intel-phone`, and OneUptime AI's: `case-ai-desktop`, `case-ai-evidence-desktop`,
`case-ai-not-triaged-desktop`, `case-ai-triaging-desktop`, `case-ai-triaged-desktop`,
`case-ai-dark`, `case-ai-phone`, `case-ai-phone-dark`, `cases-ai-desktop`,
`detection-rule-ai-draft-desktop`, `detection-rule-ai-drafted-desktop`, `ai-settings-desktop`,
`ai-settings-dark`, `ai-settings-phone`, `ai-settings-ai-off-desktop`, `case-ai-limit-desktop`,
`case-ai-provider-desktop`, `case-ai-failed-desktop`, `case-ai-injection-desktop`,
`case-ai-injection-phone-dark` and `case-close-ai-read-desktop`, and the project's case priorities
and statuses: `case-statuses-1280-light`, `case-priorities-1280-light`, each at 1280 dark and at
390 in both themes (`case-statuses-390-dark` and the rest), `case-status-steps-custom-*` (1280 and
390, light and dark) and `overview-custom-statuses`.

## Poke at it by hand

```
cd packages/E2E
node SecurityOperations/Fixture/server.js --watch
```

then open `http://127.0.0.1:4234/dashboard/10000000-0000-4000-8000-000000000001/security-events/overview`,
adding the scenario parameters above. `--watch` rebuilds the bundle when a source file changes;
refresh the browser. A browser outside Playwright uses the real clock, so the history is laid out
from today.
