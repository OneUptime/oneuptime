# Cloud's Overview and Spend pages: shots

How these were made: the offline browser suite `packages/E2E/CloudSpend`
(`npm run test-cloud-spend-ui`) bundles the real Cloud route group with the
Dashboard's esbuild config, Tailwind, theme and font, over five made-up
accounts on three clouds whose costs are worked out day by day as the
server works them out. Each shot is a full page in Chromium, taken by the
suite's own tests; the suite writes the rest of its shots to
`output/playwright/cloud-spend-ui`.

- `cloud-overview-1280`: Cloud > Overview, Cloud's landing page: the strip,
  Needs attention over every account, Spend beside Ways to spend less, the
  accounts the most costly first, and the App Platforms environments in them.
- `cloud-overview-1280-dark`, `cloud-overview-1280-de`: the same, dark, and in
  German.
- `cloud-overview-390`, `cloud-overview-390-fa`: on a phone, and in Persian
  (right to left; an English service name cut at its end, not its start).
- `cloud-overview-1280-empty`: a project with no cloud account.
- `cloud-overview-1280-unread`: accounts connected, no costs read yet: what
  each cloud needs, nothing that reads as costing nothing.
- `cloud-costs-1280`, `cloud-costs-390`: Cloud > Spend > Costs: the month so
  far, where it is heading, last month and what could be saved; 30 days of
  spend; where the money goes; the accounts left out, with why.
- `cloud-costs-1280-failed`: a costs card whose read failed, with Refresh.
- `cloud-account-costs-1280`: an account's Costs tab.
- `cloud-savings-1280`: Cloud > Spend > Savings.
- `cloud-budgets-1280`: Cloud > Spend > Budgets: each budget's month and how
  it is doing.
- `cloud-budgets-1280-create-2`: a budget's second step, when it alerts.
- `cloud-budgets-1280-disable`: Disable asks first, saying what a disabled
  budget does not do.
- `cloud-budgets-390-fa`: Budgets on a phone in Persian, the team's English
  description kept in its own direction.
