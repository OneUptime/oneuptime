# The translation backlog's next pass: UI review

How these were made: the real Dashboard pages and components (the Campaigns page, a Ceph cluster's
OSDs page, the products menu) bundled with the Dashboard's own esbuild config - its runtime locale
chunks, so every language reads as it ships - and rendered in headless Chromium with the model
APIs answered from memory, the Dashboard's Tailwind runtime and the Inter font, at 2x. The AI
card's composer is the event overview fixture (packages/E2E/EventOverview). `before-*` is the
branch as the builder left it, rendered the same way. They are not screenshots of a running stack;
every address, host and count in them is made up.

- `before-campaigns-fa-390.png` / `after-campaigns-fa-390.png`: the Campaigns page in Persian on a
  phone. Before, every row's counts were English ("requests ۴۱۲", "requests got through ۳۲") and
  the IPv6 address read backwards ("db8:85a3::8a2e:370:7334:2001") and ran under View requests.
  After, the counts are Persian, and the address reads as written and wraps inside its column.
- `after-campaigns-de-390-dark.png`: the same page in German, dark, on a phone: "412 Anfragen",
  "32 Anfragen sind durchgekommen".
- `before-ceph-osds-fr.png` / `after-ceph-osds-fr-tooltip.png`: a Ceph cluster's OSDs in French.
  The cells said "Dans le cluster" while the page's description explained "In", and the (i) beside
  the column was English. After, both explain the cells' own words.
- `before-ai-composer.png` / `after-ai-composer.png`: the AI card's composer as the page opens.
  Its first line, the placeholder, sat half under the row below until something was typed.
- `after-products-menu-de.png`: the products menu in German: its AI section says KI, as the
  KI / LLM product beside it does.
