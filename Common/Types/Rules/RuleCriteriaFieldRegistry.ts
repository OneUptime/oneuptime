/**
 * The complete API allowlist for configurable rule criteria.
 *
 * Keep this registry in lockstep with the dashboard forms and runtime
 * evaluators. The source-contract suite checks both sides so a newly exposed
 * action field can never become a match predicate by accident.
 */
export const RULE_CRITERIA_FIELDS_BY_MODEL: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  AlertEpisodeLabelRule: [
    "alertSeverities",
    "episodeLabels",
    "episodeTitlePattern",
    "episodeDescriptionPattern",
  ],
  AlertEpisodeOnCallRule: [
    "alertSeverities",
    "episodeLabels",
    "episodeTitlePattern",
    "episodeDescriptionPattern",
  ],
  AlertEpisodeOwnerRule: [
    "alertSeverities",
    "episodeLabels",
    "episodeTitlePattern",
    "episodeDescriptionPattern",
  ],
  AlertEpisodePrivacyRule: [
    "alertSeverities",
    "episodeLabels",
    "episodeTitlePattern",
    "episodeDescriptionPattern",
  ],
  AlertGroupingRule: [
    "monitors",
    "alertSeverities",
    "alertLabels",
    "monitorLabels",
    "alertTitlePattern",
    "alertDescriptionPattern",
    "monitorNamePattern",
    "monitorDescriptionPattern",
  ],
  AlertLabelRule: [
    "monitors",
    "alertSeverities",
    "alertLabels",
    "monitorLabels",
    "alertTitlePattern",
    "alertDescriptionPattern",
    "monitorNamePattern",
    "monitorDescriptionPattern",
  ],
  AlertOnCallRule: [
    "monitors",
    "alertSeverities",
    "alertLabels",
    "monitorLabels",
    "alertTitlePattern",
    "alertDescriptionPattern",
    "monitorNamePattern",
    "monitorDescriptionPattern",
  ],
  AlertOwnerRule: [
    "monitors",
    "alertSeverities",
    "alertLabels",
    "monitorLabels",
    "alertTitlePattern",
    "alertDescriptionPattern",
    "monitorNamePattern",
    "monitorDescriptionPattern",
  ],
  AlertPrivacyRule: [
    "monitors",
    "alertSeverities",
    "alertLabels",
    "monitorLabels",
    "alertTitlePattern",
    "alertDescriptionPattern",
    "monitorNamePattern",
    "monitorDescriptionPattern",
  ],
  AlertReminderRule: ["alertSeverities", "labels"],
  AutoRemediationRule: [
    "monitors",
    "incidentSeverities",
    "alertSeverities",
    "labels",
    "monitorLabels",
    "titlePattern",
    "descriptionPattern",
  ],
  CephClusterLabelRule: [
    "cephClusterLabels",
    "cephClusterNamePattern",
    "cephClusterDescriptionPattern",
  ],
  CephClusterOwnerRule: [
    "cephClusterLabels",
    "cephClusterNamePattern",
    "cephClusterDescriptionPattern",
  ],
  CloudResourceLabelRule: [
    "matchLabels",
    "nameRegexPattern",
    "descriptionRegexPattern",
  ],
  CloudResourceOwnerRule: [
    "matchLabels",
    "nameRegexPattern",
    "descriptionRegexPattern",
  ],
  DashboardLabelRule: [
    "dashboardLabels",
    "dashboardNamePattern",
    "dashboardDescriptionPattern",
  ],
  DashboardOwnerRule: [
    "dashboardLabels",
    "dashboardNamePattern",
    "dashboardDescriptionPattern",
  ],
  DockerHostLabelRule: [
    "dockerHostLabels",
    "dockerHostNamePattern",
    "dockerHostDescriptionPattern",
  ],
  DockerHostOwnerRule: [
    "dockerHostLabels",
    "dockerHostNamePattern",
    "dockerHostDescriptionPattern",
  ],
  DockerSwarmClusterLabelRule: [
    "dockerSwarmClusterLabels",
    "dockerSwarmClusterNamePattern",
    "dockerSwarmClusterDescriptionPattern",
  ],
  DockerSwarmClusterOwnerRule: [
    "dockerSwarmClusterLabels",
    "dockerSwarmClusterNamePattern",
    "dockerSwarmClusterDescriptionPattern",
  ],
  HostLabelRule: ["hostLabels", "hostNamePattern", "hostDescriptionPattern"],
  HostOwnerRule: ["hostLabels", "hostNamePattern", "hostDescriptionPattern"],
  IncidentEpisodeLabelRule: [
    "incidentSeverities",
    "episodeLabels",
    "episodeTitlePattern",
    "episodeDescriptionPattern",
  ],
  IncidentEpisodeOnCallRule: [
    "incidentSeverities",
    "episodeLabels",
    "episodeTitlePattern",
    "episodeDescriptionPattern",
  ],
  IncidentEpisodeOwnerRule: [
    "incidentSeverities",
    "episodeLabels",
    "episodeTitlePattern",
    "episodeDescriptionPattern",
  ],
  IncidentEpisodePrivacyRule: [
    "incidentSeverities",
    "episodeLabels",
    "episodeTitlePattern",
    "episodeDescriptionPattern",
  ],
  IncidentGroupingRule: [
    "monitors",
    "incidentSeverities",
    "incidentLabels",
    "monitorLabels",
    "incidentTitlePattern",
    "incidentDescriptionPattern",
    "monitorNamePattern",
    "monitorDescriptionPattern",
  ],
  IncidentLabelRule: [
    "monitors",
    "incidentSeverities",
    "incidentLabels",
    "monitorLabels",
    "incidentTitlePattern",
    "incidentDescriptionPattern",
    "monitorNamePattern",
    "monitorDescriptionPattern",
  ],
  IncidentOnCallRule: [
    "monitors",
    "incidentSeverities",
    "incidentLabels",
    "monitorLabels",
    "incidentTitlePattern",
    "incidentDescriptionPattern",
    "monitorNamePattern",
    "monitorDescriptionPattern",
  ],
  IncidentOwnerRule: [
    "monitors",
    "incidentSeverities",
    "incidentLabels",
    "monitorLabels",
    "incidentTitlePattern",
    "incidentDescriptionPattern",
    "monitorNamePattern",
    "monitorDescriptionPattern",
  ],
  IncidentPrivacyRule: [
    "monitors",
    "incidentSeverities",
    "incidentLabels",
    "monitorLabels",
    "incidentTitlePattern",
    "incidentDescriptionPattern",
    "monitorNamePattern",
    "monitorDescriptionPattern",
  ],
  IncidentReminderRule: ["incidentSeverities", "labels"],
  IncidentSlaRule: [
    "monitors",
    "incidentSeverities",
    "incidentLabels",
    "monitorLabels",
    "incidentTitlePattern",
    "incidentDescriptionPattern",
  ],
  IncomingCallPolicyLabelRule: [
    "incomingCallPolicyLabels",
    "incomingCallPolicyNamePattern",
    "incomingCallPolicyDescriptionPattern",
  ],
  IncomingCallPolicyOwnerRule: [
    "incomingCallPolicyLabels",
    "incomingCallPolicyNamePattern",
    "incomingCallPolicyDescriptionPattern",
  ],
  IoTFleetLabelRule: [
    "iotFleetLabels",
    "iotFleetNamePattern",
    "iotFleetDescriptionPattern",
  ],
  IoTFleetOwnerRule: [
    "iotFleetLabels",
    "iotFleetNamePattern",
    "iotFleetDescriptionPattern",
  ],
  KubernetesClusterLabelRule: [
    "kubernetesClusterLabels",
    "kubernetesClusterNamePattern",
    "kubernetesClusterDescriptionPattern",
  ],
  KubernetesClusterOwnerRule: [
    "kubernetesClusterLabels",
    "kubernetesClusterNamePattern",
    "kubernetesClusterDescriptionPattern",
  ],
  MonitorLabelRule: [
    "monitorLabels",
    "monitorNamePattern",
    "monitorDescriptionPattern",
  ],
  MonitorOwnerRule: [
    "monitorLabels",
    "monitorNamePattern",
    "monitorDescriptionPattern",
  ],
  NetworkDeviceAutoImportRule: [
    "ipMatchTarget",
    "sysNamePattern",
    "sysDescrPattern",
    "sysObjectIdPattern",
  ],
  NetworkDeviceLabelRule: [
    "networkDeviceLabels",
    "networkDeviceNamePattern",
    "networkDeviceDescriptionPattern",
  ],
  NetworkDeviceOwnerRule: [
    "networkDeviceLabels",
    "networkDeviceNamePattern",
    "networkDeviceDescriptionPattern",
  ],
  NetworkSiteAssignmentRule: ["subnetCidr", "hostnamePattern"],
  OnCallDutyPolicyLabelRule: [
    "onCallDutyPolicyLabels",
    "onCallDutyPolicyNamePattern",
    "onCallDutyPolicyDescriptionPattern",
  ],
  OnCallDutyPolicyOwnerRule: [
    "onCallDutyPolicyLabels",
    "onCallDutyPolicyNamePattern",
    "onCallDutyPolicyDescriptionPattern",
  ],
  OnCallDutyPolicyScheduleLabelRule: [
    "onCallDutyPolicyScheduleLabels",
    "onCallDutyPolicyScheduleNamePattern",
    "onCallDutyPolicyScheduleDescriptionPattern",
  ],
  OnCallDutyPolicyScheduleOwnerRule: [
    "onCallDutyPolicyScheduleLabels",
    "onCallDutyPolicyScheduleNamePattern",
    "onCallDutyPolicyScheduleDescriptionPattern",
  ],
  PodmanHostLabelRule: [
    "podmanHostLabels",
    "podmanHostNamePattern",
    "podmanHostDescriptionPattern",
  ],
  PodmanHostOwnerRule: [
    "podmanHostLabels",
    "podmanHostNamePattern",
    "podmanHostDescriptionPattern",
  ],
  ProxmoxClusterLabelRule: [
    "proxmoxClusterLabels",
    "proxmoxClusterNamePattern",
    "proxmoxClusterDescriptionPattern",
  ],
  ProxmoxClusterOwnerRule: [
    "proxmoxClusterLabels",
    "proxmoxClusterNamePattern",
    "proxmoxClusterDescriptionPattern",
  ],
  RumApplicationLabelRule: [
    "matchLabels",
    "nameRegexPattern",
    "descriptionRegexPattern",
  ],
  RumApplicationOwnerRule: [
    "matchLabels",
    "nameRegexPattern",
    "descriptionRegexPattern",
  ],
  RunbookLabelRule: [
    "runbookLabels",
    "runbookNamePattern",
    "runbookDescriptionPattern",
  ],
  RunbookOwnerRule: [
    "runbookLabels",
    "runbookNamePattern",
    "runbookDescriptionPattern",
  ],
  RunbookRule: ["titlePattern", "descriptionPattern"],
  ScheduledMaintenanceLabelRule: [
    "monitors",
    "scheduledMaintenanceLabels",
    "monitorLabels",
    "titlePattern",
    "descriptionPattern",
    "monitorNamePattern",
    "monitorDescriptionPattern",
  ],
  ScheduledMaintenanceOwnerRule: [
    "monitors",
    "scheduledMaintenanceLabels",
    "monitorLabels",
    "titlePattern",
    "descriptionPattern",
    "monitorNamePattern",
    "monitorDescriptionPattern",
  ],
  ScheduledMaintenanceReminderRule: ["labels"],
  ServerlessFunctionLabelRule: [
    "matchLabels",
    "nameRegexPattern",
    "descriptionRegexPattern",
  ],
  ServerlessFunctionOwnerRule: [
    "matchLabels",
    "nameRegexPattern",
    "descriptionRegexPattern",
  ],
  ServiceLabelRule: [
    "serviceLabels",
    "serviceNamePattern",
    "serviceDescriptionPattern",
  ],
  ServiceOwnerRule: [
    "serviceLabels",
    "serviceNamePattern",
    "serviceDescriptionPattern",
  ],
  StatusPageLabelRule: [
    "statusPageLabels",
    "statusPageNamePattern",
    "statusPageDescriptionPattern",
  ],
  StatusPageMonitorRule: [
    "monitorLabels",
    "monitorNamePattern",
    "monitorDescriptionPattern",
  ],
  StatusPageOwnerRule: [
    "statusPageLabels",
    "statusPageNamePattern",
    "statusPageDescriptionPattern",
  ],
  VMwareVCenterLabelRule: [
    "vmwareVCenterLabels",
    "vmwareVCenterNamePattern",
    "vmwareVCenterDescriptionPattern",
  ],
  VMwareVCenterOwnerRule: [
    "vmwareVCenterLabels",
    "vmwareVCenterNamePattern",
    "vmwareVCenterDescriptionPattern",
  ],
  WorkflowLabelRule: [
    "workflowLabels",
    "workflowNamePattern",
    "workflowDescriptionPattern",
  ],
  WorkflowOwnerRule: [
    "workflowLabels",
    "workflowNamePattern",
    "workflowDescriptionPattern",
  ],
} as const;

export type RegisteredRuleCriteriaModelName =
  keyof typeof RULE_CRITERIA_FIELDS_BY_MODEL;

const RULE_CRITERIA_FIELD_LOOKUP: Readonly<
  Record<string, ReadonlyArray<string>>
> = RULE_CRITERIA_FIELDS_BY_MODEL;

export function getRuleCriteriaFieldsForModel(
  modelName: string,
): ReadonlyArray<string> | undefined {
  /*
   * Own properties only: a plain index would answer inherited
   * Object.prototype members ("constructor", "toString", "__proto__") with
   * a function or object instead of undefined, turning an unregistered name
   * into a non-array allowlist that callers then call .includes() on.
   */
  if (
    !Object.prototype.hasOwnProperty.call(RULE_CRITERIA_FIELD_LOOKUP, modelName)
  ) {
    return undefined;
  }

  return RULE_CRITERIA_FIELD_LOOKUP[modelName];
}

export default RULE_CRITERIA_FIELDS_BY_MODEL;
