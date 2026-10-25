# Network first-run fixture

An offline harness for the real Network Overview of a project with nothing on it: the
first-run path (`Components/Network/NetworkGetStarted`) and its "Add a probe" dialog
(`Components/Network/AddProbeModal`).

| Page | Route (from `RouteMap`) | Production components |
| ---- | ----------------------- | --------------------- |
| Network Overview | `NETWORK_OVERVIEW` `/dashboard/:projectId/network-devices/overview` | `Pages/Network/Layout` (the Network side menu) and `Pages/NetworkDevice/Overview`, with every part they mount |

Run from `packages/E2E`:

```sh
npm run test-network-first-run-ui
```

`Fixture/server.js` bundles the production layout and page with esbuild, serves them with the
same Tailwind build, `tailwind.config` and `Theme.css` production uses, and listens on
`127.0.0.1:4284` (`NETWORK_FIRST_RUN_FIXTURE_PORT`). No Docker, no database, no sign-in. Only the
`ModelAPI` / `API` data boundary and the signed-in user are replaced. The locale files are the
real `en.json` and `de.json`. Every record is fabricated for an "Acme Networks" workspace, and
the fixture header says so ("Preview workspace · Synthetic data").

## Scenarios

Picked with query parameters on the Overview's address:

- `probes=none|waiting|connected`: no probe of the project's own (the default), one added and
  never run ("Office probe"), or one checking in ("Data centre probe").
- `connectAfter=N|never`: how many times the dialog asks after a probe before it checks in
  (default 2, so a probe added in the dialog connects within about ten seconds).
- `role=owner|member`: a member may add a probe but may not read its key.
- `alerts=N`: how many alert policies are on.
- `devices=N`: how many devices the network has (0 shows the first-run path).
- `lists=busy`: the Overview's lists of a network that has been running for a while, of
  different lengths (six devices and one site needing attention, three vendors, no scan yet),
  so its rows of cards are uneven.
- `server=1`: this server runs a probe of its own (a self-hosted install).
- `plan=free|growth`: OneUptime Cloud (billing on, with the plans the Cloud configures) and the
  project on that plan. Adding a probe needs Growth, so on `free` the probe step and the dialog
  name the plan and lead to Billing.
- `open=add-probe`: the address a device's probe field links to.
- `lang=de`, `theme=dark`.

Every read and write is recorded on `window.__networkFirstRunFixture` (`listRequests`,
`countRequests`, `itemRequests`, `creates`, `apiRequests`) with `unhandled` for anything the
fixture does not model; the spec fails on an unhandled request, on an uncaught page error and on
any request that leaves the fixture server.

Pages the path links to (Devices, Discovery, Alert Policies, Billing) are stubs that show their path, so a
test can check where a choice leads. Screenshots are written to
`output/playwright/network-first-run-ui/`.
