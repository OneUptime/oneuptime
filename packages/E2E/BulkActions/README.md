# Bulk Actions fixture

An offline harness for the bulk actions the table audit built on the shared
bulk switch (`Common/UI/Components/BulkUpdate/BulkSwitchActions.tsx`), and for
the Admin Dashboard's Enterprise Licenses list. It bundles the production pages
with esbuild, replaces only the `ModelAPI` / `API` data boundary and the
synthetic user's permissions, and serves them on `127.0.0.1:4458`. No Docker,
no database, no sign-in.

The pages:

- the Workflows list (`Pages/Workflow/Workflows.tsx`, the default);
- the Monitors list (`?page=monitors`), whose Enable and Disable write Disable
  Monitoring the other way round;
- a status page's Email Subscribers (`?page=subscribers`), whose only bulk
  change is Unsubscribe;
- Admin Dashboard > Enterprise Licenses (`?page=licenses`, under `/admin/`),
  reached through the Admin Dashboard's Enterprise plugin, as its own build
  reaches it.

`BulkActions.spec.ts` drives the shared switch the way a person does:

- an action offered only when it would change something (Enable for rows that
  are off, Disable for rows that are on);
- the question that counts only the rows that will change, names them, and
  says what the change does to them (`BulkSwitchConsequences.ts`); Cancel sends
  nothing;
- one update per row, of the switch only, and a result that says how many
  changed, which were left alone and why ("Already disabled."), and which the
  server refused, in its words (`?refuse=<ids>`);
- a member who may not change the list (`?role=viewer`): the actions locked,
  with the missing permission on hover, and nothing sent;
- Unsubscribe on the subscriber list, and never a way to subscribe people
  again;
- a phone's width (390 pixels), dark mode (`?theme=dark`) and German
  (`?lang=de`).

`EnterpriseLicenses.spec.ts` drives the license list: Delete in each row's ⋯
menu and in Bulk Actions, both naming each license by its company and masked
key and saying what deleting one does to the installations that use its key;
and the bulk Change Expiry Date, which asks for a day after today, writes it to
each license, leaves one already expiring that day alone, and lists one the
server refuses; and Export CSV, whose file reads like the list, every key
masked. At 1280 and 390 pixels, light and dark, and in German.

A switch's question counts only the rows it changes, and says how many of the
selection are in that state already ("1 selected workflow is already
disabled."), so the count under the question and the count in the bar add up.

The Enterprise Licenses screen ships in the Enterprise Edition. The server
resolves the Admin Dashboard's plugin as its build does
(`Common/UI/esbuild-enterprise.js`), says which edition it bundled at
`/edition.json`, and the license specs skip where ee/ is not checked out - as
in the Dashboard Offline UI job, which removes it. `ONEUPTIME_EDITION=community`
builds the Community Edition with ee/ present.

`Fixture/Fixture.js` records every update the page sends on
`window.__fixture.updates` and every delete on `window.__fixture.deletes`, so
the assertions check what was written as well as what the page drew.

## Run it

```
cd packages/E2E
npm install
npm run test-bulk-actions-ui
```

Screenshots land in `output/playwright/bulk-actions-ui/`, named
`*-synthetic.png` because every record in them is fabricated.

## Poke at it by hand

```
cd packages/E2E
node BulkActions/Fixture/server.js
```

Then open
`http://127.0.0.1:4458/dashboard/10000000-0000-4000-8000-000000000001/workflows`,
or `http://127.0.0.1:4458/admin/settings/enterprise-licenses?page=licenses`.
