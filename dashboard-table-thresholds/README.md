# Dashboard tables: threshold colors (#5231): screens

How these were made: the real table widget and the real widget settings dialog
(`ComponentSettingsModal`, its Live Preview and `ArgumentsForm`), bundled with the
Dashboard's own esbuild config, its Tailwind runtime with the reading-direction script and
the Inter font, and rendered in headless Chromium at twice the pixels, with the metric
reads answered from memory: eight hosts' CPU and memory in use (fractions of 1, as the
host metrics receiver sends them), disk in use and the 1-minute load. `before-board-*`
from master is the table before this change; the other `before-*` are the branch as its
builder left it (c87cb9d1dc), before the UI review. They are not screenshots of a running
stack, and every name in them is made up.

- `before-board-1280.png` / `after-board-1280.png`: the table on a dashboard. Master wrote
  a usage metric sent as a fraction of 1 as `0.9 1`; now it reads `93.0%`, and CPU, Memory
  and Disk at 80 and 90 are colored: a warning amber with a triangle, a critical value red
  and bold with a circle. Load has no thresholds and keeps the table's own color.
- `after-board-background-dark.png`: Threshold colors set to Colored background, in the
  dark theme: the same levels as filled cells.
- `before-board-fa.png` / `after-board-fa.png`: Persian, right to left: the numbers line up
  at their end, the shape at each value's start. The row count said `rows ۸`; it is now
  `۸ سطر` (the row count, its "3 of 8 rows" form and the empty table's sentence were
  English in most languages).
- `before-threshold-colors.png` / `after-threshold-colors.png`: Threshold colors, under the
  columns once one is colored. It is now the product's choice rows (as a workflow step's
  choice), with an indigo radio, a picture of a warning and a critical cell drawn the
  table's way, and a line saying what each does. Before: two ring cards of their own, the
  browser's blue radio, and one red chip that did not show a filled cell.
- `before-threshold-colors-dark.png` / `after-threshold-colors-dark.png`: the same in the
  dark theme, Colored background picked.
- `before-threshold-colors-390.png` / `after-threshold-colors-390.png`: a 390px window.
- `before-lower-is-worse.png` / `after-lower-is-worse.png`: Lower is worse picked on a
  percent column whose thresholds were still the 80 and 90 they start at. Before, the pick
  left them reversed ("Critical should be at or below Warning.", red from 90% down, nothing
  ever amber); now they move to 20 and 10. Numbers someone typed are kept. The levels under
  the fields now line up with them in Colored text (they were 6px in).
- `before-column-card-de.png` / `after-column-card-de.png`: a column's card in German. "Show
  as column in the table" was English; so were Decimals, Auto, the blank-unit hint and the
  card's other words in most languages. "Unit" stays English where it was: one key holds a
  measurement unit, a systemd unit and a site type.
- `after-settings-390.png`: a column's thresholds in a 390px window, its fields stacked.
