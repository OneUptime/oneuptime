# Postmortems browser coverage

The production-page browser suite runs without a OneUptime server:

```bash
cd packages/E2E
npm run test-postmortems-ui
```

`Postmortems/Fixture/server.js` bundles the real **Incidents → Postmortems**
list, an incident's **Postmortem** page and **Incidents → Settings →
Postmortem Statuses** with the Dashboard's esbuild config, Tailwind, theme and
font, over in-memory records, each page beside its real side menu. Only
ModelAPI data access and the user's permission snapshot are replaced, and
every status move the pages send is recorded and kept, so the tests check what
was sent as well as what was drawn, and the counts and rows follow a move.

It covers the list: a tile per status counting the postmortems in it, a tile's
click listing only those and a second click listing them all, a row's status
moved from its pill (and a move the server refuses put back with the reason),
**Change Postmortem Status** for several rows at once with archived statuses
never offered, a viewer who reads statuses but cannot move them, a project with
no incidents yet, a phone-width screen (tiles without captions), a tablet (two
tiles to a line, each caption whole), dark mode and German (the rows fit the
card at 1280px), the title taking the room a fitting table has, and a refused
move's reason wrapping inside its row. On the incident's page: the status and
owners at the top of the card, **Write Postmortem** with **Start from
Template** and **Generate with AI** beside it as white bordered buttons while
nothing is written (stacked at full width on a phone; for a viewer, Write
Postmortem alone, locked, with why under it, and no Add owners),
**Edit Postmortem Note** with the two folded into the **⋯** once it is, and
the status moved from the card. **Add owners**, beside the owners or beside
"No owners yet." (`owners=none`), opens the Add owners list right there: a
pick writes the incident's owner row, the card names it at once and the list
stays open; `fail=owner-add` says why in the list; the list is whole on a
phone. On the settings page: the statuses in order
with what each counts as, the built-in ones marked on their name's line, a
status of the project's own and an archived one.

Screenshots are saved under `output/playwright/postmortems-ui/` at the
repository root: `list.png`, `list-not-started.png`, `row-status-menu.png`,
`bulk-dialog.png`, `list-empty.png`, `list-phone.png`, `list-dark.png`,
`list-german.png`, `tab-written.png`, `tab-empty.png`, `tab-empty-phone.png`,
`tab-write-dialog.png`, `tab-phone.png`, `tab-owners-add-list.png`,
`tab-owners-added.png`, `tab-owners-add-list-phone.png`, `settings.png` and
`settings-custom.png`. The records in them
are made up. These screenshots verify the production UI; they do not
demonstrate database persistence or the moves the server makes on its own,
which the Common suites cover.

The fixture listens on port 4447; set `POSTMORTEMS_FIXTURE_PORT` to use
another one.
