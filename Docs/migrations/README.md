# Database migrations

How to change OneUptime's databases. Postgres holds the product's records, and its schema migrations are generated from the models. ClickHouse holds telemetry, and its migrations are written by hand. Read this before you change a model in `packages/Common/Models/DatabaseModels` or `packages/Common/Models/AnalyticsModels`, or write a migration.

## Postgres schema migrations

A change to a Postgres model needs a schema migration in [`packages/Common/Server/Infrastructure/Postgres/SchemaMigrations`](../../packages/Common/Server/Infrastructure/Postgres/SchemaMigrations). Registered migrations run when the app starts.

1. **Generate it; never write it by hand.** From the repository root, with the local database running:

   ```bash
   npm run generate-postgres-migration
   ```

   TypeORM compares the models with the local database and writes a `<number>-MigrationName.ts` with what it takes to make them match.

2. **Name and number it.** Rename the file and the class to say what the migration does, numbered after the last migration in `Index.ts`: `1809110968240-AddServerSetupChoices.ts`, holding `AddServerSetupChoices1809110968240`.

3. **Register it.** Import the class at the top of [`SchemaMigrations/Index.ts`](../../packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts) and append it to the default export array. A migration that is not registered never runs.

4. **Check for drift.**

   ```bash
   npm run check-postgres-schema-drift
   ```

   It applies every registered migration to the database, then generates a migration from the result. Anything it can still generate is drift - a model change with no migration, or a migration that is not registered - and it prints the missing statements. It reads `config.env`, so locally it needs no arguments. CI's "Postgres Schema Drift" workflow runs the same check against an empty database and fails on any drift.

### Indexes and foreign keys on existing tables

A migration holds every lock it takes until it commits, and what the generator writes for a table that already holds data blocks that table's writers for as long as the statement scans it:

- `CREATE INDEX ...` holds SHARE on the table for the whole build.
- `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ...` holds SHARE ROW EXCLUSIVE on both tables while it checks every row.

On a table like "Monitor", which every probe result, heartbeat and cron tick writes, that is an outage. Move those statements into a migration of their own with `public transaction: boolean = false;`, and pass each one, exactly as generated, to [`OnlineDdl`](../../packages/Common/Server/Infrastructure/Postgres/OnlineDdl.ts):

```ts
await OnlineDdl.createIndex(queryRunner, `CREATE INDEX "IDX_..." ON "Monitor" (...)`);
await OnlineDdl.addForeignKey(
  queryRunner,
  `ALTER TABLE "Monitor" ADD CONSTRAINT "FK_..." FOREIGN KEY (...) REFERENCES "User"(...)`,
);
```

`createIndex` builds the index `CONCURRENTLY`, and `addForeignKey` adds the key `NOT VALID` and validates it separately. Neither blocks reads or writes, and the names and definitions stay the generated ones, so the drift check still matches. A table created in the same migration is empty and needs none of this. [`SchemaMigrationsOnlineDdl`](../../packages/Common/Tests/Server/Infrastructure/Postgres/SchemaMigrationsOnlineDdl.test.ts) fails a new migration that skips it.

An index dropped from an existing table goes the same way: ``OnlineDdl.dropIndex(queryRunner, `DROP INDEX "public"."IDX_..."`)`` drops it `CONCURRENTLY`, so the table's readers and writers don't queue behind it. TypeORM reverts a migration inside a transaction whatever its `transaction` says, and no index can be built online there, so a `down()` that builds the index again keeps the generated `CREATE INDEX`. Check its columns: for an index of several, the generator writes them in the table's column order, not the index's ([`1809151100000-DropNetworkDeviceLastSeenAtAndProjectIdIndexes`](../../packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/1809151100000-DropNetworkDeviceLastSeenAtAndProjectIdIndexes.ts) puts them back in order).

### Storage parameters

TypeORM doesn't model a table's storage parameters (`fillfactor`, the `autovacuum_*` settings), so a migration that sets them is written by hand, and the drift check can't catch a change to it: pin its statements in a test. `ALTER TABLE ... SET (...)` of these takes SHARE UPDATE EXCLUSIVE, which no read or write waits for, and rewrites nothing, so it runs in an ordinary migration ([`1809151200000-SetMonitorProbeAndNetworkDeviceFillfactor`](../../packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/1809151200000-SetMonitorProbeAndNetworkDeviceFillfactor.ts)).

### Tests

Migration tests live in [`packages/Common/Tests/Server/Infrastructure/Postgres`](../../packages/Common/Tests/Server/Infrastructure/Postgres). A `<Name>Migration.test.ts` checks a migration's statements against the model and its place in `Index.ts`. A `<Name>Postgres.test.ts` runs it against a real Postgres; its header names the environment variable that opts in.

## ClickHouse and data migrations

Hand-written migrations live in [`packages/App/FeatureSet/Workers/DataMigrations`](../../packages/App/FeatureSet/Workers/DataMigrations): ClickHouse schema and data changes, and Postgres data changes such as backfills. Each is a class that extends `DataMigrationBase` with `migrate()` and `rollback()`, registered by adding an instance to that folder's `Index.ts`, in the order it must run. Each runs once and is recorded. The runner stops at the first migration that fails, so a broken one holds back every migration after it.

- **Most ClickHouse model changes need no migration.** On every boot, [`TableManegement.ts`](../../packages/App/FeatureSet/Workers/Utils/AnalyticsDatabase/TableManegement.ts) creates new tables and materialized views from the models, and adds missing columns, skip indexes and projections to existing tables. Write a migration for what it cannot do: change a column's type, change a sort or partition key (which means dropping and recreating the table), backfill data, or build an index over the parts already on disk.
- **Safe to run twice at once.** Under Docker Compose, and with the Helm chart's `migrate.enabled: false`, several processes run migrations on boot with no lock between them, so two can run the same migration at the same time.
- **Check before you change.** Use `ClickHouseMigrationUtil` to look up what exists, so a migration does nothing on an install whose tables never existed. A migration of single-node DDL returns `false` from `runsInClusterMode()`; a cluster-aware one names its tables with `getStorageTableName` and `onClusterClause` (`Common/Server/Utils/AnalyticsDatabase/ClusterConfig`).
- **Don't hold up the upgrade.** Queue a long ClickHouse mutation to run in the background instead of waiting for it, as `MaterializeAttributeValuesIndex.ts` does.

Their tests live in [`packages/App/Tests/Workers/DataMigrations`](../../packages/App/Tests/Workers/DataMigrations); a `<Name>Clickhouse.test.ts` runs a migration against a real ClickHouse.
