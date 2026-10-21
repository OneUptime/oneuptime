# List Delete fixture

An offline harness for the real
`packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/StatusPages.tsx` page and its
Archived page, a status page's own Delete page (`Pages/StatusPages/View/Delete.tsx`),
the Monitors list (`Pages/Monitor/Monitors.tsx`), an incident's State Timeline page
(`Pages/Incidents/View/StateTimeline.tsx`) and the Teams list
(`Pages/Teams/Index.tsx`). It bundles the production pages with esbuild, replaces
only the `ModelAPI` / `API` data boundary and the synthetic user's permissions, and
serves them on `127.0.0.1:4296`. No Docker, no database, no sign-in.

The suite drives Delete the way a person does, through every confirmation:

- each row's ⋯ menu offering Delete, last and after a divider;
- the row's dialog naming the status page, saying what goes with it
  (DeleteConsequences) and offering Archive instead; Cancel deletes nothing,
  Delete deletes that one row and the list refreshes;
- Bulk Actions offering Delete as a danger action; its dialog with the count,
  the names and what goes with them; the result ("2 Status Pages deleted"),
  the selection cleared and the list refreshed;
- a bulk Delete the server refuses part of (`?refuse=<id>`): the rest are
  deleted and the result says which one was not deleted and why;
- a bulk Delete that empties the last page lands on the last page with rows;
- a member who may not delete (`?role=viewer`): both Deletes locked, with the
  missing permission on hover, and nothing sent;
- the Archived page (`?page=archived`), which does not offer to archive;
- a phone-width screen and dark mode (`?theme=dark`);
- an incident's State Timeline (`?page=incident-timeline`), in its table - the
  page opens on the timeline, and the fixture picks Table as the page's switch
  does (`E2E/StatusTimeline` drives the timeline): the only state's
  Delete locked in the server's words; each other state's dialog naming it and
  its start and saying what deleting it does (the state before becomes current
  again, or takes over its time); a bulk Delete naming each row by its state
  and start, and saying the rule; rows called state changes, not the model's
  "Incident State Timeline";
- the Teams list (`?page=teams`): Owners and Admin keep Delete locked, saying
  why; a project's own team deletes after a dialog that says what goes with it;
  a bulk Delete that includes a built-in team deletes the rest and lists it as
  not deleted;
- the Monitors list (`?page=monitors`): the row's and the bulk Delete's dialogs
  name what goes with a monitor (its SLOs included) and offer Archive instead;
- a status page's own Delete page (`?page=status-page-delete`): the card and
  its dialog say the same thing about what goes as the list's Delete does;
- the dialogs in German and Japanese (`?lang=de`, `?lang=ja`): every sentence
  translated, and Japanese sentences run on without a space after "。";
- a name with nowhere to break (`?long=1`) wrapping inside the dialog on a
  phone;
- on a phone: the Bulk Actions menu opening on the screen, and a tap on a
  locked Delete showing why it is locked and keeping it shown;
- a bulk Delete refused for one reason (`?rows=6&refuse=<the six ids>`): the
  reason said once, with every status page under it;
- the timeline dialog on a phone: when the state began on one line, and what
  deleting it does in a paragraph of its own.

`Fixture/Fixture.js` records every DELETE the page sends on
`window.__fixture.deletes`, so the assertions check what was deleted as well as
what the page drew. The timeline and the teams answer a delete as their services
do: the only state, and a team that comes with every project, are refused in the
server's words.

## Run it

```
cd packages/E2E
npm install
npm run test-list-delete-ui
```

Screenshots land in `output/playwright/list-delete-ui/`, named `*-synthetic.png`
because every record in them is fabricated.

## Poke at it by hand

```
cd packages/E2E
node ListDelete/Fixture/server.js
```

Then open
`http://127.0.0.1:4296/dashboard/10000000-0000-4000-8000-000000000001/status-pages`,
adding `?role=viewer`, `?refuse=30000000-0000-4000-8000-000000000003`,
`?page=archived`, `?rows=10`, `?long=1`, `?delay=700` (each delete takes that
long, to see a bulk Delete run), `?lang=de`, `?lang=ja` or `?theme=dark` as
needed.

The other pages:

- an incident with three states:
  `http://127.0.0.1:4296/dashboard/10000000-0000-4000-8000-000000000001/incidents/40000000-0000-4000-8000-000000000001/state-timeline?page=incident-timeline`
- an incident with only the state it was declared in: the same with
  `40000000-0000-4000-8000-000000000002`
- the Teams list:
  `http://127.0.0.1:4296/dashboard/10000000-0000-4000-8000-000000000001/settings/teams?page=teams`
- the Monitors list:
  `http://127.0.0.1:4296/dashboard/10000000-0000-4000-8000-000000000001/monitors?page=monitors`
- Demo Status's own Delete page:
  `http://127.0.0.1:4296/dashboard/10000000-0000-4000-8000-000000000001/status-pages/30000000-0000-4000-8000-000000000002/delete?page=status-page-delete`

Each takes `&theme=dark` too.
