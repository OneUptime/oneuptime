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
  with `?data=labels`, the Monitors list of issues #5187 and #5183: labels
  numbered the way that customer numbers theirs ("1.Category=Application",
  "2.SubCategory=Website", ... "10.Owner=..."), each monitor's handed over
  in a scrambled order, one longer than a column may grow, five on one
  monitor (the gallery's rows keep all their labels then, so a phone's
  card shows four and the fold of five too);
- `/dashboard/<project>/status-pages` - Status Pages (a long name beside a
  column of prose);
- `/dashboard/<project>/settings/teams` - Settings > Teams;
- `/dashboard/<project>/network-devices/settings/roles` - Device Roles, a
  list put in order by dragging its rows;
- `/dashboard/<project>/tables` - the gallery: every kind of column
  (`?table=kinds`), a table with many columns (`?table=wide`), a table drawn
  outside a card (`?table=plain`), people, each name drawn beside a
  picture and over an email (`?table=people`), and a table a page draws
  itself - a monitor's network interfaces, in a card with no ⋯
  (`?table=handbuilt`);
- `/dashboard/<project>/runbooks` - the Runbooks list of the maintainer's
  screenshot of the gap under a card's title, in the real Runbooks layout
  (its side menu and breadcrumbs) and as wide as the Dashboard draws it;
- `/dashboard/<project>/card-headers` - every card header shape
  (`Fixture/CardHeaders.js`): a table's toolbar header with a one-line, a
  wrapped or no description, with no controls or only a status pill; the
  default header; and the stacked header of an overview's one-third column
  (Edit, a wrapped description, a title over two lines, a pill, buttons that
  go under the title, no description, no actions).

The suite (`ModelTables.spec.ts`) measures in Chromium what jsdom cannot:

- the header row is one quiet line ("Incident Number" no longer breaks);
- the Alerts list names each row's monitor once: no Monitor column, and
  Affected Resources lists the monitor first, then the cluster, each beside
  its icon and opening its page; the Monitor chip still narrows the list to
  a monitor's alerts (by `monitorId`); a phone's card has no Monitor line;
  the names read at WCAG AA in the dark theme;
- a phone's card names each resource in full, a long name running onto a
  second line beside its icon (one with nowhere to break, `?data=long`,
  breaks anyway); a row on a laptop keeps it to one line, ending in "...",
  the whole name under the pointer; a chip with a long monitor picked stays
  inside the bar on a phone, its words ending in "...";
- every row is 48px and its hairline, whatever it holds - text, pills,
  a label, avatars, a dash, the row's buttons, a drag grip - each part on
  the row's 24px line; a row's labels are listed one under another, as
  Affected Resources lists its resources, each label after the first adding
  its line (28px);
- a row's labels read in natural order - numbered labels first, by their
  numbers, "10." after "4." - the first three and "N more labels" for the
  rest, never "1 more"; none is cut off: a label is as wide as its name up
  to the column's 20rem, and only a longer one ends in "...", whole under
  the pointer; on a phone a long one runs onto a next line inside its pill;
  the Labels facet offers them in the same order, in both themes;
- "N more labels" is a link on a 24px line of its own under the labels (a
  row of five folded is as tall as a row of four), at WCAG AA in both
  themes; the keyboard opens and folds the list and stays on the link, its
  ring whole inside the column; a phone's card folds and opens the same
  way; German says "2 weitere Beschriftungen";
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
  moves a row;
- a member who may read none of a list (`?role=none`) is told so, with the
  one permission to ask for ("You need this permission: Read Incident. Ask
  a project admin for access.") - not drawn rows of nothing but a ⋯ under
  filter chips and a search box - and on a phone, in German and dark, the
  state fits the screen.

`CardHeaders.spec.ts` measures where a card's description sits under its
title ("There's a lot of gap between the title of the card and the
description of the card"): 9px under the title beside the controls (it was
20px, a button row down), 6px where there are none, clear of the controls'
foot, the controls centred on the title, every title at the card's padding
(so cards side by side line up); the controls under the title when they do
not fit beside it, the description staying 6px under the title and the
controls following it - also as the window is resized across that width; a
list that drops its description for its empty state keeping its title and
controls where they were; the search opened without moving anything; a
phone's header; and the dark theme - on the Runbooks, Incidents and Teams
lists and every shape of the gallery, at 1440, 1280, 1024, 768 and 390px.

`ColumnResize.spec.ts` sizes columns ("I'm not able to resize columns ...
Please do this for all tables."): each column's edge quiet until the pointer
is over the header row, the resize cursor and the indigo line over it; a
drag narrower and wider with every value following, the width there on the
next visit; never narrower than a header's words or a date; a double-click
fitting the widest value; the arrows, Shift, Home, End and Delete on a
focused edge, its width announced; Reset column widths in the card's ⋯ and,
in a card with none, beside the last column's name of a table a page draws
itself; Persian (the edge at the column's left end, a drag left widening
it), German at 1024px, a phone's cards with nothing to size, the dark
theme's faint line, a tablet's finger (a 24px edge, a touch drag), and a
list of 200 rows, where only the edge's line follows the pointer until it
is let go. Its screenshots are `column-resize-*.png`.

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
(or any page above), adding `?data=rich`, `?data=long`, `?data=labels` or
`?data=empty`,
`?rows=<n>` (n more rows on every list), `?role=viewer`, `?delay=<ms>` (each
list read takes this long), `?fail=<table>` (`Incident`, `Monitor`, ... or
`all`), `?lang=de|ja|fa` or `?theme=dark`. `--watch` rebuilds the bundle as
the sources change.
