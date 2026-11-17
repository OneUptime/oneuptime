# Settings > License's revealed key: UI review

How these were made: the real Admin Dashboard (its MasterPage, header, side menu, breadcrumbs
and the Enterprise Edition's Settings > License page), bundled with the Admin Dashboard's own
esbuild settings and drawn in headless Chromium with Inter and Vazirmatn. Only the API is stood
in for: a valid license for a company with a long name, and a 40-character license key.

"Before" is the branch as it was built; "after" is the branch after the review.

- `license-key-phone-de-before.png`, `license-key-phone-de-after.png`: German at 390 px, the key
  revealed and copied. Before, the key's fact was cut to one line: the key lost its start and ran
  under a "...". Now it wraps inside its box, with Copy and Hide beside it.
- `license-key-fa-before.png`, `license-key-fa-after.png`: Persian at 1280 px, the key revealed.
  Before, the key pushed its box past the column, and Hide was cut off at the box's edge (the
  pointer is on Copy). Now the box keeps to its column, and Hide shows its name (the pointer is
  on Hide). The card title, the status and the key's label all say پروانه.
