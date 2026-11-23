import { CriteriaAlert } from "../../Types/Monitor/CriteriaAlert";
import { CheckOn } from "../../Types/Monitor/CriteriaFilter";
import { CriteriaIncident } from "../../Types/Monitor/CriteriaIncident";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "../../Types/Monitor/MonitorStepLogMonitor";
import {
  MetricMonitorQueryLanguage,
  PROMQL_METRIC_ALIAS,
} from "../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorType from "../../Types/Monitor/MonitorType";
import MonitorRecommendationSeverityMapper from "../../Types/Monitor/Recommendation/MonitorRecommendationSeverityMapper";
import TelemetryAlertRuleUtil, {
  TelemetryAlertRule,
  TelemetryAlertRuleAction,
  TelemetryAlertRuleRecovery,
} from "../../Types/Monitor/TelemetryAlertRule";
import MetricQueryConfigData from "../../Types/Metrics/MetricQueryConfigData";
import {
  ImportedAlertRule,
  ImportedAlertRuleKind,
  ImportedAlertSeverity,
  ImportedMetricQuery,
} from "../../Types/ObservabilityImport/ObservabilityImport";
import ObjectID from "../../Types/ObjectID";

/*
 * AN IMPORTED ALERT RULE, AS A MONITOR'S STEPS (issues #7697, #10324,
 * #10325).
 *
 * One step, of what the rule reads (ImportedAlertRuleKind): a Metrics
 * monitor's PromQL expression, judged series by series; a Metrics monitor's
 * one metric read by the query builder, grouped as the rule groups it; or
 * a Logs monitor's filters, counted over its window, per group. And one
 * rule (TelemetryAlertRule), as the monitor form's "When to alert" writes
 * one: the rule's condition - a threshold, an anomaly at its sensitivity,
 * a forecast within its horizon - read over its window, opening an alert -
 * or an incident - for each series or group in breach, which resolves on
 * its own once it recovers or stops being returned. The monitor shows
 * Degraded (an alert) or Offline (an incident) while one is in breach, as
 * the form's recipes do, and is Operational otherwise.
 *
 * The project's statuses and severities are handed in (AlertImportSeeds),
 * read with the person's own permissions as the form reads them; the
 * rule's severity picks one of the project's severities by rank
 * (MonitorRecommendationSeverityMapper), whatever the project calls them.
 */

export interface AlertImportSeeds {
  operationalStatusId: ObjectID;
  // The first status between operational and offline, such as Degraded.
  degradedStatusId?: ObjectID | undefined;
  offlineStatusId: ObjectID;
  // The project's live severities, the most severe first.
  rankedIncidentSeverityIds: Array<ObjectID>;
  rankedAlertSeverityIds: Array<ObjectID>;
}

export enum AlertImportAction {
  Alert = "Alert",
  Incident = "Incident",
}

// The name a metric query rule's one query goes by, as the form names one.
export const IMPORTED_METRIC_QUERY_ALIAS: string = "a";

// The monitor a rule is created as: a Logs monitor's or a Metrics monitor's.
export const getImportedMonitorType: (
  rule: Pick<ImportedAlertRule, "kind">,
) => MonitorType = (rule: Pick<ImportedAlertRule, "kind">): MonitorType => {
  return rule.kind === ImportedAlertRuleKind.LogCount
    ? MonitorType.Logs
    : MonitorType.Metrics;
};

// One metric read by the query builder, as the form writes a query.
export const buildImportedMetricQueryConfig: (
  query: ImportedMetricQuery,
) => MetricQueryConfigData = (
  query: ImportedMetricQuery,
): MetricQueryConfigData => {
  return {
    metricAliasData: {
      metricVariable: IMPORTED_METRIC_QUERY_ALIAS,
      title: query.metricName,
      description: undefined,
      legend: undefined,
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: query.metricName,
        attributes: { ...query.attributes },
        aggegationType: query.aggregation,
        aggregateBy: {},
      },
      ...(query.groupByAttributeKeys.length > 0
        ? { groupByAttributeKeys: [...query.groupByAttributeKeys] }
        : {}),
    },
  };
};

export const buildImportedMonitorSteps: (data: {
  rule: ImportedAlertRule;
  monitorName: string;
  seeds: AlertImportSeeds;
  action: AlertImportAction;
}) => MonitorSteps = (data: {
  rule: ImportedAlertRule;
  monitorName: string;
  seeds: AlertImportSeeds;
  action: AlertImportAction;
}): MonitorSteps => {
  const { rule, seeds } = data;
  const kind: ImportedAlertRuleKind = rule.kind || ImportedAlertRuleKind.PromQL;
  const monitorType: MonitorType = getImportedMonitorType(rule);

  const firstIncidentSeverity: ObjectID =
    seeds.rankedIncidentSeverityIds[0] || ObjectID.generate();
  const firstAlertSeverity: ObjectID =
    seeds.rankedAlertSeverityIds[0] || ObjectID.generate();

  const severityIds: {
    incidentSeverityId: ObjectID;
    alertSeverityId: ObjectID;
  } = MonitorRecommendationSeverityMapper.resolveTemplateSeverityIds({
    severity:
      rule.severity === ImportedAlertSeverity.Warning ? "Warning" : "Critical",
    rankedIncidentSeverityIds: seeds.rankedIncidentSeverityIds,
    rankedAlertSeverityIds: seeds.rankedAlertSeverityIds,
    fallbackIncidentSeverityId: firstIncidentSeverity,
    fallbackAlertSeverityId: firstAlertSeverity,
  });

  const steps: MonitorSteps = MonitorSteps.getDefaultMonitorSteps({
    monitorType,
    monitorName: data.monitorName,
    defaultMonitorStatusId: seeds.operationalStatusId,
    onlineMonitorStatusId: seeds.operationalStatusId,
    offlineMonitorStatusId: seeds.offlineStatusId,
    defaultIncidentSeverityId: firstIncidentSeverity,
    defaultAlertSeverityId: firstAlertSeverity,
  });

  const step: MonitorStep | undefined =
    steps.data?.monitorStepsInstanceArray[0];

  if (!step) {
    return steps;
  }

  if (kind === ImportedAlertRuleKind.LogCount) {
    const logMonitor: MonitorStepLogMonitor = {
      ...MonitorStepLogMonitorUtil.getDefault(),
      attributes: { ...(rule.logQuery?.attributes || {}) },
      body: rule.logQuery?.bodyContains || "",
      severityTexts: [...(rule.logQuery?.severityTexts || [])],
      groupByAttributes: [...(rule.logQuery?.groupByAttributes || [])],
      lastXSecondsOfLogs: rule.windowInSeconds || 60,
    };

    step.setLogMonitor(logMonitor);
  } else if (kind === ImportedAlertRuleKind.MetricQuery && rule.metricQuery) {
    step.setMetricMonitor({
      queryLanguage: MetricMonitorQueryLanguage.Builder,
      metricViewConfig: {
        queryConfigs: [buildImportedMetricQueryConfig(rule.metricQuery)],
        formulaConfigs: [],
      },
      rollingTime: rule.rollingTime,
      telemetryServiceIds: [],
    });
  } else {
    step.setMetricMonitor({
      queryLanguage: MetricMonitorQueryLanguage.PromQL,
      promQLQuery: rule.promQL,
      metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
      rollingTime: rule.rollingTime,
      telemetryServiceIds: [],
    });
  }

  const isIncident: boolean = data.action === AlertImportAction.Incident;
  const isMetrics: boolean = monitorType === MonitorType.Metrics;
  const isAnomaly: boolean = TelemetryAlertRuleUtil.isAnomaly(rule.filterType);
  const isForecast: boolean = TelemetryAlertRuleUtil.isForecast(
    rule.filterType,
  );

  const incident: CriteriaIncident | undefined = isIncident
    ? {
        id: ObjectID.generate().toString(),
        title: rule.title,
        description: rule.description,
        incidentSeverityId: severityIds.incidentSeverityId,
        autoResolveIncident: true,
        onCallPolicyIds: [],
      }
    : undefined;

  const alert: CriteriaAlert | undefined = isIncident
    ? undefined
    : {
        id: ObjectID.generate().toString(),
        title: rule.title,
        description: rule.description,
        alertSeverityId: severityIds.alertSeverityId,
        autoResolveAlert: true,
        onCallPolicyIds: [],
      };

  const telemetryRule: TelemetryAlertRule = {
    measure: isMetrics ? CheckOn.MetricValue : CheckOn.LogCount,
    filterType: rule.filterType,
    // An anomaly compares with the metric's own history, not a value.
    threshold: isAnomaly ? undefined : rule.threshold,
    windowInSeconds: isMetrics ? undefined : rule.windowInSeconds,
    rollingTime: isMetrics ? rule.rollingTime : undefined,
    metricAlias: isMetrics
      ? kind === ImportedAlertRuleKind.MetricQuery
        ? IMPORTED_METRIC_QUERY_ALIAS
        : PROMQL_METRIC_ALIAS
      : undefined,
    metricAggregationType: isMetrics ? rule.aggregation : undefined,
    onNoDataPolicy: isMetrics ? rule.onNoData : undefined,
    thresholdUnit: undefined,
    anomalyDetection:
      isAnomaly && rule.anomalySensitivity
        ? { sensitivity: rule.anomalySensitivity }
        : undefined,
    forecast:
      isForecast && rule.forecastHorizonInHours
        ? { horizonInHours: rule.forecastHorizonInHours }
        : undefined,
    action: isIncident
      ? TelemetryAlertRuleAction.Incident
      : TelemetryAlertRuleAction.Alert,
    monitorStatusId: isIncident
      ? seeds.offlineStatusId
      : seeds.degradedStatusId || seeds.offlineStatusId,
    incident,
    alert,
    name: rule.title,
    // Not one of the step's criteria: the rule takes the criteria's place.
    ruleCriteriaId: ObjectID.generate().toString(),
    recovery: TelemetryAlertRuleRecovery.DefaultStatus,
  };

  const written: MonitorStep = TelemetryAlertRuleUtil.write({
    monitorType,
    monitorStep: step,
    rule: telemetryRule,
  });

  steps.setMonitorStepsInstanceArray([written]);

  return steps;
};
