import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useState,
} from "react";
import MetricView from "../../Components/Metrics/MetricView";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import Card from "Common/UI/Components/Card/Card";

export interface ComponentProps {
  queryConfigs: Array<MetricQueryConfigData>;
}

const KubernetesMetricsTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });

  const [metricViewData, setMetricViewData] = useState<MetricViewData>({
    startAndEndDate: RangeStartAndEndDateTimeUtil.getStartAndEndDate({
      range: TimeRange.PAST_ONE_HOUR,
    }),
    queryConfigs: [],
    formulaConfigs: [],
  });

  const handleTimeRangeChange: (
    newTimeRange: RangeStartAndEndDateTime,
  ) => void = useCallback(
    (newTimeRange: RangeStartAndEndDateTime): void => {
      setTimeRange(newTimeRange);
      const dateRange =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(newTimeRange);
      setMetricViewData((prev: MetricViewData) => {
        return {
          ...prev,
          startAndEndDate: dateRange,
        };
      });
    },
    [],
  );

  return (
    <Card
      title="Metrics"
      description="Resource utilization metrics for this pod."
      rightElement={
        <RangeStartAndEndDateView
          dashboardStartAndEndDate={timeRange}
          onChange={handleTimeRangeChange}
        />
      }
    >
      <MetricView
        data={{
          ...metricViewData,
          queryConfigs: props.queryConfigs,
        }}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        hideCardInCharts={true}
        onChange={(data: MetricViewData) => {
          setMetricViewData({
            ...data,
            queryConfigs: props.queryConfigs,
            formulaConfigs: [],
          });
        }}
      />
    </Card>
  );
};

export default KubernetesMetricsTab;
