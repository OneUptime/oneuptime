import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorMetricTypeUtil from "Common/Utils/Monitor/MonitorMetricType";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricView from "../Metrics/MetricView";
import { MetricQueryConfigData } from "../Metrics/MetricQueryConfig";
import DashboardNavigation from "../../Utils/Navigation";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";

export interface ComponentProps {
  monitorId: ObjectID;
  monitorType: MonitorType;
}

const MonitorMetricsElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const monitorMetricTypesByMonitor: Array<MonitorMetricType> =
    MonitorMetricTypeUtil.getMonitorMetricTypesByMonitorType(props.monitorType);

  if (monitorMetricTypesByMonitor.length === 0) {
    return <></>;
  }

  // set it to past 1 hour
  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -1);

  const startAndEndDate: InBetween<Date> = new InBetween(startDate, endDate);


  type GetQueryConfigByMonitorMetricTypesFunction = () => Array<MetricQueryConfigData>;

  const getQueryConfigByMonitorMetricTypes: GetQueryConfigByMonitorMetricTypesFunction =
    (): Array<MetricQueryConfigData> => {
      const queries: Array<MetricQueryConfigData> = [];

      for (const monitorMetricType of monitorMetricTypesByMonitor) {
        queries.push({
          metricAliasData: {
            metricVariable: monitorMetricType,
            title:
              MonitorMetricTypeUtil.getTitleByMonitorMetricType(
                monitorMetricType,
              ),
            description:
              MonitorMetricTypeUtil.getDescriptionByMonitorMetricType(
                monitorMetricType,
              ),
          },
          metricQueryData: {
            filterData: {
              metricName: monitorMetricType,
              attributes: {
                monitorId: props.monitorId.toString(),
                projectId: DashboardNavigation.getProjectId()?.toString() || "",
              },
              aggegationType: AggregationType.Avg,
            },
          },
        });
      }

      return queries;
    };

  return (
    <div>
      <MetricView
        data={{
          startAndEndDate: startAndEndDate,
          queryConfigs: getQueryConfigByMonitorMetricTypes(),
          formulaConfigs: [],
        }}
      />
    </div>
  );
};

export default MonitorMetricsElement;
