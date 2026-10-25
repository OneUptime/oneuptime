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
