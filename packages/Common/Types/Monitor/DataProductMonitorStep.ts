import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import { EvaluateOverTimeType, FilterType } from "./CriteriaFilter";
import MonitorType from "./MonitorType";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import {
  DataProductAttribute,
  DataProductMetricName,
} from "../DataObservability/DataProductMetric";
import {
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
} from "./Recommendation/RecommendationCriteriaBuilder";

/*
 * THE MONITOR STEP OF A DATA PRODUCT'S SLA.
 *
 * A Metrics monitor over oneuptime.data.product.late_tables, filtered on
 * the product's id: Degraded as soon as one check finds a table late, and
 * Operational again once two checks in a row find none. The product is
 * checked every five minutes, so the ten-minute window holds two checks; a
 * window with no check (the check job paused) changes nothing. While late it
 * opens an incident as well as an alert, both resolving on their own: an
 * incident is what a status page tells its subscribers, so consumers who
 * subscribed to the product hear that it is late, and when it is fresh
 * again. It is raised at the project's least severe level (DataProductSync):
 * late data is not an outage.
 */

const METRIC_ALIAS: string = "late_tables";

export interface DataProductMonitorStepArgs {
  dataProductId: string;
  productName: string;
  monitorName: string;
  onlineMonitorStatusId: ObjectID;
  degradedMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
}

export function buildDataProductMonitorStep(
  args: DataProductMonitorStepArgs,
): MonitorStep {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: args.monitorName,
    monitorType: MonitorType.Metrics,
    onlineMonitorStatusId: args.onlineMonitorStatusId,
    offlineMonitorStatusId: args.degradedMonitorStatusId,
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
            title: `Late tables - ${args.productName}`,
            description: `How many of ${args.productName}'s tables are late by its SLA.`,
            legend: args.productName,
            legendUnit: "",
          },
          metricQueryData: {
            filterData: {
              metricName: DataProductMetricName.LateTables,
              attributes: {
                [DataProductAttribute.ProductId]: args.dataProductId,
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
    offlineMonitorStatusId: args.degradedMonitorStatusId,
    incidentSeverityId: args.defaultIncidentSeverityId,
    alertSeverityId: args.defaultAlertSeverityId,
    monitorName: args.monitorName,
    metricAlias: METRIC_ALIAS,
    filterType: FilterType.GreaterThan,
    value: 0,
    incidentTitle: `[Data] ${args.productName} is late`,
    incidentDescription: `A table of the data product ${args.productName} is late by its SLA. Its page in Data Observability lists which, and when each last changed.`,
    criteriaName: `${args.productName} is late`,
    criteriaDescription:
      "Triggers when a check finds any of the data product's tables late by its SLA.",
    resourceNoun: "data product",
    // A check is an event: one that finds a table late is enough.
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
