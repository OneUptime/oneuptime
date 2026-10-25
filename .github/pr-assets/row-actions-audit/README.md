# Row actions audit

Each row's ⋯ menu on the incidents list, and the dialogs its actions open, as the production pages draw them. The screenshots come from `packages/E2E/ModelTables/RowActions.spec.ts` (`npm run test-model-tables-ui` in packages/E2E), run against the offline fixture's records at 1280 and 390 pixels, light and dark.

- `incident-menu-1280-light.png`, `incident-menu-390-dark.png`: an incident's ⋯ menu. It offers Acknowledge and Resolve while the incident can make that move, then Change State, Change Severity, Assign to Me and Add Owner, then Show ID, with Delete set apart.
- `acknowledge-1280-light.png`, `acknowledge-390-dark.png`: Acknowledge, in the incident page's words. It names the incident and has the notify box and the folded public note.
- `change-severity-390-light.png`: Change Severity. It opens on the incident's own severity.
- `monitor-disable-1280-light.png`: a monitor's Disable, which asks the question the monitor's Settings page asks before monitoring is turned off.
