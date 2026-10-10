# Network Traffic pages (#4610)

How these were made: the REAL Network routes (`NetworkLayout`, `NetworkDeviceRoutes`,
`NetworkSiteRoutes`), bundled with the Dashboard's own esbuild config and rendered in headless
Chromium at 1280px (390px for the phone shots), with Inter and the production Tailwind config.
`POST /network-traffic/summary` and the model reads are mocked: a branch router exporting IPFIX,
a firewall exporting NetFlow v9, and one switch sending sFlow that is not a device yet.

- `final-device.png` / `final-device-dark.png`: a device's Traffic tab. The status line says what
  is arriving; four numbers; traffic over time (drag to zoom); top sources, destinations,
  applications (named by service port) and interfaces (named from the SNMP walk, with
  utilization); the conversation diagram; packet captures under the flows (#4601).
- `final-filtered.png`: after a click on the busiest source. The chip says what the page is
  narrowed to, the row is marked, and every number and list is that source's.
- `final-network.png`: Network -> Traffic. Top devices instead of interfaces, the notice for the
  address that is not a device yet, and **Sending flows** at the bottom.
- `final-sources.png`: **Sending flows**, with **Add as device** and **It is one of my devices**
  for the unknown exporter.
- `final-link.png`: **It is one of my devices**, which adds the address to the device's Other
  Addresses.
- `final-setup.png`: a device that has never sent a flow: the probe's ports and the vendor's
  commands, and the addresses records are matched by.
- `final-quiet.png`: a device that sent before, but not in this time range.
- `final-phone.png` / `final-phone-dark.png`: the device's Traffic tab at 390px.
