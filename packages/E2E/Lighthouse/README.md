# Lighthouse

Lighthouse's accessibility, best practices and SEO audits on the marketing
site (`packages/Home`), the docs and the API reference
(`packages/App/FeatureSet/Docs` and `APIReference`), on a phone and on a
laptop, for every pull request: the `lighthouse` job of the Tests workflow
(`.github/workflows/test.yaml`).

Performance is not scanned. Its numbers move with the speed of the machine,
and a shared CI runner's speed varies too much from one run to the next for
a threshold to mean anything. Those numbers belong to scans of oneuptime.com
and to real users' Web Vitals.

## What fails the check

`Baseline.json` records, for each page and form factor, the audits that count
toward a category's score and failed when it was recorded. A test fails when:

- an audit fails that the baseline does not list: something the pull request
  changed broke it. The failure names the elements or requests it fails on,
  and the page's report says more.
- an audit the baseline lists passes now: take it out of the baseline (or
  record it again), so the baseline only ever gets shorter.
- Lighthouse could not load the page, or could not run one of the audits.
- `Baseline.json` was recorded with another version of Lighthouse.

## The pages

`Pages.ts` lists one page for each template, since pages drawn from one
template score alike: the home page, pricing, product, solution, comparison
and integration pages, the demo form, a legal page, the blog and a post, a
docs page, one with code and a diagram, one in Persian (right to left) and
one in Chinese, and the API reference and one of its models. A new template
earns a page there, and the page its results in the baseline.

The blog's posts are the ones in `Blog/`, not the real blog's: that is a
4 GB repository of its own, and its posts change every day.

## How the pages are served

Both services run from this checkout, as their images run them but with no
datastore:

- the site with `packages/Home/Scripts/CheckoutPaths.ts` preloaded, which
  points its views, static files and blog at the checkout instead of the
  image's paths;
- the docs and the reference with `packages/App/scripts/serve-docs-and-reference.ts`,
  which mounts only those two feature sets, and `checkout-paths.ts` preloaded
  for the same reason.

`Proxy.js` puts them behind one address and routes paths as Nginx does on
oneuptime.com, so a docs page loads its favicons and manifest from the site,
as it does there.

## Running it

From the repository's root, once:

```bash
(cd packages/Common && npm install)
(cd packages/Home && npm install && npm run build:css)
(cd packages/App && npm install && npm run build-docs-css)
node packages/Common/Scripts/build-mermaid-browser.js
(cd packages/E2E && npm install --ignore-scripts && npx playwright install chromium)
```

Then:

```bash
cd packages/E2E && npm run test-lighthouse
```

Each page's report is written to `output/playwright/lighthouse/reports`,
with `summary.md`, a table of every page's scores. In CI they are the run's
`lighthouse` artifact, and the table is on the run's summary page.

## Recording the baseline

After fixing an audit, after adding a page, or after upgrading Lighthouse.

Every run writes the baseline it would record to its reports folder, beside
the reports (`Baseline.json` there). A CI run's copy is recorded in the
Playwright image CI scans in, so the simplest way to accept a run's results
is to download its `lighthouse` artifact and copy that file over this
folder's. An audit's results can depend on the layout, and the layout on the
fonts and the browser's build: a laptop's results may differ from CI's.

To record on your own machine:

```bash
cd packages/E2E && LIGHTHOUSE_RECORD=1 npm run test-lighthouse
```

To record some pages only, pass Playwright a `--grep` of their paths:

```bash
cd packages/E2E && LIGHTHOUSE_RECORD=1 npx playwright test --config playwright.lighthouse.config.ts --grep "/pricing"
```

Recording a failure the baseline did not have accepts it: fix the page
instead, unless the audit is wrong about it.

## The nightly scan of oneuptime.com

The pull request check judges what this repository serves. How fast the live
site loads for a visitor is a different question, with the real CDN, network,
web fonts and Google Tag Manager in it, so it has a scan of its own: the
"Lighthouse Production Scan" workflow
(`.github/workflows/lighthouse-production.yml`), every night and by hand.

- **Pages:** home, pricing, a docs page, the API reference, sign-in, sign-up
  and OneUptime's own status page (`ProductionPages` in `Production.ts`), on a
  phone and on a laptop.
- **Categories:** all four, performance among them, with every third party
  the page loads. Each page is scanned three times and the median run by
  performance score is reported.
- **Tracking only:** no score fails the run. A page fails it only when no run
  of it could be scanned.
- **Results:** a table on the run's summary page (performance, LCP, CLS, TBT
  and the other three scores) and every report in its `lighthouse-production`
  artifact.

To send the numbers to a OneUptime project as OpenTelemetry metrics
(`lighthouse.performance.score`, `lighthouse.largest_contentful_paint` and
the rest, a point per page and form factor), so a dashboard can chart them
and a monitor can alert on the trend:

1. In the OneUptime project, create a telemetry ingestion key.
2. Add it to this repository's Actions secrets as
   `ONEUPTIME_LIGHTHOUSE_OTLP_TOKEN`.
3. To send to an installation other than oneuptime.com, set the Actions
   variable `ONEUPTIME_LIGHTHOUSE_OTLP_ENDPOINT` to its `/otlp` address.

Without the secret the scan still runs and says it sent nothing. A failed
send is a warning on the run, not a failure.

To run it from your machine (it scans the live site):

```bash
cd packages/E2E && npm run test-lighthouse-production
```

`--grep "pricing"` scans one page, and `LIGHTHOUSE_ORIGIN` scans another
installation's pages instead of oneuptime.com's.
