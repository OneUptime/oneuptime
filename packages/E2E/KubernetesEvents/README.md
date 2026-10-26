# Kubernetes events fixture

An offline harness for everywhere a Kubernetes cluster's warning events show
(issue #5179): the cluster's **Events** page, the **Events** tab of a node, an
HPA, a Deployment and a namespace, and **Recent Warnings** on the cluster's
Overview - each inside the production cluster layout and side menu
(`packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/{Layout,Index,Events,NodeDetail,HPADetail,DeploymentDetail,NamespaceDetail}.tsx`,
drawn by `Components/Kubernetes/KubernetesEvents*`). It bundles the production
pages with esbuild, replaces only the `ModelAPI` / `AnalyticsModelAPI` / `API` /
`Realtime` data boundary, and serves them on `127.0.0.1:4517`
(`KUBERNETES_EVENTS_FIXTURE_PORT`). No Docker, no database, no sign-in.

```sh
cd packages/E2E
npm run test-kubernetes-events-ui
```

## Dataset

An "Acme Cloud" workspace with one AKS cluster, `aks-prod-westeurope`. Its
Events are the ones the parser, ingest and render tests read
(`packages/Common/Tests/Helpers/KubernetesEventRecords.ts`), stored the way
ingest stores them now - one log record per change the agent's watch saw (the
Event added, then updated with its count as it repeated), with the attributes
ingest stamps (`k8s.event.type`, `k8s.event.reason`, `k8s.namespace.name`,
`k8s.object.kind`, `k8s.object.name`, ...):

- the customer's: kernel-monitor's `OOMKilling` on two nodes (three Events),
  and the horizontal-pod-autoscaler's `FailedGetResourceMetric` and
  `FailedComputeMetricsReplicas` on `istiod` in `aks-istio-system` and `nginx`
  in `app-routing-system`;
- the `checkout` Deployment's pod in a crash loop (`BackOff` 14 times,
  `Unhealthy` 6 times), and a neighbour Deployment, `checkout-api`, whose pod's
  `BackOff` must never show on `checkout`'s page;
- Normal events about a node, an HPA, the Deployment, its ReplicaSet, its pods
  and pods in other namespaces;
- a `FailedMount` warning stored before ingest stamped what an Event says, so
  only its body tells (the page reads it by id);
- another cluster's warning, which must never show here.

The logs list answers the way `BaseAnalyticsAPI` does: filtered on the time
range, on the attributes asked for (an exact value, an `Includes`, a
`StartsWith` matched without regard to case) and on ids, newest first, up to
the limit and saying when there is more, with the body only when it is
selected. The Overview's metrics are generated: smooth series for two nodes and
four pods, sampled once a minute inside each read's window.

Any route not listed above renders a "Not modelled" stub
(`data-testid="stub-page"`).

## Scenarios

Query parameters on any page:

| Parameter  | Values                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `events`   | `issue` (default), `normal-only` (no warning anywhere), `none`                                                                                                                 |
| `busy`     | `1`: 1,500 more Normal events in the last minutes, more than one read takes - the warnings must still all show                                                                 |
| `fail`     | `events`: the first read of Events fails, the next works                                                                                                                       |
| `alerting` | `on`: a Logs monitor alerts on the cluster's warning events (the Warning Events recommendation's own); `disabled`: that monitor, turned off. By default nothing alerts on them |
| `lang`     | `de` reads the German locale file                                                                                                                                              |
| `theme`    | `dark` adds `html.dark` (server.js)                                                                                                                                            |

## What the fixture records

`window.__kubernetesEventsFixture` holds `scenario`, `dataset`, and every read:
`logRequests` (each Events read: its `attributes`, the `operators` they use,
`select`, `limit`, `ids` and `window`), `listRequests`, `itemRequests`,
`countRequests`, `aggregateRequests`, `updateRequests`, `apiRequests` and
`unhandled` - anything the fixture does not model. Every test fails on a page
error, on a request that leaves `127.0.0.1`, and on anything in `unhandled`.

Screenshots land in `output/playwright/kubernetes-events-ui/*-synthetic.png`.

To look at a page by hand, start the server and open a URL:

```sh
node KubernetesEvents/Fixture/server.js
# http://127.0.0.1:4517/dashboard/10000000-0000-4000-8000-000000000001/kubernetes/60000000-0000-4000-8000-000000000001/events
```
