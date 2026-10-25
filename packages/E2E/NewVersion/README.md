# New version

Run `npm run test-new-version-ui` from `packages/E2E` after installing its and `Common`'s
dependencies and Playwright Chromium. It needs no database or running OneUptime services.
The fixture listens only on `127.0.0.1:4618` (`NEW_VERSION_FIXTURE_PORT` moves it).

This suite is a deploy under an open tab. `Fixture/server.js` builds `Fixture/Index.js` -
a small app made of the real pieces every OneUptime frontend uses to move onto a new
version: `Common/UI/Utils/NewVersion`, `Common/UI/Components/NewVersion`, the app's
`ErrorBoundary` and `ContainedErrorBoundary`, Common's `Link` and `Navigation`, with pages
loaded lazily as the Dashboard's are - twice, as build A and build B, with Common's own
`build()` (the one every frontend's `esbuild.config.js` calls: it names the build and writes
`dist/build.json`). It serves build A under `/dashboard` as the App serves a frontend - a
missing bundle file answered 404, every other address the page - and the spec deploys
build B mid-session, the old chunks gone, as a real deploy does.

The spec drives the server over `/__fixture/`: `deploy`, `server` (`up`, `down` - the
connection dropped - or `unavailable` - 503), `missing` (a page's chunk gone for good),
`slow-documents`, `hold-documents` (the page answered 204, which leaves the browser on the
page it has, so what a page shows as it starts a reload stays on screen) and `stats`. The
app keeps what the first load's query set (`audience`, `lang`, `theme`, `firstCheck`,
`gap`) for the tab, counts its boots, and records every screen a page moving onto the new
version showed, so the spec can read them after the reload that replaced the page.

Desktop (1280px) and phone (390px) Chromium cover: no new version (nothing said); a deploy
noticed quietly, the notice in its corner and gutters; the next page loading in full in the
new version at its address and query, by Common's `Link`, a router link and Back; Reload
coming back to the same address, hash and scroll; Dismiss; unsaved changes making Reload
ask first and keeping the next page inside the tab; a page whose code is gone saying it is
updating and reloading into the same address (and, for a status page's visitor, never
naming OneUptime); offline; a server answering 503 or dropping the connection; a part gone
for good after its one reload, never a loop; and one widget's code gone, in its place only.
Screenshots of each state, light and dark, in German and in Persian (right to left), are
under `output/playwright/new-version-ui`.

This checks real browser behaviour and the screens; the App's own serving of the files is
covered by `packages/App/Tests/FeatureSet/FrontendStaticFiles.test.ts`, and each frontend's
wiring by `packages/App/Tests/FeatureSet/NewVersionWiring.test.ts`.
