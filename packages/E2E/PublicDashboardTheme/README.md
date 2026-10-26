# Public dashboard theme

Run `npm run test-public-dashboard-theme-ui` from `packages/E2E` after installing its,
`Common`'s, `App`'s and the Dashboard's dependencies and Playwright Chromium.

This suite serves the real public dashboard: its own `views/index.ejs`, rendered with
the theme head the page servers hand it (`getDashboardThemeHead`), and its own app
(`src/Index.tsx`), with only the public dashboard API answered from fixture data
(`Fixture/MockApi.js`, `Fixture/Data.js`). It needs no database or running OneUptime
services. The fixture listens only on `127.0.0.1:4351`.

Which dashboard a page shows is its id (`Fixture/Scenarios.js`): one Light, one Dark,
one System, one made before the setting, one of each theme behind a password (`open
sesame`), one the IP allowlist refuses and one whose link answers nobody. The query
string sets the rest: `board` (the widgets: `kubernetes`, `host`, `slo`, `network`,
`lists`, `containers`, `infrastructure` or `other`), `data=empty` (every widget's empty
state), `variables=1` (the toolbar's variable pickers) and `seoTheme` (the theme the
HTML is sent in when its server could not read the dashboard's, `none` for no theme).
The server's `/hold` and `/release` hold Tailwind and the app's bundle back, so a test
can look at the page as the browser has it before anything but the template runs.

Desktop (1280px) and phone (Pixel 5, 390px) Chromium cover each theme as a visitor
first sees it, the theme applied before the first paint (the link's `?theme=` and the
visitor's kept pick included), a System dashboard following the device live, the
visitor's Light / Dark / Auto menu (each choice's icon, the tick on the one in use, what
Auto says it gives) and what their browser keeps of it, a link's own
theme through the password prompt and back, the password prompt in the dashboard's
theme, Access Denied and not found following the visitor, and the dark theme on every
widget kind: no light box but the logo's backdrop, every text at 4.5:1 (3:1 when
large), the HTML widget transparent on the dark card, the empty states, and the
toolbar's menus and time range picker. Screenshots of every board in both themes, of
the prompt and of the error pages are under `output/playwright/public-dashboard-theme-ui`.

On a phone the page is the screen's width: the dashboard's name has the header's row,
the toolbar sits under it, and only the board, which keeps the 1000px its twelve
columns are laid out for, scrolls sideways in its own frame. The spec's `press`
explains how it reaches a control the visitor scrolls to.

This checks real browser rendering and the app's theme handling; the API, the
database and the deployed app's routing are outside this fixture.
