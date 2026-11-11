import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import { EvaluateOverTimeType, FilterType } from "./CriteriaFilter";
import MonitorType from "./MonitorType";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import {
  DataBiAttribute,
  DataBiMetricName,
} from "../DataObservability/DataBiRefreshAlert";
import {
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
} from "./Recommendation/RecommendationCriteriaBuilder";

/*
 * THE MONITOR STEP OF A POWER BI TOOL'S FAILED REFRESHES.
 *
 * A Metrics monitor over oneuptime.data.bi.refresh_failed, filtered on the
 * tool's id and grouped by dataset and workspace: one monitor watches every
 * dataset of the tool - one published next week too - and opens one alert
 * per dataset whose refresh failed, named in the alert's title. Each dataset
 * is checked every five minutes (DataBiRefreshCheck), so the ten-minute
 * window holds two checks: the alert opens at the first check that finds
 * the dataset failing, stays open while it fails - however many hourly
 * reads find it so - and resolves once the checks find a later refresh
 * completed.
 */

const METRIC_ALIAS: string = "refresh_failed";

// One series, and one alert, per dataset: its name and its workspace's, as the title names them.
export const DATA_BI_REFRESH_GROUP_BY_ATTRIBUTES: ReadonlyArray<string> = [
  DataBiAttribute.DatasetName,
  DataBiAttribute.Workspace,
];

export interface DataBiRefreshMonitorStepArgs {
  dataBiConnectionId: string;
  toolName: string;
  monitorName: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
}

export function buildDataBiRefreshMonitorStep(
  args: DataBiRefreshMonitorStepArgs,
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
    rollingTime: RollingTime.Past10Minutes,
    metricViewConfig: {
      queryConfigs: [
        {
          metricAliasData: {
            metricVariable: METRIC_ALIAS,
            title: `Failed refreshes - ${args.toolName}`,
            description: `The datasets of ${args.toolName} whose last refresh failed.`,
            legend: args.toolName,
            legendUnit: "",
          },
          metricQueryData: {
            filterData: {
              metricName: DataBiMetricName.RefreshFailed,
              attributes: {
                [DataBiAttribute.ConnectionId]: args.dataBiConnectionId,
              },
              aggegationType: MetricsAggregationType.Max,
              aggregateBy: {},
            },
            groupByAttributeKeys: [...DATA_BI_REFRESH_GROUP_BY_ATTRIBUTES],
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
    incidentTitle: `[Data] Power BI Refresh Failed - ${args.toolName}`,
    incidentDescription: `The last refresh of a dataset of ${args.toolName} failed or was cancelled, so the reports and dashboards built on it show the data of its last completed refresh. BI Dashboards in Data Observability shows the refresh's error. This resolves once a later refresh completes.`,
    criteriaName: "A dataset's refresh failed",
    criteriaDescription:
      "Triggers when a check finds a dataset whose last refresh failed or was cancelled.",
    resourceNoun: "dataset",
    // A check is an event: one that finds the dataset failing is enough.
    metricAggregationType: EvaluateOverTimeType.AnyValue,
  });

  /*
   * An alert, not an incident: as a pipeline's monitors are made by default
   * (MonitorRecommendationCreateSideOver), it tells the team without
   * publishing to a status page. The incident stays configured, inert, one
   * switch away on the monitor.
   */
  unhealthy.data!.createIncidents = false;

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
