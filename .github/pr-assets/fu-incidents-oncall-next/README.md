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
