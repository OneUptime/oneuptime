# Recommended cloud monitor templates: UI review shots (#6224)

Taken in headless Chromium. The Dashboard shots come from the offline fixture
`packages/E2E/CloudRecommendations`, which bundles the production Cloud
resource pages with the Dashboard's Tailwind runtime, Theme.css and Inter.
The website shots render `packages/Home/Views/cloud.ejs` with its compiled
Tailwind CSS. "Before" is the branch as its builder left it (143ce158746),
"after" is the reviewed page. `reports-db` was given a SQL Server engine in
the fixture for the SQL Server shots only; that row is not committed.

| Shot | What changed |
| ---- | ------------ |
| `rds-own-group-1280-*` | An RDS instance on a parameter group of the team's own: the note leads with the line the monitor alerts at (1,521 connections), then the limit it is 90% of, and asks for the change in one sentence |
| `rds-own-group-390-fa-*` | The same note in Persian at a phone's width: both numbers in Persian digits, the class, engine and group set apart |
| `rds-sqlserver-1280-*` | An engine its class does not limit: no "running sqlserver-se" (AWS's identifier read as code), and what to do instead said as every other recommendation note says it |
| `template-connections-*` | Connections Near the Limit's Show more, at the length of the catalog's other descriptions |
| `template-certificate-*` | Certificate Expiring's Show more, without the stream aside |
| `home-block-1280-*`, `home-block-390-*` | The Cloud product page's Recommended Monitors block: a shorter paragraph, four one-line points that each add something, the picture's severities as the product's pills, a caption without "read ... reads" |
