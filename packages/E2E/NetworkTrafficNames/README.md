# Network traffic names fixture

An offline harness for names instead of bare addresses on the real Network > Traffic page and
Network > Settings > Address Names (issue #5340): an address the project knows is shown by its
name first - a host's, a network device's, a cloud resource's, a Kubernetes node's or pod's, a name
someone gave it, its DNS name - with the address beside it.

| Page              | Route (from `RouteMap`)                                                                                | Production components                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Network > Traffic | `NETWORK_TRAFFIC` `/dashboard/:projectId/network-devices/traffic`                                      | `Pages/Network/Layout` (the Network side menu) and `Pages/NetworkDevice/Traffic` (`NetworkTrafficView`, `TrafficAddress`, `TrafficAddressCard`, `NetworkAddressNameModal`), with every part they mount |
| Address Names     | `NETWORK_DEVICE_SETTINGS_ADDRESS_NAMES` `/dashboard/:projectId/network-devices/settings/address-names` | `Pages/NetworkDevice/Settings/AddressNames` (`ModelTable`, the Address Name form)                                                                                                                      |

Run from `packages/E2E`:

```sh
CI=1 npm run test-network-traffic-names-ui
```

`Fixture/server.js` bundles the production layout and pages with esbuild, serves them with the
same Tailwind build, `tailwind.config` and `Theme.css` production uses, and listens on
`127.0.0.1:4547` (`NETWORK_TRAFFIC_NAMES_FIXTURE_PORT`). No Docker, no database, no sign-in. Only
the `ModelAPI` / `API` data boundary and the signed-in user are replaced. The locale files are the
real `en.json`, `de.json` and `fa.json`. Every record is fabricated for an "Acme Networks"
workspace, and the fixture header says so ("Preview workspace · Synthetic data"). The summary's
names are worked out the way the server does: the Address Names the page holds (changed by its own
dialogs) first, then the inventory's and DNS names, a subnet's name beside each address in it.

## Scenarios

Picked with query parameters on the page's address:

- `names=all|none|long`: names from every source and two named subnets (the default), a project
  that knows no name, or the longest names a page meets (a 70-character DNS name, an Address Name
  of 90 characters, a long pod name).
- `role=owner|viewer`: a project owner (the default), or a viewer, who reads the names but may not
  add or change them.
- `fail=find`: "find an address" answers 500.
- `exporters=unknown`: two more devices send flows and are no device in OneUptime yet, one with a
  DNS name, which Top devices and Sending flows show.
- `lang=de|fa`, `theme=dark`. A Persian workspace wrote two of its Address Names in Persian.
- The page's own filters, as the Traffic page keeps them in its address (`host`, `src`, `dst`).

Every read and write is recorded on `window.__networkTrafficNamesFixture` (`flowRequests`,
`findRequests`, `creates`, `updates`, `deletes`) with `unhandled` for anything the fixture does not
model; the spec fails on an unhandled request, on an uncaught page error and on any request that
leaves the fixture server.

Screenshots are written to `output/playwright/network-traffic-names-ui/`, one per project
(`desktop`, 1280 pixels, and `phone`, 390).
