# OpenShift pages fixture

An offline harness for OpenShift in the Kubernetes product (issue #5477): the
**Routes**, **Services** and **DeploymentConfigs** lists and detail pages, what
the cluster's side menu and Overview add for them, the Overview's OpenShift card,
and a pod's link back to its DeploymentConfig - each inside the production cluster layout and side menu
(`packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/*`). It bundles
the production pages with esbuild, replaces only the `ModelAPI` /
`AnalyticsModelAPI` / `API` / `Realtime` data boundary, and serves them on
`127.0.0.1:4611` (`OPENSHIFT_PAGES_FIXTURE_PORT`). No Docker, no database, no
sign-in.

```sh
cd packages/E2E
npm run test-openshift-pages-ui
```

## Dataset

An "Acme Cloud" workspace with one OpenShift cluster, `ocp-prod-eu`. Its rows
are what ingest stores: each goes through the production state functions
(`getOpenShiftInventoryState`), with the parsers' spec and status. It holds what
a list view could get wrong:

- a Route and a Service named `frontend` in both `shop` and `payments`, which
  must never be mixed up;
- a canary Route splitting traffic 90/10 between two Services;
- a Route a router rejected (`HostAlreadyClaimed`), and one no router has
  answered;
- DeploymentConfigs available, mid-rollout and scaled to zero;
- `legacy-web` and a neighbour, `legacy-web-api`, whose name starts the same and
  whose pod's warning must never show on `legacy-web`'s page;
- a pod of `legacy-web`, owned by the ReplicationController of rollout 7;
- a dozen ClusterOperators and the ClusterVersion, for the Overview's OpenShift
  card, which `health` below turns unhealthy.

Any route not listed above renders a "Not modelled" stub
(`data-testid="stub-page"`).

## Scenarios

Query parameters on any page:

| Parameter | Values                                                                                       |
| --------- | -------------------------------------------------------------------------------------------- |
| `cluster` | `openshift` (default), `plain`: an EKS cluster, with none of OpenShift's objects             |
| `health`  | `healthy` (default), `degraded`, `down` (an operator not Available), `updating`, `failing`    |
| `lang`    | `de` reads the German locale file                                                            |
| `theme`   | `dark` adds `html.dark`                                                                      |

Every read is recorded on `window.__openShiftPagesFixture`. The spec asserts its
`unhandled` list is empty, so a page cannot quietly start asking for something
the fixture does not answer the way the server does.

Screenshots land in `output/playwright/openshift-pages-ui`.
