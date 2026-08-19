### KEDA Ops

The chart can autoscale its queue-driven tiers with [KEDA](https://keda.sh) instead of a plain `HorizontalPodAutoscaler`, scaling on queue backlog and shed rate rather than on CPU. See "Autoscaling & availability" in [configuration.md](../Public/oneuptime/docs/configuration.md) for the per-tier knobs. This page covers the two flags that decide where KEDA comes from, and the first-install step a cluster with no KEDA needs. Commands below assume the release is named `oneuptime` and installed in the `default` namespace.

### The two flags

| Flag | Decides | Default |
| --- | --- | --- |
| `keda.enabled` | Whether the chart renders its own `ScaledObject`s and `TriggerAuthentication`s, and whether the tiers that use them drop their plain `HorizontalPodAutoscaler`. | `false` |
| `keda.install` | Whether the chart installs the bundled KEDA operator. | unset — tracks `keda.enabled` |

`keda.install` is the first path of the dependency `condition:` in `Chart.yaml`, and Helm takes the first path that holds a boolean. Leaving it out of your values means `keda.enabled` decides both, which is what the chart did before the flags were split, so an existing `keda.enabled: true` keeps behaving exactly as it always has.

Three combinations matter:

- **`keda.enabled: true`** — the chart installs the operator and drives it. Leave `keda.install` unset.
- **`keda.enabled: true`, `keda.install: false`** — your platform team already runs KEDA; the chart renders only the custom resources. See [Using an externally managed KEDA](#using-an-externally-managed-keda).
- **`keda.enabled: false`, `keda.install: true`** — the one-time bootstrap pass below.

Per-tier `<service>.keda.enabled` flags are what actually opt a tier into KEDA. Setting one while `keda.enabled` is false is a hard render error, not a silent no-op — except during the bootstrap pass, where rendering nothing is the point.

> **Bundled-operator caveats.** KEDA is cluster-scoped: the subchart installs 6 CRDs, 9 ClusterRoles, a validating webhook and an aggregated APIService that takes over `external.metrics.k8s.io` for the whole cluster, so a wedged metrics-apiserver degrades unrelated workloads. Do **not** enable the bundled operator in more than one OneUptime release in the same cluster, and do not enable it at all on a cluster that already runs KEDA — set `keda.install: false` there instead. Because the CRDs are installed by the chart, `helm uninstall` can remove them and cascade-delete every `ScaledObject` in the cluster.

#### First install with the bundled operator (CRDs must exist first)

The KEDA CRDs ship as **templates** in the bundled subchart, not in a `crds/` directory. Only a `crds/` directory is applied ahead of the rest of the release; templates are part of the ordinary manifest, which Helm resolves against the API server **before** applying anything. So on a cluster that does not yet have KEDA, the very first `helm install`/`helm upgrade` with `keda.enabled: true` and any `<service>.keda.enabled: true` aborts with:

```
Error: ... resource mapping not found for name: "oneuptime-worker-scaledobject" ...
no matches for kind "ScaledObject" in version "keda.sh/v1alpha1"
ensure CRDs are installed first
```

Nothing is applied (not even the CRDs), so re-running Helm alone does **not** help. `--disable-openapi-validation` does not fix it either (the failure is a resource-mapping check, not schema validation). Neither does `helm template`, which cannot reproduce the failure at all — it never contacts an API server, so it renders this manifest perfectly cleanly. Use `helm install --dry-run` against the real cluster if you want to see it before you hit it.

Run one bootstrap pass that installs the operator and its CRDs and renders no custom resources. They are cluster-scoped, so this is a one-time step per cluster:

```bash
# 1) Operator and CRDs only. Your normal values file, with the two flags flipped.
helm upgrade --install oneuptime oneuptime/oneuptime \
  --namespace default -f values.yaml \
  --set keda.install=true --set keda.enabled=false

# 2) Now the normal install/upgrade succeeds, and every one after it.
helm upgrade --install oneuptime oneuptime/oneuptime \
  --namespace default -f values.yaml
```

Step 1 brings the tiers up without KEDA, so they sit at their fixed `replicaCount` — or on a plain `HorizontalPodAutoscaler` if you have set `autoscaling.enabled: true`, which ships `false`. Step 2 hands them to KEDA. On a first install nothing is serving yet, so that interval costs nothing; on an existing release, read [Turning KEDA back off](#turning-keda-back-off) before you run step 1, because it is the same transition. Keep `keda.install` out of your values file afterwards — with it unset, `keda.enabled: true` keeps the operator installed on its own.

If you would rather not run the chart twice, install the CRDs yourself before the first Helm run and leave the chart to adopt them:

```bash
helm template oneuptime oneuptime/oneuptime --set keda.install=true \
  -s charts/keda/templates/crds/crd-scaledobjects.yaml \
  -s charts/keda/templates/crds/crd-triggerauthentications.yaml \
  -s charts/keda/templates/crds/crd-scaledjobs.yaml \
  -s charts/keda/templates/crds/crd-cloudeventsources.yaml \
  -s charts/keda/templates/crds/crd-clustercloudeventsources.yaml \
  -s charts/keda/templates/crds/crd-clustertriggerauthentications.yaml \
| kubectl apply --server-side -f -

# Hand them to Helm so the install can adopt them (keda.crds.install stays true).
for c in $(kubectl get crd -o name | grep '\.keda\.sh$' | sed 's#.*/##'); do
  kubectl label  crd "$c" app.kubernetes.io/managed-by=Helm --overwrite
  kubectl annotate crd "$c" \
    meta.helm.sh/release-name=oneuptime \
    meta.helm.sh/release-namespace=default --overwrite
done
```

The labelling step is only needed if you keep the default `keda.crds.install: true` (Helm then manages CRD upgrades for you). Alternatively set `keda.crds.install: false` so Helm never templates or owns the CRDs — then skip it, but you must apply CRD upgrades out of band yourself on every KEDA version bump.

### Using an externally managed KEDA

On a shared or regulated cluster, KEDA is usually installed once by a platform team from its own Helm release. Enabling the bundled operator on top of that collides on every cluster-scoped object it wants to own:

```
Error: ... ClusterRole "keda-operator" in namespace "" exists and cannot be imported
into the current release: invalid ownership metadata; annotation
"meta.helm.sh/release-name" must equal "oneuptime": current value is "keda"
```

Set `keda.install: false` and the chart renders only the custom resources, against CRDs it does not own:

```yaml
keda:
  enabled: true
  install: false

worker:
  enabled: true
  keda:
    enabled: true
```

This needs no bootstrap pass — the CRDs already exist, so the very first install resolves and applies in one go. The `ScaledObject`s the chart renders are plain custom resources with no dependency on anything the bundled subchart provides, so any KEDA that watches their namespace reconciles them. Check that the platform team's KEDA is not namespace-scoped to somewhere else:

```bash
kubectl -n <keda-namespace> get deploy keda-operator \
  -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="WATCH_NAMESPACE")].value}'
```

An empty value means it watches the whole cluster, which is what you want. A different namespace means your `ScaledObject`s will be created and then ignored — the tier will sit at `minReplicaCount` with no error anywhere.

#### Handing an already-bundled KEDA over to a platform-managed one

> **Do not simply flip `keda.install` to `false` on a release that installed the operator itself.** The 6 KEDA CRDs are templates of that release, so dropping the subchart drops them from the manifest and `helm upgrade` deletes them — and deleting a CRD cascade-deletes every custom resource of it in the cluster, including the `ScaledObject`s the same upgrade is rendering. Unlike the CloudNativePG CRDs, KEDA's carry no `helm.sh/resource-policy: keep`, so nothing stops this.

Annotate the CRDs first, and leave `keda.enabled` alone. Then the operator leaves and the `ScaledObject`s stay exactly where they are — no tier is reconfigured at any point:

```bash
# 1) Protect the CRDs from the upgrade below. Nothing is disrupted by this.
for c in $(kubectl get crd -o name | grep '\.keda\.sh$' | sed 's#.*/##'); do
  kubectl annotate crd "$c" helm.sh/resource-policy=keep --overwrite
done

# 2) Drop the bundled operator, keeping keda.enabled: true. The CRDs survive on
#    step 1's annotation and the ScaledObjects keep rendering, so the Deployments
#    are not touched and the HPAs KEDA created stay in place.
helm upgrade oneuptime oneuptime/oneuptime --namespace default -f values.yaml \
  --set keda.install=false
```

Have the platform team install their KEDA now, then add `keda.install: false` to your values file permanently so you stop passing `--set`. Their release will need to take ownership of the CRDs — `helm install --take-ownership` (Helm 3.17+), or re-point the `meta.helm.sh/release-name` and `-namespace` annotations at their release the way the bootstrap section above does.

Between step 2 and their KEDA coming up, nothing reconciles the `ScaledObject`s. Replica counts simply hold where they are, so the gap is safe to leave open for as long as it takes — but the tiers are not scaling during it.

Do **not** route this through `keda.enabled: false`. That deletes the `ScaledObject`s, and with them the replica counts KEDA was holding (see below), and the render is refused anyway while any `<service>.keda.enabled` is still true.

### Check what is actually scaling

```bash
kubectl get scaledobjects --namespace default
kubectl describe scaledobject --namespace default oneuptime-worker-scaledobject
```

`READY=True` is the one to look at: it means KEDA resolved the target Deployment and can read the trigger. `ACTIVE` is not a health signal — it reports whether the trigger currently sees work, so a healthy tier with an empty queue sits at `READY=True`, `ACTIVE=False`. KEDA creates its own HPA per `ScaledObject`, named `keda-hpa-<scaledobject>`:

```bash
kubectl get hpa --namespace default
```

If `READY` is `False`, the usual cause is that KEDA cannot reach the tier's metrics endpoint. The triggers are plain HTTP against the in-cluster service, so curl the same URL from any pod:

```bash
kubectl run -n default curl-test --rm -it --image=curlimages/curl --restart=Never -- \
  curl -s http://oneuptime-worker:3002/metrics/queue-size
```

Set `<service>.keda.fallback.replicas` so a tier holds a sane replica count when that endpoint is unreadable, rather than collapsing to `minReplicaCount`.

### Turning KEDA back off

Set `keda.enabled: false` and every per-service `<service>.keda.enabled: false` in the same `helm upgrade`. Leaving a per-service flag on is refused rather than silently applied — with the global flag off it would render no `ScaledObject` at all, and it would uninstall the operator out from under the ones already running.

> **This is a scale-down, not a hand-off to another autoscaler.** While KEDA drives a tier, the chart omits `replicas` from its Deployment and lets the `ScaledObject` hold the count. Turning KEDA off puts `replicas: <replicaCount>` back — default `1` — and creates no `HorizontalPodAutoscaler` at all, because `autoscaling.enabled` ships `false`. A worker fleet KEDA had taken to 6 pods drops to 1 on that upgrade, with nothing to scale it back out.
>
> Set `autoscaling.enabled: true` (with `resources.requests.cpu` on the tiers, and `minReplicas` at least where KEDA had them) in the **same** upgrade if you want the tiers to keep autoscaling on CPU/memory. Even then the Deployment carries `replicas: 1` for the moment it takes the new HPA to observe the tier and scale it back up.

To scale one tier manually while you work on it, use `<service>.disableAutoscaler: true` rather than `kubectl scale` — KEDA's `minReplicaCount` would revert a manual scale. It applies to `app`, `worker`, `runner` and each probe; `telemetryWriter` is opt-in only and the schema has no such key for it, so turn `telemetryWriter.keda.enabled` off instead.
