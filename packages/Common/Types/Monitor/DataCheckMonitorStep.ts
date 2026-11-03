import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import {
  AnomalyDetectionSensitivity,
  EvaluateOverTimeType,
  FilterType,
} from "./CriteriaFilter";
import MonitorType from "./MonitorType";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import {
  DATA_CHECK_METRIC_NAME,
  DataCheckAttribute,
} from "../DataObservability/DataCheckMetric";
import { DataCheckAlertCondition } from "../DataObservability/DataCheckType";
import {
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
  getRecoveryFilterType,
} from "./Recommendation/RecommendationCriteriaBuilder";

/*
 * THE MONITOR STEP OF ONE DATA CHECK'S ALERT.
 *
 * A Metrics monitor over oneuptime.data.check.value, filtered on the
 * check's id and grouped by its segment, so a segmented check alerts once
 * per segment (one tenant that stopped sending) and an unsegmented one
 * once. The condition is the check's own: unusually high or low for the
 * hour of the week (each series against its learned baseline), or above or
 * below a threshold. A check runs every 15 minutes at most, so the window
 * is one run: the last value decides, and the alert holds until a run
 * reads a healthy one.
 */

const METRIC_ALIAS: string = "check";

export interface DataCheckMonitorStepArgs {
  checkId: string;
  checkName: string;
  tableKey: string;
  condition: DataCheckAlertCondition;
  threshold: number | null;
  intervalInMinutes: number;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

// A window that holds the check's last run whatever its interval.
export function getDataCheckRollingTime(
  intervalInMinutes: number,
): RollingTime {
  if (intervalInMinutes <= 15) {
    return RollingTime.Past30Minutes;
  }

  if (intervalInMinutes <= 60) {
    return RollingTime.Past2Hours;
  }

  if (intervalInMinutes <= 360) {
    return RollingTime.Past12Hours;
  }

  return RollingTime.Past2Days;
}

function getFilterType(condition: DataCheckAlertCondition): FilterType {
  switch (condition) {
    case DataCheckAlertCondition.UnusuallyHigh:
      return FilterType.AnomalouslyHigh;
    case DataCheckAlertCondition.UnusuallyLow:
      return FilterType.AnomalouslyLow;
    case DataCheckAlertCondition.Below:
      return FilterType.LessThan;
    default:
      return FilterType.GreaterThan;
  }
}

function describeCondition(args: DataCheckMonitorStepArgs): string {
  switch (args.condition) {
    case DataCheckAlertCondition.UnusuallyHigh:
      return "is unusually high for this hour of the week";
    case DataCheckAlertCondition.UnusuallyLow:
      return "is unusually low for this hour of the week";
    case DataCheckAlertCondition.Below:
      return `is below ${args.threshold}`;
    default:
      return `is above ${args.threshold}`;
  }
}

export function buildDataCheckMonitorStep(
  args: DataCheckMonitorStepArgs,
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
            title: args.checkName,
            description: args.checkName,
            legend: args.checkName,
            legendUnit: "",
          },
          metricQueryData: {
            filterData: {
              metricName: DATA_CHECK_METRIC_NAME,
              attributes: {
                [DataCheckAttribute.CheckId]: args.checkId,
              },
              aggegationType: MetricsAggregationType.Max,
              aggregateBy: {},
            },
            // One series, and one alert, per segment.
            groupByAttributeKeys: [DataCheckAttribute.Segment],
          },
        },
      ],
      formulaConfigs: [],
    },
  });

  const filterType: FilterType = getFilterType(args.condition);
  const isLearned: boolean =
    filterType === FilterType.AnomalouslyHigh ||
    filterType === FilterType.AnomalouslyLow;
  const threshold: number = isLearned ? 0 : Number(args.threshold) || 0;
  const description: string = `"${args.checkName}" on ${args.tableKey} ${describeCondition(args)}.`;

  const unhealthy: MonitorCriteriaInstance = buildUnhealthyCriteriaInstance({
    offlineMonitorStatusId: args.offlineMonitorStatusId,
    incidentSeverityId: args.defaultIncidentSeverityId,
    alertSeverityId: args.defaultAlertSeverityId,
    monitorName: args.monitorName,
    metricAlias: METRIC_ALIAS,
    filterType,
    value: threshold,
    incidentTitle: `[Data] ${args.checkName} - ${args.tableKey}`,
    incidentDescription: `${description} See the check on the table's Checks tab in Data Observability.`,
    criteriaName: `${args.checkName} ${describeCondition(args)}`,
    criteriaDescription: `Triggers when the check's last value ${describeCondition(args)}.`,
    resourceNoun: "table",
    // A run is an event: its value decides until the next run.
    metricAggregationType: EvaluateOverTimeType.AnyValue,
    anomalyDetection: isLearned
      ? { sensitivity: AnomalyDetectionSensitivity.Medium }
      : undefined,
  });

  const healthy: MonitorCriteriaInstance = isLearned
    ? buildHealthyCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias: METRIC_ALIAS,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: Number.MIN_SAFE_INTEGER,
        recoveryValue: Number.MIN_SAFE_INTEGER,
        metricAggregationType: EvaluateOverTimeType.AllValues,
      })
    : buildHealthyCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias: METRIC_ALIAS,
        filterType: getRecoveryFilterType(filterType),
        value: threshold,
        recoveryValue: threshold,
        metricAggregationType: EvaluateOverTimeType.AllValues,
      });

  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = { monitorCriteriaInstanceArray: [unhealthy, healthy] };
  step.setMonitorCriteria(criteria);

  return step;
}
