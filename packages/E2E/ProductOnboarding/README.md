# Product onboarding fixture

An offline harness for how a product explains itself (`Components/ProductOnboarding`, #6430): while
a project has nothing in a product yet, the product's first page says what the product does under
its empty table - a pitch, the steps to a first result with the first as the page's own button, a
drawn example of the page in use and the product's documentation - and once there is something in
it, How it works beside the page's title (`ProductAboutButton`) opens the same explanation in a dialog.

Two lists stand for the two kinds of list:

| Page         | Route (from `RouteMap`)                             | Production components                                          | First step                         |
| ------------ | --------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------- |
| Monitors     | `MONITORS` `/dashboard/:projectId/monitors`         | `Pages/Monitor/Layout` and `Pages/Monitor/Monitors`            | a page of its own (Create Monitor) |
| Status Pages | `STATUS_PAGES` `/dashboard/:projectId/status-pages` | `Pages/StatusPages/Layout` and `Pages/StatusPages/StatusPages` | the table's own create form        |

And the page the issue was raised on, Data Observability's Overview (`DATA_OBSERVABILITY_OVERVIEW`,
`/dashboard/:projectId/data-observability/overview`, `Pages/DataObservability/Layout` and `Overview`):
no database connected yet, and one database the project's traces know of, which the page suggests
under the explanation. Its reads (`/data-observability/overview`, `/quality`, `/watched-tables` and
`/stores/suggestions`) are answered by the fixture. With `data=busy` the same page is a project using
the product (#6435): the first steps left, Needs Attention (what is wrong now, worst first, with who
owns each thing and whether anyone is told), the Data health strip and the Databases card. The suite
reads it at 1440px, beside the side menu at 1280, 1024 and 768, on a phone at 390, in German, and in
Persian dark; it opens the side menu's folded sections, and checks that a failed read offers Refresh.

Every other product is drawn on one page of the fixture's own, `/dashboard/:projectId/product-explanations`:
each entry of `Components/ProductOnboarding/ProductOnboardings`, in its order, as its How it works dialog draws it
(the product's name over its showcase, in a box as wide as the dialog's body). The suite reads every product's
name and pitch there, in English at 1280px and on a phone in German and in Persian dark, and fails on any box
that runs outside its explanation or any words that run past their box.

Run from `packages/E2E`:

```sh
npm run test-product-onboarding-ui
```

`Fixture/server.js` bundles the production layouts and pages with esbuild, serves them with the
same Tailwind build, `tailwind.config`, reading-direction config, `Theme.css` and Inter font
production uses, and listens on `127.0.0.1:4489` (`PRODUCT_ONBOARDING_FIXTURE_PORT`). No Docker, no
database, no sign-in. Only the `ModelAPI` / `API` data boundary and the signed-in user's
permissions are replaced. The locale files are the Dashboard's real `de.json` and `fa.json`. Every
record is fabricated for an "Acme Shop" project, and the fixture header says so ("Preview project ·
Synthetic data").

## Scenarios

Picked with query parameters on a list's address:

- `monitors=1`: the project has a monitor ("Storefront"); without it, a new project's Monitors.
- `statusPages=1`: the project has a status page ("Acme Status").
- `role=viewer`: a project Viewer, who reads every list and may create nothing.
- `counts=fail`: every count fails, as an API outage would.
- `data=busy`: Data Observability in use. Three databases (one that could not be read, one with no
  alert on), and twenty-three things that need someone, the eight most urgent listed: a failed and a
  late pipeline run, a failing check, a drifted reconciliation, a late data product, late tables and
  a check that could not run, owned or not, alerted or not. Four of its five first steps are done.
- `data=healthy`: every first step done and nothing wrong.
- `data=connected`: one database connected a minute ago, its catalog not read yet: no table counted,
  nothing wrong, one of the five first steps done.
- `data=fail`: the Overview's read fails every time, as an outage would.
- `lang=de|fa`: the Dashboard's German or Persian words (Persian reads right to left).
- `theme=dark`.

Every count is recorded on `window.__productOnboardingFixture` (`counts`: the table and the query
as sent), every create (`creates`), every read of Data Observability's own routes (`dataReads`), with
`unhandled` for anything the fixture does not model; the
spec fails on an unhandled request, on an uncaught page error and on any request that leaves the
fixture server.

Pages the lists lead to (Create Monitor, a new status page, the pages Data Observability's Overview
links to) are stubs that show their path, so a test can check where a button leads. Screenshots are written to
`output/playwright/product-onboarding-ui/`. A screenshot of every product's explanation, at each of
the three widths and languages, is taken only when asked, into its `explanations/` folder:

```sh
PRODUCT_ONBOARDING_EXPLANATION_SHOTS=1 CI=1 npm run test-product-onboarding-ui -- -g "every product"
```
