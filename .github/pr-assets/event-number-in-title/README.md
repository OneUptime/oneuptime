# The number before the title (#5406, block 30)

How these were made: the production incident, alert and scheduled maintenance layouts (ModelPage,
Page, Breadcrumbs, the side menu) bundled by `packages/E2E/EventOverview/Fixture/server.js` and
`packages/E2E/EventNotes/Fixture/server.js`, and the Incidents list's row dialogs by
`packages/E2E/ModelTables/Fixture/server.js`, drawn in headless Chromium with the Dashboard's
Tailwind runtime and the Inter font, 2x, clipped to the trail and the heading. Every record is
fabricated (`?numbers=prefixed` numbers them as a new project does: INC-1042, ALT-311, SM-58;
`?numbers=custom` with long prefixes of the project's own: CHECKOUT-INC-1042, DB-MAINTENANCE-58).

`before-*` is master at 4d25f0896c, built the same way with this branch's fixture (master's has no
`?numbers=`). `builder-*` is this PR before its UI review. `after-*` is this PR as merged.

- `before-incident-1280.png` / `after-incident-1280.png`: the maintainer's screenshot. Before:
  "Incident - Checkout API p95 latency above 2s", no number anywhere above the page. After:
  "INC-1042 Checkout API p95 latency above 2s", the number gray, in the heading, the trail and
  the browser tab.
- `before-same-title-1280.png` / `after-same-title-1280.png`: incident #1017, an earlier incident
  of the same monitor with the very same title. Before, its page read exactly like #1042's.
- `before-incident-390.png` / `builder-incident-390.png` / `after-incident-390.png`: a phone. The
  heading runs on after the number, two lines at most. The review makes the trail's crumb the
  number alone on a phone ("Project > Incidents > INC-1042"): the heading right under it names
  the incident whole, and the title cut short on a line of its own was a second, shorter copy.
- `before-notes-390.png` / `builder-notes-390.png` / `after-notes-390.png`: a page under the
  incident (Public Notes) on a phone. The trail takes two lines instead of three.
- `builder-long-prefix-320.png` / `after-long-prefix-320.png`: a long prefix of the project's own
  on a 320px phone. The builder held the number to the title's first word with a no-break space;
  the two did not fit on one line, and the line broke inside the word ("CHECKOUT-INC-1042 Che" /
  "ckout API ..."). After: the title starts on the next line, whole.
- `after-notes-1280.png`: from 640px the crumb shows the number and the title, cut short at the
  title's end; the heading is one line.
- `after-incident-dark-1280.png`, `after-alert-de-1280.png`, `after-incident-fa-390.png`,
  `after-maintenance-768.png`: dark, German, Persian right to left (the number starts the heading
  on the right), and a sentence-long title with a long prefix beside the side menu at 768.
- `after-change-state-dialog.png`, `after-delete-dialog.png`: a row's Change State and Delete on
  the Incidents list name the incident by its number first.
