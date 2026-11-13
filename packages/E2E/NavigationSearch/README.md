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

`RecentProducts.spec.ts` covers the menu's Recently visited row, which shows
six products: two full rows of three cards on a desktop, three rows of two
from 768px to 1023px (the dialog opens from 768px up, so it runs on the
desktop project only). Seven products opened one after another leave the six
before the last in the row on the last one's page; on a page low in the list
(Teams) the menu opens at the top with the row in view and the cursor on its
first card, which Enter opens; on an Essentials product's page that
product's card stays fainter than the cursor's, in the light theme and in
the dark (the spec adds the Dashboard's `Theme.css` and toggles
`html.dark`); the arrow keys move between the two rows and
on to the Essentials; a list of five remembered before the row grew still
shows and grows past five; another project's products and the Admin
Dashboard's pages remembered in between are skipped while the row still
fills; the browser keeps twenty addresses at most; and the Dashboard's own
navbar (`?navbar=true`) names the row Recently visited and opens it at the
top without a console error. The tests that check where the menu opens open
it twice first: the fixture's Tailwind runtime draws a class only once it is
on the page, as a page in use already has.

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

`HeaderAtTabletWidths.spec.ts` covers the top of every Dashboard page from
768px to 1023px (#7037), on the desktop project. The fixture's
`?header=true` page (`HeaderFixture.js`) renders the production header and
navbar in a project named Acme Commerce Production, with the bell's counts
and Search's and Ask AI's toggles answered in the page
(`window.__headerFixture` counts them), production's Inter and Vazirmatn
fonts and `Theme.css`; add `lang=de` or `lang=ar` for German or Arabic and
`theme=dark` for the dark theme. Each test opens the page once and resizes
the window. At 768, 900 and 1023px the header shows Search and Help, leaves
Ask AI to Search, draws no phone menu, keeps every entry on one row inside
the window with nothing over anything else and no sideways scroll, and Help
opens to Quickstart, How OneUptime works (which opens its dialog) and the
Glossary (a new tab on `/docs/en/introduction/glossary`). Search's button
opens Search; at 1024px the desktop rail keeps its order; at 767px the
phone's menu carries Search and Help and widening to 768 hands them back to
the header. In German the project picker keeps at least 160px and no entry
of the Help menu is cut ("So funktioniert OneUptime" was, at the menu's old
16rem); in Arabic the header reads right to left and the menu opens inside
the window; in the dark the menu is drawn dark. Help's menu and the profile
menu are each named by their own button (no id twice on the page), open with
Enter, and Escape puts them away with the focus back on the button.
Screenshots are saved as `header-*.png`.

`ProjectProducts.spec.ts` covers products that fit the project and pins
that follow the person (issue #6814). The Dashboard's navbar asks the API
for the project's products (`/api/project-products`): the fixture's page
names its own server as the Dashboard's host, so the request stays on the
page's origin, and the server answers it with nothing hidden and nothing
pinned. The spec answers it itself with a project that hides the container
and cluster products and pins Status Pages and Incidents, records every
write and answers it as the server does. It checks that the pins sit right
of Products in their order and open their product, as the current page on
it; that a card's pin in the menu shows when the card is pointed at, pins
without opening the product and tells the server, and unpins; that with
five pinned a sixth card's pin cannot be pressed and says why; that five
pins and their names fit the bar at 1280px and are icons that still name
their product at 1024px; that the hidden products are the menu's last row,
More products, with the note that Search still finds them (and the link to
choose products only for those who may), and that Search finds and opens
one; that a card names the plan a product needs and says when one is not
set up; and that a phone's menu lists the pins under Home and the hidden
products last. `?products=true` draws Project Settings > Products under
Home's card for hidden products that have data: a switch for every product
by its menu section (Users, Teams and Project Settings always shown), a
switch that hides a product at once and says Saved, Show Every Product, the
card's Show It, and no sideways scroll on a phone. Every page but the
header's takes `?lang=de` or `?lang=ar` too: in German five pins still fit
the bar at 1280px, in Arabic the pins sit after Products, to its left, and
in the dark theme a pin is drawn as Home is. Screenshots are saved under
`output/playwright/navigation-search/products`.

For manual inspection, run `node NavigationSearch/server.js` and open
`http://127.0.0.1:4242/dashboard/00000000-0000-4000-8000-000000000001/home`.
The server builds before listening; restart it after changing source files.
