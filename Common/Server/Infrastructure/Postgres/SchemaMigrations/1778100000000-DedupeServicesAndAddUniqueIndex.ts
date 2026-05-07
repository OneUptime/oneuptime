import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Before this migration, Service had an app-level
 * @UniqueColumnBy("projectId") check on `name` but no DB-level
 * uniqueness. Under concurrent OTel telemetry from a brand-new
 * source (e.g. the hostmetrics receiver fires cpu/memory/process
 * scope batches in parallel on first contact), the find+countBy
 * check inside checkUniqueColumnBy raced its sibling batches,
 * the DB accepted every insert, and a single host could end up
 * with four or more duplicate "host/<hostname>" service rows.
 *
 * This migration:
 *   1. Picks one survivor per (projectId, name) group — preferring
 *      the oldest non-deleted row so live data wins over a stale
 *      soft-deleted row that happens to predate it.
 *   2. Reparents every FK that references a loser onto the survivor
 *      across the eight tables that point at Service._id, plus the
 *      ServiceLabel join table (INSERT ON CONFLICT to avoid PK
 *      violations when multiple losers share a label).
 *   3. Hard-deletes the loser rows. Their ServiceLabel rows are
 *      already migrated, and the FK CASCADE on ServiceLabel cleans
 *      up the loser-side join rows automatically.
 *   4. Adds a DB-level composite unique index on (projectId, name)
 *      so future races are rejected by the DB — the existing
 *      catch-and-refetch path in OTelIngestService.telemetryServiceFromName
 *      then resolves to the winning row instead of producing a duplicate.
 *
 * ClickHouse `Metric.serviceId` rows tagged with a loser ID are not
 * touched here; they become orphaned and fall off via retention.
 * This is intentional — Postgres migrations don't reach into
 * ClickHouse, and the metric data for a deduped pre-fix burst is
 * a few minutes old at most.
 */
export class DedupeServicesAndAddUniqueIndex1778100000000
  implements MigrationInterface
{
  public name: string = "DedupeServicesAndAddUniqueIndex1778100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * Survivor selection, reused verbatim by every reparent below.
     * Prefers non-deleted rows, then oldest createdAt, then smallest
     * _id as a deterministic tiebreaker.
     */
    const survivorsAndLosersCte: string = `
      WITH survivors AS (
        SELECT DISTINCT ON ("projectId", "name")
          _id AS survivor_id,
          "projectId",
          "name"
        FROM "Service"
        ORDER BY
          "projectId",
          "name",
          CASE WHEN "deletedAt" IS NULL THEN 0 ELSE 1 END,
          "createdAt" ASC,
          _id ASC
      ),
      losers AS (
        SELECT s2._id AS loser_id, s.survivor_id
        FROM "Service" s2
        JOIN survivors s
          ON s."projectId" = s2."projectId"
         AND s."name" = s2."name"
        WHERE s2._id <> s.survivor_id
      )
    `;

    // 1: reparent ServiceOwnerUser FKs.
    await queryRunner.query(`
      ${survivorsAndLosersCte}
      UPDATE "ServiceOwnerUser" t
      SET "serviceId" = l.survivor_id
      FROM losers l
      WHERE t."serviceId" = l.loser_id;
    `);

    // 2: reparent ServiceOwnerTeam FKs.
    await queryRunner.query(`
      ${survivorsAndLosersCte}
      UPDATE "ServiceOwnerTeam" t
      SET "serviceId" = l.survivor_id
      FROM losers l
      WHERE t."serviceId" = l.loser_id;
    `);

    // 3: reparent MetricPipelineRule FKs.
    await queryRunner.query(`
      ${survivorsAndLosersCte}
      UPDATE "MetricPipelineRule" t
      SET "serviceId" = l.survivor_id
      FROM losers l
      WHERE t."serviceId" = l.loser_id;
    `);

    // 4: reparent ServiceDependency.serviceId FKs.
    await queryRunner.query(`
      ${survivorsAndLosersCte}
      UPDATE "ServiceDependency" t
      SET "serviceId" = l.survivor_id
      FROM losers l
      WHERE t."serviceId" = l.loser_id;
    `);

    // 5: reparent ServiceDependency.dependencyServiceId FKs.
    await queryRunner.query(`
      ${survivorsAndLosersCte}
      UPDATE "ServiceDependency" t
      SET "dependencyServiceId" = l.survivor_id
      FROM losers l
      WHERE t."dependencyServiceId" = l.loser_id;
    `);

    // 6: reparent TelemetryException FKs.
    await queryRunner.query(`
      ${survivorsAndLosersCte}
      UPDATE "TelemetryException" t
      SET "serviceId" = l.survivor_id
      FROM losers l
      WHERE t."serviceId" = l.loser_id;
    `);

    // 7: reparent ServiceMonitor FKs.
    await queryRunner.query(`
      ${survivorsAndLosersCte}
      UPDATE "ServiceMonitor" t
      SET "serviceId" = l.survivor_id
      FROM losers l
      WHERE t."serviceId" = l.loser_id;
    `);

    // 8: reparent ServiceCodeRepository FKs.
    await queryRunner.query(`
      ${survivorsAndLosersCte}
      UPDATE "ServiceCodeRepository" t
      SET "serviceId" = l.survivor_id
      FROM losers l
      WHERE t."serviceId" = l.loser_id;
    `);

    // 9: reparent TelemetryUsageBilling FKs.
    await queryRunner.query(`
      ${survivorsAndLosersCte}
      UPDATE "TelemetryUsageBilling" t
      SET "serviceId" = l.survivor_id
      FROM losers l
      WHERE t."serviceId" = l.loser_id;
    `);

    /*
     * 10: ServiceLabel is a (serviceId, labelId) M2M join with that
     * pair as PK. A blind UPDATE would explode if two losers share a
     * label — both rows would collide on (survivor, label). Instead
     * INSERT the survivor-side rows first (deduped via DISTINCT) with
     * ON CONFLICT DO NOTHING; the FK CASCADE on Service deletes the
     * loser-side rows automatically when step 11 hard-deletes losers.
     */
    await queryRunner.query(`
      ${survivorsAndLosersCte}
      INSERT INTO "ServiceLabel" ("serviceId", "labelId")
      SELECT DISTINCT l.survivor_id, sl."labelId"
      FROM "ServiceLabel" sl
      JOIN losers l ON l.loser_id = sl."serviceId"
      ON CONFLICT ("serviceId", "labelId") DO NOTHING;
    `);

    // 11: hard-delete the loser rows. CASCADE handles ServiceLabel cleanup.
    await queryRunner.query(`
      WITH survivors AS (
        SELECT DISTINCT ON ("projectId", "name")
          _id AS survivor_id,
          "projectId",
          "name"
        FROM "Service"
        ORDER BY
          "projectId",
          "name",
          CASE WHEN "deletedAt" IS NULL THEN 0 ELSE 1 END,
          "createdAt" ASC,
          _id ASC
      )
      DELETE FROM "Service" s2
      USING survivors s
      WHERE s."projectId" = s2."projectId"
        AND s."name" = s2."name"
        AND s2._id <> s.survivor_id;
    `);

    // 12: add the DB-level composite unique index.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b8d4e2a1c9f7e6d5b4a3c2f1" ON "Service" ("projectId", "name") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b8d4e2a1c9f7e6d5b4a3c2f1"`,
    );
    /*
     * Duplicate rows dropped in up() are lost — a down-migration
     * cannot resurrect them (and reinstating duplicates is not
     * desirable anyway).
     */
  }
}
