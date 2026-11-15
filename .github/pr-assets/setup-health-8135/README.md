# Setup Health, redesigned: screenshots

Screenshots for #8135. Every record in them is synthetic: the page is the
real Dashboard page, drawn by the offline Home fixture
(`packages/E2E/HomeOverview`, `?setup=busy`) in headless Chromium with the
Dashboard's Inter font.

| File | What it shows |
| --- | --- |
| `before-1600.png`, `after-1600.png` | Home > Setup Health at 1600 pixels. Before: a card that repeats the title, plain sentences, and each fix at the far end of its row. After: the verdict first, each finding with its icon, its names in bold, what it affects and its fix right under it. |
| `before-390.png`, `after-390.png` | The same page at 390 pixels. |
| `before-nothing.png`, `after-nothing.png` | A project with nothing to fix. |
| `after-dark.png` | The dark theme. |
| `after-de.png` | German. |
| `after-fa-390.png` | Persian, right to left, at 390 pixels. |
