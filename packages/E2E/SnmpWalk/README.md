# SNMP walk fixture

An offline harness for the real SNMP Walk card of a network device (issue #5184): the page under
**More → SNMP Walk** in a device's menu (`Components/NetworkDevice/SnmpWalkCard` and
`SnmpWalkResults`).

Run from `packages/E2E`:

```sh
npm run test-snmp-walk-ui
```

`server.js` bundles the production card with esbuild, serves it with the same Tailwind build,
`tailwind.config` and `Theme.css` production uses, and listens on `127.0.0.1:4521`
(`SNMP_WALK_FIXTURE_PORT`). No Docker, no database, no probe. Only the `ModelAPI` data boundary
and the signed-in user are replaced: `Fixture.js` answers the card's reads and writes from an
in-page store, `window.__snmpWalkFixture`, which the specs read (what a walk was asked for with,
what Collect wrote). A walk the page asks for is finished, as the device's probe would write it,
on the card's first read of it, three seconds later.

## Scenarios

Picked with query parameters:

- `scenario=done` (default): a walk of the whole tree of a Catalyst switch, 26 OIDs.
- `scenario=empty`: never walked.
- `scenario=more`: a walk of the interfaces that stopped at its 1,000 OIDs; continuing it reads 200 more.
- `scenario=auth`, `timeout`, `partial`, `nothing`: a walk refused by SNMPv3, unanswered, cut short
  after 12 OIDs, and of a subtree the device does not have.
- `scenario=running`: a walk still running when the page opens.
- `scenario=refused`, `upgrade`: the server refuses a walk (no credentials), the probe is too old to walk.
- `scenario=noprobe`, `template`: a device with no probe, a device linked to an OID Collection Template.
- `role=owner` (default) `|viewer|walker`: everything, reading only, walking but not editing the device.
- `lang=ja|de`, `theme=dark`.

Screenshots of the page at 1280 and 390 pixels, light and dark, in Japanese and German, land in
`output/playwright/snmp-walk-ui/`.
