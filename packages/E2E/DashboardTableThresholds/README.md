# Dashboard table thresholds

Run `npm run test-dashboard-table-thresholds-ui` from `packages/E2E` after installing its,
`Common`'s, `App`'s and the Dashboard's dependencies and Playwright Chromium.

This suite covers a dashboard's metric tables colored by thresholds (issue #5231) on both
of a dashboard's surfaces:

- the dashboard inside OneUptime: the real view layout (`Pages/Dashboards/View/Layout`)
  around the real Dashboard page, with only `ModelAPI`, `AnalyticsModelAPI` and `API`
  answered from fixture data (`Fixture/AppFixture.js`);
- the public dashboard: its own `views/index.ejs` and its own app, with only the public
  dashboard API answered (`Fixture/PublicFixture.js`).

Both are bundled with the app's esbuild config by `Fixture/server.js`. It needs no
database or running OneUptime services. The fixture listens only on `127.0.0.1:4452`.

The dashboard (`Fixture/Boards.js`, Past 1 Hour) has the tables the customer described,
CPU, memory and disk per host: **Host saturation** (Colored text) and **Fleet at a
glance** (Colored background), grouped by `host.name`, with CPU and Memory in use sent as
fractions of 1 and colored at 80 and 90, Free disk (a percent) where lower is worse at 20
and 10, and Load with no thresholds; and **CPU over time**, one row a bucket. Every metric
read is answered as OneUptime's metrics API answers it, newest bucket first, and each
host's older buckets with a lower reading, so a table that reduced the wrong way would
draw the wrong colors. The fixture's readings are on the page's record, and the suite
works out every cell from them with the same rules the widget uses
(`Common/Utils/Dashboard/TableThresholds`). A save is kept for the tab, so a reload opens
what was saved. `?theme=dark`, `?lang=de` and `?lang=fa` set the theme and the
Dashboard's words.

Desktop (1280px) Chromium covers: every cell of both host tables colored as the rules read
the number on screen (a fraction shown and compared as a percent, 79.96% at one decimal
reading 80.0% and a warning, a missing reading a dash); a warning amber with a triangle and
a critical value red and bold with a circle, each saying the threshold it reached, the
shape before the number; Colored background filling the cell; the table over time; every
value at 4.5:1 in the light and the dark theme; German; Persian, laid out right to left;
and the settings - a column's thresholds and the table's Threshold colors (choice rows,
each with a picture of a warning and a critical cell) drawn in the Live Preview as they
change and kept by Save Changes and a reload, Lower is worse on a percent column still at
80 and 90 starting it at 20 and 10, the levels under the fields lined up with them, a
column with no thresholds asking for a value, the card in the dark theme and German, and
the card in a window 390px wide, its fields stacked. Phone (Pixel 5, 390px) Chromium runs the board: a
dashboard is edited on a laptop. Both run the public dashboard, Light and Dark. Screenshots are under
`output/playwright/dashboard-table-thresholds-ui`.

This checks real browser rendering and the widget's handling of its readings; the API,
the database and the deployed app's routing are outside this fixture.
