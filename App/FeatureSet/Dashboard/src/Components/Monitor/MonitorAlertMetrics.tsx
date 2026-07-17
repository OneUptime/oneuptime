import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import AlertMetricType from "Common/Types/Alerts/AlertMetricType";
import AlertMetricTypeUtil from "Common/Utils/Alerts/AlertMetricType";
import EmbeddedMetricCard from "../Metrics/EmbeddedMetricCard";
import ProjectUtil from "Common/UI/Utils/Project";
import MetricQueryConfigData, {
  MetricChartType,
} from "Common/Types/Metrics/MetricQueryConfigData";
import TimeRange from "Common/Types/Time/TimeRange";

export interface ComponentProps {
  monitorId: ObjectID;
}

const MonitorAlertMetrics: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const alertMetricTypes: Array<AlertMetricType> =
    AlertMetricTypeUtil.getAllAlertMetricTypes();

  type GetQueryConfigsFunction = () => Array<MetricQueryConfigData>;

  const getQueryConfigs: GetQueryConfigsFunction =
    (): Array<MetricQueryConfigData> => {
      const queries: Array<MetricQueryConfigData> = [];

      for (const metricType of alertMetricTypes) {
        queries.push({
          metricAliasData: {
            metricVariable: metricType,
            title: AlertMetricTypeUtil.getTitleByAlertMetricType(metricType),
            description:
              AlertMetricTypeUtil.getDescriptionByAlertMetricType(metricType),
            legend: AlertMetricTypeUtil.getLegendByAlertMetricType(metricType),
            legendUnit:
              AlertMetricTypeUtil.getLegendUnitByAlertMetricType(metricType),
          },
          metricQueryData: {
            filterData: {
              metricName: metricType,
              attributes: {
                monitorId: props.monitorId.toString(),
                projectId: ProjectUtil.getCurrentProjectId()?.toString() || "",
              },
              aggegationType:
                AlertMetricTypeUtil.getAggregationTypeByAlertMetricType(
                  metricType,
                ),
            },
            groupBy: undefined,
          },
          chartType: MetricChartType.BAR,
        });
      }

      return queries;
    };

  return (
    <EmbeddedMetricCard
      title="Alert Metrics"
      description="Alert metrics for this monitor - count, time to acknowledge, time to resolve, and duration."
      queryConfigs={getQueryConfigs()}
      defaultTimeRange={{ range: TimeRange.PAST_ONE_DAY }}
    />
  );
};

export default MonitorAlertMetrics;
