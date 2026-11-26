# XCP-ng pages fixture

An offline harness for an XCP-ng pool's pages
(`packages/App/FeatureSet/Dashboard/src/Pages/XcpNg/View`): the pool's
Overview, its Hosts, VMs and Storage lists, the pages of a host, a VM and a
storage repository (`Components/XcpNg/Part`, built on the shared
`Components/ResourcePart`), the Topology, Recommendations and the setup
guide. It bundles the production pool layout and side menu with esbuild,
replaces only the `ModelAPI` / `AnalyticsModelAPI` / `API` / `Realtime` data
boundary and the signed-in user, and serves them on `127.0.0.1:4672`
(`XCP_NG_PAGES_FIXTURE_PORT` to change it). No Docker, no database, no
sign-in. Every record is made up, for an "Acme Virtualization" workspace
(`Fixture/Data.js`), mirroring the recorded lab the agent's tests read
(`Tests/Ops/Fixtures/XcpNg/XenOrchestraScrape.js`).

```sh
cd packages/E2E
npm run test-xcp-ng-pages-ui
```

The suite reads the pages the way an administrator does:

- the Overview: what needs attention first - a halted host, a disabled one
  (grey: someone's choice), a storage repository nearly full and allocated
  past its size, a VM that stopped after running - each row one step from
  its part's page; the counts and the pills that open what is wrong among
  them; the tiles; the busiest VMs and hosts (never a control domain); every
  host and repository at a glance; a calm pool saying nothing, a brand-new
  one saying how to connect it, one Xen Orchestra stopped reporting or that
  is disconnected not trusting its last inventory, twenty-four hosts shown
  eight at a time, and a failed read said as such;
- the lists: a disabled host saying so under its state, the control domains
  left out of the VMs until the switch shows them, the storage repositories
  shared or a host's and over-provisioned;
- a host's, a VM's and a storage repository's page: where it sits, what on
  it needs a look, what is open on it, its virtual disks, and a host's
  Metrics tab reading only that host (`xcp_ng.id`);
- the Topology and the setup guide;
- a phone (390 wide: nothing scrolls sideways), dark mode (`?theme=dark`),
  German (`?lang=de`) and Persian (`?lang=fa`, right to left).

The scenarios are query parameters: `?estate=busy|calm|new|large`,
`?collector=disconnected|stopped`, `?alerts=none|some|all`, `?open=0|1`,
`?fail=inventory|metrics`, `?lang=de|fa` and `?theme=dark` (see the top of
`Fixture/Fixture.js`).

`Fixture/Fixture.js` records every read on `window.__xcpNgPagesFixture`
(`listRequests`, `countRequests`, `itemRequests`, `aggregateRequests`,
`apiRequests`) and anything it does not model in `unhandled`, which the suite
keeps empty. No request may leave `127.0.0.1`. Screenshots are written to
`output/playwright/xcp-ng-pages-ui/`.

`node XcpNgPages/Fixture/server.js --watch` rebuilds on every change, for
looking at the pages while working on them.
