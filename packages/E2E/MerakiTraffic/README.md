# Meraki traffic fixture

An offline harness for the real Network > Traffic page and its Meraki side (issue #5140): the
network's traffic as a Meraki connection reads it from the Meraki dashboard API, the Flows | Meraki
switch, Connect Meraki and the connections at the page's foot - and a device's and a site's own
Traffic pages.

| Page               | Route (from `RouteMap`)                                                                                             | Production components                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network > Traffic  | `NETWORK_TRAFFIC` `/dashboard/:projectId/network-devices/traffic`                                                   | `Pages/Network/Layout` (the Network side menu) and `Pages/NetworkDevice/Traffic` (`NetworkTrafficView`, `Meraki/MerakiTrafficView`, `Meraki/MerakiConnectModal`, `Meraki/MerakiConnectionsCard`), with every part they mount |
| A device's Traffic | `NETWORK_DEVICE_VIEW_TRAFFIC` `/dashboard/:projectId/network-devices/40000000-0000-4000-8000-000000000001/traffic`  | `Pages/NetworkDevice/View/Layout` (the device's side menu) and `Pages/NetworkDevice/View/Traffic`: the Head Office MX, a device in OneUptime                                                                                 |
| A site's Traffic   | `NETWORK_SITE_VIEW_TRAFFIC` `/dashboard/:projectId/network-sites/view/50000000-0000-4000-8000-000000000001/traffic` | `Pages/NetworkSite/View/Layout` (the site's side menu) and `Pages/NetworkSite/View/Traffic`: the Branches site, of the Leeds and Bristol networks                                                                            |

Run from `packages/E2E`:

```sh
npm run test-meraki-traffic-ui
```

`Fixture/server.js` bundles the production layouts and pages with esbuild, serves them with the
same Tailwind build, `tailwind.config` and `Theme.css` production uses, and listens on
`127.0.0.1:4514` (`MERAKI_TRAFFIC_FIXTURE_PORT`). No Docker, no database, no sign-in. Only the
`ModelAPI` / `API` data boundary and the signed-in user are replaced. The locale files are the
real `en.json` and `de.json`. Every record is fabricated for an "Acme Networks" workspace, and
the fixture header says so ("Preview workspace · Synthetic data").

## Scenarios

Picked with query parameters on the page's address:

- `state=none|meraki|both|flows|failing|partial|waiting|stale|off`: no connection and nothing
  sending flow records (the default), an organization read with no flow records, an organization
  read and flow records too, flow records and no connection, a connection whose key was revoked
  (its reads stopped two hours ago), a large organization read in part, a connection waiting for
  its first read, a connection whose reads stopped three hours ago, or one turned off.
- `verdict=pass|several|auth`: what a test of a key answers - Connect Meraki's (a key that reads
  one organization, the default; two; or a key Meraki refuses) and the edit dialog's test of a
  saved connection's new key (`pass` or `auth`).
- `role=owner|member`: a project owner (the default), or a member, who may read connections but
  not add, change or read them.
- `devices=counted|one`: the connection's last read listed the organization's 6 devices, 5 of them
  network devices in OneUptime (or 1), so its row counts them and says so in a grey note. Without
  it, the read predates device counts and the row says nothing of devices.
- `unadded=many|none`: what the last read counted of the organization's devices that are no
  network device here, for Add devices: 8 switches and 12 access points to add, 3 cameras, 4
  security appliances Meraki lists no address for, a switch at an address a device here has and
  an access point archived here (`many`); or only the appliances, which cannot be added (`none`).
  Without it, the read predates these counts.
- `adding=progress|done|failed|stopped`: how the last Add devices went - 7 of 20 added so far; 18
  added with 2 sites, 2 that could not be; Meraki refused the key; or its worker went quiet.
- `probes=two`: the project has two probes of its own, so no probe is picked for the devices (one,
  picked, is the default).
- `source=flows|meraki`, `lang=de`, `theme=dark`. `mnet`, `mdev` and `mup` narrow the Meraki side
  as the page's own links do: to a network, an appliance and an uplink.

Every read organization has a pair of WANs and a cellular line that carries nothing and is measured
all the same, so the page's uplinks compare and a standby line shows; its traffic stops five minutes
short of now, as the reads do.

Every read and write is recorded on `window.__merakiTrafficFixture` (`usageRequests`,
`flowRequests`, `tests`, `readNows`, `creates`, `updates`, `deletes`, `deviceAdds`, `probeAsks`)
with `unhandled` for anything the fixture does not model; the spec fails on an unhandled request,
on an uncaught page error and on any request that leaves the fixture server. `finishRead()` ends
the read a connection waits for, as the worker would, so a test can watch the page fill in by
itself; `progressDeviceAdd(added, total)` and `finishDeviceAdd()` move an Add devices on, as its
worker job would.

Screenshots are written to `output/playwright/meraki-traffic-ui/`, one per project (`desktop`,
1280 pixels, and `phone`, 390).
