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

| Suite               | Needs a cluster | What it covers                                                                       |
| ------------------- | --------------- | ------------------------------------------------------------------------------------ |
| `lint`              | no              | `helm lint` over the `oneuptime` and `kubernetes-agent` charts                        |
| `unit`              | no              | the helm-unittest suites in [`Public/oneuptime/tests`](Public/oneuptime/tests)        |
| `secrets-lifecycle` | yes             | installs and upgrades the chart for real, to cover Secret handling across an upgrade  |
| `keda-bootstrap`    | yes             | the KEDA CRD bootstrap and the `keda.install` / `keda.enabled` split, against a real API server |

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

Not part of the `helm-test` job: `Tests/index.sh`, the full end-to-end install
that pulls every image and waits for all pods to become ready.

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
