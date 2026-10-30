# Incidents and on-call, next: before and after

How these were made: the real Dashboard and Common components, bundled with the
Dashboard's esbuild config and drawn in headless Chromium with the Dashboard's
Tailwind runtime and the Inter font. Every record is made up.

- The switch and button taps and the rule conditions: the SharedUi offline suite
  (`packages/E2E/SharedUi`), at 390 pixels with real touch events.
- The table: the ModelTables offline suite's wide gallery (`packages/E2E/ModelTables`),
  after Tab moved onto the "Never reminds" pill under the stuck Actions column.
- The reminder rule's Match step: the real Create New Scheduled Maintenance Reminder
  Rule dialog, master's builder against this branch's.
- The Final Schedule and Readiness: the real On-Call Duty pages in a harness that
  answers their reads (a weekly rotation of four people, five responders), beside
  the side menu.
- The AI hold notice: the AI Investigation card's notice, master's against this
  branch's (the EventOverview offline suite, `?hold=1`).

`*-before*` is master; `*-after*` is this branch.

- `locked-switch-tapped-phone-after`: a tap on the help icon after a locked switch's
  title says why it is locked and keeps saying it once the finger lifts. On master
  the reason went as the finger lifted, so there is nothing to show for "before".
- `locked-button-tapped-phone-after`: the same for a locked button.
- `table-focus-before-1280` / `table-focus-after-1280` (and `-fa`): Tab onto the
  "Never reminds" pill. Before, it stayed under View and the row's menu; after, the
  rows scroll until it is clear, right to left too.
- `rule-match-step-before` / `rule-match-step-after`: the reminder rule's Match step.
  Before, "Lab..." and "H..."; after, one picker a line beside the dialog's steps.
- `rule-conditions-every-width-after`: the same conditions as a phone, a stepped
  dialog, a dialog with no steps and a page lay them out.
- `final-schedule-before-1280` / `final-schedule-after-1280`: the description once,
  the timezone only beside View as, sentence-case labels, one list of hand-offs, the
  legend right above the grid, names in the blocks.
- `final-schedule-before-390` / `final-schedule-after-390`: a phone opens the grid
  on Day.
- `readiness-before-1280` / `readiness-after-1280`: Teams folded into Reached via;
  the table fits its card beside the side menu; a one-line hint.
- `readiness-before-390` / `readiness-after-390`: Reached via on a phone's card, and
  the tiles' names whole (the icon over the number where a tile is narrow).
- `readiness-tiles-after-390`, `readiness-tiles-after-1024-de`: the tiles alone - over
  on a phone, beside two a row next to the side menu, in German.
- `ai-hold-before` / `ai-hold-after` (and `ai-hold-after-dark`, `ai-hold-viewer-after`):
  the notice as the card draws every other notice, with no box of its own; a Viewer
  sees Page now locked, saying why. The after shots are the AI Investigation card of
  the EventOverview fixture's incident #1042 (`?state=created&hold=1`, `&role=viewer`).

## UI review

`review-*-before` is the builder's branch, `review-*-after` the reviewed one, each at 2x:
the same harnesses (the SharedUi fixture and the on-call route groups with Inter), with
the six reviewed files swapped for the builder's for the before shots.

- `review-help-ring-1280-*`: Tab onto a locked switch's help button. Before, the ring
  ran into "page"; after, it is drawn inside the button.
- `review-help-wrap-390-*`: a phone. Before, the question mark sat alone under "When
  filters match, create an alert"; after, "alert" goes down with it.
- `review-readiness-tiles-1280-de-*`: German at 1280. Before, the tiles that filter (buttons)
  centred their icon and number in a row made taller by "Einrichtung erforderlich"; after,
  every tile starts at the top.
- `review-user-readiness-tiles-1280-*`: a person's own Readiness tiles. Before, "Verified
  methods (1 / unverified)"; after, "Verified methods / (1 unverified)".
- `review-layer-card-1280-*`: the Layers page's layer card. Before, "ORDER", "UPCOMING
  SHIFTS", "ON CALL NOW", a framed box a turn and "6d 23h"; after, the Final schedule's
  sentence-case labels, one ruled list and "7d".
- `review-overrides-card-1280-*`: the overrides card in the Final schedule. Before, "1 USER
  OVERRIDE ON THIS SCHEDULE", "AWAY", "COVERING" and "6d 23h"; after, sentence case and "7d".
- `review-final-schedule-768-*`: 768 beside the side menu. Before, a week in 430 pixels
  ("Nin / a / Pat / el") and "View / as" beside a four-line note; after, a day, and the
  note under the control.
- `review-view-as-1024-*`: 1024. Before, "View / as"; after, whole, the note under it.
