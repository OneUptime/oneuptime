# Session replay UI regression tests

Run the targeted browser suite from `packages/E2E`:

```sh
npm run test-session-replay-ui
```

The suite builds and serves the production RUM application layout, navigation,
recording list, documentation, policy and player on `127.0.0.1:4212`. It needs
repository dependencies and the Playwright Chromium browser installed. It does
not need a running backend, an account, telemetry credentials or external data.

Only the API boundary and the synthetic user's permission snapshot are replaced.
The shared table, facet dropdowns, routes, player controls, event rail, manifest
parser, binary chunk decoder and lazy-loaded rrweb player run unchanged. The
recording is a synthetic checkout page containing moving rrweb DOM mutations,
clicks, a failed request, a client error, a rage click and navigation events.

Coverage includes semantic table markup, the separate Session Replay menu group,
facet combinations and request values, URL restoration, search guidance,
installation versus filtered empty states, retry, cursor pagination, sort resets,
actual reconstructed footage advancing, pause/seek/speed, visibility of speed
options, event search and details, rail collapse, keyboard tab navigation, and
mobile overflow and controls.

The player's own layout is measured, not just present:

- **How big the recording is drawn.** At 1440 x 900 the 1200 x 760 recording
  must reach at least 55% (it was 34% before this layout), the stage at least
  380px tall, with the transport above the fold and the page not scrolled; a
  1920 x 1080 window draws it larger still and a smaller one refits it live,
  without a reload or a second manifest read.
- **Stage fit.** The Fit / Width / 1:1 segments move `data-replay-fit`, the
  viewport chip reports a percentage for the two scaled fits and none for 1:1,
  and Width fills the box across and scrolls the page down inside it.
- **Browser tabs.** `?tabs=many` is an unfinalized recording of eight tabs (two
  still open, five closed, one that stored nothing, each on its own page), which
  is what the strip, its cap of six pills and the picker are for: open tabs
  lead, each pill names its page, and the picker groups Open / Closed / No
  footage with counts, filters by page and by tab number, moves with the arrow
  keys, switches tab on Enter and closes on Escape - and typing in its filter
  never reaches the player's single-key shortcuts. `?tabs=multiple` stays the
  three-tab finished recording (one tab without footage).
- **Keyboard.** `r` hides and restores the events rail, `z` cycles the fit.
- **Timeline lanes.** The More menu drops the marker lanes and the legend while
  the track stays, and the height goes to the recording.
- **The end of a recording.** `?neighbour=newer` gives the person a later
  recording, so the ended card offers "Next session by this user" and opens it.

The Replay Policy page is covered too: the policy card must settle after its
mount reads and stay loaded (a page that hands it a new model id per render
reloads it forever), the Recording pill must follow health that answers after
the policy (`?health=hold`) or reports the project switch off
(`?project=off`), and saving the edit form must reload the card exactly once.
The fixture returns a new model instance per read, as the real API does.

The recorded page's own assets are covered against a second origin. With
`?assets=site` the recording is a page shaped like the Power Pages portal in
#4119: a logo, an offline banner holding its `web` and `close` icons, and a
stylesheet on another host that hides the banner. rrweb keeps every image,
and every stylesheet it could not read, as an address, so the replay has to
load them from the site the recording was made on. `Fixture/server.js`
serves that site on `http://localhost:4213` (bound to `127.0.0.1`;
`SESSION_REPLAY_ASSET_PORT` moves it), which is a different site from the
page's `127.0.0.1:4212`, as a real recorded site is. It serves only the
files under `/replay-assets/` that the fixture names; anything else is a 404,
never the fixture's HTML. `RecordedAssets.spec.ts` pins what the replay
loads, what still cannot load and what the player says about it, that the
recorded page still runs, connects to, frames and plays nothing, the
referrer each request carries, Mask all text, and a seek back.
`FrameScreenshot.spec.ts` pins the screenshot of such a frame.

- **`&run=<token>`** tags every recorded address. The server logs each
  request the recorded site receives - path, query, referer,
  `sec-fetch-dest`, `sec-fetch-site`, status - before it answers, and
  `/__fixture/asset-log?run=<token>` on the page's origin returns a run's
  entries, so a spec reads back only its own requests.
- **`&masking=all`** makes it a recording made under Mask all text, whose
  replay loads none of the page's images.
- **`&hold=image`** adds one more image, which the server answers only once
  a spec posts to `/__fixture/asset-release?run=<token>`: a frame can be
  captured while the stage is still loading it, with no timing involved.

The page is served with its own policy, `connect-src 'self'; font-src 'self'
data: http://localhost:4213`. The replay iframe is `about:blank`, so it
inherits that policy on top of the one the stage injects, and both are
enforced. That is why `font-src` names the recorded site: without it, the
page's policy and not the replay's would be what refuses the recorded page's
web fonts. It is also why the connect probe, `/__fixture/connect-probe`, is
on the page's own origin: `connect-src 'self'` allows it, so only the
replay's own `connect-src 'none'` can refuse a fetch to it. The Dashboard
sends no such header itself, but a reverse proxy in front of a self-hosted
install can add one, and it then constrains playback in the same way.

Screenshots are written to `output/playwright/session-replay-ui/`. They are
production UI screenshots with synthetic data, not screenshots of a separate
mockup. Failure traces and screenshots are under its `test-results` directory.

For the separate full-stack ingest-to-playback contract, run the existing suite
against a complete development stack:

```sh
HOST=dev.oneuptime.com npx playwright test \
  Tests/Dashboard/SessionReplay.spec.ts --project=chromium
```

That suite exercises real project onboarding, telemetry keys, ingest,
storage, playback and audit events. The offline UI suite does not substitute
for this backend integration coverage.
