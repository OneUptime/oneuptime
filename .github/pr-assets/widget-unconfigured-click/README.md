# Widgets that are not set up yet (issue #7160)

Screenshots for the pull request that answers issue #7160. They come from the
real dashboard page (the view layout around the Dashboard page, bundled as the
`packages/E2E/DashboardValueWidget` fixture bundles it), with a board that holds
every widget kind that has a setup state, each as the widget picker adds it:
Value (3x1 and 3x2), Data Source Value, Gauge, Data Source Gauge, SLO, Chart,
Data Source Chart, Data Source Table, Funnel and User Retention. Chromium,
device scale factor 2, with the Inter font.

- `board-viewing-en-1280.png`: a board out of edit mode. Each widget says only
  what is missing.
- `board-editing-en-1280.png`: the same board while it is edited. A click on a
  widget opens its settings, so the line asks for one.
- `preview-chart-en-1280.png`: the widget settings dialog's Live Preview of a
  new Chart. The line points at the settings below it.
- `preview-gauge-de-dark-1280.png`: the same for a Gauge, in German, dark theme.
- `board-viewing-de-1024.png`: German at 1024px, beside the side menu.
- `board-viewing-ar-dark-1280.png`: Arabic, dark theme.
- `board-viewing-en-390.png`: a phone.
