# Host pages fixture

An offline harness for the Hosts product's pages
(`packages/App/FeatureSet/Dashboard/src/Pages/Host`): the Hosts list - its
fleet Needs attention card and its Status, CPU, Memory and Disk columns - and
a host's own Overview (hero, Needs attention, tiles, Host alerts, charts,
Filesystems, Details) with the Recommendations page "Turn on N alerts" opens.
It bundles the production Hosts layout and side menu and the host's own
layout with esbuild, replaces only the `ModelAPI` / `AnalyticsModelAPI` /
`API` / `Realtime` data boundary and the signed-in user, and serves them on
`127.0.0.1:4683` (`HOST_PAGES_FIXTURE_PORT` to change it). No Docker, no
database, no sign-in. Every record is made up, for an "Acme Infrastructure"
workspace (`Fixture/Data.js`).

```sh
cd packages/E2E
npm run test-host-pages-ui
```

The suite reads the pages the way someone who runs servers does:

- the Hosts list: which hosts need attention first, critical before what to
  look at, each with why (a filesystem or its inodes nearly full, memory or
  swap short, more work queued than cores, failed systemd units, a collector
  config that did not start, a host gone quiet and since when), each row one
  step from the host's page; a calm fleet drawing no card, a project with no
  hosts reading no fleet, sixty hosts shown six at a time, and a failed read
  said as such, with Refresh;
- each host's row: its health in a word (Healthy, Degraded, Unhealthy, Not
  reporting, Starting, Reporting) with the reason under it, and its CPU,
  memory and fullest disk as bars coloured where Needs attention draws its
  lines, the table fitting its card at a laptop's width;
- a host's Overview: its health beside its collector's pill, how long it has
  been up, what on it needs a look (its filesystems, its own memory, swap and
  load, each failed systemd unit opening its page, a failed collector config
  opening the Collector page), its tiles, its Host alerts with "Turn on N
  alerts" opening Recommendations with exactly those selected (`?select=`),
  and Details; a host that stopped reporting showing its connection card
  rather than a stale health, and one still starting no health at all;
- a phone (390 wide: nothing scrolls sideways), dark mode (`?theme=dark`),
  German (`?lang=de`) and Persian (`?lang=fa`, right to left: a mount keeps
  its slashes where they were written).

The scenarios are query parameters: `?fleet=busy|calm|new|large`,
`?alerts=none|some|denied`, `?fail=attention`, `?lang=de|fa` and
`?theme=dark` (see the top of `Fixture/Fixture.js`).

`POST /host/needs-attention` answers as `HostService
.findHostsThatMayNeedAttention` does: every host past one of HostHealth's
lines, which the Dashboard then judges.

`Fixture/Fixture.js` records every read on `window.__hostPagesFixture`
(`listRequests`, `countRequests`, `itemRequests`, `aggregateRequests`,
`apiRequests`) and anything it does not model in `unhandled`, which the suite
keeps empty. No request may leave `127.0.0.1`. Screenshots are written to
`output/playwright/host-pages-ui/`.

`node HostPages/Fixture/server.js --watch` rebuilds on every change, for
looking at the pages while working on them.
