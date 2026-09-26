import { MigrationInterface, QueryRunner } from "typeorm";

export const INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX: string =
  "IDX_INVENTORY_ITEM_PROJECT_ENTITY_KEY";

/*
 * Adds ("projectId", "entityKey") on InventoryItem.
 *
 * WHY
 *
 * Relationships name both ends by entity key only. The Topology API resolves
 * those keys to items constantly — the things services call, where they run,
 * the other end of every row in the detail drawer — and the only index that
 * leads with the key today is the unique ("projectId", "entityType",
 * "entityKey"), which a type-less lookup can use only as one probe per type in
 * the project. The queries are written to stay acceptable without this index
 * (they constrain "entityType" to the project's types so the unique index is
 * usable), because on Helm installs migrations run asynchronously and the new
 * API can serve traffic before this has been built. This makes the same
 * lookups one probe.
 *
 * Relationships get no new index on purpose: InventoryItemRelationship is the
 * largest inventory table and a plain CREATE INDEX would block its ingest
 * writes for the whole build.
 *
 * WHY THIS IS HAND-WRITTEN
 *
 * A generated migration cannot bound its own lock wait or runtime, and this
 * one runs against a table that ingest writes continuously. The entity
 * declares the index by name with `synchronize: false` (see
 * Types/Database/UnsynchronizedIndex.ts), so the schema builder neither
 * generates a second copy nor drops this one.
 *
 * LOCKING, AND THE RUNBOOK FOR LARGE INSTALLS
 *
 * Migrations run one transaction each (migrationsTransactionMode "each"), so
 * CREATE INDEX CONCURRENTLY is not available here. A plain CREATE INDEX holds
 * a SHARE lock on InventoryItem — reads continue, inventory writes wait — for
 * as long as the build takes: well under a second for typical projects, tens
 * of seconds for a table with millions of rows. `lock_timeout` stops the
 * migration from queueing behind a long transaction (and parking every writer
 * behind itself) for more than five seconds; a timeout fails the migration,
 * which the next start retries. `statement_timeout` lifts the connection's
 * 30 s default for the build itself.
 *
 * Installs with a very large InventoryItem table should build the index
 * online BEFORE upgrading, under exactly this name:
 *
 *   CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_INVENTORY_ITEM_PROJECT_ENTITY_KEY"
 *     ON "InventoryItem" ("projectId", "entityKey");
 *
 * This migration then finds it and does nothing. A CONCURRENTLY build that
 * failed leaves an INVALID index behind under that name, which IF NOT EXISTS
 * would otherwise accept forever; such a leftover is dropped and rebuilt here.
 */
export class AddInventoryItemProjectEntityKeyIndex1795200000000
  implements MigrationInterface
{
  public name: string = "AddInventoryItemProjectEntityKeyIndex1795200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL statement_timeout = '600s'`);
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    const invalidLeftovers: Array<{ relname: string }> =
      await queryRunner.query(
        `SELECT c.relname FROM pg_index x
         JOIN pg_class c ON c.oid = x.indexrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relname = $1 AND n.nspname = current_schema() AND NOT x.indisvalid`,
        [INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX],
      );

    if (invalidLeftovers.length > 0) {
      await queryRunner.query(
        `DROP INDEX IF EXISTS "${INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX}"`,
      );
    }

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "${INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX}" ON "InventoryItem" ("projectId", "entityKey")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "${INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX}"`,
    );
  }
}
