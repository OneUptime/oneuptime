# Telemetry monitors as one rule: before and after

Screenshots for the pull request "Monitors: set up a Logs, Traces, Exceptions
or Metrics monitor as one rule, over a preview of what it would have caught"
(#5371). They are drawn by the repository's offline browser fixtures - the
real Dashboard pages over fixture data, with Theme.css and the Inter font -
at 1x, on a clock held at 2026-09-21 12:00 UTC:

- Create Monitor and the Criteria page: `packages/E2E/MonitorOverview`
  (`?preview=empty|fail` for the preview's other answers, `?lang=de|fa`,
  `?theme=dark`).
- The logs and trace explorers: `packages/E2E/ChartTimeZoom`.
- An exception's page: `packages/E2E/ExceptionDetail`.

`*-master.png` is master before the pull request, `*-before.png` the branch
before its second UI review, `*-after.png` the branch as merged.

- `logs-step-1280-master` / `logs-step-1280-after`: a new Logs monitor's
  criteria step. Master: a text field, "Monitor Logs for (time)" at one
  minute, an embedded logs explorer, and two criteria that alerted on
  silence. After: what the monitor should tell you about, the logs to
  watch, When to alert over a chart of what it would have caught, and What
  happens. `logs-step-dark-1280-after`, `logs-step-de-1280-after` and
  `logs-step-fa-1280-after`: the same in dark mode, German and Persian.
- `when-to-alert-use-1280-before` / `-after`: after Use 48. The number lay
  above every window and its red line fell off the chart; the axis now
  stretches to it.
- `preview-empty-1280-before` / `-after`: windows that held nothing. "Use 1"
  read as advice to alert on the first log; no number is offered now, and
  the rule's line stays drawn. `preview-failed-1280-after`: a preview
  stopped at the time limit, with Try again.
- `custom-criteria-1280-before` / `-after`: custom criteria. Back to the
  simple rule sat under Add Criteria; it is in the card's header now.
  `what-happens-1280-after`: folded, More fields names Edit as custom
  criteria too.
- `logs-toolbar-1280-before` / `-after`: the logs explorer in a 1280px
  window. Create monitor's words pushed Live and the result count onto a
  second row; between md and a 77rem toolbar the bell shows alone (named
  Create monitor, its tooltip says so). `traces-toolbar-1280-before` /
  `-after`: the trace search had 16rem beside the buttons; with the bell
  alone it keeps more than 20rem.
- `exception-header-1280-before` / `-after` and `exception-header-768-after`:
  an exception's actions under its message now start where its words do.
