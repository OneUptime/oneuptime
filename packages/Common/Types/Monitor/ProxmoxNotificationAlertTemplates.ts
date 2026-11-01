import ObjectID from "../ObjectID";
import FilterCondition from "../Filter/FilterCondition";
import { CheckOn, FilterType } from "./CriteriaFilter";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import MonitorStep from "./MonitorStep";
import MonitorStepLogMonitor from "./MonitorStepLogMonitor";
import { ProxmoxAlertTemplateArgs } from "./ProxmoxAlertTemplates";
import {
  PROXMOX_NOTIFICATION_NODE_ATTRIBUTE,
  ProxmoxNotificationAttribute,
  ProxmoxNotificationSeverity,
  ProxmoxNotificationType,
} from "../../Utils/Proxmox/ProxmoxNotifications";

/*
 * ALERTS ON WHAT PROXMOX VE SAYS ITSELF.
 *
 * A cluster that sends its own notifications to OneUptime (the two commands
 * on its setup guide, Common/Utils/Proxmox/ProxmoxNotifications) stores each
 * one as a log of the cluster: a backup job's result, a node fenced, a
 * replication failure, updates waiting, mail for root. The two things a
 * Proxmox admin must hear about at once from those are a backup job that
 * failed - nothing pve-exporter or the native push reports - and a node HA
 * fenced. So these two are Logs monitors over the cluster's notification
 * records, offered on its Recommendations page under their own heading
 * (like the Kubernetes warning events, KubernetesEventAlertTemplates): a
 * Proxmox monitor reads metrics, and its Quick Setup never lists them.
 *
 *   - Backup Job Failed: one alert per node and backup job that failed. It
 *     stays open until the same job succeeds on that node - a successful
 *     backup notification resolves it (resolvedByAttributes) - never just
 *     because time passed, so a job that stopped running entirely keeps it
 *     open.
 *   - Node Fenced: one alert per node the HA manager fenced; it resolves
 *     after half an hour without another fencing of it. Node Offline covers
 *     the outage itself.
 *
 * These attribute keys are stored in customers' logs and monitors: never
 * rename one.
 */

export const PROXMOX_BACKUP_JOB_FAILED_TEMPLATE_ID: string =
  "pve-backup-job-failed";
export const PROXMOX_NODE_FENCED_TEMPLATE_ID: string = "pve-node-fenced";

// The resource attribute every record of a cluster carries, as logs store it.
export const PROXMOX_CLUSTER_NAME_LOG_ATTRIBUTE: string =
  "resource.proxmox.cluster.name";

// The node a notification came from, as logs store it.
export const PROXMOX_NODE_NAME_LOG_ATTRIBUTE: string = `resource.${PROXMOX_NOTIFICATION_NODE_ATTRIBUTE}`;

/*
 * How far back each check looks for a failed backup: a failure opens its
 * alert at the next check; what closes it is the job's next success.
 */
export const PROXMOX_BACKUP_JOB_FAILED_WINDOW_SECONDS: number = 3600;

// A fencing keeps its alert open for half an hour.
export const PROXMOX_NODE_FENCED_WINDOW_SECONDS: number = 1800;

// One alert per node and backup job ("Run now" backups share one, unnamed).
export const PROXMOX_BACKUP_JOB_FAILED_GROUP_BY: Array<string> = [
  PROXMOX_NODE_NAME_LOG_ATTRIBUTE,
  ProxmoxNotificationAttribute.JobId,
];

export const PROXMOX_NODE_FENCED_GROUP_BY: Array<string> = [
  PROXMOX_NODE_NAME_LOG_ATTRIBUTE,
];

export type ProxmoxNotificationAlertTemplateCategory = "Notifications";

export interface ProxmoxNotificationAlertTemplate {
  id: string;
  name: string;
  // One plain sentence: when it fires (see ProxmoxAlertTemplate.summary).
  summary: string;
  description: string;
  category: ProxmoxNotificationAlertTemplateCategory;
  severity: "Critical" | "Warning";
  getMonitorStep: (args: ProxmoxAlertTemplateArgs) => MonitorStep;
}

// The Logs monitor's query: this cluster's failed backup jobs, per node and job.
export function buildProxmoxBackupJobFailedLogMonitor(
  clusterIdentifier: string,
): MonitorStepLogMonitor {
  return {
    attributes: {
      [PROXMOX_CLUSTER_NAME_LOG_ATTRIBUTE]: clusterIdentifier,
      [ProxmoxNotificationAttribute.Type]: ProxmoxNotificationType.Backup,
      [ProxmoxNotificationAttribute.Severity]:
        ProxmoxNotificationSeverity.Error,
    },
    body: "",
    severityTexts: [],
    telemetryServiceIds: [],
    lastXSecondsOfLogs: PROXMOX_BACKUP_JOB_FAILED_WINDOW_SECONDS,
    groupByAttributes: [...PROXMOX_BACKUP_JOB_FAILED_GROUP_BY],
    /*
     * The same job's next successful run, on the same node, resolves it.
     * The resolving query uses these attributes alone, so they name the
     * cluster too.
     */
    resolvedByAttributes: {
      [PROXMOX_CLUSTER_NAME_LOG_ATTRIBUTE]: clusterIdentifier,
      [ProxmoxNotificationAttribute.Type]: ProxmoxNotificationType.Backup,
      [ProxmoxNotificationAttribute.Severity]: ProxmoxNotificationSeverity.Info,
    },
  };
}

// The Logs monitor's query: this cluster's fencings, per node.
export function buildProxmoxNodeFencedLogMonitor(
  clusterIdentifier: string,
): MonitorStepLogMonitor {
  return {
    attributes: {
      [PROXMOX_CLUSTER_NAME_LOG_ATTRIBUTE]: clusterIdentifier,
      [ProxmoxNotificationAttribute.Type]: ProxmoxNotificationType.Fencing,
    },
    body: "",
    severityTexts: [],
    telemetryServiceIds: [],
    lastXSecondsOfLogs: PROXMOX_NODE_FENCED_WINDOW_SECONDS,
    groupByAttributes: [...PROXMOX_NODE_FENCED_GROUP_BY],
  };
}

function buildCriteria(data: {
  args: ProxmoxAlertTemplateArgs;
  title: string;
  description: string;
  criteriaName: string;
  criteriaDescription: string;
  healthyDescription: string;
}): MonitorCriteria {
  const unhealthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  unhealthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.args.offlineMonitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: CheckOn.LogCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      },
    ],
    incidents: [
      {
        title: data.title,
        description: data.description,
        incidentSeverityId: data.args.defaultIncidentSeverityId,
        autoResolveIncident: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    alerts: [
      {
        title: data.title,
        description: data.description,
        alertSeverityId: data.args.defaultAlertSeverityId,
        autoResolveAlert: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    changeMonitorStatus: true,
    // Both, as every template ships (see KubernetesEventAlertTemplates).
    createIncidents: true,
    createAlerts: true,
    name: data.criteriaName,
    description: data.criteriaDescription,
  };

  const healthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  healthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.args.onlineMonitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: CheckOn.LogCount,
        filterType: FilterType.EqualTo,
        value: 0,
      },
    ],
    incidents: [],
    alerts: [],
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: false,
    name: "Healthy",
    description: data.healthyDescription,
  };

  const criteria: MonitorCriteria = new MonitorCriteria();

  criteria.data = {
    monitorCriteriaInstanceArray: [unhealthy, healthy],
  };

  return criteria;
}

function buildStep(data: {
  criteria: MonitorCriteria;
  logMonitor: MonitorStepLogMonitor;
}): MonitorStep {
  const monitorStep: MonitorStep = new MonitorStep();

  monitorStep.data = {
    id: ObjectID.generate().toString(),
    monitorDestination: undefined,
    doNotFollowRedirects: undefined,
    monitorDestinationPort: undefined,
    monitorCriteria: data.criteria,
    requestType: "GET" as any,
    requestHeaders: undefined,
    requestBody: undefined,
    customCode: undefined,
    screenSizeTypes: undefined,
    browserTypes: undefined,
    retryCountOnError: undefined,
    logMonitor: data.logMonitor,
    traceMonitor: undefined,
    metricMonitor: undefined,
    exceptionMonitor: undefined,
    snmpMonitor: undefined,
    dnsMonitor: undefined,
    domainMonitor: undefined,
    externalStatusPageMonitor: undefined,
    kubernetesMonitor: undefined,
  };

  return monitorStep;
}

const backupJobFailedTemplate: ProxmoxNotificationAlertTemplate = {
  id: PROXMOX_BACKUP_JOB_FAILED_TEMPLATE_ID,
  name: "Backup Job Failed",
  summary:
    "A backup job fails on a node: one alert per node and job, until it succeeds again.",
  /*
   * No backticks: the description is drawn as plain text on the
   * recommendation card.
   */
  description:
    "Alert when Proxmox VE reports that a backup job failed - a guest that could not be backed up, a backup storage that could not be reached. Each node and job raises its own alert, which resolves when the same job next succeeds on that node, so a job that stops running keeps it open. Needs the cluster's own notifications sent to OneUptime (two commands on its setup guide). It is a Logs monitor over those notifications.",
  category: "Notifications",
  severity: "Warning",
  getMonitorStep: (args: ProxmoxAlertTemplateArgs): MonitorStep => {
    const title: string = `[Proxmox] Backup Job Failed - ${args.monitorName}`;

    return buildStep({
      logMonitor: buildProxmoxBackupJobFailedLogMonitor(args.clusterIdentifier),
      criteria: buildCriteria({
        args: args,
        title: title,
        /*
         * The node and job are the alert's series, named under its title
         * (SeriesContextEnricher); the failing guests are in the message.
         */
        description: `Proxmox VE reported that a backup job failed on ${args.monitorName}. The notification's message lists each guest of the job with its status, and the log of the guests that failed. Open the cluster's Logs page, or the node's task log, for the details. The alert resolves when the same job next succeeds on that node.`,
        criteriaName: `${args.monitorName} - Backup job failed`,
        criteriaDescription:
          "Proxmox VE reported a failed backup job that has not succeeded since.",
        healthyDescription: "Every backup job succeeded on its last run.",
      }),
    });
  },
};

const nodeFencedTemplate: ProxmoxNotificationAlertTemplate = {
  id: PROXMOX_NODE_FENCED_TEMPLATE_ID,
  name: "Node Fenced",
  summary: "The HA manager fences a node: one alert per node.",
  description:
    "Alert when Proxmox VE reports that its HA manager fenced a node - it stopped answering, so the cluster cut it off and recovered its HA guests on the other nodes. One alert per node, which resolves after 30 minutes without another fencing of it. Needs the cluster's own notifications sent to OneUptime (two commands on its setup guide). It is a Logs monitor over those notifications.",
  category: "Notifications",
  severity: "Critical",
  getMonitorStep: (args: ProxmoxAlertTemplateArgs): MonitorStep => {
    const title: string = `[Proxmox] Node Fenced - ${args.monitorName}`;

    return buildStep({
      logMonitor: buildProxmoxNodeFencedLogMonitor(args.clusterIdentifier),
      criteria: buildCriteria({
        args: args,
        title: title,
        description: `Proxmox VE reported that its HA manager fenced a node of ${args.monitorName}: the node stopped answering, so the cluster cut it off and recovered its HA guests elsewhere. Check why the node failed (power, network, a kernel hang) before it rejoins, and that its guests run where HA moved them.`,
        criteriaName: `${args.monitorName} - Node fenced`,
        criteriaDescription:
          "Proxmox VE reported a fenced node in the last 30 minutes.",
        healthyDescription: "No node fenced in the last 30 minutes.",
      }),
    });
  },
};

// Every Proxmox alert built on the cluster's own notifications.
export function getAllProxmoxNotificationAlertTemplates(): Array<ProxmoxNotificationAlertTemplate> {
  return [backupJobFailedTemplate, nodeFencedTemplate];
}
