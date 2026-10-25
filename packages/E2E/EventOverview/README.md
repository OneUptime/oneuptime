# Event overview fixture

An offline harness for the real overview pages of the dashboard's events:

| Page                  | Route (from `RouteMap`)                                                               | Production components                                  |
| --------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Incident              | `INCIDENT_VIEW` `/dashboard/:projectId/incidents/:id`                                 | `Pages/Incidents/View/{Layout,Index}`                  |
| Alert                 | `ALERT_VIEW` `/dashboard/:projectId/alerts/:id`                                       | `Pages/Alerts/View/{Layout,Index}`                     |
| Scheduled maintenance | `SCHEDULED_MAINTENANCE_VIEW` `/dashboard/:projectId/scheduled-maintenance-events/:id` | `Pages/ScheduledMaintenanceEvents/View/{Layout,Index}` |
| Incident episode      | `INCIDENT_EPISODE_VIEW` `/dashboard/:projectId/incidents/episodes/:id`                | `Pages/Incidents/EpisodeView/{Layout,Index}`           |
| Alert episode         | `ALERT_EPISODE_VIEW` `/dashboard/:projectId/alerts/episodes/:id`                      | `Pages/Alerts/EpisodeView/{Layout,Index}`              |

`Fixture/server.js` bundles the production layouts (ModelPage, side menu) and pages with
esbuild, serves them with the same Tailwind build, `tailwind.config` and `Theme.css`
production uses, and listens on `127.0.0.1:4222` (`EVENT_OVERVIEW_FIXTURE_PORT`). No Docker,
no database, no sign-in. Only the `ModelAPI` / `AnalyticsModelAPI` / `API` data boundary and
the signed-in user are replaced.

Like the dashboard's `App`, the fixture's root component reads the location on every
navigation, so a page that stays mounted on the same route (incident #1042 → #1029 through a
link in the AI report) re-renders with the new id.

Every record is fabricated for a generic "Acme Commerce" workspace, and the fixture header
says so ("Preview workspace · Synthetic data"). The clock is pinned: all dates are relative to
`2026-09-14T18:20:00Z`, and the spec fixes the browser clock to the same instant.

## What is modelled

- **Incident #1042** "Checkout API p95 latency above 2s": Created → Acknowledged (18:04) →
  Resolved (18:12), SEV-2, two labels, two monitors and services that it sets to Degraded, an
  on-call policy, declared at 18:01 by the eu-west-1 probe three minutes after the impact began
  (17:58), a description and - once resolved - a root cause (`?what=`), Maya Chen as Incident
  Commander among its role members, owned by the Checkout SRE team and Sam Rivera
  (`?owners=`), a feed including the AI root-cause item, and membership of episode #12.
- **Owners and the Incident Commander**: alert #311 and alert episode #7 are owned by the
  Payments team, incident episode #12 by Checkout SRE and Sam Rivera, and Maya Chen holds
  Incident Commander on #1042 and #12 (`?commander=`). The eight owner tables answer the way
  the Owners pages read them.
- **Prior incidents #1017, #1029, #1036**: resolved, same project, openable on the same
  incident route; the AI report links to them.
- **AI investigation** for #1042 and **Alert #311**: a completed run with 10 tool calls
  (citations C1–C10), about 48k tokens, a TL;DR and `analysisMarkdown` in the exact format of
  `AIInvestigationEngine.buildBrandedMarkdown`. The payload also carries `evidence`
  (`InvestigationEvidenceItem[]`) and `references` (`InvestigationEventReference[]`).
  `POST /ai-investigation/evidence` answers per citation the way the server does:
  - incident: an `IncidentList` (C1), `TimeSeriesChart` (C2, C6), `Table` (C3 logs, C9
    monitors, C10 timeline), `TraceWaterfall` (C7), plain `text` (C5), and `rowCount: 0` with
    the server's explanation as `text` (C8). C4 (`lookup_context`) cannot be re-run and
    answers 400.
  - alert: an `AlertList` (C1), charts, tables, a trace, and an `ExceptionList` (C8).
  - pinned (`isPinnedToInvestigationTime`) and current-data citations are both present.
- **AI investigation conversation**: the shared thread that closes the AI Investigation card
  of incident #1042 and alert #311, as `InvestigationThreadService.getView` answers it
  (`POST /ai-investigation/conversation`): messages oldest first with who asked, and, while an
  answer is in flight, its run and live steps. `?thread=` picks what it starts with; Maya Chen
  is the viewer, and charts and tables go only to the person who asked. Every other incident
  and alert has an empty thread. It is a small state machine, so a spec can drive the card:
  - `send-message` adds the viewer's question and an answer in progress, which narrates a step
    on the next read and is complete (one citation, one source) on the one after;
  - `respond-to-approval` runs or denies the pending action and completes the answer;
  - `cancel-run` turns the answer in flight into a stopped one.
- `verdict` and `create-fix-task` record and succeed.
- **Investigate now** (`POST /ai-investigation/investigate-now`, issue #5074) starts a waiting
  record's investigation (`?ai=waiting`): its next read answers a queued run. A second start, or
  one for a record that does not wait, is refused as `InvestigationRuleWait.startNow` refuses it.
- **Alert #311** "Payment webhook 5xx rate above 5%" with its monitor and alert episode #7. Its
  hero offers Declare Incident after the state actions, which opens the create-incident page
  with `?alertIds=<alert #311>`.
- **Scheduled maintenance #58** "Primary database failover drill" with two status pages,
  affected monitors and services, reminders and a feed.
- **Affected resources** (`?resources=`): by default #1042 has two monitors and two services.
  `many` gives it six monitors (one named "Checkout web journey (synthetic) from eu-west-1 and
  us-east-1", too long for the sidebar), two hosts, a Kubernetes cluster, three services and an
  SLO; `none` leaves #1042 and #58 with nothing attached.
- **Incident episode #12** "Checkout degradation — Sep 14" with four member incidents, a
  grouping rule and a role member; **alert episode #7** with five member alerts. Each one's
  founding member, incident #1038 and alert #305, later joined another episode too (#13 and #8,
  modelled only as that membership row and the link), so its own `incidentEpisodeId` /
  `alertEpisodeId` names the later one, as the server keeps it. The episodes still list it: an
  episode's members are its membership rows.
- **State changes** submitted from a hero action (incident, alert, both episodes, scheduled
  maintenance) are stamped like the server does: the new timeline entry starts now, the open
  one is closed and the event moves to the new state, so a background refresh reads the result.
- **Measurements** (`?measurements=`): the project's incident, alert and maintenance
  measurements, and each event's value of each one, worked out like the workers do - the real
  `MeasurementEvaluator` over the event's own fixture timeline - and worked out again after a
  hero state change. Incidents measure time to acknowledge, time to mitigate (to a Mitigated
  state no fixture incident enters, so a resolved one skipped it), time to resolve and time to
  postmortem, plus one measurement kept off incident pages and one switched off, which the
  card must not ask for; alerts measure time to acknowledge and time to resolve (in minutes);
  maintenance measures start delay, overrun and maintenance duration.

Navigation targets that are not modelled (AI task, monitor, host, Kubernetes cluster, SLO,
on-call policy, status page, user, team, roles, owners and member lists, list pages (the metrics,
logs, monitors and on-call policies lists are where an answer's sources lead), side-menu
sub-pages, and Create Incident -
`INCIDENT_CREATE` `/dashboard/:projectId/incidents/create`, where an alert's Declare Incident
leads) render a small stub page with `data-testid="stub-page"`, `data-page="<PageMap key>"`
and the page name as its `<h1>`.

## Scenarios

Query parameters, parsed once per page load:

| Parameter           | Values                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `?state=`           | `resolved` (default), `ongoing` (incident #1042, alert #311 and both episodes stop at Acknowledged) or `created` (they stop before it)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `?ai=`              | `report` (default), `none`, `queued`, `running`, `failed`, `pending`, `legacy` (a completed report from an API replica without `evidence` / `references`, so the panel falls back to the report's own "Evidence checked" block), `waiting` (an investigation rule's wait, issue #5074: no run yet, OneUptime AI investigates eight minutes from now if the record is still open, and the card offers Investigate now), `waiting-viewer` (the same wait, for someone who may not change the record: no button, only who can), `off-switch`, `off-project`, `off-rules` or `off-severity` (OneUptime AI did not investigate incident #1042 or alert #311 because something was off for them, as `InvestigationEligibility` records it: automatic investigation was off when they were created, Enable AI was, they matched none of the AI rules that investigate, or their severity was below the minimum; with fixing off too (`?fixing=`) their AI card is one line, `AiOffSummary`)                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `?wait=`            | with `?ai=waiting` or `waiting-viewer`: when the wait ends - `default` (eight minutes from now, a 10-minute wait), `tomorrow` (23 hours from now, a day's wait of 1440 minutes) or `ended` (half a minute ago, before the rule-wait job has taken the record: the card says OneUptime AI investigates shortly)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `?decided=`         | with an off `?ai=`: `now` reads the reason from today's settings (`current_configuration`), not one recorded when the record was created                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `?fixing=`          | what auto-remediation recorded for #1042 and #311 (`AutoRemediationDecision`): with an off `?ai=` by default the reason that goes with it (`off-switch` and `off-severity`: fixing was off; `off-project`: Enable AI was; `off-rules`: no AI rule matched); or `off`, `ai-off`, `no-rule`, `rules-investigate` (the one rule that matched, "Checkout investigations", only investigates), `acted` (OneUptime AI started a fix on prod-eu-west-1, so both cards stay whole) or `none` (nothing recorded, as for a record from before decisions were)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `?switches=`        | `on`: the project's "Investigate new ..." and "Fix new ... automatically" switches are on now, and Enable AI. By default they are off, and with `?ai=off-project` so is Enable AI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `?tldr=`            | `default` or `long` (incident #1042's TL;DR is 320 characters, the server's cap, so the header summary wraps and clamps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `?title=`           | `default` or `long` (alert #311 is titled "Payment webhook 5xx rate above 5% on the eu-west-1 checkout cluster", 67 characters, longer than a laptop's header is wide, so it reads in two lines there and three on a phone)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `?verdict=`         | none (default), `confirmed` or `rejected` (a responder's verdict already saved on the runs of incident #1042 and alert #311)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `?sm=`              | `scheduled` (default, starts in 2 hours), `ongoing`, `ended`, `overdue` (still Scheduled 20 minutes after its start), `overrun` (still Ongoing 30 minutes after its end)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `?fail=`            | comma separated: `evidence`, `verdict`, `create-fix-task`, `investigation`, `investigate-now` (Investigate now is refused: "This project has reached its own daily AI limit…"), `conversation` (the thread cannot be loaded), `conversation-send` (a question is refused: "AI is turned off for this project…"), `resend` (the subscriber notifications of #1042 and #58 are Failed and the retry is refused), `channel-links` (the record's Slack / Teams channels cannot be read), `suggestion` (using or dismissing a call's suggested root cause is refused)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `?channels=`        | the record's own chat channels, as `GET /workspace-channel-link/<type>/<id>` answers them for the header's Open in Slack / Open in Microsoft Teams: comma separated `slack` (one Slack channel), `slack2` (a second Slack channel, so Open in Slack becomes a menu) and `teams` (one Teams channel). None by default: no button. The links are built by the real `WorkspaceChannelLink` rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `?resources=`       | what Incident #1042 is attached to: `default`, `many` (five categories, one behind Show more, and a name too long for the sidebar) or `none` (#1042 and Scheduled Maintenance #58 have nothing attached, for the empty state)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `?feed=`            | `oncall-run`: incident #1042's on-call run in full, as the run writes its feed entries now (who it paged, a rule that reached nobody, who acknowledged): four on-call entries within a minute, which the feed folds into the newest of them. `links-and-quotes`: a private note on #1042 saved from a Slack message - a quote, the message's file, a `> [!WARNING]` callout, links to incident #1036 and to the docs, and the note's attachment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `?theme=`           | `dark` adds `html.dark`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `?private=`         | `1`: incident #1042 and incident episode #12 are private. A private incident or episode takes no public notes: the incident's state change dialogs fold a private note and ask nothing about subscribers, and both feeds' Add Public Note is locked with why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `?role=`            | who is signed in: `owner` (default; a master admin and Project Owner, so every permission gate is open), `alert-member` (not a master admin, only Alert Member: may acknowledge and resolve alerts but not create incidents, so Declare Incident shows disabled with the missing permissions in its tooltip), `member` (not a master admin, only Project Member: works incidents and alerts but may not change the project's AI settings, so the AI card's one line says who can instead of linking) or `loading` (no permissions yet, the moment before the snapshot arrives, so gated actions are hidden)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `?clusters=`        | which Kubernetes clusters the investigation payload's `clusterAccess` lists: none (default), `reachable` (prod-eu-west-1, which OneUptime AI can reach with kubectl), `unreachable` (staging-us-east-1, whose AI agent is not connected) or `mixed` (both); the cluster access notice's link opens a stub for `KUBERNETES_CLUSTER_VIEW_AI_AGENT`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `?measurements=`    | `default`, `none` (no measurements: the card is not drawn and only the definitions are read) or `states` (adds Time to impact, whose end is before its start, and Time to close, created a moment ago, which no event has a value for yet)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `?paged=`           | none (default: nobody was paged about any record, and the project has no "Time to acknowledge after paging"), `paged` (incident #1042 was first paged at 18:02 and alert #311 at 18:07, so each overview's "Acknowledged in" tile adds "2 minutes after paging" / "1 minute after paging", and both projects measure Time to acknowledge after paging) or `never` (the measurement exists and nobody was paged: the tile adds nothing, and the measurement reads Not reached once the record is resolved)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `?thread=`          | what the card's conversation holds: nobody has asked (default), `answered` (Sam's question and its cited answer, then the viewer's with a table, an executed action and a source), `working` (an answer being written, with live steps), `approval` (an action waiting for approval), `error` (a failed and a stopped answer) or `crowded` (twelve messages from six people, so the thread opens folded)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `?linked=`          | what the investigations read about the infrastructure they are linked to: none (default), `alerts` (#1042's read 2 open or recent alerts on its five resources, #311's none on its host), `more` (more alerts than the 10 listed) or `followup` (alert #318 opened on #1042's host after its first analysis: the card shows the follow-up check, its report led by "Checked again", and the feed both reports)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `?calls=`           | Incident #1042's video calls and their transcripts (issue #4875): none (default), `zoom` (a Zoom meeting a workspace rule started, no transcript yet), `teams` (a Microsoft Teams meeting not on a calendar: only Add transcript, as Microsoft lets no app read it), `reading` (OneUptime AI reading the Zoom meeting's transcript), `stuck` (Pending for 40 minutes), `transcript` (read, with a suggested root cause nobody has decided on), `not-enough` (read: the call did not settle the cause), `accepted` or `dismissed` (Jordan Patel used or dismissed the suggestion), `failed` (the daily AI token limit), `skipped` (AI is off) or `two` (the Zoom meeting with its suggestion, and an earlier Teams one). With Record and transcribe incident calls: `waiting` (OneUptime waits to get the Zoom meeting's transcript by itself), `fetch-stopped` (it stopped: Zoom kept no transcript), `summary` (it got the transcript, and what OneUptime AI read in it is in the feed, in the words the server writes, `CallSummaryFeedMarkdown`), `teams-recorded` (a Microsoft Teams meeting OneUptime put on its organizer's calendar, waiting for its transcript) or `teams-not-recorded` (a Teams meeting it could not put on a calendar, stopped from the start: the connection is not allowed yet). A reading started from the page is Pending for one read of the calls and Ready on the next |
| `?transcriptFetch=` | what Get from Zoom answers: `found` (default: the fixture's twelve-remark transcript), `not-ready`, `permission` (a scope the connection's Zoom app lacks) or `not-transcribed`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `?owners=`          | who owns the records: by default as **Owners** above; `none` (nobody owns any of them) or `many` (incident #1042 has three people and three teams, added people first, so the header shows three teams and "+3 more")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `?commander=`       | `none`: nobody holds Incident Commander on incident #1042 or incident episode #12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `?what=`            | what incident #1042's What happened card shows: the default description and root cause, `empty` (neither) or `long` (a description and a root cause of several paragraphs and lists, each folded behind Show more)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `?lang=`            | the reader's language, one of the Dashboard's 17 (`de`, `ja`, ...): the fixture loads that locale's own strings from `App/FeatureSet/Dashboard/src/Locales`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Adding owners and the commander from a header: `?fail=owner-add` refuses every owner a
header's Add owners list adds ("This user is already an owner of this incident."),
`?fail=role-assign` refuses the commander the header's Assign gives ("This user already has
this role."), and `?role=owner-people` signs in someone who holds only Create Incident Owner
User: they add people as an incident's owners but not teams, and give no role, so the Add
owners list names Teams locked with why.

## What the spec covers

`EventOverview.spec.ts` (526 tests):

- **AI investigation report**: the Summary (TL;DR as its lead line, no chip) as the card's
  first section, then the report's sections in order under the same plain h3 (the root cause
  is not a callout), closed by the verify-first caveat and Copy report; no brand heading, server
  "Evidence checked" block or footer in the prose; Copy report copies the published markdown;
  incident and alert reference links (href, `title`, clicking loads the other incident on the
  same route, back returns); citation chips (title and spoken label, click opens the collapsed
  details on the Evidence tab and expands, highlights and focuses the row, exactly one
  `POST /ai-investigation/evidence` with the right body, cached on collapse and re-expand);
  header TL;DR with View full report beside the heading, focusing the panel; a 320-character
  TL;DR (`?tldr=long`) arriving whole, clamped on a phone with Show more / Show less and View
  full report in the bottom row; verdict and fix task request bodies and their failure
  messages; the verdict badge in the header (at once after rating, replaced by a changed
  rating, rolled back with a failed save, already there with `?verdict=`, beside the heading
  at 1440px, wrapped under it at 390px and at 768px with View full report moved to the bottom
  row, on the alert page too) and the muted summary of a rejected report; the feed's compact
  AI item and its full report unfolding in place under it.
- **Investigation details**: evidence, activity and usage share one section below the report
  that starts collapsed. Its header names what the run did (queries, steps) and the read-only
  guarantee; tokens and the model sit inside. The Evidence checked and Activity tabs switch by
  click and arrow keys, a citation chip opens the collapsed section on the Evidence tab, and
  `?ai=pending` shows only the finished steps, with no tabs.
- **Evidence checked**: every row's label, tool description, time and row count; per citation
  the "What was queried" rows, the Open in link, the pinned or current-data notice and the rows
  (incident list, chart, logs table, `<pre>` text, trace waterfall, no rows with the server's
  explanation, timeline table); a query that cannot be re-run; alert and exception lists on the
  alert page; `?fail=evidence` with Try again sending a second request while focus stays in
  the row; `?ai=legacy`, where a chip focuses the report's own row.
- **Investigation states**: running, queued, failed, pending and none, including the header
  notice and how much of its usage each run shows (a failed run ends its steps with it); with
  no run the same card explains why nothing was investigated.
- **One flat card**: in every state (report, `?clusters=mixed`, legacy, running with and
  without clusters, queued, failed, pending, none), and with the details and an evidence row
  open, the card holds no panel of its own: no element big enough to be a region paints a
  background, a frame on all four sides or a shadow (computed styles in Chromium). Every h3 in
  the card shares one size, weight and colour; the status pill looks the same in every state;
  the order is report, cluster notes, working, actions, split by one-pixel top hairlines; the
  cluster notes are plain lines whose fix link opens the cluster's AI agent page; a chip's
  highlight reaches 12px past the text on `::before` while the row and its divider stay put,
  and uses the dark indigo wash in the dark theme.
- **One AI card**: the investigation and the conversation with OneUptime AI are one card. In
  every state above the conversation is inside the AI Investigation card, last in its region,
  with no card or card-level heading of its own, and the card ends with its composer; the alert
  page too. The section is drawn like the card's other rows (a hairline above it, the verdict
  row's heading and description styles, no icon tile), and the status pill ends at the card's
  content edge. What it suggests per state (the root-cause question leads with nothing
  investigated and after a run that stopped, never while one is underway), as plain chips
  straight above the composer. Asking: a suggested question is sent on the click, answered
  live and cited; a suggested action is only put in the composer; Enter sends, Shift+Enter is a
  new line and nothing is sent while an answer is written; Stop; `?fail=conversation-send` and
  `?fail=conversation`. A shared thread: who asked what, sources as a quiet list whose linked
  rows open their page, inline citations, charts and tables only for the asker, an executed
  action as a line, Copy, live steps on a rule, failed and stopped answers as lines. An action
  waiting for approval, run or denied. A long thread opening folded, unfolding with focus
  handed to the thread, avatars that do not hide each other's initials, and no scrolling box
  between the thread and the card. The composer: one framed control, no focus on load, the
  indigo focus, Send in the primary colour, the mode's menu inside the card at 1440px and
  390px, a chosen mode sent with the next question, and (with production's Inter) the caption
  on the picker's row at 1280px. No panel inside the card whatever the thread holds, with the
  fix task and verdict messages as lines. On a phone: no sideways scroll, a message's text at
  full width, the composer's rows, and the pill beside or under the title. The dark theme's
  colours, and the previous incident's thread never following a navigation.
- **Incident and alert**: hero (identifier, title, state, severity, duration, the Incident
  Commander and the owners, monitors and episode and their links), stat bar cells (Declared or
  Created first, no Duration), What happened and then the AI card leading the left column,
  Affected Resources leading the right column, its stacked card headers, Edit buttons and
  details field order, Resolve / Acknowledge from the hero through the state modal with an
  in-place refresh that never shows the skeleton, and `?fail=resend`.
- **At a glance**: who is on it - the Incident Commander from the roles card's own read (no
  second read of who holds the roles) and the owners, teams first, each with an avatar, read
  once per list for the record, each name level with its label and no taller than a line
  of words; `?commander=none&state=ongoing` showing the empty place (a dashed circle where
  the avatar would be) and Assign, which opens the project's people right under it with the
  cursor in its search box - one click (or a search and Enter) gives the role, the header
  and the roles card name them at once and the feed reads again; Escape closing it;
  `?fail=role-assign` saying why in the list; the same on incident episode #12, writing the
  episode's own role row; a resolved incident saying Not assigned;
  `?owners=none&state=ongoing` showing the empty place and Add, which opens the Add owners
  list right under it (the project's people, then its teams); one click adding an owner as
  the Owners page writes one, the header naming them at once and the list staying open for
  the next; `?fail=owner-add` saying why in the list; `?role=owner-people` naming Teams
  locked with why; `?role=loading` offering neither; Add on an alert, both episodes and a
  scheduled maintenance event adding to their own owner tables; the lists whole at 1280 and
  390px, light and dark; a resolved one saying None; `?owners=many` showing three and "+3
  more" to the Owners page; an alert with owners and no commander; both episodes. What happened - the description and root cause from the page's one read of the
  record, before the AI card; `?what=empty`; `?what=long` folded at six lines and opened
  with Show more / Show less; Edit saving both in one dialog that says the description is
  public where it is (an incident, an incident episode) and nothing about status pages
  where it is not (an alert, an alert episode), and the card showing what was saved. When
  and what it touched - the Declared tile with how long after the impact began and by whom,
  said nowhere else; its date, time and zone never broken inside at 1024, 640 and 390px,
  and an episode's, four tiles to a row at 1280px, breaking after the date rather than
  leaving the zone on a line of its own; Affected Resources first, with the monitor status
  the incident sets. The header, stat bar and What happened at 1280, 1024 and 390px, light
  and dark (a team's avatar lifted off the dark card), and in German.
- **Declare an incident from the alert hero**: in every alert state Declare Incident follows the
  state actions as a neutral outline button (the state action stays the only primary one, no
  More actions menu, nothing fetched to offer it) and opens the create-incident stub with
  `?alertIds=<alert>` and no dialog or write on the way; Back returns to the alert; Tab / Enter
  and Space reach and press it; `?role=alert-member` disables it with the missing permissions
  in a tooltip the pointer and the keyboard both reach; `?role=loading` hides it, with the state
  actions, until the permission snapshot arrives; an incident's hero never offers it.
- **The header, by its own width**: the header lays itself out by its own width, beside the side
  menu (container queries), in production's Inter. For a created and a resolved alert and a
  created incident at 390, 768, 1024 and 1280px, the exact rows the actions wrap onto, every
  button inside the header, whole and right-aligned, and the width the header says its actions
  need beside the pills (`data-actions-beside-from`): narrower, the number and pills, the title
  on its own line and the actions on theirs under it; from that width, the actions on one row
  beside the pills and the title under both. The switch happens at exactly that width, not a
  pixel earlier, and a long title (`?title=long`) reads whole across the header in as many lines
  as it needs, never cut. All five headers (a new incident, alert and both episodes, and a
  scheduled maintenance event) in English, German, Persian and Japanese at 390, 768, 1024, 1280
  and 1440px: the actions beside the pills exactly from the width the header names, never
  wrapped there or cut, the ⋯ in the top corner, the current state's name whole in the track, the
  facts on even rows, the AI band's View full report and Show more never overlapping, every
  word at 4.5:1 or more; and in the dark theme at 1280 and 390px, the dark card with no light
  panel on it. The AI root cause analysis and a missed start each close the header in a band of
  their own, and `?role=alert-member` sees an incident's Acknowledge and Resolve locked, each
  naming the permissions it needs, with no ⋯.
- **Scheduled maintenance**: every phase's state, duration prefix, actions, overdue notice and
  Starts / Ends / Duration cells with the timezone note; details, feed and resources; Mark as
  Ongoing refreshing in place; `?fail=resend`.
- **Episodes**: hero (the incident episode's Incident Commander, the owners) and four-cell stat
  bar (Declared or Created first, Automatically when a grouping rule opened it), the members
  card (number chip, title link, state
  and severity pills, View all), details field order, roles, Resolve / Acknowledge from the hero.
  The card and the telemetry snapshot's first member are read by membership: the membership
  rows, then the members by id, never by the members' own episode link - so the founding member
  that later joined another episode is still listed.
- **Affected Resources card** (incident, alert and scheduled maintenance): the categories are
  sections of the one card, read from computed styles - no shadow, border (but the hairline
  above each section after the first) or white fill inside it, as wide on the right as on the
  left, and no grey wash on hover; level-3 headings naming label and count, the summary line,
  the icon tile, label and names lined up; a click at the empty end of a row opens the resource
  (monitor, service, host, cluster, SLO); hover lights the whole row and underlines the name;
  Tab from Edit reaches each row with a focus ring round it and Enter opens it; with
  `?resources=many` Show more / Show less (`aria-expanded`, `aria-controls`) in place, no label
  truncated at 1440px, a long name ending in an ellipsis, and nothing overflowing at 390px;
  with `?resources=none` the open empty state, promising linked SLOs on the incident but not
  on scheduled maintenance; light and dark (`?theme=dark`) colours of labels, rows, counts,
  hairlines, icon tiles and hover.
- **Measurements**: the incident, alert and maintenance pages' Measurements card under the
  details card - names, what each measures, values in their own unit, Running for, Not started
  yet, Not measured with the server's reason, Ends before it starts, Not worked out yet; the
  requests (enabled and shown on event pages, in order, then this event's values, and nothing
  more once the AI report arrives); a hero Resolve turning running clocks into numbers in place;
  every maintenance phase; `?measurements=none` drawing nothing; the dark theme and a phone.
- **Responsive**: no horizontal scroll at 390px on all five pages (and with evidence rows
  expanded); right-column card titles wider than 120px at 1280px; What happened and the right
  column's first card starting the row together, their titles lined up, at 1280px.
- **The feed, as a timeline**: the day as a level-3 heading with its date ("Monday, September
  14, 2026"), Today beside it and the zone the times are in (UTC); every entry's time, newest
  first, with "N min. ago" for the last hour, a time said once per minute, and a `<time>` with
  the instant; an entry led by who did it, its leading emoji gone and the rail's icon in its
  place; the time above the entry on a phone; the AI entry's full report unfolding in place
  under Show the full report, and folding again under Hide details; what someone wrote (a note,
  the AI's root cause) in a card under the sentence that introduces it, light and dark, while
  what happened stays a sentence; a maintenance event's created entry read as "Jordan Patel
  created Scheduled Maintenance #58"; and with `?feed=oncall-run` the run folded into its
  newest entry, unfolding in place by keyboard with Show fewer under its last entry, focus
  moving to the first entry it unfolded and back to Show 3 more when it folds again.
- **Links and quotes in a note** (`?feed=links-and-quotes`): the file a saved Slack message
  carried opens in a new tab without an opener while the incident stays open; the note's
  attachment opens in a new tab once the session is refreshed; a link to another incident
  stays in the tab, one to the docs opens a new one; quoted text is a 3px grey bar with lighter
  text and no icon; the `> [!WARNING]` callout is an amber panel named Warning with its sign,
  its marker not shown; both take the dark theme's colours.
- **The linked infrastructure and the follow-up check** (`?linked=`): a running
  investigation's line saying what it read about its linked infrastructure, its mark beside
  its first line when it wraps on a phone, and its steps' detail after their words; the
  newest alerts it read when more matched; an alert's "No open or recent alerts"; a
  follow-up check running headed "OneUptime AI is checking again", its first line naming the
  alert; its report led by the "Checked again" line above the Summary, the alert a link, the
  mark level with the line; the feed's "OneUptime AI checked again ..." entry above the
  first analysis; the containers table and the CPU-by-state chart of its evidence in words;
  no sideways scroll on a phone in either theme.
- **Open in Slack / Microsoft Teams**: no button without a channel (the page still asks, for
  its record); with `?channels=slack` a link in the hero opening in a new tab without an opener,
  the channel named when pointed at; with `teams` a link on teams.microsoft.com with its team;
  with `slack,slack2` one Open in Slack menu listing both channels, each opening in a new tab;
  with `slack,teams` one Open channel menu naming each product, so a created incident's title
  keeps its room at 1280px; the alert, scheduled maintenance and both episode pages too;
  `?fail=channel-links` hiding the buttons with nothing broken; a phone with all three.
- **An incident call's transcript** (`?calls=`, `?transcriptFetch=`): while OneUptime waits to
  get Zoom's transcript by itself the card says so, Get and Add staying; once it stopped, Zoom's
  answer in the card's sentence with How to set it up; what OneUptime AI read as OneUptime AI's
  note in the feed, its cause marked not confirmed and its parts named as on the AI card.
  A Teams meeting on its organizer's calendar waited on, then read by Get from Microsoft Teams
  ("... from Microsoft Teams" in the feed); one that could not be put on a calendar saying the
  connection is not allowed yet, with How to set it up and only Add transcript.
  Get from Zoom reads it,
  the Video Call card says OneUptime AI is reading it, and the AI card's section becomes the
  suggestion without a reload; Review it focuses that section, and the feed reads "Maya Chen
  added the call's transcript from Zoom: ...". Zoom's not-ready, permission and
  not-transcribed answers each as one sentence of the card's own, Zoom's words behind Show
  details, the last two with How to set it up opening the docs in a new tab, each dismissable,
  and no sideways scroll on a phone. A Teams meeting's transcript pasted, sent as written,
  described, and in the feed. The suggestion marked Not confirmed, its quotes in the order
  they were said, its other points folded as two lists (Confirmed on the call, then
  Hypotheses), and nothing written to the incident. View transcript starting on the quoted
  lines, highlighted, with its find box. Use as root cause opening in the editor, showing
  DB_POOL_MAX=10 as code, never italic, and the quotes as quotes; Cancel saving nothing and
  Save sending the decision with the text; a refused save. Dismiss folding the suggestion to
  its sentence and Undo bringing its quotes back, a decision already made, not enough said, a
  failed and a stuck reading offered again, AI off (with Open AI Features), Remove asking
  first, two calls, and both cards at 1280px in both themes and on a phone: the transcript's
  heading on a line of its own with the menu's mark, View transcript under the reading, and
  Copy link and Remove under Join call together.

Two tests are marked `test.fail` because they pin known layout bugs and pass (as expected
failures) until the bugs are fixed, when Playwright reports them so the mark can go: on a
390px phone an acknowledged alert's Declare Incident is cut off beside Resolve, and at xl a long
alert title squeezes the action group until Declare Incident wraps onto a second row.

`afterEach` fails a test on an uncaught page error or on any request the fixture does not
model, and a network fence aborts anything that leaves the fixture server.

## What the fixture records

`window.__eventOverviewFixture` holds `getItemRequests`, `listRequests`, `countRequests`,
`apiRequests`, `updates`, `creates`, `deletes` and `unhandled`. Anything a page reads that the
fixture does not model (a model table, an analytics query or an API URL) answers empty and
is listed in `unhandled`; the spec's `afterEach` fails when that list is not empty.
`window.__eventOverviewFixture.callApi(method, route, body)` calls the API stubs directly.

## Run it

```
cd packages/E2E
npm install
npm run test-event-overview-ui
```

Playwright reuses a server already listening on port 4222 outside CI. If one from another
checkout might be running, give this run a port of its own (the config, `server.js` and the
spec's network fence all read it):
`EVENT_OVERVIEW_FIXTURE_PORT=4719 CI=1 npm run test-event-overview-ui`.

Screenshots land in `output/playwright/event-overview-ui/`, named `*-synthetic.png` because
every record in them is fabricated. The AI card's states are
`ai-card-{running,running-clusters,queued,failed,pending,none,clusters,dark}`, and with a
conversation in it
`ai-card-conversation-{answered,none-answered,working,approval,error,crowded,dark,mobile}` and
`ai-card-none-mobile`, and with the linked infrastructure
`ai-card-followup{,-running,-dark,-mobile}`, `ai-card-linked-running-mobile` and
`incident-feed-followup`. The hero
header tests add `{alert-hero-created,alert-hero-resolved,incident-hero-created}-{390,768,1024,1280}`,
`alert-hero-long-title-{390,1024,1280}`,
`event-header-{incident,alert,incident-episode,alert-episode,scheduled-maintenance}-{en,de,fa,ja}-{390,768,1024,1280,1440}`
and `-dark-{1280,390}`, `event-header-ai-band-{light,dark}` and `event-header-maintenance-overdue`,
and the Affected Resources tests add
`{incident,alert,scheduled-maintenance}-overview-affected-resources` and
`incident-affected-resources-{many,mobile,empty,light,dark}`, the Measurements card
`incident-measurements{,-dark,-mobile}`, the feed `incident-feed{,-mobile}` and a note's links
and quotes `feed-note-links-and-quotes{,-dark}`, and the hero's
chat buttons `incident-hero-open-in-chat{,-mobile}` and `incident-hero-open-channel{,-menu}`,
and an incident call's transcript `incident-call-transcript-card{,-dark}` and
`incident-call-summary{,-dark,-mobile}`.

## Poke at it by hand

```
cd packages/E2E
node EventOverview/Fixture/server.js --watch
```

then open
`http://127.0.0.1:4222/dashboard/10000000-0000-4000-8000-000000000001/incidents/20000000-0000-4000-8000-000000001042`.
`--watch` rebuilds the bundle when a source file changes; refresh the browser. The other pages
use ids `30000000-0000-4000-8000-000000000311` (alerts),
`40000000-0000-4000-8000-000000000058` (scheduled-maintenance-events),
`50000000-0000-4000-8000-000000000012` (incidents/episodes) and
`60000000-0000-4000-8000-000000000007` (alerts/episodes). A browser outside Playwright shows
relative times against the real clock, not the pinned one.

## Not modelled

- Telemetry snapshots: no event carries a `telemetryQuery`, so the Logs / Spans / Metrics /
  Exceptions preview tabs and their analytics queries are not rendered.
- The Monitor Summary card, the series-label "Affected Resource" card, runbook executions,
  custom fields and auto-remediation suggestions are empty, so those cards stay hidden.
  Auto-remediation decisions (what auto-remediation did, which the Remediation card reads
  beside the suggestions) are empty too, unless `?fixing=` or an off `?ai=` records one.
- Stubs ignore `select`: every read returns the whole record, so a missing column in a page's
  select is not caught unless a test asserts on the recorded `select`.
