import { CriteriaAlert } from "../../Types/Monitor/CriteriaAlert";
import { CheckOn } from "../../Types/Monitor/CriteriaFilter";
import { CriteriaIncident } from "../../Types/Monitor/CriteriaIncident";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import { MetricMonitorQueryLanguage, PROMQL_METRIC_ALIAS } from "../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorType from "../../Types/Monitor/MonitorType";
import MonitorRecommendationSeverityMapper from "../../Types/Monitor/Recommendation/MonitorRecommendationSeverityMapper";
import TelemetryAlertRuleUtil, {
  TelemetryAlertRule,
  TelemetryAlertRuleAction,
  TelemetryAlertRuleRecovery,
} from "../../Types/Monitor/TelemetryAlertRule";
import {
  ImportedAlertRule,
  ImportedAlertSeverity,
} from "../../Types/ObservabilityImport/ObservabilityImport";
import ObjectID from "../../Types/ObjectID";

/*
 * AN IMPORTED ALERT RULE, AS A METRICS MONITOR'S STEPS (issue #7697).
 *
 * One step written in PromQL (MonitorStepMetricMonitor), judged series by
 * series, and one rule (TelemetryAlertRule), as the monitor form's "When
 * to alert" writes one: the rule's condition on the expression, read over
 * its window, opening an alert - or an incident - for each series in
 * breach, which resolves on its own once the series recovers or stops
 * being returned. The monitor shows Degraded (an alert) or Offline (an
 * incident) while a series is in breach, as the form's recipes do, and is
 * Operational otherwise.
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

  const firstIncidentSeverity: ObjectID =
    seeds.rankedIncidentSeverityIds[0] || ObjectID.generate();
  const firstAlertSeverity: ObjectID =
    seeds.rankedAlertSeverityIds[0] || ObjectID.generate();

  const severityIds: { incidentSeverityId: ObjectID; alertSeverityId: ObjectID } =
    MonitorRecommendationSeverityMapper.resolveTemplateSeverityIds({
      severity:
        rule.severity === ImportedAlertSeverity.Warning ? "Warning" : "Critical",
      rankedIncidentSeverityIds: seeds.rankedIncidentSeverityIds,
      rankedAlertSeverityIds: seeds.rankedAlertSeverityIds,
      fallbackIncidentSeverityId: firstIncidentSeverity,
      fallbackAlertSeverityId: firstAlertSeverity,
    });

  const steps: MonitorSteps = MonitorSteps.getDefaultMonitorSteps({
    monitorType: MonitorType.Metrics,
    monitorName: data.monitorName,
    defaultMonitorStatusId: seeds.operationalStatusId,
    onlineMonitorStatusId: seeds.operationalStatusId,
    offlineMonitorStatusId: seeds.offlineStatusId,
    defaultIncidentSeverityId: firstIncidentSeverity,
    defaultAlertSeverityId: firstAlertSeverity,
  });

  const step: MonitorStep | undefined = steps.data?.monitorStepsInstanceArray[0];

  if (!step) {
    return steps;
  }

  step.setMetricMonitor({
    queryLanguage: MetricMonitorQueryLanguage.PromQL,
    promQLQuery: rule.promQL,
    metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
    rollingTime: rule.rollingTime,
    telemetryServiceIds: [],
  });

  const isIncident: boolean = data.action === AlertImportAction.Incident;

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
    measure: CheckOn.MetricValue,
    filterType: rule.filterType,
    threshold: rule.threshold,
    windowInSeconds: undefined,
    rollingTime: rule.rollingTime,
    metricAlias: PROMQL_METRIC_ALIAS,
    metricAggregationType: rule.aggregation,
    onNoDataPolicy: rule.onNoData,
    thresholdUnit: undefined,
    anomalyDetection: undefined,
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
    monitorType: MonitorType.Metrics,
    monitorStep: step,
    rule: telemetryRule,
  });

  steps.setMonitorStepsInstanceArray([written]);

  return steps;
};
