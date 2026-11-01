# Kubernetes pages fixture

An offline harness for a Kubernetes cluster's pages
(`packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/View`): the
cluster's Overview, its Pods, Deployments, StatefulSets, DaemonSets, Jobs,
CronJobs and Nodes lists, the pages of a
pod, a Deployment, a StatefulSet, a DaemonSet, a Job, a CronJob and a node
(`Components/Kubernetes/Part`, built on the shared `Components/ResourcePart`)
and Recommendations. It bundles the production cluster layout and side menu
with esbuild, replaces only the `ModelAPI` / `AnalyticsModelAPI` / `API` /
`Realtime` data boundary and the signed-in user, and serves them on
`127.0.0.1:4671` (`KUBERNETES_PAGES_FIXTURE_PORT` to change it). No Docker,
no database, no sign-in, no cluster. Every record is made up, for an "Acme
Retail" workspace.

```sh
cd packages/E2E
npm run test-kubernetes-pages-ui
```

The inventory rows are what ingest stores, and the two reads the pages
depend on - what needs attention in the cluster, and one part with its pods
and runs - are answered the way `KubernetesResourceService` answers them,
from the same rules (`Common/Types/Kubernetes/KubernetesHealth`). The busy
cluster holds what real clusters do and a page could get wrong: a `checkout`
Deployment in both `shop` and `payments` (shop's one replica short, a pod
crash-looping after an OOMKill; payments' healthy), a node that stopped
talking to the API server, one under disk pressure and one cordoned, a
StatefulSet pod that cannot be scheduled and the claim it waits for, a
DaemonSet ready on three of four nodes, a CronJob whose newest run failed, a
Deployment mid-rollout, an open alert about the crash-looping pod, an open
incident about the lost node, and one recommended monitor already on.

The suite reads the pages the way someone on call does:

- the Overview: what needs attention first, critical before what to look
  at, each with why in Kubernetes' own words (Unreachable, 2 of 3
  available, CrashLoopBackOff, Last restart: OOMKilled, Can't be scheduled,
  Last run failed), six rows and the rest one click away, each row one step
  from its part's page in its namespace; "1 Node Not Ready" in its count's
  form; a calm cluster saying nothing, a disconnected one not trusting its
  last snapshot, and a failed read said in Needs attention's own card, with
  Refresh asking again;
- a Deployment's page: its status, where it sits, its chips, what on it and
  its pods needs a look (the most urgent first), what is open on it, the
  Deployment alerts with "Turn on N alerts" opening Recommendations with
  exactly those selected (`?select=`), its facts in one Details card with
  no second rollout status, its Pods tab, a Deployment of the same name in
  another namespace kept apart, and a failed read said in its card, with
  Refresh;
- a pod's page: its workload, namespace and node (links), its containers'
  readiness, restarts and QoS, its phase a plain fact, its owner a real
  link, why it restarted (its Containers tab, red for a crash loop);
- a node's page: Unreachable, its open incident, the pod on it that is not
  ready with its namespace, no NotReady in its details, its Pods tab's
  Workload and Namespace columns, a cordoned node;
- a StatefulSet's, a DaemonSet's, a CronJob's and a Job's page (a run says
  whose run it is), with dates in words or as a time, never as ISO strings;
- the Deployments, StatefulSets, DaemonSets, Jobs, CronJobs and Pods lists'
  statuses, tones and per-namespace CPU;
- a phone (390 wide: nothing scrolls sideways), dark mode (`?theme=dark`),
  German (`?lang=de`) and Persian (`?lang=fa`, right to left, Persian
  digits).

The scenarios are query parameters: `?estate=busy|calm`,
`?collector=disconnected`, `?fail=attention|part`, `?lang=de|fa` and
`?theme=dark` (see the top of `Fixture/Fixture.js`).

`Fixture/Fixture.js` records every read on `window.__kubernetesPagesFixture`
(`listRequests`, `countRequests`, `itemRequests`, `aggregateRequests`,
`apiRequests`) and anything it does not model in `unhandled`, which the
suite keeps empty. No request may leave `127.0.0.1`. Screenshots are written
to `output/playwright/kubernetes-pages-ui/`.

`node KubernetesPages/Fixture/server.js --watch` rebuilds on every change,
for looking at the pages while working on them.
