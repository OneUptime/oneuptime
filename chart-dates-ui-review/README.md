# Time range button and chart axes after the UI review (#7204)

How these were made: one page bundled with Common's esbuild config, the
Dashboard's Tailwind (with its reading-direction plugin), Theme.css and
Inter, drawing the real Common components: TelemetryTimeRangePicker in a
TableHeaderToolbar in a Card (as Session Replay's Users list has it), the
Logs explorer (LogsViewer) with a year-long custom range and no logs, the
incident time picker with its "Around this incident" windows (an incident
from November 2025, read on 12 Nov 2026), and three charts across the
night London's clocks go back (25 Oct 2026). Drawn in Chromium at each
width; the reader's zone is Europe/London and the browser's UTC unless
the name says otherwise.

Before and after:

- `header-en-390-before`, `header-en-390-after`: a custom range of a year
  in a table's card header on a phone. It ran 49px past the card's left
  edge; it is cut short now, the whole range in its tooltip.
- `explorer-en-390-before`, `explorer-en-390-after`: the same range in the
  Logs explorer's toolbar. It ran past the card's right edge.
- `moments-zh-TW-390-*`, `moments-ar-390-*`, `moments-ru-390-*`: the
  windows under "Around this incident" in Traditional Chinese, Arabic and
  Russian. They broke wherever the line ran out ("上 / 午05:44", "ص" or
  "05:44" alone on a line); they break between their two ends now.
- `years-fa-1280-before`, `years-fa-1280-after`: a chart of eight years,
  one bar a year, in Persian. Its years were in Latin digits ("2019")
  among Persian digits everywhere else; they are written as Persian
  writes a year ("۲۰۱۹") now. `years-ja-1280-after` and
  `years-ko-390-after`: the same in Japanese ("2019年") and in Korean on a
  phone ("2019년"), as those languages name a month's ticks.

As they are now:

- `header-de-768`: the German range whole at 768px.
- `header-en-390-dark-open`, `explorer-en-390-dark`, `moments-en-390-dark`:
  dark mode, with the list open.
- `charts-de-1280`, `charts-fa-1280`: thirty day slots across the clock
  change, one bar a day, and the hour the clocks go back as two slots,
  "01:00 BST" and "01:00 GMT", in German and in Persian (Persian digits).
- `charts-ar-390`, `charts-en-390-dark`: the same on a phone, in Arabic and
  in English dark mode, where the axis names fewer ticks.
- `charts-ny-1280`: the reader in New York with the browser in Tokyo: the
  slots step on New York's clock.
