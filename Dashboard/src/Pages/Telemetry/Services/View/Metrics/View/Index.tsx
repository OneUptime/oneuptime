import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricView from "../../../../../../Components/Metrics/MetricVIew";
import PageComponentProps from "../../../../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "CommonUI/src/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const MetricViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const metricName: string =
    Navigation.getQueryStringByName("metricName") || "";
  const serviceId: ObjectID = Navigation.getLastParamAsObjectID(2);

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
                  "oneuptime.telemetry.service.id": serviceId,
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
