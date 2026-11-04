# Cloud Spend fixture

An offline harness for **Cloud's Overview** and its **Spend** pages - Costs,
Savings and Budgets - and an account's **Costs** tab: what every connected
account needs attention for, what it costs, the ways to spend less and the
budgets that alert before a month costs too much.

It bundles the production route group
(`packages/App/FeatureSet/Dashboard/src/Routes/CloudResourceRoutes.tsx`: its
layout, side menus, trail and every page) under its real `RouteMap` pattern,
with esbuild. It replaces only the `ModelAPI` / `AnalyticsModelAPI` / `API` /
`Realtime` data boundary and the signed-in user, and serves the pages on
`127.0.0.1:4741` (`CLOUD_SPEND_FIXTURE_PORT`). No Docker, no database, no
sign-in.

```sh
cd packages/E2E
npm run test-cloud-spend-ui
```

## Dataset

An "Acme Cloud" workspace with five accounts on three clouds, read by one
connection: `web-prod` and `data-lake` on AWS, `analytics` on Google Cloud,
`core-prod` and `eu-shop` on Azure (`eu-shop` billed in euros, `core-prod`
not allowed to read its costs yet, in Azure's own words).

Their costs are made up day by day from the start of the month before last
to today - each account's services, Regions and, where the cloud names it (a
billing export), resources; a little higher each month, with a weekly swing,
and today's in part, as a cloud reports it. Every figure the pages show is
worked out from those rows as the server works it out: each account's
summary (`summarizeCloudAccountCosts`, `summarizeCloudAccountSavings` from
`Common/Types/Cloud/CloudCost`), each day's sum and each breakdown (the
`/aggregate` sums, in the window, currency and accounts asked for), the
budgets' month so far. So the Overview, Costs, an account's Costs and Budgets
agree with each other, as they do for real. Yesterday, `data-lake`'s Amazon
Athena cost about two and a half times its usual day: the one unusual day
on Costs, found by the writer's own `findCloudCostAnomalies`
(`Common/Types/Cloud/CloudCostAnomaly`).

Seven ways to spend less from the clouds' recommenders (rightsizing, a
Savings Plan, an idle volume and address, a gp2 volume to upgrade), three
resources whose last read found something wrong (`web-1` failing its status
checks, `orders-db` 92% full at 97% CPU, `sessions-cache` at 99% CPU), four
budgets (one past 80%, one on course to pass, one within, one paused) and two
App Platforms environments with four apps in the accounts.

## Scenarios

| Query                  | What it shows                                            |
| ---------------------- | -------------------------------------------------------- |
| (none)                 | The busy workspace above                                 |
| `?state=unread`        | No account's costs or recommendations read yet           |
| `?state=empty`         | A new project: no cloud account                          |
| `?fail=accounts`       | The first read of the accounts fails; Refresh answers    |
| `?fail=costs`          | The first read of each costs card fails; Refresh answers |
| `?lang=de`, `?lang=fa` | German, Persian (right to left)                          |
| `?theme=dark`          | Dark                                                     |

The figures are made up from the page's own clock, and the accounts' costs
read two hours before it, but never before today's start (a read made before
midnight would end at yesterday while every page sums today's rows). To run
the whole suite at another hour, start the page's clock there:
`CLOUD_SPEND_CLOCK=2026-03-01T00:30:00Z npm run test-cloud-spend-ui`. The
suite's own "at any hour of the UTC day" tests run at 00:30 and 12:00 UTC on a
month's first day.

Every read is recorded on `window.__cloudSpendFixture` (`listRequests`,
`countRequests`, `itemRequests`, `aggregateRequests`, `creates`, `updates`
and `unhandled`); the spec fails on anything in `unhandled`.
