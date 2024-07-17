import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricView from "../../../../../../Components/Metrics/MetricVIew";
import PageComponentProps from "../../../../../PageComponentProps";
import Navigation from "CommonUI/src/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const MetricViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const metricName: string =
    Navigation.getQueryStringByName("metricName") || "";

  const serviceName: string =
    Navigation.getQueryStringByName("serviceName") || "";

  return (
    <MetricView
      data={{
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
