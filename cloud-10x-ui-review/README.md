# Cloud's Overview, Spend and resource pages after the UI review

How these were made: the offline fixture of `packages/E2E/CloudSpend`
(`node CloudSpend/Fixture/server.js`), which bundles the real Cloud route
group, its layout, side menus and pages with the Dashboard's esbuild
config, Tailwind, theme and Inter, over five made-up accounts on three
clouds. Each shot is drawn at its width with the window as tall as the
page (so the sticky side menu sits at the top, as a reader sees it), in
Chromium. The "before" shots are `.github/pr-assets/cloud-10x`, as the
builder left them.

- `cloud-costs-1280`, `cloud-costs-1280-dark`: Daily spend draws the newest
  day, which a cloud reports late and in part, lighter and named in the
  legend; the accounts the figures leave out are "Accounts left out".
- `cloud-costs-390-fa`: the same on a phone in Persian.
- `cloud-costs-1280-empty`: Costs with no account says what shows there.
- `cloud-savings-1280`, `cloud-savings-390`: each way to spend less as a
  person says it - what to do and what it changes, to which resource, what
  it saves a month, in which account; no Kind column repeating the action.
- `cloud-budgets-1280`: a budget's amount as it was set ($0 of $500).
- `cloud-budgets-1280-alert-at`: Alert At that is not a list of percents is
  said before the budget is saved.
- `cloud-resource-1280`, `cloud-resource-390`: a resource's page leads with
  what needs attention, then its numbers, then its ways to spend less
  (AWS bills it by service and Region only), before its Details.
- `cloud-resource-billed-1280`: a Compute Engine instance its billing export
  names: what it cost this month and in the last 30 days.
- `cloud-account-overview-1280`: an account's Overview leads with what needs
  attention, and says what it cost this month, a click from its Costs.
- `cloud-overview-1280-unread`: an account whose costs are not read yet
  says so at its row's end.
- `cloud-overview-1280-empty`: the example's daily spend covers the last 30
  days, not the last hour.
- `cloud-overview-390-fa`: Persian, the savings' resource lines starting
  under their actions.
