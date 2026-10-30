# OneUptime AI card: Investigation and Remediation in two steps

Screenshots of the AI card on an incident's and an alert's overview page
(`packages/App/FeatureSet/Dashboard/src/Components/AI/InvestigationPanel.tsx`,
`AiCardStep.tsx` and `AutoRemediation/RemediationStep.tsx`), before and after
this branch.

The `before-*` and `after-*` page images, and the `after-alert-*` and
`after-incident-cluster-*` close-ups, were taken in Chromium from a local
stack (the App run natively against its own Postgres, Valkey, ClickHouse and
nginx), with a project whose incident and alert OneUptime AI investigated
through a stand-in LLM. `before-*` is master's Dashboard, `after-*` this
branch's. The project, its people and its incidents are made up for the
stack.

The `after-card-*` images come from the offline suite
`packages/E2E/EventOverview` (`npm run test-event-overview-ui`), whose
fixture replaces only the data boundary: Incident #1042 with
"Fix new incidents automatically" off when OneUptime AI checked it and on
now (`?state=created&fixing=off&switches=on`), or still off (`?fixing=off`).

- `before-alert-page-1280.png`: master's alert page. The AI Investigation
  card shows the whole report, and the Remediation card - "No action
  taken", and why - is a card of its own under it, past the conversation.
- `before-incident-page-1280.png`: master's incident page, the same way.
- `after-incident-page-1280.png`: the incident page with one OneUptime AI
  card of two steps, up top: 1 Investigation, folded to its answer with
  Show full report, and 2 Remediation, with why nothing was fixed, what to
  do, the fix in the code and Try again.
- `after-alert-fixing-off.png`: "Fix new alerts automatically" is off:
  the step says so, with Turn on for alerts, and the fix in the code the
  investigation found waits for a repository, so the pill says Needs
  attention (off alone, it says Off: `after-card-german.png`).
- `after-alert-turned-on-since.png`: the switch was turned on after the
  alert came in: the line says it was off then and is on now, and Try
  again decides again.
- `after-alert-tried-again.png`: decided again: the alert is linked to no
  host, cluster or database, so OneUptime AI had nothing to fix, and what
  to do.
- `after-alert-try-again-too-soon.png`: Try again moments after a decision:
  the refusal, in a notice that can be put away.
- `after-alert-report-open.png`: Show full report opened: the report, its
  working and the verdict, then Show less, then the Remediation step.
- `after-incident-cluster-fixes-off.png`: an incident on a Kubernetes
  cluster whose Fixes are off: "OneUptime AI only investigates there", and
  the link to the cluster's AI agent page.
- `after-card-1280-dark.png`: the card at 1280 pixels in the dark theme.
- `after-card-390-light.png` and `after-card-390-dark.png`: on a 390 pixel
  phone, each step's body takes the card's width under its mark.
- `after-card-german.png`: German.
- `after-card-persian-1280.png` and `after-card-persian-390.png`: Persian,
  read right to left: each step's mark at the start, on the right.
