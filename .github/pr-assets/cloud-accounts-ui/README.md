# Cloud accounts: the UI review's before and after

Screenshots for the pull request "Cloud accounts" (#5300). Each
`<name>-before.png` is the branch as its builder left it (79d277f60a), each
`<name>-after.png` the branch after its UI review; both drawn from the same
data.

- The Cloud pages (Cloud > Accounts, an account's Overview, Resources,
  Changes, Settings and Topology, a cloud resource's Overview, and the
  Connect form) were drawn by the offline Cloud Connect fixture
  (`packages/E2E/CloudConnect`, `?state=connected`, `&lang=de`,
  `&theme=dark` where the name says so), the "before" from a copy of the
  builder's commit with the review's fixture data.
- `monitor-linked-resources-1440-*` is the offline Monitor Overview
  fixture's website monitor with `?cloud=suggest`, its Linked Resources
  card (and, before, the separate card under it) at 2x, with Inter loaded.
- The phone shots (`*-390-*`) are at 2x; the rest at 1x.
