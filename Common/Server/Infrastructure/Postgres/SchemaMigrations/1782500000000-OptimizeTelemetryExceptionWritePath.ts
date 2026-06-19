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

  }

  public async down(queryRunner: QueryRunner): Promise<void> {

    await queryRunner.query(
      `CREATE INDEX "IDX_fa102ae5073b428e514cc2ceea" ON "public"."TelemetryException" ("occuranceCount")`,
    );
  }
}
