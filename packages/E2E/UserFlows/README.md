# User Flows UI regression tests

Run the targeted browser suite from `packages/E2E`:

```sh
npm run test-user-flows-ui
```

The suite builds and serves the production RUM application layout and the
User Flows page on `127.0.0.1:4219`. It needs repository dependencies and the
Playwright Chromium browser installed. It does not need a running backend, an
account, telemetry credentials or external data.

Only the API boundary and the synthetic user's permission snapshot are
replaced. The page, the flow-map engine (`Common/Utils/Rum/UserFlow.ts`), the
SVG layout, the detail panel, the tables and the URL state all run unchanged.

The fixture is a deterministic storefront of 200 recorded sessions built from
eight journey templates (see the header of `Fixture/Fixture.js`), so every
number the spec asserts - node sizes, band sizes, drop-offs, findings, filter
results - is worked out by hand from the templates, never read back from the
engine under test.

Coverage includes: the map from the session start (node and band counts,
`/cart/` and `/cart` folding into one page, product ids grouped as
`/products/:id`, drop-off stubs, tooltips, the map fitting its card), the
findings (error hotspot, drop-off that ignores natural ends like an order
confirmation, frustration hotspot, back-and-forth loop) and the drop-off
finding opening a backward map drawn right to left, the page detail panel
(sessions, drop-off, neighbours, links into the player and the pre-filtered
session list), keyboard selection of a band, hiding a page, grouping, device
and session filters and step count all re-drawing without a new request and
surviving a reload, the time range read from the URL into the request, the
Top paths / Pages / Back and forth tables, an anchor nobody visited, the empty
and error states, and a phone viewport where the map scrolls inside its card.

`UserJourneys.spec.ts` covers one person's journeys over the `PEOPLE` table in
`Fixture/Fixture.js`: finding someone by what you know, the landing page, order,
repeat visits and exit page of each session, a session still recording and one
with no footage, device and session filters, switching between the journeys, the
person's flow map and everyone's, a browser or a session as a link, a role that
may not read identity, the way in from Replay Users, and a phone. It also holds
the one rule that must not slip: what someone typed never reaches the address.

`?fixture=empty` answers with no sessions, `?fixture=error` with a 500 and
`?fixture=no-identity` as a role that may not read end-user identity.

Screenshots are written to `output/playwright/user-flows-ui/`. They are
production UI screenshots with synthetic data. Failure traces are under its
`test-results` directory.

The full-stack counterpart, which ingests real recordings through the chunk
endpoint and reads them back through ClickHouse, is
`Tests/Dashboard/UserFlows.spec.ts`.
