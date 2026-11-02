# Facet exclude: UI review of #5574

How these were made: the production Logs explorer bundled from
`packages/E2E/ChartTimeZoom/Fixture/Fixture.js` (offline, every record fabricated), with the
Dashboard's Tailwind runtime, its reading-direction script, `Theme.css` and Inter, drawn in
headless Chromium at 2x. A language is the Dashboard's own locale file. `before-*` is the
builder's commit 4afec62c31; `after-*` is this branch. A phone or tablet is a touch context
(`hover: none`).

- `before-keyboard-1280.png` / `after-keyboard-1280.png`: a value holding the keyboard's focus.
  Before, the minus was `display: none` off hover, so Tab never reached it. After, it stands
  where the count was, one more Tab away. `after-keyboard-dark-1280.png`: the dark theme.
- `before-phone-390.png` / `after-phone-390.png`: a phone. A touch screen has no hover, so
  before there was no way to leave a value out. After, every value shows its minus after its
  count. `after-phone-excluded-390.png` and `after-phone-excluded-dark-390.png`: Debug left out
  with a tap; its count stays beside the pressed minus.
- `before-tablet-1024.png` / `after-tablet-1024.png`: a tablet, where the sidebar sits beside the
  list as narrow as a desktop's. The minus takes the bar's place, so the names keep their width.
  `after-tablet-excluded-1024.png`: payments-worker left out.
- `before-persian-names-1280.png` / `after-persian-names-1280.png`: a Persian page. Before, an
  English service name was cut at its start ("…yments-worker"); after, at its end
  ("payments-wor…").
- `after-persian-excluded-1280.png`, `after-german-excluded-1280.png`: the red "is not" chips and
  rows in Persian (right to left) and German.
- `after-logs-excluded-1280.png`: two severities left out and a third hovered, its minus over its
  count. `after-logs-excluded-dark-1280.png`: the dark theme, a severity left out beside a
  service kept.
