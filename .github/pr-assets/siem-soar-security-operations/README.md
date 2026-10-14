# Security cases and playbooks (SIEM + SOAR)

These images show the Security Events SOC pages added by this change. Each one is the real
production page (`Pages/SecurityEvents/*`, inside its layout and side menu) rendered offline by
the fixture in `packages/E2E/SecurityOperations/Fixture`, on a month of synthetic security work
for a made-up "Acme Commerce" workspace. Every name, domain and address is fabricated, and the
fixture's header marks the workspace as synthetic.

They come from the Playwright suite in `packages/E2E/SecurityOperations`
(`cd packages/E2E && CI=1 npm run test-security-operations-ui`; the images land in
`output/playwright/security-operations-ui/`), captured at 2x, scaled to 1440 px wide and reduced
to a 256-colour palette. The mobile image stays at 2x of a 390 px viewport, cropped to the top of
the page.

- `overview.png` / `overview-dark.png`: the overview, in both themes: what needs someone now,
  mean times, cases and detections per day, verdicts, ATT&CK tactics, top detections and the
  riskiest entities. The side menu's setup sections (Detect, Sources) are folded away.
- `overview-empty.png`: a project with nothing set up yet, shown the three steps that set it up.
- `cases.png`: the case queue beside the side menu.
- `case.png`: a case: header and status steps, detections, a playbook run waiting for approval,
  the timeline, entities, ATT&CK and private notes.
- `playbooks.png`: templates and the playbooks list.
- `playbook.png`: a playbook's settings, steps and latest runs.
- `playbook-runs.png`: every run, the one waiting for approval first.
- `attack-coverage.png`: the ATT&CK matrix with what the enabled rules cover.
- `rule-library.png`: the ready-made rules, those the project has marked Added.
- `entities.png`: the entities the findings name most.
- `cases-mobile.png`: the case queue at 390 px.
