import logger from "../../../Utils/Logger";
import { MigrationInterface, QueryRunner } from "typeorm";

export const INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX: string =
  "IDX_INVENTORY_ITEM_PROJECT_ENTITY_KEY";

/*
 * Above this many InventoryItem rows the index is not built here (see
 * "LOCKING" below). Roughly ten seconds of build on modest hardware.
 */
export const INVENTORY_ITEM_INLINE_INDEX_BUILD_MAX_ROWS: number = 1_000_000;

/* What an operator runs to build the index online, under exactly this name. */
export const INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX_RUNBOOK: string = `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX}" ON "InventoryItem" ("projectId", "entityKey")`;

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
 * the project. The queries are written to stay correct and acceptable without
 * this index (they constrain "entityType" to the project's types so the
 * unique index is usable), because on Helm installs migrations run
 * asynchronously and the new API can serve traffic before this has been
 * built. This makes the same lookups one probe.
 *
 * Relationships get no new index on purpose: InventoryItemRelationship is the
 * largest inventory table and a plain CREATE INDEX would block its ingest
 * writes for the whole build.
 *
 * WHY THIS IS HAND-WRITTEN
 *
 * A generated migration cannot bound its own lock wait or runtime, nor decide
 * to leave a build to the operator, and this one runs against a table that
 * ingest writes continuously. The entity declares the index by name with
 * `synchronize: false` (see Types/Database/UnsynchronizedIndex.ts), so the
 * schema builder neither generates a second copy nor drops this one.
 *
 * LOCKING, AND THE RUNBOOK FOR LARGE INSTALLS
 *
 * Migrations run one transaction each (migrationsTransactionMode "each"), so
 * CREATE INDEX CONCURRENTLY is not available here. A plain CREATE INDEX holds
 * a SHARE lock on InventoryItem for as long as the build takes: reads
 * continue, inventory writes queue behind it and fail once their own
 * lock_timeout (3 s in the app) or statement_timeout runs out.
 *
 * The build cannot be given more time than the connection allows. The
 * effective ceiling is the client-side DATABASE_QUERY_TIMEOUT_MS of
 * node-postgres (35 s by default), which no SET can raise: past it the client
 * abandons the query — and the ROLLBACK queued behind it — while the server
 * keeps building and keeps the lock. So statement_timeout stays at the
 * connection's own value (30 s by default, below that ceiling; `DEFAULT`
 * undoes anything an earlier statement on the session may have set), which
 * makes Postgres cancel an overlong build itself and release the lock at
 * once. `lock_timeout` stops the migration from queueing behind a long
 * transaction (and parking every writer behind itself) for more than five
 * seconds; a timeout fails the migration, which the next start retries.
 *
 * A build that would not finish comfortably inside that window is not
 * attempted: when InventoryItem holds more than
 * INVENTORY_ITEM_INLINE_INDEX_BUILD_MAX_ROWS rows (the planner's estimate
 * from pg_class; a bounded count when the table has never been analyzed),
 * this migration logs a warning and completes without the index. The
 * Topology API is correct without it, only slower on key lookups. Such an
 * install should build the index online, at any time, under exactly this
 * name:
 *
 *   CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_INVENTORY_ITEM_PROJECT_ENTITY_KEY"
 *     ON "InventoryItem" ("projectId", "entityKey");
 *
 * Built before the upgrade, this migration finds it and does nothing. A
 * CONCURRENTLY build that failed leaves an INVALID index behind under that
 * name, which IF NOT EXISTS would otherwise accept forever; such a leftover
 * is dropped here first (so the runbook works as written afterwards) and
 * rebuilt when the table is small enough.
 *
 * An online build that is still RUNNING looks exactly like that leftover
 * (pg_index.indisvalid is false until it finishes). Dropping it would queue
 * for an ACCESS EXCLUSIVE lock behind the build and stall every reader and
 * writer of InventoryItem meanwhile, so a build in progress
 * (pg_stat_progress_create_index) is left to finish and this migration
 * completes without touching it.
 */
export class AddInventoryItemProjectEntityKeyIndex1795200000000
  implements MigrationInterface
{
  public name: string = "AddInventoryItemProjectEntityKeyIndex1795200000000";

  /* Lowered only by tests; TypeORM constructs migrations without arguments. */
  public constructor(
    private maxRowsForInlineBuild: number = INVENTORY_ITEM_INLINE_INDEX_BUILD_MAX_ROWS,
  ) {}

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL statement_timeout = DEFAULT`);
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    const existing: Array<{ isValid: boolean }> = await queryRunner.query(
      `SELECT x.indisvalid AS "isValid" FROM pg_index x
       JOIN pg_class c ON c.oid = x.indexrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relname = $1 AND n.nspname = current_schema()`,
      [INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX],
    );

    if (
      existing.some((index: { isValid: boolean }): boolean => {
        return index.isValid === true;
      })
    ) {
      /* Pre-built by an operator (or already migrated): nothing to do. */
      return;
    }

    if (existing.length > 0) {
      if (await this.isBuildInProgress(queryRunner)) {
        logger.warn(
          `AddInventoryItemProjectEntityKeyIndex: an online build of ${INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX} is in progress; leaving it to finish. If that build fails, drop the INVALID index it leaves behind and run again: ${INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX_RUNBOOK};`,
        );
        return;
      }
      await queryRunner.query(
        `DROP INDEX IF EXISTS "${INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX}"`,
      );
    }

    const rows: number = await this.estimateRows(queryRunner);

    if (rows > this.maxRowsForInlineBuild) {
      logger.warn(
        `AddInventoryItemProjectEntityKeyIndex: InventoryItem holds about ${Math.round(
          rows,
        )} rows, more than the ${this.maxRowsForInlineBuild} this migration builds an index over while it blocks inventory writes, so the index ${INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX} was NOT created. The Topology maps work without it but resolve entity keys more slowly. Build it online (it does not block writes) by running on the OneUptime database: ${INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX_RUNBOOK};`,
      );
      return;
    }

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "${INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX}" ON "InventoryItem" ("projectId", "entityKey")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * DROP INDEX takes ACCESS EXCLUSIVE on the table; waiting for it would
     * park every reader and writer of InventoryItem behind this statement.
     */
    await queryRunner.query(`SET LOCAL statement_timeout = DEFAULT`);
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "${INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX}"`,
    );
  }

  /* Whether a CREATE INDEX (CONCURRENTLY) of this index is running now. */
  private async isBuildInProgress(queryRunner: QueryRunner): Promise<boolean> {
    const builds: Array<unknown> = await queryRunner.query(
      `SELECT 1 FROM pg_stat_progress_create_index p
       JOIN pg_class c ON c.oid = p.index_relid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relname = $1 AND n.nspname = current_schema()`,
      [INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX],
    );
    return builds.length > 0;
  }

  /*
   * How many rows InventoryItem holds, from the statistics the planner uses:
   * pg_class.reltuples scaled from the pages it was measured over to the
   * table's current size (so growth since the last ANALYZE counts). A table
   * that has never been analyzed (reltuples -1), or whose statistics saw no
   * pages although it has some now, is counted instead — only up to just past
   * the threshold, so the count stays cheap on any table.
   */
  private async estimateRows(queryRunner: QueryRunner): Promise<number> {
    const statistics: Array<{
      reltuples: number | string | null;
      relpages: number | string | null;
      pages: number | string | null;
    }> = await queryRunner.query(
      `SELECT c.reltuples::float8 AS "reltuples", c.relpages::float8 AS "relpages",
         (pg_relation_size(c.oid) / current_setting('block_size')::int)::float8 AS "pages"
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relname = 'InventoryItem' AND n.nspname = current_schema()`,
    );

    const reltuples: number = Number(statistics[0]?.reltuples ?? -1);
    const relpages: number = Number(statistics[0]?.relpages ?? 0);
    const pages: number = Number(statistics[0]?.pages ?? 0);

    const isKnown: boolean =
      Number.isFinite(reltuples) &&
      reltuples >= 0 &&
      Number.isFinite(relpages) &&
      Number.isFinite(pages) &&
      (relpages > 0 || pages === 0);

    if (isKnown) {
      return relpages > 0
        ? Math.max(reltuples, (reltuples / relpages) * pages)
        : reltuples;
    }

    const counted: Array<{ count: number | string }> = await queryRunner.query(
      `SELECT COUNT(*)::int AS "count" FROM (SELECT 1 FROM "InventoryItem" LIMIT $1) bounded`,
      [this.maxRowsForInlineBuild + 1],
    );

    return Number(counted[0]?.count ?? 0);
  }
}
