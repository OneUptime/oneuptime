import { SpanStatus } from "../../Models/AnalyticsModels/Span";
import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import FilterCondition from "../Filter/FilterCondition";
import { CheckOn, EvaluateOverTimeType, FilterType } from "./CriteriaFilter";
import MonitorType from "./MonitorType";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type RumAlertTemplateCategory = "Core Web Vitals" | "Errors";

export type RumAlertTemplateSeverity = "Critical" | "Warning";

export interface RumAlertTemplateArgs {
  rumApplicationId: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export interface RumAlertTemplate {
  id: string;
  name: string;
  description: string;
  category: RumAlertTemplateCategory;
  severity: RumAlertTemplateSeverity;
  monitorType: MonitorType;
  getMonitorStep: (args: RumAlertTemplateArgs) => MonitorStep;
}

interface CriteriaArgs {
  args: RumAlertTemplateArgs;
  checkOn: CheckOn;
  unhealthyFilterType: FilterType;
  healthyFilterType: FilterType;
  threshold: number;
  unhealthyName: string;
  unhealthyDescription: string;
  incidentTitle: string;
  incidentDescription: string;
  metricAlias?: string | undefined;
  thresholdUnit?: string | undefined;
}

function buildCriteria(data: CriteriaArgs): MonitorCriteria {
  const unhealthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  unhealthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.args.offlineMonitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: data.checkOn,
        filterType: data.unhealthyFilterType,
        value: data.threshold,
        metricMonitorOptions: data.metricAlias
          ? {
              metricAggregationType: EvaluateOverTimeType.Average,
              metricAlias: data.metricAlias,
              thresholdUnit: data.thresholdUnit,
            }
          : undefined,
      },
    ],
    incidents: [
      {
        title: data.incidentTitle,
        description: data.incidentDescription,
        incidentSeverityId: data.args.defaultIncidentSeverityId,
        autoResolveIncident: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    alerts: [
      {
        title: data.incidentTitle,
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
    name: data.unhealthyName,
    description: data.unhealthyDescription,
  };

  const healthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  healthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.args.onlineMonitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: data.checkOn,
        filterType: data.healthyFilterType,
        value: data.threshold,
        metricMonitorOptions: data.metricAlias
          ? {
              metricAggregationType: EvaluateOverTimeType.Average,
              metricAlias: data.metricAlias,
              thresholdUnit: data.thresholdUnit,
            }
          : undefined,
      },
    ],
    incidents: [],
    alerts: [],
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: false,
    name: "Healthy",
    description: `The RUM signal for ${data.args.monitorName} is within its recommended threshold.`,
  };

  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = {
    monitorCriteriaInstanceArray: [unhealthy, healthy],
  };

  return criteria;
}

interface WebVitalTemplateData {
  id: string;
  name: string;
  description: string;
  metricName: string;
  metricAlias: string;
  threshold: number;
  thresholdLabel: string;
  thresholdUnit: "ms" | "1";
  severity: RumAlertTemplateSeverity;
}

function buildWebVitalTemplate(data: WebVitalTemplateData): RumAlertTemplate {
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    category: "Core Web Vitals",
    severity: data.severity,
    monitorType: MonitorType.Metrics,
    getMonitorStep: (args: RumAlertTemplateArgs): MonitorStep => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
        monitorName: args.monitorName,
        monitorType: MonitorType.Metrics,
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        defaultIncidentSeverityId: args.defaultIncidentSeverityId,
        defaultAlertSeverityId: args.defaultAlertSeverityId,
      });

      step.setMetricMonitor({
        telemetryServiceIds: [new ObjectID(args.rumApplicationId)],
        rollingTime: RollingTime.Past5Minutes,
        metricViewConfig: {
          queryConfigs: [
            {
              metricAliasData: {
                metricVariable: data.metricAlias,
                title: data.name,
                description: data.description,
                legend: data.name,
                legendUnit: data.thresholdUnit,
              },
              metricQueryData: {
                filterData: {
                  metricName: data.metricName,
                  attributes: {},
                  aggegationType: MetricsAggregationType.Avg,
                  aggregateBy: {},
                },
              },
            },
          ],
          formulaConfigs: [],
        },
      });

      step.setMonitorCriteria(
        buildCriteria({
          args: args,
          checkOn: CheckOn.MetricValue,
          unhealthyFilterType: FilterType.GreaterThanOrEqualTo,
          healthyFilterType: FilterType.LessThan,
          threshold: data.threshold,
          metricAlias: data.metricAlias,
          thresholdUnit: data.thresholdUnit,
          unhealthyName: `${data.name} - ${data.thresholdLabel} or worse`,
          unhealthyDescription: `Triggers when the five-minute average ${data.name.toLowerCase()} reaches ${data.thresholdLabel}.`,
          incidentTitle: `[RUM] ${data.name} is poor - ${args.monitorName}`,
          incidentDescription: `${data.name} for real users reached ${data.thresholdLabel}, the poor-performance boundary. Investigate affected pages, devices, regions, and recent frontend changes.`,
        }),
      );

      return step;
    },
  };
}

const webVitalTemplates: Array<RumAlertTemplate> = [
  buildWebVitalTemplate({
    id: "rum-poor-lcp",
    name: "Poor Largest Contentful Paint",
    description:
      "Alert when average Largest Contentful Paint reaches the poor-performance boundary of 4 seconds.",
    metricName: "web_vital.lcp",
    metricAlias: "rum_lcp",
    threshold: 4000,
    thresholdLabel: "4,000 ms",
    thresholdUnit: "ms",
    severity: "Critical",
  }),
  buildWebVitalTemplate({
    id: "rum-poor-inp",
    name: "Poor Interaction to Next Paint",
    description:
      "Alert when average Interaction to Next Paint reaches the poor-performance boundary of 500 milliseconds.",
    metricName: "web_vital.inp",
    metricAlias: "rum_inp",
    threshold: 500,
    thresholdLabel: "500 ms",
    thresholdUnit: "ms",
    severity: "Critical",
  }),
  buildWebVitalTemplate({
    id: "rum-poor-cls",
    name: "Poor Cumulative Layout Shift",
    description:
      "Alert when average Cumulative Layout Shift reaches the poor-experience boundary of 0.25.",
    metricName: "web_vital.cls",
    metricAlias: "rum_cls",
    threshold: 0.25,
    thresholdLabel: "0.25",
    thresholdUnit: "1",
    severity: "Critical",
  }),
  buildWebVitalTemplate({
    id: "rum-slow-fcp",
    name: "Slow First Contentful Paint",
    description:
      "Alert when average First Contentful Paint reaches the poor-performance boundary of 3 seconds.",
    metricName: "web_vital.fcp",
    metricAlias: "rum_fcp",
    threshold: 3000,
    thresholdLabel: "3,000 ms",
    thresholdUnit: "ms",
    severity: "Warning",
  }),
  buildWebVitalTemplate({
    id: "rum-slow-ttfb",
    name: "Slow Time to First Byte",
    description:
      "Alert when average Time to First Byte reaches the poor-performance boundary of 1.8 seconds.",
    metricName: "web_vital.ttfb",
    metricAlias: "rum_ttfb",
    threshold: 1800,
    thresholdLabel: "1,800 ms",
    thresholdUnit: "ms",
    severity: "Warning",
  }),
];

const failedUserOperationsTemplate: RumAlertTemplate = {
  id: "rum-failed-user-operations",
  name: "Failed User Operations",
  description:
    "Alert when the RUM application reports one or more error-status spans in five minutes.",
  category: "Errors",
  severity: "Critical",
  monitorType: MonitorType.Traces,
  getMonitorStep: (args: RumAlertTemplateArgs): MonitorStep => {
    const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
      monitorName: args.monitorName,
      monitorType: MonitorType.Traces,
      onlineMonitorStatusId: args.onlineMonitorStatusId,
      offlineMonitorStatusId: args.offlineMonitorStatusId,
      defaultIncidentSeverityId: args.defaultIncidentSeverityId,
      defaultAlertSeverityId: args.defaultAlertSeverityId,
    });

    step.setTraceMonitor({
      attributes: {},
      spanName: "",
      spanStatuses: [SpanStatus.Error],
      telemetryServiceIds: [new ObjectID(args.rumApplicationId)],
      entityKeys: [],
      lastXSecondsOfSpans: 300,
    });

    step.setMonitorCriteria(
      buildCriteria({
        args: args,
        checkOn: CheckOn.SpanCount,
        unhealthyFilterType: FilterType.GreaterThan,
        healthyFilterType: FilterType.LessThanOrEqualTo,
        threshold: 0,
        unhealthyName: "RUM error spans detected",
        unhealthyDescription:
          "Triggers when at least one error-status span is reported in five minutes.",
        incidentTitle: `[RUM] Failed user operation - ${args.monitorName}`,
        incidentDescription:
          "The RUM application reported an error-status span. Inspect the affected page, operation, trace, device, and browser for the user-visible failure.",
      }),
    );

    return step;
  },
};

const unhandledExceptionsTemplate: RumAlertTemplate = {
  id: "rum-unhandled-exceptions",
  name: "Unhandled Browser Exceptions",
  description:
    "Alert when the RUM application reports one or more unresolved exceptions in five minutes.",
  category: "Errors",
  severity: "Critical",
  monitorType: MonitorType.Exceptions,
  getMonitorStep: (args: RumAlertTemplateArgs): MonitorStep => {
    const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
      monitorName: args.monitorName,
      monitorType: MonitorType.Exceptions,
      onlineMonitorStatusId: args.onlineMonitorStatusId,
      offlineMonitorStatusId: args.offlineMonitorStatusId,
      defaultIncidentSeverityId: args.defaultIncidentSeverityId,
      defaultAlertSeverityId: args.defaultAlertSeverityId,
    });

    step.setExceptionMonitor({
      telemetryServiceIds: [new ObjectID(args.rumApplicationId)],
      entityKeys: [],
      exceptionTypes: [],
      message: "",
      includeResolved: false,
      includeArchived: false,
      lastXSecondsOfExceptions: 300,
    });

    step.setMonitorCriteria(
      buildCriteria({
        args: args,
        checkOn: CheckOn.ExceptionCount,
        unhealthyFilterType: FilterType.GreaterThan,
        healthyFilterType: FilterType.LessThanOrEqualTo,
        threshold: 0,
        unhealthyName: "Unhandled browser exception detected",
        unhealthyDescription:
          "Triggers when at least one unresolved exception is reported in five minutes.",
        incidentTitle: `[RUM] Unhandled browser exception - ${args.monitorName}`,
        incidentDescription:
          "The RUM application reported an unresolved exception. Inspect the exception group, stack trace, release, page, browser, and affected sessions.",
      }),
    );

    return step;
  },
};

const ALL_RUM_ALERT_TEMPLATES: Array<RumAlertTemplate> = [
  ...webVitalTemplates,
  failedUserOperationsTemplate,
  unhandledExceptionsTemplate,
];

export function getAllRumAlertTemplates(): Array<RumAlertTemplate> {
  return [...ALL_RUM_ALERT_TEMPLATES];
}

export function getRumAlertTemplateById(
  id: string,
): RumAlertTemplate | undefined {
  return ALL_RUM_ALERT_TEMPLATES.find((template: RumAlertTemplate) => {
    return template.id === id;
  });
}
