import { MigrationInterface, QueryRunner } from "typeorm";

export class OptimizeTelemetryExceptionWritePath1782500000000
  implements MigrationInterface
{
  public name = "OptimizeTelemetryExceptionWritePath1782500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * Drop the standalone btree index on "occuranceCount".
     *
     * The telemetry ingest path upserts exceptions with
     * `INSERT … ON CONFLICT ("projectId","primaryEntityId","fingerprint")
     * DO UPDATE SET "occuranceCount" = existing + EXCLUDED`, i.e. it bumps
     * occuranceCount on EVERY conflicting event. Because occuranceCount is
     * indexed and its value changes on every update, Postgres can never use
     * a HOT (heap-only-tuple) update for these rows — observed
     * n_tup_hot_upd = 0 across ~8.8M updates. Each increment therefore
     * inserts a fresh tuple version plus new entries in all indexes while
     * holding the row lock, which (a) bloats the heap and indexes faster
     * than autovacuum reclaims and (b) lengthens the lock hold so that
     * concurrent workers hammering the same hot fingerprints pile up into a
     * lock convoy and fail with statement timeout (SQLSTATE 57014),
     * backing the telemetry queue up.
     *
     * The only read that sorts by occuranceCount (the exceptions dashboard)
     * first filters on ("projectId","isResolved","isArchived") — served by
     * its own composite index — so the small filtered result set sorts
     * cheaply without a dedicated occuranceCount index. Dropping it lets the
     * upsert use HOT updates again.
     */
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_fa102ae5073b428e514cc2ceea"`,
    );

    /*
     * Leave free space on each heap page (target 85% fill) so the
     * high-churn upsert has room to write the new tuple version in place as
     * a HOT update instead of overflowing to a new page. Applies to pages
     * written from now on; existing bloat is reclaimed by autovacuum (and
     * optionally a one-time VACUUM / pg_repack run out of band).
     */
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" SET (fillfactor = 85)`,
    );

    /*
     * This table sustains a very high update rate. Make autovacuum trigger
     * far more eagerly and run faster on it so dead tuples from the upsert
     * churn are reclaimed before they bloat the heap and slow every update.
     */
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" SET (` +
        `autovacuum_vacuum_scale_factor = 0.02, ` +
        `autovacuum_analyze_scale_factor = 0.02, ` +
        `autovacuum_vacuum_cost_limit = 2000, ` +
        `autovacuum_vacuum_cost_delay = 2` +
        `)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" RESET (` +
        `autovacuum_vacuum_scale_factor, ` +
        `autovacuum_analyze_scale_factor, ` +
        `autovacuum_vacuum_cost_limit, ` +
        `autovacuum_vacuum_cost_delay` +
        `)`,
    );

    await queryRunner.query(
      `ALTER TABLE "TelemetryException" RESET (fillfactor)`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_fa102ae5073b428e514cc2ceea" ON "public"."TelemetryException" ("occuranceCount")`,
    );
  }
}
