# What really uses a value (#5396, block 28)

How these were made: the production Dashboard pages and dialogs - the Incident Severity settings
page with its Archive, Delete and Bulk Actions > Delete dialogs, and User Settings > On-Call Rules -
bundled by `packages/E2E/ArchivableValues/Fixture/server.js` and drawn in headless Chromium with the
Dashboard's Tailwind runtime and the Inter font, at 1280 pixels wide (one at 390), 2x. The fixture
replaces only the API: two people with eleven on-call rule rows each for Minor, eleven people for
Critical, 12 incidents on Critical.

`before-*` is master at a633172b39, built the same way, with the fixture answering as master's
server did: every member's own on-call rules counted as the project's "Notification Rules", row by
row. `builder-*` is this PR before its UI review. `after-*` is this PR as merged.

- `before-archive-people-only.png` / `after-archive-people-only.png`: the maintainer's dialog. A
  severity nothing but people's own on-call rules use. Before: "These keep using it until you
  change them: Notification Rules (22)". After: one sentence about whose rules they are, that they
  stay and still page, and a link to your own (in a new tab).
- `builder-archive-settings-and-people.png` / `after-archive-settings-and-people.png`: the project's
  settings that keep using the value, then the people. The builder's "They stay as they are, so
  incidents with it still page them" read "They" as the people; the review names the rules.
- `before-bulk-delete.png` / `after-bulk-delete.png`: Bulk Actions > Delete of three severities, one
  of which 12 incidents have. Before: only the question; the server then refused Critical with
  "Please delete those records first". After: Critical is named with what has it, Delete skips it,
  and what deleting the other two changes - their people's on-call rules go with them.
- `after-bulk-delete-all-refused.png`: only Critical selected. Delete stays unavailable, and the
  dialog gives the way on.
- `builder-bulk-delete-result.png` / `after-bulk-delete-result.png`: the run's result. The builder
  listed the skipped severity as a red failure; the review lists it as skipped, with the reason.
- `before-on-call-rules-archived.png` / `after-on-call-rules-archived.png`: the archived
  "[DONOTUSE] Very critical" on your own On-Call Rules. Before: drawn like a live severity, with an
  Add the server refuses. After: last, tagged Archived, no Add, and a description that says what
  its rules still do.
- `after-on-call-rules-archived-fa-dark.png`: the same card in Persian, dark: the name keeps its
  bracket at its start.
- `after-archive-de-dark-phone.png`: the Archive dialog in German, dark, at 390 pixels.
