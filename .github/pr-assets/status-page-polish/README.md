# Status page polish screenshots

What the status page looks like after this change, and what it looked like
before where the difference is visible in a still.

Rendered from the real components against the status page's own Tailwind build
(`Common/Server/Static/Vendor/tailwind/tailwind-3.4.5.js`) on mock data, and
shot with Playwright at a 2x device pixel ratio. The "before" frames were
rendered from the pre-change components taken straight out of git, not
re-implemented, so they are the real thing.

| File                              | Shows                                                                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uptime-bars-keyboard-focus.png`  | A day of the uptime history reached with the keyboard: the focus indicator inside the bar, and the reading that used to be hover-only beside it.   |
| `day-detail-before.png`           | What clicking a day used to open - an incident list, and only on the days that had one.                                                             |
| `day-detail-after.png`            | What every day now opens: uptime, how the day was spent, then the incidents.                                                                       |
| `day-detail-quiet-day.png`        | The same dialog on a clean day, which previously could not be opened at all.                                                                        |
| `overview-before.png`             | The top of the overview before: a status banner of unknown age, and no way to search.                                                              |
| `overview-after.png`              | The top of the overview after: "Updated N ago" with a refresh control, and the resource search.                                                     |
| `search-filtering.png`            | A search running - matches only, the groups above them opened, and the count.                                                                       |
| `search-no-results.png`           | A search that matched nothing saying so, rather than the page silently losing its resources.                                                        |
| `refresh-failed.png`              | A background refresh that failed: the last known status stays on screen and is marked as stale.                                                     |
| `overview-mobile.png`             | The same page at 390px.                                                                                                                             |
| `search-filtering-mobile.png`     | A search running at 390px.                                                                                                                          |
| `day-detail-mobile.png`           | The day dialog at 390px - the reading a phone previously had no way to reach, since the tooltip that held it only opened on hover.                  |

Re-shoot these when the uptime strip, the day dialog or the top of the overview
changes. They were produced with a throwaway harness: an esbuild bundle of the
real components rendered into a page that loads that Tailwind build, driven by
Playwright (`chromium.launch()`, `colorScheme: "light"`,
`deviceScaleFactor: 2`). Keyboard focus has to be reached with `Tab`, not with
`element.focus()` - `:focus-visible` does not match programmatic focus.
