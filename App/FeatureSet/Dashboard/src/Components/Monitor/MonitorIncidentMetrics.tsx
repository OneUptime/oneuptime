import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import Search from "Common/Types/BaseDatabase/Search";
import IncidentMetricType from "Common/Types/Incident/IncidentMetricType";
import IncidentMetricTypeUtil from "Common/Utils/Incident/IncidentMetricType";
import EmbeddedMetricCard from "../Metrics/EmbeddedMetricCard";
import ProjectUtil from "Common/UI/Utils/Project";
import MetricQueryConfigData, {
  MetricChartType,
} from "Common/Types/Metrics/MetricQueryConfigData";
import TimeRange from "Common/Types/Time/TimeRange";

export interface ComponentProps {
  monitorId: ObjectID;
}

const MonitorIncidentMetrics: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const incidentMetricTypes: Array<IncidentMetricType> =
    IncidentMetricTypeUtil.getAllIncidentMetricTypes();

  type GetQueryConfigsFunction = () => Array<MetricQueryConfigData>;

  const getQueryConfigs: GetQueryConfigsFunction =
    (): Array<MetricQueryConfigData> => {
      const queries: Array<MetricQueryConfigData> = [];

      for (const metricType of incidentMetricTypes) {
        queries.push({
          metricAliasData: {
            metricVariable: metricType,
            title:
              IncidentMetricTypeUtil.getTitleByIncidentMetricType(metricType),
            description:
              IncidentMetricTypeUtil.getDescriptionByIncidentMetricType(
                metricType,
              ),
            legend:
              IncidentMetricTypeUtil.getLegendByIncidentMetricType(metricType),
            legendUnit:
              IncidentMetricTypeUtil.getLegendUnitByIncidentMetricType(
                metricType,
              ),
          },
          metricQueryData: {
            filterData: {
              metricName: metricType,
              attributes: {
                monitorIds: new Search(props.monitorId.toString()),
                projectId: ProjectUtil.getCurrentProjectId()?.toString() || "",
              },
              aggegationType:
                IncidentMetricTypeUtil.getAggregationTypeByIncidentMetricType(
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
      title="Incident Metrics"
      description="Incident metrics for this monitor - count, time to acknowledge, time to resolve, and duration."
      queryConfigs={getQueryConfigs()}
      defaultTimeRange={{ range: TimeRange.PAST_ONE_DAY }}
    />
  );
};

export default MonitorIncidentMetrics;
