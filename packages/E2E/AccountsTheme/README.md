# Sign-in pages theme

Run `npm run test-accounts-theme-ui` from `packages/E2E` after installing its and
`Common`'s dependencies and Playwright Chromium.

This suite serves the real sign-in pages: Accounts' own `views/index.ejs`, rendered
the way the App server renders it - its first script is Common's theme partial,
`Common/Server/Views/Partials/Theme.ejs` - and Accounts' own app (`src/Index.tsx`),
with only what the pages ask a server answered (`Fixture/MockApi.js`,
`Fixture/Data.js`). It needs no database or running OneUptime services. The fixture
listens only on `127.0.0.1:4346`, or on the port in `ACCOUNTS_THEME_FIXTURE_PORT`
for a second copy running at the same time.

The person's theme is what their browser keeps under `oneuptime-dashboard-theme`
(Light, Dark or System, picked in the Dashboard's user menu) and how their device is
set: the spec keeps a pick before a page opens and emulates the device's
`prefers-color-scheme`. Their language is what the footer's switcher keeps under
`oneuptimeLang`. The query string sets what the server answers, and is kept for the
visit, so a move to another page of the app keeps it: `ssorequired=1`,
`providers=<n>` and `projectsso=1` (the whole server requiring single sign-on),
`lookup=found` (an email's projects have providers), `firstaccount=1`,
`signup=verify|sent` (a sign-up held until its email is verified, or a link sent to
an address that has an account), `signin=wrong|methods|totp|enrol|codes|nocodes` (what a password sign-in is
answered, and its second step), `verify=failed`, `mcp=read|write|loopback|noprojects|error`,
`market=ready|error`, `form=ok|missing` and `brand=name|logo|logos` (an installation
with a name of its own, a logo for light backgrounds only, or logos for both). The
server's `/hold` and `/release` hold Tailwind and the app's bundle back, so a test can
look at a page as the browser has it before anything but the template has run.

It checks that the theme is drawn before the first paint (a pick of Dark, nothing
picked on a dark device, a pick of Light on a dark device, a public form); that a
page follows the device while it is open when nothing or System was picked, keeps
Light and Dark, and draws a pick made in another tab; that a public form is light
whatever was picked; that every page, and the states a person meets on it - a wrong
password, the second step, its backup codes and the offer of some, single sign-on
with providers to pick, the whole server requiring it, the master admins' page,
sign-up and the "check your inbox" screen after it, the password and email pages, an
MCP client asking for access, a marketplace purchase, signing in to the mobile app,
and the pages for a wrong link - leaves no light box on the dark page and keeps its
words at 4.5:1 on what is behind them, at 1280 and 390 pixels, nothing wider than a
phone; the same pages light, as before; the sign-in, single sign-on and sign-up pages
in German and Persian; that the footer sits on the dark page's own ground with its
language picker centred under its links on a phone, a state icon's halo is a faint
ring of its own colour and the backup codes' one action is as wide as the card's
content; and an installation's only logo on a light plate on a
dark page. Screenshots of every page in both themes are saved under
`output/playwright/accounts-theme-ui`.

This checks real browser rendering and the pages' theme handling; the API, the
database and the deployed app's routing are outside this fixture.
