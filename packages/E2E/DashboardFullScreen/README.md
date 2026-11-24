# A dashboard shown full screen

Run `npm run test-dashboard-full-screen-ui` from `packages/E2E` after installing its,
`Common`'s, `App`'s and the Dashboard's dependencies and Playwright Chromium.

This suite covers a dashboard shown full screen (issue #10409): the dashboard alone, over
the whole window, with nothing of OneUptime around it - its toolbar and its widgets, every
control of both still working - addressable by its URL (`?view=full-screen`), so it opens
in a tab of its own. It runs the real Dashboards routes (`Routes/DashboardRoutes`: the
Dashboards list and a dashboard's page, with its layout, side menu and breadcrumbs) inside
the real master page (`Common/UI/Components/MasterPage`) with a stand-in header, product
bar and footer, a stand-in for the app's own layers beside the routes in its `<main>`
(Ask AI's pill) and the app's notes beside the app in its root (`ToastRegion`), as
`src/Index.tsx` and `App.tsx` draw them, with only `ModelAPI`, `AnalyticsModelAPI` and `API`
answered from fixture data (`Fixture/AppFixture.js`). `Fixture/server.js` bundles it with
the app's esbuild config. It needs no database or running OneUptime services, and listens
only on `127.0.0.1:4877` (`DASHBOARD_FULL_SCREEN_FIXTURE_PORT` moves it).

The project (`Fixture/Boards.js`) has three dashboards: **Production overview** and
**Kubernetes clusters**, the product's Metrics Dashboard template saved on Past 1 Day and
Past 1 Hour, with its `service` variable and log stream, and **Team notes**, with no widget
yet. The fixture keeps each dashboard's saved config for the browser, so a save followed by
a reload or a new tab shows what was saved. `?role=viewer` signs in a Viewer, `?lang=de`,
`?lang=ja` and `?lang=fa` set the Dashboard's words, and `?theme=dark` the dark theme. Any
read the fixture does not model, and any script error, in the page or in a tab it opens,
fails the test. A test that needs a browser with no full screen of its own (a phone that
keeps it for videos) takes the Fullscreen API away before the page loads.

Desktop (1280px) Chromium covers: **Full Screen** on the toolbar covering the window edge
to edge, the header under it and inert, the toolbar's time range, auto-refresh and variable
there, the address naming it, and the browser asked for its own full screen from the press;
**Exit Full Screen** bringing the page back and leaving the browser's full screen, the focus
back on **Full Screen**; the browser's own Escape (leaving its full screen) bringing the
page back too; Escape bringing it back where the browser has no full screen, and an open
menu taking the first Escape; **Full Screen** and **Exit Full Screen** in the ⋯ menu, which
also offers **Open in New Tab**; the address alone opening it full screen, **Fill the
Screen** asking the browser there, and the browser's Escape then leaving only its own full
screen; a reload keeping it full screen; **Open in New Tab** from the toolbar's ⋯ menu
(the same dashboard, on the range this tab shows, full screen in a tab of its own, this tab
left as it was, and the way back in that tab) and from a row's ⋯ menu on the Dashboards
list (first in the menu); editing full screen (a widget added, one removed with **Delete
Widget**, the board saved, the save's note over the view and in reach); the time range
(every widget reading the new window), auto-refresh (the widgets reading again on the
interval) and the `service` variable working full screen and going in the address beside the
view; a Viewer full screen (**Edit Dashboard** locked); the page behind out of reach (its
header, product bar and footer inert, Tab never landing on them) while Ask AI's pill and
the notes stay in reach; and a dashboard with no widget offering its editor **Add Widget**
full screen. Both widths cover the dark theme (full screen and editing), German and Persian
(laid out right to left, the way back at the row's end). Phone (Pixel 5, 390px) Chromium
runs what a phone changes: full screen filling the window with nothing running sideways,
**Exit Full Screen** a square button that keeps its name, the toolbar's controls and its ⋯
menu on the screen, editing, and **Open in New Tab** from a row's ⋯ menu. Screenshots are
under `output/playwright/dashboard-full-screen-ui`.

This checks real browser rendering and the page's handling of its address, its keys and the
browser's full screen; the API, the database and the deployed app's routing are outside this
fixture.
