# Detail cards fixture

An offline harness for the Dashboard's detail cards -
`Common/UI/Components/ModelDetail/CardModelDetail`, the `ModelDetail` and
`Detail` it draws, and the pages built on them. It bundles real pages and a
gallery of every kind of field with esbuild, replaces only the `ModelAPI` /
`API` data boundary and the synthetic user's permissions, and serves them on
`127.0.0.1:4316` (`DETAIL_CARDS_FIXTURE_PORT` moves it). No Docker, no
database, no sign-in.

The pages:

- `/dashboard/<project>/user-settings/profile` - User Settings > Profile, the
  "Basic Info" card of the maintainer's screenshot (Name, Email and Timezone
  in two columns);
- `/dashboard/<project>/settings/project` - Project Settings (the project ID
  kept as a field);
- `/dashboard/<project>/status-pages/<id>` - a status page's Overview, with
  its Custom Fields card;
- `/dashboard/<project>/teams/<id>` - a team's page (its Watch Demo in the
  card's ⋯);
- `/dashboard/<project>/detail-cards` - the gallery: one, two, three and four
  columns, every kind of value (text, long URLs, labels, yes/no, dates,
  markdown, code, an ID, hidden text, copyable values), empty values with and
  without the field's own words, descriptions and side links, the compact
  style, and two detail cards drawn as sections of a "More settings" card.

The suite (`DetailCards.spec.ts`) measures in Chromium what jsdom cannot:

- the fields of one row share their top, in every column count and at 390,
  640, 768, 1024, 1280 and 1440px; the rule above a row runs the grid's whole
  width with no gap; no field carries an inline width;
- one column on a phone, two from 640px, a third and a fourth only from
  1024px; a short last row's field takes the rest of the row;
- the fields start where the card's title does, and nothing runs off a
  phone's screen - long names, emails, URLs and keys wrap in their column;
- the names as the card writes them (no capitals, no tracking, no dot), muted,
  over values in the reading colour, at WCAG AA in both themes; the rule
  between rows in the dark theme's subtle border;
- an empty value is a dash read out as "Not set", or the field's own words as
  quiet text (not a chip); a date is plain text;
- a copyable value's copy button is in view without a hover and copies;
- the documentation and the demo are in the card's bordered ⋯ beside Edit,
  and open in a new tab; a reader who may not edit sees Edit locked;
- while the record loads the card shows a skeleton of its rows and keeps its
  height when they land; a failed read says why and Refresh? reads again.

`Fixture/Fixture.js` records every single read on
`window.__fixture.itemRequests` and every read it does not model on
`window.__fixture.unmodelled` (the suite fails on any).

## Run it

```
cd packages/E2E
npm install
npm run test-detail-cards-ui
```

Screenshots land in `output/playwright/detail-cards-ui/`, named
`*-synthetic.png` because every record in them is made up.

## Poke at it by hand

```
cd packages/E2E
node DetailCards/Fixture/server.js
```

Then open
`http://127.0.0.1:4316/dashboard/10000000-0000-4000-8000-000000000001/detail-cards`
(or any page above), adding `?data=empty` or `?data=long`, `?role=viewer`,
`?delay=<ms>` (each read takes this long), `?fail=<table>` (`User`,
`StatusPage`, ... or `all`), `?lang=de|ja|fa` or `?theme=dark`.
