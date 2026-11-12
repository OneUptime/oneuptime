# Systemd unit kinds, a DeploymentConfig's Rollout Status (i), Last seen on two lines

How these were made: the real page components in headless Chromium (Playwright's
chrome-headless-shell), with the dashboard's own Tailwind runtime, Theme.css, and the Inter and
Vazirmatn fonts production loads, at 2x. The data layer is stubbed; the locale files are the
real ones, loaded into i18next with dates written in the reader's language. Every `before-*`
image is the same page with main's files (379fe9d52f) built in, rendered the same way.

- The Systemd Units list renders `Pages/Host/View/SystemdUnits.tsx` with twelve units, one of
  every kind systemd defines. The unit page renders `Pages/Host/View/SystemdUnitView.tsx`.
- Last seen renders the repository's Topology fixture (`packages/E2E/Topology/Fixture.js`,
  dataset `selfHostedLegacy`, Show inactive on, the oneuptime-app group open) with the clock
  at 2026-11-06, so the oldest hosts were last seen 60 to 86 days ago. The crops are the
  right-hand table at a 1280px window, where the pane is 608px wide.

## Systemd unit kinds (#6731)

- `before-systemd-units-de.png` / `after-systemd-units-de.png`: German. Before, the Type column
  read Dienst, Gerät, Ziel and Geltungsbereich beside Path, Socket, Timer, Swap and Slice: a
  kind was looked up when the locale had a word for it and left in English when it did not.
  After, every kind is written as systemd writes it, as code.
- `before-systemd-units-ar.png` / `after-systemd-units-ar.png`: Arabic. Before: الخدمة, الجهاز,
  القيمة المستهدفة (a target value) and نقطة التحميل beside Path, Socket and Timer. After:
  the kinds as written, the same chip on an Arabic page.
- `after-systemd-units-fa-dark.png`: Persian, dark theme.
- `after-systemd-type-filter-de.png`: the Type filter offers the kinds as the column shows them,
  each with "1 Einheit" under it, and the bar reads "Einheiten durchsuchen..." and "12
  Einheiten" (English in 14 languages before the review).
- `before-systemd-unit-fa.png` / `after-systemd-unit-fa.png`: a .mount unit's page in Persian.
  Before, the Unit Type tile read اتصال (a connection) and the chip under the name "Type:
  Mount" in English. After: `mount` in the tile, at the tile's right like the figures beside
  it, "نوع: mount" and "آخرین نمونه: اکنون" in the chips, and "فعال در ۳۹ از ۴۰ نمونه" under
  Availability, in Persian digits.
- `before-systemd-unit-de.png` / `after-systemd-unit-de.png`: a .target unit's page in German.
  Before: Ziel in the tile and "Type: Target", in English, in the chip. After: `target` in the
  tile, "Typ: target" and "Letzte Messung jetzt" in the chips, "aktiv in 39 von 40 Messungen"
  under Availability.

## Last seen on two lines (#6693)

- `before-last-seen-de-1280.png` / `after-last-seen-de-1280.png`: German. Before, "Inaktiv ·
  vor 83 Tagen" on one line made the table 612px in a 608px pane. After, the status on one
  line and the age under it: the column is 126px instead of 172px and the table fits.
- `before-last-seen-ru-1280.png` / `after-last-seen-ru-1280.png`: Russian. Before, the table
  was 695px and the age was cut off at the pane's edge ("83 дня на"). After, every age is whole
  and the table is 622px: the other columns' Russian headers take the rest, so the pane scrolls
  14px to the row's chevron.
- `after-last-seen-ar-1280-dark.png`: Arabic, dark theme.
