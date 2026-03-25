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
import RangeStartAndEndDateEdit from "Common/UI/Components/Date/RangeStartAndEndDateEdit";

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
      const dateRange = RangeStartAndEndDateTimeUtil.getStartAndEndDate(newTimeRange);
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
    <div>
      <div className="mb-4 flex items-center justify-end">
        <div className="w-64">
          <RangeStartAndEndDateEdit
            value={timeRange}
            onChange={handleTimeRangeChange}
          />
        </div>
      </div>
      <MetricView
        data={{
          ...metricViewData,
          queryConfigs: props.queryConfigs,
        }}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        onChange={(data: MetricViewData) => {
          setMetricViewData({
            ...data,
            queryConfigs: props.queryConfigs,
            formulaConfigs: [],
          });
        }}
      />
    </div>
  );
};

export default KubernetesMetricsTab;
