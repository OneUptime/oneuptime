import ObjectID from "../ObjectID";
import FilterCondition from "../Filter/FilterCondition";
import KubernetesEventAttribute, {
  KUBERNETES_EVENT_DOMAIN,
  KUBERNETES_EVENTS_RESOURCE_NAME,
  KubernetesEventType,
} from "../Kubernetes/KubernetesEvent";
import { CheckOn, FilterType } from "./CriteriaFilter";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import MonitorStep from "./MonitorStep";
import MonitorStepLogMonitor from "./MonitorStepLogMonitor";
import { KubernetesAlertTemplateArgs } from "./KubernetesAlertTemplates";

/*
 * THE KUBERNETES WARNING EVENTS ALERT.
 *
 * Issue #5179 found where a cluster's warning events - kernel-monitor's
 * OOMKilling on a node, an HPA's FailedGetResourceMetric - were lost, and
 * put them on the cluster's Events page. Being told when one happens took a
 * Logs monitor built by hand from a recipe in the docs (#5201's follow-up:
 * "a built-in monitor template"). This is that monitor, offered on every
 * cluster's Recommendations page and from its Events page.
 *
 * Kubernetes events are logs, stamped by ingest with what each one says
 * (KubernetesEvent.ts), so the template is a Logs monitor - not a
 * Kubernetes monitor, which reads metrics, and not one of
 * KubernetesAlertTemplates, which the Kubernetes monitor's Quick Setup
 * builds Kubernetes steps from:
 *
 *   - the cluster's Warning events: its records (event.domain k8s,
 *     k8s.resource.name events), of this cluster (resource.k8s.cluster.name),
 *     of type Warning (k8s.event.type);
 *   - grouped by namespace, kind, object and reason, so every object that
 *     warns raises its own alert - an OOM kill on one node never hides behind
 *     another node's - and each says what and where;
 *   - over the last five minutes: a warning opens its alert at the next
 *     check, a repeating one (FailedGetResourceMetric, every 15 seconds while
 *     the HPA cannot read its metric) keeps it open, and five quiet minutes
 *     resolve it. A record Kubernetes sends when it deletes an Event an hour
 *     later is dated when the Event last happened, so it never reopens one.
 *
 * These attribute keys are stored in customers' logs and monitors: never
 * rename one.
 */

export const KUBERNETES_WARNING_EVENTS_TEMPLATE_ID: string =
  "k8s-warning-events";

// The resource attribute every record of a cluster's agent carries.
export const KUBERNETES_CLUSTER_NAME_LOG_ATTRIBUTE: string =
  "resource.k8s.cluster.name";

// How far back each check looks: a warning stays open while it repeats.
export const KUBERNETES_WARNING_EVENTS_WINDOW_SECONDS: number = 300;

// One alert per object and reason that warns.
export const KUBERNETES_WARNING_EVENTS_GROUP_BY: Array<string> = [
  KubernetesEventAttribute.Namespace,
  KubernetesEventAttribute.ObjectKind,
  KubernetesEventAttribute.ObjectName,
  KubernetesEventAttribute.Reason,
];

export type KubernetesEventAlertTemplateCategory = "Events";

export interface KubernetesEventAlertTemplate {
  id: string;
  name: string;
  // One plain sentence: when it fires (see KubernetesAlertTemplate.summary).
  summary: string;
  description: string;
  category: KubernetesEventAlertTemplateCategory;
  severity: "Critical" | "Warning";
  getMonitorStep: (args: KubernetesAlertTemplateArgs) => MonitorStep;
}

// The Logs monitor's query: this cluster's Warning events, grouped.
export function buildKubernetesWarningEventsLogMonitor(
  clusterIdentifier: string,
): MonitorStepLogMonitor {
  return {
    attributes: {
      [KubernetesEventAttribute.Domain]: KUBERNETES_EVENT_DOMAIN,
      [KubernetesEventAttribute.ResourceName]: KUBERNETES_EVENTS_RESOURCE_NAME,
      [KUBERNETES_CLUSTER_NAME_LOG_ATTRIBUTE]: clusterIdentifier,
      [KubernetesEventAttribute.Type]: KubernetesEventType.Warning,
    },
    body: "",
    severityTexts: [],
    telemetryServiceIds: [],
    lastXSecondsOfLogs: KUBERNETES_WARNING_EVENTS_WINDOW_SECONDS,
    groupByAttributes: [...KUBERNETES_WARNING_EVENTS_GROUP_BY],
  };
}

function buildWarningEventsCriteria(
  args: KubernetesAlertTemplateArgs,
): MonitorCriteria {
  const unhealthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  const title: string = `[K8s] Warning Event - ${args.monitorName}`;
  /*
   * The group - namespace, kind, object and reason - is the alert's series
   * and is named under its title (SeriesContextEnricher); the message is on
   * the cluster's Events page, and in the root cause.
   */
  const description: string = `Kubernetes reported a warning event on ${args.monitorName}. It names the object and the reason; the message is in the root cause and on the cluster's Events page.`;

  unhealthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: args.offlineMonitorStatusId,
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
     * Both choice (an alert unless someone picks otherwise) decides which
     * of the two a monitor made from it raises (MonitorRecommendationUtil).
     */
    createIncidents: true,
    createAlerts: true,
    name: `${args.monitorName} - Warning event reported`,
    description: "Kubernetes reported a warning event in the last 5 minutes.",
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
    description: "No warning event in the last 5 minutes.",
  };

  const criteria: MonitorCriteria = new MonitorCriteria();

  criteria.data = {
    monitorCriteriaInstanceArray: [unhealthy, healthy],
  };

  return criteria;
}

const warningEventsTemplate: KubernetesEventAlertTemplate = {
  id: KUBERNETES_WARNING_EVENTS_TEMPLATE_ID,
  name: "Warning Events",
  summary:
    "Kubernetes reports a warning event: one alert per object and reason.",
  /*
   * No backticks: the description is drawn as plain text on the
   * recommendation card.
   */
  description:
    "Alert when Kubernetes reports a Warning event about the cluster - an OOMKilling on a node, a BackOff on a pod, a FailedMount on a volume, a FailedGetResourceMetric on an HPA. Each object and reason raises its own alert, which resolves after 5 minutes without a new warning about it. It is a Logs monitor over the events the Kubernetes agent sends: edit its filter to watch only some reasons.",
  category: "Events",
  severity: "Warning",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const monitorStep: MonitorStep = new MonitorStep();

    monitorStep.data = {
      id: ObjectID.generate().toString(),
      monitorDestination: undefined,
      doNotFollowRedirects: undefined,
      monitorDestinationPort: undefined,
      monitorCriteria: buildWarningEventsCriteria(args),
      requestType: "GET" as any,
      requestHeaders: undefined,
      requestBody: undefined,
      customCode: undefined,
      screenSizeTypes: undefined,
      browserTypes: undefined,
      retryCountOnError: undefined,
      logMonitor: buildKubernetesWarningEventsLogMonitor(
        args.clusterIdentifier,
      ),
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

// Every Kubernetes alert built on the cluster's events, not its metrics.
export function getAllKubernetesEventAlertTemplates(): Array<KubernetesEventAlertTemplate> {
  return [warningEventsTemplate];
}

// The Warning Events template.
export function getKubernetesWarningEventsTemplate(): KubernetesEventAlertTemplate {
  return warningEventsTemplate;
}
