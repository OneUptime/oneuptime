# Asset details fixture

An offline harness for where each asset detail came from, and when (issue #5185): Inventory's
**Asset Details** card of a network device's or a host's item
(`Components/Inventory/InventoryAssetDetailsCard`, `AssetFactValue`, `AssetFactSourceText`), the
**Inventory** card of a network device's Overview (`Components/NetworkDevice/DeviceInventoryCard`),
and the device's **Overview** page itself (`Pages/NetworkDevice/View/Index`).

Run from `packages/E2E`:

```sh
npm run test-asset-details-ui
```

`server.js` bundles the production cards with esbuild, serves them with the same Tailwind build,
`tailwind.config` and `Theme.css` production uses, and listens on `127.0.0.1:4531`
(`ASSET_DETAILS_FIXTURE_PORT`). No Docker, no database, no probe. Only the `ModelAPI` data boundary
and the signed-in user are replaced: `Fixture.js` answers the cards' reads from an in-page store,
`window.__assetDetailsFixture`, which the specs read (which model each card read, with which
columns). The Inventory item is written from the device's own facts, as the inventory mirror writes
it. On the Overview page, the cards that read a backend of their own (health, interfaces,
attachment, diagnostics, monitors, the vendor template offer) are placeholders: each has suites of
its own.

Every refresh asked of the server is recorded on `window.__assetDetailsFixture.state.refreshAsks`,
and `itemReloads` counts how often the item page read its item again after a refresh landed.

## What the cards say

The reading most of a machine's details came from is said once, below them: a host's collector, a
network device's own SNMP poll, or the discovery scan that read a device its poll has not. Every
other source is said under its value: a router's ARP table, a reverse-DNS lookup, the probe's DNS
lookup, a value saved on the device, a role someone assigned. On the device's own pages, its own
poll and the values saved on it go unsaid, as its Name and Hostname do; a saved value discovery
reads differently says so, with what discovery read in amber.

A device a Meraki connection describes takes what its own poll leaves empty from the Meraki
dashboard, said once below the details on Inventory's card, and in a **Meraki** row (the
connection, when, and the Meraki network) on the device's own card. **Refresh** reads the device
again now: one line at the top of the card says who reads it again, then that it was read again
just now, or that its probe could not reach it.

## Scenarios

Picked with query parameters:

- `page=item` (default): Inventory's Asset Details card. `page=device`: the device Overview's
  Inventory card. `page=overview`: the device's Overview page, opened at
  `/network-devices/<device id>`.
- `scenario=pinged` (default): a switch OneUptime only pings. A discovery scan read its SNMP system
  group and reverse-DNS name two hours ago, and a router's ARP table its MAC three hours ago.
- `scenario=refound`: the same switch, found at its address again ten minutes ago without
  answering SNMP.
- `scenario=walked`: a switch walked over SNMP three minutes ago, with an assigned role.
- `scenario=stale`: a switch walked three days ago, whose system group a scan read since.
- `scenario=disagree`: a MAC address and a DNS name someone saved, which discovery reads differently.
- `scenario=typed`: a MAC address and a DNS name typed on the device, and nothing discovery read.
- `scenario=other`: a scan found another machine answering at the device's address.
- `scenario=dns`: a firewall polled at a DNS name, whose probe resolved the address.
- `scenario=host`: a Windows host its collector reports, placed by its cloud zone.
- `scenario=noread`: the device cannot be read, so the card shows the item's own facts.
- `scenario=meraki`: a Meraki access point its probe pings, which a Meraki connection describes:
  its serial number, model and firmware come from the Meraki dashboard, read four minutes ago,
  and both cards offer **Refresh**.
- `refresh=read|unreachable`: what a refresh finds. The fixture answers
  `POST /api/network-device/<id>/refresh` as the server does (its probe and the Meraki dashboard
  read it again); reads of the device within 2.5 seconds of the ask are the device as it was, and
  later ones the device read again - reached by its probe (the default) or not.
- `role=owner|reader`: a project owner (the default), or someone who may read network devices but
  not edit them, who is offered no **Refresh**.
- `frame=<pixels>`: the card's width. `lang=ja|de`, `theme=dark`.

The page is drawn in Inter, as production draws it (`server.js` serves the font and the Dashboard's
universal font rule from `index.ejs`), so the widths the specs measure are the real ones.

Screenshots of the cards and the Overview at 1280 and 390 pixels, light and dark, in Japanese and
German, land in `output/playwright/asset-details-ui/`.
