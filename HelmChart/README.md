# Helm Chart for OneUptime

[Read Docs here](Public/oneuptime/README.md)

## Tests

Everything runs on every PR, in the `helm-test` job of the "Common Jobs"
workflow. One command runs the same set locally:

```
npm run test-helm-chart-all
```

That is [`Tests/run.sh`](Tests/run.sh), which walks the suites in
[`Tests/suites`](Tests/suites) cheapest-first, installs whatever tooling is
missing (helm, helm-unittest, kubectl, kind), and gives the cluster-backed
suites one shared KinD cluster that it deletes at the end. A failing suite does
not stop the others, so one run tells you everything that is broken.

When helm-unittest is missing, the harness installs it without
`helm plugin install`, whose install hook downloads the plugin from GitHub's
release CDN with no retry (that remains the fallback on a platform with no
pin). It takes the release tarball whose sha256 is pinned in
[`Tests/lib/harness.sh`](Tests/lib/harness.sh), keeps it in
`${XDG_CACHE_HOME:-~/.cache}/oneuptime/helm-unittest` (or
`HELM_UNITTEST_CACHE_DIR`), and unpacks it into helm's plugin directory, so
only the first run downloads anything; CI keeps that directory in the Actions
cache. To bump `HELM_UNITTEST_VERSION`, add the new version's digests to
`harness_unittest_sha256` in the same change — the helm-test job fails until
you do, and so does the unit suite anywhere it has to install the plugin.

| Suite               | Needs a cluster | What it covers                                                                       |
| ------------------- | --------------- | ------------------------------------------------------------------------------------ |
| `lint`              | no              | `helm lint` over the `oneuptime` and `kubernetes-agent` charts                        |
| `unit`              | no              | the helm-unittest suites in [`Public/oneuptime/tests`](Public/oneuptime/tests)        |
| `extra-values`      | no              | `extraEnv`/`extraVolumes`/`extraVolumeMounts` reach every workload the chart renders, and no more |
| `vapid-existing-secret` | no          | with `vapid.existingSecret`, every workload given the VAPID private key reads it from that Secret and none as a plain value; without it the render does not change |
| `air-gapped`        | no              | the air-gapped install the website shows ([`Tests/air-gapped-values.yaml`](Tests/air-gapped-values.yaml)): every image from the customer's registry, the pull secret on every pod the chart defines, the update check and the daily check-in off, no public nameserver for a probe, and probes and webhooks allowed to reach private addresses; without `imagePullSecrets` the chart writes none |
| `marketplace`       | no              | the AWS, Microsoft and Google Cloud Marketplace editions [`Marketplace/build.py`](Marketplace/build.py) makes of the chart, and the Kubernetes agent's Amazon EKS add-on: its unit tests, then each edition rendered and checked the way that marketplace checks it at submission |
| `secrets-lifecycle` | yes             | installs and upgrades the chart for real, to cover Secret handling across an upgrade  |
| `keda-bootstrap`    | yes             | the KEDA CRD bootstrap and the `keda.install` / `keda.enabled` split, against a real API server |
| `gitops-revert`     | yes (opt-in)    | Argo CD, Flux and Helm against the kubectl fixes OneUptime AI makes: which fixes each one puts back to what git (or the chart) declares, and how fast, and the ownership markers OneUptime reads to tell (`packages/Common/Utils/AiRemediation/GitOpsOwnership.ts`) |

Run one suite, or keep the cluster around to poke at a failure:

```
bash HelmChart/Tests/run.sh lint unit
KEEP_CLUSTER=true bash HelmChart/Tests/run.sh secrets-lifecycle
```

`npm run test-helm-chart` still runs just the helm-unittest suites — they need
no cluster and no Docker, so they are the quick loop while editing templates.
The cluster-backed suites exist because those unit tests render without an API
server. `secrets-lifecycle` needs one because `lookup` always comes back empty
without it, so only the "regenerate" leg of `templates/secrets.yaml` is
exercised; the behaviour that file is there for — an upgrade must *not* rotate a
secret it already generated — can only be asserted against a real cluster.
`keda-bootstrap` needs one because Helm resolves a rendered manifest against the
API server before applying it, and `helm template` uses a fake client that never
does: the chart's first install with KEDA autoscaling was impossible for months
while lint, unit tests and `helm template` all stayed green. Neither suite waits
on a pod, so no images are pulled.

Adding a suite: drop it in `Tests/suites`, source `lib/harness.sh` for the
assertions and the cluster, end with `harness_report`, and list it in
`ALL_SUITES` in `run.sh` (the runner fails if a suite file is not listed, so it
cannot go unnoticed).

A suite that measures other tools rather than this repository's charts, and
pulls their images and waits out their timers to do it, goes in
`OPT_IN_SUITES` instead: it is never run by default, so not in the helm-test
job, only when named (`bash HelmChart/Tests/run.sh gitops-revert`).
`gitops-revert` takes about ten minutes; its own workflow
(`.github/workflows/test.gitops-revert.yaml`) runs it when it, or what it runs
on, changes. It reads results off a KinD cluster it changes freely, so it
points kubectl at a kubeconfig of its own for that cluster - never the one
your shell uses.

Not part of the `helm-test` job: `Tests/index.sh`, the full end-to-end install
that pulls every image and waits for all pods to become ready.

## Marketplace editions

Self-hosted OneUptime Enterprise is also sold on AWS Marketplace (Amazon EKS),
Microsoft Marketplace (AKS) and Google Cloud Marketplace (GKE), billed per user
by the hour through the marketplace. Each edition is built from this chart by
[`Marketplace/build.py`](Marketplace/build.py) at release time; see
[Marketplace/README.md](Marketplace/README.md) and the release runbook,
[SELF_HOSTED_RELEASING.md](../packages/Common/Server/Utils/Marketplace/SELF_HOSTED_RELEASING.md).

The Kubernetes agent (`Public/kubernetes-agent`) is on AWS Marketplace too, free,
as an Amazon EKS add-on: `build.py --marketplace aws-eks-addon` builds it from
the agent chart, and the same runbook says how it is released.

## Database migration guides

Moving an existing install from a standalone database to its bundled operator:

- [PostgreSQL: Standalone → CloudNativePG operator](Docs/MigratePostgresStandaloneToOperator.md)
- [ClickHouse: Standalone → Altinity operator](Docs/MigrateClickhouseStandaloneToOperator.md)

## Scaling guides

Autoscaling the queue-driven tiers:

- [KEDA: the two flags, the CRD bootstrap, and an externally managed KEDA](Docs/Keda.md)

Scaling an operator-managed (Altinity) ClickHouse:

- [ClickHouse: Adding shards (horizontal scale)](Docs/IncreaseClickhouseShards.md)
- [ClickHouse: Adding replicas (HA)](Docs/IncreaseClickhouseReplicas.md)

## Local models

- [vLLM: run local models in-cluster for OneUptime AI features](Docs/Vllm.md)
