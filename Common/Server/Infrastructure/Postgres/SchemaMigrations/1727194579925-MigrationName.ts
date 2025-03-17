import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1727194579925 implements MigrationInterface {
  public name = "MigrationName1727194579925";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "User" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "File" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AcmeCertificate" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "AcmeChallenge" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "Reseller" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ResellerPlan" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "Project" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ApiKey" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "Label" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ApiKeyPermission" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "BillingInvoice" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "BillingPaymentMethod" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "CallLog" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "CopilotCodeRepository" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ServiceCatalog" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ServiceCopilotCodeRepository" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "CopilotAction" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "DataMigrations" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "Domain" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "EmailLog" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "EmailVerificationToken" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "GreenlockCertificate" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "GreenlockChallenge" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "IncidentSeverity" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "IncidentState" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "MonitorStatus" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "Monitor" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "Probe" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "Incident" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "IncidentInternalNote" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "IncidentNoteTemplate" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "Team" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerTeam" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerUser" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "IncidentTemplate" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateOwnerTeam" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateOwnerUser" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "MonitorCustomField" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "MonitorGroup" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "MonitorGroupOwnerTeam" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "MonitorGroupOwnerUser" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "MonitorGroupResource" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerTeam" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerUser" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "MonitorProbe" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "MonitorSecret" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "MonitorStatusTimeline" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyCustomField" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRule" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleSchedule" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleTeam" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleUser" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayerUser" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerTeam" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerUser" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ProjectSSO" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "PromoCode" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceState" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "StatusPage" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCustomField" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceInternalNote" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceNoteTemplate" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerTeam" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerUser" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerTeam" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerUser" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ShortLink" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "SmsLog" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "StatusPageCustomField" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "StatusPageDomain" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "StatusPageFooterLink" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "StatusPageHeaderLink" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "StatusPageHistoryChartBarColorRule" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerTeam" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerUser" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "StatusPagePrivateUser" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "StatusPageResource" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "StatusPageSSO" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "TeamMember" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "TeamPermission" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "TelemetryService" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "UserCall" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "UserEmail" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "UserSMS" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "Workflow" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogMonitor" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogTelemetryService" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "UserTwoFactorAuth" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "CopilotActionTypePriority" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerTeam" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerUser" ALTER COLUMN "deletedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );
  }

  @CaptureSpan()
  public async down(_queryRunner: QueryRunner): Promise<void> {}
}
