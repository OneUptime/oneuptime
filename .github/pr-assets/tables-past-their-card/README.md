# Tables that run past their card: before and after

Screenshots for the pull request "Tables give way before they scroll". Each
`<name>-before.png` is master at bdd9534466, each `<name>-after.png` this
branch.

- The Dashboard pages (incidents, on-call schedules, runners, postmortems,
  owner rules, VMware resource pools, the Rule Library, Runbooks, the
  scheduled maintenance list) were drawn by a lab bundle of the real
  Dashboard routes over generated data: one bundle built from master, one
  from the branch, the same data, viewport-sized shots at 1x.
- `widget-incidents-6-units-*` is the DashboardWidgetSort fixture's
  incident list widget, 6 units wide, with a long incident title (master's
  fixture has the title set in the page; the branch's fixture takes
  `?titles=long`).
- `kubernetes-events-768-*` is the KubernetesEvents fixture's Events page at
  768px, beside the cluster's side menu.
- `plain-table-edge-*` is the ModelTables fixture's table drawn without a
  card (`?table=plain`), its top edge at 3x.
