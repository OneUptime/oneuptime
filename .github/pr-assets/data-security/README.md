# Data Security

Screenshots of the production Data Security routes (`Routes/DataSecurityRoutes.tsx`:
its layout, side menus, cards and tables), taken in Chromium at twice the pixels
from the offline suite `packages/E2E/DataSecurity`
(`npm run test-data-security-ui`). The project, its stores, issues and timelines
are synthetic: the fixture replaces only the data boundary and the signed-in
user, and each issue is one of the catalog's own checks, titled and scored as
the server writes it.

- `overview-laptop.png`: 1280 pixels, the Overview: the four figures, Fix These
  First ranked by risk, stores by data category, the last 30 days and scan
  coverage.
- `overview-dark-laptop.png`: the same page on the dark theme.
- `store-overview-laptop.png`: a public S3 bucket's Overview: sensitivity,
  exposure, its two open issues and its risk (the worst open issue's), what is
  inside it, its configuration checks, owners and where it lives.
- `store-timeline-laptop.png`: the store's new **Timeline**, with a person's
  change opened to show the settings it changed.
- `store-timeline-german-laptop.png`: the same Timeline in German.
- `issue-fix-it-from-here-laptop.png`: the issue's page: what is wrong, why it
  matters, **Fix it from here** with **Block Public Access**, the console, CLI
  and Terraform steps, and the risk score's parts.
- `block-public-access-question.png`: what **Block Public Access** asks before
  it changes the cloud.
- `fix-it-from-here-response-off.png`: the panel when the store's cloud
  connection has **Data security response** off: what to turn on, and where.
- `issue-german-laptop.png`: the issue's page in German, every part of the risk
  score included.
- `issue-persian-dark-phone.png`: 390 pixels (the screen only), the issue's
  page in Persian, right to left, on the dark theme.
- `stores-phone.png`: 390 pixels (the screen only), the Data Stores list as
  cards, nothing running off the screen.
- `issue-links-laptop.png`: the header of a Critical issue's page, with the
  **Security case**, **Alert** and **Incident** it started.
- `issue-links-persian-phone.png`: the same header at 390 pixels, in Persian,
  right to left.
- `when-an-issue-opens-laptop.png`: Settings > Scanning > When an Issue Opens,
  with **Declare incidents for Critical issues** and its **Incident Severity**
  beside the alerts' switch and severity.
- `when-an-issue-opens-german-dark.png`: the same card in German, on the dark
  theme.
