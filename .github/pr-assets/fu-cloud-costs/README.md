# fu-cloud-costs: screenshots

Cloud follow-ups (#5300), part 3: cloud costs and right-sizing, drawn by the
offline Cloud Spend and Cloud Connect fixtures (`packages/E2E/CloudSpend`,
`packages/E2E/CloudConnect`): the real Dashboard pages, with the API calls
answered in the page.

- `after-resource-right-sizing-*`: a cloud resource no recommender speaks
  for (`shop-web-1`, an Azure VM), its Right-sizing card beside What it
  costs, from OneUptime's own CPU readings: the size half as big, what it
  would save at its cost over the last 30 days, the readings, and why. At
  1280 (English, German) and 390 (Persian).
- `after-savings-1280`: Savings with the over-provisioned resources OneUptime
  sized itself, OneUptime as their source.
- `after-costs-unusual-days-*`: Costs, its Unusual days card under the daily
  spend - `data-lake`'s Amazon Athena yesterday, two and a half times its
  usual day - at 1280 and, in Persian, at 390.
- `after-budget-alerts-step-1280`: a budget's Alerts step with Alert On
  Unusual Days, on by default.
- `before-changes-de-12-hour-1280` and `after-changes-de-12-hour-1280`: an
  account's Changes in German at 1280 on a 12-hour clock (#5704's review). On
  master's code the table runs 16 pixels past its card and the Region
  scrolls; with the By column's 7rem floor it fits. `before` is master's
  code at 2x from the same fixture (a browser in US English); `after` is the
  suite's own run (`CI=1 npx playwright test --config
  playwright.cloud-connect-ui.config.ts -g "12-hour clock"`).

The Cloud Spend ones are from the suite's own run: `CI=1 npx playwright test
--config playwright.cloud-spend-ui.config.ts`.

## UI review

Taken after the UI review at twice the pixels, from the same offline Cloud
Spend fixture (`?usage=fits` is new):

- `ui-review-right-sizing-1280`: shop-web-1's Right-sizing beside What it
  costs. Its readings are its four figures, said once; the line under them is
  what they would be at the new size. "Saves about €285.15 a month" draws the
  amount alone in green.
- `ui-review-right-sizing-under-1280`: sessions-cache, under-provisioned. Its
  cost is not billed by name, so no saving line; a larger size's cost reads in
  amber where there is one.
- `ui-review-right-sizing-fits-1280`: a resource busy enough for its size.
- `ui-review-right-sizing-fa-390`: Persian on a phone.
- `ui-review-unusual-days-1280`: the Unusual days card on Costs, its
  description one sentence.
- `ui-review-savings-1280`: Savings, OneUptime's own row named like the
  recommenders' rows ("EC2 instance") with its readings in one sentence.
