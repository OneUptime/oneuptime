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

An index dropped from an existing table goes the same way: ``OnlineDdl.dropIndex(queryRunner, `DROP INDEX "public"."IDX_..."`)`` drops it `CONCURRENTLY`, so the table's readers and writers don't queue behind it. A plain `DROP INDEX`, which the generator writes when an `@Index` comes off a model, takes ACCESS EXCLUSIVE on the table: no reads or writes while it waits for the lock, and none until the migration commits. `SchemaMigrationsOnlineDdl` fails a new migration whose `up()` has one, unless the same migration locks that table anyway: the generator drops an index before the `ALTER TABLE` that drops or changes its column, which takes the same lock in the same transaction. It reads the table from the `CREATE INDEX` of that name, in the migration's own `down()` or in an earlier migration. It also fails a new migration that hands a statement to `OnlineDdl`, or runs one `CONCURRENTLY`, in an `up()` without `transaction = false`: in a transaction, `dropIndex` falls back to a plain `DROP INDEX`. TypeORM reverts a migration inside a transaction whatever its `transaction` says, and no index can be built online there, so a `down()` that builds the index again keeps the generated `CREATE INDEX`. Check its columns: for an index of several, the generator writes them in the table's column order, not the index's ([`1809151100000-DropNetworkDeviceLastSeenAtAndProjectIdIndexes`](../../packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/1809151100000-DropNetworkDeviceLastSeenAtAndProjectIdIndexes.ts) puts them back in order).

### Dropping a table

A table that goes takes its foreign keys with it, and a key's triggers live on the table it references too. So `DROP TABLE` takes ACCESS EXCLUSIVE on every table its keys point at, `"User"` and `"Project"` included, until its migration commits. Drop such tables in an ordinary migration, all of them in one statement (`DROP TABLE IF EXISTS "A", "B"`), with nothing else in it: SchemaMigrationRunner bounds the wait for those locks and tries again in the gaps, and the migration holds them only for the instant the drop takes. The generator writes no drop for an entity that is gone, so write it by hand, with a `down()` that makes the tables again as the last migrations left them, and remove the models, so the drift check finds nothing to make again. A data migration that still reads the tables runs after it: make it work without them, or show it has nothing left to do. [`1809182470000-DropGreenlockTables`](../../packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/1809182470000-DropGreenlockTables.ts) does all of this, and its Postgres test shows the bounded wait behind a reader of `"User"`.

### Storage parameters

TypeORM doesn't model a table's storage parameters (`fillfactor`, the `autovacuum_*` settings), so a migration that sets them is written by hand, and the drift check can't catch a change to it: pin its statements in a test. `ALTER TABLE ... SET (...)` of these takes SHARE UPDATE EXCLUSIVE, which no read or write waits for, and rewrites nothing, so it runs in an ordinary migration ([`1809151200000-SetMonitorProbeAndNetworkDeviceFillfactor`](../../packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/1809151200000-SetMonitorProbeAndNetworkDeviceFillfactor.ts)).

A `fillfactor` below 100 helps only updates that change no indexed column, and only as far as the page has room for the new row versions while the statement runs: the rows a statement replaces aren't dead until it commits. So one statement that rewrites every row on a page needs half the page free, and most of its rows leave the page anyway. Spread such writes over several statements instead, as the interface refresh does ([`1809164000000-SetNetworkInterfaceFillfactor`](../../packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/1809164000000-SetNetworkInterfaceFillfactor.ts)), and measure: read `n_tup_hot_upd` from `pg_stat_user_tables` after `pg_stat_force_next_flush()`, on a one-connection DataSource ([`NetworkInterfaceWritesPostgres`](../../packages/Common/Tests/Server/Services/NetworkInterfaceWritesPostgres.test.ts)).

A timestamp that is rewritten all the time, such as a "last seen" a poll refreshes, keeps every update of its row from being HOT for as long as any index names it, in its columns, an expression or its predicate. When a read needs an index by it, index a coarse copy that moves far less often instead, and check the exact column on the row: `NetworkEndpoint.coarseLastSeenAt` follows `lastSeenAt` a day at a time, and the age-out narrows by it ([`1809173100000-SwapNetworkEndpointLastSeenIndexes`](../../packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/1809173100000-SwapNetworkEndpointLastSeenIndexes.ts), [`NetworkEndpointWritesPostgres`](../../packages/Common/Tests/Server/Services/NetworkEndpointWritesPostgres.test.ts)).

### Migrations that change permission rows

A migration that deletes, changes or inserts rows of the tables a member's or an API key's permissions are read from (`TeamMember`, `TeamPermission`, `ApiKeyPermission`, `CustomRolePermission` and their label join tables) writes Postgres directly, so it rebuilds nobody's cached permissions. Each member's permission set in a project is kept in Redis for up to 30 days and served from there, so without the step below a member keeps a permission the migration took away until something else rebuilds their set.

1. **Add its class name to the end of [`PERMISSION_ROW_MIGRATIONS`](../../packages/Common/Server/Infrastructure/Postgres/PermissionRowMigrations.ts).** Every member's set is cached with the number of the newest migration listed there, and a set cached with an older number is read as missing, deleted and rebuilt from the rows as they are. So every server reads each member's set again once, the first time it is asked for it, with no step after the migrations and nothing done in Redis. [`PermissionRowMigrationsGuard`](../../packages/Common/Tests/Server/Infrastructure/Postgres/PermissionRowMigrationsGuard.test.ts) fails until the migration is listed. API keys need nothing: each process keeps a key's rows for a minute at most.
2. **Retiring a permission** (it stops being offered: `isAssignableToTenant: false` in `Types/Permission.ts`) takes its rows away in a schema migration, so the servers of the release that stops offering it start only once the rows are gone (`SchemaMigrationWait`). Copy [`1809178600000-RemovePermissionsThatGrantNothing`](../../packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/1809178600000-RemovePermissionsThatGrantNothing.ts): it counts `CustomRole.permissionCount` again for the roles that hold one, then deletes the rows from `TeamPermission`, `ApiKeyPermission` and `CustomRolePermission`, with the permissions written out in the migration. Copy its `...Migration` and opt-in `...Postgres` tests too, wire the Postgres one into the Postgres Schema Drift workflow, and add the permissions to the migrations [`TenantPermissionProblem`](../../packages/Common/Tests/Types/Team/TenantPermissionProblem.test.ts) checks every retired permission against.

### Tests

Migration tests live in [`packages/Common/Tests/Server/Infrastructure/Postgres`](../../packages/Common/Tests/Server/Infrastructure/Postgres). A `<Name>Migration.test.ts` checks a migration's statements against the model and its place in `Index.ts`. A `<Name>Postgres.test.ts` runs it against a real Postgres; its header names the environment variable that opts in.

## ClickHouse and data migrations

Hand-written migrations live in [`packages/App/FeatureSet/Workers/DataMigrations`](../../packages/App/FeatureSet/Workers/DataMigrations): ClickHouse schema and data changes, and Postgres data changes such as backfills. Each is a class that extends `DataMigrationBase` with `migrate()` and `rollback()`, registered by adding an instance to that folder's `Index.ts`, in the order it must run. Each runs once and is recorded. The runner stops at the first migration that fails, so a broken one holds back every migration after it.

- **Most ClickHouse model changes need no migration.** On every boot, [`TableManegement.ts`](../../packages/App/FeatureSet/Workers/Utils/AnalyticsDatabase/TableManegement.ts) creates new tables and materialized views from the models, and adds missing columns, skip indexes and projections to existing tables. Write a migration for what it cannot do: change a column's type, change a sort or partition key (which means dropping and recreating the table), backfill data, or build an index over the parts already on disk.
- **Safe to run twice at once.** Under Docker Compose, and with the Helm chart's `migrate.enabled: false`, several processes run migrations on boot with no lock between them, so two can run the same migration at the same time.
- **Check before you change.** Use `ClickHouseMigrationUtil` to look up what exists, so a migration does nothing on an install whose tables never existed. A migration of single-node DDL returns `false` from `runsInClusterMode()`; a cluster-aware one names its tables with `getStorageTableName` and `onClusterClause` (`Common/Server/Utils/AnalyticsDatabase/ClusterConfig`).
- **Don't hold up the upgrade.** Queue a long ClickHouse mutation to run in the background instead of waiting for it, as `MaterializeAttributeValuesIndex.ts` does.

Their tests live in [`packages/App/Tests/Workers/DataMigrations`](../../packages/App/Tests/Workers/DataMigrations); a `<Name>Clickhouse.test.ts` runs a migration against a real ClickHouse.
