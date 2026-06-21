import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useState,
} from "react";
import MetricView from "../Metrics/MetricView";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";

/*
 * Product-neutral metrics tab for infrastructure resource detail
 * pages: a time-range picker driving a MetricView over the supplied
 * query configs. Kubernetes re-exports it as KubernetesMetricsTab;
 * Proxmox and Ceph detail pages use it directly.
 */

export interface ComponentProps {
  queryConfigs: Array<MetricQueryConfigData>;
  /*
   * Optional extra charts rendered below the metric views, sharing this
   * tab's selected time range (e.g. a delta-based network throughput chart).
   */
  renderExtraCharts?:
    | ((dateRange: InBetween<Date>) => ReactElement)
    | undefined;
}

const ResourceMetricsTab: FunctionComponent<ComponentProps> = (
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
  ) => void = useCallback((newTimeRange: RangeStartAndEndDateTime): void => {
    setTimeRange(newTimeRange);
    const dateRange: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(newTimeRange);
    setMetricViewData((prev: MetricViewData) => {
      return {
        ...prev,
        startAndEndDate: dateRange,
      };
    });
  }, []);

  return (
    <div>
      <div className="flex items-center justify-end mb-4">
        <RangeStartAndEndDateView
          dashboardStartAndEndDate={timeRange}
          onChange={handleTimeRangeChange}
        />
      </div>
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
      {props.renderExtraCharts && metricViewData.startAndEndDate
        ? props.renderExtraCharts(metricViewData.startAndEndDate)
        : null}
    </div>
  );
};

export default ResourceMetricsTab;
