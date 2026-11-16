import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * WHY ONEUPTIME SWITCHED A RULE OFF (#9066): RuleBaseModel.emptiedLimits,
 * on every rule's table.
 *
 * Deleting the last record a rule's list was limited to - the only monitor
 * of an on-call rule, the only label of a host label rule - used to leave
 * the list empty, which puts no limit on the rule: it matched every record.
 * The delete now switches such a rule off and writes here which lists lost
 * their records, the records' names and when (Utils/Rules/RuleEmptiedLimits).
 * Null on every rule until then.
 *
 * A nullable column with no default: each ALTER TABLE changes the table's
 * catalog entry only, without a scan or a rewrite. The tables hold a
 * project's rules, a few rows each.
 */
export class AddRuleEmptiedLimits1809182490000 implements MigrationInterface {
  public name: string = "AddRuleEmptiedLimits1809182490000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceAutoImportRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteAssignmentRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceNamingRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentGroupingRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageMonitorRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodePrivacyRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePrivacyRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentSlaRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitorRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentReminderRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertReminderRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceReminderRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackCloudOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackCloudLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLabelRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerRule" ADD "emptiedLimits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardLabelRule" ADD "emptiedLimits" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DashboardLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackCloudLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackCloudOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceReminderRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertReminderRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentReminderRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitorRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentSlaRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePrivacyRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodePrivacyRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageMonitorRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentGroupingRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceNamingRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteAssignmentRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceAutoImportRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRule" DROP COLUMN "emptiedLimits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRule" DROP COLUMN "emptiedLimits"`,
    );
  }
}
