# Discovery scan experience regression tests

Run `npm run test-discovery-ui` from `E2E` after installing its dependencies.
The test runner builds the actual Discovery page and shared UI, then serves it
locally on port 4198. Only session and API responses use synthetic fixtures; no
network addresses are scanned and no backend account is required.

Coverage includes progress on the reported 15,360-address target, zero responding
hosts, live row updates without loading flicker, polling stopping at completion,
connection failure/retry, reviewing preserved results after failure, accessible
progress values, desktop layout, and a narrow mobile viewport.

Screenshots are written to `output/playwright/discovery/`. The screenshots in
`E2E/Discovery/screenshots/` document the reviewed UI for issue #3672 and use the
same visibly labelled synthetic data.

Probe execution is covered separately by the Discovery/SNMP suites in `Probe`,
including bounded host concurrency, ping process termination, SNMP session
deadlines, scan cancellation, and partial report ordering. These deterministic
checks do not measure the reporter's private network or its device response time.
