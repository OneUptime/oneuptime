import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsModels from "../../Models/AnalyticsModels/Index";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "../../Models/DatabaseModels/Index";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../Types/Dictionary";
import { ALWAYS_SELECTABLE_COLUMNS } from "../../Types/HeldPermissions";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../Types/Permission";
import {
  RUNBOOK_ADVANCE_PERMISSIONS,
  RUNBOOK_RUN_PERMISSIONS,
} from "../../Types/Runbook/RunbookRunPermissions";
import { WORKFLOW_RUN_PERMISSIONS } from "../../Types/Workflow/WorkflowRunPermissions";
import { PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS } from "../../Utils/Project/NotificationChannels";
import {
  PAYMENT_METHOD_ADD_PERMISSIONS,
  PAYMENT_METHOD_SET_DEFAULT_PERMISSIONS,
  PROJECT_BILLING_CONTACT_UPDATE_PERMISSIONS,
  PROJECT_INVOICE_PAY_PERMISSIONS,
} from "../../Utils/Project/ProjectBilling";
import { describe, expect, test } from "@jest/globals";

/*
 * EVERY ROLE DOES WHAT ITS DESCRIPTION SAYS, AND NOTHING MORE.
 *
 * The permission picker shows each role's title and description, and that
 * is all an administrator has to go on when giving a team a role. Several
 * descriptions promised what no list let the role do - Settings Admin "API
 * keys, teams, team permissions, labels, SSO, SMTP, call/SMS config,
 * domains", Telemetry Admin "ingestion keys, and log pipelines", Monitor
 * Admin "probes, secrets", Status Page Admin "SSO configurations" - and
 * others said too little: Project Member "can view most resources" while it
 * created, changed and deleted them, and Runbook Member created and deleted
 * runbooks and Runners its description did not mention a limit on.
 *
 * Runbook Member now opens runbooks and runs them, and builds none
 * (Types/Runbook/RunbookRunPermissions); every other description says what
 * the role's lists let it do. This file holds each description to those
 * lists, three ways:
 *
 *   1. Every role's description is pinned word for word here, so changing
 *      one means coming back to this file and its claims.
 *   2. Each sentence's claims are checked against the tables it names: what
 *      the role creates, changes, deletes or reads, and what it may not.
 *   3. The shapes the descriptions speak in hold across every table and
 *      column: "Does everything X does" is a superset of X, "Same as X" is X
 *      exactly, and a role that "changes nothing" or is "Read-only" is on no
 *      list that writes, and on none of the lists that act outside the
 *      tables (running a workflow or a runbook, paying an invoice).
 */

type Operation = "create" | "read" | "update" | "delete";

type WriteOperation = "create" | "update";

interface TableAccess {
  lists: Record<Operation, Array<Permission>>;
  columns: Dictionary<ColumnAccessControl>;
}

type AnyModel = DatabaseBaseModel | AnalyticsBaseModel;

type ModelConstructor = { new (): AnyModel };

const TABLES: Map<string, TableAccess> = new Map<string, TableAccess>();

for (const modelType of [
  ...(AllModelTypes as unknown as Array<ModelConstructor>),
  ...(AnalyticsModels as unknown as Array<ModelConstructor>),
]) {
  const model: AnyModel = new modelType();
  const name: string = model.tableName || model.constructor.name;

  TABLES.set(name, {
    lists: {
      create: model.getCreatePermissions(),
      read: model.getReadPermissions(),
      update: model.getUpdatePermissions(),
      delete: model.getDeletePermissions(),
    },
    columns: model.getColumnAccessControlForAllColumns(),
  });
}

function table(name: string): TableAccess {
  const access: TableAccess | undefined = TABLES.get(name);

  if (!access) {
    throw new Error(`No model has the table name ${name}.`);
  }

  return access;
}

/*
 * The columns a role may write, leaving out the ones every record has
 * (_id, createdAt, ...): they take the table's lists, and no write sets
 * them.
 */
function writableColumns(
  access: TableAccess,
  role: Permission,
  operation: WriteOperation,
): Array<string> {
  return Object.keys(access.columns).filter((column: string): boolean => {
    return (
      !ALWAYS_SELECTABLE_COLUMNS.includes(column) &&
      (access.columns[column]?.[operation] || []).includes(role)
    );
  });
}

/*
 * Whether the role may do it: the table's list names it, and - for a
 * create or a change - so does at least one column the write can set.
 */
function may(role: Permission, operation: Operation, name: string): boolean {
  const access: TableAccess = table(name);

  if (!access.lists[operation].includes(role)) {
    return false;
  }

  if (operation === "create" || operation === "update") {
    return writableColumns(access, role, operation).length > 0;
  }

  return true;
}

// Whether the table's own list names the role: what a refusal is decided by.
function named(role: Permission, operation: Operation, name: string): boolean {
  return table(name).lists[operation].includes(role);
}

function roleProps(): Array<PermissionProps> {
  return PermissionHelper.getRolePermissionProps();
}

function propsOf(role: Permission): PermissionProps {
  const props: PermissionProps | undefined = roleProps().find(
    (candidate: PermissionProps): boolean => {
      return candidate.permission === role;
    },
  );

  if (!props) {
    throw new Error(`${role} is not a role.`);
  }

  return props;
}

function roleByTitle(title: string): Permission {
  const props: PermissionProps | undefined = roleProps().find(
    (candidate: PermissionProps): boolean => {
      return candidate.title === title;
    },
  );

  if (!props) {
    throw new Error(`No role is called ${title}.`);
  }

  return props.permission;
}

const DESCRIPTIONS: Record<string, string> = {
  [Permission.ProjectOwner]:
    "Owner of this project. Does everything Project Admin does, and also manages billing and payment methods, sets up SCIM, and can delete the project.",
  [Permission.ProjectAdmin]:
    "Admin of this project. Creates, changes and deletes everything in it, including team members and their permissions, API keys, labels, SSO, rules and custom fields, and reads the audit log. Cannot manage billing, set up SCIM or delete the project.",
  [Permission.ProjectMember]:
    "Member of this project. Creates, changes and deletes monitors, incidents, alerts, status pages, on-call policies, scheduled maintenance, services and infrastructure, and runs runbooks. Project settings take Project Admin: team members and permissions, API keys, labels, SSO, rules, custom fields, states, secrets, dashboards, SLOs, and changing workflows and runbooks. Does not see API keys, the audit log, invoices, secrets, session replays or security data.",
  [Permission.Viewer]:
    "Reads the project's resources and changes nothing. Does not see API keys, the audit log, invoices, secrets, session replays, security data, or AI conversations, insights and remediation suggestions.",
  [Permission.IncidentAdmin]:
    "Does everything Incident Member does, and also creates, changes and deletes incident severities and states. Incident rules, custom fields, measurements and SLAs take Project Admin.",
  [Permission.IncidentMember]:
    "Creates, changes and deletes incidents and incident episodes, with their notes, state timelines, owners, roles and linked alerts, and incident, note and postmortem templates. Cannot change incident severities or states.",
  [Permission.IncidentViewer]:
    "Read-only access to incidents and incident resources.",
  [Permission.AlertAdmin]:
    "Does everything Alert Member does, and also creates, changes and deletes alert severities and states. Alert rules, custom fields and measurements take Project Admin.",
  [Permission.AlertMember]:
    "Creates, changes and deletes alerts and alert episodes, with their notes, state timelines and owners, links alerts to incidents, and manages alert note templates. Cannot change alert severities or states.",
  [Permission.AlertViewer]: "Read-only access to alerts and alert resources.",
  [Permission.MonitorAdmin]:
    "Does everything Monitor Member does, and also creates, changes and deletes monitor statuses. Monitor secrets, rules and custom fields take Project Admin. Probes are not part of it.",
  [Permission.MonitorMember]:
    "Creates, changes and deletes monitors, monitor groups and monitor templates, with their owners, tests and status timelines. Cannot change monitor statuses or manage monitor secrets.",
  [Permission.MonitorViewer]:
    "Read-only access to monitors and monitor resources.",
  [Permission.StatusPageAdmin]:
    "Creates, changes and deletes status pages and what they show: announcements, subscribers, resources, groups, links, domains, private users and templates. Status page SSO, SCIM, rules and custom fields take Project Admin.",
  [Permission.StatusPageMember]:
    "Same as Status Page Admin: creates, changes and deletes status pages and what they show, including announcements, subscribers, resources, groups, links, domains, private users and templates.",
  [Permission.StatusPageViewer]:
    "Read-only access to status pages and status page resources.",
  [Permission.OnCallAdmin]:
    "Creates, changes and deletes on-call duty policies with their escalation rules, on-call schedules with their layers, and user overrides. On-call rules and custom fields take Project Admin. Incoming call policies are not part of it.",
  [Permission.OnCallMember]:
    "Same as On-Call Admin: creates, changes and deletes on-call duty policies with their escalation rules, on-call schedules with their layers, and user overrides.",
  [Permission.OnCallViewer]:
    "Read-only access to on-call duty policies and schedules.",
  [Permission.ScheduledMaintenanceAdmin]:
    "Does everything Scheduled Maintenance Member does, and also creates, changes and deletes maintenance states. Scheduled maintenance rules, custom fields and measurements take Project Admin.",
  [Permission.ScheduledMaintenanceMember]:
    "Creates, changes and deletes scheduled maintenance events with their notes, state timelines and owners, and scheduled maintenance and note templates. Cannot change maintenance states.",
  [Permission.ScheduledMaintenanceViewer]:
    "Read-only access to scheduled maintenances and maintenance resources.",
  [Permission.TelemetryAdmin]:
    "Does everything Telemetry Member does, and also reads and deletes session replays, deletes change events and edits inventory items. Telemetry pipelines, ingestion keys, source maps, services and RUM applications are not part of it.",
  [Permission.TelemetryMember]:
    "Reads logs, traces, metrics, profiles and exceptions, sends and deletes them, manages saved views, and creates and changes metric types. Does not see session replays. Cannot resolve or archive exceptions, or manage telemetry pipelines, ingestion keys, source maps or services.",
  [Permission.TelemetryViewer]:
    "Reads logs, traces, metrics, profiles, exceptions and saved views, and changes nothing. Does not see session replays.",
  [Permission.SecurityAdmin]:
    "Full control over the SIEM: security events, Sigma detection rules, threat intelligence feeds and their indicators, and security event connections (Google SecOps, Microsoft Sentinel, CrowdStrike Falcon and other sources). Outside the Security roles, only Project Owner and Project Admin read security data.",
  [Permission.SecurityMember]:
    "Reads security events and threat intelligence, sends security events, and creates, changes and deletes detection rules and threat intel feeds. Cannot configure security event connections or delete security data.",
  [Permission.SecurityViewer]:
    "Read-only access to security events, detection rules, threat intelligence feeds and indicators, and security event connections.",
  [Permission.SettingsAdmin]:
    "Does everything Settings Member does, and also connects video call providers and reads the audit log. API keys, teams and their permissions, labels, SSO, SMTP, call and SMS settings and domains take Project Admin.",
  [Permission.SettingsMember]:
    "Creates, changes and deletes the project's services, probes, hosts, clusters and other infrastructure, AI agents, LLM providers, incoming call policies, dashboard domains and Slack and Microsoft Teams notification rules, and connects code repositories. Cannot manage API keys, teams, labels, SSO or video call connections.",
  [Permission.SettingsViewer]:
    "Reads the project's settings, including teams and their permissions, labels, SSO, domains, probes, services and infrastructure, and changes nothing. Does not see API keys or the audit log.",
  [Permission.BillingAdmin]:
    "Does what Billing Member does, and turns the project's SMS, phone call, WhatsApp and Telegram notifications on and off. Changing the plan, payment methods or balances, and paying invoices, takes Project Owner or Manage Billing.",
  [Permission.BillingMember]:
    "Reads the project's billing as Billing Viewer does, downloads invoices, and changes the billing contact details: the billing address, the finance email and whether invoices are emailed to it. Changing the plan, payment methods or balances, and paying invoices, takes Project Owner or Manage Billing.",
  [Permission.BillingViewer]:
    "Reads the project's billing: the plan and subscription, invoices, usage, balances, AI credits, payment methods and billing contact details. Changes nothing.",
  [Permission.WorkflowAdmin]:
    "Builds workflows: creates, edits, runs and deletes them, manages workflow variables, and reads every run.",
  [Permission.WorkflowMember]:
    "Opens workflows and their runs, and runs workflows by hand. Cannot create, change or delete them.",
  [Permission.WorkflowViewer]:
    "Read-only access to workflows and workflow logs.",
  [Permission.RunbookAdmin]:
    "Creates, changes, runs and deletes runbooks with their rules and owners, and the Runners they run on, and manages their runs. Runbook credentials, secrets, label rules and owner rules take Project Admin.",
  [Permission.RunbookMember]:
    "Opens runbooks and their runs, and runs runbooks by hand: starts a run, completes or skips its steps, and cancels it. Cannot create, change or delete runbooks or Runners.",
  [Permission.RunbookViewer]:
    "Read-only access to runbooks and their runs. Cannot run them.",
};

type Claim = [Operation, string];

interface RoleClaims {
  may: Array<Claim>;
  mayNot: Array<Claim>;
}

// Create, change and delete: the three claims a "creates, changes and deletes" makes.
function manages(...names: Array<string>): Array<Claim> {
  const claims: Array<Claim> = [];

  for (const name of names) {
    claims.push(["create", name], ["update", name], ["delete", name]);
  }

  return claims;
}

/*
 * Owner rows and user overrides have nothing to change once made: they are
 * added and removed.
 */
function addsAndRemoves(...names: Array<string>): Array<Claim> {
  const claims: Array<Claim> = [];

  for (const name of names) {
    claims.push(["create", name], ["delete", name]);
  }

  return claims;
}

function creates(...names: Array<string>): Array<Claim> {
  return names.map((name: string): Claim => {
    return ["create", name];
  });
}

function reads(...names: Array<string>): Array<Claim> {
  return names.map((name: string): Claim => {
    return ["read", name];
  });
}

/*
 * What each description claims, sentence by sentence, as the tables it
 * names. The Billing and Workflow roles are held to their lists by
 * RoleDecisionsDescriptions and BillingRolesPermissionMatrix.
 */
const CLAIMS: Partial<Record<Permission, RoleClaims>> = {
  [Permission.ProjectOwner]: {
    may: [
      ...creates("BillingPaymentMethod", "ProjectSCIM"),
      ["delete", "BillingPaymentMethod"],
      ["update", "ProjectSCIM"],
      ["delete", "Project"],
    ],
    mayNot: [],
  },
  [Permission.ProjectAdmin]: {
    may: [
      ...manages(
        "TeamPermission",
        "ApiKey",
        "Label",
        "ProjectSSO",
        "IncidentLabelRule",
        "IncidentCustomField",
      ),
      ...creates("TeamMember", "Team"),
      ["delete", "TeamMember"],
      ...reads("AuditLogV2"),
    ],
    mayNot: [
      ["create", "BillingPaymentMethod"],
      ["delete", "BillingPaymentMethod"],
      ["create", "ProjectSCIM"],
      ["update", "ProjectSCIM"],
      ["delete", "Project"],
    ],
  },
  [Permission.ProjectMember]: {
    may: [
      ...manages(
        "Monitor",
        "Incident",
        "Alert",
        "StatusPage",
        "OnCallDutyPolicy",
        "OnCallDutyPolicySchedule",
        "ScheduledMaintenance",
        "Service",
        "Host",
        "KubernetesCluster",
      ),
      ["create", "RunbookExecution"],
    ],
    mayNot: [
      ...creates(
        "TeamMember",
        "TeamPermission",
        "Team",
        "ApiKey",
        "Label",
        "ProjectSSO",
        "IncidentLabelRule",
        "MonitorOwnerRule",
        "IncidentCustomField",
        "IncidentState",
        "AlertState",
        "MonitorStatus",
        "MonitorSecret",
        "RunbookSecret",
        "Dashboard",
        "ServiceLevelObjective",
      ),
      ["update", "Workflow"],
      ["update", "Runbook"],
      ...reads(
        "ApiKey",
        "AuditLogV2",
        "BillingInvoice",
        "MonitorSecret",
        "RunbookSecret",
        "RumSessionV1",
        "SecurityEventItemV1",
      ),
    ],
  },
  [Permission.Viewer]: {
    may: reads("Monitor", "Incident", "Alert", "StatusPage", "Service"),
    mayNot: reads(
      "ApiKey",
      "AuditLogV2",
      "BillingInvoice",
      "MonitorSecret",
      "RunbookSecret",
      "RumSessionV1",
      "SecurityEventItemV1",
      "AIConversation",
      "AIInsight",
      "AutoRemediationSuggestion",
    ),
  },
  [Permission.IncidentAdmin]: {
    may: manages("IncidentSeverity", "IncidentState"),
    mayNot: creates(
      "IncidentLabelRule",
      "IncidentOwnerRule",
      "IncidentOnCallRule",
      "IncidentGroupingRule",
      "IncidentReminderRule",
      "IncidentPrivacyRule",
      "IncidentCustomField",
      "IncidentMeasurement",
      "IncidentSla",
      "IncidentSlaRule",
    ),
  },
  [Permission.IncidentMember]: {
    may: [
      ...manages(
        "Incident",
        "IncidentEpisode",
        "IncidentInternalNote",
        "IncidentPublicNote",
        "IncidentStateTimeline",
        "IncidentRole",
        "IncidentTemplate",
        "IncidentNoteTemplate",
        "IncidentPostmortemTemplate",
      ),
      ...addsAndRemoves(
        "IncidentOwnerTeam",
        "IncidentOwnerUser",
        "IncidentAlert",
      ),
    ],
    mayNot: manages("IncidentSeverity", "IncidentState"),
  },
  [Permission.AlertAdmin]: {
    may: manages("AlertSeverity", "AlertState"),
    mayNot: creates(
      "AlertLabelRule",
      "AlertOwnerRule",
      "AlertOnCallRule",
      "AlertGroupingRule",
      "AlertCustomField",
      "AlertMeasurement",
    ),
  },
  [Permission.AlertMember]: {
    may: [
      ...manages(
        "Alert",
        "AlertEpisode",
        "AlertInternalNote",
        "AlertStateTimeline",
        "AlertNoteTemplate",
      ),
      ...addsAndRemoves("AlertOwnerTeam", "AlertOwnerUser", "IncidentAlert"),
    ],
    mayNot: manages("AlertSeverity", "AlertState"),
  },
  [Permission.MonitorAdmin]: {
    may: manages("MonitorStatus"),
    mayNot: [
      ...creates(
        "MonitorSecret",
        "MonitorLabelRule",
        "MonitorOwnerRule",
        "MonitorCustomField",
        "Probe",
      ),
      ...reads("MonitorSecret"),
    ],
  },
  [Permission.MonitorMember]: {
    may: [
      ...manages(
        "Monitor",
        "MonitorGroup",
        "MonitorTemplate",
        "MonitorTest",
        "MonitorStatusTimeline",
      ),
      ...addsAndRemoves("MonitorOwnerTeam", "MonitorOwnerUser"),
    ],
    mayNot: [...manages("MonitorStatus"), ...creates("MonitorSecret")],
  },
  [Permission.StatusPageAdmin]: {
    may: manages(
      "StatusPage",
      "StatusPageAnnouncement",
      "StatusPageSubscriber",
      "StatusPageResource",
      "StatusPageGroup",
      "StatusPageHeaderLink",
      "StatusPageFooterLink",
      "StatusPageDomain",
      "StatusPagePrivateUser",
      "StatusPageAnnouncementTemplate",
      "StatusPageSubscriberNotificationTemplate",
    ),
    mayNot: creates(
      "StatusPageSSO",
      "StatusPageOIDC",
      "StatusPageSCIM",
      "StatusPageLabelRule",
      "StatusPageOwnerRule",
      "StatusPageCustomField",
    ),
  },
  [Permission.OnCallAdmin]: {
    may: [
      ...manages(
        "OnCallDutyPolicy",
        "OnCallDutyPolicyEscalationRule",
        "OnCallDutyPolicySchedule",
        "OnCallDutyPolicyScheduleLayer",
      ),
      ...addsAndRemoves("OnCallDutyPolicyUserOverride"),
    ],
    mayNot: creates(
      "OnCallDutyPolicyLabelRule",
      "OnCallDutyPolicyOwnerRule",
      "OnCallDutyPolicyScheduleLabelRule",
      "OnCallDutyPolicyCustomField",
      "IncomingCallPolicy",
    ),
  },
  [Permission.ScheduledMaintenanceAdmin]: {
    may: manages("ScheduledMaintenanceState"),
    mayNot: creates(
      "ScheduledMaintenanceLabelRule",
      "ScheduledMaintenanceOwnerRule",
      "ScheduledMaintenanceReminderRule",
      "ScheduledMaintenanceCustomField",
      "ScheduledMaintenanceMeasurement",
    ),
  },
  [Permission.ScheduledMaintenanceMember]: {
    may: [
      ...manages(
        "ScheduledMaintenance",
        "ScheduledMaintenanceInternalNote",
        "ScheduledMaintenancePublicNote",
        "ScheduledMaintenanceStateTimeline",
        "ScheduledMaintenanceTemplate",
        "ScheduledMaintenanceNoteTemplate",
      ),
      ...addsAndRemoves(
        "ScheduledMaintenanceOwnerTeam",
        "ScheduledMaintenanceOwnerUser",
      ),
    ],
    mayNot: manages("ScheduledMaintenanceState"),
  },
  [Permission.TelemetryAdmin]: {
    may: [
      ...reads("RumSessionV1"),
      ["delete", "RumSessionV1"],
      ["delete", "ChangeEventV1"],
      ["update", "InventoryItem"],
    ],
    mayNot: [
      ...creates(
        "LogPipeline",
        "TracePipeline",
        "TelemetryIngestionKey",
        "TelemetrySourceMap",
        "Service",
        "RumApplication",
      ),
    ],
  },
  [Permission.TelemetryMember]: {
    may: [
      ...reads(
        "LogItemV3",
        "SpanItemV3",
        "MetricItemV3",
        "ProfileItemV3",
        "ExceptionItemV3",
        "TelemetryException",
      ),
      ...creates("LogItemV3", "SpanItemV3", "MetricItemV3"),
      ["delete", "LogItemV3"],
      ["delete", "SpanItemV3"],
      ...manages("LogSavedView", "TraceSavedView", "MetricSavedView"),
      ["create", "MetricType"],
      ["update", "MetricType"],
    ],
    mayNot: [
      ...reads("RumSessionV1"),
      ["update", "TelemetryException"],
      ...creates(
        "LogPipeline",
        "TelemetryIngestionKey",
        "TelemetrySourceMap",
        "Service",
      ),
    ],
  },
  [Permission.TelemetryViewer]: {
    may: reads(
      "LogItemV3",
      "SpanItemV3",
      "MetricItemV3",
      "ProfileItemV3",
      "ExceptionItemV3",
      "LogSavedView",
    ),
    mayNot: reads("RumSessionV1"),
  },
  [Permission.SecurityAdmin]: {
    may: [
      ...manages("DetectionRule", "ThreatIntelFeed", "SecurityEventConnection"),
      ["create", "SecurityEventItemV1"],
      ["delete", "SecurityEventItemV1"],
      ["delete", "ThreatIntelIndicatorItemV1"],
    ],
    mayNot: [],
  },
  [Permission.SecurityMember]: {
    may: [
      ...reads("SecurityEventItemV1", "ThreatIntelIndicatorItemV1"),
      ["create", "SecurityEventItemV1"],
      ...manages("DetectionRule", "ThreatIntelFeed"),
    ],
    mayNot: [
      ...manages("SecurityEventConnection"),
      ["delete", "SecurityEventItemV1"],
      ["delete", "ThreatIntelIndicatorItemV1"],
    ],
  },
  [Permission.SecurityViewer]: {
    may: reads(
      "SecurityEventItemV1",
      "DetectionRule",
      "ThreatIntelFeed",
      "ThreatIntelIndicatorItemV1",
      "SecurityEventConnection",
    ),
    mayNot: [],
  },
  [Permission.SettingsAdmin]: {
    may: [...manages("VideoCallConnection"), ...reads("AuditLogV2")],
    mayNot: creates(
      "ApiKey",
      "Team",
      "TeamMember",
      "TeamPermission",
      "Label",
      "ProjectSSO",
      "ProjectSMTPConfig",
      "ProjectCallSMSConfig",
      "Domain",
    ),
  },
  [Permission.SettingsMember]: {
    may: [
      ...manages(
        "Service",
        "Probe",
        "Host",
        "KubernetesCluster",
        "AIAgent",
        "LlmProvider",
        "IncomingCallPolicy",
        "DashboardDomain",
        "WorkspaceNotificationRule",
      ),
      ["create", "CodeRepository"],
    ],
    mayNot: creates(
      "ApiKey",
      "Team",
      "TeamPermission",
      "Label",
      "ProjectSSO",
      "VideoCallConnection",
    ),
  },
  [Permission.SettingsViewer]: {
    may: reads(
      "Team",
      "TeamPermission",
      "Label",
      "ProjectSSO",
      "Domain",
      "Probe",
      "Service",
      "Host",
    ),
    mayNot: reads("ApiKey", "AuditLogV2"),
  },
  [Permission.RunbookAdmin]: {
    may: [
      ...manages("Runbook", "RunbookRule", "Runner"),
      ...addsAndRemoves(
        "RunbookOwnerTeam",
        "RunbookOwnerUser",
        "RunnerOwnerTeam",
        "RunnerOwnerUser",
      ),
      ["create", "RunbookExecution"],
      ["update", "RunbookExecution"],
    ],
    mayNot: creates(
      "RunbookCredential",
      "RunbookSecret",
      "RunbookLabelRule",
      "RunbookOwnerRule",
    ),
  },
  [Permission.RunbookMember]: {
    may: [...reads("Runbook", "RunbookExecution", "Runner")],
    mayNot: [
      ...manages(
        "Runbook",
        "Runner",
        "RunbookOwnerTeam",
        "RunbookOwnerUser",
        "RunnerOwnerTeam",
        "RunnerOwnerUser",
        "RunbookRule",
      ),
    ],
  },
  [Permission.RunbookViewer]: {
    may: reads("Runbook", "RunbookExecution"),
    mayNot: creates("RunbookExecution"),
  },
};

describe("the descriptions", () => {
  test("every role is described here, and nothing that is not a role", () => {
    expect(
      roleProps()
        .map((props: PermissionProps): string => {
          return props.permission;
        })
        .sort(),
    ).toEqual(Object.keys(DESCRIPTIONS).sort());
  });

  test.each(Object.keys(DESCRIPTIONS))(
    "%s says what is pinned here, word for word",
    (role: string) => {
      expect(propsOf(role as Permission).description).toBe(DESCRIPTIONS[role]);
      expect(PermissionHelper.getDescription(role as Permission)).toBe(
        DESCRIPTIONS[role],
      );
    },
  );

  test("every role with a claim to check has one written here, apart from the ones held by their own suites", () => {
    const heldElsewhere: Array<Permission> = [
      Permission.BillingAdmin,
      Permission.BillingMember,
      Permission.BillingViewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      // Read-only family viewers: held by the shape rules below.
      Permission.IncidentViewer,
      Permission.AlertViewer,
      Permission.MonitorViewer,
      Permission.StatusPageViewer,
      Permission.OnCallViewer,
      Permission.ScheduledMaintenanceViewer,
      // "Same as": held to the role they name by the shape rules below.
      Permission.StatusPageMember,
      Permission.OnCallMember,
    ];

    for (const props of roleProps()) {
      expect([
        props.permission,
        Boolean(CLAIMS[props.permission]) ||
          heldElsewhere.includes(props.permission),
      ]).toEqual([props.permission, true]);
    }
  });
});

describe("what each description claims", () => {
  const cases: Array<[Permission, Operation, string, boolean]> = [];

  for (const [role, claims] of Object.entries(CLAIMS) as Array<
    [Permission, RoleClaims]
  >) {
    for (const [operation, name] of claims.may) {
      cases.push([role, operation, name, true]);
    }

    for (const [operation, name] of claims.mayNot) {
      cases.push([role, operation, name, false]);
    }
  }

  test.each(cases)(
    "%s: %s %s is %s",
    (
      role: Permission,
      operation: Operation,
      name: string,
      expected: boolean,
    ) => {
      if (expected) {
        expect(may(role, operation, name)).toBe(true);
      } else {
        // Refused by the table itself, not only by its columns.
        expect(named(role, operation, name)).toBe(false);
      }
    },
  );
});

/*
 * "Does everything X does": every list - table and column, every
 * operation - that names X names the role too.
 */
function expectCovers(role: Permission, covered: Permission): void {
  const missing: Array<string> = [];

  for (const [name, access] of TABLES.entries()) {
    for (const operation of [
      "create",
      "read",
      "update",
      "delete",
    ] as Array<Operation>) {
      if (
        access.lists[operation].includes(covered) &&
        !access.lists[operation].includes(role)
      ) {
        missing.push(`${name} ${operation}`);
      }
    }

    for (const [column, acl] of Object.entries(access.columns)) {
      for (const operation of ["create", "read", "update"] as Array<
        "create" | "read" | "update"
      >) {
        const list: Array<Permission> = acl?.[operation] || [];

        if (list.includes(covered) && !list.includes(role)) {
          missing.push(`${name}.${column} ${operation}`);
        }
      }
    }
  }

  expect(missing).toEqual([]);
}

// Every list that lets someone act outside the tables' own lists.
const ACTION_LISTS: Record<string, ReadonlyArray<Permission>> = {
  "run a runbook": RUNBOOK_RUN_PERMISSIONS,
  "move a runbook run along": RUNBOOK_ADVANCE_PERMISSIONS,
  "run a workflow": WORKFLOW_RUN_PERMISSIONS,
  "turn the paid notification channels on and off":
    PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS,
  "change the billing contact details":
    PROJECT_BILLING_CONTACT_UPDATE_PERMISSIONS,
  "add a payment method": PAYMENT_METHOD_ADD_PERMISSIONS,
  "change the default payment method": PAYMENT_METHOD_SET_DEFAULT_PERMISSIONS,
  "pay an invoice": PROJECT_INVOICE_PAY_PERMISSIONS,
};

function writesOf(role: Permission): Array<string> {
  const writes: Array<string> = [];

  for (const [name, access] of TABLES.entries()) {
    for (const operation of [
      "create",
      "update",
      "delete",
    ] as Array<Operation>) {
      if (access.lists[operation].includes(role)) {
        writes.push(`${name} ${operation}`);
      }
    }

    for (const [column, acl] of Object.entries(access.columns)) {
      for (const operation of ["create", "update"] as Array<WriteOperation>) {
        if ((acl?.[operation] || []).includes(role)) {
          writes.push(`${name}.${column} ${operation}`);
        }
      }
    }
  }

  for (const [action, list] of Object.entries(ACTION_LISTS)) {
    if (list.includes(role)) {
      writes.push(action);
    }
  }

  return writes;
}

// A description that says the role changes nothing, in any case.
const CHANGES_NOTHING: RegExp = new RegExp("\\bchanges nothing\\b", "i");

describe("the shapes the descriptions speak in", () => {
  const doesEverything: Array<[Permission, string]> = [];
  const sameAs: Array<[Permission, string]> = [];
  const readOnly: Array<Permission> = [];

  for (const [role, description] of Object.entries(DESCRIPTIONS) as Array<
    [Permission, string]
  >) {
    const everything: RegExpMatchArray | null = description.match(
      /^(?:.*?\. )?Does (?:everything|what) (.+?) does\b/,
    );

    if (everything) {
      doesEverything.push([role, everything[1]!]);
    }

    const same: RegExpMatchArray | null = description.match(/^Same as (.+?):/);

    if (same) {
      sameAs.push([role, same[1]!]);
    }

    if (
      description.startsWith("Read-only access") ||
      CHANGES_NOTHING.test(description)
    ) {
      readOnly.push(role);
    }
  }

  test("the shapes are found where they are meant to be", () => {
    expect(
      doesEverything.map(([role]: [Permission, string]): Permission => {
        return role;
      }),
    ).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.IncidentAdmin,
        Permission.AlertAdmin,
        Permission.MonitorAdmin,
        Permission.ScheduledMaintenanceAdmin,
        Permission.TelemetryAdmin,
        Permission.SettingsAdmin,
        Permission.BillingAdmin,
      ]),
    );
    expect(
      sameAs.map(([role]: [Permission, string]): Permission => {
        return role;
      }),
    ).toEqual([Permission.StatusPageMember, Permission.OnCallMember]);
    expect(readOnly).toEqual(
      expect.arrayContaining([
        Permission.Viewer,
        Permission.IncidentViewer,
        Permission.AlertViewer,
        Permission.MonitorViewer,
        Permission.StatusPageViewer,
        Permission.OnCallViewer,
        Permission.ScheduledMaintenanceViewer,
        Permission.TelemetryViewer,
        Permission.SecurityViewer,
        Permission.SettingsViewer,
        Permission.BillingViewer,
        Permission.WorkflowViewer,
        Permission.RunbookViewer,
      ]),
    );
  });

  test.each(doesEverything)(
    "%s does everything %s does: every list naming that role names it too",
    (role: Permission, title: string) => {
      expectCovers(role, roleByTitle(title));
    },
  );

  test.each(sameAs)(
    "%s is the same as %s: each names the other on every list",
    (role: Permission, title: string) => {
      const other: Permission = roleByTitle(title);

      expectCovers(role, other);
      expectCovers(other, role);
    },
  );

  test.each(readOnly)(
    "%s changes nothing: no table, column or action list that writes names it",
    (role: Permission) => {
      expect(writesOf(role)).toEqual([]);
    },
  );

  /*
   * Each area's Admin does what its Member does, and its Member reads what
   * its Viewer reads: the three levels nest, whatever the descriptions say
   * on top.
   */
  const FAMILIES: Array<[Permission, Permission, Permission]> = [
    [
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
    ],
    [Permission.AlertAdmin, Permission.AlertMember, Permission.AlertViewer],
    [
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
    ],
    [
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
    ],
    [Permission.OnCallAdmin, Permission.OnCallMember, Permission.OnCallViewer],
    [
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
    ],
    [
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
    ],
    [
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.SecurityViewer,
    ],
    [
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
    ],
    [
      Permission.BillingAdmin,
      Permission.BillingMember,
      Permission.BillingViewer,
    ],
    [
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
    ],
    [
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
    ],
  ];

  test.each(FAMILIES)(
    "%s does what %s does, which reads what %s reads",
    (admin: Permission, member: Permission, viewer: Permission) => {
      expectCovers(admin, member);
      expectCovers(member, viewer);

      for (const [action, list] of Object.entries(ACTION_LISTS)) {
        if (list.includes(member)) {
          expect([action, list.includes(admin)]).toEqual([action, true]);
        }
      }
    },
  );
});

/*
 * RUNBOOK MEMBER RUNS RUNBOOKS AND BUILDS NONE. It used to be on the create
 * and delete lists of runbooks, Runners and their owners - so it could add
 * a Runner, the machine runbooks run on, or delete a runbook, while its
 * description promised nothing of the sort - and it could edit none of
 * them.
 */
describe("Runbook Member", () => {
  test("starts runs and moves them along: it is on both run lists, and the start list is RunbookExecution's create list", () => {
    expect(RUNBOOK_RUN_PERMISSIONS).toContain(Permission.RunbookMember);
    expect(RUNBOOK_ADVANCE_PERMISSIONS).toContain(Permission.RunbookMember);
    // In its order, so a tooltip lists the permissions as the model does.
    expect([...RUNBOOK_RUN_PERMISSIONS]).toEqual(
      table("RunbookExecution").lists.create,
    );
  });

  test("writes nothing about a runbook or a Runner: no table or column list of theirs names it", () => {
    const BUILT: Array<string> = [
      "Runbook",
      "RunbookRule",
      "RunbookOwnerTeam",
      "RunbookOwnerUser",
      "RunbookLabelRule",
      "RunbookOwnerRule",
      "RunbookSecret",
      "RunbookCredential",
      "Runner",
      "RunnerOwnerTeam",
      "RunnerOwnerUser",
    ];

    const writes: Array<string> = writesOf(Permission.RunbookMember).filter(
      (write: string): boolean => {
        return BUILT.includes(write.split(/[ .]/)[0]!);
      },
    );

    expect(writes).toEqual([]);
  });

  test("its only writes are starting a run, and moving one along", () => {
    expect(
      writesOf(Permission.RunbookMember).filter((write: string): boolean => {
        return !write.startsWith("RunbookExecution");
      }),
    ).toEqual(["run a runbook", "move a runbook run along"]);
  });

  test("Runbook Viewer and Viewer run nothing", () => {
    for (const role of [Permission.RunbookViewer, Permission.Viewer]) {
      expect(RUNBOOK_RUN_PERMISSIONS).not.toContain(role);
      expect(RUNBOOK_ADVANCE_PERMISSIONS).not.toContain(role);
    }
  });
});

/*
 * Workflow Member opens and runs workflows and changes none (#4495); a
 * workflow's owners are part of the workflow, so it adds and removes none.
 */
describe("Workflow Member", () => {
  test.each(["WorkflowOwnerTeam", "WorkflowOwnerUser"])(
    "is on no write list of %s",
    (name: string) => {
      expect(
        writesOf(Permission.WorkflowMember).filter((write: string): boolean => {
          return write.split(/[ .]/)[0] === name;
        }),
      ).toEqual([]);
    },
  );
});

/*
 * A team is created with its name, and only Project Owner, Project Admin and
 * Create Team may write a team's name. The table's create list named Project
 * Member, Settings Admin and Settings Member too, who could not create a
 * team, and saw a Create Team button that failed.
 */
describe("Team", () => {
  test("the create list is exactly who may name a team", () => {
    expect(table("Team").lists.create).toEqual(
      table("Team").columns["name"]?.create,
    );
  });
});
