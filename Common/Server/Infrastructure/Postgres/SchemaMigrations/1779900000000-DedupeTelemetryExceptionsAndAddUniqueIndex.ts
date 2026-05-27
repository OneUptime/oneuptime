import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The OTel traces ingest path used to call
 * ExceptionUtil.saveOrUpdateTelemetryException once per exception
 * event with a findOneBy + updateOneBy/create pair, fire-and-forget,
 * from inside the span loop. That has three problems we are fixing
 * in tandem with this schema change:
 *
 *   1. Cost: each event is a Postgres round-trip. A worker batch
 *      with thousands of exception events drives thousands of
 *      parallel SELECT/UPDATE statements and starves the pool.
 *   2. Lost increments: `occuranceCount = existing.occuranceCount + 1`
 *      is read-modify-write at the JS layer, so two workers
 *      seeing the same row at the same instant collapse to a
 *      single +1 instead of +2.
 *   3. Duplicate rows: two workers both missing the row at the
 *      same time both INSERT, with no DB-level guard, producing
 *      two TelemetryException rows for the same fingerprint.
 *
 * The ingest path is moving to a single batched
 *   INSERT … ON CONFLICT ("projectId", "serviceId", "fingerprint")
 *   DO UPDATE SET "occuranceCount" =
 *       "TelemetryException"."occuranceCount" + EXCLUDED."occuranceCount",
 *       ...
 * statement per worker batch, which needs the composite unique
 * index this migration creates. Before we can create the index we
 * have to clear out the duplicate rows produced by the legacy race
 * (problem 3 above) — otherwise the CREATE UNIQUE INDEX would fail
 * on production data.
 *
 * Strategy: pick one survivor per (projectId, serviceId, fingerprint)
 * group and hard-delete the rest. We do NOT try to merge
 * occuranceCount / firstSeenAt / lastSeenAt from the losers into the
 * survivor — the simpler delete-only approach trades a small,
 * one-time count discrepancy on duplicated fingerprints for a much
 * simpler migration that is easy to reason about and roll back. The
 * next exception occurrence for that fingerprint will re-increment
 * the survivor via the new ON CONFLICT upsert, and the dashboard
 * recovers within seconds.
 *
 * Survivor selection prefers the row that was carrying the most
 * traffic before the unique index landed, because in the legacy
 * code path `findOneBy` returned an implementation-defined row and
 * all subsequent UPDATEs piled into that one — discarding it would
 * be the most lossy choice. Order is:
 *   1. Highest occuranceCount (the "real" row absorbing updates).
 *   2. Most recent lastSeenAt (in case counts are tied).
 *   3. Non-deleted before deleted (live data beats soft-deleted).
 *   4. Smallest _id as a deterministic tiebreaker so re-runs pick
 *      the same survivor.
 *
 * TelemetryException is a leaf table — no other table holds an FK
 * referencing it — so we do not need to reparent anything before
 * deleting loser rows. NULL-fingerprint rows are left alone; the
 * composite unique index treats NULLs as distinct, and the new
 * ingest path never produces a NULL fingerprint anyway.
 */
export class DedupeTelemetryExceptionsAndAddUniqueIndex1779900000000
  implements MigrationInterface
{
  public name: string =
    "DedupeTelemetryExceptionsAndAddUniqueIndex1779900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Delete every row that is not the chosen survivor for its group.
    await queryRunner.query(`
      WITH survivors AS (
        SELECT DISTINCT ON ("projectId", "serviceId", "fingerprint")
          _id AS survivor_id
        FROM "TelemetryException"
        WHERE "fingerprint" IS NOT NULL
        ORDER BY
          "projectId",
          "serviceId",
          "fingerprint",
          COALESCE("occuranceCount", 0) DESC,
          "lastSeenAt" DESC NULLS LAST,
          CASE WHEN "deletedAt" IS NULL THEN 0 ELSE 1 END,
          _id ASC
      )
      DELETE FROM "TelemetryException" te
      WHERE te."fingerprint" IS NOT NULL
        AND te._id NOT IN (SELECT survivor_id FROM survivors)
        AND EXISTS (
          SELECT 1
          FROM "TelemetryException" t2
          WHERE t2."projectId" = te."projectId"
            AND t2."serviceId" = te."serviceId"
            AND t2."fingerprint" = te."fingerprint"
            AND t2._id <> te._id
        );
    `);

    /*
     * 2. Create the DB-level composite unique index. Matches the
     *    @Index decorator on TelemetryException and is the conflict
     *    target for the batched upsert in ExceptionUtil.
     */
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_telemetry_exception_project_service_fingerprint" ON "TelemetryException" ("projectId", "serviceId", "fingerprint") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_telemetry_exception_project_service_fingerprint"`,
    );
    /*
     * The duplicate rows deleted in up() are not resurrectable from
     * a down-migration, and recreating them is not desirable — they
     * only existed because of a race the unique index now prevents.
     */
  }
}
