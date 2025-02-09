import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricView from "./MetricView";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricViewData from "Common/Types/Metrics/MetricViewData";

const MetricExplorer: FunctionComponent = (): ReactElement => {
  const metricName: string =
    Navigation.getQueryStringByName("metricName") || "";

  const serviceName: string =
    Navigation.getQueryStringByName("serviceName") || "";

  // set it to past 1 hour
  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -1);

  const startAndEndDate: InBetween<Date> = new InBetween(startDate, endDate);

  const [metricViewData, setMetricViewData] = React.useState<MetricViewData>({
    startAndEndDate: startAndEndDate,
    queryConfigs: [
      {
        metricAliasData: {
          metricVariable: "a",
          title: "",
          description: "",
          legend: "",
          legendUnit: "",
        },
        metricQueryData: {
          filterData: {
            metricName: metricName,
            attributes: serviceName
              ? {
                  "resource.oneuptime.telemetry.service.name": serviceName,
                }
              : {},
            aggegationType: MetricsAggregationType.Avg,
          },
        },
      },
    ],
    formulaConfigs: [],
  });

  return (
    <MetricView
      data={metricViewData}
      onChange={(data: MetricViewData) => {
        setMetricViewData(data);
      }}
    />
  );
};

export default MetricExplorer;
