# The traces and logs explorers show how many rows their query matches (#4202)

How these were made: the REAL traces explorer (`TracesViewer`) and logs explorer (`LogsViewer`),
bundled with the Dashboard's own esbuild config and rendered in headless Chromium at 1280px
(390px for the phone shot), 2x, light theme. The APIs are mocked and answer the way the real
ones do: the list endpoint returns one page, `hasMore: true` and `count = skip + rows + 1` (it
skips COUNT(*)); the new exact count answers 712,345. Every `before-*` image is master at
29a91bf494; every `after-*` image is this branch. Same data, same mocks.

- `before-traces.png` / `after-traces.png`: the top of the traces explorer. Before, there is no
  total anywhere above the fold, and the chart says "Traces over time" over bars that count every
  span. After, the list opens with "712,345 spans" and the chart is "Spans over time".
- `before-traces-footer.png` / `after-traces-footer.png`: the footer of the same list. Before,
  "Showing 1-50 of 51 traces" with two pages. After, "Showing 1-50 of 712,345 spans" with the real
  page count.
- `before-traces-footer-page-2.png` / `after-traces-footer-page-2.png`: after one click on Next.
  Before, the "total" grew to 101 and a third page appeared. After, nothing moves but the range.
- `after-traces-counting.png`: while the count runs ("Counting spans…"); the footer pages forward
  without numbers until it lands.
- `after-traces-too-many-to-count.png`: a count the server could not finish in 45 seconds: the
  rows the list has proven, with a "+", and what to do about it.
- `after-traces-root-spans.png`: limited to root spans (one row per trace), the rows are traces:
  "68,811 traces", "Traces over time".
- `after-traces-phone.png`: the same at 390px.
- `before-logs.png` / `after-logs.png`: the logs explorer's toolbar. Before, "101 results ·
  Page 1 of 2". After, "712,345 logs · Page 1 of 7,124".
