# Multi-device SNMP walk fixture

An offline harness for the real card of the Network's SNMP Walk page (issue #5548): many devices walked
at once, under **Network → Advanced → SNMP Walk**, from the Devices list's **Bulk Actions**, or from
**Compare with other devices** on a device's own SNMP Walk page (`Components/NetworkDevice/MultiDeviceSnmpWalkCard`
and `MultiDeviceSnmpWalkResults`).

Run from `packages/E2E`:

```sh
npm run test-multi-device-snmp-walk-ui
```

`server.js` bundles the production card with esbuild, serves it with the same Tailwind build,
`tailwind.config` and `Theme.css` production uses, and listens on `127.0.0.1:4522`
(`MULTI_DEVICE_SNMP_WALK_FIXTURE_PORT`). No Docker, no database, no probe. Only the `ModelAPI` data
boundary and the signed-in user are replaced: `Fixture.js` answers the card's reads and writes from an
in-page store, `window.__multiDeviceSnmpWalkFixture`, which the specs read (what each walk was asked for
with, what Collect wrote). A walk the page asks for is finished, as the device's probe would write it, on
the card's first read of it; a device listed in `state.slowDeviceIds` stays walking until
`finishRunning()`. The walks are kept in the tab's session storage, as the server keeps them, so a reload
reads the same walk back.

## The fleet

Seven Meraki routers, each in a state a fleet has: `mx-amsterdam` answers everything, `mx-berlin`
everything but sysLocation, `mx-cardiff` has no SNMP credentials (the server refuses its walk),
`mx-dublin` has no probe (the page does not ask), `mx-edinburgh` does not answer, `mx-frankfurt` is linked
to the "Edge routers" OID Collection Template and its walk stops at its limit after sysName, and
`mx-geneva` answers everything but is monitor-backed, so nothing is collected on it.

## Query parameters

- `devices=<ids>&oid=<oid>`: what the page's address names, as in production.
- `scenario=fleet` (default): nothing walked yet. `scenario=walked`: the last walk of the devices the
  address names, read back as after a reload.
- `role=owner` (default) `|viewer|walker`: everything, reading only, walking but not editing devices.
- `frame=<pixels>`: the card's width.
- `lang=ja|de`, `theme=dark`.

The page is drawn in Inter, as production draws it (`server.js` serves the font and the Dashboard's
universal font rule from `index.ejs`), so the widths the specs measure are the real ones.

Screenshots of the page at 1280 and 390 pixels, light and dark, and in German, land in
`output/playwright/multi-device-snmp-walk-ui/`.
