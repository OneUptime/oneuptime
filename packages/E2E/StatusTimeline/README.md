# Status Timeline fixture

An offline harness for the real status timeline pages of the Dashboard -
a monitor's (`packages/App/FeatureSet/Dashboard/src/Pages/Monitor/View/StatusTimeline.tsx`),
an incident's, an alert's, a scheduled maintenance event's, both kinds of
episode's and a network site's - all opening on the shared timeline
(`Common/UI/Components/StatusTimeline/ModelStatusTimeline`).
It bundles the production pages with esbuild, replaces only the `ModelAPI` /
`API` data boundary and the synthetic user's permissions, and serves them on
`127.0.0.1:4298`. No Docker, no database, no sign-in.

The suite drives the timeline the way a person does, with the reader in
London and the clock fixed at the maintainer's screenshot (Oct 14, 08:36 BST):

- a monitor opening on its past month: that month's status events and the one
  in effect when it began are read - never the whole history - and the cause
  and the log only when asked for;
- the band drawn to scale (the status now runs to "Now"), and the legend's
  share and time of each status;
- a 38-second outage wide enough to see, and to click a little beside it,
  showing its entry in the list;
- a cluster of changes too close to tell apart zooming in when clicked, and
  Reset zoom; a drag across the band zooming to exactly the stretch dragged;
- the period picker, the period before and after, and "Show the period
  before" under the list;
- View cause, an entry's ⋯ (Show ID, View Cause, View Logs, Delete), Delete's
  dialog saying what deleting the event does, and the monitor's only event
  locked in the server's words;
- Create Monitor Status Event, and the new status shown as the monitor's now;
- a Viewer: Create and Delete locked, saying which permission is missing;
- the keyboard: the band one tab stop, the arrow keys, Home/End and Enter;
- Timeline | Table, the table one click away and the choice remembered;
- a month of flapping (more changes than one read): the stretch not loaded
  says so, and Load reads the rest;
- a new monitor, an empty one, a phone's width, and the dark theme measured as
  drawn (every word at WCAG AA);
- an incident: its whole life on one band, each state's whole time, the
  subscriber notification and its Retry under each state change, an open
  incident running to "Now", one moved on to "Closed" (a state of the
  project's own after Resolved, with no flag) ending with its last change,
  every word at AA in both themes, and its only state's Delete locked;
- the other five pages: each opens on its timeline with what its table
  offered (Create, the subscriber line, a site's month and no actions), the
  table one click away, and nothing running off a phone's screen.

`Fixture/Fixture.js` records every list read on `window.__fixture.listRequests`
(with the `startsAt` bound it asked for), single reads on `itemRequests`, and
every delete, create and update, so the assertions check what the page asked
for as well as what it drew.

## Run it

```
cd packages/E2E
npm install
npm run test-status-timeline-ui
```

Screenshots land in `output/playwright/status-timeline-ui/`, named
`*-synthetic.png` because every record in them is fabricated.

## Poke at it by hand

```
cd packages/E2E
node StatusTimeline/Fixture/server.js
```

Then open
`http://127.0.0.1:4298/dashboard/10000000-0000-4000-8000-000000000001/monitors/60000000-0000-4000-8000-000000000001/status-timeline`,
adding `?scenario=flapping` (or `new`, `quiet`, `empty`), `?role=viewer`,
`?theme=dark` or `?lang=de`. For an incident, add `?page=incident` (with
`&scenario=ongoing`, `&scenario=declared` or `&scenario=closed`); for the
other pages `?page=alert` (`&scenario=resolved`), `?page=maintenance`
(`&scenario=ongoing`), `?page=incident-episode`, `?page=alert-episode` or
`?page=site`. `?fail=timeline` fails every read of the rows, and
`?delay=<ms>` slows each read, to see the error and loading states. The
page reads the browser's clock: the histories are counted back from when it
loads.
