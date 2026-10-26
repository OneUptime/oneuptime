# Infrastructure first-run fixture

An offline harness for the real first run of the infrastructure lists: a project with nothing on
it opens a list, sees the empty table and under it what the product gives (its showcase, with the
list's Add button; Cloud resources keeps its Connect tiles and folded guide), and the list fills in
on its own when the first record arrives (`Components/Infrastructure/UseFirstRecordWatch`).

| Page            | Route (from `RouteMap`)                                             | Production components                                     |
| --------------- | ------------------------------------------------------------------- | --------------------------------------------------------- |
| Hosts           | `HOSTS` `/dashboard/:projectId/host`                                | `Pages/Host/Layout` and `Pages/Host/Hosts`                |
| vCenters        | `VMWARE_VCENTERS` `/dashboard/:projectId/vmware`                    | `Pages/VMware/Layout` and `Pages/VMware/VCenters`         |
| Cloud resources | `CLOUD_MONITORED_RESOURCES` `/dashboard/:projectId/cloud/resources` | `Pages/Cloud/Layout` and `Pages/Cloud/MonitoredResources` |

Run from `packages/E2E`:

```sh
npm run test-infrastructure-first-run-ui
```

`Fixture/server.js` bundles the production layouts and pages with esbuild, serves them with the
same Tailwind build, `tailwind.config` and `Theme.css` production uses, and listens on
`127.0.0.1:4352` (`INFRASTRUCTURE_FIRST_RUN_FIXTURE_PORT`). No Docker, no database, no sign-in.
Only the `ModelAPI` / `API` data boundary and the signed-in user are replaced. The locale files
are the real `en.json` and `de.json`. Every record is fabricated for an "Acme Infrastructure"
workspace, and the fixture header says so ("Preview workspace · Synthetic data").

## Scenarios

Picked with query parameters:

- `hosts=1`: the project already has a host ("web-01").
- `vcenters=1`: the project already has two vCenters, "vcenter-lab" (a probe collects it, "Lab
  Probe") and "vcenter-prod" (an outdated VMware Agent sends it). The All vCenters specs open the
  list on its five default columns and switch Collected By and Agent Version on from Customize
  Columns, at a laptop's and a phone's width, and in German (`lang=de`), where the dialog's
  search finds both by their German names. Each also measures the dialog's list: all seven
  columns in view, and a height that would cut an eighth row in half.
- `failFirstCount=1`: the page's first count of its list fails once, so the page shows the error
  with its Refresh; the count after it answers as usual.
- `lang=de`, `theme=dark`.

`window.__infrastructureFirstRunFixture.arrive(kind)` is an agent reporting (`host`, `vcenter`
or `cloudResource`): the project has that first record from then on. The spec installs
Playwright's clock before the page loads and moves it on by the watch's 10 seconds to see the
page look again.

Every read is recorded on `window.__infrastructureFirstRunFixture` (`countRequests`,
`listRequests`, `apiRequests`) with `unhandled` for anything the fixture does not model; the
spec fails on an unhandled request, on an uncaught page error and on any request that leaves the
fixture server. Screenshots are written to `output/playwright/infrastructure-first-run-ui/`.
