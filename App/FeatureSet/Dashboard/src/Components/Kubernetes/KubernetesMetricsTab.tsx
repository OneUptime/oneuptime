import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useState,
} from "react";
import MetricView from "../../Components/Metrics/MetricView";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";

interface TimeRangeOption {
  label: string;
  hours: number;
}

const TIME_RANGE_OPTIONS: Array<TimeRangeOption> = [
  { label: "Last 1 Hour", hours: 1 },
  { label: "Last 3 Hours", hours: 3 },
  { label: "Last 6 Hours", hours: 6 },
  { label: "Last 12 Hours", hours: 12 },
  { label: "Last 24 Hours", hours: 24 },
  { label: "Last 7 Days", hours: 168 },
];

export interface ComponentProps {
  queryConfigs: Array<MetricQueryConfigData>;
}

function getStartAndEndDate(hours: number): InBetween<Date> {
  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -hours);
  return new InBetween(startDate, endDate);
}

const KubernetesMetricsTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [selectedHours, setSelectedHours] = useState<number>(1);

  const [metricViewData, setMetricViewData] = useState<MetricViewData>({
    startAndEndDate: getStartAndEndDate(1),
    queryConfigs: [],
    formulaConfigs: [],
  });

  const handleTimeRangeChange: (
    e: React.ChangeEvent<HTMLSelectElement>,
  ) => void = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>): void => {
      const hours: number = parseInt(e.target.value, 10);
      setSelectedHours(hours);
      setMetricViewData((prev: MetricViewData) => {
        return {
          ...prev,
          startAndEndDate: getStartAndEndDate(hours),
        };
      });
    },
    [],
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-end">
        <select
          value={selectedHours}
          onChange={handleTimeRangeChange}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm transition-colors hover:border-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {TIME_RANGE_OPTIONS.map((option: TimeRangeOption) => {
            return (
              <option key={option.hours} value={option.hours}>
                {option.label}
              </option>
            );
          })}
        </select>
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
