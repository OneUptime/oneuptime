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

`ForeignHiddenRule.spec.ts` renders the real Dashboard navbar (`?navbar=true`)
in a page that also carries a foreign `.hidden { display: none }` rule, the
one Bootstrap 3 and HTML5 Boilerplate ship and that browser extensions and
user stylesheets inject. A customer lost the whole navigation bar to it: the
desktop row used `hidden md:flex`, and the foreign rule beat `md:flex` at
every width. The spec injects the rule four ways: `!important` and plain
(appended after Tailwind's generated `<style>`), each into an already-rendered
page and from the document's first load. It then checks that Home and
Products are visible, the products menu opens and choosing a product
navigates on desktop, and that the menu toggle opens the menu on mobile.
Before those checks, and again after navigating, each test adds two probe
elements, one with the pre-fix class and one with the fixed class (the navbar
row's own classes on desktop), and asserts that only the pre-fix probe is
hidden, so a test cannot pass because the injection silently failed. A
baseline test shows the pre-fix probe is shown when nothing is injected. The
phone layout never used the bare `hidden` class, so the mobile tests guard
against a future regression rather than reproduce the reported one. Run only
this spec with `npm run test-navigation-search-ui -- ForeignHiddenRule`.

For manual inspection, run `node NavigationSearch/server.js` and open
`http://127.0.0.1:4242/dashboard/00000000-0000-4000-8000-000000000001/home`.
The server builds before listening; restart it after changing source files.
