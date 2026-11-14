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
database or running OneUptime services. The fixture listens only on `127.0.0.1:4404`, or
the port `DASHBOARD_WIDGET_SORT_FIXTURE_PORT` names (its server, the config and the
spec all read it).

The dashboard (`Fixture/Boards.js`) has a widget of each way a list or a table sorts: a
monitor list (a status by its priority, with one monitor whose monitoring is off and one
archived monitor among its rows), a pod list (a phase read rank by rank), an
incident list (a severity by the project's order), the security events list
(ClickHouse), a trace table (groups the server ranks) and a metric table (rows the
widget sorts itself). Its public copy shows the monitor and pod lists. Every list read
is answered as the database answers it - filtered by the conditions it names, ordered
by the order it asks for (nested fields, `nulls: "LAST"` and Postgres's own null
placement), cut to its limit - and recorded, so a test reads both what the widget
asked for and the rows it drew. The public fixture orders a list the way the public
route does: from the stored widget and the visitor's `widgetSort`, through the same
registry (`Common/Utils/Dashboard/DashboardWidgetSorts`), kept to the rows the route's
policy keeps it to (a monitor list's query from
`Common/Utils/Dashboard/MonitorListWidgetFormat`). Saves are kept for the tab,
so a reload opens what was saved. `?theme=dark` and `?lang=de` set the theme and the
Dashboard's words, and `?view=honeycomb` draws the monitor list as a honeycomb.

Desktop (1280px) Chromium covers: a list opening in its own order with every sortable
column a header and the sorted one marked (aria-sort, an arrow, a hint); Status sorting
the whole list worst first, best first, then back to by name, with the read's order and
the pick kept in the browser; a monitor whose monitoring is off saying Disabled in gray
and coming after every monitor that is checked whichever way Status sorts, and an
archived monitor never listed (#6476, #6477), inside OneUptime, in German and on the
public dashboard; a reload keeping the pick, for that widget only; a pod
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
on the public dashboard, the visitor's sort travelling as `widgetSort` with the
server reading a pod list's phases rank by rank; and a honeycomb tile's tooltip
(`?view=honeycomb`, #6966): the gray tile of the monitor whose monitoring is off saying
Disabled in a tooltip drawn on the page beside it, outside the widget's card, with nothing
covering it, in the dark theme and in German, and on the board while the board is in full
screen, gone once it leaves full screen; and the gray tile reached with Tab: ringed in the
theme's focus color, named for its monitor and described by its tooltip, which Escape puts
away while the focus stays on the tile. Phone (Pixel 5, 390px) Chromium runs what a phone
changes: reaching and pressing the headers, inside OneUptime and on the public dashboard,
and the honeycomb's tooltip in a phone's window, in the light and the dark theme. Screenshots are under
`output/playwright/dashboard-widget-sort-ui`.

Each widget is drawn once, at its own size: every frame the page paints is recorded
from its first (`SuiteHelpers/DrawnBoxes`), and each widget and the board must be drawn
at one size and in one place in all of them, with no animation on them, and the empty
board ("No widgets yet") never - at 1280 beside the side menu (both boards), at 1440, in
a 1600px window, on the public dashboard and on a phone. The board used to draw every
widget a few pixels across and grow it to its size with its rows already in it, so the
checks above that read a table as its rows show now read it once. A window resized while
viewing - narrower, wider, under the side menu's breakpoint and back - must draw the
widgets ending where the board's grid ends in every frame. And the page must raise no
error event on the window, "ResizeObserver loop completed with undelivered
notifications" among them: the board once laid its widgets out inside its observer's
call, where the side menu's observer of the page's body shared the frame.

Leaving a board being edited (#7173), at 1280: the side menu's other pages and the
breadcrumbs' addresses open a stand-in that says only where it is (`fixture-elsewhere`).
A board opened for editing and not changed stops editing at the toolbar's Cancel and is
left by the side menu at once, with no question. With a widget added and not saved,
leaving asks "Leave without saving?" (Keep Editing, Discard Changes): by the side menu,
where Keep Editing keeps the board as it was being edited, and by the browser's Back,
which the board takes back before the router moves - Keep Editing stays, Discard Changes
goes to the page before it with nothing saved. The toolbar's Cancel then asks in the same
voice, "Discard unsaved changes?", and Keep Editing there keeps the board too. A reload
raises the browser's own question while the change is unsaved, and staying keeps the
board as edited; after Save Changes a reload asks nothing and opens the board as saved,
and the side menu leaves at once. Screenshots of both questions are saved with the
others.

This checks real browser rendering and the widgets' handling of their sorts; the API,
the database and the deployed app's routing are outside this fixture (the public
route's order is tested against Postgres in
`Common/Tests/Server/Services/DashboardWidgetSortPostgres.test.ts`).
