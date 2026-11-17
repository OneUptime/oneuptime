# A Service Bus namespace's Metrics tab reads its queues' total (#6410)

How these were made: the REAL Cloud > All Resources > resource > Metrics tab
(`Pages/Cloud/View/Metrics`) inside the real `Page` beside the resource's real side menu
(`Pages/Cloud/View/SideMenu`), as `Pages/Cloud/View/Layout` draws it, bundled with the Dashboard's
own esbuild config and rendered in headless Chromium with Inter, 2x. The APIs answer as the
server would: a Service Bus namespace `shop-prod` whose metrics a connected subscription reads
once per queue, three queues each, so `Sum` is the namespace's total and `Avg` the average queue
(an interval of several minutes holds several points of each queue). The width in the name is
the viewport's.

- `after-servicebus-hour-en-1280.png`: the past hour, read by the minute. All six queue metrics
  read the namespace's total and say "total of series"; the send latency keeps the average and
  says "average of series".
- `after-servicebus-day-en-1280.png`: the past day, read in 15-minute intervals. Messages in and
  out, server errors and throttled requests are counts: still the total. Messages waiting and
  dead-lettered are amounts held, whose Sum over 15 minutes would read 15 times the backlog, so
  they keep the average of series, as before, and say so.
- `after-servicebus-hour-en-1280-dark.png`: the past hour, dark.
- `after-servicebus-hour-en-1024.png`: the past hour beside the side menu at 1024.
- `after-servicebus-day-de-1024-dark.png`: the past day in German, dark, at 1024.
- `after-servicebus-hour-en-768.png`: the past hour at 768: the rows stack beside the menu.
- `after-servicebus-hour-fa-768-dark.png`: the same in Persian, dark.
- `after-servicebus-hour-de-390.png` and `after-servicebus-hour-fa-390.png`: on a phone, in German
  and Persian.
- `after-vm-hour-en-1280.png`: a virtual machine, whose metrics are not split: no caption and the
  average, exactly as before.

## UI review

The same page, with an aggregate mock that answers as ClickHouse does for a range that ends now:
each queue's points sit at whole minutes, the newest eight minutes old (Azure's lateness), so the
range's newest interval is still filling and its oldest began before the range did.

- `review-before-servicebus-day-en-1280.png` (1x, before the review): over a day each total read
  the newest 15 minutes, still filling: "720 Count" for a namespace taking about 5,400 messages a
  quarter hour, and every summed sparkline fell at its right edge.
- `review-servicebus-day-en-1280.png`: the same day after the review. A total keeps its whole
  intervals and waits 15 minutes for Azure's late points: 5.4K, no fall. The captions are gray
  500 (gray 400 at 10px was 2.5:1 on white).
- `review-servicebus-week-de-1024.png`: a week, read by the hour, in German: each total is a
  whole hour's.
- `review-servicebus-hour-fa-768-dark.png`: Persian. The values read "153 Count" and "9.35 ms"
  (they read "Count 187" and "ms 12.4" in `after-servicebus-hour-fa-768-dark.png`), and each
  English description keeps its full stop at its end.
