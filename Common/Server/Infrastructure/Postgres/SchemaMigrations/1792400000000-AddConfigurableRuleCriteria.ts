import { MigrationInterface, QueryRunner } from "typeorm";

const RULE_CRITERIA_LEGACY_SHADOW_FUNCTION_NAME: string =
  "set_rule_criteria_legacy_shadow_1792400000000";
const RULE_CRITERIA_LEGACY_SHADOW_TRIGGER_NAME: string =
  "TRG_rule_criteria_legacy_shadow_1792400000000";
const RELATION_ONLY_RULE_CRITERIA_SHADOW_FUNCTION_NAME: string =
  "set_relation_only_rule_criteria_shadow_1792400000000";
const RELATION_ONLY_RULE_CRITERIA_SHADOW_TRIGGER_NAME: string =
  "TRG_relation_only_rule_criteria_shadow_1792400000000";
const RELATION_ONLY_RULE_CRITERIA_SHADOW_TABLES: ReadonlyArray<string> = [
  "IncidentReminderRule",
  "AlertReminderRule",
  "ScheduledMaintenanceReminderRule",
];

/*
 * This is a historical schema contract, not an application registry lookup.
 * A criteria-backed row must retain one positive legacy pattern that can
 * never match so an older worker cannot act on it during a rolling deploy.
 */
const RULE_CRITERIA_LEGACY_SHADOWS: ReadonlyArray<
  readonly [tableName: string, fieldName: string]
> = [
  ["AlertEpisodeLabelRule", "episodeTitlePattern"],
  ["AlertEpisodeOnCallRule", "episodeTitlePattern"],
  ["AlertEpisodeOwnerRule", "episodeTitlePattern"],
  ["AlertEpisodePrivacyRule", "episodeTitlePattern"],
  ["AlertGroupingRule", "alertTitlePattern"],
  ["AlertLabelRule", "alertTitlePattern"],
  ["AlertOnCallRule", "alertTitlePattern"],
  ["AlertOwnerRule", "alertTitlePattern"],
  ["AlertPrivacyRule", "alertTitlePattern"],
  ["AutoRemediationRule", "titlePattern"],
  ["CephClusterLabelRule", "cephClusterNamePattern"],
  ["CephClusterOwnerRule", "cephClusterNamePattern"],
  ["CloudResourceLabelRule", "nameRegexPattern"],
  ["CloudResourceOwnerRule", "nameRegexPattern"],
  ["DashboardLabelRule", "dashboardNamePattern"],
  ["DashboardOwnerRule", "dashboardNamePattern"],
  ["DockerHostLabelRule", "dockerHostNamePattern"],
  ["DockerHostOwnerRule", "dockerHostNamePattern"],
  ["DockerSwarmClusterLabelRule", "dockerSwarmClusterNamePattern"],
  ["DockerSwarmClusterOwnerRule", "dockerSwarmClusterNamePattern"],
  ["HostLabelRule", "hostNamePattern"],
  ["HostOwnerRule", "hostNamePattern"],
  ["IncidentEpisodeLabelRule", "episodeTitlePattern"],
  ["IncidentEpisodeOnCallRule", "episodeTitlePattern"],
  ["IncidentEpisodeOwnerRule", "episodeTitlePattern"],
  ["IncidentEpisodePrivacyRule", "episodeTitlePattern"],
  ["IncidentGroupingRule", "incidentTitlePattern"],
  ["IncidentLabelRule", "incidentTitlePattern"],
  ["IncidentOnCallRule", "incidentTitlePattern"],
  ["IncidentOwnerRule", "incidentTitlePattern"],
  ["IncidentPrivacyRule", "incidentTitlePattern"],
  ["IncidentSlaRule", "incidentTitlePattern"],
  ["IncomingCallPolicyLabelRule", "incomingCallPolicyNamePattern"],
  ["IncomingCallPolicyOwnerRule", "incomingCallPolicyNamePattern"],
  ["IoTFleetLabelRule", "iotFleetNamePattern"],
  ["IoTFleetOwnerRule", "iotFleetNamePattern"],
  ["KubernetesClusterLabelRule", "kubernetesClusterNamePattern"],
  ["KubernetesClusterOwnerRule", "kubernetesClusterNamePattern"],
  ["MonitorLabelRule", "monitorNamePattern"],
  ["MonitorOwnerRule", "monitorNamePattern"],
  ["NetworkDeviceAutoImportRule", "sysNamePattern"],
  ["NetworkDeviceLabelRule", "networkDeviceNamePattern"],
  ["NetworkDeviceOwnerRule", "networkDeviceNamePattern"],
  ["NetworkSiteAssignmentRule", "hostnamePattern"],
  ["OnCallDutyPolicyLabelRule", "onCallDutyPolicyNamePattern"],
  ["OnCallDutyPolicyOwnerRule", "onCallDutyPolicyNamePattern"],
  ["OnCallDutyPolicyScheduleLabelRule", "onCallDutyPolicyScheduleNamePattern"],
  ["OnCallDutyPolicyScheduleOwnerRule", "onCallDutyPolicyScheduleNamePattern"],
  ["PodmanHostLabelRule", "podmanHostNamePattern"],
  ["PodmanHostOwnerRule", "podmanHostNamePattern"],
  ["ProxmoxClusterLabelRule", "proxmoxClusterNamePattern"],
  ["ProxmoxClusterOwnerRule", "proxmoxClusterNamePattern"],
  ["RumApplicationLabelRule", "nameRegexPattern"],
  ["RumApplicationOwnerRule", "nameRegexPattern"],
  ["RunbookLabelRule", "runbookNamePattern"],
  ["RunbookOwnerRule", "runbookNamePattern"],
  ["RunbookRule", "titlePattern"],
  ["ScheduledMaintenanceLabelRule", "titlePattern"],
  ["ScheduledMaintenanceOwnerRule", "titlePattern"],
  ["ServerlessFunctionLabelRule", "nameRegexPattern"],
  ["ServerlessFunctionOwnerRule", "nameRegexPattern"],
  ["ServiceLabelRule", "serviceNamePattern"],
  ["ServiceOwnerRule", "serviceNamePattern"],
  ["StatusPageLabelRule", "statusPageNamePattern"],
  ["StatusPageMonitorRule", "monitorNamePattern"],
  ["StatusPageOwnerRule", "statusPageNamePattern"],
  ["VMwareVCenterLabelRule", "vmwareVCenterNamePattern"],
  ["VMwareVCenterOwnerRule", "vmwareVCenterNamePattern"],
  ["WorkflowLabelRule", "workflowNamePattern"],
  ["WorkflowOwnerRule", "workflowNamePattern"],
];

export class AddConfigurableRuleCriteria1792400000000
  implements MigrationInterface
{
  public readonly name: string = "AddConfigurableRuleCriteria1792400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceAutoImportRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteAssignmentRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentGroupingRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageMonitorRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(`ALTER TABLE "RunbookRule" ADD "criteria" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodePrivacyRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePrivacyRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentSlaRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentReminderRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertReminderRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceReminderRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(`ALTER TABLE "HostOwnerRule" ADD "criteria" jsonb`);
    await queryRunner.query(`ALTER TABLE "HostLabelRule" ADD "criteria" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardLabelRule" ADD "criteria" jsonb`,
    );
    await queryRunner.query(
      `CREATE FUNCTION "${RULE_CRITERIA_LEGACY_SHADOW_FUNCTION_NAME}"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."criteria" IS NOT NULL THEN
    NEW := jsonb_populate_record(
      NEW,
      jsonb_build_object(TG_ARGV[0], '(?!)')
    );
  END IF;

  RETURN NEW;
END;
$$`,
    );

    for (const [tableName, fieldName] of RULE_CRITERIA_LEGACY_SHADOWS) {
      await queryRunner.query(
        `CREATE TRIGGER "${RULE_CRITERIA_LEGACY_SHADOW_TRIGGER_NAME}" BEFORE INSERT OR UPDATE ON "${tableName}" FOR EACH ROW EXECUTE FUNCTION "${RULE_CRITERIA_LEGACY_SHADOW_FUNCTION_NAME}"('${fieldName}')`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "IncidentReminderRule" ALTER COLUMN "isEnabled" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertReminderRule" ALTER COLUMN "isEnabled" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceReminderRule" ALTER COLUMN "isEnabled" DROP NOT NULL`,
    );
    await queryRunner.query(
      `CREATE FUNCTION "${RELATION_ONLY_RULE_CRITERIA_SHADOW_FUNCTION_NAME}"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."criteria" IS NOT NULL THEN
    NEW."isEnabled" := CASE
      WHEN NEW."criteria" -> 'isEnabled' = 'true'::jsonb THEN NULL
      ELSE false
    END;
  END IF;

  RETURN NEW;
END;
$$`,
    );

    for (const tableName of RELATION_ONLY_RULE_CRITERIA_SHADOW_TABLES) {
      await queryRunner.query(
        `CREATE TRIGGER "${RELATION_ONLY_RULE_CRITERIA_SHADOW_TRIGGER_NAME}" BEFORE INSERT OR UPDATE ON "${tableName}" FOR EACH ROW EXECUTE FUNCTION "${RELATION_ONLY_RULE_CRITERIA_SHADOW_FUNCTION_NAME}"()`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "IncidentReminderRule" ADD CONSTRAINT "CHK_621666eeeadb32738407f5260f" CHECK ("criteria" IS NULL OR "isEnabled" IS DISTINCT FROM true)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertReminderRule" ADD CONSTRAINT "CHK_5aa12af0798999b443a647d80f" CHECK ("criteria" IS NULL OR "isEnabled" IS DISTINCT FROM true)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceReminderRule" ADD CONSTRAINT "CHK_5f385c6a0dd4b598a9b3c7ca1c" CHECK ("criteria" IS NULL OR "isEnabled" IS DISTINCT FROM true)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const tableName of RELATION_ONLY_RULE_CRITERIA_SHADOW_TABLES) {
      await queryRunner.query(
        `DROP TRIGGER "${RELATION_ONLY_RULE_CRITERIA_SHADOW_TRIGGER_NAME}" ON "${tableName}"`,
      );
    }
    await queryRunner.query(
      `DROP FUNCTION "${RELATION_ONLY_RULE_CRITERIA_SHADOW_FUNCTION_NAME}"()`,
    );
    for (const [tableName] of RULE_CRITERIA_LEGACY_SHADOWS) {
      await queryRunner.query(
        `DROP TRIGGER "${RULE_CRITERIA_LEGACY_SHADOW_TRIGGER_NAME}" ON "${tableName}"`,
      );
    }
    await queryRunner.query(
      `DROP FUNCTION "${RULE_CRITERIA_LEGACY_SHADOW_FUNCTION_NAME}"()`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceReminderRule" DROP CONSTRAINT "CHK_5f385c6a0dd4b598a9b3c7ca1c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertReminderRule" DROP CONSTRAINT "CHK_5aa12af0798999b443a647d80f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentReminderRule" DROP CONSTRAINT "CHK_621666eeeadb32738407f5260f"`,
    );
    await queryRunner.query(
      `UPDATE "ScheduledMaintenanceReminderRule" SET "isEnabled" = true WHERE "isEnabled" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "AlertReminderRule" SET "isEnabled" = true WHERE "isEnabled" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "IncidentReminderRule" SET "isEnabled" = true WHERE "isEnabled" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceReminderRule" ALTER COLUMN "isEnabled" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertReminderRule" ALTER COLUMN "isEnabled" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentReminderRule" ALTER COLUMN "isEnabled" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceReminderRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertReminderRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentReminderRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentSlaRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePrivacyRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodePrivacyRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(`ALTER TABLE "RunbookRule" DROP COLUMN "criteria"`);
    await queryRunner.query(
      `ALTER TABLE "StatusPageMonitorRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentGroupingRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteAssignmentRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceAutoImportRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRule" DROP COLUMN "criteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRule" DROP COLUMN "criteria"`,
    );
  }
}
