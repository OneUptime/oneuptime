# Data Security fixture

An offline harness for Data Security's pages, mounted from the product's real route tree
(`Routes/DataSecurityRoutes`) under its real RouteMap pattern (`DATA_SECURITY_ROOT`,
`/dashboard/:projectId/data-security/*`):

| Page                | Route                                | What the spec does there                                                                                                                                                                                        |
| ------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview            | `/data-security`                     | The riskiest open issues first, each opening its issue; what OneUptime AI contained this week and what waits                                                                                                    |
| Data Stores         | `/data-security/stores`              | On a phone                                                                                                                                                                                                      |
| A store's Overview  | `/data-security/stores/:id`          | Its half-width cards' headers; its menu's Timeline                                                                                                                                                              |
| What's Inside       | `/data-security/stores/:id/inside`   | On a phone; OneUptime AI's suggestions and verdicts across each finding's row, with their reasons and the decisions they rest on; Confirm; Mark as Not Sensitive from its draft, then Apply to Similar Findings |
| Who Can Reach It    | `/data-security/stores/:id/access`   | On a phone; access unused for 90 days marked; ARNs in monospace; each row opens its identity                                                                                                                    |
| A store's Timeline  | `/data-security/stores/:id/timeline` | Who changed what, its details; German; dark                                                                                                                                                                     |
| Access              | `/data-security/access`              | Every identity, the riskiest first, each opening its page; a new project's                                                                                                                                      |
| An identity         | `/data-security/access/:id`          | What it reaches and through what; Last Used and what it means; a traced service's page; Persian; a phone, dark                                                                                                  |
| Issues              | `/data-security/issues`              | On a phone                                                                                                                                                                                                      |
| An issue            | `/data-security/issues/:id`          | Fix it from here, its question and its result; the Open status; its case, alert and incident links; its AI card; OneUptime AI's analysis, at 1280 and on a phone                                                |
| A telemetry issue   | `/data-security/issues/:id`          | Where each finding sits and its records, the data marked and masked; Scrub It says the rule it makes, whose records it changes and what reads the data first; a Security Viewer; German, Persian                |
| An issue's Timeline | `/data-security/issues/:id/timeline` | The response action the issue ran                                                                                                                                                                               |
| AI                  | `/data-security/ai`                  | What OneUptime AI proposes, made and left alone, and the rule that decided; the AI rules; Approve shows the change first; at 1280 and on a phone                                                                |
| Compliance          | `/data-security/compliance`          | A framework without a score says why; the record of processing: each store that holds personal data, what it holds and who can reach it; a new project's                                                        |
| Settings > Checks   | `/data-security/settings/checks`     | On a phone                                                                                                                                                                                                      |
| Scan Settings       | `/data-security/settings/scanning`   | When an Issue Opens: incidents beside alerts, each with its severity                                                                                                                                            |

`Fixture/server.js` bundles `Fixture/Fixture.js` with esbuild, serves it with the same Tailwind
build, `tailwind.config`, `Theme.css` and Inter font production uses, and listens on
`127.0.0.1:4255` (`DATA_SECURITY_FIXTURE_PORT`). No Docker, no database, no sign-in.

## What is real and what is stubbed

Real: the product's layout, side menus and breadcrumbs, a store's and an issue's own layouts, every
page and its components, the response panel (Fix it from here) and its confirmation, and the
production i18n helpers that set `<html lang>`, `<html dir>` and the dates' language.

Stubbed:

- The data boundary: `ModelAPI` (in-memory tables of a synthetic "Acme Commerce" project, with
  their relations joined at read time), `API` (Data Security's own routes: the Overview's figures,
  worked out from the tables, and a store's response actions) and `Realtime`.
- The signed-in user ("Maya Chen") and her permissions. The fixture header says the data is
  synthetic ("Preview workspace · Synthetic data").
- `HOST` is the made-up `oneuptime.acme-commerce.example`. Nothing is ever fetched from it.

The data: four stores (a public S3 bucket of customer exports holding card numbers and email
addresses, an RDS database, a BigQuery warehouse and a service's logs), their findings with masked
samples - three of the database's with OneUptime AI's verdicts and the team's decisions they cite -
the bucket's access, scans and owners, five issues (one an accepted risk), and the bucket's
and its public-read issue's timelines. The public-read issue links to the security case, the alert
and the incident it started, and the project's settings raise alerts and declare incidents, with two
alert and two incident severities to pick from.

Each issue is of one of the catalog's own checks (`getDataSecurityCheck`), titled and grouped as
the server writes it; the fixture throws on a check id the catalog has not. Each store's open issue
count, worst severity and risk are worked out from its open issues, as the evaluator keeps them.

## Scenarios

| Parameter    | Values                                                                                                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `?lang=`     | `en` (default), `de` or `fa`: the Dashboard's own locale files                                                                                                                                                                           |
| `?theme=`    | `dark` adds `html.dark` (done in `server.js`, before the bundle runs)                                                                                                                                                                    |
| `?role=`     | `owner` (default) or `viewer`: Security Viewer only, who reads everything and changes nothing                                                                                                                                            |
| `?response=` | `on` (default) or `off`: the bucket's cloud connection has "Data security response" on, or off                                                                                                                                           |
| `?data=`     | `default`, `empty` (a new project: no cloud connection, nothing found) or `busy` (26 more stores with long names, an open issue or two on each)                                                                                          |
| `?fail=`     | `reads`: every read fails, as when the API is down, so each page shows how it says so                                                                                                                                                    |
| `?ai=`       | `on`: OneUptime AI has a proposal waiting on the logs' email issue, a change made without asking, an issue left alone and one AI rule, Production stores (Data Security → AI); and the public bucket's issue has OneUptime AI's analysis |

The spec pins the browser clock to `2026-10-27T12:00:00Z`.

The project has Enable AI and **Work on new issues** on, as a new project does, and a provider to use. A
press on a proposal moves it on - made, dismissed or undone - and a Security Viewer's is refused, as the
server refuses it.

Besides the tables above, it models Compliance's scores (worked out from the stores and their open
issues with the catalog's own `scoreComplianceFramework`, as the server does), an owner rule, the
project's members, the probe picker, a flow's stores at both ends and a content scan's details. It
also models:

- the record of processing on Compliance: a row for each store that holds personal data, with its data
  types by the catalog's names, as the server writes it. The project keeps none of the stores
  OneUptime declares, because it doesn't use Security Events;
- what Scrub It says before it makes its rule (#10433): the rule it plans for the finding's service,
  proven on the finding's records (counts only), and a monitor that groups the checkout service's
  failed requests by client address, which would read what the rule hides. Asked again, it names the
  rule it made, or the team's own rule for phone numbers;
- the IP Address rules that hide addresses from Security Events (#10396): none. Security Events reads
  none of the project's logs or spans, so Scrub It redacts an IP address rather than hashing it. A
  Security Viewer, who may not read scrub rules, is refused, as the server refuses them.

`DataSecurityLayout.spec.ts` holds the pages to the UI review: every list fits a laptop's card beside
the side menu in German and Persian with the busy data set, the Overview's figures line up and its day
chart keeps its dates inside it in the reader's language, a store names its owners, an issue says what
is wrong on a phone, Scans sit in Advanced and the settings page is Scan Settings, Compliance says why a
framework has no score, and a new project and failing reads read as they should.

## What the fixture records

`window.__dataSecurityFixture` holds `getItemRequests`, `listRequests`, `countRequests`,
`apiRequests`, `updates`, `creates` and `unhandled`: anything the fixture does not model. The spec
fails on an `unhandled` entry, on an uncaught page error and on any request that leaves the server.

## Running it

```bash
cd packages/E2E
npm run test-data-security-ui
```

Screenshots are written to `output/playwright/data-security-ui/`.
