# Security Events empty states redesign

These images show the empty **Security Events** list and the empty **Security Events >
Connections** table, before and after the redesign. Each one is the real production page
(`Pages/SecurityEvents/Layout.tsx` with `Index.tsx` or `Connections.tsx`) rendered offline by
the fixture in `packages/E2E/SecurityEventsEmptyStates/Fixture`. The fixture answers every
data request with an empty table, and its header marks the workspace as synthetic.

Each image was captured at 2x and scaled to 1440 px wide. The mobile image is the only
exception: it stays at 2x of a 390 px viewport.

- `connections-before.png` / `connections-after.png`: the Connections table with no
  connections, at 1440 px.
- `connections-after-dark.png`: the same in the dark theme.
- `connections-after-no-permission.png`: the view of a member who holds only Security Viewer.
  Add connection is disabled, the reason is written under it, and the product tiles are static
  apart from their setup guides.
- `connections-after-mobile.png`: the Connections empty state at 390 px.
- `connections-after-preselected.png`: after clicking the CrowdStrike Falcon tile. Add
  connection opens on its Provider step with CrowdStrike Falcon already chosen.
- `events-before.png` / `events-after.png`: the Security Events list with no events, at
  1440 px.
- `events-after-dark.png`: the same in the dark theme.
- `events-after-mobile.png`: the Security Events empty state at 390 px. The filters fold
  above the list there, so the list and the two cards get the full width.

`connections-after-preselected.png` and `events-after-mobile.png` come from the Playwright
suite in `packages/E2E/SecurityEventsEmptyStates`
(`cd packages/E2E && CI=1 npm run test-security-events-empty-states-ui`; the images land in
`output/playwright/security-events-empty-states-ui/`). The others were captured from the same
fixture with a screenshot script.

The "before" images come from commit `885290ca3e`, the last commit before the redesign. It
already has the fixture.
