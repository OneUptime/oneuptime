# Tables fixture

An offline harness for the Dashboard's tables - `Common/UI/Components/Table`
and the `ModelTable` / `BaseModelTable` lists built on it, which every list
page in the product draws with. It bundles real Dashboard list pages and a
gallery of every kind of column with esbuild, replaces only the `ModelAPI` /
`API` data boundary and the synthetic member's permissions, and serves them
on `127.0.0.1:4319` (`MODEL_TABLES_FIXTURE_PORT` moves it). No Docker, no
database, no sign-in.

The pages:

- `/dashboard/<project>/incidents` - the Incidents list of the maintainer's
  screenshot ("Incident Number" over two lines, "No labels attached." and
  "No owners." on every row, a long Duration, the Actions column out of
  sight);
- `/dashboard/<project>/alerts` - the Alerts list of the maintainer's
  screenshot of it: alerts raised on monitors of the oneuptime-test cluster,
  each linked to the cluster too, then one created by hand about a database
  and one linked to nothing;
- `/dashboard/<project>/monitors` - Monitors (status dots, labels, owners);
- `/dashboard/<project>/status-pages` - Status Pages (a long name beside a
  column of prose);
- `/dashboard/<project>/settings/teams` - Settings > Teams;
- `/dashboard/<project>/network-devices/settings/roles` - Device Roles, a
  list put in order by dragging its rows;
- `/dashboard/<project>/tables` - the gallery: every kind of column
  (`?table=kinds`), a table with many columns (`?table=wide`), a table drawn
  outside a card (`?table=plain`), and people, each name drawn beside a
  picture and over an email (`?table=people`).

The suite (`ModelTables.spec.ts`) measures in Chromium what jsdom cannot:

- the header row is one quiet line ("Incident Number" no longer breaks);
- the Alerts list names each row's monitor once: no Monitor column, and
  Affected Resources lists the monitor first, then the cluster, each beside
  its icon and opening its page; the Monitor chip still narrows the list to
  a monitor's alerts (by `monitorId`); a phone's card has no Monitor line;
  the names read at WCAG AA in the dark theme;
- every row is 48px and its hairline, whatever it holds - text, pills,
  labels, avatars, a dash, the row's buttons, a drag grip - each part on the
  row's 24px line;
- an empty value is a quiet dash read out as "Not set", not "No labels
  attached." on every row; Yes is a tick, No the dash;
- the Duration says its two largest units, the whole of it under the
  pointer;
- a long value is cut short with an ellipsis inside its column, and shows in
  full under the pointer; a resource's name in a list keeps its icon beside
  it;
- a row's name uses the room a table that fits has: a long one runs past
  20rem to its column's end, cut short after its first line; it gives way
  down to 10rem before the table scrolls (the Status Pages list fits at
  1000px); at 900px the rows scroll and the name is back at its cap; a
  window resized back and forth settles; a person (a picture beside a name
  over an email) keeps its cap and its lines;
- a table wider than its card scrolls in its own box, its Actions column
  stuck at the card's edge and lit with its row under the pointer;
- the header row sticks under the top bar while a long page scrolls, and
  stays put when the rows scroll sideways (it could not follow them);
- a row opens its record on a click on its own words - not on its select
  box, its ⋯ or a menu the ⋯ opens; Cmd or Ctrl opens a new tab; a link in
  it goes where the link goes; a phone's card answers a tap;
- on a phone each row is a card of names over values, nothing past the
  screen's edge;
- in the dark theme the header band, its names and a row's values read at
  WCAG AA, and the rules between rows are the theme's subtle border;
- while the first page loads, the rows keep their shape and the header its
  height;
- a drag-ordered list's grips sit on the rows' line, and the keyboard still
  moves a row.

`Fixture/Fixture.js` records every list read on
`window.__fixture.listRequests`, every write on `window.__fixture.updates`,
every delete on `window.__fixture.deletes`, every navigation on
`window.__fixture.navigations`, and every read of a table it does not model
on `window.__fixture.unmodelled` (the suite fails on any).

## Run it

```
cd packages/E2E
npm install
npm run test-model-tables-ui
```

Screenshots land in `output/playwright/model-tables-ui/`, named
`*-synthetic.png` because every record in them is made up.

## Poke at it by hand

```
cd packages/E2E
node ModelTables/Fixture/server.js
```

Then open
`http://127.0.0.1:4319/dashboard/10000000-0000-4000-8000-000000000001/incidents`
(or any page above), adding `?data=rich`, `?data=long` or `?data=empty`,
`?rows=<n>` (n more rows on every list), `?role=viewer`, `?delay=<ms>` (each
list read takes this long), `?fail=<table>` (`Incident`, `Monitor`, ... or
`all`), `?lang=de|ja|fa` or `?theme=dark`. `--watch` rebuilds the bundle as
the sources change.
