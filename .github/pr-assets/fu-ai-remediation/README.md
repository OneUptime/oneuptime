# AI remediation follow-ups: folded fixes, resolved records, Fixes off

Screenshots of the AI card's Remediation step on an incident's overview page
(`packages/App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep.tsx`),
taken in Chromium by the offline Event Overview suite
(`packages/E2E/EventOverview`, `npm run test-event-overview-ui`), whose
fixture replaces only the data boundary. Every record is made up for the
fixture's "Acme Commerce" workspace.

Before: `.github/pr-assets/ai-remediation-two-steps/review-after-fixes-many-1280.png`
and `review-after-fixes-many-390.png` (#5413's UI review), the same three
fixes (`?fixes=many`): a kubectl fix waiting for approval, a fix OneUptime
AI made through MCP servers on its own (one change failed) and an approved
runbook, verified fixed, each with every command, its why, its expected
effect and its undo, and Approve & Run under all of it.

- `after-fixes-folded-1280.png`: the same three fixes, each folded to where
  it stands and its sentence ("2 commands on cluster prod-eu-west-1.", "2
  changes through Feature flags, Status page."), the failed change counted
  in red beside where its fix stands, Review and approve or Show details one
  press from the rest, Dismiss and View Execution where they were.
- `after-fixes-folded-390.png` and `after-fixes-folded-390-dark.png`: on a
  390 pixel phone, light and dark: the three fixes fit one screen.
- `after-fixes-folded-fa-390.png`: Persian, right to left: each sentence in
  Persian, its names in place, its full stop at its end.
- `after-fixes-opened-1280.png`: the kubectl fix and the MCP fix opened:
  their commands and changes, the reasoning, and Approve & Run under the
  commands it runs, with Hide details.
- `after-resolved-linked-to-nothing.png`: a resolved incident linked to
  nothing: what happened and how the next one is linked, never that
  OneUptime AI tries again, and no place to go for this one (was: "Add the
  host ... and OneUptime AI tries again", with Go to Affected Resources, as
  Needs attention).
- `after-cluster-fixes-off-open.png`: an open incident whose cluster's Fixes
  are off: what to do, "Turn its Fixes on, and OneUptime AI tries again.",
  and the cluster's AI agent page.
- `after-ai-off-whole-open.png`: an open incident AI did not investigate,
  whose fixing switch is on now: the card is drawn whole instead of the
  AI-off one line, so its Remediation step offers Try again.

## UI review

The same three fixes after the UI review, taken from the same fixture
(`?fixes=many&state=created`, the incident open) at twice the pixel
density. The `after-*` shots above are the first pass the review started
from.

- `ui-review-fixes-folded-1280.png`: folded, the waiting kubectl fix offers
  one thing, Review and approve: Dismiss alone under its sentence was the
  one button in sight. Nothing says what approving runs while nothing is
  shown, and the two servers read "Feature flags and Status page".
- `ui-review-fixes-opened-1280.png`: every fix opened: the kubectl fix's
  reasoning first (no second Show reasoning press), its commands, then
  "Approving runs exactly what is shown, under your name." right over
  Approve & Run and Dismiss.
- `ui-review-fixes-folded-390.png`, `ui-review-fixes-folded-390-dark.png`:
  a 390 pixel phone, light and dark.
- `ui-review-fixes-opened-390.png`: the waiting fix opened on a phone.
- `ui-review-fixes-folded-de-390.png`: German ("2 Änderungen über Feature
  flags und Status page.").
- `ui-review-fixes-folded-fa-390.png`: Persian, right to left: each server
  set apart, so the list reads in its order.
