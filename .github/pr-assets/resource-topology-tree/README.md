# Resource topology as a tree of cards (block 50)

How these were made: the production Topology page of each resource - a vCenter, a Kubernetes
cluster, a host, a Docker and a Podman host, a Docker Swarm, a Proxmox and a Ceph cluster, a
storage array and a cloud account - inside its product layout and side menu, bundled by
`packages/E2E/ResourceTopology/Fixture/server.js` and drawn in headless Chromium with the
Dashboard's Tailwind runtime and the Inter font, at 1280 pixels wide (two at 390), 1x. The
fixture replaces only the API, over a synthetic estate (`?estate=large` for the large ones,
`?theme=dark`, `?lang=de|fa`).

`before-*` is master at 30ce30a228 (the map drew each open part as a box holding its parts, boxes
inside boxes). `after-*` is this PR.

- `before-<product>-1280.png` / `after-<product>-1280.png`: each resource's first view. The
  resource sits at the top, each part's parts stand in the column after it, joined by a line that
  is red or amber where trouble lies; the branch with trouble in it is open, a healthy branch is
  one closed card that says what it holds and how its insides are doing.
- `after-cloud-1280.png`: a cloud account (no `before`: it drew the same boxes).
- `after-vmware-quiet-1280.png`, `after-kubernetes-quiet-1280.png`: a calm estate. With room to
  spare, the vCenter's healthy datacenters open too; the cluster's first level already fills it.
- `after-*-dark.png`, `after-vmware-1280-de.png`, `after-*-fa.png`: dark mode, German, and Persian,
  where the tree is mirrored.
- `after-vmware-390.png`, `after-kubernetes-390-dark.png`: the map on a phone (a phone opens on the
  list; these are its Map).
- `after-*-large-1280.png`: a vCenter of thousands of virtual machines and a cluster of 1,642 parts.
- `after-vmware-needs-attention.png`, `after-vmware-picked-path.png`,
  `after-vmware-keyboard.png`, `after-kubernetes-node-focus.png`: Needs attention, the way to a
  picked part lit, the arrow keys opening Frankfurt, and a node focused with the pods it runs.
