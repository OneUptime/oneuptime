# Row actions audit

Each row's ⋯ menu on the incidents list, and the dialogs its actions open, as the production pages draw them. The screenshots come from `packages/E2E/ModelTables/RowActions.spec.ts` (`npm run test-model-tables-ui` in packages/E2E) and `packages/E2E/ChartTimeZoom/ExceptionRowActions.spec.ts` (`npm run test-chart-time-zoom-ui`), run against the offline fixtures' records at 1280 and 390 pixels, light and dark.

- `incident-menu-1280-light.png`, `incident-menu-390-dark.png`: an incident's ⋯ menu, in runs. Acknowledge and Resolve while the incident can make that move, Change State (the flag of the list's State filter) and Change Severity (the flame of its Severity filter); then Assign to Me and Add Owner; then Show ID; then Delete, set apart.
- `incident-bulk-menu-1280-light.png`: Bulk Actions on two incidents, in runs: state and severity, people, labels, episodes, export, then Delete.
- `acknowledge-1280-light.png`, `acknowledge-390-dark.png`: Acknowledge, in the incident page's words. It names the incident and has the notify box and the folded public note.
- `change-severity-390-light.png`, `change-severity-open-390-dark.png`: Change Severity, closed and open. Nothing is picked as it opens, and the field says Choose a severity; the incident's own severity is listed, marked Current, and cannot be picked again - as a security case's Change Priority.
- `monitor-disable-1280-light.png`: a monitor's Disable, which asks the question the monitor's Settings page asks before monitoring is turned off.
- `archive-dialog-1280-dark.png`: a monitor's Archive, drawn over the whole page: its sentence wraps inside it, and the other rows stay under its backdrop. Drawn inside the row's sticky Actions cell, as it first was, the sentence ran off the dialog's edge, the other rows' buttons sat on top of the backdrop, and a click on its text opened the monitor.
- `exception-row-390-light.png`: an exception's row on a phone: its status leads the service line, so the ⋯ beside the row leaves the message its width.
- `case-menu-1344-light.png`: a security case's ⋯, in runs as an incident's: its people, then its status and priority, then Delete. Taken by `packages/E2E/SecurityOperations/SecurityOperations.spec.ts` (`npm run test-security-operations-ui`).
