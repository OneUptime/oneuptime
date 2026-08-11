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

`HelmChart/Tests/index.sh` is the separate end-to-end job: it spins up a KinD
cluster, installs the chart for real and waits for every pod to become ready.

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
