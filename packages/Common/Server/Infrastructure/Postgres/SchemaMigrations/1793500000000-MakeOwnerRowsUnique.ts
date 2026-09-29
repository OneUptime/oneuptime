import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Makes owner rows unique: one <Resource>OwnerTeam row per (resource, team,
 * project) and one <Resource>OwnerUser row per (resource, user, project).
 * https://github.com/OneUptime/oneuptime/issues/3394
 *
 * Only the dashboard used to prevent a second row for the same owner. The
 * REST API, workflows, monitor criteria and the other internal paths inserted
 * unconditionally, and every row fires its own feed item and owner
 * notification - so a duplicate row was a duplicate notification.
 *
 * The composite index these tables already had (or, on the 38 that had none,
 * a new one on the same columns) is now UNIQUE. The index statements below
 * are what generate-postgres-migration produced (down() aside - see there),
 * and the entities declare the indexes with `{ unique: true }`, so TypeORM
 * keeps owning them.
 *
 * NOT PARTIAL
 *
 * Owner rows are hard-deleted (DatabaseService.deleteBy uses
 * repository.delete), so no soft-deleted row can hold an owner slot hostage,
 * and a plain unique index is expressible in @Index - unlike the partial
 * indexes in migration 1786200000000, which had to be hand-owned.
 *
 * REPAIR BEFORE CREATE
 *
 * A unique index cannot be built over existing duplicates, so each table is
 * repaired first. Within a group of duplicates exactly one row survives:
 *
 *   1. a live row over a soft-deleted one,
 *   2. then a row whose owner was already notified over one still waiting to
 *      be - the owner-added job notifies every row still at
 *      isOwnerNotified = false, so keeping a pending duplicate of an owner
 *      who was already told would tell them again,
 *   3. then the oldest (createdAt, then _id), so the result is deterministic.
 *
 * The others are DELETED. The index covers every row, so a soft delete would
 * not take a row out of it. Nothing references an owner row by foreign key,
 * so the delete cascades nowhere; the surviving row still records the same
 * owner of the same resource. A table with no duplicates is left untouched.
 *
 * The groups are found with one GROUP BY per table before any row is ranked,
 * so the tables that hold no duplicates - nearly all of them - are only
 * scanned once.
 */

interface OwnerTable {
  table: string;
  // resource id, owner id, project id - the columns of the unique index.
  columns: Array<string>;
  hasIsOwnerNotified: boolean;
}

const OWNER_TABLES: Array<OwnerTable> = [
  {
    table: "AIAgentOwnerTeam",
    columns: ["aiAgentId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "AIAgentOwnerUser",
    columns: ["aiAgentId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "AlertEpisodeOwnerTeam",
    columns: ["alertEpisodeId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "AlertEpisodeOwnerUser",
    columns: ["alertEpisodeId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "AlertOwnerTeam",
    columns: ["alertId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "AlertOwnerUser",
    columns: ["alertId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "CephClusterOwnerTeam",
    columns: ["cephClusterId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "CephClusterOwnerUser",
    columns: ["cephClusterId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "CloudResourceOwnerTeam",
    columns: ["cloudResourceId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "CloudResourceOwnerUser",
    columns: ["cloudResourceId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "DashboardOwnerTeam",
    columns: ["dashboardId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "DashboardOwnerUser",
    columns: ["dashboardId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "DockerHostOwnerTeam",
    columns: ["dockerHostId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "DockerHostOwnerUser",
    columns: ["dockerHostId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "DockerSwarmClusterOwnerTeam",
    columns: ["dockerSwarmClusterId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "DockerSwarmClusterOwnerUser",
    columns: ["dockerSwarmClusterId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "HostOwnerTeam",
    columns: ["hostId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "HostOwnerUser",
    columns: ["hostId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "IncidentEpisodeOwnerTeam",
    columns: ["incidentEpisodeId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "IncidentEpisodeOwnerUser",
    columns: ["incidentEpisodeId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "IncidentOwnerTeam",
    columns: ["incidentId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "IncidentOwnerUser",
    columns: ["incidentId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "IncidentTemplateOwnerTeam",
    columns: ["incidentTemplateId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "IncidentTemplateOwnerUser",
    columns: ["incidentTemplateId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "IncomingCallPolicyOwnerTeam",
    columns: ["incomingCallPolicyId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "IncomingCallPolicyOwnerUser",
    columns: ["incomingCallPolicyId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "IoTFleetOwnerTeam",
    columns: ["iotFleetId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "IoTFleetOwnerUser",
    columns: ["iotFleetId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "KubernetesClusterOwnerTeam",
    columns: ["kubernetesClusterId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "KubernetesClusterOwnerUser",
    columns: ["kubernetesClusterId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "MonitorGroupOwnerTeam",
    columns: ["monitorGroupId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "MonitorGroupOwnerUser",
    columns: ["monitorGroupId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "MonitorOwnerTeam",
    columns: ["monitorId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "MonitorOwnerUser",
    columns: ["monitorId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "NetworkDeviceOwnerTeam",
    columns: ["networkDeviceId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "NetworkDeviceOwnerUser",
    columns: ["networkDeviceId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "OnCallDutyPolicyOwnerTeam",
    columns: ["onCallDutyPolicyId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "OnCallDutyPolicyOwnerUser",
    columns: ["onCallDutyPolicyId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "OnCallDutyPolicyScheduleOwnerTeam",
    columns: ["onCallDutyPolicyScheduleId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "OnCallDutyPolicyScheduleOwnerUser",
    columns: ["onCallDutyPolicyScheduleId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "PodmanHostOwnerTeam",
    columns: ["podmanHostId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "PodmanHostOwnerUser",
    columns: ["podmanHostId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "ProbeOwnerTeam",
    columns: ["probeId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "ProbeOwnerUser",
    columns: ["probeId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "ProxmoxClusterOwnerTeam",
    columns: ["proxmoxClusterId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "ProxmoxClusterOwnerUser",
    columns: ["proxmoxClusterId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "RumApplicationOwnerTeam",
    columns: ["rumApplicationId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "RumApplicationOwnerUser",
    columns: ["rumApplicationId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "RunbookOwnerTeam",
    columns: ["runbookId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "RunbookOwnerUser",
    columns: ["runbookId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "RunnerOwnerTeam",
    columns: ["runnerId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "RunnerOwnerUser",
    columns: ["runnerId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "ScheduledMaintenanceOwnerTeam",
    columns: ["scheduledMaintenanceId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "ScheduledMaintenanceOwnerUser",
    columns: ["scheduledMaintenanceId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "ScheduledMaintenanceTemplateOwnerTeam",
    columns: ["scheduledMaintenanceTemplateId", "teamId", "projectId"],
    hasIsOwnerNotified: false,
  },
  {
    table: "ScheduledMaintenanceTemplateOwnerUser",
    columns: ["scheduledMaintenanceTemplateId", "userId", "projectId"],
    hasIsOwnerNotified: false,
  },
  {
    table: "ServerlessFunctionOwnerTeam",
    columns: ["serverlessFunctionId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "ServerlessFunctionOwnerUser",
    columns: ["serverlessFunctionId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "ServiceLevelObjectiveOwnerTeam",
    columns: ["serviceLevelObjectiveId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "ServiceLevelObjectiveOwnerUser",
    columns: ["serviceLevelObjectiveId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "ServiceOwnerTeam",
    columns: ["serviceId", "teamId", "projectId"],
    hasIsOwnerNotified: false,
  },
  {
    table: "ServiceOwnerUser",
    columns: ["serviceId", "userId", "projectId"],
    hasIsOwnerNotified: false,
  },
  {
    table: "StatusPageOwnerTeam",
    columns: ["statusPageId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "StatusPageOwnerUser",
    columns: ["statusPageId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "VMwareVCenterOwnerTeam",
    columns: ["vmwareVCenterId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "VMwareVCenterOwnerUser",
    columns: ["vmwareVCenterId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "WorkflowOwnerTeam",
    columns: ["workflowId", "teamId", "projectId"],
    hasIsOwnerNotified: true,
  },
  {
    table: "WorkflowOwnerUser",
    columns: ["workflowId", "userId", "projectId"],
    hasIsOwnerNotified: true,
  },
];

export class MakeOwnerRowsUnique1793500000000 implements MigrationInterface {
  public name: string = "MakeOwnerRowsUnique1793500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const ownerTable of OWNER_TABLES) {
      await this.deleteDuplicateOwners(queryRunner, ownerTable);
    }

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
      `CREATE UNIQUE INDEX "IDX_11c6b59fc829f8147d46bddd2b" ON "KubernetesClusterOwnerTeam" ("kubernetesClusterId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_7a3ab0c19695f86724009d0926" ON "KubernetesClusterOwnerUser" ("kubernetesClusterId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_110a58ade0d1744b8d6c832a1d" ON "NetworkDeviceOwnerTeam" ("networkDeviceId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_24546d5de391b1c6fcff074842" ON "NetworkDeviceOwnerUser" ("networkDeviceId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_44da1e8e6844ed0bb23c365487" ON "DockerHostOwnerTeam" ("dockerHostId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ce1b388e6e68733a35812b45fc" ON "DockerHostOwnerUser" ("dockerHostId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_0fe42310a08e84122c058d9a36" ON "PodmanHostOwnerTeam" ("podmanHostId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_27c39edd22d991939693b08963" ON "PodmanHostOwnerUser" ("podmanHostId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_e8255ffba6701a426fb6218bf5" ON "ProxmoxClusterOwnerTeam" ("proxmoxClusterId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b81360b62734aade7cd8942bc6" ON "DockerSwarmClusterOwnerTeam" ("dockerSwarmClusterId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_05e4e7a95b3bdb6de7523c4265" ON "ProxmoxClusterOwnerUser" ("proxmoxClusterId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_1b57f437aa7d183c103441eaf0" ON "DockerSwarmClusterOwnerUser" ("dockerSwarmClusterId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_274979c9c9f53857fdb9dd4add" ON "IoTFleetOwnerTeam" ("iotFleetId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_31ef8630b4fac368db98aab9a2" ON "IoTFleetOwnerUser" ("iotFleetId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_2c8bb7d2d9e0f69a70acdbb3b2" ON "CephClusterOwnerTeam" ("cephClusterId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_493141a06c1a0e8eb9338827c4" ON "CephClusterOwnerUser" ("cephClusterId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_9a6bd2017e0d9ad69c4a7cb83e" ON "VMwareVCenterOwnerTeam" ("vmwareVCenterId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_6f340ef127218ec4d0c50a7c87" ON "VMwareVCenterOwnerUser" ("vmwareVCenterId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_3f0e121832ab6eddcb165328e2" ON "HostOwnerTeam" ("hostId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_475d30964cfbe0040019345d16" ON "HostOwnerUser" ("hostId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_912ddc627eb4e8ca3f93a701c9" ON "ServerlessFunctionOwnerTeam" ("serverlessFunctionId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_f8efcb93010641cf8712bbd3f6" ON "ServerlessFunctionOwnerUser" ("serverlessFunctionId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_2eb4784b49cc7012fd8be34911" ON "CloudResourceOwnerTeam" ("cloudResourceId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_2956fbee991fc0eada674617d7" ON "CloudResourceOwnerUser" ("cloudResourceId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_24b4e231f58db2b6ff1df458b6" ON "RumApplicationOwnerTeam" ("rumApplicationId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d5b096e3c2b664829c4bf021d9" ON "RumApplicationOwnerUser" ("rumApplicationId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_4490b10d3394a9be5f27f8fc3b" ON "IncidentOwnerTeam" ("incidentId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_1d8d2229e31e4ec13ec99c79ae" ON "IncidentOwnerUser" ("incidentId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_5ea13ac7a467e4532d18881e71" ON "IncidentTemplateOwnerTeam" ("incidentTemplateId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_9f40fdc8d3b6da5ee7fa30c1fb" ON "IncidentTemplateOwnerUser" ("incidentTemplateId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_632005436db02ad442c7bcb634" ON "MonitorGroupOwnerTeam" ("monitorGroupId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_4ce33f4ec2b613851ec00d5ad9" ON "MonitorGroupOwnerUser" ("monitorGroupId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_7b7272644aab237d503ed3429a" ON "MonitorOwnerTeam" ("monitorId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_6f6246149ab744fd62ada06ee5" ON "MonitorOwnerUser" ("monitorId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_34f21c8ae164fb90be806818a8" ON "OnCallDutyPolicyOwnerTeam" ("onCallDutyPolicyId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_1539db4bbd6ada58abb940b058" ON "OnCallDutyPolicyOwnerUser" ("onCallDutyPolicyId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_377b22d5ffc7f1e3d5085a27ea" ON "OnCallDutyPolicyScheduleOwnerTeam" ("onCallDutyPolicyScheduleId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_abc604b71465bc5579525ff256" ON "OnCallDutyPolicyScheduleOwnerUser" ("onCallDutyPolicyScheduleId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_3c8d9da5d5cd959c953094653b" ON "IncomingCallPolicyOwnerTeam" ("incomingCallPolicyId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_9f9eff007b40602f856803c50a" ON "IncomingCallPolicyOwnerUser" ("incomingCallPolicyId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_e853141fb4c21e905ce36dc60f" ON "ProbeOwnerTeam" ("probeId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_eafc36eb1963f058440702fc6e" ON "ProbeOwnerUser" ("probeId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c1889b64104f9b28ef6228c12e" ON "AIAgentOwnerTeam" ("aiAgentId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_3847a3fc0f1f00a73622ca6369" ON "AIAgentOwnerUser" ("aiAgentId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b737666365dbea2e4c914fc6d3" ON "ScheduledMaintenanceOwnerTeam" ("scheduledMaintenanceId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_a4621b7155a01292b92569549f" ON "ScheduledMaintenanceOwnerUser" ("scheduledMaintenanceId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_3149703f26e38aaa65de2d2653" ON "ServiceOwnerTeam" ("serviceId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b65a160e622610345018d1eb0c" ON "ServiceOwnerUser" ("serviceId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_4873976169085f14bdc39e168d" ON "StatusPageOwnerTeam" ("statusPageId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_a9f80dc4f648f0957ce695dc61" ON "StatusPageOwnerUser" ("statusPageId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_23cb5a85c555d015abb14021bd" ON "WorkflowOwnerTeam" ("workflowId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_9a2480665e9ab79bef464a8c57" ON "WorkflowOwnerUser" ("workflowId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_5144d0de37b0f040ca2d71abad" ON "RunnerOwnerTeam" ("runnerId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_3a5b7e91e8b9ee59041517906c" ON "RunnerOwnerUser" ("runnerId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_7b57159bdf315d24ac3116739c" ON "RunbookOwnerTeam" ("runbookId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d02f1b9d7f33e124ca2deda720" ON "RunbookOwnerUser" ("runbookId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c916d6412aff8d51222300efc9" ON "ScheduledMaintenanceTemplateOwnerTeam" ("scheduledMaintenanceTemplateId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_881bd5d826e4f5ec3cba63760f" ON "ScheduledMaintenanceTemplateOwnerUser" ("scheduledMaintenanceTemplateId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_dfbcaebaa02d06a556fd2e155c" ON "AlertOwnerTeam" ("alertId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_042a7841d65141fb940de9d881" ON "AlertOwnerUser" ("alertId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_79c03a537d5c1f4dbeb8beb355" ON "AlertEpisodeOwnerUser" ("alertEpisodeId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_74c82db90ec03c884ba9da813a" ON "AlertEpisodeOwnerTeam" ("alertEpisodeId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c715213fcbbb6e127c939e77d5" ON "IncidentEpisodeOwnerUser" ("incidentEpisodeId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_f9aa734977a4131f79216083e2" ON "IncidentEpisodeOwnerTeam" ("incidentEpisodeId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_be7506765e639c732a90783147" ON "ServiceLevelObjectiveOwnerUser" ("serviceLevelObjectiveId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_53e4404ae86c9de055cf1dee02" ON "ServiceLevelObjectiveOwnerTeam" ("serviceLevelObjectiveId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b4fd29eeca8c655246fc86e6ba" ON "DashboardOwnerTeam" ("dashboardId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_8a02ec21317c3701dbab53e43d" ON "DashboardOwnerUser" ("dashboardId", "userId", "projectId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * Only the indexes are reversible. The duplicates removed in up() are
     * gone, and bringing them back would bring back the double notifications.
     *
     * The non-unique indexes are recreated in their original column order
     * (resource, owner, project). The generator lists the columns in table
     * order instead, which would not be the index that was dropped.
     */
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8a02ec21317c3701dbab53e43d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b4fd29eeca8c655246fc86e6ba"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_53e4404ae86c9de055cf1dee02"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_be7506765e639c732a90783147"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f9aa734977a4131f79216083e2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c715213fcbbb6e127c939e77d5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_74c82db90ec03c884ba9da813a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_79c03a537d5c1f4dbeb8beb355"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_042a7841d65141fb940de9d881"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dfbcaebaa02d06a556fd2e155c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_881bd5d826e4f5ec3cba63760f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c916d6412aff8d51222300efc9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d02f1b9d7f33e124ca2deda720"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7b57159bdf315d24ac3116739c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3a5b7e91e8b9ee59041517906c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5144d0de37b0f040ca2d71abad"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9a2480665e9ab79bef464a8c57"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_23cb5a85c555d015abb14021bd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a9f80dc4f648f0957ce695dc61"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4873976169085f14bdc39e168d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b65a160e622610345018d1eb0c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3149703f26e38aaa65de2d2653"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a4621b7155a01292b92569549f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b737666365dbea2e4c914fc6d3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3847a3fc0f1f00a73622ca6369"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c1889b64104f9b28ef6228c12e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eafc36eb1963f058440702fc6e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e853141fb4c21e905ce36dc60f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9f9eff007b40602f856803c50a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3c8d9da5d5cd959c953094653b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_abc604b71465bc5579525ff256"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_377b22d5ffc7f1e3d5085a27ea"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1539db4bbd6ada58abb940b058"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_34f21c8ae164fb90be806818a8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6f6246149ab744fd62ada06ee5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7b7272644aab237d503ed3429a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4ce33f4ec2b613851ec00d5ad9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_632005436db02ad442c7bcb634"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9f40fdc8d3b6da5ee7fa30c1fb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5ea13ac7a467e4532d18881e71"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1d8d2229e31e4ec13ec99c79ae"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4490b10d3394a9be5f27f8fc3b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d5b096e3c2b664829c4bf021d9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_24b4e231f58db2b6ff1df458b6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2956fbee991fc0eada674617d7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2eb4784b49cc7012fd8be34911"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f8efcb93010641cf8712bbd3f6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_912ddc627eb4e8ca3f93a701c9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_475d30964cfbe0040019345d16"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3f0e121832ab6eddcb165328e2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6f340ef127218ec4d0c50a7c87"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9a6bd2017e0d9ad69c4a7cb83e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_493141a06c1a0e8eb9338827c4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2c8bb7d2d9e0f69a70acdbb3b2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_31ef8630b4fac368db98aab9a2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_274979c9c9f53857fdb9dd4add"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1b57f437aa7d183c103441eaf0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_05e4e7a95b3bdb6de7523c4265"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b81360b62734aade7cd8942bc6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e8255ffba6701a426fb6218bf5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_27c39edd22d991939693b08963"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0fe42310a08e84122c058d9a36"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ce1b388e6e68733a35812b45fc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_44da1e8e6844ed0bb23c365487"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_24546d5de391b1c6fcff074842"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_110a58ade0d1744b8d6c832a1d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7a3ab0c19695f86724009d0926"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_11c6b59fc829f8147d46bddd2b"`,
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

  private async deleteDuplicateOwners(
    queryRunner: QueryRunner,
    ownerTable: OwnerTable,
  ): Promise<void> {
    const key: string = ownerTable.columns
      .map((column: string): string => {
        return `"${column}"`;
      })
      .join(", ");

    const partitionBy: string = ownerTable.columns
      .map((column: string): string => {
        return `t."${column}"`;
      })
      .join(", ");

    const joinOnKey: string = ownerTable.columns
      .map((column: string): string => {
        return `d."${column}" = t."${column}"`;
      })
      .join(" AND ");

    const survivorOrder: string = [
      `(t."deletedAt" IS NOT NULL) ASC`,
      ...(ownerTable.hasIsOwnerNotified ? [`t."isOwnerNotified" DESC`] : []),
      `t."createdAt" ASC`,
      `t._id ASC`,
    ].join(", ");

    await queryRunner.query(`
      WITH duplicate_groups AS (
        SELECT ${key}
        FROM "${ownerTable.table}"
        GROUP BY ${key}
        HAVING COUNT(*) > 1
      ),
      ranked AS (
        SELECT t._id,
               ROW_NUMBER() OVER (
                 PARTITION BY ${partitionBy}
                 ORDER BY ${survivorOrder}
               ) AS rn
        FROM "${ownerTable.table}" t
        JOIN duplicate_groups d ON ${joinOnKey}
      )
      DELETE FROM "${ownerTable.table}" t
      USING ranked r
      WHERE t._id = r._id AND r.rn > 1;
    `);
  }
}
