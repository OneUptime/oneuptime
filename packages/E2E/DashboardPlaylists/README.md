# Dashboard playlists

Run `npm run test-dashboard-playlists-ui` from `packages/E2E` after installing its,
`Common`'s, `App`'s and the Dashboard's dependencies and Playwright Chromium.

This suite covers dashboard playlists (issue #5235): **Dashboards → Playlists**, a
playlist's page and the player that shows its dashboards one after another on a screen
nobody touches, such as a NOC wall or a team's TV. It runs the real Dashboards routes
(`Routes/DashboardRoutes`: the Playlists list, a playlist's page and the player, with the
Dashboards layout, its side menu and breadcrumbs) inside a stand-in for the app's header,
with only `ModelAPI`, `AnalyticsModelAPI` and `API` answered from fixture data
(`Fixture/AppFixture.js`). `Fixture/server.js` bundles it with the app's esbuild config. It
needs no database or running OneUptime services, and listens only on `127.0.0.1:4535`
(`DASHBOARD_PLAYLISTS_FIXTURE_PORT` moves it).

The project (`Fixture/Boards.js`) has three dashboards, each saved with its own default
time range (**Production overview** a day, refreshing every minute, **Kubernetes clusters**
an hour and **Databases** a week), an archived one, one the viewer may not read and one
that was deleted, and six playlists: **NOC wall** (three
dashboards, a minute each), **Night shift** (the archived, the unreadable and the deleted
one between two that play), **Lobby screen** (one dashboard), **Draft** (none),
**Retired screens** (only the deleted one) and **Overview first** (the overview twice).
The page's clock is the test's (`page.clock`): a turn's end is reached by jumping ahead,
never by waiting. The fixture keeps the playlists for the tab, so a create, an edit or a
delete followed by a reload shows what was saved; `setPlaylist` and `deletePlaylist` on
`window.__dashboardPlaylistsFixture` change one the way someone else's edit would.
`?role=viewer` signs in a Viewer, `?lang=de`, `?lang=ja` and `?lang=fa` set the
Dashboard's words, `?theme=dark` the dark theme, and `?reads=fail` fails every read of a
playlist. Any read the fixture does not model, and any script error, fails the test.

Desktop (1280px) Chromium covers the player: it covers the whole window and plays the
dashboards in order, each for its time, round and round; it draws the next dashboard out of
sight ahead of its turn and keeps it, never drawn again, when the turn comes; each
dashboard opens on its own saved time range, whatever the address or the viewer's own picks
say, and neither is written over; Pause and Play (and Space); Next and Previous, by button
and arrow key, wrapping both ways, a press starting the turn afresh; an archived,
unreadable or deleted dashboard skipped; a dashboard twice in the playlist shown twice; one
dashboard with nothing to step through; a change to the playlist picked up at the end of
the round, and a playlist deleted while it plays; Exit and Escape back to the playlist's
page; the keyboard sheet (Escape closes it without leaving the player); **F** and the
**Full screen** button; the screen kept awake while it plays (a stand-in Wake Lock); a
playlist with no dashboards, with only gone ones (it starts once one is added), not found,
and a failed read (it tries again by itself and on **Try again**); and the dark theme. It
also covers the pages: the list (each playlist's dashboards and time, **Play** on every
row), a playlist's page (its dashboards in order, which the player skips and why, the
player's link), **Create Playlist** (a dashboard required, archived dashboards not offered,
picked in order, moved, the time picked), **Edit Playlist** (reordered, removed, and a
dashboard the editor cannot see kept), **Delete**, a Viewer (plays, but **Create**,
**Edit** and **Delete** are disabled), German, Japanese and Persian (laid out right to
left, the arrow keys following the reading direction). Phone (Pixel 5, 390px) Chromium
runs what a phone's width changes: the player covering the window and playing in order,
the bar stacked over the board with nothing wider than the screen and its buttons stepping
through the playlist, the list's rows as cards, an empty playlist, a failed read and the
dark theme. Screenshots are under `output/playwright/dashboard-playlists-ui`.

This checks real browser rendering and the pages' and the player's handling of their
reads; the API, the database and the deployed app's routing are outside this fixture.
