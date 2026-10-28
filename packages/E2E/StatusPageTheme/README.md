# Public status page theme

Run `npm run test-status-page-theme-ui` from `packages/E2E` after installing its and
`Common`'s dependencies and Playwright Chromium.

This suite serves the real public status page: its own `views/index.ejs`, rendered
with the theme head the page servers hand it (`getStatusPageThemeHead`), and its own
app (`src/Index.tsx`), with only the status page API answered from fixture data
(`Fixture/MockApi.js`, `Fixture/Data.js`). It needs no database or running OneUptime
services. The fixture listens only on `127.0.0.1:4341`, or on the port in
`STATUS_PAGE_THEME_FIXTURE_PORT` for a second copy running at the same time.

The page answers at its OneUptime address, `/status-page/<id>` (the Dashboard's
preview), where most tests open it, and at `/`, as if the fixture's host were its
custom domain. The query string sets the page: `theme` (`Light`, `Dark` or
`System`), `seoTheme` (the theme the HTML is sent in when it differs from the page's
own, `none` for a failed lookup), `private=1` (a page only signed-in readers see),
`sso=1` and `darkLogo=1` (a page with a logo made for the dark theme too,
`Fixture/logo-dark.svg`). The server's `/hold` and `/release` hold Tailwind and the
app's bundle back, so a test can look at the page as the browser has it before
anything but the template runs.

Desktop and mobile Chromium cover each theme as a visitor first sees it, the theme
applied before the first paint, a System page following the device live, the
visitor's switch in the footer and what their browser remembers of it, and the dark
theme on every surface: no light box on the overview, the incident list and an
incident, an announcement, the maintenance list and an event, the subscribe form,
the private sign-in page, its SSO page (whose one provider the fixture's server
lists over HTTP, as the page's ModelList reads it) and the not-found page; the SSO
page's way back to the password form, lined up under its providers, and its SAML and
OpenID Connect providers as one evenly spaced list, each chosen from the keyboard; status
text at 4.5:1; the very dark
red of a long outage's bar with an edge; the logo on a light backdrop whenever a Dark
page or one that follows the device is dark, and the logo made for the dark theme
drawn instead, on nothing, where the page has one; no switch on a Light or Dark page
on its own domain, and on the Dashboard's preview a switch on every page, whose pick
lasts for the visit and is kept nowhere; the overall status banner's words in white
on the status colour, in both themes; and the footer's language and theme controls
centred on a phone, around a switch a thumb can hit. Screenshots of every surface are
under `output/playwright/status-page-theme-ui`.

This checks real browser rendering and the app's theme handling; the API, the
database and the deployed app's routing are outside this fixture.
