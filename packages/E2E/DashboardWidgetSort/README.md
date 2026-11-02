# Dashboard widget sort

Run `npm run test-dashboard-widget-sort-ui` from `packages/E2E` after installing its,
`Common`'s, `App`'s and the Dashboard's dependencies and Playwright Chromium.

This suite covers click-to-sort on a dashboard's list and table widgets (issue #5082),
on both of a dashboard's surfaces:

- the dashboard inside OneUptime: the real view layout (`Pages/Dashboards/View/Layout`)
  around the real Dashboard page, with only `ModelAPI`, `AnalyticsModelAPI` and `API`
  answered from fixture data (`Fixture/AppFixture.js`);
- the public dashboard: its own `views/index.ejs` and its own app, with only the
  public dashboard API answered (`Fixture/PublicFixture.js`).

Both are bundled with the app's esbuild config by `Fixture/server.js`. It needs no
database or running OneUptime services. The fixture listens only on `127.0.0.1:4404`.

The dashboard (`Fixture/Boards.js`) has a widget of each way a list or a table sorts: a
monitor list (a status by its priority), a pod list (a phase read rank by rank), an
incident list (a severity by the project's order), the security events list
(ClickHouse), a trace table (groups the server ranks) and a metric table (rows the
widget sorts itself). Its public copy shows the monitor and pod lists. Every list read
is answered as the database answers it - filtered by the conditions it names, ordered
by the order it asks for (nested fields, `nulls: "LAST"` and Postgres's own null
placement), cut to its limit - and recorded, so a test reads both what the widget
asked for and the rows it drew. The public fixture orders a list the way the public
route does: from the stored widget and the visitor's `widgetSort`, through the same
registry (`Common/Utils/Dashboard/DashboardWidgetSorts`). Saves are kept for the tab,
so a reload opens what was saved. `?theme=dark` and `?lang=de` set the theme and the
Dashboard's words.

Desktop (1280px) Chromium covers: a list opening in its own order with every sortable
column a header and the sorted one marked (aria-sort, an arrow, a hint); Status sorting
the whole list worst first, best first, then back to by name, with the read's order and
the pick kept in the browser; a reload keeping the pick, for that widget only; a pod
list reading its phases rank by rank; an incident list by severity and the security
events list in ClickHouse; a 6-unit incident list with long titles fitting its widget
(at 1440px, as below); a trace table asking the server to rank its groups and a
metric table sorting its own rows; the headers in the dark theme and in German; the
headers taking no more room than plain ones (`?board=narrow`: a 4-unit metric table
whose long header wraps and whose right-aligned column hangs its arrow before its words,
both inside the widget, and the security events list one line per event at 6 and 8
units, in a 1440px window, where the board's units are 70px or wider as a list's
default width was chosen on: the board fits its column now, and beside the side menu at
1280 its units are about 60px); the Sort setting saving the order everyone sees, kept
by Save Changes and a reload; a click on a header in the Live Preview setting the Sort;
and, on the public dashboard, the visitor's sort travelling as `widgetSort` with the
server reading a pod list's phases rank by rank. Phone (Pixel 5, 390px) Chromium runs
what a phone changes: reaching and pressing the headers, inside OneUptime and on the
public dashboard. Screenshots are under `output/playwright/dashboard-widget-sort-ui`.

This checks real browser rendering and the widgets' handling of their sorts; the API,
the database and the deployed app's routing are outside this fixture (the public
route's order is tested against Postgres in
`Common/Tests/Server/Services/DashboardWidgetSortPostgres.test.ts`).
