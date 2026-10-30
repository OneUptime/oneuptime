import { RegisteredRuleCriteriaModelName } from "./RuleCriteriaFieldRegistry";

/*
 * WHAT A RULE'S CONDITIONS ARE ABOUT.
 *
 * A rule with no conditions applies to every record it sees - every new
 * incident, every host - and some people read an empty conditions list as a
 * form they forgot to fill in. So the conditions step asks it as a choice,
 * in the words of the records the rule is for: "All incidents" or "Only
 * incidents that match conditions" (RuleCriteriaBuilder). Nothing about
 * what is stored changes: no conditions is still "every one".
 *
 * This names, for each rule model, the kind of record its conditions are
 * checked against. Its words are in Common/UI (RuleCriteriaSubjectCopy).
 */
export enum RuleCriteriaSubject {
  Incidents = "Incidents",
  Alerts = "Alerts",
  IncidentEpisodes = "IncidentEpisodes",
  AlertEpisodes = "AlertEpisodes",
  ScheduledMaintenanceEvents = "ScheduledMaintenanceEvents",
  Monitors = "Monitors",
  StatusPages = "StatusPages",
  ServiceLevelObjectives = "ServiceLevelObjectives",
  NetworkDevices = "NetworkDevices",
  Hosts = "Hosts",
  KubernetesClusters = "KubernetesClusters",
  DockerHosts = "DockerHosts",
  DockerSwarmClusters = "DockerSwarmClusters",
  PodmanHosts = "PodmanHosts",
  ProxmoxClusters = "ProxmoxClusters",
  VMwareVCenters = "VMwareVCenters",
  CephClusters = "CephClusters",
  CloudResources = "CloudResources",
  ServerlessFunctions = "ServerlessFunctions",
  Databases = "Databases",
  MessageQueues = "MessageQueues",
  IoTFleets = "IoTFleets",
  RumApplications = "RumApplications",
  Services = "Services",
  Dashboards = "Dashboards",
  OnCallPolicies = "OnCallPolicies",
  OnCallSchedules = "OnCallSchedules",
  IncomingCallPolicies = "IncomingCallPolicies",
  Runbooks = "Runbooks",
  Workflows = "Workflows",
  StorageArrays = "StorageArrays",
  DataStores = "DataStores",
}

/*
 * One table holds the rules for several kinds of record, so its records
 * are named by the page that lists them, not by the model: an AI rule
 * (AutoRemediationRule) is about incidents or alerts, a runbook rule about
 * incidents, alerts or scheduled maintenance events - whichever the
 * table's triggerEntityType says (the page passes ruleCriteriaSubject to
 * its ModelTable).
 */
export const RULE_CRITERIA_MODELS_NAMED_BY_THEIR_TABLE: ReadonlyArray<RegisteredRuleCriteriaModelName> =
  ["AutoRemediationRule", "RunbookRule"];

/*
 * The kind of record each rule model's conditions are about. Null for the
 * models named by their table (above), and for the models that require a
 * condition (RULE_CRITERIA_MODELS_REQUIRING_A_CONDITION): those match
 * nothing without one, so there is no "all" to offer.
 */
export const RULE_CRITERIA_SUBJECT_BY_MODEL: Readonly<
  Record<RegisteredRuleCriteriaModelName, RuleCriteriaSubject | null>
> = {
  AIPostmortemRule: RuleCriteriaSubject.Incidents,
  AlertEpisodeLabelRule: RuleCriteriaSubject.AlertEpisodes,
  AlertEpisodeOnCallRule: RuleCriteriaSubject.AlertEpisodes,
  AlertEpisodeOwnerRule: RuleCriteriaSubject.AlertEpisodes,
  AlertEpisodePrivacyRule: RuleCriteriaSubject.AlertEpisodes,
  AlertGroupingRule: RuleCriteriaSubject.Alerts,
  AlertLabelRule: RuleCriteriaSubject.Alerts,
  AlertOnCallRule: RuleCriteriaSubject.Alerts,
  AlertOwnerRule: RuleCriteriaSubject.Alerts,
  AlertPrivacyRule: RuleCriteriaSubject.Alerts,
  AlertReminderRule: RuleCriteriaSubject.Alerts,
  AutoRemediationRule: null,
  CephClusterLabelRule: RuleCriteriaSubject.CephClusters,
  CephClusterOwnerRule: RuleCriteriaSubject.CephClusters,
  CloudResourceLabelRule: RuleCriteriaSubject.CloudResources,
  CloudResourceOwnerRule: RuleCriteriaSubject.CloudResources,
  DashboardLabelRule: RuleCriteriaSubject.Dashboards,
  DashboardOwnerRule: RuleCriteriaSubject.Dashboards,
  DataStoreLabelRule: RuleCriteriaSubject.DataStores,
  DataStoreOwnerRule: RuleCriteriaSubject.DataStores,
  DatabaseServerLabelRule: RuleCriteriaSubject.Databases,
  DatabaseServerOwnerRule: RuleCriteriaSubject.Databases,
  DockerHostLabelRule: RuleCriteriaSubject.DockerHosts,
  DockerHostOwnerRule: RuleCriteriaSubject.DockerHosts,
  DockerSwarmClusterLabelRule: RuleCriteriaSubject.DockerSwarmClusters,
  DockerSwarmClusterOwnerRule: RuleCriteriaSubject.DockerSwarmClusters,
  HostLabelRule: RuleCriteriaSubject.Hosts,
  HostOwnerRule: RuleCriteriaSubject.Hosts,
  IncidentEpisodeLabelRule: RuleCriteriaSubject.IncidentEpisodes,
  IncidentEpisodeOnCallRule: RuleCriteriaSubject.IncidentEpisodes,
  IncidentEpisodeOwnerRule: RuleCriteriaSubject.IncidentEpisodes,
  IncidentEpisodePrivacyRule: RuleCriteriaSubject.IncidentEpisodes,
  IncidentGroupingRule: RuleCriteriaSubject.Incidents,
  IncidentLabelRule: RuleCriteriaSubject.Incidents,
  IncidentOnCallRule: RuleCriteriaSubject.Incidents,
  IncidentOwnerRule: RuleCriteriaSubject.Incidents,
  IncidentPrivacyRule: RuleCriteriaSubject.Incidents,
  IncidentReminderRule: RuleCriteriaSubject.Incidents,
  IncidentSlaRule: RuleCriteriaSubject.Incidents,
  IncomingCallPolicyLabelRule: RuleCriteriaSubject.IncomingCallPolicies,
  IncomingCallPolicyOwnerRule: RuleCriteriaSubject.IncomingCallPolicies,
  IoTFleetLabelRule: RuleCriteriaSubject.IoTFleets,
  IoTFleetOwnerRule: RuleCriteriaSubject.IoTFleets,
  KubernetesClusterLabelRule: RuleCriteriaSubject.KubernetesClusters,
  KubernetesClusterOwnerRule: RuleCriteriaSubject.KubernetesClusters,
  MessageQueueLabelRule: RuleCriteriaSubject.MessageQueues,
  MessageQueueOwnerRule: RuleCriteriaSubject.MessageQueues,
  MonitorLabelRule: RuleCriteriaSubject.Monitors,
  MonitorOwnerRule: RuleCriteriaSubject.Monitors,
  NetworkDeviceAutoImportRule: null,
  NetworkDeviceLabelRule: RuleCriteriaSubject.NetworkDevices,
  NetworkDeviceOwnerRule: RuleCriteriaSubject.NetworkDevices,
  NetworkSiteAssignmentRule: null,
  OnCallDutyPolicyLabelRule: RuleCriteriaSubject.OnCallPolicies,
  OnCallDutyPolicyOwnerRule: RuleCriteriaSubject.OnCallPolicies,
  OnCallDutyPolicyScheduleLabelRule: RuleCriteriaSubject.OnCallSchedules,
  OnCallDutyPolicyScheduleOwnerRule: RuleCriteriaSubject.OnCallSchedules,
  PodmanHostLabelRule: RuleCriteriaSubject.PodmanHosts,
  PodmanHostOwnerRule: RuleCriteriaSubject.PodmanHosts,
  ProxmoxClusterLabelRule: RuleCriteriaSubject.ProxmoxClusters,
  ProxmoxClusterOwnerRule: RuleCriteriaSubject.ProxmoxClusters,
  RumApplicationLabelRule: RuleCriteriaSubject.RumApplications,
  RumApplicationOwnerRule: RuleCriteriaSubject.RumApplications,
  RunbookLabelRule: RuleCriteriaSubject.Runbooks,
  RunbookOwnerRule: RuleCriteriaSubject.Runbooks,
  RunbookRule: null,
  ScheduledMaintenanceLabelRule: RuleCriteriaSubject.ScheduledMaintenanceEvents,
  ScheduledMaintenanceOwnerRule: RuleCriteriaSubject.ScheduledMaintenanceEvents,
  ScheduledMaintenanceReminderRule:
    RuleCriteriaSubject.ScheduledMaintenanceEvents,
  ServerlessFunctionLabelRule: RuleCriteriaSubject.ServerlessFunctions,
  ServerlessFunctionOwnerRule: RuleCriteriaSubject.ServerlessFunctions,
  ServiceLabelRule: RuleCriteriaSubject.Services,
  ServiceLevelObjectiveLabelRule: RuleCriteriaSubject.ServiceLevelObjectives,
  ServiceLevelObjectiveMonitorRule: null,
  ServiceLevelObjectiveOwnerRule: RuleCriteriaSubject.ServiceLevelObjectives,
  ServiceOwnerRule: RuleCriteriaSubject.Services,
  StatusPageLabelRule: RuleCriteriaSubject.StatusPages,
  StatusPageMonitorRule: null,
  StatusPageOwnerRule: RuleCriteriaSubject.StatusPages,
  StorageArrayLabelRule: RuleCriteriaSubject.StorageArrays,
  StorageArrayOwnerRule: RuleCriteriaSubject.StorageArrays,
  VMwareVCenterLabelRule: RuleCriteriaSubject.VMwareVCenters,
  VMwareVCenterOwnerRule: RuleCriteriaSubject.VMwareVCenters,
  WorkflowLabelRule: RuleCriteriaSubject.Workflows,
  WorkflowOwnerRule: RuleCriteriaSubject.Workflows,
};

const SUBJECT_LOOKUP: Readonly<Record<string, RuleCriteriaSubject | null>> =
  RULE_CRITERIA_SUBJECT_BY_MODEL;

/*
 * The kind of record a rule model's conditions are about, or null when the
 * model leaves it to its table or has no "all" to offer. Own properties
 * only, so "constructor" or "toString" is no model's subject.
 */
export function getRuleCriteriaSubjectForModel(
  modelName: string | null | undefined,
): RuleCriteriaSubject | null {
  if (
    !modelName ||
    !Object.prototype.hasOwnProperty.call(SUBJECT_LOOKUP, modelName)
  ) {
    return null;
  }

  return SUBJECT_LOOKUP[modelName] || null;
}

/*
 * What a rule's conditions are about on a page: what the page says (a
 * table that holds the rules of several kinds of record), else what the
 * model says.
 */
export function resolveRuleCriteriaSubject(data: {
  modelName: string | null | undefined;
  subject?: RuleCriteriaSubject | null | undefined;
}): RuleCriteriaSubject | null {
  return data.subject || getRuleCriteriaSubjectForModel(data.modelName);
}

export default RuleCriteriaSubject;
