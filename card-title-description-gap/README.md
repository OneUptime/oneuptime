# Card title and description screenshots

Before and after frames for "There's a lot of gap between the title of the
card and the description of the card" - every table's and list's card header,
the stacked cards of an overview's one-third column, and a Security Events
connection's diagnostics.

Rendered from the real components in headless Chromium at a 2x device pixel
ratio, with the Dashboard's Tailwind build, `Theme.css` and Inter: the Runbooks
list in its real layout from the tables fixture (`packages/E2E/ModelTables`),
the incident and episode pages from the event overview fixture
(`packages/E2E/EventOverview`), and the diagnostics dialog from a harness that
mounts it alone. The "before" frames were rendered with master's `Card.tsx` and
`SecurityEventConnectionDiagnostics.tsx` swapped in, not re-implemented. Every
record in them is made up.

| File | Shows |
| --- | --- |
| `runbooks-1280-before.png` | The maintainer's Runbooks list at 1280px: the description 20px under "Runbooks", a button row's height down. |
| `runbooks-1280-after.png` | The same: the search, Create Runbook and the ⋯ centred on the title, the description 9px under it. |
| `runbooks-1024-before.png` | At 1024px beside the side menu the controls do not fit beside the title: they came between the title and its description, 48px apart. |
| `runbooks-1024-after.png` | The description stays 6px under the title and the controls follow it, at the right edge, over the filter chips. |
| `episode-columns-1280-before.png` | An episode page's two column-opening cards: Episode Details' description a button row under its title. |
| `episode-columns-1280-after.png` | Edit centred on "Episode Details", its description right under it, and the two titles level. |
| `incident-roles-1280-before.png` | Incident Roles in the incident page's one-third column: Refresh between the title and its description. |
| `incident-roles-1280-after.png` | The description right under the title, Refresh after it at the right edge. |
| `recent-runs-390-before.png` | A connection's diagnostics on a phone, Recent runs: the sentence a link's height under its heading. |
| `recent-runs-390-after.png` | Refresh history on the heading's line, the sentence 4px under the heading and across the dialog. |
