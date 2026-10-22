# Dashboard Value widget

Run `npm run test-dashboard-value-widget-ui` from `packages/E2E` after installing its,
`Common`'s, `App`'s and the Dashboard's dependencies and Playwright Chromium.

This suite covers a dashboard's Value widgets - the big number, its sparkline and its
trend arrow - on both of a dashboard's surfaces:

- the dashboard inside OneUptime: the real view layout (`Pages/Dashboards/View/Layout`)
  around the real Dashboard page, with only `ModelAPI`, `AnalyticsModelAPI` and `API`
  answered from fixture data (`Fixture/AppFixture.js`);
- the public dashboard: its own `views/index.ejs` and its own app, with only the
  public dashboard API answered (`Fixture/PublicFixture.js`).

Both are bundled with the app's esbuild config by `Fixture/server.js`. It needs no
database or running OneUptime services. The fixture listens only on `127.0.0.1:4427`.

The dashboard (`Fixture/Boards.js`, Past 1 Week) has a Value widget for each shape a
series can have: a log recording rule's count that rises, a latency that falls, a level
that never moves, a sum grouped by service (three series a bucket), a sparse count most
of whose hours have no bucket, an average past its critical threshold, a metric with a
single bucket, one with no data, and - inside OneUptime only - a Data Source Value
widget whose rows come in no order at all. Every metric read is answered the way
OneUptime's metrics API answers it, NEWEST bucket first, and recorded with its window
and its points; the suite works out what each widget should draw from those records
with the same `Common/Utils/Dashboard/ValueWidgetSeries` the widgets use.

Desktop (1280px) Chromium covers: each line drawn from its oldest bucket on the left to
its newest on the right, one point a bucket; each arrow's direction, colour and
percentage; hovering a line's two ends (the oldest and newest buckets' times and values,
and the line's ends labelled beside it, inside the tile); the arrow's tooltip naming both
halves of the range and what each came to; a flat series across the middle with "→ 0%";
a single bucket and an empty window; the critical threshold's wash in both themes; every
word on every Value widget at 4.5:1 (3:1 when large) in the light and the dark theme,
the tooltip and the hover included; German; and Persian, where time still runs left to
right. Phone (Pixel 5, 390px) Chromium runs what a phone changes: the board's lines and
arrows at its width, the dark theme, and a tap on an arrow opening its tooltip. Both
run the public dashboard's lines and arrows, Light and Dark. Screenshots of the board,
the hover, the tooltip, the threshold and the public page are under
`output/playwright/dashboard-value-widget-ui`.

Both dashboards are 1000px wide, so on the phone part of the board is past the screen's
right edge, as it is on a real phone.

This checks real browser rendering and the widgets' handling of the API's order; the
API, the database and the deployed app's routing are outside this fixture.
