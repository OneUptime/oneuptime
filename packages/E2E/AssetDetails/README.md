# Asset details fixture

An offline harness for where each asset detail came from, and when (issue #5185): Inventory's
**Asset Details** card of a network device's or a host's item
(`Components/Inventory/InventoryAssetDetailsCard`, `AssetFactValue`, `AssetFactSourceText`) and the
**Inventory** card of a network device's Overview (`Components/NetworkDevice/DeviceInventoryCard`).

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
it.

## Scenarios

Picked with query parameters:

- `page=item` (default): Inventory's Asset Details card. `page=device`: the device Overview's
  Inventory card.
- `scenario=pinged` (default): a switch OneUptime only pings. A discovery scan read its SNMP system
  group and reverse-DNS name two hours ago, and a router's ARP table its MAC three hours ago.
- `scenario=walked`: a switch walked over SNMP three minutes ago, with an assigned role.
- `scenario=disagree`: a MAC address and a DNS name someone saved, which discovery reads differently.
- `scenario=other`: a scan found another machine answering at the device's address.
- `scenario=dns`: a firewall polled at a DNS name, whose probe resolved the address.
- `scenario=host`: a Windows host its collector reports, placed by its cloud zone.
- `scenario=noread`: the device cannot be read, so the card shows the item's own facts.
- `frame=<pixels>`: the card's width. `lang=ja|de`, `theme=dark`.

The page is drawn in Inter, as production draws it (`server.js` serves the font and the Dashboard's
universal font rule from `index.ejs`), so the widths the specs measure are the real ones.

Screenshots of both cards at 1280 and 390 pixels, light and dark, in Japanese and German, land in
`output/playwright/asset-details-ui/`.
