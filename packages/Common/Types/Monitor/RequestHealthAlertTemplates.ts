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
 * THE SHARED BUILDERS OF EVERY "IS IT FAILING, IS IT SLOW, HAS IT STOPPED"
 * RECOMMENDATION, for any product whose telemetry is told apart by resource
 * attributes rather than by a service (#9307).
 *
 * An App Platforms app is selected by its environment's resource.cloud.*
 * attributes and its own; a serverless function by its resource.faas.name.
 * What its team most needs watched is the same either way: error spans, a
 * burst of them, spans stopping, and the request duration's tail. So the
 * monitors are built here once, over the scope a product names - the
 * attribute filter its own Traces tab reads - and each product's catalog
 * (CloudAppAlertTemplates, ServerlessAlertTemplates) only says which of
 * them it offers and in its own words.
 *
 * A template is never built without a filter: the product's catalog decides
 * when a scope is specific enough (isCloudAppTelemetryScoped ...), since a
 * monitor filtered on nothing would read the whole project.
 *
 * Pure and isomorphic: the catalog, the Dashboard and the tests read it.
 */

export type RequestHealthAlertTemplateSeverity = "Critical" | "Warning";

/*
 * What every request-health monitor is built from: the attributes that
 * select the resource's telemetry, and the project's statuses and
 * severities. A product's own args add its record's id.
 */
export interface RequestHealthAlertTemplateArgs {
  telemetryFilters: Dictionary<string>;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export interface RequestHealthAlertTemplate<
  TCategory extends string,
  TArgs extends RequestHealthAlertTemplateArgs,
> {
  // "<product>-<what>": stable, and unique in the catalog.
  id: string;
  name: string;
  // One plain sentence: when it fires.
  summary: string;
  description: string;
  category: TCategory;
  severity: RequestHealthAlertTemplateSeverity;
  monitorType: MonitorType;
  getMonitorStep: (args: TArgs) => MonitorStep;
}

/*
 * How a product names its resource in the monitors it creates: the prefix
 * of every incident title ("[App]") and the noun the criteria's words use
 * ("app").
 */
export interface RequestHealthScope {
  titlePrefix: string;
  resourceNoun: string;
}

// What a product says about one span-count template, in its own words.
export interface SpanCountAlertTemplateDefinition<TCategory extends string> {
  id: string;
  name: string;
  summary: string;
  description: string;
  category: TCategory;
  severity: RequestHealthAlertTemplateSeverity;
  // The statuses counted; empty counts every span.
  spanStatuses: Array<SpanStatus>;
  lastXSecondsOfSpans: number;
  unhealthyFilterType: FilterType;
  threshold: number;
  criteriaName: string;
  criteriaDescription: string;
  incidentDescription: string;
}

// What a product says about one latency template, in its own words.
export interface RequestLatencyAlertTemplateDefinition<
  TCategory extends string,
> {
  id: string;
  name: string;
  summary: string;
  description: string;
  category: TCategory;
  severity: RequestHealthAlertTemplateSeverity;
  // The duration histogram it reads ("http.server.request.duration").
  metricName: string;
  alias: string;
  aggregationType: MetricsAggregationType;
  thresholdMs: number;
  thresholdLabel: string;
  incidentDescription: string;
}

/*
 * The filters a template may scope a monitor by: text values only, keys
 * and values not blank. Anything else in the stored value is dropped
 * rather than turned into a filter that matches nothing.
 */
export function readRequestHealthTelemetryFilters(
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

function emptyStep(
  args: RequestHealthAlertTemplateArgs,
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
  scope: RequestHealthScope;
  args: RequestHealthAlertTemplateArgs;
  name: string;
  unhealthyFilterType: FilterType;
  threshold: number;
  criteriaName: string;
  criteriaDescription: string;
  incidentDescription: string;
}): MonitorCriteria {
  const title: string = `${data.scope.titlePrefix} ${data.name} - ${data.args.monitorName}`;

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

/*
 * A Traces monitor counting the resource's own spans - those of the given
 * statuses, or all of them - over a window: errors appearing, errors
 * bursting, or spans stopping.
 */
export function buildSpanCountAlertTemplate<
  TCategory extends string,
  TArgs extends RequestHealthAlertTemplateArgs,
>(
  data: SpanCountAlertTemplateDefinition<TCategory> & {
    scope: RequestHealthScope;
  },
): RequestHealthAlertTemplate<TCategory, TArgs> {
  return {
    id: data.id,
    name: data.name,
    summary: data.summary,
    description: data.description,
    category: data.category,
    severity: data.severity,
    monitorType: MonitorType.Traces,
    getMonitorStep: (args: TArgs): MonitorStep => {
      const step: MonitorStep = emptyStep(args, MonitorType.Traces);

      step.setTraceMonitor({
        // The resource's own spans, as its Traces tab reads them.
        attributes: {
          ...readRequestHealthTelemetryFilters(args.telemetryFilters),
        },
        spanName: "",
        spanStatuses: data.spanStatuses,
        telemetryServiceIds: [],
        entityKeys: [],
        lastXSecondsOfSpans: data.lastXSecondsOfSpans,
      });

      step.setMonitorCriteria(
        buildSpanCountCriteria({
          scope: data.scope,
          args,
          name: data.name,
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
}

/*
 * A latency percentile of the resource's requests, held for five minutes:
 * a property of the resource, so read over every instance, never per
 * instance. Written in milliseconds: the worker converts the histogram's
 * own unit (seconds, by the semantic convention) to the alias's.
 */
export function buildRequestLatencyAlertTemplate<
  TCategory extends string,
  TArgs extends RequestHealthAlertTemplateArgs,
>(
  data: RequestLatencyAlertTemplateDefinition<TCategory> & {
    scope: RequestHealthScope;
  },
): RequestHealthAlertTemplate<TCategory, TArgs> {
  return {
    id: data.id,
    name: data.name,
    summary: data.summary,
    description: data.description,
    category: data.category,
    severity: data.severity,
    monitorType: MonitorType.Metrics,
    getMonitorStep: (args: TArgs): MonitorStep => {
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
                  metricName: data.metricName,
                  attributes: {
                    ...readRequestHealthTelemetryFilters(args.telemetryFilters),
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
            incidentTitle: `${data.scope.titlePrefix} ${data.name} - ${args.monitorName}`,
            incidentDescription: data.incidentDescription,
            criteriaName: `${data.name} - ${data.thresholdLabel} or worse`,
            criteriaDescription: `Triggers when ${data.metricName} stays at ${data.thresholdLabel} or worse for the whole evaluation window.`,
            resourceNoun: data.scope.resourceNoun,
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
