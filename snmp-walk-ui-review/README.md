# A device's SNMP Walk page, after the UI review

How these were made: the real device page (`NetworkDeviceViewLayout`: the page header, breadcrumbs
and the device's side menu) around the real SNMP Walk page, bundled with the Dashboard's esbuild
config and rendered in headless Chromium with the model APIs answered from memory, the Dashboard's
Tailwind runtime, `Theme.css` and the Inter font, at 1x. `before-*` is the page as the builder's
branch drew it (6501c3fdd1), rendered the same way. They are not screenshots of a running stack;
every device, probe and value in them is made up.

- `before-768-side-menu.png` / `after-768-side-menu.png`: a 768-pixel window. The side menu leaves
  the results 430 pixels, and the four-column table switched on at the window's `md` anyway, so the
  OID and value columns were a few letters wide. The rows now follow the results' own width (a
  container query): cards below 44rem, the table from there.
- `before-1280-rows.png` / `after-1280-rows.png`: a laptop. Collected is a badge beside the OID's
  name, and the action column holds one button-styled step: Collect, or Alert on it. The columns are
  one grid with subgrid rows; "Show all" sits under a long value.
- `before-390-de.png` / `after-390-de.png`: German on a phone. The row's action moved under the
  value, so names, OIDs and hints have the row's width.
- `before-1280-refused.png` / `after-1280-refused.png`: a walk the device refused. When it ran reads
  first, then why it read nothing; a divider separates the form from the results.
- `after-1280-collect-in-row.png`: what Collect came to, said in the row it was pressed in.
- `after-390-dark.png`: the page on a phone in the dark theme.
