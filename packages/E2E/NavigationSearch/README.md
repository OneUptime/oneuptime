# Navigation search browser regressions

From `packages/E2E`, run `npm run test-navigation-search-ui`. Use
`-- --project=chromium` for desktop Chromium only. Dependencies and the
Playwright Chromium browser must be installed first.

The fixture builds the production `NavBarMenuModal` and Dashboard navigation
catalog with the actual English translations. It supplies a synthetic project
URL and a router, so filtering, keyboard handling, links and recent products
run without authentication, Docker or a database. It does not render the
destination pages or test API authorization.

The suite covers RUM/k8s, case and surrounding whitespace, title and description
matches, clearing, empty states, keyboard/click navigation, and recent products
on desktop and mobile Chromium. Artifacts are saved under
`output/playwright/navigation-search`.

For manual inspection, run `node NavigationSearch/server.js` and open
`http://127.0.0.1:4242/dashboard/00000000-0000-4000-8000-000000000001/home`.
The server builds before listening; restart it after changing source files.
