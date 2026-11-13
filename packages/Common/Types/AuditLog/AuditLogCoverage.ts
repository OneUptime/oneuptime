import EnableAuditLogOn, {
  AuditLogRootResource,
} from "../BaseDatabase/EnableAuditLogOn";
import { getColumnAccessControlForAllColumns } from "../Database/AccessControl/ColumnAccessControl";
import { TableColumnMetadata } from "../Database/TableColumn";
import TableColumnType from "../Database/TableColumnType";

/*
 * WHICH RECORDS THE AUDIT LOG COVERS: everything people create, change or
 * delete in a project, unless it is listed below with the reason it is not.
 *
 * Audit logging used to be opt-in, model by model (@EnableAuditLog), and most
 * models never opted in: a workflow saved in the builder, a queue's owners, a
 * team's members, a status page's domains, a project's SSO settings - none of
 * it was recorded, and the resource pages that offered an Audit Logs tab
 * (Workflow, Service, Dashboard, Kubernetes, ...) showed it empty forever.
 * Issue #6187.
 *
 * Now every project-scoped model is audited by default, through the model's
 * own `enableAuditLogOn` (DatabaseBaseModel reads it from here when the model
 * declares nothing), so DatabaseService, the recorder, the export's redaction
 * and every guard that sweeps the models see the same answer:
 *
 *   - a model that declares @EnableAuditLog keeps exactly what it declares;
 *   - a model with no tenant column holds no project's records - there is no
 *     project audit log to file its changes under - and is not audited;
 *   - a project-scoped model listed in AUDIT_LOG_EXEMPT_TABLES is not audited,
 *     for the reason its kind gives (AUDIT_LOG_EXEMPTION_KINDS): what machines
 *     write and rewrite all day - logs, reports, feeds, working state - would
 *     bury every change a person made, and a person's own notification setup
 *     and preferences are theirs alone;
 *   - every other project-scoped model is audited on create, update and
 *     delete, with the configuration getDefaultAuditLogOn works out below.
 *
 * Tests/Types/AuditLog/AuditLogCoverage.test.ts holds every model to this: a
 * new model is audited unless someone lists it here and says why.
 */

export enum AuditLogExemptionKind {
  MessageLog = "MessageLog",
  RunRecord = "RunRecord",
  Reported = "Reported",
  ActivityFeed = "ActivityFeed",
  WorkingState = "WorkingState",
  PersonalSetup = "PersonalSetup",
  PersonalPreference = "PersonalPreference",
}

export interface AuditLogExemptionKindDescription {
  // What the docs' "Not recorded" table calls these records.
  title: string;
  // Why none of them is recorded, in plain words.
  reason: string;
}

export const AUDIT_LOG_EXEMPTION_KINDS: Readonly<
  Record<AuditLogExemptionKind, AuditLogExemptionKindDescription>
> = {
  [AuditLogExemptionKind.MessageLog]: {
    title: "Logs of messages",
    reason:
      "A log of a message OneUptime sent or received: an email, SMS, call, push notification, chat or webhook message. The log is already the record of that message, and an entry for each would double every notification.",
  },
  [AuditLogExemptionKind.RunRecord]: {
    title: "Records of runs",
    reason:
      "A record OneUptime writes of something as it happens: a workflow run, an on-call escalation, who was on call when, a scan, an import, an AI run or conversation, a provisioning request, a session replay someone watched. It is already the record of that event.",
  },
  [AuditLogExemptionKind.Reported]: {
    title: "What agents and telemetry report",
    reason:
      "Reported by agents, probes, integrations and telemetry, and rewritten as new reports arrive: discovered resources, readings, measurements, findings, usage and invoices. Nobody edits it, and recording it would bury the changes people make.",
  },
  [AuditLogExemptionKind.ActivityFeed]: {
    title: "Activity feeds",
    reason:
      "An entry in a resource's activity feed, which OneUptime writes for changes the audit log already records.",
  },
  [AuditLogExemptionKind.WorkingState]: {
    title: "OneUptime's working state",
    reason:
      "State OneUptime keeps while it works: sessions, queued jobs, batches, chat-app state and copies it derives from other records. Nobody edits it.",
  },
  [AuditLogExemptionKind.PersonalSetup]: {
    title: "A person's own notification setup",
    reason:
      "A person's own notification methods, rules and chat accounts, with addresses and numbers only they may read. An administrator changing someone else's is recorded separately, without the address or number.",
  },
  [AuditLogExemptionKind.PersonalPreference]: {
    title: "A person's own preferences",
    reason:
      "What a person chose for themselves in a project, such as the products they pinned to the top bar. Only they see it and only they can change it, so an entry would tell nobody anything.",
  },
};

/*
 * The project-scoped models that are NOT audited, by table name, each with
 * the kind of record it is. Everything here is either written by OneUptime
 * itself, often many times a minute, or private to one person.
 */
export const AUDIT_LOG_EXEMPT_TABLES: Readonly<
  Record<string, AuditLogExemptionKind>
> = {
  // Logs of messages.
  CallLog: AuditLogExemptionKind.MessageLog,
  EmailLog: AuditLogExemptionKind.MessageLog,
  IncomingCallLog: AuditLogExemptionKind.MessageLog,
  IncomingCallLogItem: AuditLogExemptionKind.MessageLog,
  OpenStackProjectNoticeDelivery: AuditLogExemptionKind.MessageLog,
  PushNotificationLog: AuditLogExemptionKind.MessageLog,
  SmsLog: AuditLogExemptionKind.MessageLog,
  TelegramLog: AuditLogExemptionKind.MessageLog,
  UserOnCallLog: AuditLogExemptionKind.MessageLog,
  UserOnCallLogTimeline: AuditLogExemptionKind.MessageLog,
  UserOnCallShiftReminderLog: AuditLogExemptionKind.MessageLog,
  WebhookLog: AuditLogExemptionKind.MessageLog,
  WhatsAppLog: AuditLogExemptionKind.MessageLog,
  WorkspaceNotificationLog: AuditLogExemptionKind.MessageLog,

  // Records of runs.
  AIAgentTaskPullRequest: AuditLogExemptionKind.RunRecord,
  AIConversation: AuditLogExemptionKind.RunRecord,
  AIConversationMessage: AuditLogExemptionKind.RunRecord,
  AIRun: AuditLogExemptionKind.RunRecord,
  AIRunEvent: AuditLogExemptionKind.RunRecord,
  AutoRemediationDecision: AuditLogExemptionKind.RunRecord,
  AutoRemediationSuggestion: AuditLogExemptionKind.RunRecord,
  DataSecurityScan: AuditLogExemptionKind.RunRecord,
  LlmLog: AuditLogExemptionKind.RunRecord,
  NetworkDeviceDiscoveryImport: AuditLogExemptionKind.RunRecord,
  OnCallDutyPolicyExecutionLog: AuditLogExemptionKind.RunRecord,
  OnCallDutyPolicyExecutionLogTimeline: AuditLogExemptionKind.RunRecord,
  OnCallDutyPolicyTimeLog: AuditLogExemptionKind.RunRecord,
  ProjectSCIMLog: AuditLogExemptionKind.RunRecord,
  RumSessionReplayView: AuditLogExemptionKind.RunRecord,
  SecurityEventConnectionRun: AuditLogExemptionKind.RunRecord,
  SecurityHuntRun: AuditLogExemptionKind.RunRecord,
  StatusPageSCIMLog: AuditLogExemptionKind.RunRecord,
  ToolImportRecord: AuditLogExemptionKind.RunRecord,
  ToolImportRun: AuditLogExemptionKind.RunRecord,
  WorkflowLog: AuditLogExemptionKind.RunRecord,

  // What agents and telemetry report.
  AIInsight: AuditLogExemptionKind.Reported,
  AlertMeasurementValue: AuditLogExemptionKind.Reported,
  BillingInvoice: AuditLogExemptionKind.Reported,
  CephResource: AuditLogExemptionKind.Reported,
  CloudApp: AuditLogExemptionKind.Reported,
  CloudAppRevision: AuditLogExemptionKind.Reported,
  CloudCostRecommendation: AuditLogExemptionKind.Reported,
  CloudResourceInstance: AuditLogExemptionKind.Reported,
  DataAlert: AuditLogExemptionKind.Reported,
  DataAssetLineage: AuditLogExemptionKind.Reported,
  DataAssetUsage: AuditLogExemptionKind.Reported,
  DataDashboard: AuditLogExemptionKind.Reported,
  DataPipelineRun: AuditLogExemptionKind.Reported,
  DataSecurityFlow: AuditLogExemptionKind.Reported,
  DataSecurityIdentity: AuditLogExemptionKind.Reported,
  DataStoreAccess: AuditLogExemptionKind.Reported,
  DataWarehouseJob: AuditLogExemptionKind.Reported,
  DockerResource: AuditLogExemptionKind.Reported,
  DockerSwarmResource: AuditLogExemptionKind.Reported,
  IncidentMeasurementValue: AuditLogExemptionKind.Reported,
  IoTDevice: AuditLogExemptionKind.Reported,
  KubernetesAiAgent: AuditLogExemptionKind.Reported,
  KubernetesContainer: AuditLogExemptionKind.Reported,
  KubernetesResource: AuditLogExemptionKind.Reported,
  NetworkEndpoint: AuditLogExemptionKind.Reported,
  OpenStackProjectUsage: AuditLogExemptionKind.Reported,
  OpenStackResource: AuditLogExemptionKind.Reported,
  PodmanResource: AuditLogExemptionKind.Reported,
  ProxmoxResource: AuditLogExemptionKind.Reported,
  ResourceAiAgent: AuditLogExemptionKind.Reported,
  RumApplicationClient: AuditLogExemptionKind.Reported,
  ScheduledMaintenanceExternalCalendarEvent: AuditLogExemptionKind.Reported,
  ScheduledMaintenanceMeasurementValue: AuditLogExemptionKind.Reported,
  SecurityDetection: AuditLogExemptionKind.Reported,
  ServerlessFunctionInstance: AuditLogExemptionKind.Reported,
  StorageArrayResource: AuditLogExemptionKind.Reported,
  TelemetryExceptionActivity: AuditLogExemptionKind.Reported,
  TelemetryIngestionKeyRefusal: AuditLogExemptionKind.Reported,
  TelemetryUsageBilling: AuditLogExemptionKind.Reported,
  VMwareResource: AuditLogExemptionKind.Reported,

  // Activity feeds.
  AlertEpisodeFeed: AuditLogExemptionKind.ActivityFeed,
  AlertFeed: AuditLogExemptionKind.ActivityFeed,
  CephClusterFeed: AuditLogExemptionKind.ActivityFeed,
  CloudAccountFeed: AuditLogExemptionKind.ActivityFeed,
  CloudResourceFeed: AuditLogExemptionKind.ActivityFeed,
  DataAssetFeed: AuditLogExemptionKind.ActivityFeed,
  DataSecurityIssueFeed: AuditLogExemptionKind.ActivityFeed,
  DataStoreFeed: AuditLogExemptionKind.ActivityFeed,
  DatabaseServerFeed: AuditLogExemptionKind.ActivityFeed,
  DockerHostFeed: AuditLogExemptionKind.ActivityFeed,
  DockerSwarmClusterFeed: AuditLogExemptionKind.ActivityFeed,
  HostFeed: AuditLogExemptionKind.ActivityFeed,
  IncidentEpisodeFeed: AuditLogExemptionKind.ActivityFeed,
  IncidentFeed: AuditLogExemptionKind.ActivityFeed,
  KubernetesClusterFeed: AuditLogExemptionKind.ActivityFeed,
  MonitorFeed: AuditLogExemptionKind.ActivityFeed,
  OnCallDutyPolicyFeed: AuditLogExemptionKind.ActivityFeed,
  OpenStackCloudFeed: AuditLogExemptionKind.ActivityFeed,
  PodmanHostFeed: AuditLogExemptionKind.ActivityFeed,
  ProxmoxClusterFeed: AuditLogExemptionKind.ActivityFeed,
  ScheduledMaintenanceFeed: AuditLogExemptionKind.ActivityFeed,
  SecurityCaseFeed: AuditLogExemptionKind.ActivityFeed,
  ServiceFeed: AuditLogExemptionKind.ActivityFeed,
  ServiceLevelObjectiveFeed: AuditLogExemptionKind.ActivityFeed,
  StorageArrayFeed: AuditLogExemptionKind.ActivityFeed,
  VMwareVCenterFeed: AuditLogExemptionKind.ActivityFeed,

  // OneUptime's working state.
  CodeRepositoryConnection: AuditLogExemptionKind.WorkingState,
  HostCollectorConfigVersion: AuditLogExemptionKind.WorkingState,
  IncidentSla: AuditLogExemptionKind.WorkingState,
  PublicNoteApprovalRequest: AuditLogExemptionKind.WorkingState,
  RunnerJob: AuditLogExemptionKind.WorkingState,
  StatusPagePrivateUserSession: AuditLogExemptionKind.WorkingState,
  UserNotificationEmailRollupBatch: AuditLogExemptionKind.WorkingState,
  UserNotificationEmailRollupItem: AuditLogExemptionKind.WorkingState,
  WorkflowVersion: AuditLogExemptionKind.WorkingState,
  WorkspaceHomeChoice: AuditLogExemptionKind.WorkingState,
  WorkspaceLiveMessage: AuditLogExemptionKind.WorkingState,
  WorkspacePublicNoteApprovalMessage: AuditLogExemptionKind.WorkingState,
  WorkspaceSetting: AuditLogExemptionKind.WorkingState,

  // A person's own notification setup.
  UserCall: AuditLogExemptionKind.PersonalSetup,
  UserEmail: AuditLogExemptionKind.PersonalSetup,
  UserIncomingCallNumber: AuditLogExemptionKind.PersonalSetup,
  UserMattermost: AuditLogExemptionKind.PersonalSetup,
  UserMicrosoftTeams: AuditLogExemptionKind.PersonalSetup,
  UserNotificationEmailRollupSetting: AuditLogExemptionKind.PersonalSetup,
  UserNotificationRule: AuditLogExemptionKind.PersonalSetup,
  UserNotificationSetting: AuditLogExemptionKind.PersonalSetup,
  UserOnCallCalendarFeed: AuditLogExemptionKind.PersonalSetup,
  UserOnCallShiftReminder: AuditLogExemptionKind.PersonalSetup,
  UserPush: AuditLogExemptionKind.PersonalSetup,
  UserSlack: AuditLogExemptionKind.PersonalSetup,
  UserSMS: AuditLogExemptionKind.PersonalSetup,
  UserTelegram: AuditLogExemptionKind.PersonalSetup,
  UserWebhook: AuditLogExemptionKind.PersonalSetup,
  UserWhatsApp: AuditLogExemptionKind.PersonalSetup,
  WorkspaceUserAuthToken: AuditLogExemptionKind.PersonalSetup,

  // A person's own preferences.
  ProjectUserPreference: AuditLogExemptionKind.PersonalPreference,
};

/*
 * The resources with an Audit Logs page of their own. A page lists the
 * entries that roll up to it (AuditLog.rootResourceId), so a row that belongs
 * to one of these - an owner, a rule, a note, a variable - names it as its
 * root (inferRootResource), and its history shows on its parent's page.
 */
export const AUDIT_LOG_ROOT_RESOURCE_TABLES: ReadonlySet<string> =
  new Set<string>([
    "Alert",
    "AlertEpisode",
    "CephCluster",
    "CloudAccount",
    "CloudResource",
    "CodeRepository",
    "Dashboard",
    "DataAsset",
    "DataPipeline",
    "DataProduct",
    "DataSecurityIssue",
    "DataStore",
    "DatabaseServer",
    "DockerHost",
    "DockerSwarmCluster",
    "Form",
    "Host",
    "Incident",
    "IncidentEpisode",
    "IncomingCallPolicy",
    "InventoryItem",
    "IoTFleet",
    "KubernetesCluster",
    "MessageQueue",
    "Monitor",
    "MonitorGroup",
    "NetworkDevice",
    "NetworkSite",
    "OnCallDutyPolicy",
    "OnCallDutyPolicySchedule",
    "OpenStackCloud",
    "PodmanHost",
    "ProxmoxCluster",
    "RumApplication",
    "Runbook",
    "ScheduledMaintenance",
    "SecurityCase",
    "ServerlessFunction",
    "Service",
    "ServiceLevelObjective",
    "StatusPage",
    "StatusPageAnnouncement",
    "StorageArray",
    "Team",
    "TelemetryException",
    "VMwareVCenter",
    "Workflow",
  ]);

/*
 * Columns a person can edit, by the access rules, but that agents, probes and
 * workers rewrite as they report: a host's operating system and memory, a
 * cluster's node count, an exception's occurrence count. Left out of entries
 * like the columns nobody may write (isWrittenOnlyByOneUptime): a change to
 * one is not a change anybody made, and a report every minute would bury
 * the ones that are.
 */
export const AUDIT_LOG_REPORTED_COLUMNS: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  CephCluster: [
    "monCount",
    "osdCount",
    "osdUpCount",
    "osdInCount",
    "poolCount",
    "healthStatus",
  ],
  DockerSwarmCluster: [
    "nodeCount",
    "readyNodeCount",
    "managerNodeCount",
    "serviceCount",
    "taskCount",
    "runningTaskCount",
    "stackCount",
    "networkCount",
  ],
  Host: [
    "osType",
    "osVersion",
    "hostId",
    "hostArch",
    "hostType",
    "hostIpAddresses",
    "cpuCores",
    "totalMemoryBytes",
    "processCount",
    "containerRuntime",
    "collectorFailedConfigHash",
  ],
  InventoryItemRelationship: ["callCount", "errorCount"],
  IoTFleet: ["deviceCount", "onlineDeviceCount"],
  KubernetesCluster: ["nodeCount", "podCount", "namespaceCount"],
  NetworkDevice: [
    "discoveredName",
    "discoveredNameSource",
    "discoveredDetails",
    "macAddress",
    "isMacAddressLearned",
    "sysDescr",
    "sysName",
    "sysObjectId",
    "sysLocation",
    "sysContact",
    "vendor",
    "deviceModel",
    "serialNumber",
    "firmwareVersion",
    "softwareVersion",
    "cdpNeighbors",
    "lldpNeighbors",
    "snmpTableSnapshot",
    "transceiverSnapshot",
    "isReachable",
    "isSnmpReachable",
    "interfacesTotal",
    "interfacesUp",
    "interfacesDown",
  ],
  Probe: ["probeVersion"],
  ProxmoxCluster: [
    "nodeCount",
    "onlineNodeCount",
    "guestCount",
    "storageCount",
    "guestsWithoutBackupCount",
  ],
  Runner: ["connectionStatus"],
  /*
   * Why a run failed: the error a step's script or its Runner reported, or
   * why OneUptime stopped it. A run's steps are recorded as what happened to
   * them, never with what a step printed (AuditLogColumnSummaries); this is
   * a step's error, written by the Worker, and stays out the same way.
   */
  RunbookExecution: ["failureReason"],
  ScheduledMaintenanceTemplate: ["scheduleNextEventAt"],
  StorageArray: [
    "openAlertCount",
    "criticalAlertCount",
    "warningAlertCount",
    "volumeCount",
    "hostCount",
    "podCount",
    "fileSystemCount",
    "bucketCount",
    "hardwareComponentCount",
    "unhealthyHardwareCount",
    "healthStatus",
  ],
  TelemetryException: [
    "occuranceCount",
    "firstSeenInRelease",
    "lastSeenInRelease",
    "regressedAt",
  ],
};

/*
 * Columns with these names hold what an agent or a worker last reported on
 * any model that has them - when it was last seen, which version of the
 * collector it runs - and are left out the same way. So are a model's
 * timestamps named last...At or next...At (lastPingAt, nextSendAt): a
 * worker's bookkeeping of when it last did something, or will next.
 */
const REPORTED_COLUMN_NAMES: ReadonlySet<string> = new Set<string>([
  "firstSeenAt",
  "lastAlive",
  "otelCollectorStatus",
  "agentVersion",
]);

/*
 * Secrets of the models audited by default that their readers may see - a
 * probe's or a runner's key, a domain's TLS private key, SNMP credentials -
 * and that an entry therefore records as changed, never with their value
 * ("[REDACTED]", AuditLogRedaction). Encrypted and hashed columns, columns
 * nobody may read, and columns whose names say they hold a secret
 * (looksLikeSecretColumn) are covered without being listed; these are the
 * ones whose names do not say so, listed with the ones that do so the sweep's
 * findings stay pinned (AuditLogEntriesCarryNoSecrets).
 */
export const AUDIT_LOG_SECRET_COLUMNS: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  AIAgent: ["key"],
  DashboardDomain: ["customCertificateKey"],
  Form: ["shareKey"],
  FormDomain: ["customCertificateKey"],
  IoTDeviceCredential: ["secretKey"],
  NetworkDevice: [
    "snmpCommunityString",
    "snmpV3Auth",
    "snmpV3AuthKey",
    "snmpV3PrivKey",
  ],
  NetworkDeviceDiscoveryScan: [
    "snmpCommunityString",
    "snmpConfigs",
    "snmpV3AuthKey",
    "snmpV3PrivKey",
  ],
  OpenStackProjectNotice: ["webhookUrl"],
  Probe: ["key"],
  ProjectSCIM: ["bearerToken"],
  ProjectSMTPConfig: ["password", "clientSecret"],
  Runner: ["key"],
  StatusPageDomain: ["customCertificateKey"],
  StatusPageSCIM: ["bearerToken"],
  StatusPageSubscriber: ["subscriberWebhook"],
  TelemetryIngestionKey: ["secretKey"],
  Workflow: ["webhookSecretKey", "incomingEmailSecretKey"],
  WorkspaceProjectAuthToken: ["miscData"],
};

/*
 * Pieces of a name that says it holds a secret. A column or a JSON key is
 * compared with its case and its "-", "_", "." and spaces taken out, so
 * "X-Api-Key", "x_api_key" and "xApiKey" read alike.
 */
const SECRET_NAME_PARTS: ReadonlyArray<string> = [
  "secret",
  "password",
  "passwd",
  "passphrase",
  "token",
  "apikey",
  "privatekey",
  "privkey",
  "authkey",
  "accesskey",
  "signingkey",
  "credential",
  "bearer",
  "community",
  "webhook",
  "connectionstring",
  "authorization",
  "cookie",
];

// Longer names are not names: nothing reads them as one (and nothing scans them).
const LONGEST_NAME_READ: number = 256;

/*
 * A name with its case, separators and spaces taken out, by a loop: names
 * come from JSON a person typed, and nothing here runs a regular expression
 * over what they typed.
 */
export const toComparableName: (name: string) => string = (
  name: string,
): string => {
  let comparable: string = "";

  for (let index: number = 0; index < name.length; index++) {
    const character: string = name.charAt(index);

    if (
      character === "-" ||
      character === "_" ||
      character === "." ||
      character === " "
    ) {
      continue;
    }

    comparable += character.toLowerCase();
  }

  return comparable;
};

// Whether a name - a column's or a JSON key's - says what it holds is a secret.
export const looksLikeSecretName: (name: string) => boolean = (
  name: string,
): boolean => {
  if (!name || name.length > LONGEST_NAME_READ) {
    return false;
  }

  const comparable: string = toComparableName(name);

  return SECRET_NAME_PARTS.some((part: string): boolean => {
    return comparable.includes(part);
  });
};

// Column types whose values are never a secret: switches, numbers, dates, references.
const VALUE_TYPES_THAT_HOLD_NO_SECRET: ReadonlySet<TableColumnType> =
  new Set<TableColumnType>([
    TableColumnType.Boolean,
    TableColumnType.Date,
    TableColumnType.Number,
    TableColumnType.SmallNumber,
    TableColumnType.BigNumber,
    TableColumnType.PositiveNumber,
    TableColumnType.SmallPositiveNumber,
    TableColumnType.BigPositiveNumber,
    TableColumnType.Entity,
    TableColumnType.EntityArray,
    TableColumnType.Color,
    TableColumnType.Version,
  ]);

// Column types that hold a secret whatever they are called.
const SECRET_VALUE_TYPES: ReadonlySet<TableColumnType> =
  new Set<TableColumnType>([
    TableColumnType.Password,
    TableColumnType.OTP,
    TableColumnType.HashedString,
  ]);

// Column types that hold a file's bytes, which no entry carries.
const BINARY_VALUE_TYPES: ReadonlySet<TableColumnType> =
  new Set<TableColumnType>([TableColumnType.Buffer, TableColumnType.File]);

/*
 * Whether a column holds a secret by its type, or by a name that says so on a
 * type that can hold one. An ObjectID named ...Id is an id; one named
 * secretKey or apiKey is a key.
 */
export const looksLikeSecretColumn: (
  name: string,
  type: TableColumnType | undefined,
) => boolean = (name: string, type: TableColumnType | undefined): boolean => {
  if (type && SECRET_VALUE_TYPES.has(type)) {
    return true;
  }

  if (type && VALUE_TYPES_THAT_HOLD_NO_SECRET.has(type)) {
    return false;
  }

  if (
    type === TableColumnType.ObjectID &&
    (name.endsWith("Id") || name.endsWith("ID"))
  ) {
    return false;
  }

  return looksLikeSecretName(name);
};

// A timestamp a worker keeps of when it last did something, or will next.
const isWorkerTimestampName: (name: string) => boolean = (
  name: string,
): boolean => {
  if (!name.endsWith("At") || name.length < 7) {
    return false;
  }

  if (!name.startsWith("last") && !name.startsWith("next")) {
    return false;
  }

  const fifth: string = name.charAt(4);

  return fifth !== fifth.toLowerCase();
};

// What the default configuration reads of a model.
export interface AuditLogCoverageModel {
  tableName: string | null;
  singularName: string | null;
  /*
   * What the audit log stores a model renamed on screen under: the name it
   * kept (Common/Utils/ModelApiName), as the recorder's resource type is.
   */
  apiSingularName?: string | null | undefined;
  getTenantColumn: () => string | null;
  getTableColumns: () => { columns: Array<string> };
  getTableColumnMetadata: (column: string) => TableColumnMetadata;
  isTableColumn: (column: string) => boolean;
}

type CoverageModelType = { new (): AuditLogCoverageModel };

interface ColumnAccess {
  read?: Array<unknown> | undefined;
  create?: Array<unknown> | undefined;
  update?: Array<unknown> | undefined;
}

const isEmptyList: (value: Array<unknown> | undefined) => boolean = (
  value: Array<unknown> | undefined,
): boolean => {
  return Array.isArray(value) && value.length === 0;
};

/*
 * A column only OneUptime writes: no role may set it on a create or change it
 * on an update. What it holds is OneUptime's own bookkeeping - when a monitor
 * was archived and by whom, a queue's broker address as telemetry found it,
 * whether an owner has been told - and it changes as OneUptime works, so it
 * is left out of entries. A column nobody may read is left out already
 * (AuditLogRecorder); one people can read but not write is this.
 */
const isWrittenOnlyByOneUptime: (
  access: ColumnAccess | undefined,
) => boolean = (access: ColumnAccess | undefined): boolean => {
  return Boolean(
    access && isEmptyList(access.create) && isEmptyList(access.update),
  );
};

// One instance per related model, to read its table and singular names.
const relatedModels: WeakMap<CoverageModelType, AuditLogCoverageModel> =
  new WeakMap<CoverageModelType, AuditLogCoverageModel>();

const getRelatedModel: (
  modelType: CoverageModelType,
) => AuditLogCoverageModel = (
  modelType: CoverageModelType,
): AuditLogCoverageModel => {
  let model: AuditLogCoverageModel | undefined = relatedModels.get(modelType);

  if (!model) {
    model = new modelType();
    relatedModels.set(modelType, model);
  }

  return model;
};

const NAME_COLUMNS: ReadonlyArray<string> = ["name", "title", "displayName"];

/*
 * What names a row with no name, title or displayName of its own, by table
 * (issue #6287): every exception's entry in the project-wide audit log read
 * "Unnamed". The columns' values are made into a name by the recorder
 * (Server/Utils/AuditLog/AuditLogResourceNames).
 */
export const AUDIT_LOG_RESOURCE_NAME_COLUMNS: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  // Its type and the start of its message, made safe to show.
  TelemetryException: ["exceptionType", "message"],
  // The pipeline a job belongs to, and the job.
  DataPipeline: ["jobNamespace", "jobName"],
  // The runbook it is a run of, as it was named when the run started.
  RunbookExecution: ["runbookNameSnapshot"],
  /*
   * The number itself, so buying, attaching and releasing one says which
   * (issue #6301). The provider's id for it, and the call and SMS settings
   * it is bought with, never name it.
   */
  IncomingCallPolicyPhoneNumber: ["phoneNumber"],
};

// A column whose value names a row that has no name: a template's, a domain's.
const NAME_LIKE_COLUMNS: ReadonlyArray<string> = ["templateName", "fullDomain"];

/*
 * The resource a row belongs to, when it belongs to one with an Audit Logs
 * page of its own (AUDIT_LOG_ROOT_RESOURCE_TABLES): the many-to-one relation
 * to a root whose table name starts this table's name - a MessageQueueOwnerUser
 * belongs to its MessageQueue through messageQueueId, a StatusPageDomain to
 * its StatusPage, a WorkflowVariable to its Workflow. When several roots
 * start the name, the longest wins (an IncidentEpisodeMember belongs to its
 * episode, not to the incident it adds); two relations to the same root
 * (a link between two of them) name neither, as nothing says which it
 * belongs to; and a root is only ever its own root.
 */
export const inferRootResource: (
  model: AuditLogCoverageModel,
) => AuditLogRootResource | undefined = (
  model: AuditLogCoverageModel,
): AuditLogRootResource | undefined => {
  const tableName: string | null = model.tableName;

  if (!tableName || AUDIT_LOG_ROOT_RESOURCE_TABLES.has(tableName)) {
    return undefined;
  }

  let found: { tableLength: number; root: AuditLogRootResource } | undefined =
    undefined;
  let isTied: boolean = false;

  for (const column of model.getTableColumns().columns) {
    const metadata: TableColumnMetadata | undefined =
      model.getTableColumnMetadata(column);

    if (
      !metadata ||
      metadata.type !== TableColumnType.Entity ||
      !metadata.modelType ||
      !metadata.manyToOneRelationColumn
    ) {
      continue;
    }

    const root: AuditLogCoverageModel = getRelatedModel(
      metadata.modelType as unknown as CoverageModelType,
    );
    const rootTable: string | null = root.tableName;
    // The type the root's own entries are stored under, so the two match.
    const rootType: string | null = root.apiSingularName || root.singularName;

    if (
      !rootTable ||
      !rootType ||
      rootTable === tableName ||
      !tableName.startsWith(rootTable) ||
      !AUDIT_LOG_ROOT_RESOURCE_TABLES.has(rootTable)
    ) {
      continue;
    }

    const idColumn: string = metadata.manyToOneRelationColumn;

    if (
      !model.isTableColumn(idColumn) ||
      model.getTableColumnMetadata(idColumn)?.type !== TableColumnType.ObjectID
    ) {
      continue;
    }

    if (found && rootTable.length === found.tableLength) {
      isTied = isTied || found.root.column !== idColumn;
      continue;
    }

    if (!found || rootTable.length > found.tableLength) {
      found = {
        tableLength: rootTable.length,
        root: { resourceType: rootType, column: idColumn },
      };
      isTied = false;
    }
  }

  return isTied ? undefined : found?.root;
};

/*
 * What names a row that has no name of its own - an owner row, a member, an
 * escalation rule's user: the person, else the team, it is about.
 */
export const inferResourceNameRelation: (
  model: AuditLogCoverageModel,
) => string | undefined = (
  model: AuditLogCoverageModel,
): string | undefined => {
  if (
    NAME_COLUMNS.some((column: string): boolean => {
      return model.isTableColumn(column);
    })
  ) {
    return undefined;
  }

  for (const relation of ["user", "team"]) {
    if (!model.isTableColumn(relation)) {
      continue;
    }

    const metadata: TableColumnMetadata | undefined =
      model.getTableColumnMetadata(relation);

    if (
      metadata?.type === TableColumnType.Entity &&
      metadata.modelType &&
      metadata.manyToOneRelationColumn &&
      model.isTableColumn(metadata.manyToOneRelationColumn)
    ) {
      return relation;
    }
  }

  return undefined;
};

/*
 * The columns that name a row with no name of its own: those listed for its
 * table (AUDIT_LOG_RESOURCE_NAME_COLUMNS), else a template's name or a
 * domain's. None for a row with a name, a title or a displayName.
 */
export const inferResourceNameColumns: (
  model: AuditLogCoverageModel,
) => Array<string> | undefined = (
  model: AuditLogCoverageModel,
): Array<string> | undefined => {
  if (
    NAME_COLUMNS.some((column: string): boolean => {
      return model.isTableColumn(column);
    })
  ) {
    return undefined;
  }

  const tableName: string | null = model.tableName;
  const listed: ReadonlyArray<string> | undefined =
    tableName &&
    Object.prototype.hasOwnProperty.call(
      AUDIT_LOG_RESOURCE_NAME_COLUMNS,
      tableName,
    )
      ? AUDIT_LOG_RESOURCE_NAME_COLUMNS[tableName]
      : undefined;

  if (listed) {
    return [...listed];
  }

  const nameLike: string | undefined = NAME_LIKE_COLUMNS.find(
    (column: string): boolean => {
      return model.isTableColumn(column);
    },
  );

  return nameLike ? [nameLike] : undefined;
};

// Whether a project-scoped table is left out of the audit log, and why.
export const getAuditLogExemption: (
  tableName: string | null | undefined,
) => AuditLogExemptionKindDescription | null = (
  tableName: string | null | undefined,
): AuditLogExemptionKindDescription | null => {
  if (!tableName) {
    return null;
  }

  const kind: AuditLogExemptionKind | undefined =
    Object.prototype.hasOwnProperty.call(AUDIT_LOG_EXEMPT_TABLES, tableName)
      ? AUDIT_LOG_EXEMPT_TABLES[tableName]
      : undefined;

  return kind ? AUDIT_LOG_EXEMPTION_KINDS[kind] : null;
};

/*
 * What a model that declares nothing is audited with: create, update and
 * delete, leaving out what only OneUptime writes and what agents report,
 * recording secrets as changed without their values, rolling up to the
 * resource it belongs to, and named after the person or team it is about
 * when it has no name. Undefined for a model with no project to file its
 * changes under, and for an exempt one.
 */
export const getDefaultAuditLogOn: (
  model: AuditLogCoverageModel,
) => EnableAuditLogOn | undefined = (
  model: AuditLogCoverageModel,
): EnableAuditLogOn | undefined => {
  const tableName: string | null = model.tableName;

  if (!tableName || !model.getTenantColumn()) {
    return undefined;
  }

  if (getAuditLogExemption(tableName)) {
    return undefined;
  }

  const config: EnableAuditLogOn = {
    create: true,
    update: true,
    delete: true,
  };

  const access: Record<string, ColumnAccess> =
    getColumnAccessControlForAllColumns(model as never) as Record<
      string,
      ColumnAccess
    >;
  const reported: ReadonlySet<string> = new Set<string>(
    AUDIT_LOG_REPORTED_COLUMNS[tableName] || [],
  );
  const listedSecrets: ReadonlySet<string> = new Set<string>(
    AUDIT_LOG_SECRET_COLUMNS[tableName] || [],
  );
  const rootResource: AuditLogRootResource | undefined =
    inferRootResource(model);
  const rootColumn: string | undefined = rootResource?.column;

  const ignoreColumns: Array<string> = [];
  const redactColumns: Array<string> = [];

  for (const column of model.getTableColumns().columns) {
    const type: TableColumnType | undefined =
      model.getTableColumnMetadata(column)?.type;

    if (column !== rootColumn) {
      if (
        (type && BINARY_VALUE_TYPES.has(type)) ||
        reported.has(column) ||
        REPORTED_COLUMN_NAMES.has(column) ||
        isWorkerTimestampName(column) ||
        isWrittenOnlyByOneUptime(access[column])
      ) {
        ignoreColumns.push(column);
        continue;
      }
    }

    if (listedSecrets.has(column) || looksLikeSecretColumn(column, type)) {
      redactColumns.push(column);
    }
  }

  if (ignoreColumns.length > 0) {
    config.ignoreColumns = ignoreColumns;
  }

  if (redactColumns.length > 0) {
    config.redactColumns = redactColumns;
  }

  if (rootResource) {
    config.rootResource = rootResource;
  }

  const resourceNameRelation: string | undefined =
    inferResourceNameRelation(model);

  if (resourceNameRelation) {
    config.resourceNameRelation = resourceNameRelation;
  }

  const resourceNameColumns: Array<string> | undefined =
    inferResourceNameColumns(model);

  if (resourceNameColumns) {
    config.resourceNameColumns = resourceNameColumns;
  }

  return config;
};

// Frozen all the way down: one configuration is shared by every instance.
const freezeAuditLogOn: (config: EnableAuditLogOn) => EnableAuditLogOn = (
  config: EnableAuditLogOn,
): EnableAuditLogOn => {
  if (config.ignoreColumns) {
    Object.freeze(config.ignoreColumns);
  }

  if (config.redactColumns) {
    Object.freeze(config.redactColumns);
  }

  if (config.rootResource) {
    Object.freeze(config.rootResource);
  }

  if (config.resourceNameColumns) {
    Object.freeze(config.resourceNameColumns);
  }

  return Object.freeze(config);
};

/*
 * Worked out once per model class, from a fresh instance of it: the answer
 * depends on the class's decorators only, and the column metadata is read
 * off an instance (the prototype has none of the columns' own keys). Keyed by
 * constructor, so the prototype and every instance share it.
 */
const defaultsByModelType: WeakMap<CoverageModelType, EnableAuditLogOn | null> =
  new WeakMap<CoverageModelType, EnableAuditLogOn | null>();

export const getCachedDefaultAuditLogOn: (
  model: AuditLogCoverageModel,
) => EnableAuditLogOn | undefined = (
  model: AuditLogCoverageModel,
): EnableAuditLogOn | undefined => {
  const modelType: CoverageModelType = (
    model as unknown as { constructor: CoverageModelType }
  ).constructor;

  if (defaultsByModelType.has(modelType)) {
    return defaultsByModelType.get(modelType) || undefined;
  }

  const config: EnableAuditLogOn | undefined = getDefaultAuditLogOn(
    new modelType(),
  );

  defaultsByModelType.set(modelType, config ? freezeAuditLogOn(config) : null);

  return defaultsByModelType.get(modelType) || undefined;
};
