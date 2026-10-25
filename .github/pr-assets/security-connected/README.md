# Security Events, connected to the rest of OneUptime

These images show Connected Signals and the Security cards this change adds. Each one is the
real production page rendered offline by a Playwright fixture in `packages/E2E`, on synthetic
data for a made-up "Acme Commerce" workspace: every name, domain and address is fabricated
(documentation addresses, example domains), and each fixture's header marks the workspace as
synthetic. Captured at 2x.

- `case-1280.png` / `case-1280-dark.png`: a case's Connected Signals page (CASE-141, the
  known-bad domain build-runner-07 looked up), under Investigation after Entities: the host by
  the name it reports, its signals on the case's window, its open alert, its monitor and the
  fix in the window, and the one domain not in OneUptime.
- `case-1024.png` / `case-768.png`: the same beside the case's side menu.
- `case-390-dark.png`: the same on a phone, dark.
- `case-de.png`, `case-fa-1280.png`, `case-fa-390.png`: in German, and in Persian (right to
  left) on a laptop and a phone.
- `entity-1280.png`: an entity's page (Entity Risk) for k.morgan@acme-commerce.example, where
  OneUptime knows it around its last event.
- `event-tab-1280.png` / `event-tab-390-dark.png`: an event's drawer on its Connected tab:
  web-03 by its name and address, Kai Morgan by email, web-03's staging namesake as a possible
  match.
- `host-card-1280.png` / `host-card-390-dark.png` / `cluster-card-1280.png`: the Security
  card on a host's and a Kubernetes cluster's Overview.
- `incident-card-1280.png` / `incident-card-1280-dark.png` / `incident-card-390.png`: the
  Security card on an incident's page: the case that declared it, and the open cases naming
  its host and cluster.

Made by:

- `cd packages/E2E && CI=1 npm run test-security-operations-ui` (the case, the entity:
  `SecurityOperations/ConnectedSignals.spec.ts`),
- `CI=1 npm run test-security-events-empty-states-ui` (the event's drawer),
- `CI=1 npm run test-chart-time-zoom-ui` (the host and the cluster:
  `ChartTimeZoom/ResourceSecurityCard.spec.ts`),
- `CI=1 npm run test-event-overview-ui` (the incident:
  `EventOverview/IncidentSecurityCard.spec.ts`).

The images land in `output/playwright/<suite>-ui/`, named `*-synthetic.png`.
