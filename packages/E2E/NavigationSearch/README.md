# Navigation search browser regressions

From `packages/E2E`, run `npm run test-navigation-search-ui`. Use
`-- --project=chromium` for desktop Chromium only. Dependencies and the
Playwright Chromium browser must be installed first. The fixture listens on
port 4242; set `NAVIGATION_SEARCH_PORT` to run a second checkout beside it.

`CommandPaletteSearch.spec.ts` drives the Dashboard's Search (Cmd/Ctrl+K)
on its own (`?palette=true`): the production palette, page index and
products catalog. It checks that a page is found by its menu name and opened
with Enter (API Keys under Project Settings › Advanced), that pages sharing
a name read differently and the product's name narrows them, that the words
Search knows find their page (`rota`), that Delete Project is not offered to
a user without the permission while the Danger Zone page is, that browsing
lists actions and products rather than every page and a page opened from
search comes back under Recent, that the arrow keys walk the results, and
that a breadcrumb never scrolls the page sideways on a phone. Record search
requests are answered with empty lists.

The fixture builds the production `NavBarMenuModal` and Dashboard navigation
catalog with the actual English translations. It supplies a synthetic project
URL and a router, so filtering, keyboard handling, links and recent products
run without authentication, Docker or a database. It does not render the
destination pages or test API authorization.

The suite covers RUM/k8s, case and surrounding whitespace, title and description
matches, clearing, empty states, keyboard/click navigation, and recent products
on desktop and mobile Chromium. Artifacts are saved under
`output/playwright/navigation-search`.

The fixture opens the menu the way the Dashboard does: every section a row
of one list, Essentials first and open, every other section folded to one
line. `ProductsMenuFolding.spec.ts` covers that in a real browser: Essentials
are a row of the same list, lined up with the others, open on every visit,
even after they were folded or where a fold of them was remembered, each
folded section is a single line that names its products, a click anywhere on
the line (not just on its name) opens it while focus stays in the search box,
the arrow keys move from the last row of Essentials to the first folded line
and Enter opens it, search finds products in folded sections, opened and
folded sections survive a reload, the section of the current page opens by
itself, and on a phone (`?navbar=true` at the Pixel 5 size) the menu toggle
lists the products the same way.

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
