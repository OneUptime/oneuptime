import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricView from "../../../../../../Components/Metrics/MetricVIew";
import PageComponentProps from "../../../../../PageComponentProps";
import Navigation from "CommonUI/src/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";

const MetricViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const metricName: string =
    Navigation.getQueryStringByName("metricName") || "";

  const serviceName: string =
    Navigation.getQueryStringByName("serviceName") || "";

  // set it to past 1 hour
  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -1);

  const startAndEndDate: InBetween = new InBetween(startDate, endDate);

  return (
    <MetricView
      data={{
        startAndEndDate: startAndEndDate,
        queryConfigs: [
          {
            metricAliasData: {
              metricVariable: "a",
              title: "",
              description: "",
            },
            metricQueryData: {
              filterData: {
                metricName: metricName,
                attributes: {
                  "oneuptime.telemetry.service.name": serviceName,
                },
                aggregateBy: MetricsAggregationType.Avg,
              },
            },
          },
        ],
        formulaConfigs: [],
      }}
    />
  );
};

export default MetricViewPage;
