# Dashboard time range and auto-refresh

Run `npm run test-dashboard-time-range-ui` from `packages/E2E` after installing its,
`Common`'s, `App`'s and the Dashboard's dependencies and Playwright Chromium.

This suite covers a dashboard's default time range and auto-refresh, and each viewer's
own picks (issue #5080), on both of a dashboard's surfaces:

- the dashboard inside OneUptime: the real view layout (`Pages/Dashboards/View/Layout`)
  around the real Dashboard page, with only `ModelAPI`, `AnalyticsModelAPI` and `API`
  answered from fixture data (`Fixture/AppFixture.js`);
- the public dashboard: its own `views/index.ejs` and its own app, with only the
  public dashboard API answered (`Fixture/PublicFixture.js`).

Both are bundled with the app's esbuild config by `Fixture/server.js`. It needs no
database or running OneUptime services. The fixture listens only on `127.0.0.1:4371`.

Which dashboard a page shows is its id (`Fixture/Boards.js`): the product's Metrics
Dashboard template saved on Past 1 Day refreshing every minute, saved before the
defaults (no time range, no auto-refresh) and saved on Past 1 Week with auto-refresh
off, and a new dashboard with no widget yet. Every metric read is answered with a repeatable curve over the window it asks for
and recorded with that window, so a test reads which time range the widgets used.
Saves are recorded with the config they wrote and kept for the tab, so a reload opens
what was saved. The query string sets the rest for the dashboard inside OneUptime:
`role=viewer` (a member who may not edit), `lang=de|ja|fa` and `theme=dark`.

Desktop (1280px) Chromium covers: each dashboard opening on its saved defaults, or on
the past hour with auto-refresh off; a viewer's range and interval remembered across a
reload and a fresh visit and written into the address (`?range=2d`, `?refresh=30s`);
"Default (...)", first in each picker, going back to the dashboard's own and forgetting
the pick; a link's `?range=` and `?refresh=` opening on its own values without becoming
the viewer's pick; a member who may not edit keeping their own picks; the editing row's
Default time range and Default auto-refresh saved with Save Changes and dropped with
Discard Changes; a save after the editor turned auto-refresh off while viewing
keeping the dashboard's own interval; and what the UI review measured: the time range
picker showing every range and Custom range with nothing scrolled out of sight, a custom
range's From above To inside the dialog, the editing row's menus showing every choice on
one line in German (and in German throughout), the editing row answering the keyboard
without a longer pick moving the board, no editing row on an empty dashboard, and in
Persian the menu under its button and the picker's rule between its panes. Phone (Pixel
5, 390px) Chromium runs what a phone changes: reaching the toolbar, the pickers, menus
and editing row at its width, and the picks they make. Screenshots of the toolbar, both
pickers and the editing row (dark, German, Persian) are under
`output/playwright/dashboard-time-range-ui`.

Both dashboards are 1000px wide, so on the phone their toolbars are past the screen's
right edge; the spec's `press` explains how it reaches them there.

This checks real browser rendering and the app's handling of the defaults and picks; the
API, the database and the deployed app's routing are outside this fixture.
