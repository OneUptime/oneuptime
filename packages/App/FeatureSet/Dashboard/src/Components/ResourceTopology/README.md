# Resource topology

One map for every resource that holds other things: a vCenter, a Kubernetes
cluster, a host, a Docker or Podman host, a Docker Swarm, Proxmox or Ceph
cluster, a storage array and a cloud account. Each product's **Topology** page
is `ResourceTopologyPage` over the graph its builder makes, so they all look
and work the same way.

## How the map reads

- **A tree, never a box inside a box.** The resource sits at the top. Each
  part's parts stand in the column after it, joined to it by a line; a part
  is never drawn inside another. The column a part stands in says how deep it
  sits: a cluster, then its nodes, then their pods; a host, then its virtual
  machines.
- **Groups are headings, not frames.** A part's parts are grouped by kind
  under a small heading ("ESXi Hosts 4 · 1 needs attention"). A heading never
  holds another heading: a part's own parts hang off that part.
- **Health at a glance.** A healthy card is plain, one that needs attention is
  tinted amber and a critical one red. A part that holds others says what
  (`4 ESXi Hosts · 36 Virtual Machines`), counts what needs attention inside
  it, and draws a bar of how its insides are doing. The line to a group is red
  or amber when something that needs attention lies that way, so the eye can
  follow it to the problem; the path to the part someone picked is indigo.
- **The way to trouble opens by itself.** The first view opens level by level
  as far as the canvas shows readably (`ResourceTopologyFit`), and below the
  resource only parts with something that needs attention inside open
  (`opensByItself`). A healthy branch stays one closed card.
- **Room for anything.** Each group shows a few parts, troubled ones first,
  and folds the rest into "+ N more". Closed parts flow into rows; the row
  length is chosen once, for the first view, so opening a part never moves the
  rest. Zoomed far out, cards keep only their name and colour.
- **Keyboard and screen readers.** Every part is a button named after what it
  is and how it is doing. On a part, the arrow keys move through the tree:
  up and down between the parts beside it, forward (right, or left on a page
  read from right to left) opens it and goes in, back closes it and goes out.
  The **List** view draws the same view as an outline.

## Adding a product's nodes and groups

1. **Kinds.** Add the product's kinds to `ResourceTopologyKinds.ts`: an
   English label and plural (inside `translationKey`), an icon, a colour and
   an `order` among siblings. Groups are made from kinds: every child of one
   kind lands under one heading, in kind order.
2. **Builder.** Add `Builders/<Product>Topology.ts`, a pure function from the
   product's inventory rows to `buildResourceTopologyGraph({ rootId, nodes,
   relations, issues, truncations })`.
   - Each node is one part: `id`, `parentId` (what holds it: containment is
     the tree), `kind`, `name`, `health` (`critical`, `warning`, `healthy`,
     `off`, `unknown`), a short `status`, `reasons` it needs attention, up to
     two `facts` for its card ("CPU 22%"), a `link` to its own page, and
     `context` and `keywords` for the search.
   - A part with no record of its own that only groups others ("Hardware",
     "Not on a node") is a section: `isSection: true`, `kind: SECTION_KIND`,
     its English name translated when shown. It stands in its column like a
     card, with no heading over it.
   - What crosses the tree (a pod runs on a node, a service calls a
     database) is a relation, with a `label` read from `from` and an
     `inverseLabel` read from `to`. Relations between a part and one that
     holds it are dropped: the tree already says so.
   - Open incidents and alerts are attached by `attachOpenIssues`.
3. **Loader and page.** Add `Loaders/<Product>TopologyLoader.ts` and
   `Pages/<Product>/View/Topology.tsx` with `ResourceTopologyPage`, plus its
   `PageMap`/`RouteMap` entries and side menu item.
4. **Arrangements and lanes.** A product that reads two ways (a cluster's pods
   by workload or by node) passes several arrangements; the page offers
   **Group by**. A map about calls (a host's) sets `alwaysShowRelations`, a
   `relationLegend`, and `lanes`: sections drawn beside the tree (callers
   before it, what it calls after it), always open, each part lined up with
   what it calls or is called by.
5. **Tests.** Builders are pinned in `packages/App/Tests/Dashboard/ResourceTopology*`;
   the layout rules in `ResourceTopologyLayout.test.ts`; the browser suite in
   `packages/E2E/ResourceTopology` (add the product to its fixture).
