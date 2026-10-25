# Text that can be translated: before and after

These images show the monitor overview and a workflow's Schedule trigger in German and
Persian, before this change (master) and after it. Each one is the real production
component rendered offline: the monitor overview by the `packages/E2E/MonitorOverview`
fixture, on synthetic data for a made-up "Acme Commerce" workspace (every name and domain
is fabricated), and the Schedule trigger's field on its own page. The language is loaded
from the Dashboard's own locale files and switched with i18next, as a reader's switch does;
dates follow it as every frontend's `i18n.ts` makes them. Captured at 2x with Inter, the
font production loads.

- `before-hero-de.png` / `after-hero-de.png`: an API monitor whose checks are overdue, in
  German. Before, the hero read English with German durations glued in ("Operational for 3
  Tage", "No result for 38m"). After, every sentence is German, the status reads as its
  badge does ("Betriebsbereit"), and the duration stays in the case Intl writes it in.
- `after-hero-de-390.png`: the same on a phone.
- `after-hero-de-ssl-dark.png`: an SSL certificate monitor in German, dark: the monitor type
  ("SSL-Zertifikat") and the expiry ("in 23 Tagen", "14. Okt. 2026").
- `before-hero-fa.png` / `after-hero-fa.png`: the overdue monitor in Persian. Its units are
  Persian words ("38 دقیقه"), never Latin "38m".
- `before-statbar-de.png` / `after-statbar-de.png`: the four numbers under the hero, for an
  offline monitor with an open incident and alert: downtime with German unit names, the open
  work's note in German, and "24 Stunden" kept on one line.
- `before-schedule-de.png` / `after-schedule-de.png`: a workflow's Schedule trigger on a
  custom weekday schedule: its next runs dated in German.
- `before-schedule-yearly-de.png` / `after-schedule-yearly-de.png`: the yearly common
  schedule: its name and its words in German, its date as German writes a date.
