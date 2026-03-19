import React, { FunctionComponent, ReactElement, useState } from "react";
import MetricView from "../../Components/Metrics/MetricView";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";

export interface ComponentProps {
  queryConfigs: Array<MetricQueryConfigData>;
}

const KubernetesMetricsTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -1);
  const startAndEndDate: InBetween<Date> = new InBetween(startDate, endDate);

  const [metricViewData, setMetricViewData] = useState<MetricViewData>({
    startAndEndDate: startAndEndDate,
    queryConfigs: [],
    formulaConfigs: [],
  });

  return (
    <MetricView
      data={{
        ...metricViewData,
        queryConfigs: props.queryConfigs,
      }}
      hideQueryElements={true}
      onChange={(data: MetricViewData) => {
        setMetricViewData({
          ...data,
          queryConfigs: props.queryConfigs,
          formulaConfigs: [],
        });
      }}
    />
  );
};

export default KubernetesMetricsTab;
