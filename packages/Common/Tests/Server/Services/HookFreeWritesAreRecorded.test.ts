import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  HookFreeWrite,
  HookFreeWriteAction,
  HookFreeWriteForm,
  HookFreeWriteScanner,
} from "../../Helpers/HookFreeWriteScan";
import { listTypeScriptFiles } from "../../Helpers/ReferenceNameScan";
import {
  RunNowReading,
  propertyText,
  readRunNow,
} from "../../Helpers/RunNowWriteScan";
import {
  RuleRunAction,
  RuleRunType,
  RuleRunTypeUtil,
} from "../../../Types/Rules/RuleRun";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import EnableAuditLogOn from "../../../Types/BaseDatabase/EnableAuditLogOn";
import { getColumnAccessControlForAllColumns } from "../../../Types/Database/AccessControl/ColumnAccessControl";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * EVERY WRITE THAT GOES ROUND DATABASESERVICE'S HOOKS, TO WHAT THE AUDIT LOG
 * TRACKS, IS DECIDED: RECORDED, OR ONEUPTIME'S OWN WORK (issues #6276,
 * #6283-#6286).
 *
 * DatabaseService records every change it makes to an audited model. A write
 * made round it - a *WithoutHooks statement, a relation write, a create with
 * ignoreHooks, raw SQL - records nothing unless the code making it records
 * it itself. That is how approving a runbook step, the labels a rule added,
 * a team joined through SSO and an exception merged never reached the audit
 * log (HookFreeWriteScan finds such writes).
 *
 * So every one that writes an audited model's tracked columns - not the
 * columns the audit log leaves out anyway (only OneUptime writes them,
 * nobody may read them, an agent reports them), and not a model it does not
 * cover - is listed below, by its file, the function it is in and the table
 * it writes ("*" for a helper handed any service):
 *
 *   - Recorded: the change is recorded by the code that makes it - this
 *     guard checks the function calls AuditLogService.record*, or a function
 *     that does; a write in a transaction may be recorded once it has
 *     committed, by the function that runs it (RECORDED_ONCE_COMMITTED),
 *     which the guard checks records and calls the function the write is in;
 *   - otherwise, why it is OneUptime's own work and no entry is right: the
 *     kinds in WHY_NOT_RECORDED.
 *
 * A new write round the hooks fails here until it is decided, and an entry
 * that no longer matches a write fails too, so the list stays true.
 *
 * What a scan cannot tell: whether a write of a column the defaults leave
 * out (OneUptime's own, or one nobody may read) was asked for by a person -
 * a reset, a rotate, a merge - which then names it in includeColumns
 * (TelemetryExceptionMerge, the calendar feeds, a runbook's webhook URL).
 * Those record nothing written either way, so they are not here; their
 * tests pin them.
 *
 * ee/Server is read when it is there (CI deletes ee/ for the open-source
 * build, so the guard must pass without it too).
 */

// packages/Common/Tests/Server/Services -> packages/Common.
const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..");
const REPOSITORY_ROOT: string = path.resolve(COMMON_ROOT, "..", "..");
const EE_ROOT: string = path.join(REPOSITORY_ROOT, "ee");

const SCAN_ROOTS: Array<string> = [
  path.join(COMMON_ROOT, "Server"),
  path.join(REPOSITORY_ROOT, "packages", "App", "FeatureSet"),
  path.join(EE_ROOT, "Server"),
];

/*
 * DatabaseService's *WithoutHooks methods that read rather than write: the
 * scan reads every other one, so a new hook-free write method is read the
 * day it is added.
 */
const HOOK_FREE_READS: ReadonlySet<string> = new Set<string>([
  "hasRowWithIdWithoutHooks",
]);

enum Why {
  Recorded = "Recorded",
  Reported = "Reported",
  Bookkeeping = "Bookkeeping",
  Derived = "Derived",
  FollowOn = "FollowOn",
  Automation = "Automation",
  Migration = "Migration",
  Setup = "Setup",
  Billing = "Billing",
}

// Why a write round the hooks adds no entry, kind by kind.
export const WHY_NOT_RECORDED: Readonly<
  Record<Exclude<Why, Why.Recorded>, string>
> = {
  [Why.Reported]:
    "What an agent, a probe, telemetry or a provider reports, written as it arrives: resources it discovered and the labels they carry, readings, health, check and scan results. Nobody made that change, and a report every minute would bury the ones people make.",
  [Why.Bookkeeping]:
    "OneUptime's own bookkeeping as it works: a claim or a lease, when a job last ran or runs next, what it has notified, a stale discovered row archived and restored, an expired row deleted, a timeline repaired.",
  [Why.Derived]:
    "State OneUptime works out from other records and keeps in step with them: a site's place in the tree, a status rolled up from what it holds, a count, a confidence or a threshold recomputed, a list's order closed up.",
  [Why.FollowOn]:
    "Follows from a change the audit log records already: a renamed custom field's values moved with it, a custom role's permissions copied to the teams and keys that hold it, when a case or a task was closed stamped beside the change that closed it.",
  [Why.Automation]:
    "What OneUptime does by itself as it runs: a rule attaching on-call policies to a record as it is created, a security playbook's steps and its run's progress (the run records what each step did), OneUptime AI's notes, a network alert policy adopting a monitor.",
  [Why.Migration]:
    "A data migration or a one-off repair: OneUptime rewriting stored rows into a new shape, not a change anybody made.",
  [Why.Setup]:
    "OneUptime setting up something new, before anybody can audit it: a new project's default teams and their permissions, a workflow's first incoming email address.",
  [Why.Billing]:
    "A project's balance and usage limits, which billing keeps records of itself.",
};

/*
 * Every write round the hooks of what the audit log tracks, by file, then
 * "<function> <table>".
 */
const DECIDED: Readonly<Record<string, Readonly<Record<string, Why>>>> = {
  "ee/Server/AuditLogExport/AuditLogExporter.ts": {
    "AuditLogExporter.writeBookkeeping AuditLogExport": Why.Bookkeeping,
  },
  "packages/App/FeatureSet/Identity/Utils/SsoTeamMembership.ts": {
    "SsoTeamMembership.addToTeams TeamMember": Why.Recorded,
  },
  "packages/App/FeatureSet/Runbook/API/Runbook.ts": {
    "advanceStep RunbookExecution": Why.Recorded,
  },
  "packages/App/FeatureSet/Telemetry/API/ProbeIngest/DataSecurity.ts": {
    "(module) DataStore": Why.Reported,
  },
  "packages/App/FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessProbeIngest.ts": {
    "processIncomingEmailFromQueue Monitor": Why.Reported,
  },
  "packages/App/FeatureSet/Telemetry/Utils/Exception.ts": {
    "ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch TelemetryException":
      Why.Reported,
  },
  "packages/App/FeatureSet/Workers/DataMigrations/BackfillNetworkSiteTypes.ts":
    {
      "BackfillNetworkSiteTypes.backfillProject NetworkSite": Why.Migration,
    },
  "packages/App/FeatureSet/Workers/DataMigrations/MoveGoogleSecOpsConnectionsToSecurityEventConnections.ts":
    {
      "MoveGoogleSecOpsConnectionsToSecurityEventConnections.moveConnection SecurityEventConnection":
        Why.Migration,
    },
  "packages/App/FeatureSet/Workers/DataMigrations/NormalizeMonitoringInterval.ts":
    {
      "NormalizeMonitoringInterval.normalizeMonitorTemplates MonitorTemplate":
        Why.Migration,
      "NormalizeMonitoringInterval.normalizeMonitors Monitor": Why.Migration,
    },
  "packages/App/FeatureSet/Workers/DataMigrations/NormalizeNetworkDeviceMonitoringMethod.ts":
    {
      "NormalizeNetworkDeviceMonitoringMethod.migrate NetworkDevice":
        Why.Migration,
    },
  "packages/App/FeatureSet/Workers/DataMigrations/RecordContainerPercentMetricUnits.ts":
    {
      "RecordContainerPercentMetricUnits.migrate MetricType": Why.Migration,
    },
  "packages/App/FeatureSet/Workers/DataMigrations/RepairKubernetesDashboardClusterCpuTile.ts":
    {
      "RepairKubernetesDashboardClusterCpuTile.migrate Dashboard":
        Why.Migration,
    },
  "packages/App/FeatureSet/Workers/Jobs/Incident/SendNotificationToSubscribers.ts":
    {
      "recordNotifiedStatusPagesSoFar Incident": Why.Bookkeeping,
    },
  "packages/App/FeatureSet/Workers/Jobs/Incident/SendPostmortemNotificationToSubscribers.ts":
    {
      "requeueIfChangedSinceRead Incident": Why.Bookkeeping,
    },
  "packages/App/FeatureSet/Workers/Jobs/IncomingEmailMonitor/CheckOnlineStatus.ts":
    {
      "checkOnlineStatus Monitor": Why.Bookkeeping,
    },
  "packages/App/FeatureSet/Workers/Jobs/IncomingRequestMonitor/CheckHeartbeat.ts":
    {
      "checkHeartBeat Monitor": Why.Bookkeeping,
    },
  "packages/App/FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor.ts":
    {
      "enqueueDueTelemetryMonitorEvaluationJobs Monitor": Why.Bookkeeping,
    },
  "packages/Common/Server/API/DataObservabilityAPI.ts": {
    "(module) DataStore": Why.Recorded,
  },
  "packages/Common/Server/API/DataSecurityAPI.ts": {
    "(module) DataStore": Why.Bookkeeping,
    "(module) DataStoreFinding": Why.FollowOn,
  },
  "packages/Common/Server/API/SecurityPlaybookRunAPI.ts": {
    "SecurityPlaybookRunAPI.decide SecurityPlaybookRun": Why.Recorded,
    "SecurityPlaybookRunAPI.writeUndone SecurityPlaybookRun": Why.Recorded,
  },
  "packages/Common/Server/Services/AlertEpisodeOnCallRuleEngineService.ts": {
    "AlertEpisodeOnCallRuleEngineServiceClass.applyRulesToEpisode AlertEpisode":
      Why.Automation,
  },
  "packages/Common/Server/Services/AlertOnCallRuleEngineService.ts": {
    "AlertOnCallRuleEngineServiceClass.applyRulesToAlert Alert": Why.Automation,
  },
  "packages/Common/Server/Services/CephClusterService.ts": {
    "Service.attachLabels CephCluster": Why.Reported,
  },
  "packages/Common/Server/Services/CloudResourceService.ts": {
    "Service.archiveUnseenMonitoredResources CloudResource": Why.Bookkeeping,
    "Service.attachLabels CloudResource": Why.Reported,
    "Service.restoreReportingMonitoredResources CloudResource": Why.Bookkeeping,
  },
  "packages/Common/Server/Services/CustomFieldMappingService.ts": {
    "CustomFieldMappingServiceClass.restampRecords *": Why.FollowOn,
  },
  "packages/Common/Server/Services/DataStoreFindingService.ts": {
    "Service.onUpdateSuccess DataStoreFinding": Why.Derived,
  },
  "packages/Common/Server/Services/DatabaseServerEndpointService.ts": {
    "Service.releaseUnproducedWorkloadEndpoints DatabaseServerEndpoint":
      Why.Reported,
    "Service.transferEndpoint DatabaseServerEndpoint": Why.Reported,
  },
  "packages/Common/Server/Services/DatabaseServerService.ts": {
    "Service.attachLabels DatabaseServer": Why.Reported,
    "Service.autoArchiveStaleDatabaseServers DatabaseServer": Why.Bookkeeping,
    "Service.createEndpointDatabaseServer DatabaseServer": Why.Reported,
    "Service.restoreIfAutoArchived DatabaseServer": Why.Bookkeeping,
    "Service.upsertWorkloadDatabaseOrThrow DatabaseServer": Why.Reported,
    "Service.writeDatabaseSystemIfUnchanged DatabaseServer": Why.Reported,
  },
  "packages/Common/Server/Services/DatabaseService.ts": {
    "DatabaseService.verifyHashedColumnValue *": Why.Bookkeeping,
  },
  "packages/Common/Server/Services/DockerHostService.ts": {
    "Service.attachLabels DockerHost": Why.Reported,
  },
  "packages/Common/Server/Services/DockerSwarmClusterService.ts": {
    "Service.attachLabels DockerSwarmCluster": Why.Reported,
  },
  "packages/Common/Server/Services/HostService.ts": {
    "Service.attachLabels Host": Why.Reported,
  },
  "packages/Common/Server/Services/IncidentCustomFieldService.ts": {
    "Service.moveValuesOfRenamedFields IncidentCustomField": Why.FollowOn,
  },
  "packages/Common/Server/Services/IncidentEpisodeOnCallRuleEngineService.ts": {
    "IncidentEpisodeOnCallRuleEngineServiceClass.applyRulesToEpisode IncidentEpisode":
      Why.Automation,
  },
  "packages/Common/Server/Services/IncidentOnCallRuleEngineService.ts": {
    "IncidentOnCallRuleEngineServiceClass.attachPolicies Incident":
      Why.Automation,
  },
  "packages/Common/Server/Services/IncidentPostmortemStatusService.ts": {
    "getPostmortemStatusBackfillSql Incident": Why.Migration,
  },
  "packages/Common/Server/Services/IncidentService.ts": {
    "Service.movePostmortemStatusAfterUpdate Incident": Why.Derived,
    "Service.setPostmortemNotificationPending Incident": Why.Bookkeeping,
  },
  "packages/Common/Server/Services/IoTFleetService.ts": {
    "Service.attachLabels IoTFleet": Why.Reported,
  },
  "packages/Common/Server/Services/KubernetesClusterService.ts": {
    "Service.attachLabels KubernetesCluster": Why.Reported,
  },
  "packages/Common/Server/Services/MessageQueueService.ts": {
    "Service.autoArchiveStaleMessageQueues MessageQueue": Why.Bookkeeping,
    "Service.findOrCreateByIdentity MessageQueue": Why.Reported,
    "Service.refineMessagingSystem MessageQueue": Why.Reported,
    "Service.restoreIfAutoArchived MessageQueue": Why.Bookkeeping,
  },
  "packages/Common/Server/Services/MonitorService.ts": {
    /*
     * An Incoming Request monitor's latest request as people read it, cut
     * again from the request as it came by the monitor's switch (#6402):
     * kept in step after the switch changed - a change the audit log
     * records - and when a request kept once is split.
     */
    "Service.rewriteLatestIncomingRequestForReaders Monitor": Why.Derived,
  },
  "packages/Common/Server/Services/MonitorTestService.ts": {
    "Service.claimMonitorTestsForProbing MonitorTest": Why.Bookkeeping,
    "Service.mergeStepProbeResponse MonitorTest": Why.Reported,
  },
  "packages/Common/Server/Services/NetworkAlertPolicyEngineService.ts": {
    "NetworkAlertPolicyEngineServiceClass.adoptMonitor Monitor": Why.Automation,
  },
  "packages/Common/Server/Services/NetworkDeviceDiscoveryScanService.ts": {
    "Service.onUpdateSuccess NetworkDeviceDiscoveryScan": Why.Reported,
  },
  "packages/Common/Server/Services/NetworkDeviceLabelRuleEngineService.ts": {
    "NetworkDeviceLabelRuleEngineServiceClass.applyRuleToExistingNetworkDevices NetworkDevice":
      Why.Recorded,
  },
  "packages/Common/Server/Services/NetworkDeviceService.ts": {
    "Service.onUpdateSuccess NetworkDevice": Why.FollowOn,
    "Service.refreshStampedMonitorStatus NetworkDevice": Why.Derived,
    /*
     * A poll's verdict (#7389): reachability, when the device last answered
     * and its interface counts, as each poll reports them, in the one
     * compare-and-set statement that keeps an older poll's verdict from
     * standing over a newer one's. Every column it sets is one entries leave
     * out (reported, or a last...At stamp); the scan cannot read a SET built
     * from a list.
     */
    "Service.writePollVerdict NetworkDevice": Why.Reported,
  },
  "packages/Common/Server/Services/NetworkInterfaceService.ts": {
    "Service.bulkInsertInterfaces NetworkInterface": Why.Reported,
  },
  "packages/Common/Server/Services/NetworkSiteService.ts": {
    // The rollup's own status, cleared when nothing at the site reports (#6965).
    "Service.clearStatusNothingReports NetworkSite": Why.Derived,
    "Service.getMaterializedPathForSite NetworkSite": Why.Derived,
    "Service.onCreateSuccess NetworkSite": Why.Derived,
    "Service.onMonitorStatusChanged NetworkDevice": Why.Derived,
    "Service.onUpdateSuccess NetworkSite": Why.Derived,
    "Service.reattachOrphanedSubtree NetworkSite": Why.Derived,
    "Service.recomputeRollupForSite NetworkSite": Why.Derived,
  },
  "packages/Common/Server/Services/OpenStackCloudCheckService.ts": {
    "Service.afterWrite OpenStackCloudCheck": Why.Derived,
  },
  "packages/Common/Server/Services/OpenStackCloudService.ts": {
    "Service.attachLabels OpenStackCloud": Why.Reported,
    "Service.writeConnectionServerColumns OpenStackCloud": Why.Reported,
  },
  "packages/Common/Server/Services/OpenStackProjectUsageService.ts": {
    "Service.saveReading OpenStackCloud": Why.Reported,
  },
  "packages/Common/Server/Services/PacketCaptureService.ts": {
    "Service.deleteExpiredCaptures PacketCapture": Why.Bookkeeping,
  },
  "packages/Common/Server/Services/PodmanHostService.ts": {
    "Service.attachLabels PodmanHost": Why.Reported,
  },
  /*
   * A project's activation milestones (issue #6830): what OneUptime works
   * out from the monitors, pages, members and telemetry it already records,
   * kept once with INSERT ... ON CONFLICT DO NOTHING.
   */
  "packages/Common/Server/Services/ProjectMilestoneService.ts": {
    "Service.keep ProjectMilestone": Why.Derived,
  },
  "packages/Common/Server/Services/ProjectService.ts": {
    "ProjectService.addDefaultProjectTeams TeamMember": Why.Setup,
    "ProjectService.addDefaultProjectTeams TeamPermission": Why.Setup,
    "ProjectService.addToSmsOrCallBalance Project": Why.Billing,
    "ProjectService.adjustBalance Project": Why.Billing,
    "ProjectService.claimOwnerNotice Project": Why.Bookkeeping,
    "ProjectService.markAiDailyLimitReached Project": Why.Bookkeeping,
  },
  "packages/Common/Server/Services/ProxmoxClusterService.ts": {
    "Service.attachLabels ProxmoxCluster": Why.Reported,
  },
  "packages/Common/Server/Services/RumApplicationService.ts": {
    "Service.attachLabels RumApplication": Why.Reported,
    // When traces, logs or metrics last arrived, stamped by ingest (#5770).
    "Service.markTelemetrySignalReceived RumApplication": Why.Reported,
    "Service.writeReplayHealthColumn RumApplication": Why.Reported,
  },
  "packages/Common/Server/Services/SecurityCaseService.ts": {
    "Service.recordChanges SecurityCase": Why.FollowOn,
  },
  "packages/Common/Server/Services/SecurityCaseTaskService.ts": {
    "Service.onCreateSuccess SecurityCaseTask": Why.FollowOn,
    "Service.recordChanges SecurityCaseTask": Why.FollowOn,
  },
  "packages/Common/Server/Services/SecurityPlaybookRunService.ts": {
    "Service.onCreateSuccess SecurityPlaybook": Why.Derived,
    "Service.recordCancellation SecurityPlaybookRun": Why.FollowOn,
  },
  "packages/Common/Server/Services/ServerlessFunctionService.ts": {
    "Service.attachLabels ServerlessFunction": Why.Reported,
  },
  "packages/Common/Server/Services/ServiceService.ts": {
    "Service.attachLabels Service": Why.Reported,
  },
  "packages/Common/Server/Services/StatusPageSubscriberService.ts": {
    "Service.unsubscribe StatusPageSubscriber": Why.Recorded,
  },
  "packages/Common/Server/Services/StorageArrayService.ts": {
    "Service.attachLabels StorageArray": Why.Reported,
  },
  "packages/Common/Server/Services/VMwareVCenterService.ts": {
    "Service.attachLabels VMwareVCenter": Why.Reported,
    "Service.writeConnectionServerColumns VMwareVCenter": Why.Reported,
  },
  "packages/Common/Server/Services/WorkflowService.ts": {
    "Service.ensureIncomingEmailSecretKey Workflow": Why.Setup,
  },
  "packages/Common/Server/Utils/AI/ResourceAccess/AiAgentResetAuditLog.ts": {
    "AiAgentResetAuditLog.record *": Why.Recorded,
  },
  "packages/Common/Server/Utils/AI/SRE/IncidentInvestigationRunner.ts": {
    "AIIncidentInvestigationRunner.runInvestigationEngine IncidentInternalNote":
      Why.Automation,
  },
  "packages/Common/Server/Utils/Activation/ProjectMilestoneBackfill.ts": {
    "ProjectMilestoneBackfill.backfill ProjectMilestone": Why.Migration,
  },
  "packages/Common/Server/Utils/CloudConnection/CloudConnectionResourceSync.ts":
    {
      "CloudConnectionResourceSync.archive CloudResource": Why.Reported,
      "CloudConnectionResourceSync.sync CloudResource": Why.Reported,
    },
  "packages/Common/Server/Utils/CustomField/CustomFieldOptionEditHooks.ts": {
    "applyCustomFieldOptionEdit *": Why.FollowOn,
  },
  "packages/Common/Server/Utils/CustomField/CustomFieldOptionRename.ts": {
    "renameCustomFieldOptionsInFormTemplates Form": Why.FollowOn,
    "renameCustomFieldOptionsInTableViews TableView": Why.FollowOn,
  },
  "packages/Common/Server/Utils/CustomField/CustomFieldRename.ts": {
    "renameCustomFieldInTableViews TableView": Why.FollowOn,
  },
  "packages/Common/Server/Utils/CustomRole/CustomRoleSync.ts": {
    "CustomRoleSync.createApiKeyCopy ApiKeyPermission": Why.FollowOn,
    "CustomRoleSync.createCopy TeamPermission": Why.FollowOn,
  },
  "packages/Common/Server/Utils/DataObservability/DataAlertFeedbackRecorder.ts":
    {
      "DataAlertFeedbackRecorder.retune DataAsset": Why.Derived,
    },
  "packages/Common/Server/Utils/DataObservability/DataCheckIngest.ts": {
    "DataCheckIngest.recordResults DataCheck": Why.Reported,
  },
  "packages/Common/Server/Utils/DataObservability/DataProductCheck.ts": {
    "DataProductCheck.checkProduct DataProduct": Why.Reported,
  },
  "packages/Common/Server/Utils/DataObservability/DbtIngest.ts": {
    "DbtIngest.recordTables DataAsset": Why.Reported,
    "DbtIngest.upsertTestCheck DataCheck": Why.Reported,
  },
  "packages/Common/Server/Utils/DataObservability/TableHealthIngest.ts": {
    "TableHealthIngest.linkDatabaseServer DataStore": Why.Reported,
    "TableHealthIngest.recordFailure DataStore": Why.Reported,
    "TableHealthIngest.recordSnapshot DataStore": Why.Reported,
    "TableHealthIngest.updateAsset DataAsset": Why.Reported,
    "TableHealthIngest.writeNewPersonalDataColumns DataStore": Why.Reported,
  },
  "packages/Common/Server/Utils/DataSecurity/DataSecurityDiscovery.ts": {
    "DataSecurityDiscovery.archiveGone DataStore": Why.Reported,
    "DataSecurityDiscovery.ensureTelemetryStore DataStore": Why.Reported,
    "DataSecurityDiscovery.upsert DataStore": Why.Reported,
  },
  "packages/Common/Server/Utils/DataSecurity/DataSecurityEvaluator.ts": {
    "DataSecurityEvaluator.evaluateStore DataStore": Why.Reported,
  },
  "packages/Common/Server/Utils/DataSecurity/DataSecurityFindingWriter.ts": {
    "DataSecurityFindingWriter.recordFailedScan DataStore": Why.Reported,
    "DataSecurityFindingWriter.updateStore DataStore": Why.Reported,
    "DataSecurityFindingWriter.writeFindings DataStoreFinding": Why.Reported,
  },
  "packages/Common/Server/Utils/DataSecurity/DataSecurityIntegrations.ts": {
    "DataSecurityIntegrations.linkIssue DataSecurityIssue": Why.Bookkeeping,
    "DataSecurityIntegrations.notifyOwners DataSecurityIssue": Why.Bookkeeping,
  },
  "packages/Common/Server/Utils/DataSecurity/DataSecurityIssueReconciler.ts": {
    "DataSecurityIssueReconciler.touch DataSecurityIssue": Why.Reported,
  },
  "packages/Common/Server/Utils/DataSecurity/DataSecurityProbeClaim.ts": {
    "(module) DataStore": Why.Bookkeeping,
  },
  "packages/Common/Server/Utils/DataSecurity/DataSecurityRunner.ts": {
    "DataSecurityRunner.claimDueStores DataStore": Why.Bookkeeping,
    "DataSecurityRunner.markScrubbed DataStoreFinding": Why.Bookkeeping,
  },
  "packages/Common/Server/Utils/Database/ListOrderMaintainer.ts": {
    "ListOrderMaintainer.writeChanges *": Why.Derived,
  },
  "packages/Common/Server/Utils/HostCollector/HostCollectorAgent.ts": {
    "HostCollectorAgent.respondToMessage Host": Why.Reported,
  },
  "packages/Common/Server/Utils/Huntress/HuntressConnectionsToWorkflows.ts": {
    "(module) Incident": Why.Migration,
  },
  "packages/Common/Server/Utils/Monitor/MonitorResource.ts": {
    "MonitorResourceUtil.monitorResource Monitor": Why.Reported,
  },
  "packages/Common/Server/Utils/Monitor/MonitorStatusTimelineReconciler.ts": {
    "MonitorStatusTimelineReconciler.repairStaleOpenRowsBatch MonitorStatusTimeline":
      Why.Bookkeeping,
    "MonitorStatusTimelineReconciler.restoreMissingStatusTimelinesBatch MonitorStatusTimeline":
      Why.Bookkeeping,
  },
  /*
   * The hourly age-out (#6389) forgetting the Hide from map preference of
   * a discovered device it removes, one nothing has seen for the project's
   * retention: the row the preference names is gone, and nothing draws it
   * again. Nobody hid or showed anything.
   */
  "packages/Common/Server/Utils/NetworkDevice/DiscoveredDeviceAgeOut.ts": {
    "buildAgeOutStatement NetworkTopologySuppression": Why.Bookkeeping,
  },
  /*
   * Hide from map and Show on map for a selection of discovered devices,
   * and the map's Show them (#5775): each suppression written or removed
   * is the person's Create or Delete, as the map's own Hide and Show are.
   */
  "packages/Common/Server/Utils/NetworkDevice/DiscoveredDevices.ts": {
    "DiscoveredDevices.removeSuppressions NetworkTopologySuppression":
      Why.Recorded,
    "DiscoveredDevices.writeSuppressions NetworkTopologySuppression":
      Why.Recorded,
  },
  "packages/Common/Server/Utils/OnCall/FirstPagedAt.ts": {
    "(module) Alert": Why.Bookkeeping,
    "(module) Incident": Why.Bookkeeping,
  },
  "packages/Common/Server/Utils/OnCall/ScheduleLayersSave.ts": {
    "ScheduleLayersSave.insertLayerUsers OnCallDutyPolicyScheduleLayerUser":
      Why.Recorded,
    "ScheduleLayersSave.write OnCallDutyPolicyScheduleLayer": Why.Recorded,
    "ScheduleLayersSave.write OnCallDutyPolicyScheduleLayerUser": Why.Recorded,
  },
  "packages/Common/Server/Utils/OpenStack/OpenStackCheckStore.ts": {
    "OpenStackCheckStore.claimDueIds OpenStackCloudCheck": Why.Reported,
    "OpenStackCheckStore.noteWhyNotRunning *": Why.Reported,
    "OpenStackCheckStore.recordReport *": Why.Reported,
  },
  "packages/Common/Server/Utils/OpenStack/OpenStackConnectionTestStore.ts": {
    "OpenStackConnectionTestStore.claimPendingTests *": Why.Bookkeeping,
    "OpenStackConnectionTestStore.recordTestReport *": Why.Reported,
  },
  "packages/Common/Server/Utils/OpenStack/OpenStackProbeCollectionStore.ts": {
    "OpenStackProbeCollectionStore.recordCollectionReport *": Why.Reported,
  },
  "packages/Common/Server/Utils/Rules/RuleAddedLabels.ts": {
    "RuleAddedLabels.add *": Why.Recorded,
  },
  "packages/Common/Server/Utils/Runbook/RunbookApprovalsMove.ts": {
    "(module) Runbook": Why.Migration,
  },
  "packages/Common/Server/Utils/Runbook/RunbookCredentialsRemoval.ts": {
    "(module) KubernetesCluster": Why.Migration,
  },
  "packages/Common/Server/Utils/Runbook/RunbookVariablesMove.ts": {
    "(module) Runbook": Why.Migration,
  },
  /*
   * A sample project's records (#6808), filled by OneUptime as it makes the
   * project and before it is handed to the person who asked: the sample
   * service's description, and the creation times that make its history
   * read as history.
   */
  "packages/Common/Server/Utils/SampleProject/SampleProjectSeeder.ts": {
    "SampleProjectSeeder.backdate *": Why.Setup,
    "SampleProjectSeeder.createServiceAndTelemetry Service": Why.Setup,
  },
  "packages/Common/Server/Utils/ScheduledMaintenance/ExternalCalendar/ExternalCalendarRefresher.ts":
    {
      "ExternalCalendarRefresher.readCalendar ScheduledMaintenanceExternalCalendar":
        Why.Reported,
    },
  "packages/Common/Server/Utils/SecurityCase/SecurityCaseIngest.ts": {
    "SecurityCaseIngest.addDetection SecurityCase": Why.Reported,
    "SecurityCaseIngest.recordRepeat SecurityCase": Why.Reported,
  },
  "packages/Common/Server/Utils/SecurityCase/SecurityCaseNotifications.ts": {
    "SecurityCaseNotifications.notifyPriorityReached SecurityCase":
      Why.Bookkeeping,
  },
  "packages/Common/Server/Utils/SecurityCase/SecurityCaseTargetCheck.ts": {
    "SecurityCaseTargetCheck.checkCase SecurityCase": Why.Bookkeeping,
  },
  "packages/Common/Server/Utils/SecurityEvent/Hunts/SecurityHuntScheduler.ts": {
    "SecurityHuntScheduler.record SecurityHunt": Why.Bookkeeping,
  },
  "packages/Common/Server/Utils/SecurityPlaybook/SecurityPlaybookActions.ts": {
    "SecurityPlaybookActions.addCaseLabels SecurityCase": Why.Automation,
    "SecurityPlaybookActions.declareIncidentForCase SecurityCase":
      Why.Automation,
  },
  "packages/Common/Server/Utils/SecurityPlaybook/SecurityPlaybookEngine.ts": {
    "SecurityPlaybookEngine.executeRun SecurityPlaybookRun": Why.Automation,
    "SecurityPlaybookEngine.finishRun SecurityPlaybookRun": Why.Automation,
    "SecurityPlaybookEngine.recoverRuns SecurityPlaybookRun": Why.Automation,
    "SecurityPlaybookEngine.runSteps SecurityPlaybookRun": Why.Automation,
  },
  "packages/Common/Server/Utils/Slo/SloLegacyMonitorLabelAdoption.ts": {
    "(module) ServiceLevelObjectiveMonitorRule": Why.Migration,
  },
  /*
   * A burn rate rule or an error budget policy tier forgetting that it has an
   * alert or incident open: the worker's lifecycle stamps, which the audit
   * log ignores on both models.
   */
  "packages/Common/Server/Utils/Slo/SloRecordSourceSettings.ts": {
    "SloRecordSourceSettings.clearOpenOutputState *": Why.Bookkeeping,
  },
  "packages/Common/Server/Utils/StatusPage/SubscriberNotificationClaim.ts": {
    "SubscriberNotificationClaim.claim *": Why.Bookkeeping,
    "SubscriberNotificationClaim.failInterrupted *": Why.Bookkeeping,
  },
  "packages/Common/Server/Utils/Telemetry/EntityRegistry.ts": {
    "reconcileByNaturalKey *": Why.Reported,
  },
  "packages/Common/Server/Utils/Telemetry/ResourceHeartbeat.ts": {
    "ResourceHeartbeat.writeOnce *": Why.Reported,
  },
  "packages/Common/Server/Utils/Telemetry/Telemetry.ts": {
    "TelemetryUtil.updateExistingMetricType MetricType": Why.Reported,
  },
  "packages/Common/Server/Utils/VMware/VMwareProbeCollectionStore.ts": {
    "VMwareProbeCollectionStore.recordCollectionReport *": Why.Reported,
  },
};

/*
 * Writes made in a transaction and recorded once it has committed, by the
 * function that runs it: AuditLogService.record* takes no transaction, so an
 * entry written before the commit could stand for a change a rollback undid.
 * The function such a write is in records nothing itself; the one named here
 * calls it, and records - by file, "<the function the write is in>": "<the
 * function that records it>". Each write is decided Recorded in DECIDED too.
 */
const RECORDED_ONCE_COMMITTED: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  // A schedule's layers, saved in one go (ScheduleLayersSave.save).
  "packages/Common/Server/Utils/OnCall/ScheduleLayersSave.ts": {
    "ScheduleLayersSave.insertLayerUsers": "ScheduleLayersSave.save",
    "ScheduleLayersSave.write": "ScheduleLayersSave.save",
  },
};

interface Site extends HookFreeWrite {
  // Whether it writes what the audit log tracks of an audited model.
  isTracked: boolean;
  key: string;
}

const SKIPPED: ReadonlySet<string> = new Set<string>([
  "_id",
  "id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "version",
  "slug",
]);

let sites: Array<Site> = [];
let scanner: HookFreeWriteScanner;

function relativeEe(file: string): boolean {
  return file.startsWith("ee/");
}

// DatabaseService's public *WithoutHooks methods, read from its source.
function hookFreeWriteMethods(): Set<string> {
  const file: string = path.join(
    COMMON_ROOT,
    "Server/Services/DatabaseService.ts",
  );
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const methods: Set<string> = new Set<string>();

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isMethodDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text.endsWith("WithoutHooks") &&
      !node.modifiers?.some((modifier: ts.ModifierLike): boolean => {
        return (
          modifier.kind === ts.SyntaxKind.PrivateKeyword ||
          modifier.kind === ts.SyntaxKind.ProtectedKeyword
        );
      })
    ) {
      methods.add(node.name.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return methods;
}

function modelOf(
  site: HookFreeWrite,
  byTable: Map<string, BaseModel>,
): BaseModel | null {
  if (site.modelFile) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const modelType: { new (): BaseModel } = require(
        path.join(COMMON_ROOT, "Models/DatabaseModels", site.modelFile),
      ).default;

      return new modelType();
    } catch {
      return null;
    }
  }

  return site.tableName ? byTable.get(site.tableName) || null : null;
}

// Whether a write reaches what an entry of `model` records.
function isTracked(site: HookFreeWrite, model: BaseModel | null): boolean {
  // A helper handed any service: decided by what the helper is for.
  if (!model) {
    return !site.tableName;
  }

  const audit: EnableAuditLogOn | undefined = model.enableAuditLogOn;
  const action: "create" | "update" | "delete" =
    site.action === HookFreeWriteAction.Create
      ? "create"
      : site.action === HookFreeWriteAction.Delete
        ? "delete"
        : "update";

  if (!audit || !audit[action]) {
    return false;
  }

  if (action !== "update" || site.columns === null) {
    return true;
  }

  const ignored: Set<string> = new Set<string>(audit.ignoreColumns || []);
  const access: Record<string, { read?: Array<unknown> }> =
    getColumnAccessControlForAllColumns(model) as Record<
      string,
      { read?: Array<unknown> }
    >;

  return site.columns.some((column: string): boolean => {
    const read: Array<unknown> | undefined = access[column]?.read;

    return (
      model.isTableColumn(column) &&
      !SKIPPED.has(column) &&
      !ignored.has(column) &&
      !(Array.isArray(read) && read.length === 0)
    );
  });
}

function decisionOf(site: Site): Why | undefined {
  const file: Readonly<Record<string, Why>> | undefined = DECIDED[site.file];

  return file ? file[site.key] : undefined;
}

/*
 * Whether a write is recorded once its transaction commits: the function
 * RECORDED_ONCE_COMMITTED names for it records, and calls the function the
 * write is in.
 */
function isRecordedOnceCommitted(site: Site): boolean {
  const recorder: string | undefined =
    RECORDED_ONCE_COMMITTED[site.file]?.[site.inFunction];

  if (!recorder) {
    return false;
  }

  const file: string = path.join(REPOSITORY_ROOT, site.file);

  return (
    scanner.isRecordingFunction(file, recorder) &&
    scanner.callsInFile(file, recorder, site.inFunction)
  );
}

beforeAll(() => {
  scanner = new HookFreeWriteScanner({
    repoRoot: REPOSITORY_ROOT,
    commonRoot: COMMON_ROOT,
    writeMethods: new Set<string>(
      Array.from(hookFreeWriteMethods()).filter((method: string): boolean => {
        return !HOOK_FREE_READS.has(method);
      }),
    ),
  });

  const byTable: Map<string, BaseModel> = new Map<string, BaseModel>();

  for (const modelType of AllModelTypes as Array<{ new (): BaseModel }>) {
    const model: BaseModel = new modelType();

    if (model.tableName) {
      byTable.set(model.tableName, model);
    }
  }

  sites = scanner.scan(SCAN_ROOTS).map((write: HookFreeWrite): Site => {
    const model: BaseModel | null = modelOf(write, byTable);

    return {
      ...write,
      isTracked: isTracked(write, model),
      key: `${write.inFunction} ${model?.tableName || write.tableName || "*"}`,
    };
  });
}, 600000);

describe("writes that go round DatabaseService's hooks", () => {
  test("are found in all four forms, where they are known to be", () => {
    const where: (data: {
      file: string;
      form: HookFreeWriteForm;
    }) => Array<Site> = (data: {
      file: string;
      form: HookFreeWriteForm;
    }): Array<Site> => {
      return sites.filter((site: Site): boolean => {
        return site.file === data.file && site.form === data.form;
      });
    };

    expect(
      where({
        file: "packages/App/FeatureSet/Runbook/API/Runbook.ts",
        form: HookFreeWriteForm.WithoutHooks,
      }).length,
    ).toBeGreaterThan(0);
    expect(
      where({
        file: "packages/Common/Server/Utils/Rules/RuleAddedLabels.ts",
        form: HookFreeWriteForm.Relation,
      }).length,
    ).toBe(1);
    expect(
      where({
        file: "packages/App/FeatureSet/Identity/Utils/SsoTeamMembership.ts",
        form: HookFreeWriteForm.IgnoreHooksCreate,
      }).length,
    ).toBe(1);
    expect(
      where({
        file: "packages/Common/Server/Utils/Telemetry/TelemetryExceptionMerge.ts",
        form: HookFreeWriteForm.RawSql,
      }).length,
    ).toBeGreaterThan(0);
  });

  test("read every write method DatabaseService has that skips its hooks", () => {
    const methods: Set<string> = hookFreeWriteMethods();

    for (const read of HOOK_FREE_READS) {
      expect([read, methods.has(read)]).toEqual([read, true]);
    }

    expect(methods.size - HOOK_FREE_READS.size).toBeGreaterThanOrEqual(5);
  });

  test("of what the audit log tracks are all decided: recorded, or OneUptime's own and why", () => {
    const undecided: Array<string> = sites
      .filter((site: Site): boolean => {
        return site.isTracked && decisionOf(site) === undefined;
      })
      .map((site: Site): string => {
        return `${site.file}:${site.line} ${site.call} in "${site.key}" (${site.form}): record it with AuditLogService.record*, or list it in DECIDED with why it is OneUptime's own`;
      });

    expect(undecided).toEqual([]);
  });

  test("decided as recorded are recorded: by the function they are in, or once committed by the one that runs it", () => {
    const unrecorded: Array<string> = sites
      .filter((site: Site): boolean => {
        return (
          site.isTracked &&
          decisionOf(site) === Why.Recorded &&
          !site.isRecorded &&
          !isRecordedOnceCommitted(site)
        );
      })
      .map((site: Site): string => {
        return `${site.file}:${site.line} ${site.key}`;
      });

    expect(unrecorded).toEqual([]);
  });

  test("every decision still matches a write", () => {
    const eeIsHere: boolean = fs.existsSync(path.join(EE_ROOT, "Server"));
    const stale: Array<string> = [];

    for (const [file, decisions] of Object.entries(DECIDED)) {
      if (relativeEe(file) && !eeIsHere) {
        continue;
      }

      for (const key of Object.keys(decisions)) {
        if (
          !sites.some((site: Site): boolean => {
            return site.isTracked && site.file === file && site.key === key;
          })
        ) {
          stale.push(`${file} ${key}`);
        }
      }
    }

    expect(stale).toEqual([]);
  });

  test("every function recorded once committed still writes, and its writes are decided Recorded", () => {
    const eeIsHere: boolean = fs.existsSync(path.join(EE_ROOT, "Server"));
    const wrong: Array<string> = [];

    for (const [file, writers] of Object.entries(RECORDED_ONCE_COMMITTED)) {
      if (relativeEe(file) && !eeIsHere) {
        continue;
      }

      for (const writer of Object.keys(writers)) {
        const writes: Array<Site> = sites.filter((site: Site): boolean => {
          return (
            site.isTracked && site.file === file && site.inFunction === writer
          );
        });

        if (writes.length === 0) {
          wrong.push(`${file} ${writer}: writes nothing the audit log tracks`);
        }

        for (const site of writes) {
          if (decisionOf(site) !== Why.Recorded) {
            wrong.push(
              `${file}:${site.line} ${site.key}: not decided Recorded`,
            );
          }
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  test("every reason not to record says why", () => {
    for (const reason of Object.values(WHY_NOT_RECORDED)) {
      expect(reason.length).toBeGreaterThan(40);
    }
  });
});

/*
 * Labels a label rule adds (issue #6284): every label rule engine adds them
 * through RuleAddedLabels, which records each record it changes, and hands
 * it who ran the rule - so a new engine cannot forget either.
 */
describe("label rule engines", () => {
  const SERVICES: string = path.join(COMMON_ROOT, "Server/Services");
  const engines: Array<string> = fs
    .readdirSync(SERVICES)
    .filter((name: string): boolean => {
      return name.endsWith("LabelRuleEngineService.ts");
    });

  test("are all found", () => {
    expect(engines.length).toBeGreaterThanOrEqual(34);
  });

  test.each(
    fs
      .readdirSync(path.join(COMMON_ROOT, "Server/Services"))
      .filter((name: string): boolean => {
        return name.endsWith("LabelRuleEngineService.ts");
      }),
  )(
    "%s adds a rule's labels only through RuleAddedLabels, with who ran the rule",
    (name: string) => {
      const relative: string = `packages/Common/Server/Services/${name}`;
      const text: string = fs.readFileSync(path.join(SERVICES, name), "utf8");

      // No label is written round the helper.
      expect(
        sites.filter((site: Site): boolean => {
          return (
            site.file === relative && site.form === HookFreeWriteForm.Relation
          );
        }).length,
      ).toBe(
        // The network device rules' Run now adds a page at once, and records it.
        name === "NetworkDeviceLabelRuleEngineService.ts" ? 1 : 0,
      );

      const source: ts.SourceFile = ts.createSourceFile(
        name,
        text,
        ts.ScriptTarget.Latest,
        true,
      );
      let addsThroughTheHelper: boolean = false;
      let runPassesProps: boolean = false;

      const passesProps: (call: ts.CallExpression) => boolean = (
        call: ts.CallExpression,
      ): boolean => {
        const argument: ts.Expression | undefined = call.arguments[0];

        return Boolean(
          argument &&
            ts.isObjectLiteralExpression(argument) &&
            argument.properties.some(
              (property: ts.ObjectLiteralElementLike): boolean => {
                return (
                  ts.isPropertyAssignment(property) &&
                  ts.isIdentifier(property.name) &&
                  property.name.text === "props" &&
                  property.initializer.getText(source) === "data.props"
                );
              },
            ),
        );
      };

      const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression)
        ) {
          const callee: string = node.expression.getText(source);

          if (callee === "RuleAddedLabels.add" && passesProps(node)) {
            addsThroughTheHelper = true;
          }

          if (callee === "this.applyRules" && passesProps(node)) {
            let method: ts.Node | undefined = node.parent;

            while (method && !ts.isMethodDeclaration(method)) {
              method = method.parent;
            }

            if (
              method &&
              ts.isMethodDeclaration(method) &&
              method.name.getText(source) === "applyRulesToExistingResource"
            ) {
              runPassesProps = true;
            }
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(source);

      expect({ name, addsThroughTheHelper, runPassesProps }).toEqual({
        name,
        addsThroughTheHelper: true,
        runPassesProps: true,
      });
    },
  );
});

/*
 * Owners an owner rule adds, and records a privacy rule makes private
 * (issue #6300). Run now writes them through DatabaseService, which records
 * them - but written as plain root they were System's: kept only when the
 * project stores system events, and saying nobody ran the rule. Every owner
 * and privacy rule engine now writes them with RuleRunWriteProps, which
 * carries who ran the rule (OnBehalfOfProps) and nobody for a rule applied
 * on create, and hands its Run now's props on to every method that writes.
 * So a new engine that forgets - a write as plain root, a write round the
 * hooks, a helper or a run that drops the props - fails here.
 */
describe("owner and privacy rule engines", () => {
  const SERVICES: string = path.join(COMMON_ROOT, "Server/Services");
  const WRITE_PROPS: string = "RuleRunWriteProps.get(data.props)";

  // Calls that write a row through DatabaseService, or through the owner helpers.
  const WRITE_METHODS: ReadonlySet<string> = new Set<string>([
    "addOwners",
    "create",
    "createMany",
    "createOwner",
    "deleteBy",
    "deleteOneBy",
    "deleteOneById",
    "updateBy",
    "updateOneBy",
    "updateOneById",
  ]);

  const ENGINES: Array<string> = fs
    .readdirSync(SERVICES)
    .filter((name: string): boolean => {
      return (
        name.endsWith("OwnerRuleEngineService.ts") ||
        name.endsWith("PrivacyRuleEngineService.ts")
      );
    })
    .sort();

  interface EngineWrites {
    name: string;
    // How many rows it writes, and how many of them say who ran the rule.
    writes: number;
    writesWithoutWhoRanIt: Array<string>;
    // Writing methods called without the props they were handed.
    callsDroppingProps: Array<string>;
    runPassesProps: boolean;
  }

  // The object a call is handed, when it is handed one.
  const objectArgument: (
    call: ts.CallExpression,
  ) => ts.ObjectLiteralExpression | null = (
    call: ts.CallExpression,
  ): ts.ObjectLiteralExpression | null => {
    const argument: ts.Expression | undefined = call.arguments[0];

    return argument && ts.isObjectLiteralExpression(argument) ? argument : null;
  };

  const propertyText: (
    literal: ts.ObjectLiteralExpression,
    key: string,
    source: ts.SourceFile,
  ) => string | null = (
    literal: ts.ObjectLiteralExpression,
    key: string,
    source: ts.SourceFile,
  ): string | null => {
    for (const property of literal.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === key
      ) {
        return property.initializer.getText(source);
      }
    }

    return null;
  };

  const methodOf: (node: ts.Node) => ts.MethodDeclaration | null = (
    node: ts.Node,
  ): ts.MethodDeclaration | null => {
    let current: ts.Node | undefined = node.parent;

    while (current && !ts.isMethodDeclaration(current)) {
      current = current.parent;
    }

    return current && ts.isMethodDeclaration(current) ? current : null;
  };

  function readEngine(name: string): EngineWrites {
    const text: string = fs.readFileSync(path.join(SERVICES, name), "utf8");
    const source: ts.SourceFile = ts.createSourceFile(
      name,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    const lineOf: (node: ts.Node) => number = (node: ts.Node): number => {
      return source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    };

    const writesIn: Map<string, number> = new Map<string, number>();
    const thisCalls: Array<{
      caller: string;
      callee: string;
      call: ts.CallExpression;
    }> = [];
    const result: EngineWrites = {
      name,
      writes: 0,
      writesWithoutWhoRanIt: [],
      callsDroppingProps: [],
      runPassesProps: false,
    };

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        const method: ts.MethodDeclaration | null = methodOf(node);
        const caller: string = method ? method.name.getText(source) : "";
        const called: string = node.expression.name.text;

        if (node.expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
          thisCalls.push({ caller, callee: called, call: node });
        } else if (WRITE_METHODS.has(called)) {
          const literal: ts.ObjectLiteralExpression | null =
            objectArgument(node);
          // An object's props, or the last of a list of arguments (addOwners).
          const last: ts.Expression | undefined =
            node.arguments[node.arguments.length - 1];
          const props: string | null = literal
            ? propertyText(literal, "props", source)
            : last
              ? last.getText(source)
              : null;

          result.writes++;
          writesIn.set(caller, (writesIn.get(caller) || 0) + 1);

          if (props !== WRITE_PROPS) {
            result.writesWithoutWhoRanIt.push(
              `${name}:${lineOf(node)} ${node.expression.getText(source)} with ${props}`,
            );
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(source);

    // The methods that write, by themselves or through another that does.
    const writing: Set<string> = new Set<string>(writesIn.keys());
    let grew: boolean = true;

    while (grew) {
      grew = false;

      for (const thisCall of thisCalls) {
        if (writing.has(thisCall.callee) && !writing.has(thisCall.caller)) {
          writing.add(thisCall.caller);
          grew = true;
        }
      }
    }

    for (const thisCall of thisCalls) {
      if (!writing.has(thisCall.callee)) {
        continue;
      }

      const literal: ts.ObjectLiteralExpression | null = objectArgument(
        thisCall.call,
      );
      const passesProps: boolean = Boolean(
        literal && propertyText(literal, "props", source) === "data.props",
      );

      if (thisCall.callee === "applyRules") {
        // A rule applied on create names nobody; Run now names who ran it.
        if (thisCall.caller === "applyRulesToExistingResource") {
          result.runPassesProps = result.runPassesProps || passesProps;
        }

        continue;
      }

      if (!passesProps) {
        result.callsDroppingProps.push(
          `${name}:${lineOf(thisCall.call)} this.${thisCall.callee} from ${thisCall.caller}`,
        );
      }
    }

    return result;
  }

  test("are all found", () => {
    expect(
      ENGINES.filter((name: string): boolean => {
        return name.endsWith("OwnerRuleEngineService.ts");
      }).length,
    ).toBeGreaterThanOrEqual(34);
    expect(
      ENGINES.filter((name: string): boolean => {
        return name.endsWith("PrivacyRuleEngineService.ts");
      }).length,
    ).toBeGreaterThanOrEqual(4);
  });

  test.each(ENGINES)(
    "%s writes through DatabaseService, with who ran the rule",
    (name: string) => {
      // No owner, and no privacy, is written round DatabaseService's audit hook.
      expect(
        sites
          .filter((site: Site): boolean => {
            return site.file === `packages/Common/Server/Services/${name}`;
          })
          .map((site: Site): string => {
            return `${site.file}:${site.line} ${site.call}`;
          }),
      ).toEqual([]);

      const engine: EngineWrites = readEngine(name);

      expect(engine.writes).toBeGreaterThan(0);
      expect(engine).toEqual({
        name,
        writes: engine.writes,
        writesWithoutWhoRanIt: [],
        callsDroppingProps: [],
        runPassesProps: true,
      });
    },
  );
});

/*
 * EVERY RULE'S RUN NOW, WHATEVER IT DOES (issues #6300, #6323, #6324).
 *
 * What a Run now changes is the person's in the audit log only if every
 * write it makes carries who ran it. The label, owner and privacy engines
 * are held to that above. Here is the rest - a status page or SLO monitor
 * rule's sync, and the network rules' runs - from the route that knows who
 * ran it, through the runner, to every write their engines reach
 * (RunNowWriteScan). Every kind of rule a Run now runs is held by one of
 * these blocks, so a new kind of rule, a new network route, or a sync that
 * forgets to hand on who ran it fails here until it does. The paths nobody
 * runs by hand - a sync after a save, a monitor's own change, the automatic
 * import of new scan results - hand on nobody, and stay OneUptime's own.
 */
describe("every rule's Run now", () => {
  const SERVICES: string = "packages/Common/Server/Services";
  const RUNNER: string =
    "packages/Common/Server/Utils/Rules/RuleRun/RuleRunner.ts";
  const RULE_RUN_ROUTE: string =
    "packages/App/FeatureSet/BaseAPI/API/RuleRun.ts";
  const NETWORK_RUN_ROUTES: string =
    "packages/App/FeatureSet/BaseAPI/API/NetworkRuleRun.ts";

  interface RunNowEntry {
    // The engine's file, from the repository's root.
    file: string;
    // The service the route or the runner calls it on.
    service: string;
    // The method that is the Run now.
    entry: string;
  }

  // The rule run route's syncs, by the kind of rule they run.
  const SYNCS: Record<string, RunNowEntry> = {
    [RuleRunAction.SyncStatusPageMonitors]: {
      file: `${SERVICES}/StatusPageMonitorRuleEngineService.ts`,
      service: "StatusPageMonitorRuleEngineService",
      entry: "syncResourcesForRule",
    },
    [RuleRunAction.SyncSloMonitors]: {
      file: `${SERVICES}/ServiceLevelObjectiveMonitorRuleEngineService.ts`,
      service: "ServiceLevelObjectiveMonitorRuleEngineService",
      entry: "syncMonitorsForSlo",
    },
  };

  // The network rules' Run now, by route.
  const NETWORK_RUNS: Record<string, RunNowEntry> = {
    "/network-site-assignment-rule/:ruleId/run": {
      file: `${SERVICES}/NetworkDeviceService.ts`,
      service: "NetworkDeviceService",
      entry: "applySiteAssignmentRuleToExistingDevices",
    },
    "/network-device-label-rule/:ruleId/run": {
      file: `${SERVICES}/NetworkDeviceLabelRuleEngineService.ts`,
      service: "NetworkDeviceLabelRuleEngineService",
      entry: "applyRuleToExistingNetworkDevices",
    },
    "/network-device-auto-import-rule/:ruleId/run": {
      file: `${SERVICES}/NetworkDeviceAutoImportRuleEngineService.ts`,
      service: "NetworkDeviceAutoImportRuleEngineService",
      entry: "applyRuleToCompletedScans",
    },
  };

  // What holds each kind of rule the rule run route runs.
  const HELD_BY: Record<string, string> = {
    [RuleRunAction.AddLabels]: "label rule engines",
    [RuleRunAction.AddOwners]: "owner and privacy rule engines",
    [RuleRunAction.MarkPrivate]: "owner and privacy rule engines",
    [RuleRunAction.SyncStatusPageMonitors]: "every rule's Run now",
    [RuleRunAction.SyncSloMonitors]: "every rule's Run now",
  };

  const ENTRIES: Array<[string, RunNowEntry]> = [
    ...Object.entries(SYNCS),
    ...Object.entries(NETWORK_RUNS),
  ];

  function sourceOf(relative: string): ts.SourceFile {
    return ts.createSourceFile(
      relative,
      fs.readFileSync(path.join(REPOSITORY_ROOT, relative), "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
  }

  // Every call in a node, with the text of its callee.
  function callsIn(
    node: ts.Node,
  ): Array<{ callee: string; call: ts.CallExpression }> {
    const found: Array<{ callee: string; call: ts.CallExpression }> = [];
    const source: ts.SourceFile = node.getSourceFile();

    const visit: (child: ts.Node) => void = (child: ts.Node): void => {
      if (ts.isCallExpression(child)) {
        found.push({ callee: child.expression.getText(source), call: child });
      }

      ts.forEachChild(child, visit);
    };

    visit(node);

    return found;
  }

  // The text of the `props` a call's object hands on, or null.
  function propsHandedOn(call: ts.CallExpression): string | null {
    const argument: ts.Expression | undefined = call.arguments[0];

    return argument && ts.isObjectLiteralExpression(argument)
      ? propertyText(argument, "props", call.getSourceFile())
      : null;
  }

  test("every kind of rule a Run now runs is held to writing with who ran it", () => {
    const actions: Array<string> = Object.values(RuleRunAction).sort();

    // A new kind of rule fails here until a block holds its Run now.
    expect(Object.keys(HELD_BY).sort()).toEqual(actions);

    for (const [action, block] of Object.entries(HELD_BY)) {
      if (block === "every rule's Run now") {
        expect([action, Boolean(SYNCS[action])]).toEqual([action, true]);
      }
    }

    /*
     * Every rule type of the registry: a sync this block reads, or an engine
     * of the files the label, owner and privacy blocks read.
     */
    const engineFiles: Set<string> = new Set<string>(
      fs.readdirSync(path.join(REPOSITORY_ROOT, SERVICES)),
    );

    for (const ruleType of Object.values(RuleRunType)) {
      const action: RuleRunAction = RuleRunTypeUtil.getAction(ruleType);

      if (SYNCS[action]) {
        continue;
      }

      const engine: string = `${ruleType}EngineService.ts`;
      const suffix: string =
        action === RuleRunAction.AddLabels
          ? "LabelRuleEngineService.ts"
          : action === RuleRunAction.AddOwners
            ? "OwnerRuleEngineService.ts"
            : "PrivacyRuleEngineService.ts";

      expect([
        ruleType,
        engineFiles.has(engine),
        engine.endsWith(suffix),
      ]).toEqual([ruleType, true, true]);
    }
  });

  test("the rule run route hands who ran it to the runner", () => {
    const runs: Array<{ callee: string; call: ts.CallExpression }> = callsIn(
      sourceOf(RULE_RUN_ROUTE),
    ).filter((found: { callee: string }): boolean => {
      return found.callee === "RuleRunner.runPass";
    });

    expect(runs).toHaveLength(1);
    expect(propsHandedOn(runs[0]!.call)).toBe("props");
  });

  test("the runner hands who ran it to every engine it runs", () => {
    const ENGINE_CALL: RegExp = /(EngineService|definition\.engine)\.\w+$/;
    const engineCalls: Array<{ callee: string; call: ts.CallExpression }> =
      callsIn(sourceOf(RUNNER)).filter((found: { callee: string }): boolean => {
        return ENGINE_CALL.test(found.callee);
      });

    // A new engine the runner runs fails here until this block reads it.
    expect(
      engineCalls
        .map((found: { callee: string }): string => {
          return found.callee;
        })
        .sort(),
    ).toEqual(
      [
        "definition.engine.applyRulesToExistingResource",
        ...Object.values(SYNCS).map((sync: RunNowEntry): string => {
          return `${sync.service}.${sync.entry}`;
        }),
      ].sort(),
    );

    for (const found of engineCalls) {
      expect([found.callee, propsHandedOn(found.call)]).toEqual([
        found.callee,
        "data.props",
      ]);
    }
  });

  test("every network rule's Run now route is held, and hands its engine who ran it", () => {
    const source: ts.SourceFile = sourceOf(NETWORK_RUN_ROUTES);
    const routes: Map<string, ts.CallExpression> = new Map<
      string,
      ts.CallExpression
    >();

    for (const found of callsIn(source)) {
      const first: ts.Expression | undefined = found.call.arguments[0];

      if (
        found.callee === "router.post" &&
        first &&
        ts.isStringLiteral(first)
      ) {
        routes.set(first.text, found.call);
      }
    }

    // A new network rule's Run now fails here until this block reads it.
    expect(Array.from(routes.keys()).sort()).toEqual(
      Object.keys(NETWORK_RUNS).sort(),
    );

    for (const [route, run] of Object.entries(NETWORK_RUNS)) {
      const handler: ts.CallExpression = routes.get(route)!;
      const engineCalls: Array<{ callee: string; call: ts.CallExpression }> =
        callsIn(handler).filter((found: { callee: string }): boolean => {
          return found.callee === `${run.service}.${run.entry}`;
        });

      expect([route, engineCalls.length]).toEqual([route, 1]);
      expect([route, propsHandedOn(engineCalls[0]!.call)]).toEqual([
        route,
        "props",
      ]);
    }
  });

  test.each(ENTRIES)(
    "%s's Run now writes everything it reaches with who ran it",
    (_kind: string, run: RunNowEntry) => {
      const reading: RunNowReading = readRunNow({
        file: path.join(REPOSITORY_ROOT, run.file),
        entry: run.entry,
      });

      expect(reading.hasEntry).toBe(true);
      // It writes, or records, something: not a vacuous pass.
      expect(reading.writes.length + reading.recorders.length).toBeGreaterThan(
        0,
      );
      expect({
        entry: run.entry,
        writesWithoutWhoRanIt: reading.writesWithoutWhoRanIt,
        recordersWithoutWhoRanIt: reading.recordersWithoutWhoRanIt,
        callsDroppingProps: reading.callsDroppingProps,
      }).toEqual({
        entry: run.entry,
        writesWithoutWhoRanIt: [],
        recordersWithoutWhoRanIt: [],
        callsDroppingProps: [],
      });

      /*
       * Nothing it reaches writes what the audit log tracks round the
       * hooks, unless it records that write itself.
       */
      expect(
        sites
          .filter((site: Site): boolean => {
            const method: string = site.inFunction.split(".").pop() || "";

            return (
              site.file === run.file &&
              site.isTracked &&
              reading.reached.includes(method) &&
              decisionOf(site) !== Why.Recorded
            );
          })
          .map((site: Site): string => {
            return `${site.file}:${site.line} ${site.key}`;
          }),
      ).toEqual([]);
    },
  );

  /*
   * The automatic import of new scan results names nobody: what it creates
   * is OneUptime's own, as a rule applied to a new record is.
   */
  test("the automatic import hands nobody's props to the import it shares with Run Now", () => {
    const file: string =
      NETWORK_RUNS["/network-device-auto-import-rule/:ruleId/run"]!.file;
    const reading: RunNowReading = readRunNow({
      file: path.join(REPOSITORY_ROOT, file),
      entry: "processCompletedScan",
    });

    expect(reading.reached).toEqual(
      expect.arrayContaining(["processCompletedScan", "importHostsFromScan"]),
    );

    // The sweep's own method, and every import it starts: no props at all.
    let sweep: ts.MethodDeclaration | null = null;

    const find: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isMethodDeclaration(node) &&
        node.name.getText() === "processCompletedScan"
      ) {
        sweep = node;
      }

      ts.forEachChild(node, find);
    };

    find(sourceOf(file));

    const imports: Array<{ callee: string; call: ts.CallExpression }> = callsIn(
      sweep!,
    ).filter((found: { callee: string }): boolean => {
      return found.callee === "this.importHostsFromScan";
    });

    expect(imports).toHaveLength(1);
    expect(propsHandedOn(imports[0]!.call)).toBeNull();
  });

  /*
   * A sync after a rule or a monitor is saved, a label's change re-syncing
   * the rules that name it: every caller of a Run now's engine but its own
   * route or runner hands on no props, so what it changes stays OneUptime's
   * own.
   */
  test("nothing but a Run now's route or runner hands these engines anybody's props", () => {
    const ENTRY_NAMES: ReadonlySet<string> = new Set<string>([
      ...ENTRIES.map(([, run]: [string, RunNowEntry]): string => {
        return run.entry;
      }),
      // The monitor side of the status page sync, which a Run now reaches too.
      "syncRulesForMonitor",
    ]);
    const RUN_NOW_CALLERS: ReadonlySet<string> = new Set<string>([
      RUNNER,
      NETWORK_RUN_ROUTES,
      ...ENTRIES.map(([, run]: [string, RunNowEntry]): string => {
        return run.file;
      }),
    ]);
    const callers: Array<string> = [];
    const handingProps: Array<string> = [];

    for (const root of SCAN_ROOTS) {
      for (const file of listTypeScriptFiles(root)) {
        const relative: string = path
          .relative(REPOSITORY_ROOT, file)
          .split(path.sep)
          .join("/");

        if (relative.includes("/Tests/") || RUN_NOW_CALLERS.has(relative)) {
          continue;
        }

        const text: string = fs.readFileSync(file, "utf8");

        if (
          !Array.from(ENTRY_NAMES).some((entry: string): boolean => {
            return text.includes(`.${entry}(`);
          })
        ) {
          continue;
        }

        const source: ts.SourceFile = ts.createSourceFile(
          relative,
          text,
          ts.ScriptTarget.Latest,
          true,
        );

        for (const found of callsIn(source)) {
          const callee: ts.Expression = found.call.expression;

          if (
            !ts.isPropertyAccessExpression(callee) ||
            !ENTRY_NAMES.has(callee.name.text)
          ) {
            continue;
          }

          const line: number =
            source.getLineAndCharacterOfPosition(found.call.getStart()).line +
            1;

          callers.push(`${relative}:${line}`);

          if (propsHandedOn(found.call) !== null) {
            handingProps.push(`${relative}:${line} ${found.callee}`);
          }
        }
      }
    }

    // The saves that sync: rules, monitors, labels, SLOs.
    expect(callers.length).toBeGreaterThanOrEqual(5);
    expect(handingProps).toEqual([]);
  });
});
