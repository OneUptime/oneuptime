import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Monitors can end up holding references to another project's MonitorStatus,
 * IncidentSeverity or AlertSeverity — nothing validated that the ids embedded
 * in `monitorSteps` belong to the monitor's own project, so a status id picked
 * up from a second project got persisted and then copied onto every
 * MonitorStatusTimeline row the monitor wrote.
 *
 * That makes the *referenced* project undeletable: deleting a Project cascades
 * into its MonitorStatus rows, but MonitorStatusTimeline rows owned by a
 * different project still point at them and the FK is ON DELETE NO ACTION, so
 * Postgres raises 23503 and the API answers "Server Error".
 *
 * This migration:
 *   1. repoints every cross-project reference at the equivalent record in the
 *      row's own project (matched by name, then by operational/offline role,
 *      then by nearest priority), and
 *   2. switches the two status-timeline FKs to ON DELETE CASCADE, which is
 *      what they should always have been — a status timeline row is
 *      meaningless once its status is gone.
 *
 * Step 1 runs before step 2 on purpose: repairing first means the timeline
 * history stays attached to the surviving project instead of being swept up by
 * the new cascade.
 */
export class RepairCrossProjectMonitorStatusReferences1785240000000
  implements MigrationInterface
{
  public name: string =
    "RepairCrossProjectMonitorStatusReferences1785240000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * The repair below scans MonitorStatusTimeline, which is in the millions of
     * rows. Measured at ~4.5s on a production-sized table, but the connection
     * carries the app's 30s statement_timeout (DATABASE_STATEMENT_TIMEOUT_MS)
     * and a loaded database should not turn this into a failed deploy.
     */
    await queryRunner.query(`SET LOCAL statement_timeout = '600s'`);

    // 1. MonitorStatusTimeline rows pointing at another project's status.
    await queryRunner.query(`
      WITH bad AS (
        SELECT t."_id" AS row_id,
               t."projectId" AS project_id,
               ms."name" AS status_name,
               ms."isOperationalState" AS is_operational,
               ms."isOfflineState" AS is_offline,
               ms."priority" AS priority
        FROM "MonitorStatusTimeline" t
        JOIN "MonitorStatus" ms ON ms."_id" = t."monitorStatusId"
        WHERE t."projectId" IS DISTINCT FROM ms."projectId"
      ), resolved AS (
        SELECT b.row_id, COALESCE(
          (SELECT s."_id" FROM "MonitorStatus" s
            WHERE s."projectId" = b.project_id AND lower(s."name") = lower(b.status_name)
            ORDER BY s."priority" LIMIT 1),
          (SELECT s."_id" FROM "MonitorStatus" s
            WHERE s."projectId" = b.project_id
              AND s."isOperationalState" = b.is_operational
              AND s."isOfflineState" = b.is_offline
            ORDER BY s."priority" LIMIT 1),
          (SELECT s."_id" FROM "MonitorStatus" s
            WHERE s."projectId" = b.project_id
            ORDER BY abs(s."priority" - b.priority), s."priority" LIMIT 1)
        ) AS good_status_id
        FROM bad b
      )
      UPDATE "MonitorStatusTimeline" t
      SET "monitorStatusId" = r.good_status_id
      FROM resolved r
      WHERE t."_id" = r.row_id AND r.good_status_id IS NOT NULL
    `);

    // 2. NetworkSiteStatusTimeline rows pointing at another project's status.
    await queryRunner.query(`
      WITH bad AS (
        SELECT t."_id" AS row_id,
               t."projectId" AS project_id,
               ms."name" AS status_name,
               ms."isOperationalState" AS is_operational,
               ms."isOfflineState" AS is_offline,
               ms."priority" AS priority
        FROM "NetworkSiteStatusTimeline" t
        JOIN "MonitorStatus" ms ON ms."_id" = t."monitorStatusId"
        WHERE t."projectId" IS DISTINCT FROM ms."projectId"
      ), resolved AS (
        SELECT b.row_id, COALESCE(
          (SELECT s."_id" FROM "MonitorStatus" s
            WHERE s."projectId" = b.project_id AND lower(s."name") = lower(b.status_name)
            ORDER BY s."priority" LIMIT 1),
          (SELECT s."_id" FROM "MonitorStatus" s
            WHERE s."projectId" = b.project_id
              AND s."isOperationalState" = b.is_operational
              AND s."isOfflineState" = b.is_offline
            ORDER BY s."priority" LIMIT 1),
          (SELECT s."_id" FROM "MonitorStatus" s
            WHERE s."projectId" = b.project_id
            ORDER BY abs(s."priority" - b.priority), s."priority" LIMIT 1)
        ) AS good_status_id
        FROM bad b
      )
      UPDATE "NetworkSiteStatusTimeline" t
      SET "monitorStatusId" = r.good_status_id
      FROM resolved r
      WHERE t."_id" = r.row_id AND r.good_status_id IS NOT NULL
    `);

    /*
     * 3. Monitor.currentMonitorStatusId pointing at another project's status.
     * This FK stays NO ACTION — deleting a status that monitors are currently
     * in should be blocked — so a cross-project value here blocks deletion the
     * same way. The column is NOT NULL, hence a repoint rather than a null.
     */
    await queryRunner.query(`
      WITH bad AS (
        SELECT m."_id" AS row_id,
               m."projectId" AS project_id,
               ms."name" AS status_name,
               ms."isOperationalState" AS is_operational,
               ms."isOfflineState" AS is_offline,
               ms."priority" AS priority
        FROM "Monitor" m
        JOIN "MonitorStatus" ms ON ms."_id" = m."currentMonitorStatusId"
        WHERE m."projectId" IS DISTINCT FROM ms."projectId"
      ), resolved AS (
        SELECT b.row_id, COALESCE(
          (SELECT s."_id" FROM "MonitorStatus" s
            WHERE s."projectId" = b.project_id AND lower(s."name") = lower(b.status_name)
            ORDER BY s."priority" LIMIT 1),
          (SELECT s."_id" FROM "MonitorStatus" s
            WHERE s."projectId" = b.project_id
              AND s."isOperationalState" = b.is_operational
              AND s."isOfflineState" = b.is_offline
            ORDER BY s."priority" LIMIT 1),
          (SELECT s."_id" FROM "MonitorStatus" s
            WHERE s."projectId" = b.project_id
            ORDER BY abs(s."priority" - b.priority), s."priority" LIMIT 1)
        ) AS good_status_id
        FROM bad b
      )
      UPDATE "Monitor" m
      SET "currentMonitorStatusId" = r.good_status_id
      FROM resolved r
      WHERE m."_id" = r.row_id AND r.good_status_id IS NOT NULL
    `);

    /*
     * 4. Cross-project ids embedded in Monitor.monitorSteps. These carry no FK,
     * so they would silently dangle once the other project is deleted (the
     * monitor's default status, and the severity used to open incidents/alerts,
     * would both point at nothing). Rewrite them onto the monitor's own
     * project's equivalents.
     */
    await queryRunner.query(`
      DO $$
      DECLARE
        monitor_row record;
        remap_row record;
        steps_text text;
      BEGIN
        CREATE TEMP TABLE _cross_project_step_refs ON COMMIT DROP AS
        SELECT m."_id" AS monitor_id,
               m."projectId" AS project_id,
               matched.arr[1]::uuid AS ref_id
        FROM "Monitor" m
        CROSS JOIN LATERAL regexp_matches(
          m."monitorSteps"::text,
          '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
          'g'
        ) AS matched(arr)
        WHERE m."monitorSteps" IS NOT NULL;

        CREATE TEMP TABLE _cross_project_step_remap ON COMMIT DROP AS
        SELECT DISTINCT sr.monitor_id, sr.ref_id AS bad_id, COALESCE(
          (SELECT x."_id" FROM "MonitorStatus" x
            WHERE x."projectId" = sr.project_id AND lower(x."name") = lower(ms."name")
            ORDER BY x."priority" LIMIT 1),
          (SELECT x."_id" FROM "MonitorStatus" x
            WHERE x."projectId" = sr.project_id
              AND x."isOperationalState" = ms."isOperationalState"
              AND x."isOfflineState" = ms."isOfflineState"
            ORDER BY x."priority" LIMIT 1)
        ) AS good_id
        FROM _cross_project_step_refs sr
        JOIN "MonitorStatus" ms ON ms."_id" = sr.ref_id
        WHERE ms."projectId" IS DISTINCT FROM sr.project_id

        UNION ALL

        SELECT DISTINCT sr.monitor_id, sr.ref_id, (
          SELECT x."_id" FROM "IncidentSeverity" x
          WHERE x."projectId" = sr.project_id AND lower(x."name") = lower(sev."name")
          ORDER BY x."order" LIMIT 1
        )
        FROM _cross_project_step_refs sr
        JOIN "IncidentSeverity" sev ON sev."_id" = sr.ref_id
        WHERE sev."projectId" IS DISTINCT FROM sr.project_id

        UNION ALL

        SELECT DISTINCT sr.monitor_id, sr.ref_id, (
          SELECT x."_id" FROM "AlertSeverity" x
          WHERE x."projectId" = sr.project_id AND lower(x."name") = lower(sev."name")
          ORDER BY x."order" LIMIT 1
        )
        FROM _cross_project_step_refs sr
        JOIN "AlertSeverity" sev ON sev."_id" = sr.ref_id
        WHERE sev."projectId" IS DISTINCT FROM sr.project_id;

        FOR monitor_row IN
          SELECT DISTINCT monitor_id FROM _cross_project_step_remap WHERE good_id IS NOT NULL
        LOOP
          SELECT "monitorSteps"::text INTO steps_text
          FROM "Monitor" WHERE "_id" = monitor_row.monitor_id;

          FOR remap_row IN
            SELECT bad_id, good_id FROM _cross_project_step_remap
            WHERE monitor_id = monitor_row.monitor_id AND good_id IS NOT NULL
          LOOP
            steps_text := replace(steps_text, remap_row.bad_id::text, remap_row.good_id::text);
          END LOOP;

          UPDATE "Monitor" SET "monitorSteps" = steps_text::jsonb
          WHERE "_id" = monitor_row.monitor_id;
        END LOOP;
      END $$;
    `);

    /*
     * 5. A status timeline row cannot outlive its status, so cascade instead of
     * blocking. Without this, a leftover cross-project row (one we could not
     * resolve above, e.g. a project with no statuses of its own) would still
     * make the referenced project undeletable.
     *
     * Swapping a foreign key needs ACCESS EXCLUSIVE on MonitorStatusTimeline —
     * the busiest write table there is — and the lock is held until this
     * migration commits. The DDL itself measures ~1.3s, but the server has no
     * lock_timeout, so without the line below a single slow transaction holding
     * the table would make this statement queue *and* park every reader and
     * writer behind it until the 30s statement_timeout fired. Failing fast and
     * retrying the deploy is much cheaper than stalling the table.
     */
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    await queryRunner.query(
      `ALTER TABLE "MonitorStatusTimeline" DROP CONSTRAINT "FK_574feb4161c5216c2c7ee0faaf8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatusTimeline" ADD CONSTRAINT "FK_574feb4161c5216c2c7ee0faaf8" FOREIGN KEY ("monitorStatusId") REFERENCES "MonitorStatus"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteStatusTimeline" DROP CONSTRAINT "FK_8886e21e28e5287abb5b26475a1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteStatusTimeline" ADD CONSTRAINT "FK_8886e21e28e5287abb5b26475a1" FOREIGN KEY ("monitorStatusId") REFERENCES "MonitorStatus"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  /*
   * Only the constraints are reversible. The repaired references are not:
   * the previous values pointed at another project's records and there is
   * nothing worth restoring them to.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteStatusTimeline" DROP CONSTRAINT "FK_8886e21e28e5287abb5b26475a1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteStatusTimeline" ADD CONSTRAINT "FK_8886e21e28e5287abb5b26475a1" FOREIGN KEY ("monitorStatusId") REFERENCES "MonitorStatus"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatusTimeline" DROP CONSTRAINT "FK_574feb4161c5216c2c7ee0faaf8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatusTimeline" ADD CONSTRAINT "FK_574feb4161c5216c2c7ee0faaf8" FOREIGN KEY ("monitorStatusId") REFERENCES "MonitorStatus"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }
}
