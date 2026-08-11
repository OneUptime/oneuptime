# Helm Chart for OneUptime

[Read Docs here](Public/oneuptime/README.md)

## Tests

Chart unit tests live in [`Public/oneuptime/tests`](Public/oneuptime/tests) and
run on every PR. They render the templates with `helm template` under the hood
and assert on the result, so they need no cluster:

```
helm plugin install https://github.com/helm-unittest/helm-unittest
npm run test-helm-chart
```

Two suites need a real API server and live in `HelmChart/Tests` instead:

- `secrets-lifecycle.sh` — installs and upgrades the chart on a throwaway KinD
  cluster to cover the `lookup` recovery path in `templates/secrets.yaml`
  (an upgrade must not rotate a secret it already generated), which renders
  empty and so cannot be asserted on without a cluster. It pulls no images and
  also runs on every PR.
- `index.sh` — the full end-to-end job: installs the chart for real and waits
  for every pod to become ready.

## Database migration guides

Moving an existing install from a standalone database to its bundled operator:

- [PostgreSQL: Standalone → CloudNativePG operator](Docs/MigratePostgresStandaloneToOperator.md)
- [ClickHouse: Standalone → Altinity operator](Docs/MigrateClickhouseStandaloneToOperator.md)

## Scaling guides

Scaling an operator-managed (Altinity) ClickHouse:

- [ClickHouse: Adding shards (horizontal scale)](Docs/IncreaseClickhouseShards.md)
- [ClickHouse: Adding replicas (HA)](Docs/IncreaseClickhouseReplicas.md)

## Local models

- [vLLM: run local models in-cluster for OneUptime AI features](Docs/Vllm.md)
