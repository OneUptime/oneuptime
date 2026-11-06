import { SpanStatus } from "../../Models/AnalyticsModels/Span";
import Dictionary from "../Dictionary";
import FilterCondition from "../Filter/FilterCondition";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import ObjectID from "../ObjectID";
import RollingTime from "../RollingTime/RollingTime";
import { CheckOn, FilterType } from "./CriteriaFilter";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import MonitorStep from "./MonitorStep";
import MonitorType from "./MonitorType";
import {
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
  getRecoveryFilterType,
} from "./Recommendation/RecommendationCriteriaBuilder";

/*
 * THE MONITORS ONEUPTIME RECOMMENDS FOR AN APP PLATFORMS APP - an ECS
 * service, a Cloud Run service, a Container App, an App Service app: one
 * app of one environment, as App Platforms lists it (CloudApp).
 *
 * An app's own requests are what its team most needs watched: whether they
 * fail, whether they slow down, whether they stop. A service's recommended
 * monitors (ServiceAlertTemplates) watch the same signals, but by the
 * service its telemetry is named - and an app is not a service: two apps of
 * one platform often share a service.name (one image in two ECS clusters,
 * two Container Apps of one template), and an app may send none. So these
 * are scoped as the app's own Traces and Logs tabs are: by its
 * environment's cloud.* attributes and its own (getCloudAppTelemetryFilters
 * in the Dashboard), carried in the step's filter, never by a service.
 *
 * Every monitor reads what the app's OpenTelemetry already sends - its
 * spans, and the http.server.request.duration histogram its HTTP
 * instrumentation reports - so none needs anything set up beyond what the
 * app's page already shows. The thresholds and windows are a service's, so
 * an app and its service alert alike.
 *
 * Pure and isomorphic: the catalog, the Dashboard and the tests read it.
 */

export type CloudAppAlertTemplateCategory = "Errors" | "Latency" | "Throughput";

export type CloudAppAlertTemplateSeverity = "Critical" | "Warning";

export interface CloudAppAlertTemplateArgs {
  // The CloudApp row's id.
  cloudAppId: string;
  /*
   * The stored attributes that select the app's telemetry: its
   * environment's resource.cloud.* and its own resource.* attributes. A
   * template is never offered without them (getCloudAppAlertTemplatesFor):
   * a monitor filtered on nothing would read the whole project.
   */
  telemetryFilters: Dictionary<string>;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export interface CloudAppAlertTemplate {
  // "cloud-app-<what>": stable, and unique in the catalog.
  id: string;
  name: string;
  // One plain sentence: when it fires.
  summary: string;
  description: string;
  category: CloudAppAlertTemplateCategory;
  severity: CloudAppAlertTemplateSeverity;
  monitorType: MonitorType;
  getMonitorStep: (args: CloudAppAlertTemplateArgs) => MonitorStep;
}

// The attribute an app's platform names it by is part of its own filter.
const RESOURCE_PREFIX: string = "resource.";
// The environment's platform: an app's filter always holds it.
export const CLOUD_APP_PLATFORM_FILTER: string = "resource.cloud.platform";

// The OpenTelemetry HTTP server duration histogram (semconv, stable).
export const CLOUD_APP_REQUEST_DURATION_METRIC: string =
  "http.server.request.duration";

/*
 * The filters a template may scope a monitor by: text values only, and
 * only a set that holds the environment's platform and at least one of the
 * app's own attributes - a platform alone is every app of the environment.
 */
export function readCloudAppTelemetryFilters(
  value: unknown,
): Dictionary<string> {
  const filters: Dictionary<string> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return filters;
  }

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (key.trim() && typeof raw === "string" && raw.trim()) {
      filters[key.trim()] = raw;
    }
  }

  return filters;
}

export function isCloudAppTelemetryScoped(
  filters: Dictionary<string> | null | undefined,
): boolean {
  const read: Dictionary<string> = readCloudAppTelemetryFilters(filters);

  if (!read[CLOUD_APP_PLATFORM_FILTER]) {
    return false;
  }

  return Object.keys(read).some((key: string): boolean => {
    return (
      key.startsWith(RESOURCE_PREFIX) &&
      key !== CLOUD_APP_PLATFORM_FILTER &&
      key !== "resource.cloud.account.id" &&
      key !== "resource.cloud.region"
    );
  });
}

function emptyStep(
  args: CloudAppAlertTemplateArgs,
  type: MonitorType,
): MonitorStep {
  return MonitorStep.getDefaultMonitorStep({
    monitorName: args.monitorName,
    monitorType: type,
    onlineMonitorStatusId: args.onlineMonitorStatusId,
    offlineMonitorStatusId: args.offlineMonitorStatusId,
    defaultIncidentSeverityId: args.defaultIncidentSeverityId,
    defaultAlertSeverityId: args.defaultAlertSeverityId,
  });
}

/*
 * A span count over a window, and its mirror: the pair a count needs, so a
 * monitor that fired comes back online once the count is back.
 */
function buildSpanCountCriteria(data: {
  args: CloudAppAlertTemplateArgs;
  template: { name: string };
  unhealthyFilterType: FilterType;
  threshold: number;
  criteriaName: string;
  criteriaDescription: string;
  incidentDescription: string;
}): MonitorCriteria {
  const title: string = `[App] ${data.template.name} - ${data.args.monitorName}`;

  const unhealthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  unhealthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.args.offlineMonitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: CheckOn.SpanCount,
        filterType: data.unhealthyFilterType,
        value: data.threshold,
      },
    ],
    incidents: [
      {
        title: title,
        description: data.incidentDescription,
        incidentSeverityId: data.args.defaultIncidentSeverityId,
        autoResolveIncident: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    alerts: [
      {
        title: title,
        description: data.incidentDescription,
        alertSeverityId: data.args.defaultAlertSeverityId,
        autoResolveAlert: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    changeMonitorStatus: true,
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
        checkOn: CheckOn.SpanCount,
        filterType: getRecoveryFilterType(data.unhealthyFilterType),
        value: data.threshold,
      },
    ],
    incidents: [],
    alerts: [],
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: false,
    name: "Healthy",
    description: `${data.args.monitorName} is within its recommended threshold.`,
  };

  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = { monitorCriteriaInstanceArray: [unhealthy, healthy] };
  return criteria;
}

function spanCountTemplate(data: {
  id: string;
  name: string;
  summary: string;
  description: string;
  category: CloudAppAlertTemplateCategory;
  severity: CloudAppAlertTemplateSeverity;
  spanStatuses: Array<SpanStatus>;
  lastXSecondsOfSpans: number;
  unhealthyFilterType: FilterType;
  threshold: number;
  criteriaName: string;
  criteriaDescription: string;
  incidentDescription: string;
}): CloudAppAlertTemplate {
  const template: CloudAppAlertTemplate = {
    id: data.id,
    name: data.name,
    summary: data.summary,
    description: data.description,
    category: data.category,
    severity: data.severity,
    monitorType: MonitorType.Traces,
    getMonitorStep: (args: CloudAppAlertTemplateArgs): MonitorStep => {
      const step: MonitorStep = emptyStep(args, MonitorType.Traces);

      step.setTraceMonitor({
        // The app's own spans, as its Traces tab reads them.
        attributes: { ...readCloudAppTelemetryFilters(args.telemetryFilters) },
        spanName: "",
        spanStatuses: data.spanStatuses,
        telemetryServiceIds: [],
        entityKeys: [],
        lastXSecondsOfSpans: data.lastXSecondsOfSpans,
      });

      step.setMonitorCriteria(
        buildSpanCountCriteria({
          args,
          template,
          unhealthyFilterType: data.unhealthyFilterType,
          threshold: data.threshold,
          criteriaName: data.criteriaName,
          criteriaDescription: data.criteriaDescription,
          incidentDescription: data.incidentDescription,
        }),
      );

      return step;
    },
  };

  return template;
}

/*
 * A latency percentile of the app's requests, held for five minutes: a
 * property of the app, so read over every instance, never per instance.
 * Written in milliseconds: the worker converts the histogram's own unit
 * (seconds, by the semantic convention) to the alias's.
 */
function latencyTemplate(data: {
  id: string;
  name: string;
  summary: string;
  description: string;
  severity: CloudAppAlertTemplateSeverity;
  alias: string;
  aggregationType: MetricsAggregationType;
  thresholdMs: number;
  thresholdLabel: string;
  incidentDescription: string;
}): CloudAppAlertTemplate {
  return {
    id: data.id,
    name: data.name,
    summary: data.summary,
    description: data.description,
    category: "Latency",
    severity: data.severity,
    monitorType: MonitorType.Metrics,
    getMonitorStep: (args: CloudAppAlertTemplateArgs): MonitorStep => {
      const step: MonitorStep = emptyStep(args, MonitorType.Metrics);

      step.setMetricMonitor({
        rollingTime: RollingTime.Past5Minutes,
        metricViewConfig: {
          queryConfigs: [
            {
              metricAliasData: {
                metricVariable: data.alias,
                title: data.name,
                description: data.name,
                legend: data.name,
                legendUnit: "ms",
              },
              metricQueryData: {
                filterData: {
                  metricName: CLOUD_APP_REQUEST_DURATION_METRIC,
                  attributes: {
                    ...readCloudAppTelemetryFilters(args.telemetryFilters),
                  },
                  aggegationType: data.aggregationType,
                  aggregateBy: {},
                },
              },
            },
          ],
          formulaConfigs: [],
        },
      });

      const criteria: MonitorCriteria = new MonitorCriteria();
      criteria.data = {
        monitorCriteriaInstanceArray: [
          buildUnhealthyCriteriaInstance({
            offlineMonitorStatusId: args.offlineMonitorStatusId,
            incidentSeverityId: args.defaultIncidentSeverityId,
            alertSeverityId: args.defaultAlertSeverityId,
            monitorName: args.monitorName,
            metricAlias: data.alias,
            filterType: FilterType.GreaterThanOrEqualTo,
            value: data.thresholdMs,
            incidentTitle: `[App] ${data.name} - ${args.monitorName}`,
            incidentDescription: data.incidentDescription,
            criteriaName: `${data.name} - ${data.thresholdLabel} or worse`,
            criteriaDescription: `Triggers when ${CLOUD_APP_REQUEST_DURATION_METRIC} stays at ${data.thresholdLabel} or worse for the whole evaluation window.`,
            resourceNoun: "app",
          }),
          buildHealthyCriteriaInstance({
            onlineMonitorStatusId: args.onlineMonitorStatusId,
            metricAlias: data.alias,
            filterType: FilterType.LessThan,
            value: data.thresholdMs,
          }),
        ],
      };
      step.setMonitorCriteria(criteria);

      return step;
    },
  };
}

const CLOUD_APP_ALERT_TEMPLATES: ReadonlyArray<CloudAppAlertTemplate> = [
  spanCountTemplate({
    id: "cloud-app-failed-operations",
    name: "Failed Operations",
    summary: "The app reports a failed operation in ten minutes.",
    description:
      "Fires when the app reports any error-status span in ten minutes: the earliest sign its requests fail, whatever the cause. Reads the app's own spans.",
    category: "Errors",
    severity: "Warning",
    spanStatuses: [SpanStatus.Error],
    lastXSecondsOfSpans: 600,
    unhealthyFilterType: FilterType.GreaterThan,
    threshold: 0,
    criteriaName: "Error spans detected",
    criteriaDescription:
      "Triggers when at least one error-status span is reported in ten minutes.",
    incidentDescription:
      "The app reported a failed operation. Open its Traces tab to see which request failed, what it called and which dependency it waited on, and its Revisions tab for what was deployed last.",
  }),
  spanCountTemplate({
    id: "cloud-app-error-burst",
    name: "Error Burst",
    summary: "More than 25 operations fail in five minutes.",
    description:
      "Fires when the app reports more than 25 error-status spans in five minutes: a failure rate well past routine noise. Reads the app's own spans.",
    category: "Errors",
    severity: "Critical",
    spanStatuses: [SpanStatus.Error],
    lastXSecondsOfSpans: 300,
    unhealthyFilterType: FilterType.GreaterThan,
    threshold: 25,
    criteriaName: "Error spans above 25 in five minutes",
    criteriaDescription:
      "Triggers when more than 25 error-status spans are reported in five minutes.",
    incidentDescription:
      "The app is failing well past routine noise. Group its failing spans by operation and by dependency for the common factor, and check its Revisions tab: a deploy just before is the usual cause, and rolling back is the quickest fix.",
  }),
  spanCountTemplate({
    id: "cloud-app-traffic-stopped",
    name: "Traffic Stopped",
    summary: "The app reports no spans for fifteen minutes.",
    description:
      "Fires when the app reports no span at all for fifteen minutes. Best for an always-on app: one with idle hours will fire in them.",
    category: "Throughput",
    severity: "Warning",
    spanStatuses: [],
    lastXSecondsOfSpans: 900,
    unhealthyFilterType: FilterType.LessThan,
    threshold: 1,
    criteriaName: "No spans in fifteen minutes",
    criteriaDescription:
      "Triggers when the app reports no spans at all over fifteen minutes.",
    incidentDescription:
      "The app has stopped sending telemetry. Its instances may have stopped (its Instances tab says which still run), its exporter may have lost its way to OneUptime, or its callers may have stopped calling.",
  }),
  latencyTemplate({
    id: "cloud-app-latency-p95",
    name: "High Request Latency (p95)",
    summary: "One request in twenty takes a second or more.",
    description:
      "Fires when the 95th percentile of the app's request duration stays at a second or more for five minutes. Reads http.server.request.duration, which its HTTP instrumentation reports.",
    severity: "Warning",
    alias: "app_latency_p95",
    aggregationType: MetricsAggregationType.P95,
    thresholdMs: 1000,
    thresholdLabel: "1,000 ms",
    incidentDescription:
      "One request in twenty to the app takes a second or more. Its Traces tab, sorted by duration, shows where the time goes; its Overview, whether a deploy came just before.",
  }),
  latencyTemplate({
    id: "cloud-app-latency-p99",
    name: "Severe Request Latency (p99)",
    summary: "One request in a hundred takes 2.5 seconds or more.",
    description:
      "Fires when the 99th percentile of the app's request duration stays at 2.5 seconds or more for five minutes: the tail users give up on.",
    severity: "Critical",
    alias: "app_latency_p99",
    aggregationType: MetricsAggregationType.P99,
    thresholdMs: 2500,
    thresholdLabel: "2,500 ms",
    incidentDescription:
      "The slowest one percent of the app's requests take 2.5 seconds or more. Look for a saturated dependency, a lock or a slow query on the slowest route.",
  }),
];

export function getAllCloudAppAlertTemplates(): Array<CloudAppAlertTemplate> {
  return [...CLOUD_APP_ALERT_TEMPLATES];
}

export function getCloudAppAlertTemplate(
  id: string,
): CloudAppAlertTemplate | undefined {
  return CLOUD_APP_ALERT_TEMPLATES.find(
    (template: CloudAppAlertTemplate): boolean => {
      return template.id === id;
    },
  );
}

/*
 * The templates an app is offered: every one, once its telemetry can be
 * told apart from its environment's (isCloudAppTelemetryScoped); none
 * before - an app whose name was too long to filter by has its telemetry
 * only in its environment's tabs.
 */
export function getCloudAppAlertTemplatesFor(data: {
  telemetryFilters?: Dictionary<string> | null | undefined;
}): Array<CloudAppAlertTemplate> {
  return isCloudAppTelemetryScoped(data.telemetryFilters)
    ? getAllCloudAppAlertTemplates()
    : [];
}
