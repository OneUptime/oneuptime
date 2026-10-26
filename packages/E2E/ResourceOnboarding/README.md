# Resource onboarding fixture

An offline harness for adding a resource the way a host is added (`Components/ResourceOnboarding`): a
list's Add button opens the resource's setup guide in a dialog, the guide names the resource and writes the
name into its commands, and its last step watches for the resource to connect. An empty list shows what the
product gives instead (`Components/ResourceShowcase`), with the same Add button. A database, a queue or a RUM
application is added with its form, and its prefilled guide then opens on its own.

| Page                 | Route (from `RouteMap`)                                            | Production components                                         |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| Kubernetes clusters  | `KUBERNETES_CLUSTERS` `/dashboard/:projectId/kubernetes`           | `Pages/Kubernetes/Layout` and `Pages/Kubernetes/Clusters`     |
| Docker hosts         | `DOCKER_HOSTS` `/dashboard/:projectId/docker`                      | `Pages/Docker/Layout` and `Pages/Docker/Hosts`                |
| IoT fleets           | `IOT_FLEETS` `/dashboard/:projectId/iot`                           | `Pages/IoT/Layout` and `Pages/IoT/Fleets`                     |
| Serverless functions | `SERVERLESS_FUNCTIONS` `/dashboard/:projectId/serverless`          | `Pages/Serverless/Layout` and `Pages/Serverless/ServerlessFunctions` |
| RUM applications     | `RUM_APPLICATIONS` `/dashboard/:projectId/rum`                     | `Pages/Rum/Layout` and `Pages/Rum/RumApplications`            |
| Databases            | `DATABASE_SERVERS` `/dashboard/:projectId/databases`               | `Pages/Database/Layout` and `Pages/Database/Databases`        |
| Queues               | `MESSAGE_QUEUES` `/dashboard/:projectId/queues`                    | `Pages/MessageQueue/Layout` and `Pages/MessageQueue/MessageQueues` |

Run from `packages/E2E`:

```sh
npm run test-resource-onboarding-ui
```

`Fixture/server.js` bundles the production layouts and pages with esbuild, serves them with the same Tailwind
build, `tailwind.config`, `Theme.css` and Inter production uses, and listens on `127.0.0.1:4479`
(`RESOURCE_ONBOARDING_FIXTURE_PORT`). No Docker, no database, no sign-in. Only the `ModelAPI` / `API` data
boundary and the signed-in user are replaced, and the queries the guides make are answered as the server would
(a `Search` is a case-insensitive "contains", a `GreaterThanOrEqual` compares dates). The locale files are the
real `en.json` and `de.json`. Every record is fabricated for an "Acme Infrastructure" workspace.

## Scenarios

Picked with query parameters:

- `clusters=1`: the project has two clusters, "my-cluster" (reporting, so the guide starts with
  "my-cluster-2") and "Legacy East" (`legacy-east`, added by hand long ago and never connected).
- `keys=none`: the project has no ingestion key (a Server and a Browser key by default).
- `lang=de`, `theme=dark`.

`window.__resourceOnboardingFixture` is the world outside the browser: `arrive(kind, name)` is an agent
reporting for the first time (ingest registers the record: `kubernetes`, `docker`, `iot`, `serverless` or
`rum`), `report(kind, name)` a record the project has reporting again, `engineMetrics(name)` a database's first
engine metrics and `queueData(name)` a queue's first data. Create on the Databases, Queues and RUM lists stores
what the form sent, as the services fill it in. The spec installs Playwright's clock before the page loads and
moves it on by the last step's 5 seconds (and an empty list's 10) to see the page look again.

What the pages read and create is recorded on the same object (`listRequests`, `countRequests`, `itemRequests`,
`creates`, `apiRequests`) with `unhandled` for anything the fixture does not model; the spec fails on an
unhandled request, on an uncaught page error and on any request that leaves the fixture server. Screenshots are
written to `output/playwright/resource-onboarding-ui/`.
