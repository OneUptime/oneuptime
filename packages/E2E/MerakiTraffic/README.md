# Meraki traffic fixture

An offline harness for the real Network > Traffic page and its Meraki side (issue #5140): the
network's traffic as a Meraki connection reads it from the Meraki dashboard API, the Flows | Meraki
switch, Connect Meraki and the connections at the page's foot.

| Page | Route (from `RouteMap`) | Production components |
| ---- | ----------------------- | --------------------- |
| Network > Traffic | `NETWORK_TRAFFIC` `/dashboard/:projectId/network-devices/traffic` | `Pages/Network/Layout` (the Network side menu) and `Pages/NetworkDevice/Traffic` (`NetworkTrafficView`, `Meraki/MerakiTrafficView`, `Meraki/MerakiConnectModal`, `Meraki/MerakiConnectionsCard`), with every part they mount |

Run from `packages/E2E`:

```sh
npm run test-meraki-traffic-ui
```

`Fixture/server.js` bundles the production layout and page with esbuild, serves them with the
same Tailwind build, `tailwind.config` and `Theme.css` production uses, and listens on
`127.0.0.1:4514` (`MERAKI_TRAFFIC_FIXTURE_PORT`). No Docker, no database, no sign-in. Only the
`ModelAPI` / `API` data boundary and the signed-in user are replaced. The locale files are the
real `en.json` and `de.json`. Every record is fabricated for an "Acme Networks" workspace, and
the fixture header says so ("Preview workspace · Synthetic data").

## Scenarios

Picked with query parameters on the page's address:

- `state=none|meraki|both|failing|partial|waiting`: no connection and nothing sending flow
  records (the default), an organization read with no flow records, an organization read and
  flow records too, a connection whose key was revoked, a large organization read in part, or a
  connection waiting for its first read.
- `verdict=pass|several|auth`: what Connect Meraki's test answers - a key that reads one
  organization (the default), two, or a key Meraki refuses.
- `lang=de`, `theme=dark`.

Every read and write is recorded on `window.__merakiTrafficFixture` (`usageRequests`,
`flowRequests`, `tests`, `readNows`, `creates`, `updates`, `deletes`) with `unhandled` for anything
the fixture does not model; the spec fails on an unhandled request, on an uncaught page error and
on any request that leaves the fixture server. `finishRead()` ends the read a connection waits
for, as the worker would, so a test can watch the page fill in by itself.

Screenshots are written to `output/playwright/meraki-traffic-ui/`, one per project (`desktop`,
1280 pixels, and `phone`, 390).
