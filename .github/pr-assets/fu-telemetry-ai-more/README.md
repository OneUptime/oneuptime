# Metrics AI: Missing Request Metrics, and the collector step

Screenshots for the pull request that adds Metrics AI's fourth finding,
Missing Request Metrics, and the way past a missing metric that changes no
code (the OpenTelemetry Collector's span metrics step).

They were taken from the Metrics AI offline fixture (`packages/E2E/MetricsAi`)
in headless Chromium at twice the pixel density, with Inter loaded and the
page clock pinned to 2026-10-24 12:00 UTC. A wrapper around the fixture loads
the Dashboard's own locale files for German and Persian, and sets the page to
read right to left for Persian. Every record in them is synthetic.

- `before-*`: master's code (a `git archive` of `origin/master`).
- `after-*` and the rest: this branch.

| File | What it shows |
| --- | --- |
| `before-inbox-1280.png`, `after-inbox-1280.png` | Metrics → AI → Insights: the new finding, with its own kind. |
| `before-missing-finding-1280.png`, `after-missing-finding-1280.png` | A Missing Metrics finding: Without changing code now sits under Fix with AI. |
| `requests-finding-1280.png`, `requests-finding-1280-dark.png` | The new finding, light and dark. |
| `requests-finding-390-fa.png` | The new finding on a phone, in Persian. |
| `collector-step-1280.png`, `collector-step-1280-de.png` | The collector step's dialog, in English and German. |
| `collector-step-390-fa-dark.png` | The dialog on a phone, in Persian, dark. |
