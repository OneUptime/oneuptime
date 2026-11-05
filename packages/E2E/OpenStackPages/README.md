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
  `?recording=gazpacho-ovs/healthy@1.7.0` is what exporter 1.7.0, which Kolla-Ansible pins,
  said of that same cloud at the same moment, on its own.
  `?recording=hibiscus-ovn/access/reader` is what the exporter answered one credential on a healthy
  cloud, for each level of access the docs describe: `reader`, `monitoring-role` and
  `monitoring-admin-get`. `?recording=hibiscus-ovn/capacity/healthy` is three more hosts, set up
  differently on a real Placement, and `capacity/host-lost` is one of them gone. `&without=volume`
  makes a recording's cloud one with no such service. A service a cloud may not run has a group of
  its own: `?recording=services-heat-magnum/magnum-failed` on its own, or
  `?recording=gazpacho-ovs/healthy&also=services-heat-magnum/access/admin` beside a whole cloud.
- **Made up:** `?estate=busy|calm|forced-down|new|multi-region|overflow|ovn-stale|tenants|parts|links|magnum|usage`
  (`Fixture/Data.js`), built with one builder per kind, each writing what a recording of that kind has. Use one when
  a walk needs what no recording holds: a full pool, a second region, a lost host with 42
  instances on it. Every record is made up, for an "Acme Cloud" workspace.

Every read is answered from one estate's rows. `Fixture/Answers.js` works out the
inventory summary, Needs attention and the blast radius from the rows the way
`OpenStackResourceService` works them out in SQL, down to answering a bigint as text, so an
estate has to say nothing beyond its rows. `Fixture/Links.js` answers what a cloud is elsewhere
in OneUptime the same way, with the real matching rules, from what else the estate holds: its
hosts, Kubernetes nodes, services and Ceph clusters (`OTHER_PRODUCTS` in `Fixture/Data.js`).

A cloud's Traces page reads spans, so it has a recording of its own: `?traces=flamingo-ovn/signed-boot`
is what OSProfiler's driver really sent for a signed boot, through the real reader ingest runs
(`Fixture/TraceRecordings.js`). With none, the cloud has no traces, which is how every cloud starts.

A cloud's logs and change events can be read on top of either: `?logs=epoxy-ovn` is what that real
cloud's services wrote (`Common/Tests/Fixtures/OpenStack/service-logs`), through the ingest's own
stamp and the code that writes a change event (`Fixture/ServiceLogs.js`), with what the default drop
filters take out left out, and the instances, volume and service it wrote about in the inventory
under the IDs they really had. Only the clock moves.

The other scenarios are query parameters (see the top of `Fixture/Fixture.js`):
`?collector=disconnected`, `?quiet=<minutes>`, `?access=project`, `?collection=Probe`,
`?probe=checking|collecting|partial|untrusted|plain-http|gone`, `?probes=many`,
`?tests=ok,untrusted,...` (`connectionTestOutcome` in `Fixture/ProbeCollection.js` has every failure
a test names), `?clouds=none`, `?archived=1`, `?linked=1`, `?role=read|none`,
`?alerts=none|some|all|denied`, `?open=0|1|many|regions`,
`?fail=inventory,attention,regions,consumers,blast,metrics,events`, `?lang=de|fa` and
`?theme=dark`. `?region=` is the product's own. They are read when a page loads, and a
reload reads what the tab was first given: a link inside the product knows nothing of them.

## A cloud a probe collects

`OpenStackDataCollection.spec.ts` connects a cloud from the Dashboard alone: Connect Cloud on
the clouds list, the connection test, the Data Collection cards on the Overview and on Settings,
the switch between a probe and the agent, and what is read beyond the defaults. The clouds list
and Settings are real pages here, so what their forms save is held too: `writeRequests` on
`window.__openStackPagesFixture` records every write, and `Fixture/ProbeCollection.js` keeps what
a page reads back. How each collection went and what each connection test answers are scripted
there, in the words the probe writes, because the probe's own tests read those from real clouds'
recordings. `window.__openStackPagesCollect("collecting")` has the probe report after a page has
loaded, and `window.__openStackPagesRefuseNextWrite("...")` has the server refuse the next save.

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
(`listRequests`, `countRequests`, `itemRequests`, `aggregateRequests`, `apiRequests`,
`writeRequests`), and
`window.__openStackPagesFail("inventory")` makes a read start failing after a page has loaded.
Screenshots are written to `output/playwright/openstack-pages-ui/`.

`node OpenStackPages/Fixture/server.js --watch` rebuilds on every change, for looking at
the pages while working on them.

## What the walks hold

`OpenStackBareMetal.spec.ts`: Ironic on a real DevStack with fake hardware: no trace of it on a cloud without it, its section and alerts on one with it, the Overview naming both failed nodes, the step from the menu to a node's page, a half-enrolled node, what the Services page says of conductors, and a phone. What only a probe reads, and an instance on a node, are in the jsdom suite on rows written by hand.

`OpenStackOptionalServices.spec.ts`: a service a cloud may not run. A cloud without it shows no trace of it in the menu, on Services, on the Overview or in Recommendations, and an old link says so rather than breaking. A cloud with it gets its menu entries, its lists and its part's pages, a failed stack and a failed cluster reach Needs attention by name and land on their own pages, and each page says what the agent can't see, at every width.

`OpenStackManila.spec.ts`: Manila, the same way: no trace on a cloud without it, its shares under Storage on one with it, a share in error from Needs attention to its own page, its API stopped, Topology, and every width.

`OpenStackTrove.spec.ts`: Trove, the same way, and a credential it refuses, which reads just as its API stopped does: closed, with no alerts offered and no red anywhere.

`DeploymentGuides.spec.ts`: the setup guide's one question, how do you deploy OpenStack, each answer's steps and how far it says it has been tested, what a tool a probe reads leaves out, and every width.

`ExporterVersions.spec.ts`: the Overview and each list on what the agent's own exporter and exporter 1.7.0 said of one cloud: less to say on 1.7.0, and nothing false.

`Overview.spec.ts`: a cloud's Overview busy, calm, new, in several regions, quiet for days
and with its inventory and metric reads failing, at 1280, 1024, 768 and 390 pixels, dark,
German and Persian.

`OpenStackProjectsAndTopology.spec.ts`: Projects with quota data (`?estate=tenants`, a project
at 90% of a quota and a nova-compute stopped under two projects) and without it (`?estate=calm`,
which is most clouds), a project's page and who is told, Domains, a list opened on a project, and
the Topology with that host red. No recorded project is at 90% of a quota, so `tenants` is made up in the
shape the snapshot scan writes.

`OpenStackPartPages.spec.ts`: the compute, network and storage lists and part pages, the step
from a row to its page and the steps between parts (an instance to its hypervisor, a volume to its
instance, a floating IP to its router), on what real clouds' exporters answered: a stopped
nova-compute, a stopped L3 agent, OVN's routers and the exporter's snapshot count. `?estate=busy`
holds a full pool, a full external network and a stuck volume, and `?estate=parts` is busy with hosts
in zones and aggregates, a stuck image and the rows only the probe sends, which no recording holds.

`OpenStackInstanceUsage.spec.ts`: what is really busy, as apart from what is promised: a hypervisor
past its line naming the instances responsible, the step to the busiest one's page, its tiles and
charts beside its flavor's size, a phone and the dark theme. `?estate=usage` is made up to put it over
a line: what real clouds really said goes through the same pages in
`Common/Tests/App/Dashboard/OpenStackUsagePagesRecordings.test.tsx`. `?estate=calm` has no source, so
each page says what is missing and how to add it. And what it costs on a cloud's Settings.

`OpenStackCapacity.spec.ts`: the Capacity page on what real clouds' exporters answered (a host's real ratio and reservation, a stopped nova-compute, a disabled one) and on `?capacity=short`, made up in the snapshot's own shape: a fragmented estate, a zone that can't lose a host, a forecast, an orphaned allocation and a probe's answer. It reads one row whatever the estate, and fits a phone.

`Services.spec.ts`: the Services list and a service's page on ML2/OVS and OVN, on what real
clouds' exporters answered, each failure drill by name and in its own words, and a service
someone disabled raising nothing.

`OpenStackLogs.spec.ts`: on what real clouds' services wrote, a failed build from its instance's
page to the scheduler's line in two clicks, which services a request reached and which it could
not be followed to, and what happened to an instance, a volume and a compute service on each one's
Feed.

`OpenStackLinks.spec.ts`: a cloud joined to the rest of OneUptime (`?estate=links`, every record
made up): a hypervisor and the host on its machine with its real load beside what Nova has
promised, an instance and the host, Kubernetes node and services it also is, each one's way
there and back, a Ceph-backed pool and its cluster's trouble in Needs attention, what someone
answers about a pool and how they change it, and a failed hypervisor's blast radius past the
cloud. Beside each of those the same names twice over, which must link to nothing from either
end. A host's, a Kubernetes node's and a service's page are the real card on a bare page here,
and `HostPages`, `KubernetesPages` and `ResourceOverviews` hold that their real pages mount it.
Whether the server's SQL says the same is `OpenStackAcrossProductsPostgres.test.ts`, on what a
real DevStack answered.

`OpenStackProductArea.spec.ts`: the clouds list and Archived, archive from a row and from Settings,
delete, an owner added from the cloud's page, labels added from the list, the rule pages and their
forms, and what a cloud's Incidents, Alerts and Scheduled Maintenance pages list when one of each is
linked to it and one is not (`?linked=1`). `?role=read` is a custom role holding only the OpenStack
read permissions, and `?role=none` one holding none: every read and write is then held to the
model's own lists of who may, the lists the server's checks read, whose real gates have a test
of their own (`OpenStackCustomRoleGrants.test.ts`). A write is recorded, and what a page reads back
of the product's own tables is kept.

`OpenStackAccessLevels.spec.ts`: every page, on what the exporter really answered each level of
access: which say "This credential can't list...", which say a list is its own project's, and that
Full view says neither. A 403, an own-project 200 and a service that isn't deployed, on all five
releases where it matters.
