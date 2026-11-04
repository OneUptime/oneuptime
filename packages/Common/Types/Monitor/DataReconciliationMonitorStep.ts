import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import { EvaluateOverTimeType, FilterType } from "./CriteriaFilter";
import MonitorType from "./MonitorType";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import {
  DataReconciliationAttribute,
  DataReconciliationMetricName,
} from "../DataObservability/DataReconciliation";
import { getDataCheckRollingTime } from "./DataCheckMonitorStep";
import {
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
} from "./Recommendation/RecommendationCriteriaBuilder";

/*
 * THE MONITOR STEP OF A RECONCILIATION'S ALERT.
 *
 * A Metrics monitor over oneuptime.data.reconciliation.drifted, filtered on
 * the reconciliation's id: Offline, with an incident and an alert, as soon as
 * a comparison finds the two tables drifted beyond the tolerance, and
 * Operational again once no comparison in the window has. A comparison is
 * written once per interval, so the window is a data check's of that
 * interval (getDataCheckRollingTime), holding the latest comparisons.
 */

const METRIC_ALIAS: string = "drifted";

export interface DataReconciliationMonitorStepArgs {
  reconciliationId: string;
  reconciliationName: string;
  intervalInMinutes: number;
  monitorName: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
}

export function buildDataReconciliationMonitorStep(
  args: DataReconciliationMonitorStepArgs,
): MonitorStep {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: args.monitorName,
    monitorType: MonitorType.Metrics,
    onlineMonitorStatusId: args.onlineMonitorStatusId,
    offlineMonitorStatusId: args.offlineMonitorStatusId,
    defaultIncidentSeverityId: args.defaultIncidentSeverityId,
    defaultAlertSeverityId: args.defaultAlertSeverityId,
  });

  step.setMetricMonitor({
    rollingTime: getDataCheckRollingTime(args.intervalInMinutes),
    metricViewConfig: {
      queryConfigs: [
        {
          metricAliasData: {
            metricVariable: METRIC_ALIAS,
            title: `Drifted - ${args.reconciliationName}`,
            description: `Whether the two tables of ${args.reconciliationName} have drifted beyond its tolerance.`,
            legend: args.reconciliationName,
            legendUnit: "",
          },
          metricQueryData: {
            filterData: {
              metricName: DataReconciliationMetricName.Drifted,
              attributes: {
                [DataReconciliationAttribute.ReconciliationId]:
                  args.reconciliationId,
              },
              aggegationType: MetricsAggregationType.Max,
              aggregateBy: {},
            },
          },
        },
      ],
      formulaConfigs: [],
    },
  });

  const unhealthy: MonitorCriteriaInstance = buildUnhealthyCriteriaInstance({
    offlineMonitorStatusId: args.offlineMonitorStatusId,
    incidentSeverityId: args.defaultIncidentSeverityId,
    alertSeverityId: args.defaultAlertSeverityId,
    monitorName: args.monitorName,
    metricAlias: METRIC_ALIAS,
    filterType: FilterType.GreaterThan,
    value: 0,
    incidentTitle: `[Data] ${args.reconciliationName} has drifted`,
    incidentDescription: `The two tables of the reconciliation ${args.reconciliationName} no longer agree within its tolerance. Reconciliations in Data Observability shows both values and the difference.`,
    criteriaName: `${args.reconciliationName} has drifted`,
    criteriaDescription:
      "Triggers when the latest comparison finds the two tables drifted beyond the tolerance.",
    resourceNoun: "reconciliation",
    // A comparison is an event: its result decides until the next one.
    metricAggregationType: EvaluateOverTimeType.AnyValue,
  });

  const healthy: MonitorCriteriaInstance = buildHealthyCriteriaInstance({
    onlineMonitorStatusId: args.onlineMonitorStatusId,
    metricAlias: METRIC_ALIAS,
    filterType: FilterType.LessThanOrEqualTo,
    value: 0,
    recoveryValue: 0,
    isBinaryMetric: true,
    metricAggregationType: EvaluateOverTimeType.AllValues,
  });

  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = { monitorCriteriaInstanceArray: [unhealthy, healthy] };
  step.setMonitorCriteria(criteria);

  return step;
}
