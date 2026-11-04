# OpenStack pages fixture

An offline harness for an OpenStack cloud's pages
(`packages/App/FeatureSet/Dashboard/src/Pages/OpenStack/View`). It bundles the production
cloud layout and side menu with esbuild, replaces only the `ModelAPI` / `AnalyticsModelAPI`
/ `API` / `Realtime` data boundary and the signed-in user, and serves them on
`127.0.0.1:4662`. No Docker, no database, no sign-in.

```sh
cd packages/E2E
npm run test-openstack-pages-ui
```

To run beside another run, give it a port, a bundle and a results folder of its own, because
a run empties its results folder when it starts: `OPENSTACK_PAGES_FIXTURE_PORT`,
`OPENSTACK_PAGES_FIXTURE_OUTPUT` and Playwright's `--output`.

## What a walk reads

A page is read on what real clouds say. There are two kinds of estate, and a page cannot
tell them apart:

- **Recordings:** `?recording=gazpacho-ovs/compute-down` is what that real cloud's exporter
  answered (`Common/Tests/Fixtures/OpenStack`), read through the real snapshot scan
  (`Fixture/Recordings.js`), the code the telemetry ingest runs. Every recording is there
  without a change here. Use one when a walk is about what OpenStack really says: a
  release's agent names, Nova's short and full host names, a floating IP's labels. A drill
  reads on top of its cloud's healthy recording, as the rows OneUptime holds would: a
  stopped API's scrape says nothing of its workers, whose rows stay as they last were.
- **Made up:** `?estate=busy|calm|new|multi-region|overflow|ovn-stale|tenants|parts`
  (`Fixture/Data.js`), built with one builder per kind, each writing what a recording of that kind has. Use one when
  a walk needs what no recording holds: a full pool, a second region, a lost host with 42
  instances on it. Every record is made up, for an "Acme Cloud" workspace.

Every read is answered from one estate's rows. `Fixture/Answers.js` works out the
inventory summary, Needs attention and the blast radius from the rows the way
`OpenStackResourceService` works them out in SQL, down to answering a bigint as text, so an
estate has to say nothing beyond its rows.

The other scenarios are query parameters (see the top of `Fixture/Fixture.js`):
`?collector=disconnected`, `?quiet=<minutes>`, `?access=project`, `?collection=Probe`,
`?alerts=none|some|all|denied`, `?open=0|1|many`,
`?fail=inventory,attention,regions,consumers,blast,metrics,events`, `?lang=de|fa` and
`?theme=dark`. `?region=` is the product's own. They are read when a page loads, and a
reload reads what the tab was first given: a link inside the product knows nothing of them.

## Adding to it

- **A page:** import it in `Fixture/Fixture.js` and add a line to `PAGES`.
- **Data:** write rows with the builders in `Fixture/Data.js` (`hypervisor()`,
  `instance()`, `volume()`, ...), in an estate's function or in a new entry of `ESTATES`.
- **A metric a chart reads:** a `case` in `seriesOf` in `Fixture/Fixture.js`.
- **A walk:** a `.spec.ts` of its own in this folder, importing `test` and `expect` from
  `./Helpers`. Every spec here runs under the same rules: a page that throws, a request
  that leaves `127.0.0.1` or a read the fixture does not model (`unhandled`) fails the
  test.

`Fixture/Fixture.js` records every read on `window.__openStackPagesFixture`
(`listRequests`, `countRequests`, `itemRequests`, `aggregateRequests`, `apiRequests`), and
`window.__openStackPagesFail("inventory")` makes a read start failing after a page has loaded.
Screenshots are written to `output/playwright/openstack-pages-ui/`.

`node OpenStackPages/Fixture/server.js --watch` rebuilds on every change, for looking at
the pages while working on them.

## What the walks hold

`Overview.spec.ts`: a cloud's Overview busy, calm, new, in several regions, quiet for days
and with its inventory and metric reads failing, at 1280, 1024, 768 and 390 pixels, dark,
German and Persian.

`OpenStackProjectsAndTopology.spec.ts`: Projects with quota data (`?estate=tenants`, a project
at 90% of a quota and a nova-compute stopped under two projects) and without it (`?estate=calm`,
which is most clouds), a project's page and who is told, Domains, a list opened on a project, and
the Topology with that host red. No recording holds a quota series, so `tenants` is made up in the
shape the snapshot scan writes.

`OpenStackPartPages.spec.ts`: the compute, network and storage lists and part pages, the step
from a row to its page and the steps between parts (an instance to its hypervisor, a volume to its
instance, a floating IP to its router), on what real clouds' exporters answered: a stopped
nova-compute, a stopped L3 agent, OVN's routers and the exporter's snapshot count. `?estate=busy`
holds a full pool, a full external network and a stuck volume, and `?estate=parts` is busy with hosts
in zones and aggregates, a stuck image and the rows only the probe sends, which no recording holds.

`Services.spec.ts`: the Services list and a service's page on ML2/OVS and OVN, on what real
clouds' exporters answered, each failure drill by name and in its own words, and a service
someone disabled raising nothing.
