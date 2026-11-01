# App Platforms fixture

An offline harness for **App Platforms**, the product the apps on managed app
and container platforms moved to out of Cloud: AWS ECS and Fargate, App Runner
and Elastic Beanstalk, Google Cloud Run and App Engine, Azure Container Apps,
Container Instances and App Service. Cloud keeps its accounts and every
resource in them. Both kinds are rows of the `CloudResource` table, told apart
by `cloudResourceKind` (`environment` or `resource`).

It bundles the production route group
(`packages/App/FeatureSet/Dashboard/src/Routes/AppPlatformsRoutes.tsx`: its
layout and side menus, Overview, All Environments, an environment's pages, the
rules and Archived) and Cloud's resource view layout
(`Pages/Cloud/View/Layout.tsx`, which forwards an environment to App
Platforms), under their real `RouteMap` patterns, with esbuild. It replaces
only the `ModelAPI` / `AnalyticsModelAPI` / `API` / `Realtime` data boundary
and the signed-in user, and serves the pages on `127.0.0.1:4667`
(`APP_PLATFORMS_FIXTURE_PORT`). No Docker, no database, no sign-in.

```sh
cd packages/E2E
npm run test-app-platforms-ui
```

## Dataset

An "Acme Apps" workspace with six environments on four platforms: two on AWS
ECS (`checkout` connected, `billing` last seen three hours ago), two on Google
Cloud Run, one on Azure Container Apps and one on Azure App Service that has
never sent anything. `checkout` runs three tasks (30, 36 and 42% CPU; 256, 512
and 768 MiB), and its spans and memory come back as smooth series over the last
half hour (about 1,300 requests, a 1.5% error rate, a p95 of about 120 ms).

One row is a resource of a connected Azure account, `vm-prod-01`: Cloud's,
never listed in App Platforms. Its App Platforms address forwards to Cloud.

Owner and label rules come in each kind: App Platforms' own, Cloud's own
(never listed here), and one made before the split, for both, which wears the
**Also in Cloud** pill.

Lists are filtered on the query's plain values, `Includes`, `EqualToOrNull`
and ids, and sorted as the server sorts them. The telemetry explorers (an
environment's Metrics, Logs and Traces) read an environment that has sent no
logs or spans in the range. Any route not listed above renders a "Not
modelled" stub (`data-testid="stub-page"`).

## Scenarios

Query parameters on any page:

| Parameter | Values                                                       |
| --------- | ------------------------------------------------------------ |
| `state`   | `empty`: no environment yet (the Overview's first-run guide) |
| `lang`    | `de` or `fa` (Persian, laid out right to left)               |
| `theme`   | `dark` adds `html.dark` (server.js)                          |

## What the fixture records

`window.__appPlatformsFixture` holds every read: `listRequests`,
`countRequests`, `itemRequests`, `aggregateRequests`, `apiRequests` and
`unhandled` - anything the fixture does not model. Every test fails on a page
error, on a request that leaves `127.0.0.1`, and on anything in `unhandled`.

Screenshots land in `output/playwright/app-platforms-ui/*-synthetic.png`.

To look at a page by hand, start the server and open a URL:

```sh
node AppPlatforms/Fixture/server.js
# http://127.0.0.1:4667/dashboard/10000000-0000-4000-8000-000000000001/app-platforms
# http://127.0.0.1:4667/dashboard/10000000-0000-4000-8000-000000000001/cloud/71000000-0000-4000-8000-000000000001/settings
```
