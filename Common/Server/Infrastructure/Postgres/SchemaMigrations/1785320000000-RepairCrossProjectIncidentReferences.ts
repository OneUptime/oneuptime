import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Deleting a project fails with "This item cannot be deleted because Incident
 * records still reference it."
 *
 * An Incident stores the id of its state, its severity and the monitor status
 * it switches monitors to. Nothing validated that those ids belong to the
 * incident's own project — they arrive from an API call, an incident template
 * or a monitor criteria — so an id from a *second* project could be persisted.
 *
 * Deleting a Project cascades into its IncidentState / IncidentSeverity /
 * MonitorStatus rows, but the Incident row owned by the other project still
 * points at them and those FKs are ON DELETE NO ACTION, so Postgres raises
 * 23503 and the delete is refused. Same-project references are fine: they are
 * removed by the same cascading statement, so the NO ACTION check passes.
 *
 * RepairCrossProjectMonitorStatusReferences1785240000000 fixed this shape for
 * MonitorStatusTimeline. This migration finishes the job for every remaining
 * ON DELETE NO ACTION reference that a project delete can trip over — the
 * incident, alert and scheduled maintenance families, including their episodes
 * and templates.
 *
 * It does two things:
 *   1. repoints every cross-project reference at the equivalent record in the
 *      row's own project (matched by name, then by the state's role flags,
 *      then by nearest order/priority). Where the column is nullable and
 *      nothing could be matched, the reference is cleared instead.
 *   2. switches the five state-timeline FKs to ON DELETE CASCADE, which is
 *      what they should always have been — a state timeline row is
 *      meaningless once its state is gone.
 *
 * Step 1 runs before step 2 on purpose: repairing first means the timeline
 * history stays attached to the surviving project instead of being swept up by
 * the new cascade.
 *
 * Not covered on purpose:
 *   - Monitor.currentMonitorStatusId keeps NO ACTION (deleting a status that
 *     monitors are currently in should stay blocked) and its cross-project
 *     rows were already repaired by the 1785240000000 migration.
 *   - A row whose own project has no record of that kind at all cannot be
 *     repointed and, for the not-null columns, is left as is. That needs a
 *     project with zero incident states / severities, which project creation
 *     does not produce.
 */

export interface CrossProjectReference {
  // The table holding the reference, e.g. "Incident".
  table: string;
  // The referencing column, e.g. "currentIncidentStateId".
  column: string;
  // The project-scoped table it points at, e.g. "IncidentState".
  referencedTable: string;
  /*
   * Column ordering the referenced table within a project — "order" for states
   * and severities, "priority" for monitor statuses. Used for the last-resort
   * "nearest equivalent" match.
   */
  orderColumn: string;
  /*
   * Boolean role columns that identify the same record across projects when
   * the names differ (a renamed "Created" state is still the created state).
   * Severities have none.
   */
  roleColumns: Array<string>;
  /*
   * Nullable columns get their leftover cross-project references cleared when
   * no equivalent exists in the row's own project. Not-null columns cannot.
   */
  isNullable: boolean;
}

const INCIDENT_STATE_ROLES: Array<string> = [
  "isCreatedState",
  "isAcknowledgedState",
  "isResolvedState",
];

const ALERT_STATE_ROLES: Array<string> = [
  "isCreatedState",
  "isAcknowledgedState",
  "isResolvedState",
];

const SCHEDULED_MAINTENANCE_STATE_ROLES: Array<string> = [
  "isScheduledState",
  "isOngoingState",
  "isEndedState",
  "isResolvedState",
];

const MONITOR_STATUS_ROLES: Array<string> = [
  "isOperationalState",
  "isOfflineState",
];

/*
 * Every ON DELETE NO ACTION reference to a project-scoped state / severity /
 * status that a project delete can trip over, as of this migration.
 */
export const CROSS_PROJECT_REFERENCES: Array<CrossProjectReference> = [
  {
    table: "Incident",
    column: "currentIncidentStateId",
    referencedTable: "IncidentState",
    orderColumn: "order",
    roleColumns: INCIDENT_STATE_ROLES,
    isNullable: false,
  },
  {
    table: "Incident",
    column: "incidentSeverityId",
    referencedTable: "IncidentSeverity",
    orderColumn: "order",
    roleColumns: [],
    isNullable: false,
  },
  {
    table: "Incident",
    column: "changeMonitorStatusToId",
    referencedTable: "MonitorStatus",
    orderColumn: "priority",
    roleColumns: MONITOR_STATUS_ROLES,
    isNullable: true,
  },
  {
    table: "IncidentEpisode",
    column: "currentIncidentStateId",
    referencedTable: "IncidentState",
    orderColumn: "order",
    roleColumns: INCIDENT_STATE_ROLES,
    isNullable: false,
  },
  {
    table: "IncidentEpisode",
    column: "incidentSeverityId",
    referencedTable: "IncidentSeverity",
    orderColumn: "order",
    roleColumns: [],
    isNullable: true,
  },
  {
    table: "IncidentStateTimeline",
    column: "incidentStateId",
    referencedTable: "IncidentState",
    orderColumn: "order",
    roleColumns: INCIDENT_STATE_ROLES,
    isNullable: false,
  },
  {
    table: "IncidentEpisodeStateTimeline",
    column: "incidentStateId",
    referencedTable: "IncidentState",
    orderColumn: "order",
    roleColumns: INCIDENT_STATE_ROLES,
    isNullable: false,
  },
  {
    table: "IncidentTemplate",
    column: "initialIncidentStateId",
    referencedTable: "IncidentState",
    orderColumn: "order",
    roleColumns: INCIDENT_STATE_ROLES,
    isNullable: true,
  },
  {
    table: "IncidentTemplate",
    column: "incidentSeverityId",
    referencedTable: "IncidentSeverity",
    orderColumn: "order",
    roleColumns: [],
    isNullable: true,
  },
  {
    table: "IncidentTemplate",
    column: "changeMonitorStatusToId",
    referencedTable: "MonitorStatus",
    orderColumn: "priority",
    roleColumns: MONITOR_STATUS_ROLES,
    isNullable: true,
  },
  {
    table: "Alert",
    column: "currentAlertStateId",
    referencedTable: "AlertState",
    orderColumn: "order",
    roleColumns: ALERT_STATE_ROLES,
    isNullable: false,
  },
  {
    table: "Alert",
    column: "alertSeverityId",
    referencedTable: "AlertSeverity",
    orderColumn: "order",
    roleColumns: [],
    isNullable: false,
  },
  {
    table: "Alert",
    column: "monitorStatusWhenThisAlertWasCreatedId",
    referencedTable: "MonitorStatus",
    orderColumn: "priority",
    roleColumns: MONITOR_STATUS_ROLES,
    isNullable: true,
  },
  {
    table: "AlertEpisode",
    column: "currentAlertStateId",
    referencedTable: "AlertState",
    orderColumn: "order",
    roleColumns: ALERT_STATE_ROLES,
    isNullable: false,
  },
  {
    table: "AlertEpisode",
    column: "alertSeverityId",
    referencedTable: "AlertSeverity",
    orderColumn: "order",
    roleColumns: [],
    isNullable: true,
  },
  {
    table: "AlertStateTimeline",
    column: "alertStateId",
    referencedTable: "AlertState",
    orderColumn: "order",
    roleColumns: ALERT_STATE_ROLES,
    isNullable: false,
  },
  {
    table: "AlertEpisodeStateTimeline",
    column: "alertStateId",
    referencedTable: "AlertState",
    orderColumn: "order",
    roleColumns: ALERT_STATE_ROLES,
    isNullable: false,
  },
  {
    table: "ScheduledMaintenance",
    column: "currentScheduledMaintenanceStateId",
    referencedTable: "ScheduledMaintenanceState",
    orderColumn: "order",
    roleColumns: SCHEDULED_MAINTENANCE_STATE_ROLES,
    isNullable: false,
  },
  {
    table: "ScheduledMaintenance",
    column: "changeMonitorStatusToId",
    referencedTable: "MonitorStatus",
    orderColumn: "priority",
    roleColumns: MONITOR_STATUS_ROLES,
    isNullable: true,
  },
  {
    table: "ScheduledMaintenanceStateTimeline",
    column: "scheduledMaintenanceStateId",
    referencedTable: "ScheduledMaintenanceState",
    orderColumn: "order",
    roleColumns: SCHEDULED_MAINTENANCE_STATE_ROLES,
    isNullable: false,
  },
  {
    table: "ScheduledMaintenanceTemplate",
    column: "changeMonitorStatusToId",
    referencedTable: "MonitorStatus",
    orderColumn: "priority",
    roleColumns: MONITOR_STATUS_ROLES,
    isNullable: true,
  },
];

interface TimelineForeignKey {
  table: string;
  column: string;
  referencedTable: string;
  constraintName: string;
}

/*
 * A state timeline row records "this incident/alert/event was in this state at
 * this time". Once the state is deleted the row cannot be read back, so it
 * should go with it rather than block the delete. This mirrors what
 * 1785240000000 did for MonitorStatusTimeline.
 */
export const TIMELINE_FOREIGN_KEYS: Array<TimelineForeignKey> = [
  {
    table: "IncidentStateTimeline",
    column: "incidentStateId",
    referencedTable: "IncidentState",
    constraintName: "FK_ff0fca6570d47798771763533a9",
  },
  {
    table: "IncidentEpisodeStateTimeline",
    column: "incidentStateId",
    referencedTable: "IncidentState",
    constraintName: "FK_186ef9a3c668841b1286cbb18fc",
  },
  {
    table: "AlertStateTimeline",
    column: "alertStateId",
    referencedTable: "AlertState",
    constraintName: "FK_dbf0191a98672bcb73f65febac5",
  },
  {
    table: "AlertEpisodeStateTimeline",
    column: "alertStateId",
    referencedTable: "AlertState",
    constraintName: "FK_c787c0bc5a12b94976f28d0a12c",
  },
  {
    table: "ScheduledMaintenanceStateTimeline",
    column: "scheduledMaintenanceStateId",
    referencedTable: "ScheduledMaintenanceState",
    constraintName: "FK_7c0f750d3a964180d1e1efa16ea",
  },
];

/*
 * Repoints rows whose reference belongs to another project at the equivalent
 * record in their own project. Match order is name, then role flags, then
 * nearest order/priority — the same ladder the 1785240000000 migration used.
 */
export function getRepairQuery(reference: CrossProjectReference): string {
  const roleSelect: string = reference.roleColumns
    .map((roleColumn: string) => {
      return `,\n               p."${roleColumn}" AS role_${roleColumn}`;
    })
    .join("");

  const roleMatch: string =
    reference.roleColumns.length > 0
      ? `
          (SELECT x."_id" FROM "${reference.referencedTable}" x
            WHERE x."projectId" = b.project_id
              AND ${reference.roleColumns
                .map((roleColumn: string) => {
                  return `x."${roleColumn}" = b.role_${roleColumn}`;
                })
                .join("\n              AND ")}
            ORDER BY x."${reference.orderColumn}" LIMIT 1),`
      : "";

  return `
      WITH bad AS (
        SELECT c."_id" AS row_id,
               c."projectId" AS project_id,
               p."name" AS ref_name,
               p."${reference.orderColumn}" AS ref_order${roleSelect}
        FROM "${reference.table}" c
        JOIN "${reference.referencedTable}" p ON p."_id" = c."${reference.column}"
        WHERE c."projectId" IS DISTINCT FROM p."projectId"
      ), resolved AS (
        SELECT b.row_id, COALESCE(
          (SELECT x."_id" FROM "${reference.referencedTable}" x
            WHERE x."projectId" = b.project_id AND lower(x."name") = lower(b.ref_name)
            ORDER BY x."${reference.orderColumn}" LIMIT 1),${roleMatch}
          (SELECT x."_id" FROM "${reference.referencedTable}" x
            WHERE x."projectId" = b.project_id
            ORDER BY abs(x."${reference.orderColumn}" - b.ref_order), x."${reference.orderColumn}" LIMIT 1)
        ) AS good_id
        FROM bad b
      )
      UPDATE "${reference.table}" c
      SET "${reference.column}" = r.good_id
      FROM resolved r
      WHERE c."_id" = r.row_id AND r.good_id IS NOT NULL
    `;
}

/*
 * Clears whatever the repair above could not repoint. Only runs for nullable
 * columns; leaving a dangling cross-project id there would keep the referenced
 * project undeletable for no benefit — the reference cannot be read by the
 * project that owns the row anyway.
 */
export function getClearQuery(reference: CrossProjectReference): string {
  return `
      UPDATE "${reference.table}" c
      SET "${reference.column}" = NULL
      FROM "${reference.referencedTable}" p
      WHERE p."_id" = c."${reference.column}"
        AND c."projectId" IS DISTINCT FROM p."projectId"
    `;
}

export class RepairCrossProjectIncidentReferences1785320000000
  implements MigrationInterface
{
  public name: string = "RepairCrossProjectIncidentReferences1785320000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * The repairs below scan the incident/alert/timeline tables, which run to
     * millions of rows. The connection carries the app's 30s statement_timeout
     * (DATABASE_STATEMENT_TIMEOUT_MS) and a loaded database should not turn
     * this into a failed deploy.
     */
    await queryRunner.query(`SET LOCAL statement_timeout = '600s'`);

    for (const reference of CROSS_PROJECT_REFERENCES) {
      await queryRunner.query(getRepairQuery(reference));

      if (reference.isNullable) {
        await queryRunner.query(getClearQuery(reference));
      }
    }

    /*
     * Swapping a foreign key needs ACCESS EXCLUSIVE on the timeline table, and
     * the lock is held until this migration commits. The server has no
     * lock_timeout, so without the line below a single slow transaction
     * holding one of these tables would make the statement queue *and* park
     * every reader and writer behind it until the 30s statement_timeout fired.
     * Failing fast and retrying the deploy is much cheaper than stalling the
     * table.
     */
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    for (const foreignKey of TIMELINE_FOREIGN_KEYS) {
      await queryRunner.query(
        `ALTER TABLE "${foreignKey.table}" DROP CONSTRAINT "${foreignKey.constraintName}"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${foreignKey.table}" ADD CONSTRAINT "${foreignKey.constraintName}" FOREIGN KEY ("${foreignKey.column}") REFERENCES "${foreignKey.referencedTable}"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      );
    }
  }

  /*
   * Only the constraints are reversible. The repaired references are not: the
   * previous values pointed at another project's records and there is nothing
   * worth restoring them to.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const foreignKey of TIMELINE_FOREIGN_KEYS) {
      await queryRunner.query(
        `ALTER TABLE "${foreignKey.table}" DROP CONSTRAINT "${foreignKey.constraintName}"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${foreignKey.table}" ADD CONSTRAINT "${foreignKey.constraintName}" FOREIGN KEY ("${foreignKey.column}") REFERENCES "${foreignKey.referencedTable}"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
      );
    }
  }
}
