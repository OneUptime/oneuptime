# Tables, more: UI review shots (#6168, #6025)

Taken in headless Chromium against the offline fixtures, which bundle the
production pages with the Dashboard's Tailwind runtime, Theme.css and Inter:
`packages/E2E/ModelTables` (incidents, alerts, monitors and runbooks lists),
`packages/E2E/SecurityOperations` (the security case queue) and
`packages/E2E/OpenStackPages` (a cloud's AI > Logs). "Before" is `main` at
2de6027cc49, "after" is the reviewed branch. The SecurityOperations fixture
is 64px narrower than production, so its 1344 is a 1280 laptop and its 1280
a 1216 one.

| Shot | What changed |
| ---- | ------------ |
| `alerts-de-960-*` | German alerts: "Warnungsnummer" breaks with a hyphen in the wrapped header, and the state and severity pills stay whole (they were squeezed to "E." and "H.") |
| `alerts-de-900-*` | In a wide card that cannot fit, the list stays given way and scrolls 54px under the row's buttons (it scrolled 387px with every value whole) |
| `incidents-900-*` | The incidents list in a 834px card: states whole (they read "A" and "M") and the date's end under the row's buttons |
| `incidents-900-first-frame-*` | A first visit: rows were painted unfitted past the card for a few frames; now they wait see-through and fade in fitted |
| `runbooks-820-first-visit-*` | Beside the side menu at a tablet width the placeholders are cards (they were rows that ran past the card, then turned into cards) |
| `cases-ru-1280-laptop-*` | Russian case queue at a 1280 laptop: a title gets a third line, so "Defender XDR: suspicious PowerShell on web-03" is whole |
| `cases-ru-1216-laptop-*` | At a smaller laptop the status folds under the priority, so "Maya Chen" is whole and clear of Просмотр (the queue scrolled 69px) |
| `columns-owner-no-default-after` | Customize Columns for a Project Owner or Admin: the box that shows these columns to everyone |
| `columns-owner-default-after`, `columns-owner-default-de-dark-after` | With a project default: what ticking replaces, and Remove default |
| `columns-viewer-after` | Anyone else seeing the project's default is told so, and that what they save is theirs alone, in the same panel (UI review: it was a second grey hint under "Drag a row...") |
| `ai-logs-commands-*`, `ai-logs-commands-390-after` | AI Logs for a role that may not read the commands: the lists' lock and the one permission to ask for (it named eight roles, and "Runner jobs") |
| `bulk-keyboard-*` | Select All pressed from the keyboard stays busy, not disabled, and hands the focus to Bulk Actions, drawn with the bar's indigo ring (main dropped the focus to the page) |
| `bulk-ceiling-*` | At the 10,000 ceiling the count says "10,000 of 10,254 selected" instead of a three-sentence note |
