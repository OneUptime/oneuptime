# Response targets, a case's tasks and evidence: UI review screenshots

Before/after pairs for the UI review of #5369 (security case response targets,
tasks and evidence).

- **Pages**: drawn by the Security Operations offline fixture
  (`packages/E2E/SecurityOperations/Fixture`, `?targets=on`) in headless
  Chromium at 1280px (390px for the phone), with Inter loaded, the clock at
  2026-10-14 12:00 UTC. Long names and many tasks come from a review-only
  scenario that rewrites the spray case's checklist (twelve tasks, Diego as
  "Diego Fernando Alvarez-Montenegro de la Vega"); the failed list from one
  that refuses the tasks read; the timeline from one that adds what tasks,
  evidence and targets write, through the real `SecurityCaseMarkdown`
  sentences. "Before" is the builder's branch (2c77fb6a3d).
- **Emails**: `SecurityCaseTargetDue.hbs` and `SecurityCaseTaskAssigned.hbs`
  rendered with the real partials and the vars the real builders
  (`buildTargetAlertMessage`, `buildTaskAssignedMessage`) give, at 640px.
  Chromium renderings of the email HTML, not inbox screenshots.

Each image is cropped to the card, dialog or email it shows.
