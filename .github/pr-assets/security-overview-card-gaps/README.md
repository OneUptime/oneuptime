# Rows of cards that end on one line (security-overview-card-gaps)

Screenshots for the pull request that adds `CardGrid` (`Common/UI/Components/Card`) and draws the
Security Events Overview's rows of cards, and the same rows on the product's other overview pages,
with it. Every page is the production code rendered by an offline fixture of `packages/E2E` on its
synthetic data, in headless Chromium at twice the pixel density (the gallery at once), with the
Inter font production ships.

| File | What it shows |
| --- | --- |
| `before-1280-long.png`, `after-1280-long.png` | Security Events > Overview at 1280px, a busy month (SecurityOperations fixture). Before: master, where four verdicts and eight tactics stood beside the whole queue, and six rules beside eight entities. After: the queue beside the entities, then the rules, the tactics and the verdicts. |
| `before-1280-short.png`, `after-1280-short.png` | The same with `?ranked=short`: two rules, two tactics, two entities, the shape of the maintainer's own Overview. Before: a card with two tactics as tall as the whole queue, Verdicts half empty. |
| `after-1024-long.png` | At 1024px beside the side menu the wide cards stack, and the three short lists go two across with Verdicts taking its row. |
| `after-1280-none.png` | `?ranked=none`: a list with nothing to rank says so in the middle of its card. |
| `after-390-dark.png` | A phone, dark theme: one card above the other, 20px apart. |
| `network-before-1280.png`, `network-after-1280.png` | Network > Overview with `?lists=busy` (NetworkFirstRun fixture): six devices needing attention beside one site, the vendors beside no scan yet. Before: bare page under the site, 40px between the rows, the second row uneven. |
| `exception-before-1440.png`, `exception-after-1440.png` | An exception's Overview with long details (ExceptionDetail fixture): the details beside the latest occurrence, now one height. |
| `card-rows-gallery-1280.png` | The card rows gallery (DetailCards fixture, `/card-rows`) in the production Page beside a side menu: two wide cards, three narrow ones, five (a last row of two), three wide ones (a last card alone), a card with nothing to list and a detail card. |
| `card-rows-gallery-rtl-1280.png` | The same gallery in Persian with the page set right to left: the rows mirror. |

The "before" shots swap master's `Pages/SecurityEvents/Overview.tsx` and
`Components/SecurityOverview/RankedBars.tsx` (or the Network Overview and `ExceptionExplorer.tsx`)
into the fixture build for the shot, and put the branch's back after it.

## UI review

Added by the UI review, at twice the pixel density with Inter. The rows no offline fixture renders
were drawn by a review harness: the real components (`MessageQueueServicesCard`,
`AiActivityInsightsView`, `TrafficTopList`, `TracesDashboard`) inside the production `Page` beside a
side menu, over made-up data.

| File | What it shows |
| --- | --- |
| `exception-no-occurrence-before-1280.png`, `exception-no-occurrence-after-1280.png` | An exception with no occurrence stored (ExceptionDetail fixture, `?occurrence=none`). Before: the dashed box at the top of a card stretched to the details' height. After: the box takes the card's room, its words in the middle. |
| `traffic-empty-before-1280.png`, `traffic-empty-after-1280.png`, `traffic-empty-after-1280-dark.png` | A traffic page's top lists with no applications beside four networks (a Meraki organization without traffic analysis). Before: the sentence at the top of a tall card. After: in its middle, as every other row's empty list. |
| `message-queue-one-side-1280.png` | A queue's Producers beside Consumers with none: the empty side as tall as the table, its sentence in the middle. |
| `ai-insights-hotspots-1280-dark.png` | Incidents > AI > Insights: the monitors that keep failing beside no service, dark theme. |
| `traces-no-errors-1280.png` | The Traces overview's Recent Errors (none) beside Slowest Requests: both columns end on one line. |

The review's "before" shots swap the branch's `ExceptionLatestOccurrence.tsx` and `TrafficTopList.tsx`
(before the review) into the watching builds, the same way.
