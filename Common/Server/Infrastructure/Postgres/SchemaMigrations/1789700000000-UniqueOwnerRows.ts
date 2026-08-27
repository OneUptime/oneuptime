import { MigrationInterface, QueryRunner } from "typeorm";

export class UniqueOwnerRows1789700000000 implements MigrationInterface {
  public name: string = "UniqueOwnerRows1789700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * Collapse pre-existing duplicate owner rows before the partial unique
     * indexes below can be built. The index DDL is generated
     * (npm run generate-postgres-migration); this repair is not, and cannot
     * be -- the generator only diffs schema, it never repairs data. Without
     * it, CREATE UNIQUE INDEX aborts with "could not create unique index" on
     * every database that accumulated duplicates through the API, a workflow
     * or addOwners -- exactly the population issue #3394 is about -- and the
     * deployment cannot migrate at all.
     *
     * Same shape as migration 1786200000000 (RestoreDroppedUniqueIndexes),
     * and non-destructive for the same reason: the losing duplicates are
     * SOFT-deleted, which removes them from a partial index without
     * destroying anything. The oldest live row per (resource, owner,
     * project) survives -- it is the one whose owner notification already
     * fired and whose feed entry readers have seen -- with _id breaking
     * exact createdAt ties so the outcome is deterministic. Rows that are
     * already soft-deleted are not touched.
     */
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "kubernetesClusterId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "KubernetesClusterOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "KubernetesClusterOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "kubernetesClusterId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "KubernetesClusterOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "KubernetesClusterOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "networkDeviceId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "NetworkDeviceOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "NetworkDeviceOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "networkDeviceId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "NetworkDeviceOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "NetworkDeviceOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "dockerHostId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "DockerHostOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "DockerHostOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "dockerHostId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "DockerHostOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "DockerHostOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "podmanHostId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "PodmanHostOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "PodmanHostOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "podmanHostId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "PodmanHostOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "PodmanHostOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "proxmoxClusterId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "ProxmoxClusterOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "ProxmoxClusterOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "dockerSwarmClusterId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "DockerSwarmClusterOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "DockerSwarmClusterOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "proxmoxClusterId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "ProxmoxClusterOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "ProxmoxClusterOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "dockerSwarmClusterId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "DockerSwarmClusterOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "DockerSwarmClusterOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "iotFleetId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "IoTFleetOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "IoTFleetOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "iotFleetId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "IoTFleetOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "IoTFleetOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "cephClusterId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "CephClusterOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "CephClusterOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "cephClusterId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "CephClusterOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "CephClusterOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "hostId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "HostOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "HostOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "hostId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "HostOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "HostOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "serverlessFunctionId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "ServerlessFunctionOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "ServerlessFunctionOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "serverlessFunctionId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "ServerlessFunctionOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "ServerlessFunctionOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "cloudResourceId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "CloudResourceOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "CloudResourceOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "cloudResourceId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "CloudResourceOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "CloudResourceOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "rumApplicationId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "RumApplicationOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "RumApplicationOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "rumApplicationId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "RumApplicationOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "RumApplicationOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "incidentId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "IncidentOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "IncidentOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "incidentId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "IncidentOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "IncidentOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "incidentTemplateId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "IncidentTemplateOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "IncidentTemplateOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "incidentTemplateId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "IncidentTemplateOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "IncidentTemplateOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "monitorGroupId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "MonitorGroupOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "MonitorGroupOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "monitorGroupId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "MonitorGroupOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "MonitorGroupOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "monitorId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "MonitorOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "MonitorOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "monitorId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "MonitorOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "MonitorOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "onCallDutyPolicyId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "OnCallDutyPolicyOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "OnCallDutyPolicyOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "onCallDutyPolicyId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "OnCallDutyPolicyOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "OnCallDutyPolicyOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "onCallDutyPolicyScheduleId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "OnCallDutyPolicyScheduleOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "OnCallDutyPolicyScheduleOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "onCallDutyPolicyScheduleId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "OnCallDutyPolicyScheduleOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "OnCallDutyPolicyScheduleOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "incomingCallPolicyId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "IncomingCallPolicyOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "IncomingCallPolicyOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "incomingCallPolicyId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "IncomingCallPolicyOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "IncomingCallPolicyOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "probeId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "ProbeOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "ProbeOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "probeId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "ProbeOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "ProbeOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "aiAgentId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "AIAgentOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "AIAgentOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "aiAgentId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "AIAgentOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "AIAgentOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "scheduledMaintenanceId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "ScheduledMaintenanceOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "ScheduledMaintenanceOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "scheduledMaintenanceId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "ScheduledMaintenanceOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "ScheduledMaintenanceOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "serviceId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "ServiceOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "ServiceOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "serviceId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "ServiceOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "ServiceOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "statusPageId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "StatusPageOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "StatusPageOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "statusPageId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "StatusPageOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "StatusPageOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "workflowId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "WorkflowOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "WorkflowOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "workflowId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "WorkflowOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "WorkflowOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "runnerId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "RunnerOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "RunnerOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "runnerId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "RunnerOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "RunnerOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "runbookId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "RunbookOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "RunbookOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "runbookId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "RunbookOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "RunbookOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "scheduledMaintenanceTemplateId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "ScheduledMaintenanceTemplateOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "ScheduledMaintenanceTemplateOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "scheduledMaintenanceTemplateId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "ScheduledMaintenanceTemplateOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "ScheduledMaintenanceTemplateOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "alertId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "AlertOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "AlertOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "alertId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "AlertOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "AlertOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "alertEpisodeId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "AlertEpisodeOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "AlertEpisodeOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "alertEpisodeId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "AlertEpisodeOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "AlertEpisodeOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "incidentEpisodeId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "IncidentEpisodeOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "IncidentEpisodeOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "incidentEpisodeId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "IncidentEpisodeOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "IncidentEpisodeOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "serviceLevelObjectiveId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "ServiceLevelObjectiveOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "ServiceLevelObjectiveOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "serviceLevelObjectiveId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "ServiceLevelObjectiveOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "ServiceLevelObjectiveOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "dashboardId", "teamId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "DashboardOwnerTeam"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "DashboardOwnerTeam" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);
    await queryRunner.query(`
            WITH ranked AS (
              SELECT _id,
                     ROW_NUMBER() OVER (
                       PARTITION BY "dashboardId", "userId", "projectId"
                       ORDER BY "createdAt" ASC, _id ASC
                     ) AS rn
              FROM "DashboardOwnerUser"
              WHERE "deletedAt" IS NULL
            )
            UPDATE "DashboardOwnerUser" t
            SET "deletedAt" = CURRENT_TIMESTAMP
            FROM ranked r
            WHERE t._id = r._id AND r.rn > 1;
        `);

    await queryRunner.query(
      `DROP INDEX "public"."IDX_4490b10d3394a9be5f27f8fc3b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1d8d2229e31e4ec13ec99c79ae"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7b7272644aab237d503ed3429a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6f6246149ab744fd62ada06ee5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_34f21c8ae164fb90be806818a8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1539db4bbd6ada58abb940b058"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_377b22d5ffc7f1e3d5085a27ea"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_abc604b71465bc5579525ff256"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3c8d9da5d5cd959c953094653b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9f9eff007b40602f856803c50a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b737666365dbea2e4c914fc6d3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a4621b7155a01292b92569549f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4873976169085f14bdc39e168d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a9f80dc4f648f0957ce695dc61"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_23cb5a85c555d015abb14021bd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9a2480665e9ab79bef464a8c57"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5144d0de37b0f040ca2d71abad"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3a5b7e91e8b9ee59041517906c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7b57159bdf315d24ac3116739c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d02f1b9d7f33e124ca2deda720"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dfbcaebaa02d06a556fd2e155c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_042a7841d65141fb940de9d881"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_79c03a537d5c1f4dbeb8beb355"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_74c82db90ec03c884ba9da813a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c715213fcbbb6e127c939e77d5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f9aa734977a4131f79216083e2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_be7506765e639c732a90783147"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_53e4404ae86c9de055cf1dee02"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b4fd29eeca8c655246fc86e6ba"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8a02ec21317c3701dbab53e43d"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_865b81f35346e239b9b1e3bcc6" ON "KubernetesClusterOwnerTeam" ("kubernetesClusterId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_1c2251e0c1bf466be4982d84b4" ON "KubernetesClusterOwnerUser" ("kubernetesClusterId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ef1c71933aabfd2dea888949c8" ON "NetworkDeviceOwnerTeam" ("networkDeviceId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_2031f1a22af9fa00e790b4314b" ON "NetworkDeviceOwnerUser" ("networkDeviceId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c73e986908f5497e062ba657ab" ON "DockerHostOwnerTeam" ("dockerHostId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_bc1aca056c614072d75a49b338" ON "DockerHostOwnerUser" ("dockerHostId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_88a5300630cd11445cef4ed5fb" ON "PodmanHostOwnerTeam" ("podmanHostId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_4a291184380cc883ae6244c81a" ON "PodmanHostOwnerUser" ("podmanHostId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_96a30aa4d5a951d1e3d5f10b61" ON "ProxmoxClusterOwnerTeam" ("proxmoxClusterId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_23283272f167f17eefd0650b4d" ON "DockerSwarmClusterOwnerTeam" ("dockerSwarmClusterId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_084ebb6a80d3ce45d79cfade92" ON "ProxmoxClusterOwnerUser" ("proxmoxClusterId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_7762836757f6168f8159f13d29" ON "DockerSwarmClusterOwnerUser" ("dockerSwarmClusterId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c85efe5e48ec0a11917fbb53aa" ON "IoTFleetOwnerTeam" ("iotFleetId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_a8186b5ec054f68182ca723f01" ON "IoTFleetOwnerUser" ("iotFleetId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d8036179d8507297d56aa5c606" ON "CephClusterOwnerTeam" ("cephClusterId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_eb3b6445089563708cca9017f2" ON "CephClusterOwnerUser" ("cephClusterId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_bdd7f7f9c4796ac94f9ffad8e8" ON "HostOwnerTeam" ("hostId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_75fbea9a013816d0ec5a7887ed" ON "HostOwnerUser" ("hostId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_7c269f95242dda3fdb37766940" ON "ServerlessFunctionOwnerTeam" ("serverlessFunctionId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_f17e635fb31b6efbb7af87c9be" ON "ServerlessFunctionOwnerUser" ("serverlessFunctionId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_f1b3d217d8efeb46fe80f45f72" ON "CloudResourceOwnerTeam" ("cloudResourceId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_e5e091ca8da77e62e1725b8d9c" ON "CloudResourceOwnerUser" ("cloudResourceId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b1844e02d66691c289588eab43" ON "RumApplicationOwnerTeam" ("rumApplicationId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_5be027266f3e0dc63cbf0324d3" ON "RumApplicationOwnerUser" ("rumApplicationId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d2115863c8a5962ac3870ba79f" ON "IncidentOwnerTeam" ("incidentId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b92f36ef33391a8e286d148215" ON "IncidentOwnerUser" ("incidentId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_71ca90c96fcc65d468c1021f32" ON "IncidentTemplateOwnerTeam" ("incidentTemplateId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d8822474cb9abc675b5c8a0f42" ON "IncidentTemplateOwnerUser" ("incidentTemplateId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ea0ed7b9699fac94c529b9e2d2" ON "MonitorGroupOwnerTeam" ("monitorGroupId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_14375c1fea64c124ad0f9468a5" ON "MonitorGroupOwnerUser" ("monitorGroupId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_af468ad876b540a8e479987216" ON "MonitorOwnerTeam" ("monitorId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_5e6e3c8c2d85f5c77f82fbd50d" ON "MonitorOwnerUser" ("monitorId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_1611656bda2d859bdeb298a54f" ON "OnCallDutyPolicyOwnerTeam" ("onCallDutyPolicyId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_10d2571f4ed45e8fc6d64feac6" ON "OnCallDutyPolicyOwnerUser" ("onCallDutyPolicyId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d72037da0855df4d8c1fb0169d" ON "OnCallDutyPolicyScheduleOwnerTeam" ("onCallDutyPolicyScheduleId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_cd553e55d2d108b8467aaec365" ON "OnCallDutyPolicyScheduleOwnerUser" ("onCallDutyPolicyScheduleId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_efeb7b57535cdf2dcea0894b18" ON "IncomingCallPolicyOwnerTeam" ("incomingCallPolicyId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_6afd1c0f10a9516180e93f6a23" ON "IncomingCallPolicyOwnerUser" ("incomingCallPolicyId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_16c4488d05cff9d1000e94f44f" ON "ProbeOwnerTeam" ("probeId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_fb97120fb342dea1f83835e8b2" ON "ProbeOwnerUser" ("probeId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_15ac3bec6afcde9ba1f2ae04ab" ON "AIAgentOwnerTeam" ("aiAgentId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_650a7ca9d791e3ac62ec55d0b7" ON "AIAgentOwnerUser" ("aiAgentId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_347f931c79b61f9766481ec9ca" ON "ScheduledMaintenanceOwnerTeam" ("scheduledMaintenanceId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_f6aee9ca489df06fdb72195efa" ON "ScheduledMaintenanceOwnerUser" ("scheduledMaintenanceId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d08c8855659f104ad677bd2cda" ON "ServiceOwnerTeam" ("serviceId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b60c7bddfb1fbb462c0d008407" ON "ServiceOwnerUser" ("serviceId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_823e03977f0cffc76b7be38304" ON "StatusPageOwnerTeam" ("statusPageId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_7e362bc0b24b25ea1f71b779e6" ON "StatusPageOwnerUser" ("statusPageId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b4226532048176b5aaf4003345" ON "WorkflowOwnerTeam" ("workflowId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ee865f6cb47cbf7a41d47d4f9a" ON "WorkflowOwnerUser" ("workflowId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_1f8ffc44c43234a39c10cd2f4c" ON "RunnerOwnerTeam" ("runnerId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_f848489f65f60fb544e3d5bba7" ON "RunnerOwnerUser" ("runnerId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_bcfb0a89973c572844242d5030" ON "RunbookOwnerTeam" ("runbookId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_1d83224047df629fe40d449185" ON "RunbookOwnerUser" ("runbookId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d78f74a3089a7c6f63baadd89f" ON "ScheduledMaintenanceTemplateOwnerTeam" ("scheduledMaintenanceTemplateId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_2e6e571e72a074626e47c80e7d" ON "ScheduledMaintenanceTemplateOwnerUser" ("scheduledMaintenanceTemplateId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_04ed574ea6f15a69b0167dfd11" ON "AlertOwnerTeam" ("alertId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_eaa791805ff1dcd5debcbc3837" ON "AlertOwnerUser" ("alertId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_153223959b246ea76e172d7a44" ON "AlertEpisodeOwnerUser" ("alertEpisodeId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_7032c4235fc72909e1a29d6b92" ON "AlertEpisodeOwnerTeam" ("alertEpisodeId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_51bcbebfc1f06cea77ba1800eb" ON "IncidentEpisodeOwnerUser" ("incidentEpisodeId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_e5c4ecb3d1c6c592300e1bc1b2" ON "IncidentEpisodeOwnerTeam" ("incidentEpisodeId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_15d8153112a0122c7c1b3fad67" ON "ServiceLevelObjectiveOwnerUser" ("serviceLevelObjectiveId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_f10fe142c05811c24ae581d267" ON "ServiceLevelObjectiveOwnerTeam" ("serviceLevelObjectiveId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b02145b2e7f509e9eb741b95de" ON "DashboardOwnerTeam" ("dashboardId", "teamId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_21d5ee2d81bdeba6a3bb8497f4" ON "DashboardOwnerUser" ("dashboardId", "userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * Only the indexes are reversible. The repair is not: a soft-deleted
     * duplicate cannot be distinguished afterwards from one the application
     * produced, and guessing would corrupt live data. Dropping the unique
     * indexes and restoring the original plain composites is enough to
     * restore the previous schema shape.
     *
     * NOTE: TypeORM generated these restore statements with their columns
     * REVERSED (e.g. ("projectId", "teamId", "incidentId") for an index that
     * is ("incidentId", "teamId", "projectId")). A btree only serves a
     * leading-column prefix, so that is not a rollback -- it silently drops
     * the lookups the original index served. Each column list below was
     * corrected against the live pre-migration schema.
     */
    await queryRunner.query(
      `DROP INDEX "public"."IDX_21d5ee2d81bdeba6a3bb8497f4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b02145b2e7f509e9eb741b95de"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f10fe142c05811c24ae581d267"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_15d8153112a0122c7c1b3fad67"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e5c4ecb3d1c6c592300e1bc1b2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_51bcbebfc1f06cea77ba1800eb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7032c4235fc72909e1a29d6b92"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_153223959b246ea76e172d7a44"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eaa791805ff1dcd5debcbc3837"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_04ed574ea6f15a69b0167dfd11"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2e6e571e72a074626e47c80e7d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d78f74a3089a7c6f63baadd89f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1d83224047df629fe40d449185"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bcfb0a89973c572844242d5030"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f848489f65f60fb544e3d5bba7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1f8ffc44c43234a39c10cd2f4c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ee865f6cb47cbf7a41d47d4f9a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b4226532048176b5aaf4003345"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7e362bc0b24b25ea1f71b779e6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_823e03977f0cffc76b7be38304"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b60c7bddfb1fbb462c0d008407"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d08c8855659f104ad677bd2cda"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f6aee9ca489df06fdb72195efa"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_347f931c79b61f9766481ec9ca"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_650a7ca9d791e3ac62ec55d0b7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_15ac3bec6afcde9ba1f2ae04ab"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fb97120fb342dea1f83835e8b2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_16c4488d05cff9d1000e94f44f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6afd1c0f10a9516180e93f6a23"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_efeb7b57535cdf2dcea0894b18"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cd553e55d2d108b8467aaec365"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d72037da0855df4d8c1fb0169d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_10d2571f4ed45e8fc6d64feac6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1611656bda2d859bdeb298a54f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5e6e3c8c2d85f5c77f82fbd50d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_af468ad876b540a8e479987216"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_14375c1fea64c124ad0f9468a5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ea0ed7b9699fac94c529b9e2d2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d8822474cb9abc675b5c8a0f42"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_71ca90c96fcc65d468c1021f32"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b92f36ef33391a8e286d148215"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d2115863c8a5962ac3870ba79f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5be027266f3e0dc63cbf0324d3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b1844e02d66691c289588eab43"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e5e091ca8da77e62e1725b8d9c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f1b3d217d8efeb46fe80f45f72"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f17e635fb31b6efbb7af87c9be"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7c269f95242dda3fdb37766940"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_75fbea9a013816d0ec5a7887ed"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bdd7f7f9c4796ac94f9ffad8e8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eb3b6445089563708cca9017f2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d8036179d8507297d56aa5c606"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a8186b5ec054f68182ca723f01"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c85efe5e48ec0a11917fbb53aa"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7762836757f6168f8159f13d29"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_084ebb6a80d3ce45d79cfade92"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_23283272f167f17eefd0650b4d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_96a30aa4d5a951d1e3d5f10b61"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4a291184380cc883ae6244c81a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_88a5300630cd11445cef4ed5fb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bc1aca056c614072d75a49b338"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c73e986908f5497e062ba657ab"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2031f1a22af9fa00e790b4314b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ef1c71933aabfd2dea888949c8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1c2251e0c1bf466be4982d84b4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_865b81f35346e239b9b1e3bcc6"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8a02ec21317c3701dbab53e43d" ON "DashboardOwnerUser" ("dashboardId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b4fd29eeca8c655246fc86e6ba" ON "DashboardOwnerTeam" ("dashboardId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_53e4404ae86c9de055cf1dee02" ON "ServiceLevelObjectiveOwnerTeam" ("serviceLevelObjectiveId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_be7506765e639c732a90783147" ON "ServiceLevelObjectiveOwnerUser" ("serviceLevelObjectiveId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f9aa734977a4131f79216083e2" ON "IncidentEpisodeOwnerTeam" ("incidentEpisodeId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c715213fcbbb6e127c939e77d5" ON "IncidentEpisodeOwnerUser" ("incidentEpisodeId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_74c82db90ec03c884ba9da813a" ON "AlertEpisodeOwnerTeam" ("alertEpisodeId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_79c03a537d5c1f4dbeb8beb355" ON "AlertEpisodeOwnerUser" ("alertEpisodeId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_042a7841d65141fb940de9d881" ON "AlertOwnerUser" ("alertId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dfbcaebaa02d06a556fd2e155c" ON "AlertOwnerTeam" ("alertId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d02f1b9d7f33e124ca2deda720" ON "RunbookOwnerUser" ("runbookId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7b57159bdf315d24ac3116739c" ON "RunbookOwnerTeam" ("runbookId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3a5b7e91e8b9ee59041517906c" ON "RunnerOwnerUser" ("runnerId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5144d0de37b0f040ca2d71abad" ON "RunnerOwnerTeam" ("runnerId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9a2480665e9ab79bef464a8c57" ON "WorkflowOwnerUser" ("workflowId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_23cb5a85c555d015abb14021bd" ON "WorkflowOwnerTeam" ("workflowId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a9f80dc4f648f0957ce695dc61" ON "StatusPageOwnerUser" ("statusPageId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4873976169085f14bdc39e168d" ON "StatusPageOwnerTeam" ("statusPageId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a4621b7155a01292b92569549f" ON "ScheduledMaintenanceOwnerUser" ("scheduledMaintenanceId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b737666365dbea2e4c914fc6d3" ON "ScheduledMaintenanceOwnerTeam" ("scheduledMaintenanceId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9f9eff007b40602f856803c50a" ON "IncomingCallPolicyOwnerUser" ("incomingCallPolicyId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3c8d9da5d5cd959c953094653b" ON "IncomingCallPolicyOwnerTeam" ("incomingCallPolicyId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_abc604b71465bc5579525ff256" ON "OnCallDutyPolicyScheduleOwnerUser" ("onCallDutyPolicyScheduleId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_377b22d5ffc7f1e3d5085a27ea" ON "OnCallDutyPolicyScheduleOwnerTeam" ("onCallDutyPolicyScheduleId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1539db4bbd6ada58abb940b058" ON "OnCallDutyPolicyOwnerUser" ("onCallDutyPolicyId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_34f21c8ae164fb90be806818a8" ON "OnCallDutyPolicyOwnerTeam" ("onCallDutyPolicyId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6f6246149ab744fd62ada06ee5" ON "MonitorOwnerUser" ("monitorId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7b7272644aab237d503ed3429a" ON "MonitorOwnerTeam" ("monitorId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1d8d2229e31e4ec13ec99c79ae" ON "IncidentOwnerUser" ("incidentId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4490b10d3394a9be5f27f8fc3b" ON "IncidentOwnerTeam" ("incidentId", "teamId", "projectId") `,
    );
  }
}
