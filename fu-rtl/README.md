# Right-to-left languages and the page language

How these were made: `before-*` and `after-*` are a local stack (the App with Postgres, ClickHouse
and Valkey) seeded with one project, four monitors and two incidents, opened in headless Chromium
at 1280 and 390 pixels with the Dashboard's language set to Persian (or German) the way the
language menu sets it. `before-monitors-fa.png` is master at the merge base. `fixture-*` are the
reading direction browser suite's own screens (packages/E2E/ReadingDirection: the production
components in the Dashboard's Persian words).

- `before-monitors-fa.png`: master. Persian words, laid out left to right: the side menu at the
  left, the table's first column at the left, the description's punctuation on the wrong side.
- `after-monitors-fa.png`: this branch. `<html lang="fa" dir="rtl">`: the side menu, the
  breadcrumbs, the table and its row actions, the filters and the pagination read from the right.
  Ctrl K stays Ctrl then K.
- `after-monitors-de.png`: German, laid out exactly as before.
- `after-monitor-fa.png`: a monitor. Refreshed at, how long it has been operational and the
  uptime windows (24 hours, 7 days, 30 days) in Persian digits; the uptime history strip still
  runs from the oldest day at the left. The percentages are still Latin digits (a follow-up).
- `after-monitors-fa-390.png`, `after-monitors-fa-dark.png`: a phone, and the dark theme.
- `after-sign-in-fa.png`: the sign-in page in Persian: each way to sign in has its icon at the
  start of its words, Forgot password at the end of its line.
- `after-status-page-fa.png`, `after-status-page-fa-390.png`: a status page in Persian, its uptime
  bars from the oldest day at the left, its incident's English paragraph left to right.
- `fixture-fa.png`, `fixture-fa-dark.png`, `fixture-fa-side-panel.png`: the switch, the status dot,
  a table whose Actions column sticks at its end, notes in the viewer and the editor, a folded
  section, a side menu, pagination, arrows, code and a date, and a side panel at the left.
