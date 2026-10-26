# Status pages and public dashboards side by side

Run `npm run test-side-by-side-pages-ui` from `packages/E2E` after installing its,
`Common`'s, the Status Page's and the Dashboard's dependencies and Playwright Chromium.

This suite serves the real public status page and the real public dashboard on one
host - each its own `views/index.ejs` and its own app (`src/Index.tsx`) - with only
their APIs answered in the page from fixture data (`Fixture/StatusPageMockApi.js`,
`Fixture/PublicDashboardMockApi.js`). It needs no database or running OneUptime
services. The fixture listens only on `127.0.0.1:4471`, or on the port in
`SIDE_BY_SIDE_PAGES_FIXTURE_PORT` for a second copy running at the same time.

Every status page answers at `/status-page/<id>` and every public dashboard at
`/public-dashboard/<id>`, as on an installation with no custom domains
(`Fixture/Pages.js`): two public status pages (one up, one in an outage), a private one
behind a password (`open sesame`), a dashboard shared with anyone who has the link and
two behind a password. Each has its own name, logo and resource, so what a tab draws
says which page it is drawing. Every request a tab makes is recorded on
`window.__sideBySideFixture` with the page its address names and the header the real
client would send (`status-page-id`, `dashboard-id`), and one the fixture does not
answer fails the test.

Two tabs of one browser - which share the host's storage, as the pages' visitors' tabs
do - each keep to the page their own address names (issue #5277): the status page's
minute-by-minute refresh (played on Playwright's clock), its navigation, its Subscribe
form and what it sends, its logo, a private page's password, another page's address
reached inside the app (opened in full, with that page's own name and content), and a
public dashboard's password beside another dashboard, public or behind a password of its
own. Screenshots of each tab are under `output/playwright/side-by-side-pages-ui`.

This checks the apps in a real browser, with real browser storage shared by real tabs;
the API, the database and the deployed app's routing are outside this fixture.
