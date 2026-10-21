# Discovery scan experience regression tests

Run `npm run test-discovery-ui` from `packages/E2E` after installing its dependencies.
The test runner builds the actual Discovery page and shared UI, then serves it
locally on port 4198. Only session and API responses use synthetic fixtures; no
network addresses are scanned and no backend account is required.

Coverage includes progress on the reported 15,360-address target, zero responding
hosts, live row updates without loading flicker, polling stopping at completion
and resuming when a recurring scan is due, connection failure/retry, a stalled HTTP request timing out through the real
browser transport, reviewing preserved results after failure, accessible progress
values, desktop layout, and a narrow mobile viewport. It also checks that a scan's
status message offers "Show details" only when the two-line preview cuts it short,
at several widths and across live updates (issue #3842).

`DeviceBulkActions.spec.ts` covers what comes after an import, on the real Devices
page (`/network-devices`) against synthetic devices: the Bulk Actions menu's Set Site,
Set Device Role and Apply Vendor Template (with its per-device preview), Clear Site
counting only the devices in a site, the result's "not changed" list, a write the
server refuses, writes going one device at a time, a 390px screen, and the import's
"Apply each SNMP host's vendor template" switch on its Monitoring step. The fixture records
every device write and every device an import creates on `window.__discoveryFixture`.

`DiscoveryImport.spec.ts` covers the import dialog (issues #4811, #4812, #4813, #4815) on a
514-host scan and on a campus scan with several vendors: choosing hosts (search by name or
subnet, the Responded and Name filters, selecting every host shown across pages, hosts
already added), the Monitoring step (how often devices are checked, a template's checks
and what each raises), and the import itself, run by `ImportFixture.js` the way the server
runs it - progress, failures grouped by reason, retrying only the failed hosts, stopping,
closing the dialog mid-import and reopening it from the scan's row - on desktop and on a
390px screen.

`HostnameNaming.spec.ts` covers issue #4518 on the reporter's kitchen-display scan: Review
Results names each display by its own hostname (an SNMP name, or the Windows name a host
reports over NetBIOS) with its DNS name beside the address, importing creates those names
and records where each came from (`discoveredName`, `discoveredNameSource` on the
fixture's recorded creates), the Start New Scan form's "Look up Windows names (NetBIOS)"
switch and naming order, and the dialog on a 390px screen.

Screenshots are written to `output/playwright/discovery/`. The screenshots in
`packages/E2E/Discovery/screenshots/` document the reviewed UI for issue #3672 and use the
same visibly labelled synthetic data.

Probe execution is covered separately by the Discovery/SNMP suites in `Probe`,
including bounded host concurrency, ping process termination, SNMP session
deadlines, scan cancellation, and partial report ordering. These deterministic
checks do not measure the reporter's private network or its device response time.
