# Setup Health's one-click fixes: screenshots

Screenshots for #7299. Every record in them is synthetic: the page is the
real Dashboard page, drawn by the offline Home fixture
(`packages/E2E/HomeOverview`, `?setup=busy`) in headless Chromium with the
Dashboard's Inter font. Before is `../setup-health-8135/after-1600.png`.

| File | What it shows |
| --- | --- |
| `after-1600.png` | Home > Setup Health at 1600 pixels: SMS left off with **Turn On SMS** beside the link to Notification Channels, and each monitor that pages nobody with **Create On-Call Rule** beside Set Up Paging. |
| `quick-fix-dialog.png` | The dialog **Turn On SMS** opens: what will change, and where it is turned off again. Nothing changes until it is confirmed. |
| `after-dark.png` | The dark theme. |
| `after-fa-390.png` | Persian, right to left, at 390 pixels. |
