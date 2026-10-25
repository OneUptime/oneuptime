# Backups fixture

An offline harness for Admin Dashboard > Settings > Backups, the Enterprise
Edition's backups of PostgreSQL and ClickHouse (`ee/AdminDashboard/Backups`).
It bundles the production page with esbuild, through the Admin Dashboard's
Enterprise plugin (`getAdminDashboardPlugins().SettingsPages`), replaces only
the `ModelAPI` / `API` data boundary and the signed-in master admin, and serves
it on `127.0.0.1:4591`. No Docker, no database, no sign-in.

```bash
cd packages/E2E
npm run test-backups-ui
```

`Fixture/Fixture.js` holds the backup settings and runs in memory and answers
the `/backup/*` routes from them. The query string picks the scene:

| Parameter | Values                                                                   |
| --------- | ------------------------------------------------------------------------ |
| `scene`   | `first-run`, `on` (the default), `running`, `failed`, `restoring`, `off` |
| `license` | `valid` (the default), `grace`, `lapsed`, `not-included`                 |
| `test`    | `ok` (the default) or `fail`: what Test the destination answers          |
| `preview` | `ok` (the default), `problem` or `warning`: what a restore's check finds |
| `lang`    | `de`, `ja` or `fa`: the Admin Dashboard's own words                      |
| `theme`   | `dark`                                                                   |

Every post to `/backup/*` is recorded on `window.__fixture.posts`, every write
of the settings on `window.__fixture.writes`, and every read the fixture does
not model on `window.__fixture.unmodeled`, which each spec expects to stay
empty.

`Backups.spec.ts` drives the page the way a master admin does, at 1280 and 390
pixels, light and dark:

- the first run: what backups do, Set up backups, and the recommended
  destinations;
- setting up: a destination's card, its own fields and setup guide, Test the
  destination before anything is saved (the secret sent only among the
  secrets), the schedule's defaults, and what Start backing up writes;
- a destination whose test fails, saying what to change;
- backups on (the status card's ⋯ the same button as the tables'), a backup
  running (its step, how long it has been going, and the steps dialog), a
  backup that failed (its error at the top, the last good backup beside it,
  and the step it stopped on), a restore running;
- a restore's confirmation: what it replaces, the counts in the backup and now,
  the backup of the current data first, and Restore locked until `restore` is
  typed; a backup that cannot be restored says only why, and the dialog only
  closes;
- deleting a backup, turning the schedule off (Turn on becomes the one primary
  button) and on, Find backups, and a lapsed license, which pauses new backups
  but keeps restoring and deleting;
- on a phone, the folded side menu names the page (not "Navigation"), and the
  tables' own words are the Admin Dashboard's German.

The server builds the page twice: `/admin/settings/backups` resolves the plugin
as the Admin Dashboard's build does (the Enterprise Edition when ee/ is checked
out), and `/community/admin/settings/backups` always builds the Community
Edition, whose Settings side menu the last spec holds to having no Backups
entry. `/edition.json` says which edition the first one is, so the Enterprise
specs skip where ee/ is not there. The Enterprise Edition Test workflow runs
this suite with ee/ present (`.github/workflows/test.ee.yaml`, job
`backups-ui`).

Screenshots land in `output/playwright/backups-ui/`.
