# Security case actions: screenshots

Before and after shots for the pull request that gives every list of security
cases its row and bulk moves (Assign to Me, Assign to Someone Else, Change
Status, Change Priority).

- `before-row-menu.png`: the maintainer's screenshot of a case row's ⋯ before
  the change, with Delete alone.
- `after-*.png`: the offline SecurityOperations fixture
  (`packages/E2E/SecurityOperations`) on its synthetic month, at 1x, 1344
  pixels wide (production's 1280 beside the fixture's page padding) or 390 for
  a phone: a row's ⋯, Assign to Someone Else's picker, Change Status into
  Closed from a row, Bulk Actions and its result with a case the server
  refused (`?refuse=138`), the case header's ⋯, and a row's ⋯ on a phone in
  the dark theme.

The offline suite takes the same views at 2x, at 1280 and 390 in both themes
(`cases-row-menu-*`, `cases-assign-dialog-*`, `cases-assign-picker-*`,
`cases-bulk-actions-*`, `cases-bulk-assign-result`).

- `review-*-before.png` / `review-*-after.png`: the UI review's pairs, from
  the same fixture with Inter loaded, at 2x and 1280 pixels wide (the refused
  pair at 1x): a row's ⋯ (`row-menu`: "Assign to Someone Else" balanced over
  two lines), Change Status's list opening on the case's own status
  (`current`: a quiet grey row, not the indigo of a pick), a row's Assign to
  Me the server refuses (`refused`: the list's own dialog, the next rows'
  action cells no longer drawn over its backdrop) and a row's ⋯ in Persian
  (`rtl-menu`: each icon's gap on its label's side).
