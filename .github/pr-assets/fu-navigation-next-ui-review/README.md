# Navigation, next: UI review shots

Screenshots for the UI review of PR #5524 (a row's page lights its list in
every side menu, long words alone hyphenate, a count moves under a title it
cannot share a line with, the Topology Map's trail). Each was taken in
headless Chromium from the offline fixtures in `packages/E2E` (Proxmox Pages,
Docker Swarm Pages, Topology, Rules Menu Section), with the Dashboard's Inter
font where the fixture serves it. "Before" is master's code in the same
fixture, "after" is this branch.

- `proxmox-node-menu-1280-*`: a node's page beside the cluster's menu. Before,
  nothing in the menu was lit on a node's page. After, Nodes is lit, as the
  list the page is one row of (`aria-current="true"`).
- `proxmox-node-menu-768-*`: the same menu beside a tablet's 224 pixel menu.
  Before, "Recommendations" broke as "Recommendatio / ns", with no hyphen,
  beside its count. After, the word stays whole and its count moves under it,
  to the row's end; every other count keeps its title's line.
- `proxmox-node-phone-button-*`: the phone's menu button on a node's page.
  Before, it read the trail's "Node Detail". After, it names where the reader
  is in the menu: "Resources / Nodes", with the list's icon.
- `docker-swarm-task-phone-menu-de-*`: a Swarm task's page on a phone, in
  German, with the menu open: "Task-Details" and nothing lit before;
  "Workloads / Aufgaben" with Aufgaben (Tasks) lit after.
- `docker-swarm-task-trail-de-1280-*`: the same page's trail in German. Before,
  "Aufgaben > Task-Details" named the list and its row in two languages, with
  nothing lit in the menu. After, "Aufgaben > Aufgabendetails", Aufgaben lit.
  Twenty-three such row crumbs in fourteen languages now use their list's
  word (an OpenShift route's in ten).
- `topology-map-trail-1280-*`: the Topology Map had no trail. After:
  Project > Inventory > Topology Map, as the Inventory menu beside it names it.
- `proxmox-node-menu-768-fa-dark.png`: the node page's menu in Persian, dark,
  at 768: the lit list and its rail at the reading start, counts at the end.
- `status-page-menu-de-768-dark.png`: a status page's menu in German, dark, at
  768: "Benachrichtigungsprotokolle" alone may be hyphenated; "Benutzerdefinierte
  Domains" breaks between its words.
