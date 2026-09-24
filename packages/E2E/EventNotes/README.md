# Event notes fixture

An offline harness for the real public and private note pages of the dashboard's events:

| Page                                         | Route (from `RouteMap`)                                                    | Production components                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Incident public / private notes              | `INCIDENT_VIEW_PUBLIC_NOTE`, `INCIDENT_VIEW_INTERNAL_NOTE`                 | `Pages/Incidents/View/{Layout,PublicNote,InternalNote}`                  |
| Alert private notes                          | `ALERT_VIEW_INTERNAL_NOTE`                                                 | `Pages/Alerts/View/{Layout,InternalNote}`                                |
| Scheduled maintenance public / private notes | `SCHEDULED_MAINTENANCE_PUBLIC_NOTE`, `SCHEDULED_MAINTENANCE_INTERNAL_NOTE` | `Pages/ScheduledMaintenanceEvents/View/{Layout,PublicNote,InternalNote}` |
| Incident episode public / private notes      | `INCIDENT_EPISODE_VIEW_PUBLIC_NOTE`, `INCIDENT_EPISODE_VIEW_INTERNAL_NOTE` | `Pages/Incidents/EpisodeView/{Layout,PublicNote,InternalNote}`           |
| Alert episode private notes                  | `ALERT_EPISODE_VIEW_INTERNAL_NOTE`                                         | `Pages/Alerts/EpisodeView/{Layout,InternalNote}`                         |

Every one of those pages is a thin wrapper around the shared notes feed in
`App/FeatureSet/Dashboard/src/Components/EventNotes`.

`Fixture/server.js` bundles the production layouts and pages with esbuild, serves them with
the same Tailwind build, `tailwind.config` and `Theme.css` production uses, and listens on
`127.0.0.1:4223` (`EVENT_NOTES_FIXTURE_PORT`). No Docker, no database, no sign-in. Only the
`ModelAPI` / `API` data boundary and the signed-in user are replaced. Pass `--watch` to
rebuild on every change while working on the pages.

Every record is fabricated for a generic "Acme Commerce" workspace, and the fixture header
says so ("Preview workspace · Synthetic data"). Dates are relative to the moment the page
loads; the spec pins the browser clock.

## What is modelled

- **Incident #1042** with four public notes (notified, a failed notification with the
  worker's message and two attachments, one posted by OneUptime itself, one posted from
  Slack with a sent update notification) and three private notes.
- **Alert #311**, **scheduled maintenance #58**, **incident episode #12** and **alert
  episode #7**, each with a few notes; #58 and #12 have notifications still on their way.
- **Note templates** for incidents, alerts and scheduled maintenance.
- **Writes** are applied to the in-memory tables the way the server applies them: a new
  public note gets a Pending notification (or Skipped when posted without notifying), which
  moves to In progress and then Success on the next reads of the feed; an edit that asks for
  an update notification queues one; a retry queues the notification again.
- **Draft with AI** answers `POST /<event>/generate-note-from-ai/:id` with a fixed draft.

## Scenarios

Query parameters, parsed once per page load:

| Parameter     | Values                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `?notes=`     | `full` (default), `empty` (no notes anywhere) or `many` (incident #1042 needs a second page)                                         |
| `?role=`      | `owner` (default, a master admin), `viewer` (reads, cannot write) or `member` (a Project Member, through the real permission checks) |
| `?templates=` | `some` (default), `none` or `many`                                                                                                   |
| `?quiet=1`    | incident #1042 was declared without notifying subscribers                                                                            |
| `?fail=`      | comma separated: `list`, `create`, `update`, `delete`, `resend`, `templates`, `ai`                                                   |
| `?theme=`     | `dark` adds `html.dark`                                                                                                              |

Every read and write is recorded on `window.__eventNotesFixture` (`listRequests`,
`getItemRequests`, `apiRequests`, `creates`, `updates`, `deletes`, `unhandled`). The spec
fails a test whose page made a request the fixture does not model.

## Running

```bash
cd packages/E2E && npm run test-event-notes-ui
```

Screenshots of every page land in `output/playwright/event-notes-ui/` under `-synthetic`
names.
