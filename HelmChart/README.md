# Helm Chart for OneUptime

[Read Docs here](Public/oneuptime/README.md)

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
