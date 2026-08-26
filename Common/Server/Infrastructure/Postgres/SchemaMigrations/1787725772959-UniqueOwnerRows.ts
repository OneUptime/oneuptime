import { MigrationInterface, QueryRunner } from "typeorm";

export class UniqueOwnerRows1787725772959 implements MigrationInterface {
  public name: string = "UniqueOwnerRows1787725772959";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * Collapse pre-existing duplicate owner rows before the unique indexes
     * below can be built.
     *
     * The indexes are generated (npm run generate-postgres-migration); these
     * DELETEs are not, and cannot be — the generator only ever diffs schema,
     * it never repairs data. Without them this migration aborts with
     * "could not create unique index" on every database that accumulated
     * duplicates through the API, a workflow or addOwners, which is exactly
     * the population this change exists to fix. That failure rolls back, but
     * it leaves the deployment unable to migrate at all.
     *
     * The oldest row per (resource, owner, project) is the survivor: it is
     * the one whose owner notification already fired and whose resource-feed
     * entry readers have already seen. `_id` breaks exact createdAt ties so
     * the outcome is deterministic. Rows that differ in resource, owner or
     * project are untouched.
     */
    await queryRunner.query(
      `DELETE FROM "KubernetesClusterOwnerTeam" a USING "KubernetesClusterOwnerTeam" b WHERE a."kubernetesClusterId" = b."kubernetesClusterId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "KubernetesClusterOwnerUser" a USING "KubernetesClusterOwnerUser" b WHERE a."kubernetesClusterId" = b."kubernetesClusterId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "NetworkDeviceOwnerTeam" a USING "NetworkDeviceOwnerTeam" b WHERE a."networkDeviceId" = b."networkDeviceId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "NetworkDeviceOwnerUser" a USING "NetworkDeviceOwnerUser" b WHERE a."networkDeviceId" = b."networkDeviceId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "DockerHostOwnerTeam" a USING "DockerHostOwnerTeam" b WHERE a."dockerHostId" = b."dockerHostId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "DockerHostOwnerUser" a USING "DockerHostOwnerUser" b WHERE a."dockerHostId" = b."dockerHostId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "PodmanHostOwnerTeam" a USING "PodmanHostOwnerTeam" b WHERE a."podmanHostId" = b."podmanHostId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "PodmanHostOwnerUser" a USING "PodmanHostOwnerUser" b WHERE a."podmanHostId" = b."podmanHostId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "ProxmoxClusterOwnerTeam" a USING "ProxmoxClusterOwnerTeam" b WHERE a."proxmoxClusterId" = b."proxmoxClusterId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "DockerSwarmClusterOwnerTeam" a USING "DockerSwarmClusterOwnerTeam" b WHERE a."dockerSwarmClusterId" = b."dockerSwarmClusterId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "ProxmoxClusterOwnerUser" a USING "ProxmoxClusterOwnerUser" b WHERE a."proxmoxClusterId" = b."proxmoxClusterId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "DockerSwarmClusterOwnerUser" a USING "DockerSwarmClusterOwnerUser" b WHERE a."dockerSwarmClusterId" = b."dockerSwarmClusterId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "IoTFleetOwnerTeam" a USING "IoTFleetOwnerTeam" b WHERE a."iotFleetId" = b."iotFleetId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "IoTFleetOwnerUser" a USING "IoTFleetOwnerUser" b WHERE a."iotFleetId" = b."iotFleetId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "CephClusterOwnerTeam" a USING "CephClusterOwnerTeam" b WHERE a."cephClusterId" = b."cephClusterId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "CephClusterOwnerUser" a USING "CephClusterOwnerUser" b WHERE a."cephClusterId" = b."cephClusterId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "HostOwnerTeam" a USING "HostOwnerTeam" b WHERE a."hostId" = b."hostId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "HostOwnerUser" a USING "HostOwnerUser" b WHERE a."hostId" = b."hostId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "ServerlessFunctionOwnerTeam" a USING "ServerlessFunctionOwnerTeam" b WHERE a."serverlessFunctionId" = b."serverlessFunctionId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "ServerlessFunctionOwnerUser" a USING "ServerlessFunctionOwnerUser" b WHERE a."serverlessFunctionId" = b."serverlessFunctionId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "CloudResourceOwnerTeam" a USING "CloudResourceOwnerTeam" b WHERE a."cloudResourceId" = b."cloudResourceId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "CloudResourceOwnerUser" a USING "CloudResourceOwnerUser" b WHERE a."cloudResourceId" = b."cloudResourceId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "RumApplicationOwnerTeam" a USING "RumApplicationOwnerTeam" b WHERE a."rumApplicationId" = b."rumApplicationId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "RumApplicationOwnerUser" a USING "RumApplicationOwnerUser" b WHERE a."rumApplicationId" = b."rumApplicationId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "IncidentOwnerTeam" a USING "IncidentOwnerTeam" b WHERE a."incidentId" = b."incidentId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "IncidentOwnerUser" a USING "IncidentOwnerUser" b WHERE a."incidentId" = b."incidentId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "IncidentTemplateOwnerTeam" a USING "IncidentTemplateOwnerTeam" b WHERE a."incidentTemplateId" = b."incidentTemplateId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "IncidentTemplateOwnerUser" a USING "IncidentTemplateOwnerUser" b WHERE a."incidentTemplateId" = b."incidentTemplateId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "MonitorGroupOwnerTeam" a USING "MonitorGroupOwnerTeam" b WHERE a."monitorGroupId" = b."monitorGroupId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "MonitorGroupOwnerUser" a USING "MonitorGroupOwnerUser" b WHERE a."monitorGroupId" = b."monitorGroupId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "MonitorOwnerTeam" a USING "MonitorOwnerTeam" b WHERE a."monitorId" = b."monitorId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "MonitorOwnerUser" a USING "MonitorOwnerUser" b WHERE a."monitorId" = b."monitorId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "OnCallDutyPolicyOwnerTeam" a USING "OnCallDutyPolicyOwnerTeam" b WHERE a."onCallDutyPolicyId" = b."onCallDutyPolicyId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "OnCallDutyPolicyOwnerUser" a USING "OnCallDutyPolicyOwnerUser" b WHERE a."onCallDutyPolicyId" = b."onCallDutyPolicyId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "OnCallDutyPolicyScheduleOwnerTeam" a USING "OnCallDutyPolicyScheduleOwnerTeam" b WHERE a."onCallDutyPolicyScheduleId" = b."onCallDutyPolicyScheduleId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "OnCallDutyPolicyScheduleOwnerUser" a USING "OnCallDutyPolicyScheduleOwnerUser" b WHERE a."onCallDutyPolicyScheduleId" = b."onCallDutyPolicyScheduleId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "IncomingCallPolicyOwnerTeam" a USING "IncomingCallPolicyOwnerTeam" b WHERE a."incomingCallPolicyId" = b."incomingCallPolicyId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "IncomingCallPolicyOwnerUser" a USING "IncomingCallPolicyOwnerUser" b WHERE a."incomingCallPolicyId" = b."incomingCallPolicyId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "ProbeOwnerTeam" a USING "ProbeOwnerTeam" b WHERE a."probeId" = b."probeId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "ProbeOwnerUser" a USING "ProbeOwnerUser" b WHERE a."probeId" = b."probeId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "AIAgentOwnerTeam" a USING "AIAgentOwnerTeam" b WHERE a."aiAgentId" = b."aiAgentId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "AIAgentOwnerUser" a USING "AIAgentOwnerUser" b WHERE a."aiAgentId" = b."aiAgentId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "ScheduledMaintenanceOwnerTeam" a USING "ScheduledMaintenanceOwnerTeam" b WHERE a."scheduledMaintenanceId" = b."scheduledMaintenanceId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "ScheduledMaintenanceOwnerUser" a USING "ScheduledMaintenanceOwnerUser" b WHERE a."scheduledMaintenanceId" = b."scheduledMaintenanceId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "ServiceOwnerTeam" a USING "ServiceOwnerTeam" b WHERE a."serviceId" = b."serviceId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "ServiceOwnerUser" a USING "ServiceOwnerUser" b WHERE a."serviceId" = b."serviceId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "StatusPageOwnerTeam" a USING "StatusPageOwnerTeam" b WHERE a."statusPageId" = b."statusPageId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "StatusPageOwnerUser" a USING "StatusPageOwnerUser" b WHERE a."statusPageId" = b."statusPageId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "WorkflowOwnerTeam" a USING "WorkflowOwnerTeam" b WHERE a."workflowId" = b."workflowId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "WorkflowOwnerUser" a USING "WorkflowOwnerUser" b WHERE a."workflowId" = b."workflowId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "RunnerOwnerTeam" a USING "RunnerOwnerTeam" b WHERE a."runnerId" = b."runnerId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "RunnerOwnerUser" a USING "RunnerOwnerUser" b WHERE a."runnerId" = b."runnerId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "RunbookOwnerTeam" a USING "RunbookOwnerTeam" b WHERE a."runbookId" = b."runbookId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "RunbookOwnerUser" a USING "RunbookOwnerUser" b WHERE a."runbookId" = b."runbookId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "ScheduledMaintenanceTemplateOwnerTeam" a USING "ScheduledMaintenanceTemplateOwnerTeam" b WHERE a."scheduledMaintenanceTemplateId" = b."scheduledMaintenanceTemplateId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "ScheduledMaintenanceTemplateOwnerUser" a USING "ScheduledMaintenanceTemplateOwnerUser" b WHERE a."scheduledMaintenanceTemplateId" = b."scheduledMaintenanceTemplateId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "AlertOwnerTeam" a USING "AlertOwnerTeam" b WHERE a."alertId" = b."alertId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "AlertOwnerUser" a USING "AlertOwnerUser" b WHERE a."alertId" = b."alertId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "AlertEpisodeOwnerUser" a USING "AlertEpisodeOwnerUser" b WHERE a."alertEpisodeId" = b."alertEpisodeId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "AlertEpisodeOwnerTeam" a USING "AlertEpisodeOwnerTeam" b WHERE a."alertEpisodeId" = b."alertEpisodeId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "IncidentEpisodeOwnerUser" a USING "IncidentEpisodeOwnerUser" b WHERE a."incidentEpisodeId" = b."incidentEpisodeId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "IncidentEpisodeOwnerTeam" a USING "IncidentEpisodeOwnerTeam" b WHERE a."incidentEpisodeId" = b."incidentEpisodeId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "ServiceLevelObjectiveOwnerUser" a USING "ServiceLevelObjectiveOwnerUser" b WHERE a."serviceLevelObjectiveId" = b."serviceLevelObjectiveId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "ServiceLevelObjectiveOwnerTeam" a USING "ServiceLevelObjectiveOwnerTeam" b WHERE a."serviceLevelObjectiveId" = b."serviceLevelObjectiveId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "DashboardOwnerTeam" a USING "DashboardOwnerTeam" b WHERE a."dashboardId" = b."dashboardId" AND a."teamId" = b."teamId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );
    await queryRunner.query(
      `DELETE FROM "DashboardOwnerUser" a USING "DashboardOwnerUser" b WHERE a."dashboardId" = b."dashboardId" AND a."userId" = b."userId" AND a."projectId" = b."projectId" AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."_id" > b."_id"))`,
    );

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
     * NOTE: the CREATE INDEX statements below were generated with their columns
     * in reverse order (TypeORM emits the reversed list when it writes down()).
     * Restoring an index as ("projectId", "teamId", "incidentId") when the
     * original was ("incidentId", "teamId", "projectId") is not a rollback: a
     * btree is only useful on a leading-column prefix, so the rolled-back
     * database would silently lose the lookups the original index served.
     * Each list here is taken from the matching statement in up(), which is the
     * order the entity declares.
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
}
