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

The UI review's shots are `review-<name>-before.png` (the branch as it was
built, at 9065217bcc) and `review-<name>-after.png` (after the review), from
the same lab, its SMS numbers drawn as phone numbers:

- `review-smtp-emails-1280-*`: a value cut short runs to its column's end
  ("grace@acme-commerce.examp...", not "grace@acme-...").
- `review-twilio-numbers-1280-de-*`: a Twilio config's numbers stay whole;
  "+2 weitere" goes under the number where the column is narrow.
- `review-postmortem-rules-1280-de-*`: the postmortem rules fit their card
  in German, Status in sight.
