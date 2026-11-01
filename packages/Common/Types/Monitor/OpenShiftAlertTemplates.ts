import ObjectID from "../ObjectID";
import FilterCondition from "../Filter/FilterCondition";
import { OpenShiftObjectAttribute } from "../Kubernetes/OpenShiftObjectAttributes";
import {
  OpenShiftConditionStatus,
  OpenShiftResourceType,
} from "../Kubernetes/OpenShiftObjectParser";
import { CheckOn, FilterType } from "./CriteriaFilter";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import MonitorStep from "./MonitorStep";
import MonitorStepLogMonitor from "./MonitorStepLogMonitor";
import { KubernetesAlertTemplateArgs } from "./KubernetesAlertTemplates";
import { KUBERNETES_CLUSTER_NAME_LOG_ATTRIBUTE } from "./KubernetesEventAlertTemplates";

/*
 * THE OPENSHIFT ALERTS.
 *
 * An OpenShift cluster's health is mostly what its cluster operators say:
 * each reports Available, Progressing and Degraded, and the cluster version
 * operator reports whether the cluster's own update is Failing. These are the
 * alerts on them, offered on an OpenShift cluster's Recommendations page.
 *
 * Nothing sends these conditions as metrics, so the templates are Logs
 * monitors, like the Kubernetes warning events alert: the agent's openshift
 * preset pulls every ClusterOperator and the ClusterVersion each pull
 * interval (5 minutes by default), and ingest stamps each record with its
 * conditions (OpenShiftObjectAttributes.ts). A template counts this cluster's
 * records whose condition says something is wrong:
 *
 *   - grouped by the object, so every operator raises its own alert and says
 *     which;
 *   - from the second snapshot that says so. Operators move through these
 *     conditions during an update, and OpenShift's own alerts wait out a
 *     moment's flip the same way (ClusterOperatorDown waits 10 minutes);
 *   - resolved by the snapshot that says it is over, not by silence. An agent
 *     that stops sending says nothing about the operator, and the alert must
 *     not close because it did.
 *
 * The window is long enough for two snapshots at any pull interval inventory
 * can keep up with: its rows go stale after 15 minutes
 * (KubernetesResourceService), so a working interval is below that.
 *
 * These attribute keys are stored in customers' logs and monitors: never
 * rename one.
 */

export type OpenShiftAlertTemplateCategory = "OpenShift";

export interface OpenShiftAlertTemplate {
  id: string;
  name: string;
  // One plain sentence: when it fires (see KubernetesAlertTemplate.summary).
  summary: string;
  description: string;
  category: OpenShiftAlertTemplateCategory;
  severity: "Critical" | "Warning";
  getMonitorStep: (args: KubernetesAlertTemplateArgs) => MonitorStep;
}

// How far back each check looks: two snapshots at the slowest pull interval.
export const OPENSHIFT_STATUS_WINDOW_SECONDS: number = 1800;

// How many snapshots in that window must say so before it alerts.
export const OPENSHIFT_STATUS_MIN_SNAPSHOTS: number = 2;

// One alert per operator (or the cluster's version) whose condition is wrong.
export const OPENSHIFT_STATUS_GROUP_BY: Array<string> = [
  OpenShiftObjectAttribute.ObjectName,
];

export const OPENSHIFT_OPERATOR_DEGRADED_TEMPLATE_ID: string =
  "openshift-cluster-operator-degraded";
export const OPENSHIFT_OPERATOR_UNAVAILABLE_TEMPLATE_ID: string =
  "openshift-cluster-operator-unavailable";
export const OPENSHIFT_UPDATE_FAILING_TEMPLATE_ID: string =
  "openshift-cluster-update-failing";

interface OpenShiftStatusAlert {
  id: string;
  name: string;
  summary: string;
  description: string;
  severity: "Critical" | "Warning";
  // The records it counts: this resource type, with this condition status.
  resourceType: OpenShiftResourceType;
  conditionAttribute: OpenShiftObjectAttribute;
  problemStatus: OpenShiftConditionStatus;
  // The status that says it is over.
  recoveredStatus: OpenShiftConditionStatus;
  // What the alert says, with the monitor's name in it.
  problemTitle: string;
  problemDescription: (monitorName: string) => string;
}

/*
 * The Logs monitor's query. The logs that resolve a group replace the
 * monitor's filters rather than add to them
 * (MonitorStepLogMonitorUtil.toResolvedByQuery), so they name the cluster and
 * the resource type too: another cluster's operator of the same name must
 * never close this one's alert.
 */
export function buildOpenShiftStatusLogMonitor(data: {
  clusterIdentifier: string;
  resourceType: OpenShiftResourceType;
  conditionAttribute: OpenShiftObjectAttribute;
  problemStatus: OpenShiftConditionStatus;
  recoveredStatus: OpenShiftConditionStatus;
}): MonitorStepLogMonitor {
  const scope: Record<string, string> = {
    [OpenShiftObjectAttribute.ResourceName]: data.resourceType,
    [KUBERNETES_CLUSTER_NAME_LOG_ATTRIBUTE]: data.clusterIdentifier,
  };

  return {
    attributes: { ...scope, [data.conditionAttribute]: data.problemStatus },
    body: "",
    severityTexts: [],
    telemetryServiceIds: [],
    lastXSecondsOfLogs: OPENSHIFT_STATUS_WINDOW_SECONDS,
    groupByAttributes: [...OPENSHIFT_STATUS_GROUP_BY],
    resolvedByAttributes: {
      ...scope,
      [data.conditionAttribute]: data.recoveredStatus,
    },
  };
}

function buildCriteria(
  alert: OpenShiftStatusAlert,
  args: KubernetesAlertTemplateArgs,
): MonitorCriteria {
  const unhealthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  const title: string = `[OpenShift] ${alert.problemTitle} - ${args.monitorName}`;
  const description: string = alert.problemDescription(args.monitorName);

  unhealthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: args.offlineMonitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: CheckOn.LogCount,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: OPENSHIFT_STATUS_MIN_SNAPSHOTS,
      },
    ],
    incidents: [
      {
        title: title,
        description: description,
        incidentSeverityId: args.defaultIncidentSeverityId,
        autoResolveIncident: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    alerts: [
      {
        title: title,
        description: description,
        alertSeverityId: args.defaultAlertSeverityId,
        autoResolveAlert: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    changeMonitorStatus: true,
    /*
     * Both, as every template ships: the create form's Alert / Incident /
     * Both choice decides which of the two a monitor made from it raises
     * (MonitorRecommendationUtil).
     */
    createIncidents: true,
    createAlerts: true,
    name: `${args.monitorName} - ${alert.problemTitle}`,
    description: `${alert.problemTitle}, in two snapshots or more.`,
  };

  const healthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  healthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: args.onlineMonitorStatusId,
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
    description: "Nothing reports this.",
  };

  const criteria: MonitorCriteria = new MonitorCriteria();

  criteria.data = {
    monitorCriteriaInstanceArray: [unhealthy, healthy],
  };

  return criteria;
}

function toTemplate(alert: OpenShiftStatusAlert): OpenShiftAlertTemplate {
  return {
    id: alert.id,
    name: alert.name,
    summary: alert.summary,
    description: alert.description,
    category: "OpenShift",
    severity: alert.severity,
    getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
      const monitorStep: MonitorStep = new MonitorStep();

      monitorStep.data = {
        id: ObjectID.generate().toString(),
        monitorDestination: undefined,
        doNotFollowRedirects: undefined,
        monitorDestinationPort: undefined,
        monitorCriteria: buildCriteria(alert, args),
        requestType: "GET" as any,
        requestHeaders: undefined,
        requestBody: undefined,
        customCode: undefined,
        screenSizeTypes: undefined,
        browserTypes: undefined,
        retryCountOnError: undefined,
        logMonitor: buildOpenShiftStatusLogMonitor({
          clusterIdentifier: args.clusterIdentifier,
          resourceType: alert.resourceType,
          conditionAttribute: alert.conditionAttribute,
          problemStatus: alert.problemStatus,
          recoveredStatus: alert.recoveredStatus,
        }),
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
    },
  };
}

/*
 * No backticks in a description: it is drawn as plain text on the
 * recommendation card.
 */
const OPENSHIFT_STATUS_ALERTS: Array<OpenShiftStatusAlert> = [
  {
    id: OPENSHIFT_OPERATOR_UNAVAILABLE_TEMPLATE_ID,
    name: "Cluster Operator Unavailable",
    summary:
      "An OpenShift cluster operator says it is not available: one alert per operator.",
    description:
      "Alert when an OpenShift cluster operator reports Available=False: what it runs - the API server, ingress, DNS, the console, authentication - is not serving. Each operator raises its own alert once two snapshots in a row say so, and it resolves when a snapshot says the operator is back. It is a Logs monitor over the snapshots the Kubernetes agent's openshift preset sends.",
    severity: "Critical",
    resourceType: OpenShiftResourceType.ClusterOperators,
    conditionAttribute: OpenShiftObjectAttribute.Available,
    problemStatus: OpenShiftConditionStatus.False,
    recoveredStatus: OpenShiftConditionStatus.True,
    problemTitle: "Cluster operator unavailable",
    problemDescription: (monitorName: string): string => {
      return `An OpenShift cluster operator on ${monitorName} reports Available=False. The operator is named under this alert's title, and what it says is on the cluster's Overview.`;
    },
  },
  {
    id: OPENSHIFT_OPERATOR_DEGRADED_TEMPLATE_ID,
    name: "Cluster Operator Degraded",
    summary:
      "An OpenShift cluster operator says it is degraded: one alert per operator.",
    description:
      "Alert when an OpenShift cluster operator reports Degraded=True: it still runs, but below the level it should. Each operator raises its own alert once two snapshots in a row say so, so one that flips for a moment during an update raises none, and it resolves when a snapshot says the operator has recovered. It is a Logs monitor over the snapshots the Kubernetes agent's openshift preset sends.",
    severity: "Warning",
    resourceType: OpenShiftResourceType.ClusterOperators,
    conditionAttribute: OpenShiftObjectAttribute.Degraded,
    problemStatus: OpenShiftConditionStatus.True,
    recoveredStatus: OpenShiftConditionStatus.False,
    problemTitle: "Cluster operator degraded",
    problemDescription: (monitorName: string): string => {
      return `An OpenShift cluster operator on ${monitorName} reports Degraded=True. The operator is named under this alert's title, and what it says is on the cluster's Overview.`;
    },
  },
  {
    id: OPENSHIFT_UPDATE_FAILING_TEMPLATE_ID,
    name: "Cluster Update Failing",
    summary:
      "OpenShift's cluster version operator says an update cannot complete.",
    description:
      "Alert when the cluster version operator reports Failing=True: an update has stopped part way, or the cluster cannot keep the version it should run. It alerts once two snapshots in a row say so, and resolves when a snapshot says it no longer fails. It is a Logs monitor over the snapshots the Kubernetes agent's openshift preset sends.",
    severity: "Critical",
    resourceType: OpenShiftResourceType.ClusterVersions,
    conditionAttribute: OpenShiftObjectAttribute.Failing,
    problemStatus: OpenShiftConditionStatus.True,
    recoveredStatus: OpenShiftConditionStatus.False,
    problemTitle: "Cluster update failing",
    problemDescription: (monitorName: string): string => {
      return `The OpenShift cluster version operator on ${monitorName} reports Failing=True. What it says, with the versions it runs and moves to, is on the cluster's Overview.`;
    },
  },
];

// Every OpenShift alert, built on what the openshift preset collects.
export function getAllOpenShiftAlertTemplates(): Array<OpenShiftAlertTemplate> {
  return OPENSHIFT_STATUS_ALERTS.map(toTemplate);
}
