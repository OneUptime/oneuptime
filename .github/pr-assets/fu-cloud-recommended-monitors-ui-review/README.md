# Cloud recommended monitors: UI review shots (#6150)

Taken in headless Chromium against the offline fixtures, which bundle the
production pages with the Dashboard's Tailwind runtime, Theme.css and Inter:
`packages/E2E/CloudRecommendations` (a cloud account's and a cloud resource's
Recommendations) and `packages/E2E/AppPlatforms` (an app's Recommendations
tab). "Before" is the branch as its builder left it (9e01ec176f8), "after" is
the reviewed page.

| Shot | What changed |
| ---- | ------------ |
| `account-en-1280-*` | A type says "Recommended for N resources" (it said "N resources in this account", wrong while web-3 waits for metrics and edge-nlb has no template); a row's count and Show resources share one line |
| `account-en-390-*` | Add all is outlined like each row's Add, sized to its words instead of a phone's width |
| `account-fa-1280-*` | The page in Persian: its own words translated, the catalog's English sentences keep their full stops at their ends, tiles in Persian digits |
| `resource-fa-1280-*` | A resource's tab in Persian: card, tiles, search, filter and coverage bar translated |
| `resource-no-metrics-1280-*` | Nothing recommended yet: the note and a compact empty list, no zero tiles, search, filter or dead Create |
| `account-failed-read-*` | A failed read keeps the card and offers Refresh |
| `account-viewer-lock-*` | The lock line speaks of monitors, not "this Monitor" |
| `app-recommendations-768-after` | The app page's six tabs wrap beside the side menu instead of scrolling the page sideways |
| `create-panel-fa-after` | The create panel's three ways to be told are translated (they were English in every language) |
