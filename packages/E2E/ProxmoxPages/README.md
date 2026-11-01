# Proxmox pages fixture

An offline harness for a Proxmox VE cluster's pages
(`packages/App/FeatureSet/Dashboard/src/Pages/Proxmox/View`): the cluster's
Overview, its Nodes, Guests and Storage lists, the pages of a node, a guest
and a storage (`Components/Proxmox/Part`, built on the shared
`Components/ResourcePart`), Recommendations and the setup guide. It bundles
the production cluster layout and side menu with esbuild, replaces only the
`ModelAPI` / `AnalyticsModelAPI` / `API` / `Realtime` data boundary and the
signed-in user, and serves them on `127.0.0.1:4661`
(`PROXMOX_PAGES_FIXTURE_PORT` to change it). No Docker, no database, no
sign-in. Every record is made up, for an "Acme Virtualization" workspace
(`Fixture/Data.js`).

```sh
cd packages/E2E
npm run test-proxmox-pages-ui
```

The suite reads the pages the way an administrator does:

- the Overview: what needs attention first, critical before what to look at,
  each with why (offline, unavailable, HA error, stopped but starts on boot,
  nearly full, last backup failed, in no backup job, replication failing),
  six rows and the rest one click away, each row one step from its part's
  page; each node's state and load, the down one first; how the last backups
  went; a cluster that has never sent Proxmox VE's notifications pointing at
  the guide's last step; a calm cluster saying nothing, a disconnected one
  not trusting its last snapshot, twenty-four nodes shown eight at a time,
  and a failed read said as such;
- a node's page: its status, where it sits, its chips (cores, memory,
  subscription), what on it needs a look, its tiles, the guests keeping it
  busy, what is open on it, the node alerts with "Turn on N alerts" opening
  Recommendations with exactly those selected (`?select=`), its details and
  its Guests tab;
- a guest's page: its node (a link), tags, a failed last backup, its open
  alert, the guest alerts, a guest locked by a backup and a template;
- a storage's page: how full, how long until full, shared or local,
  available or not, and the storage alerts;
- the Guests list's Backup column;
- a phone (390 wide: nothing scrolls sideways), dark mode (`?theme=dark`),
  German (`?lang=de`) and Persian (`?lang=fa`, right to left).

The scenarios are query parameters: `?estate=busy|calm|new|large|native`,
`?collector=disconnected`, `?alerts=none|some|all|denied`,
`?open=0|1|many`, `?fail=inventory|metrics|events`,
`?notifications=off`, `?lang=de|fa` and `?theme=dark` (see the top of
`Fixture/Fixture.js`).

`Fixture/Fixture.js` records every read on `window.__proxmoxPagesFixture`
(`listRequests`, `countRequests`, `itemRequests`, `aggregateRequests`,
`apiRequests`) and anything it does not model in `unhandled`, which the suite
keeps empty. No request may leave `127.0.0.1`. Screenshots are written to
`output/playwright/proxmox-pages-ui/`.

`node ProxmoxPages/Fixture/server.js --watch` rebuilds on every change, for
looking at the pages while working on them.
