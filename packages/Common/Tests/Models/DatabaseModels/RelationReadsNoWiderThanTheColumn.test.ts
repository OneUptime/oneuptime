import {
  ANY_MEMBER,
  findWiderRelationReads,
  WiderRelationRead,
} from "./RelationReadWidening";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import Project from "../../../Models/DatabaseModels/Project";
import ColumnAccessControl from "../../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../../Types/Database/AccessControl/TableAccessControl";
import RelationReaders from "../../../Types/Database/RelationReaders";
import RelationReadersUtil from "../../../Types/Database/RelationReadersUtil";
import TableColumn, {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import TableMetadata from "../../../Types/Database/TableMetadata";
import Dictionary from "../../../Types/Dictionary";
import { ALWAYS_SELECTABLE_COLUMNS } from "../../../Types/HeldPermissions";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * NO RELATION READS A COLUMN WIDER THAN THE COLUMN'S OWN READ, BUT FOR A
 * REASON WRITTEN DOWN HERE (#10281).
 *
 * A record names others, and a read of it may take their columns along:
 * `{ dataStore: { name: true } }` on a data asset. A column marked
 * canReadOnRelationQuery and nothing else is a label: every reader of the
 * relation reads it, and the related record's own read is not asked
 * (QueryPermission.checkRelationQueryPermission). That is what made every
 * Viewer, Project Member and Telemetry role a reader of every data store's
 * sensitivity, exposure, risk score, open issues and cloud account, through
 * the data assets, data alerts and warehouse jobs in the store - all of it
 * marked so, while the Data Store keeps itself to the Security tiers:
 * "which buckets hold card numbers is exactly what an attacker wants to
 * know". 17.0.0 had done the same with its data types (#10238).
 *
 * So every label a relation reads for a reader its own read does not let in
 * is written down below, with why that reader may read it on the record
 * that names it (RelationReadWidening works out who reads what, the way the
 * server checks a read). A new one fails this test, until it is:
 *
 *   - held to its own read through relations (relationReaders:
 *     RelationReaders.ColumnReaders): the server reads it through a relation
 *     only for who may read it on the related record - a data store's
 *     sensitivity - and a page sends it for those readers alone
 *     (PermissionGate.getSelectReadableThroughRelations;
 *     RelationSelectColumnsWiring holds the pages to it); or
 *   - kept off relations (no canReadOnRelationQuery), and read from its own
 *     record where it is needed (#10238's StoreDataTypes); or
 *   - a label after all, written down below with its reason;
 *
 * and one written down that no relation reads wider any more fails it too,
 * until it comes off the list.
 *
 * Why not hold every column to its own read through every relation? Most of
 * these are labels by design: an Incident Viewer reads the names, states and
 * hosts of the monitors an incident is on, every member the policies and
 * schedules that paged them, and the roles that read a record read its
 * severity's color. Held to their own read, each of those pages would be
 * refused whole for those readers - one column the server refuses fails the
 * read - and a team's block on reading monitors would refuse every incident
 * page. In 17.1.0, 4,094 relation reads in 90 models were wider than the
 * column's own read on purpose, against the 42 security facts of a data store
 * and a project's reseller license that were not. #10311 weighs making the
 * column's own read the default once record pages show what they can
 * (#10282), with these labels declared where they are.
 */

interface WiderOnPurpose {
  // Why every reader of the relations that reach these columns may read them.
  reason: string;
  // The columns, by the table of the record a relation reaches.
  columns: Record<string, Array<string>>;
}

const WIDER_ON_PURPOSE: Array<WiderOnPurpose> = [
  {
    reason:
      "Which store a data asset, a data alert or a warehouse job is in, or a data security issue, finding, access, flow or scan is about: its name, its kind, its environment and whether it is still there. Data Observability's readers (Viewer, Project Member, the Telemetry tiers) read that much of the stores their tables are in - the name and the kind are copied onto every data asset for them - and a custom role given one of Data Security's records reads which store it is on. Nothing the store holds, how exposed it is, what its issues are or where it lives in a cloud: those follow the store's own read through every relation (#10281).",
    columns: {
      DataStore: ["environment", "isArchived", "kind", "name"],
    },
  },
  {
    reason:
      "The resources an incident, an alert, a monitor or a maintenance event is about, the ones a resource runs on or is reached through, and the probe a record was checked from: the record's page draws each one's card - its name, what it is, where it runs and is, its versions and how it is doing - for the Incident, Alert, Monitor and Scheduled Maintenance tiers and their custom roles, who read the incident and not the host. A resource's credentials never: an encrypted column is no relation's label (EncryptedColumnsStayOffRelations).",
    columns: {
      CephCluster: [
        "agentVersion",
        "cephVersion",
        "description",
        "fsid",
        "lastSeenAt",
        "name",
        "otelCollectorStatus",
      ],
      CloudResource: [
        "cloudAccountId",
        "cloudConnectionId",
        "cloudPlatform",
        "cloudProvider",
        "cloudRegion",
        "cloudResourceGroup",
        "cloudResourceKind",
        "cloudResourceType",
        "description",
        "healthSeverity",
        "lastSeenAt",
        "name",
        "resourceIdentifier",
        "runtimeName",
        "runtimeVersion",
      ],
      DatabaseServer: [
        "databaseIdentifier",
        "dbSystem",
        "description",
        "discoverySource",
        "lastSeenAt",
        "name",
        "otelCollectorStatus",
        "serverAddress",
        "serverPort",
      ],
      DockerHost: [
        "agentVersion",
        "description",
        "hostIdentifier",
        "lastSeenAt",
        "name",
        "osType",
        "osVersion",
        "otelCollectorStatus",
      ],
      DockerResource: [
        "containerId",
        "dockerHostId",
        "imageName",
        "kind",
        "lastSeenAt",
        "latestCpuPercent",
        "latestMemoryBytes",
        "metricsUpdatedAt",
        "name",
        "resourceCreationTimestamp",
        "state",
      ],
      DockerSwarmCluster: [
        "agentVersion",
        "description",
        "dockerVersion",
        "lastSeenAt",
        "name",
        "otelCollectorStatus",
        "swarmId",
      ],
      Host: [
        "agentVersion",
        "bootedAt",
        "cloudAccountId",
        "cloudPlatform",
        "cloudProvider",
        "cloudRegion",
        "containerRuntime",
        "cpuCores",
        "deploymentEnvironment",
        "description",
        "failedSystemdUnitCount",
        "failedSystemdUnits",
        "hostArch",
        "hostId",
        "hostIdentifier",
        "hostIpAddresses",
        "hostType",
        "lastSeenAt",
        "latestCpuPercent",
        "latestDiskMountpoint",
        "latestDiskPercent",
        "latestInodesMountpoint",
        "latestInodesPercent",
        "latestLoadAverage15m",
        "latestMemoryPercent",
        "latestSwapPercent",
        "name",
        "osType",
        "osVersion",
        "otelCollectorStatus",
        "processCount",
        "readingsUpdatedAt",
        "runtimeName",
        "runtimeVersion",
        "totalMemoryBytes",
      ],
      IoTFleet: [
        "agentVersion",
        "description",
        "lastSeenAt",
        "name",
        "otelCollectorStatus",
      ],
      KubernetesCluster: [
        "agentVersion",
        "aiAccessRunnerId",
        "clusterIdentifier",
        "description",
        "lastSeenAt",
        "name",
        "otelCollectorStatus",
        "provider",
      ],
      KubernetesContainer: [
        "image",
        "isReady",
        "kubernetesClusterId",
        "lastSeenAt",
        "latestCpuPercent",
        "latestMemoryBytes",
        "memoryLimitBytes",
        "metricsUpdatedAt",
        "name",
        "podName",
        "podNamespaceKey",
        "reason",
        "restartCount",
        "state",
      ],
      KubernetesResource: [
        "containerCount",
        "controllerCronJobName",
        "controllerDeploymentName",
        "hasDiskPressure",
        "hasMemoryPressure",
        "hasPidPressure",
        "healthSeverity",
        "isReady",
        "kind",
        "kubernetesClusterId",
        "lastSeenAt",
        "latestCpuPercent",
        "latestImageFsAvailableBytes",
        "latestImageFsCapacityBytes",
        "latestMemoryBytes",
        "latestMemoryPercent",
        "latestVolumeAvailableBytes",
        "latestVolumeCapacityBytes",
        "latestVolumeInodes",
        "latestVolumeInodesFree",
        "latestVolumeMeasuredAt",
        "latestVolumeUsedBaselineAt",
        "latestVolumeUsedBaselineBytes",
        "metricsUpdatedAt",
        "name",
        "namespaceKey",
        "phase",
        "resourceCreationTimestamp",
        "uid",
      ],
      NetworkDevice: [
        "currentMonitorStatusId",
        "description",
        "deviceModel",
        "deviceRole",
        "discoveredName",
        "discoveredNameSource",
        "dnsName",
        "hostname",
        "isMacAddressLearned",
        "isReachable",
        "isSnmpReachable",
        "lastPolledAt",
        "lastRebootedAt",
        "lastSeenAt",
        "lastSnmpSeenAt",
        "macAddress",
        "manufacturer",
        "monitorId",
        "monitoringMethod",
        "name",
        "networkDeviceRoleId",
        "oidTemplateId",
        "otherAddresses",
        "probeId",
        "ruleAssignedName",
        "siteId",
        "snmpCredentialProfileId",
        "snmpVersion",
        "sysDescr",
        "sysLocation",
        "sysName",
        "sysObjectId",
        "vendor",
      ],
      NetworkSite: [
        "address",
        "alertSeverityId",
        "code",
        "currentActiveAlertId",
        "currentMonitorStatusId",
        "depth",
        "description",
        "healthRollupPolicy",
        "lastRollupAt",
        "latitude",
        "longitude",
        "materializedPath",
        "name",
        "networkSiteTypeId",
        "offlineThresholdPercent",
        "parentSiteId",
        "probeId",
        "siteType",
        "snmpCredentialProfileId",
      ],
      OpenStackCloud: [
        "agentVersion",
        "collectionMethod",
        "description",
        "lastSeenAt",
        "name",
        "otelCollectorStatus",
      ],
      PodmanHost: [
        "agentVersion",
        "description",
        "hostIdentifier",
        "lastSeenAt",
        "name",
        "osType",
        "osVersion",
        "otelCollectorStatus",
      ],
      PodmanResource: [
        "containerId",
        "imageName",
        "kind",
        "lastSeenAt",
        "latestCpuPercent",
        "latestMemoryBytes",
        "metricsUpdatedAt",
        "name",
        "podmanHostId",
        "resourceCreationTimestamp",
        "state",
      ],
      Probe: [
        "checksLastLateAt",
        "checksLateSince",
        "connectionStatus",
        "devicePollsLastLateAt",
        "devicePollsLateSince",
        "iconFileId",
        "isGlobalProbe",
        "lastAlive",
        "name",
        "packetCaptureCapability",
        "reportedVersion",
      ],
      ProxmoxCluster: [
        "agentLastSeenAt",
        "agentVersion",
        "description",
        "lastSeenAt",
        "name",
        "otelCollectorStatus",
        "pveVersion",
      ],
      Service: [
        "cloudAccountId",
        "cloudPlatform",
        "cloudProvider",
        "cloudRegion",
        "deploymentEnvironment",
        "description",
        "lastSeenAt",
        "name",
        "runtimeName",
        "runtimeVersion",
        "serviceColor",
        "serviceLanguage",
        "serviceNamespace",
        "serviceVersion",
        "techStack",
        "telemetrySdkLanguage",
      ],
      ServiceLevelObjective: [
        "description",
        "name",
        "sliType",
        "targetPercentage",
      ],
      StorageArray: [
        "agentVersion",
        "capacityBytes",
        "description",
        "lastSeenAt",
        "name",
        "osName",
        "osVersion",
        "otelCollectorStatus",
        "reportedName",
        "storageSystem",
        "systemId",
        "usedBytes",
      ],
      VMwareVCenter: [
        "agentVersion",
        "collectionMethod",
        "description",
        "lastSeenAt",
        "name",
        "otelCollectorStatus",
      ],
    },
  },
  {
    reason:
      "The monitors an incident, an alert, a log, a data check or a rule names, and the template, network policy and group a monitor or a status page's resource comes from: their names, kinds and state wherever they are listed. And a monitor's steps, which an incident's and an alert's Root Cause card reads to chart the metric the monitor watched - the whole of what the monitor checks, for every reader of the incident or alert, which #10309 weighs narrowing to the query the card charts.",
    columns: {
      Monitor: [
        "autoProvisionedNetworkDeviceId",
        "currentMonitorStatusId",
        "disableActiveMonitoring",
        "disableActiveMonitoringBecauseOfManualIncident",
        "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent",
        "firstMeasuredAt",
        "isArchived",
        "monitorSteps",
        "monitorTemplateId",
        "monitorType",
        "name",
        "networkAlertPolicyId",
        "networkDeviceId",
        "networkDeviceTieSource",
      ],
      MonitorGroup: ["name"],
      MonitorTemplate: ["monitorType", "templateDescription", "templateName"],
      NetworkAlertPolicy: [
        "coveredDeviceCount",
        "isEnabled",
        "lastSyncAt",
        "monitorTemplateId",
        "name",
        "templateSyncedAt",
      ],
    },
  },
  {
    reason:
      "The project's labels for a record: its severity, state, status, priority, role or type, by its name, its color, its place in the project's list and which kind it is. A page draws them on every record that carries one, for every reader of the record: they say nothing the record does not.",
    columns: {
      AlertSeverity: ["color", "isArchived", "name", "order"],
      AlertState: [
        "color",
        "isAcknowledgedState",
        "isArchived",
        "isCreatedState",
        "isResolvedState",
        "name",
        "order",
      ],
      IncidentPostmortemStatus: [
        "color",
        "isArchived",
        "isCompletedStatus",
        "isDraftStatus",
        "isNotStartedStatus",
        "name",
        "order",
      ],
      IncidentRole: ["color", "isArchived", "name", "roleIcon"],
      IncidentSeverity: ["color", "isArchived", "name", "order"],
      IncidentState: [
        "color",
        "isAcknowledgedState",
        "isArchived",
        "isCreatedState",
        "isResolvedState",
        "name",
        "order",
      ],
      MonitorStatus: [
        "color",
        "isArchived",
        "isOfflineState",
        "isOperationalState",
        "name",
        "priority",
      ],
      NetworkDeviceRole: [
        "isCoreLayer",
        "isSnmpWalkable",
        "key",
        "name",
        "order",
        "topologyShape",
      ],
      NetworkSiteType: [
        "isUnitLevel",
        "name",
        "order",
        "parentNetworkSiteTypeId",
      ],
      ScheduledMaintenanceState: [
        "color",
        "isArchived",
        "isEndedState",
        "isOngoingState",
        "isResolvedState",
        "isScheduledState",
        "name",
        "order",
      ],
      SecurityCasePriority: [
        "acknowledgeWithinInMinutes",
        "color",
        "containWithinInMinutes",
        "isArchived",
        "isCriticalPriority",
        "isHighPriority",
        "isInformationalPriority",
        "isLowPriority",
        "isMediumPriority",
        "name",
        "order",
      ],
      SecurityCaseStatus: [
        "color",
        "isAcknowledgedStatus",
        "isArchived",
        "isClosedStatus",
        "isContainedStatus",
        "isNewStatus",
        "name",
        "order",
      ],
    },
  },
  {
    reason:
      "The incident, alert, episode or maintenance event a notification, an on-call log, a call, a runbook's run, a form's submission, a session replay, a data alert or a data security issue is about, by its number, its title and the state it is in; and the status pages an incident or a maintenance event is posted on, by name and look and which email and SMS settings they send with. Their readers read that much of it on the record that names it.",
    columns: {
      Alert: [
        "alertNumber",
        "alertNumberWithPrefix",
        "createdByProbeId",
        "currentAlertStateId",
        "title",
      ],
      AlertEpisode: ["title"],
      Incident: [
        "createdByProbeId",
        "currentIncidentStateId",
        "incidentNumber",
        "incidentNumberWithPrefix",
        "postmortemStatusId",
        "title",
      ],
      IncidentEpisode: ["title"],
      ScheduledMaintenance: [
        "scheduledMaintenanceNumber",
        "scheduledMaintenanceNumberWithPrefix",
        "title",
      ],
      StatusPage: [
        "callSmsConfigId",
        "defaultBarColor",
        "name",
        "smtpConfigId",
        "subscriberEmailNotificationFooterText",
      ],
    },
  },
  {
    reason:
      "Which on-call policy, escalation rule, schedule and run paged a person, and through which custom channel: every member reads their own on-call logs, notification logs and notification rules, each kept to them, and what paged them is the point of each; the Incident and Alert tiers read which policies an incident or an alert pages.",
    columns: {
      CustomNotificationChannel: ["name"],
      OnCallDutyPolicy: [
        "isArchived",
        "name",
        "repeatPolicyIfNoOneAcknowledgesNoOfTimes",
      ],
      OnCallDutyPolicyEscalationRule: [
        "escalateAfterInMinutes",
        "name",
        "onCallDutyPolicyId",
      ],
      OnCallDutyPolicyExecutionLog: [
        "executeNextEscalationRuleInMinutes",
        "isObserverPage",
        "lastEscalationRuleExecutedAt",
        "lastExecutedEscalationRuleId",
        "lastExecutedEscalationRuleOrder",
        "onCallDutyPolicyId",
        "onCallPolicyExecutionRepeatCount",
        "testPageFireDrillId",
        "testPageFireDrillMonitorId",
        "testPageRecordKind",
        "testPageSeverityId",
        "testPageWalksEscalation",
        "triggeredByAlertEpisodeId",
        "triggeredByIncidentEpisodeId",
      ],
      OnCallDutyPolicyExecutionLogTimeline: [
        "onCallDutyPolicyEscalationRuleId",
        "onCallDutyPolicyExecutionLogId",
        "onCallDutyPolicyId",
        "triggeredByAlertEpisodeId",
        "triggeredByAlertId",
        "triggeredByIncidentEpisodeId",
        "triggeredByIncidentId",
      ],
      OnCallDutyPolicySchedule: [
        "currentUserIdOnRoster",
        "name",
        "shiftConfigVersion",
      ],
    },
  },
  {
    reason:
      "The integration, agent or configuration a record runs with - an AI rule's LLM provider, runners, repositories and MCP servers, a status page's email and SMS settings, a host's collector configuration, a device's SNMP profile and OID template, a workflow's API key and role, an SSO provider's or a custom domain's domains, a video call's workspace rule - by its name and kind and whether it is working, which the record's page says. Never its credentials: an encrypted column is no relation's label (EncryptedColumnsStayOffRelations).",
    columns: {
      AIAgent: [
        "connectionStatus",
        "iconFileId",
        "isGlobalAIAgent",
        "lastAlive",
        "name",
      ],
      ApiKey: ["name"],
      CodeRepository: [
        "mainBranchName",
        "name",
        "organizationName",
        "productionReviewLlmProviderId",
        "repositoryHostedAt",
        "repositoryName",
        "repositoryUrl",
        "runnerId",
      ],
      CustomRole: ["name", "permissionCount"],
      Domain: ["domain", "isVerified"],
      ExternalMcpServer: ["isEnabled", "name"],
      HostCollectorConfig: ["currentVersionNumber", "name", "osType"],
      HostCollectorConfigVersion: ["hostCollectorConfigId", "versionNumber"],
      KubernetesAiAgent: [
        "connectionStatus",
        "kubernetesClusterId",
        "lastAliveAt",
      ],
      LlmProvider: ["isGlobalLlm", "name"],
      NetworkDeviceOidTemplate: ["name", "oids", "tables"],
      NetworkSnmpCredentialProfile: ["name", "snmpVersion"],
      ProjectCallSMSConfig: ["name", "usedFor"],
      ProjectSCIM: ["name"],
      ProjectSMTPConfig: ["name"],
      ResourceAiAgent: [
        "connectionStatus",
        "lastAliveAt",
        "resourceId",
        "resourceType",
      ],
      Runner: ["connectionStatus", "isGlobalRunner", "lastAlive", "name"],
      WorkspaceNotificationRule: [
        "description",
        "eventType",
        "name",
        "notificationRule",
        "workspaceType",
      ],
    },
  },
  {
    reason:
      "The whole a part belongs to, named by the part a custom role is given to read: a log or trace pipeline by its processors, a call - who called and when - by its steps, a call policy and its escalation rule by the calls they routed, a form by its submissions, a runbook by its runs, a grouping rule by the episodes it grouped, a RUM application by its sessions, replays and requests. A reader of the parts reads which whole they are parts of.",
    columns: {
      AlertGroupingRule: ["name"],
      Form: ["name"],
      IncidentGroupingRule: ["name"],
      IncomingCallLog: [
        "callDurationInSeconds",
        "callerPhoneNumber",
        "incomingCallPolicyId",
        "routingPhoneNumber",
        "startedAt",
        "status",
      ],
      IncomingCallPolicy: ["name"],
      IncomingCallPolicyEscalationRule: [
        "incomingCallPolicyId",
        "name",
        "order",
      ],
      LogPipeline: [
        "description",
        "filterQuery",
        "isEnabled",
        "name",
        "sortOrder",
      ],
      RumApplication: [
        "appIdentifier",
        "clientType",
        "description",
        "lastSeenAt",
        "name",
        "sdkLanguage",
      ],
      Runbook: ["name"],
      TracePipeline: [
        "description",
        "filterQuery",
        "isEnabled",
        "name",
        "sortOrder",
      ],
    },
  },
  {
    reason:
      "A Security record names the record it is about - a data security issue its case, a finding its last scan, a watchlist its feed, a feed its connection, a data store its cloud account and connection - and a custom role given the first reads the second through it, as the Security tiers read it anyway. Their credentials never: an encrypted column is no relation's label. The pages read only the names through these relations, and #10310 weighs holding the rest to their own read (RelationReaders.ColumnReaders).",
    columns: {
      CloudAccount: [
        "accountId",
        "cloudConnectionId",
        "lastSeenAt",
        "name",
        "provider",
        "providerAccountName",
        "regionCount",
        "resourceCount",
      ],
      CloudConnection: [
        "addedMetrics",
        "config",
        "isEnabled",
        "lastError",
        "lastPulledAt",
        "lastSuccessfulPullAt",
        "name",
        "provider",
        "serviceId",
        "streamKeyCreatedAt",
      ],
      DataSecurityScan: [
        "bytesRead",
        "cloudConnectionId",
        "dataStoreId",
        "durationInMs",
        "errorMessage",
        "findingsFound",
        "finishedAt",
        "kind",
        "objectsRead",
        "probeId",
        "rowsRead",
        "startedAt",
        "status",
        "storesRead",
      ],
      SecurityCase: [
        "acknowledgeDueAt",
        "acknowledgeMissedAt",
        "acknowledgedAt",
        "assignedToTeamId",
        "assignedToUserId",
        "caseNumber",
        "caseNumberWithPrefix",
        "closedAt",
        "containDueAt",
        "containMissedAt",
        "containedAt",
        "detectionCount",
        "firstDetectedAt",
        "incidentId",
        "lastDetectedAt",
        "nextDueAt",
        "securityCasePriorityId",
        "securityCaseStatusId",
        "source",
        "title",
        "verdict",
      ],
      SecurityEventConnection: [
        "alertingOnly",
        "caseMinimumSeverity",
        "cursor",
        "isEnabled",
        "lastError",
        "lastEventIngestedAt",
        "lastPolledAt",
        "lastSuccessfulPollAt",
        "name",
        "pollIntervalInMinutes",
        "provider",
      ],
      ThreatIntelFeed: [
        "apiRootUrl",
        "collectionId",
        "cursor",
        "feedType",
        "indicatorConfidence",
        "isEnabled",
        "lastError",
        "lastEvaluatedAt",
        "lastMatchAt",
        "lastMatchError",
        "lastPollSummary",
        "lastPolledAt",
        "listUrl",
        "minimumConfidence",
        "name",
        "nextPageToken",
        "pollIntervalInMinutes",
        "securityEventConnectionId",
        "shouldCreateAlert",
        "shouldCreateCase",
        "shouldCreateIncident",
        "shouldWriteDetectionFinding",
      ],
    },
  },
  {
    reason:
      "A project names the reseller that sold it and the plan it is on, which its members and its billing roles read on Billing; nobody reads a reseller's records on their own.",
    columns: {
      Reseller: ["changePlanLink", "description", "name"],
      "Reseller Plan": [
        "description",
        "monitorLimit",
        "name",
        "otherFeatures",
        "planId",
        "planType",
        "resellerId",
        "teamMemberLimit",
      ],
    },
  },
  {
    reason:
      "A run is kept to who started it (AIRunPrivacyFilter): the conversation a Viewer's run names is their own, or the shared investigation thread of an incident or an alert they read.",
    columns: {
      AIConversation: [
        "alertId",
        "incidentId",
        "llmProviderId",
        "permissionMode",
        "title",
      ],
    },
  },
  {
    reason:
      "Which app a cloud resource's instance runs (#10289): a cloud's resources and their instances are Cloud's and App Platforms' both, so Cloud's levels read an instance's app as App Platforms' readers do - its name, platform, service and revisions, and when its signals last arrived - to say what the instance is. Changing an app is OneUptime's alone.",
    columns: {
      CloudApp: [
        "appKey",
        "cloudPlatform",
        "cloudResourceId",
        "currentRevision",
        "currentRevisionSince",
        "groupName",
        "lastSeenAt",
        "logsLastReceivedAt",
        "metricsLastReceivedAt",
        "name",
        "previousRevision",
        "revisionAttribute",
        "serviceName",
        "signalArrivalsTrackedSince",
        "tracesLastReceivedAt",
      ],
    },
  },
];

/*
 * A related record's project is the reader's own - a relation names records
 * of its own project - or none, for one the server shares (a global probe, an
 * AI agent or LLM of the server's): its id says nothing the reader does not
 * know.
 */
function isTenantColumn(read: WiderRelationRead): boolean {
  return read.column === "projectId";
}

function columnKey(table: string, column: string): string {
  return `${table}.${column}`;
}

function recordedColumns(
  recorded: ReadonlyArray<WiderOnPurpose>,
): Map<string, string> {
  const columns: Map<string, string> = new Map<string, string>();

  for (const entry of recorded) {
    for (const [table, names] of Object.entries(entry.columns)) {
      for (const name of names) {
        columns.set(columnKey(table, name), entry.reason);
      }
    }
  }

  return columns;
}

/*
 * The wider reads nothing below says why of: each as the relation it is read
 * through, the column, and who reads it there that may not on its own.
 */
function getUnrecordedWiderReads(
  reads: ReadonlyArray<WiderRelationRead>,
  recorded: ReadonlyArray<WiderOnPurpose>,
): Array<string> {
  const known: Map<string, string> = recordedColumns(recorded);

  return reads
    .filter((read: WiderRelationRead): boolean => {
      return (
        !isTenantColumn(read) &&
        !known.has(columnKey(read.relatedModel, read.column))
      );
    })
    .map((read: WiderRelationRead): string => {
      return `${read.model}.${read.relation} reads ${read.relatedModel}.${read.column} for ${read.readers.join(", ")}`;
    })
    .sort();
}

// Columns written down that no relation reads wider than their own read.
function getRecordedButNotWider(
  reads: ReadonlyArray<WiderRelationRead>,
  recorded: ReadonlyArray<WiderOnPurpose>,
): Array<string> {
  const wider: Set<string> = new Set<string>(
    reads.map((read: WiderRelationRead): string => {
      return columnKey(read.relatedModel, read.column);
    }),
  );

  return Array.from(recordedColumns(recorded).keys())
    .filter((key: string): boolean => {
      return !wider.has(key);
    })
    .sort();
}

const WIDER_READS: Array<WiderRelationRead> = findWiderRelationReads(
  AllModelTypes as Array<{ new (): BaseModel }>,
);

describe("no relation reads a column wider than its own read, but for a reason written down", () => {
  test("the sweep reads the relations of every model", () => {
    // 4,094 wider reads in 17.1.0, in 479 relations to 90 models.
    expect(WIDER_READS.length).toBeGreaterThan(3000);
    expect(
      new Set(
        WIDER_READS.map((read: WiderRelationRead): string => {
          return read.relatedModel;
        }),
      ).size,
    ).toBeGreaterThan(60);
  });

  test("every label a relation reads for a reader its own read keeps out is written down with why", () => {
    expect(getUnrecordedWiderReads(WIDER_READS, WIDER_ON_PURPOSE)).toEqual([]);
  });

  test("every column written down is still read wider than its own read", () => {
    expect(getRecordedButNotWider(WIDER_READS, WIDER_ON_PURPOSE)).toEqual([]);
  });

  test("a column is written down once, with a reason that says why", () => {
    const seen: Array<string> = [];

    for (const entry of WIDER_ON_PURPOSE) {
      expect(entry.reason.length).toBeGreaterThan(120);
      expect(entry.reason.trim().endsWith(".")).toBe(true);

      for (const [table, names] of Object.entries(entry.columns)) {
        expect(names.length).toBeGreaterThan(0);

        for (const name of names) {
          seen.push(columnKey(table, name));
        }
      }
    }

    expect(seen.length).toBe(new Set(seen).size);
  });
});

describe("a data store's security facts are no relation's label (#10281)", () => {
  const store: DataStore = new DataStore();
  const storeColumns: Dictionary<TableColumnMetadata> = getTableColumns(store);

  // Which store it is: what every reader of a relation to it reads.
  const IDENTITY: Array<string> = [
    "projectId",
    "name",
    "kind",
    "environment",
    "isArchived",
  ];

  test("every reader of a relation reads which store it is, and nothing else of it", () => {
    // The ids and times every select may name are the store's own read's.
    const labels: Array<string> = Object.keys(storeColumns).filter(
      (column: string): boolean => {
        return (
          !ALWAYS_SELECTABLE_COLUMNS.includes(column) &&
          RelationReadersUtil.isReadByEveryReaderOfTheRelation(
            storeColumns[column],
          )
        );
      },
    );

    expect(labels.sort()).toEqual([...IDENTITY].sort());
  });

  test("every other column a relation reads is held to the store's own read", () => {
    const heldToOwnRead: Array<string> = Object.keys(storeColumns).filter(
      (column: string): boolean => {
        return RelationReadersUtil.isHeldToItsOwnRead(storeColumns[column]);
      },
    );

    expect(heldToOwnRead.length).toBe(42);
    expect(heldToOwnRead).toEqual(
      expect.arrayContaining([
        "sensitivity",
        "sensitivityOverride",
        "exposure",
        "riskScore",
        "openIssueCount",
        "highestIssueSeverity",
        "findingCount",
        "estimatedRecords",
        "isPublicByDesign",
        "isAiData",
        "cloudAccountNumber",
        "providerResourceId",
        "region",
        "storeKey",
        "probeConnectionVariable",
        "contentScanStatus",
        "purpose",
        "retention",
        "description",
      ]),
    );

    for (const column of heldToOwnRead) {
      expect({
        column: column,
        readers: store.getColumnAccessControlFor(column)?.read,
      }).toEqual({
        column: column,
        readers: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.SecurityAdmin,
          Permission.SecurityMember,
          Permission.SecurityViewer,
          Permission.ReadDataStore,
        ],
      });
    }
  });

  test("its data types, data categories and subject countries stay off relations (#10238)", () => {
    for (const column of [
      "dataTypeIds",
      "dataCategories",
      "subjectCountries",
    ]) {
      expect({
        column: column,
        canReadOnRelationQuery: Boolean(
          storeColumns[column]?.canReadOnRelationQuery,
        ),
      }).toEqual({ column: column, canReadOnRelationQuery: false });
    }
  });

  test("Data Observability's readers read only which store it is, through a data asset, a data alert and a warehouse job", () => {
    const throughDataObservability: Array<WiderRelationRead> =
      WIDER_READS.filter((read: WiderRelationRead): boolean => {
        return (
          read.relatedModel === "DataStore" &&
          ["DataAsset", "DataAlert", "DataWarehouseJob"].includes(read.model)
        );
      });

    expect(
      Array.from(
        new Set(
          throughDataObservability.map((read: WiderRelationRead): string => {
            return read.column;
          }),
        ),
      ).sort(),
    ).toEqual([...IDENTITY].sort());

    for (const read of throughDataObservability) {
      expect(read.readers).toEqual(
        expect.arrayContaining([
          Permission.Viewer,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadDataAsset,
        ]),
      );
    }
  });

  test("on the Data Store as 17.1.0 shipped it, the guard names each security fact, and who read it through which relation", () => {
    const heldToOwnRead: Array<TableColumnMetadata> = Object.values(
      storeColumns,
    ).filter((metadata: TableColumnMetadata | undefined): boolean => {
      return RelationReadersUtil.isHeldToItsOwnRead(metadata);
    }) as Array<TableColumnMetadata>;

    expect(heldToOwnRead.length).toBe(42);

    // The column metadata is the model's own: planted off, and put back.
    for (const metadata of heldToOwnRead) {
      delete metadata.relationReaders;
    }

    try {
      const unrecorded: Array<string> = getUnrecordedWiderReads(
        findWiderRelationReads(AllModelTypes as Array<{ new (): BaseModel }>),
        WIDER_ON_PURPOSE,
      );

      /*
       * Data Observability's own levels (#10289) read a data asset as Viewer,
       * Project Member and Project Admin do, so the leak would reach them too.
       */
      expect(unrecorded).toEqual(
        expect.arrayContaining([
          "DataAsset.dataStore reads DataStore.sensitivity for ProjectMember, Viewer, TelemetryAdmin, TelemetryMember, TelemetryViewer, ReadDataAsset, DataObservabilityAdmin, DataObservabilityMember, DataObservabilityViewer",
          "DataAlert.dataStore reads DataStore.exposure for ProjectMember, Viewer, TelemetryAdmin, TelemetryMember, TelemetryViewer, ReadDataAsset, DataObservabilityAdmin, DataObservabilityMember, DataObservabilityViewer",
          "DataWarehouseJob.dataStore reads DataStore.riskScore for ProjectMember, Viewer, TelemetryAdmin, TelemetryMember, TelemetryViewer, ReadDataAsset, DataObservabilityAdmin, DataObservabilityMember, DataObservabilityViewer",
          "DataSecurityIssue.dataStore reads DataStore.cloudAccountNumber for ReadDataSecurityIssue",
        ]),
      );
      // Each of the 42, through each of the nine relations that reach a store.
      expect(unrecorded.length).toBe(42 * 9);
    } finally {
      for (const metadata of heldToOwnRead) {
        metadata.relationReaders = RelationReaders.ColumnReaders;
      }
    }

    expect(getUnrecordedWiderReads(WIDER_READS, WIDER_ON_PURPOSE)).toEqual([]);
  });

  test("a project's reseller license, which nobody reads, is no relation's either", () => {
    const project: Project = new Project();

    expect(
      Boolean(
        project.getTableColumnMetadata("resellerLicenseId")
          .canReadOnRelationQuery,
      ),
    ).toBe(false);
    expect(
      WIDER_READS.filter((read: WiderRelationRead): boolean => {
        return read.relatedModel === "Project" && !isTenantColumn(read);
      }),
    ).toEqual([]);
  });
});

/*
 * The guard, on models planted here: a vault only the Security tiers read,
 * and a record every Viewer reads that names its vault.
 */
@TableMetadata({
  tableName: "PlantedVault",
  singularName: "Planted Vault",
  pluralName: "Planted Vaults",
  icon: IconProp.Lock,
  tableDescription: "A record only the Security tiers read.",
})
@TableAccessControl({
  create: [],
  read: [Permission.SecurityAdmin, Permission.SecurityViewer],
  update: [],
  delete: [],
})
class PlantedVault extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [Permission.SecurityAdmin, Permission.SecurityViewer],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
  })
  public name?: string = undefined;

  // #10281's mistake: a security fact marked a label.
  @ColumnAccessControl({
    create: [],
    read: [Permission.SecurityAdmin, Permission.SecurityViewer],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Sensitivity",
  })
  public sensitivity?: string = undefined;

  // The fix: held to its own read through every relation.
  @ColumnAccessControl({
    create: [],
    read: [Permission.SecurityAdmin, Permission.SecurityViewer],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    relationReaders: RelationReaders.ColumnReaders,
    title: "Exposure",
  })
  public exposure?: string = undefined;

  // No relation reads it at all.
  @ColumnAccessControl({
    create: [],
    read: [Permission.SecurityAdmin, Permission.SecurityViewer],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Data Types",
  })
  public dataTypes?: string = undefined;
}

@TableMetadata({
  tableName: "PlantedViewerRecord",
  singularName: "Planted Viewer Record",
  pluralName: "Planted Viewer Records",
  icon: IconProp.TableCells,
  tableDescription: "A record every Viewer reads, that names its vault.",
})
@TableAccessControl({
  create: [],
  read: [Permission.ProjectOwner, Permission.Viewer],
  update: [],
  delete: [],
})
class PlantedViewerRecord extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [Permission.ProjectOwner, Permission.Viewer],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Entity,
    modelType: PlantedVault,
    manyToOneRelationColumn: "vaultId",
    title: "Vault",
  })
  public vault?: PlantedVault = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.ProjectOwner, Permission.Viewer],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    canReadOnRelationQuery: true,
    title: "Vault ID",
  })
  public vaultId?: ObjectID = undefined;
}

// A record every member of the project reads, whatever their role.
@TableMetadata({
  tableName: "PlantedMemberRecord",
  singularName: "Planted Member Record",
  pluralName: "Planted Member Records",
  icon: IconProp.TableCells,
  tableDescription: "A record every member reads, that names its vault.",
})
@TableAccessControl({
  create: [],
  read: [Permission.ProjectUser],
  update: [],
  delete: [],
})
class PlantedMemberRecord extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [Permission.ProjectUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Entity,
    modelType: PlantedVault,
    manyToOneRelationColumn: "vaultId",
    title: "Vault",
  })
  public vault?: PlantedVault = undefined;
}

describe("the guard fails on a planted relation read wider than its column's own read", () => {
  const plantedReads: Array<WiderRelationRead> = findWiderRelationReads([
    PlantedViewerRecord,
  ]);

  test("a security fact marked a label is found, with who reads it through which relation", () => {
    expect(plantedReads).toEqual(
      expect.arrayContaining([
        {
          model: "PlantedViewerRecord",
          relation: "vault",
          relatedModel: "PlantedVault",
          column: "sensitivity",
          readers: [Permission.ProjectOwner, Permission.Viewer],
        },
      ]),
    );
    expect(getUnrecordedWiderReads(plantedReads, [])).toEqual([
      "PlantedViewerRecord.vault reads PlantedVault.name for ProjectOwner, Viewer",
      "PlantedViewerRecord.vault reads PlantedVault.sensitivity for ProjectOwner, Viewer",
    ]);
  });

  test("held to its own read, or kept off relations, a column is no wider read", () => {
    expect(
      plantedReads
        .map((read: WiderRelationRead): string => {
          return read.column;
        })
        .sort(),
    ).toEqual(["name", "sensitivity"]);
  });

  test("written down with its reason, a label passes, and only the one written down", () => {
    const recorded: Array<WiderOnPurpose> = [
      {
        reason:
          "Planted: which vault a record names, by its name, for every reader of the record that names it - the label the page draws.",
        columns: { PlantedVault: ["name"] },
      },
    ];

    expect(getUnrecordedWiderReads(plantedReads, recorded)).toEqual([
      "PlantedViewerRecord.vault reads PlantedVault.sensitivity for ProjectOwner, Viewer",
    ]);
  });

  test("a column written down that no relation reads wider fails too, until it comes off", () => {
    expect(
      getRecordedButNotWider(plantedReads, [
        {
          reason:
            "Planted: a column held to its own read, written down as if every reader of the record read it through the relation.",
          columns: { PlantedVault: ["name", "exposure"] },
        },
      ]),
    ).toEqual(["PlantedVault.exposure"]);
  });

  test("a record every member reads names its readers as any member", () => {
    expect(
      findWiderRelationReads([PlantedMemberRecord]).map(
        (read: WiderRelationRead): string => {
          return `${read.column}: ${read.readers.join(", ")}`;
        },
      ),
    ).toEqual([`name: ${ANY_MEMBER}`, `sensitivity: ${ANY_MEMBER}`]);
  });
});
