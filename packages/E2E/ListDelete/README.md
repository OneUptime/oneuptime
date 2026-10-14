# Status Pages list Delete fixture

An offline harness for the real
`packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/StatusPages.tsx` page and its
Archived page. It bundles the production pages with esbuild, replaces only the
`ModelAPI` / `API` data boundary and the synthetic user's permissions, and serves
them on `127.0.0.1:4296`. No Docker, no database, no sign-in.

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
- a phone-width screen and dark mode (`?theme=dark`).

`Fixture/Fixture.js` records every DELETE the page sends on
`window.__fixture.deletes`, so the assertions check what was deleted as well as
what the page drew.

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
`?page=archived`, `?rows=10` or `?theme=dark` as needed.
