# Resource Topology fixture

An offline harness for every resource's Topology page and the master
Topology that links into them: a vCenter, a Kubernetes cluster, a host, a
Docker and a Podman host, a Docker Swarm, Proxmox and Ceph cluster and a
storage array (`packages/App/FeatureSet/Dashboard/src/Pages/*/View/Topology.tsx`,
drawn by `Components/ResourceTopology`), each inside its production product
layout and side menu, and Topology → Infrastructure
(`Pages/Topology/TopologyPage.tsx`). It bundles the production pages with
esbuild, replaces only the `ModelAPI` / `API` data boundary, and serves them
on `127.0.0.1:4437`. No Docker, no database, no sign-in.

```sh
cd packages/E2E
npm run test-resource-topology-ui
```

The synthetic estate (`Fixture/FixtureData.js`, seeded so every run draws the
same thing) has a vCenter of two datacenters with a cluster that has a host
that is not effective, a swapping and a contended virtual machine and two
nearly full datastores; a cluster of five namespaces and six nodes with a
deployment that has no ready replica and a node that is not ready; a host whose services
are called from elsewhere and call a database and a failing payments
service; and a few troubled parts in each of the other six. Open incidents
and alerts are linked to the resources the way monitors link them, with the
series labels that name the part.

The suite drives the pages the way a person does:

- a vCenter's first view framed at a readable zoom: the resource at the top,
  the datacenter with trouble inside open by itself and the healthy one a
  closed card, what needs attention counted on each closed card; Needs
  attention down to the troubled parts and the path to them; a search that
  finds a virtual machine anywhere and its panel, with the link to its own
  page; a host focused on, drawn with what is inside it and nothing else; a
  cluster opened (its hosts after it, joined by a line, framed with it) and
  closed; a large vCenter's datastores folded into "+ 12 more" and shown in
  full;
- a tree of cards, never a box inside a box: no part drawn inside or over
  another on any product's map, the line to trouble red and the rest grey,
  the way to a picked part lit, the arrow keys moving through the tree,
  opening and closing parts, the small print gone when zoomed far out, and a
  large cluster's forty nodes shown in full at once;
- a Kubernetes cluster read by workload and by node, and a picked pod's line
  to the node it runs on;
- a host read left to right: what calls it, the host, what it calls, every
  call drawn with its rate;
- the other six resources, and a cloud account, drawn from their own
  inventories;
- the master Topology opened on a vCenter, a cluster and a host from their
  maps, each offering the way back ("Open vCenter topology");
- a phone's list, dark mode, German, and Persian (the tree and a host's lanes
  mirrored, the left arrow going in); an empty inventory, a failed read tried
  again, and incidents and alerts the reader may not see.

Every test fails on a page error and on any request the fixture does not
model (`window.__resourceTopologyFixture.unhandled`).

Scenarios are query parameters on any page: `?estate=normal|large|quiet|empty`,
`?issues=on|off|denied`, `?fail=topology` (the first inventory read fails),
`?lang=de|fa` and `?theme=dark`. Screenshots land in
`output/playwright/resource-topology-ui/*-synthetic.png`.

To look at a page by hand, start the server and open a URL:

```sh
node ResourceTopology/Fixture/server.js
# http://127.0.0.1:4437/dashboard/10000000-0000-4000-8000-000000000001/vmware/31000000-0000-4000-8000-000000000001/topology
```
