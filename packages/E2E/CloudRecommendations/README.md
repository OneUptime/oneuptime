# Cloud recommendations fixture

An offline harness for a cloud account's and a cloud resource's **recommended
monitors**, and the **scheduled maintenance** that holds a cloud resource.

It bundles the production Cloud account layout
(`packages/App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/View/Layout.tsx`:
its side menu, with the Recommendations count) with the account's
Recommendations page, and a cloud resource's layout
(`Pages/Cloud/View/Layout.tsx`: its side menu) with its Recommendations and
Scheduled Maintenance pages, under their real `RouteMap` patterns, with
esbuild. It replaces only the `ModelAPI` / `AnalyticsModelAPI` / `API` /
`Realtime` data boundary and the signed-in user, and serves the pages on
`127.0.0.1:4749` (`CLOUD_RECOMMENDATIONS_FIXTURE_PORT`). No Docker, no
database, no sign-in.

```sh
cd packages/E2E
npm run test-cloud-recommendations-ui
```

## Dataset

An "Acme Commerce" workspace with one AWS account, `Production`, that a
connection reads (`Fixture/Data.js`): an Application Load Balancer, `web-alb`,
in front of three EC2 instances (`web-3` so new its metrics have not arrived),
two RDS instances (`orders-db`, whose inventory lists its allocated storage,
and `reports-db`, whose does not), three Lambda functions (one with a long
name, as a team's naming convention writes them) and an SQS queue - and the
resources no recommended monitor is for yet: a network load balancer
(`AWS/NetworkELB`), a VPC and an S3 bucket. One row of the account is an App
Platforms environment, never a cloud resource here.

The monitors a scenario starts with are built exactly as the page builds them
(`MonitorRecommendationCatalog` and `MonitorRecommendationUtil`), so what
covers a recommendation is read back as the server would answer it. Every
monitor the pages make is kept, and recorded with what it is linked to and how
often it runs.

## Scenarios

Query parameters on any page:

| Parameter     | Values                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `coverage`    | `fresh` (default: no monitor made), `some` (web-1's two and orders-db's High CPU made, orders-db's Low Free Storage dismissed), `all` |
| `role`        | `owner` (default) or `viewer` (may read, may not create a monitor)                                                                    |
| `maintenance` | `none` (default) or `held`: an event in progress holds orders-db, and another is scheduled for next week                              |
| `fail`        | `monitors`: the read of what covers a recommendation answers 500; `create`: every monitor create is refused                           |
| `lang`        | `de` or `fa` (Persian, laid out right to left)                                                                                        |
| `theme`       | `dark` adds `html.dark` (server.js)                                                                                                   |

## What the fixture records

`window.__cloudRecommendationsFixture` holds every read: `listRequests`,
`countRequests`, `itemRequests`, `apiRequests`, `creates` (each monitor made:
its name, type, interval and linked cloud resources), `deletes` and
`unhandled` - anything the fixture does not model. Every test fails on a page
error, on a request that leaves `127.0.0.1`, and on anything in `unhandled`.

Screenshots land in `output/playwright/cloud-recommendations-ui/*-synthetic.png`.

To look at a page by hand, start the server and open a URL:

```sh
node CloudRecommendations/Fixture/server.js
# http://127.0.0.1:4749/dashboard/10000000-0000-4000-8000-000000000001/cloud/accounts/30000000-0000-4000-8000-000000000001/recommendations
# http://127.0.0.1:4749/dashboard/10000000-0000-4000-8000-000000000001/cloud/40000000-0000-4000-8000-000000000007/recommendations
# http://127.0.0.1:4749/dashboard/10000000-0000-4000-8000-000000000001/cloud/40000000-0000-4000-8000-000000000003/scheduled-maintenance?maintenance=held
```
