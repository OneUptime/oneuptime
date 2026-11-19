/*
 * "USED BY": WHAT REFERS TO A RECORD (#6813).
 *
 * OneUptime's records point at each other - a status page lists monitors,
 * an escalation rule names a schedule, an SLO measures a monitor - and
 * each record shows what it points to. This is the other direction: given
 * a record, the records that point at it, so "which status pages show
 * this monitor?", "does any policy use this schedule?" and "can I delete
 * this?" are answered on the record's own page instead of by opening
 * every status page, policy and SLO in turn.
 *
 * One step only: a monitor shows the status pages that list it, not the
 * subscribers of those pages. Two exceptions, each because it is what a
 * person means by the question: a status page that shows the monitor
 * through one of its monitor groups shows the monitor, and a service's
 * SLOs are the SLOs that measure the monitors watching it (no SLO names a
 * service).
 *
 * The server (Server/Services/UsedByService) keeps, in one place, how each
 * relation is read, and reads every one through the models' own services
 * with the reader's permissions: a reader is shown only the records they
 * may read, and told how many more there are that they may not, without
 * their names. Counts come first, a few rows with them, and the rest of a
 * relation's rows on request, a page at a time - so a record used by
 * thousands of others still loads in a handful of bounded reads.
 *
 * A FAMILY is several kinds of record counted as one line, so a card stays
 * short: the rules that name a monitor are on-call, owner, label, grouping
 * and a dozen other kinds of rule, each its own table. A family's count is
 * every kind's summed, its rows each say their own kind (UsedByRow.rowKind),
 * and its parts say how many of each kind refer (UsedByGroup.parts). Its
 * first rows and its pages are still bounded: the kinds are read in turn,
 * skipped over by their counts, never every row of every kind.
 *
 * Several records at once - the selection of a list's bulk Delete or
 * Archive - are counted together (UsedByBulkSummary): each relation once
 * for all of them, counts only, no rows.
 *
 * Pure, with no server or browser APIs: the Dashboard and the server read
 * the same kinds, relations and shapes.
 */

import { LIMIT_PER_PROJECT } from "../Database/LimitMax";

// The records that answer "what uses this?" on their own page.
export enum UsedByRecordKind {
  Monitor = "monitor",
  OnCallSchedule = "on-call-schedule",
  Service = "service",
  StatusPage = "status-page",
  Team = "team",
  Label = "label",
  OnCallPolicy = "on-call-policy",
  MonitorGroup = "monitor-group",
  Slo = "slo",
}

// What one row of a relation is: what the Dashboard opens when it is clicked.
export enum UsedByRowKind {
  Monitor = "Monitor",
  MonitorGroup = "MonitorGroup",
  StatusPage = "StatusPage",
  ServiceLevelObjective = "ServiceLevelObjective",
  ScheduledMaintenance = "ScheduledMaintenance",
  Workflow = "Workflow",
  Dashboard = "Dashboard",
  OnCallDutyPolicy = "OnCallDutyPolicy",
  OnCallSchedule = "OnCallSchedule",
  Service = "Service",
  Incident = "Incident",
  Alert = "Alert",

  // Rules that name a monitor, or page an on-call policy.
  IncidentOnCallRule = "IncidentOnCallRule",
  AlertOnCallRule = "AlertOnCallRule",
  IncidentEpisodeOnCallRule = "IncidentEpisodeOnCallRule",
  AlertEpisodeOnCallRule = "AlertEpisodeOnCallRule",
  IncidentOwnerRule = "IncidentOwnerRule",
  AlertOwnerRule = "AlertOwnerRule",
  IncidentLabelRule = "IncidentLabelRule",
  AlertLabelRule = "AlertLabelRule",
  IncidentGroupingRule = "IncidentGroupingRule",
  AlertGroupingRule = "AlertGroupingRule",
  IncidentPrivacyRule = "IncidentPrivacyRule",
  AlertPrivacyRule = "AlertPrivacyRule",
  IncidentSlaRule = "IncidentSlaRule",
  AlertIncidentRule = "AlertIncidentRule",
  // An AI rule (AutoRemediationRule), by what it is triggered by.
  IncidentAiRule = "IncidentAiRule",
  AlertAiRule = "AlertAiRule",
  // A runbook rule, by what it is triggered by.
  IncidentRunbookRule = "IncidentRunbookRule",
  AlertRunbookRule = "AlertRunbookRule",
  MaintenanceRunbookRule = "MaintenanceRunbookRule",
  PostmortemRule = "PostmortemRule",
  MaintenanceLabelRule = "MaintenanceLabelRule",
  MaintenanceOwnerRule = "MaintenanceOwnerRule",
  SloBurnRateRule = "SloBurnRateRule",
  SloErrorBudgetPolicyTier = "SloErrorBudgetPolicyTier",
  CloudBudget = "CloudBudget",

  // Templates that name a monitor, or page an on-call policy.
  IncidentTemplate = "IncidentTemplate",
  MaintenanceTemplate = "MaintenanceTemplate",
  AnnouncementTemplate = "AnnouncementTemplate",

  // The rest of what a team can own.
  IncidentEpisode = "IncidentEpisode",
  AlertEpisode = "AlertEpisode",
  Runbook = "Runbook",
  IncomingCallPolicy = "IncomingCallPolicy",
  Team = "Team",
  Host = "Host",
  KubernetesCluster = "KubernetesCluster",
  DockerHost = "DockerHost",
  DockerSwarmCluster = "DockerSwarmCluster",
  PodmanHost = "PodmanHost",
  ProxmoxCluster = "ProxmoxCluster",
  OpenStackCloud = "OpenStackCloud",
  VMwareVCenter = "VMwareVCenter",
  CephCluster = "CephCluster",
  StorageArray = "StorageArray",
  NetworkDevice = "NetworkDevice",
  IoTFleet = "IoTFleet",
  CloudResource = "CloudResource",
  ServerlessFunction = "ServerlessFunction",
  DatabaseServer = "DatabaseServer",
  MessageQueue = "MessageQueue",
  RumApplication = "RumApplication",
  DataStore = "DataStore",
  DataAsset = "DataAsset",
  DataPipeline = "DataPipeline",
  Probe = "Probe",
  Runner = "Runner",
  AIAgent = "AIAgent",
}

// One way records refer to a record of a kind.
export enum UsedByRelation {
  // Status pages that list the monitor, directly or through a monitor group.
  MonitorStatusPages = "MonitorStatusPages",
  // Monitor groups the monitor is in.
  MonitorGroups = "MonitorGroups",
  // SLOs that measure the monitor (archived ones left out).
  MonitorSlos = "MonitorSlos",
  // Scheduled maintenance coming up or in progress that names the monitor.
  MonitorScheduledMaintenance = "MonitorScheduledMaintenance",
  // Monitors that depend on it: their alerts wait while it is down.
  MonitorDependents = "MonitorDependents",
  // Workflows whose steps name the monitor.
  MonitorWorkflows = "MonitorWorkflows",
  // Dashboards whose widgets name the monitor.
  MonitorDashboards = "MonitorDashboards",
  /*
   * A family: the rules limited to the monitor - on-call, owner, label,
   * grouping, privacy, SLA, AI, runbook and the rest - each of which changes
   * what happens when it goes down.
   */
  MonitorRules = "MonitorRules",
  // A family: the incident, maintenance and announcement templates naming it.
  MonitorTemplates = "MonitorTemplates",

  // On-call policies with an escalation rule that pages the schedule.
  ScheduleOnCallPolicies = "ScheduleOnCallPolicies",

  // Monitors that watch the service (its Linked Resources).
  ServiceMonitors = "ServiceMonitors",
  // SLOs that measure a monitor watching the service.
  ServiceSlos = "ServiceSlos",

  // Open incidents the status page shows right now.
  StatusPageOpenIncidents = "StatusPageOpenIncidents",
  // Scheduled maintenance in progress or coming up that the page shows.
  StatusPageMaintenance = "StatusPageMaintenance",

  // On-call policies with an escalation rule that pages the team.
  TeamOnCallPolicies = "TeamOnCallPolicies",
  // What the team owns.
  TeamOwnedMonitors = "TeamOwnedMonitors",
  TeamOwnedStatusPages = "TeamOwnedStatusPages",
  TeamOwnedServices = "TeamOwnedServices",
  TeamOwnedOnCallPolicies = "TeamOwnedOnCallPolicies",
  TeamOwnedSchedules = "TeamOwnedSchedules",
  /*
   * A family: everything else the team owns, through every other owner
   * table - SLOs, dashboards, workflows, runbooks, infrastructure, events.
   */
  TeamOwnedOther = "TeamOwnedOther",

  // A family: the on-call rules of incidents, alerts and their episodes that page the policy.
  OnCallPolicyRules = "OnCallPolicyRules",
  // Monitors whose criteria page the policy when they open an incident or alert.
  OnCallPolicyMonitors = "OnCallPolicyMonitors",
  // A family: the templates, grouping rules, SLO rules and budgets that page it.
  OnCallPolicyOther = "OnCallPolicyOther",
  // Workflows whose steps page the policy.
  OnCallPolicyWorkflows = "OnCallPolicyWorkflows",

  // Status pages that show the monitor group.
  MonitorGroupStatusPages = "MonitorGroupStatusPages",
  // SLOs that measure a monitor of the group.
  MonitorGroupSlos = "MonitorGroupSlos",

  // Dashboards whose widgets name the SLO.
  SloDashboards = "SloDashboards",
  // Burn-rate rules on the SLO: they alert or page when its budget burns fast.
  SloBurnRateRules = "SloBurnRateRules",
  // The tiers of its error budget policy: what happens as its budget runs out.
  SloErrorBudgetPolicies = "SloErrorBudgetPolicies",

  // The records of each kind that carry the label.
  LabelMonitors = "LabelMonitors",
  LabelMonitorGroups = "LabelMonitorGroups",
  LabelStatusPages = "LabelStatusPages",
  LabelServices = "LabelServices",
  LabelIncidents = "LabelIncidents",
  LabelAlerts = "LabelAlerts",
  LabelScheduledMaintenance = "LabelScheduledMaintenance",
  LabelOnCallPolicies = "LabelOnCallPolicies",
  LabelOnCallSchedules = "LabelOnCallSchedules",
  LabelSlos = "LabelSlos",
  LabelWorkflows = "LabelWorkflows",
  LabelDashboards = "LabelDashboards",
}

export interface UsedByRelationDescription {
  relation: UsedByRelation;
  /*
   * What its rows are. A family's rows are of several kinds, each named by
   * its row (UsedByRow.rowKind); this is the first of them.
   */
  rowKind: UsedByRowKind;
  /*
   * A family: every kind of record its rows can be, in the order they are
   * read - which kinds are counted together on one line.
   */
  family?: ReadonlyArray<UsedByRowKind> | undefined;
  /*
   * Read only for one record at a time, so left out where several are
   * counted together (UsedByBulkSummary): the open incidents a status page
   * shows are decided page by page (IncidentStatusPageScope).
   */
  isOneRecordOnly?: boolean | undefined;
}

/*
 * The kinds of rule that can be limited to particular monitors (each its
 * `monitors` list), on-call rules first: they page people.
 */
export const MONITOR_RULE_ROW_KINDS: ReadonlyArray<UsedByRowKind> = [
  UsedByRowKind.IncidentOnCallRule,
  UsedByRowKind.AlertOnCallRule,
  UsedByRowKind.IncidentGroupingRule,
  UsedByRowKind.AlertGroupingRule,
  UsedByRowKind.IncidentOwnerRule,
  UsedByRowKind.AlertOwnerRule,
  UsedByRowKind.IncidentLabelRule,
  UsedByRowKind.AlertLabelRule,
  UsedByRowKind.IncidentPrivacyRule,
  UsedByRowKind.AlertPrivacyRule,
  UsedByRowKind.IncidentSlaRule,
  UsedByRowKind.AlertIncidentRule,
  UsedByRowKind.IncidentAiRule,
  UsedByRowKind.AlertAiRule,
  UsedByRowKind.IncidentRunbookRule,
  UsedByRowKind.AlertRunbookRule,
  UsedByRowKind.MaintenanceRunbookRule,
  UsedByRowKind.PostmortemRule,
  UsedByRowKind.MaintenanceOwnerRule,
  UsedByRowKind.MaintenanceLabelRule,
];

// The templates that can name monitors: what an incident, an event or an announcement made from them affects.
export const MONITOR_TEMPLATE_ROW_KINDS: ReadonlyArray<UsedByRowKind> = [
  UsedByRowKind.IncidentTemplate,
  UsedByRowKind.MaintenanceTemplate,
  UsedByRowKind.AnnouncementTemplate,
];

/*
 * Everything else a team can own, past the five its card lists on lines of
 * their own: what people act on first (SLOs, dashboards, workflows,
 * runbooks, templates), then the infrastructure it runs, then the events
 * it owns - many of them, so they come last.
 */
export const TEAM_OWNED_OTHER_ROW_KINDS: ReadonlyArray<UsedByRowKind> = [
  UsedByRowKind.ServiceLevelObjective,
  UsedByRowKind.Dashboard,
  UsedByRowKind.Workflow,
  UsedByRowKind.MonitorGroup,
  UsedByRowKind.Runbook,
  UsedByRowKind.IncidentTemplate,
  UsedByRowKind.MaintenanceTemplate,
  UsedByRowKind.IncomingCallPolicy,
  UsedByRowKind.Team,
  UsedByRowKind.Host,
  UsedByRowKind.KubernetesCluster,
  UsedByRowKind.DockerHost,
  UsedByRowKind.DockerSwarmCluster,
  UsedByRowKind.PodmanHost,
  UsedByRowKind.ProxmoxCluster,
  UsedByRowKind.OpenStackCloud,
  UsedByRowKind.VMwareVCenter,
  UsedByRowKind.CephCluster,
  UsedByRowKind.StorageArray,
  UsedByRowKind.NetworkDevice,
  UsedByRowKind.IoTFleet,
  UsedByRowKind.CloudResource,
  UsedByRowKind.ServerlessFunction,
  UsedByRowKind.DatabaseServer,
  UsedByRowKind.MessageQueue,
  UsedByRowKind.RumApplication,
  UsedByRowKind.DataStore,
  UsedByRowKind.DataAsset,
  UsedByRowKind.DataPipeline,
  UsedByRowKind.Probe,
  UsedByRowKind.Runner,
  UsedByRowKind.AIAgent,
  UsedByRowKind.Incident,
  UsedByRowKind.IncidentEpisode,
  UsedByRowKind.Alert,
  UsedByRowKind.AlertEpisode,
  UsedByRowKind.ScheduledMaintenance,
];

// The on-call rules that page an on-call policy when their event is created.
export const ON_CALL_POLICY_RULE_ROW_KINDS: ReadonlyArray<UsedByRowKind> = [
  UsedByRowKind.IncidentOnCallRule,
  UsedByRowKind.AlertOnCallRule,
  UsedByRowKind.IncidentEpisodeOnCallRule,
  UsedByRowKind.AlertEpisodeOnCallRule,
];

/*
 * Everything else that pages an on-call policy: an incident declared from
 * a template, an episode a grouping rule opens, an SLO burning its budget,
 * a budget running over.
 */
export const ON_CALL_POLICY_OTHER_ROW_KINDS: ReadonlyArray<UsedByRowKind> = [
  UsedByRowKind.IncidentTemplate,
  UsedByRowKind.IncidentGroupingRule,
  UsedByRowKind.AlertGroupingRule,
  UsedByRowKind.SloBurnRateRule,
  UsedByRowKind.SloErrorBudgetPolicyTier,
  UsedByRowKind.CloudBudget,
];

/*
 * Each record's relations, in the order its card lists them: what most
 * people ask about first. Adding a relation is a line here, its reading in
 * UsedByService's definitions, and its words in the Dashboard's
 * UsedByWords - each of the three tested to hold every relation.
 */
export const USED_BY_RELATIONS: Readonly<
  Record<UsedByRecordKind, ReadonlyArray<UsedByRelationDescription>>
> = {
  [UsedByRecordKind.Monitor]: [
    {
      relation: UsedByRelation.MonitorStatusPages,
      rowKind: UsedByRowKind.StatusPage,
    },
    {
      relation: UsedByRelation.MonitorGroups,
      rowKind: UsedByRowKind.MonitorGroup,
    },
    {
      relation: UsedByRelation.MonitorSlos,
      rowKind: UsedByRowKind.ServiceLevelObjective,
    },
    {
      relation: UsedByRelation.MonitorScheduledMaintenance,
      rowKind: UsedByRowKind.ScheduledMaintenance,
    },
    {
      relation: UsedByRelation.MonitorDependents,
      rowKind: UsedByRowKind.Monitor,
    },
    {
      relation: UsedByRelation.MonitorRules,
      rowKind: MONITOR_RULE_ROW_KINDS[0] as UsedByRowKind,
      family: MONITOR_RULE_ROW_KINDS,
    },
    {
      relation: UsedByRelation.MonitorTemplates,
      rowKind: MONITOR_TEMPLATE_ROW_KINDS[0] as UsedByRowKind,
      family: MONITOR_TEMPLATE_ROW_KINDS,
    },
    {
      relation: UsedByRelation.MonitorWorkflows,
      rowKind: UsedByRowKind.Workflow,
    },
    {
      relation: UsedByRelation.MonitorDashboards,
      rowKind: UsedByRowKind.Dashboard,
    },
  ],
  [UsedByRecordKind.OnCallSchedule]: [
    {
      relation: UsedByRelation.ScheduleOnCallPolicies,
      rowKind: UsedByRowKind.OnCallDutyPolicy,
    },
  ],
  [UsedByRecordKind.Service]: [
    {
      relation: UsedByRelation.ServiceMonitors,
      rowKind: UsedByRowKind.Monitor,
    },
    {
      relation: UsedByRelation.ServiceSlos,
      rowKind: UsedByRowKind.ServiceLevelObjective,
    },
  ],
  [UsedByRecordKind.StatusPage]: [
    {
      relation: UsedByRelation.StatusPageOpenIncidents,
      rowKind: UsedByRowKind.Incident,
      isOneRecordOnly: true,
    },
    {
      relation: UsedByRelation.StatusPageMaintenance,
      rowKind: UsedByRowKind.ScheduledMaintenance,
    },
  ],
  [UsedByRecordKind.Team]: [
    {
      relation: UsedByRelation.TeamOnCallPolicies,
      rowKind: UsedByRowKind.OnCallDutyPolicy,
    },
    {
      relation: UsedByRelation.TeamOwnedMonitors,
      rowKind: UsedByRowKind.Monitor,
    },
    {
      relation: UsedByRelation.TeamOwnedStatusPages,
      rowKind: UsedByRowKind.StatusPage,
    },
    {
      relation: UsedByRelation.TeamOwnedServices,
      rowKind: UsedByRowKind.Service,
    },
    {
      relation: UsedByRelation.TeamOwnedOnCallPolicies,
      rowKind: UsedByRowKind.OnCallDutyPolicy,
    },
    {
      relation: UsedByRelation.TeamOwnedSchedules,
      rowKind: UsedByRowKind.OnCallSchedule,
    },
    {
      relation: UsedByRelation.TeamOwnedOther,
      rowKind: TEAM_OWNED_OTHER_ROW_KINDS[0] as UsedByRowKind,
      family: TEAM_OWNED_OTHER_ROW_KINDS,
    },
  ],
  [UsedByRecordKind.Label]: [
    {
      relation: UsedByRelation.LabelMonitors,
      rowKind: UsedByRowKind.Monitor,
    },
    {
      relation: UsedByRelation.LabelMonitorGroups,
      rowKind: UsedByRowKind.MonitorGroup,
    },
    {
      relation: UsedByRelation.LabelStatusPages,
      rowKind: UsedByRowKind.StatusPage,
    },
    {
      relation: UsedByRelation.LabelServices,
      rowKind: UsedByRowKind.Service,
    },
    {
      relation: UsedByRelation.LabelIncidents,
      rowKind: UsedByRowKind.Incident,
    },
    {
      relation: UsedByRelation.LabelAlerts,
      rowKind: UsedByRowKind.Alert,
    },
    {
      relation: UsedByRelation.LabelScheduledMaintenance,
      rowKind: UsedByRowKind.ScheduledMaintenance,
    },
    {
      relation: UsedByRelation.LabelOnCallPolicies,
      rowKind: UsedByRowKind.OnCallDutyPolicy,
    },
    {
      relation: UsedByRelation.LabelOnCallSchedules,
      rowKind: UsedByRowKind.OnCallSchedule,
    },
    {
      relation: UsedByRelation.LabelSlos,
      rowKind: UsedByRowKind.ServiceLevelObjective,
    },
    {
      relation: UsedByRelation.LabelWorkflows,
      rowKind: UsedByRowKind.Workflow,
    },
    {
      relation: UsedByRelation.LabelDashboards,
      rowKind: UsedByRowKind.Dashboard,
    },
  ],
  /*
   * What runs the policy: it pages nobody until one of these does (#7758,
   * #6080). On-call rules first - most policies are run by one.
   */
  [UsedByRecordKind.OnCallPolicy]: [
    {
      relation: UsedByRelation.OnCallPolicyRules,
      rowKind: ON_CALL_POLICY_RULE_ROW_KINDS[0] as UsedByRowKind,
      family: ON_CALL_POLICY_RULE_ROW_KINDS,
    },
    {
      relation: UsedByRelation.OnCallPolicyMonitors,
      rowKind: UsedByRowKind.Monitor,
    },
    {
      relation: UsedByRelation.OnCallPolicyOther,
      rowKind: ON_CALL_POLICY_OTHER_ROW_KINDS[0] as UsedByRowKind,
      family: ON_CALL_POLICY_OTHER_ROW_KINDS,
    },
    {
      relation: UsedByRelation.OnCallPolicyWorkflows,
      rowKind: UsedByRowKind.Workflow,
    },
  ],
  [UsedByRecordKind.MonitorGroup]: [
    {
      relation: UsedByRelation.MonitorGroupStatusPages,
      rowKind: UsedByRowKind.StatusPage,
    },
    {
      relation: UsedByRelation.MonitorGroupSlos,
      rowKind: UsedByRowKind.ServiceLevelObjective,
    },
  ],
  [UsedByRecordKind.Slo]: [
    {
      relation: UsedByRelation.SloBurnRateRules,
      rowKind: UsedByRowKind.SloBurnRateRule,
    },
    {
      relation: UsedByRelation.SloErrorBudgetPolicies,
      rowKind: UsedByRowKind.SloErrorBudgetPolicyTier,
    },
    {
      relation: UsedByRelation.SloDashboards,
      rowKind: UsedByRowKind.Dashboard,
    },
  ],
};

// The rows a card shows of each relation, beside its count.
export const USED_BY_PREVIEW_ROW_COUNT: number = 3;

// The rows one page of "See all" reads.
export const USED_BY_PAGE_SIZE: number = 50;

// The most rows one page may ask for.
export const USED_BY_MAX_PAGE_SIZE: number = 100;

/*
 * The most records one bulk summary counts together: a list's whole
 * selection (BulkSelectAll reads at most LIMIT_PER_PROJECT rows).
 */
export const USED_BY_BULK_MAX_RECORDS: number = LIMIT_PER_PROJECT;

// One record that refers to the record asked about.
export interface UsedByRow {
  id: string;
  // Its name, as its own page shows it ("" when it has none).
  name: string;
  // Its number with its prefix, for a numbered record ("INC-18").
  number?: string | undefined;
  /*
   * More about how it refers, in the project's own words: the escalation
   * rules of a policy that page the schedule or team.
   */
  detail?: string | undefined;
  /*
   * A family's row: the kind of record it is ("Incident On-Call Rule"),
   * which is also the page it opens. A row without one is its group's kind.
   */
  rowKind?: UsedByRowKind | undefined;
  /*
   * The record whose page opens it, when that is not the row itself: an
   * SLO's burn-rate rule opens its SLO's Burn-Rate Rules page.
   */
  linkId?: string | undefined;
  /*
   * A rule switched off, or a monitor that is not checked: it names the
   * record, but changes nothing until it is switched on again.
   */
  isOff?: boolean | undefined;
}

// How many records of one kind of a family refer.
export interface UsedByGroupPart {
  rowKind: UsedByRowKind;
  count: number;
  hiddenCount: number;
}

// The records that refer to the record one way.
export interface UsedByGroup {
  relation: UsedByRelation;
  rowKind: UsedByRowKind;
  // How many of them the reader may read.
  count: number;
  /*
   * How many more there are that the reader may not read: counted, never
   * named. 0 when the reader may read them all.
   */
  hiddenCount: number;
  // The first of those the reader may read, in name order.
  rows: Array<UsedByRow>;
  /*
   * A family's kinds that refer, each with its counts, in the family's
   * order: only the kinds with any.
   */
  parts?: Array<UsedByGroupPart> | undefined;
}

// What refers to one record, every relation of its kind.
export interface UsedBySummary {
  recordKind: UsedByRecordKind;
  recordId: string;
  groups: Array<UsedByGroup>;
}

// The records that refer to any of several records one way: counts only.
export type UsedByCounts = Omit<UsedByGroup, "rows">;

/*
 * What refers to any of several records of one kind - a list's selection,
 * before a bulk Delete or Archive: each relation counted once for all of
 * them (a record that refers to two of them is one record), with no rows.
 * Relations read only for one record at a time are left out.
 */
export interface UsedByBulkSummary {
  recordKind: UsedByRecordKind;
  // How many of the records asked about were counted: those the reader may read.
  recordCount: number;
  groups: Array<UsedByCounts>;
}

/*
 * One page of one relation's rows: where it starts and how long it is are
 * pageStart and pageSize. (They were named so while HTTPResponse took any
 * answer holding count, skip and limit for a list of models in `data`; it
 * reads only a real list envelope that way now - issue #7794 - and keeps
 * every other answer whole.)
 */
export interface UsedByPage {
  recordKind: UsedByRecordKind;
  recordId: string;
  relation: UsedByRelation;
  rowKind: UsedByRowKind;
  count: number;
  hiddenCount: number;
  pageStart: number;
  pageSize: number;
  rows: Array<UsedByRow>;
}

export function isUsedByRecordKind(value: unknown): value is UsedByRecordKind {
  return Object.values(UsedByRecordKind).includes(value as UsedByRecordKind);
}

export function isUsedByRelation(value: unknown): value is UsedByRelation {
  return Object.values(UsedByRelation).includes(value as UsedByRelation);
}

// The relations of a kind, in its card's order.
export function getUsedByRelations(
  recordKind: UsedByRecordKind,
): ReadonlyArray<UsedByRelationDescription> {
  return USED_BY_RELATIONS[recordKind] || [];
}

// The relations of a kind counted for several records at once.
export function getUsedByBulkRelations(
  recordKind: UsedByRecordKind,
): ReadonlyArray<UsedByRelationDescription> {
  return getUsedByRelations(recordKind).filter(
    (description: UsedByRelationDescription): boolean => {
      return !description.isOneRecordOnly;
    },
  );
}

// A relation's description, or null for one no kind lists.
export function getUsedByRelationDescription(
  relation: UsedByRelation,
): UsedByRelationDescription | null {
  for (const recordKind of Object.values(UsedByRecordKind)) {
    for (const description of getUsedByRelations(recordKind)) {
      if (description.relation === relation) {
        return description;
      }
    }
  }

  return null;
}

// Whether a relation counts several kinds of record on one line.
export function isUsedByFamily(relation: UsedByRelation): boolean {
  return Boolean(getUsedByRelationDescription(relation)?.family);
}

// The kind of a row: its own (a family's row), or its group's.
export function getUsedByRowKindOfRow(
  row: Pick<UsedByRow, "rowKind">,
  groupRowKind: UsedByRowKind,
): UsedByRowKind {
  return row.rowKind || groupRowKind;
}

// The kind a relation belongs to, or null for one no kind lists.
export function getUsedByRecordKindOfRelation(
  relation: UsedByRelation,
): UsedByRecordKind | null {
  for (const recordKind of Object.values(UsedByRecordKind)) {
    if (
      getUsedByRelations(recordKind).some(
        (description: UsedByRelationDescription): boolean => {
          return description.relation === relation;
        },
      )
    ) {
      return recordKind;
    }
  }

  return null;
}

// What a relation's rows are, or null for one no kind lists.
export function getUsedByRowKind(
  relation: UsedByRelation,
): UsedByRowKind | null {
  for (const recordKind of Object.values(UsedByRecordKind)) {
    for (const description of getUsedByRelations(recordKind)) {
      if (description.relation === relation) {
        return description.rowKind;
      }
    }
  }

  return null;
}

// Every record that refers to it, seen or not.
export function getUsedByGroupTotal(
  group: Pick<UsedByGroup, "count" | "hiddenCount">,
): number {
  return group.count + group.hiddenCount;
}

/*
 * The groups with anything in them - seen or hidden - in the kind's order:
 * what a card and a delete dialog list. `leaveOut` drops relations a page
 * says otherwise (a monitor's Delete page has the SLOs' own warning).
 */
export function getUsedByGroupsInUse<
  TGroup extends Pick<UsedByCounts, "relation" | "count" | "hiddenCount">,
>(
  summary: { groups: Array<TGroup> },
  leaveOut?: ReadonlyArray<UsedByRelation> | undefined,
): Array<TGroup> {
  return summary.groups.filter((group: TGroup): boolean => {
    return (
      getUsedByGroupTotal(group) > 0 &&
      !(leaveOut || []).includes(group.relation)
    );
  });
}

// Whether nothing refers to the record, among what the summary read.
export function isUsedByNothing(summary: {
  groups: Array<Pick<UsedByCounts, "relation" | "count" | "hiddenCount">>;
}): boolean {
  return getUsedByGroupsInUse(summary).length === 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isUsedByRowKind(value: unknown): value is UsedByRowKind {
  return Object.values(UsedByRowKind).includes(value as UsedByRowKind);
}

function isUsedByRow(value: unknown): value is UsedByRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const row: Partial<UsedByRow> = value as Partial<UsedByRow>;

  return (
    typeof row.id === "string" &&
    typeof row.name === "string" &&
    (row.number === undefined || typeof row.number === "string") &&
    (row.detail === undefined || typeof row.detail === "string") &&
    (row.rowKind === undefined || isUsedByRowKind(row.rowKind)) &&
    (row.linkId === undefined || typeof row.linkId === "string") &&
    (row.isOff === undefined || typeof row.isOff === "boolean")
  );
}

function isUsedByRows(value: unknown): value is Array<UsedByRow> {
  return Array.isArray(value) && value.every(isUsedByRow);
}

function isUsedByGroupPart(value: unknown): value is UsedByGroupPart {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const part: Partial<UsedByGroupPart> = value as Partial<UsedByGroupPart>;

  return (
    isUsedByRowKind(part.rowKind) &&
    isNonNegativeInteger(part.count) &&
    isNonNegativeInteger(part.hiddenCount)
  );
}

function isUsedByCounts(value: unknown): value is UsedByCounts {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const group: Partial<UsedByCounts> = value as Partial<UsedByCounts>;

  return (
    isUsedByRelation(group.relation) &&
    isUsedByRowKind(group.rowKind) &&
    isNonNegativeInteger(group.count) &&
    isNonNegativeInteger(group.hiddenCount) &&
    (group.parts === undefined ||
      (Array.isArray(group.parts) && group.parts.every(isUsedByGroupPart)))
  );
}

function isUsedByGroup(value: unknown): value is UsedByGroup {
  return (
    isUsedByCounts(value) && isUsedByRows((value as Partial<UsedByGroup>).rows)
  );
}

/*
 * Whether an answer has the shape the Dashboard reads: a server that
 * answers something else (an older one, a proxy's page) is an error to
 * show, never a list to draw.
 */
export function isUsedBySummary(value: unknown): value is UsedBySummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const summary: Partial<UsedBySummary> = value as Partial<UsedBySummary>;

  return (
    isUsedByRecordKind(summary.recordKind) &&
    typeof summary.recordId === "string" &&
    Array.isArray(summary.groups) &&
    summary.groups.every(isUsedByGroup)
  );
}

export function isUsedByBulkSummary(
  value: unknown,
): value is UsedByBulkSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const summary: Partial<UsedByBulkSummary> =
    value as Partial<UsedByBulkSummary>;

  return (
    isUsedByRecordKind(summary.recordKind) &&
    isNonNegativeInteger(summary.recordCount) &&
    Array.isArray(summary.groups) &&
    summary.groups.every(isUsedByCounts)
  );
}

export function isUsedByPage(value: unknown): value is UsedByPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const page: Partial<UsedByPage> = value as Partial<UsedByPage>;

  return (
    isUsedByRecordKind(page.recordKind) &&
    typeof page.recordId === "string" &&
    isUsedByRelation(page.relation) &&
    isUsedByRowKind(page.rowKind) &&
    isNonNegativeInteger(page.count) &&
    isNonNegativeInteger(page.hiddenCount) &&
    isNonNegativeInteger(page.pageStart) &&
    isNonNegativeInteger(page.pageSize) &&
    isUsedByRows(page.rows)
  );
}

// A page size a request may ask for: the default, or at most the maximum.
export function normalizeUsedByPageSize(value: unknown): number {
  const parsed: number = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return USED_BY_PAGE_SIZE;
  }

  return Math.min(Math.floor(parsed), USED_BY_MAX_PAGE_SIZE);
}

// Where a page starts: 0, or a whole number of rows past it.
export function normalizeUsedBySkip(value: unknown): number {
  const parsed: number = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}
