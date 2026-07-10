import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import DashboardLogChartComponent from "Common/Types/Dashboard/DashboardComponents/DashboardLogChartComponent";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import API from "Common/UI/Utils/API/API";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import JSONFunctions from "Common/Types/JSONFunctions";
import HistogramTooltip from "Common/UI/Components/LogsViewer/components/HistogramTooltip";
import {
  SeverityColor,
  getSeverityColor,
} from "Common/UI/Components/LogsViewer/components/severityColors";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import {
  LogHistogramBucket,
  LogChartTimeRange,
  buildLogHistogramRequest,
  formatLogChartTickTime,
  formatLogCount,
  pivotLogHistogramBuckets,
} from "./LogChartData";
import DashboardResourceList from "../Utils/DashboardResourceList";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardLogChartComponent;
}

const DashboardLogChartComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [buckets, setBuckets] = useState<Array<LogHistogramBucket>>([]);
  const [chartTimeRange, setChartTimeRange] =
    useState<LogChartTimeRange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const requestSequenceRef: React.MutableRefObject<number> = useRef<number>(0);

  const fetchData: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const requestSequence: number = ++requestSequenceRef.current;
      const isStale: () => boolean = (): boolean => {
        return requestSequence !== requestSequenceRef.current;
      };

      setIsLoading(true);

      if (DashboardResourceList.isPublic()) {
        setBuckets([]);
        setChartTimeRange(null);
        setIsLoading(false);
        setError("Log charts are not available on public dashboards.");
        return;
      }

      const startAndEndDate: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(
          props.dashboardStartAndEndDate,
        );

      if (!startAndEndDate.startValue || !startAndEndDate.endValue) {
        setIsLoading(false);
        setError("Please select a valid start and end date.");
        return;
      }

      try {
        const requestData: JSONObject = buildLogHistogramRequest({
          arguments: props.component.arguments,
          startTime: startAndEndDate.startValue,
          endTime: startAndEndDate.endValue,
          variables: props.variables,
        });

        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/logs/histogram",
            ),
            data: requestData,
            headers: {
              ...ModelAPI.getCommonHeaders(),
            },
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }
        if (isStale()) {
          return;
        }

        setBuckets(
          (response.data["buckets"] ||
            []) as unknown as Array<LogHistogramBucket>,
        );
        setChartTimeRange({
          startTime: startAndEndDate.startValue,
          endTime: startAndEndDate.endValue,
          bucketSizeInMinutes: Number(requestData["bucketSizeInMinutes"]),
        });
        setError(null);
      } catch (err: unknown) {
        if (isStale()) {
          return;
        }
        setBuckets([]);
        setChartTimeRange(null);
        setError(API.getFriendlyErrorMessage(err as Error));
      }

      if (!isStale()) {
        setIsLoading(false);
      }
    }, [
      props.dashboardStartAndEndDate,
      props.component.arguments.serviceIds,
      props.component.arguments.severityFilters,
      props.component.arguments.bodyContains,
      props.component.arguments.attributeFilterQuery,
      props.variables,
    ]);

  useEffect(() => {
    void fetchData();
  }, [fetchData, props.refreshTick]);

  const { pivotedData, severities } = useMemo(() => {
    return pivotLogHistogramBuckets(buckets, chartTimeRange || undefined);
  }, [buckets, chartTimeRange]);
  const includeDateInTicks: boolean = Boolean(
    chartTimeRange &&
      chartTimeRange.endTime.getTime() - chartTimeRange.startTime.getTime() >
        24 * 60 * 60 * 1000,
  );

  return (
    <div className="flex h-full w-full flex-col">
      {props.component.arguments.title && (
        <div className="mb-1 px-1 text-sm font-medium text-gray-700">
          {props.component.arguments.title}
        </div>
      )}

      {severities.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-1 pb-1">
          {severities.map((severity: string) => {
            const color: SeverityColor = getSeverityColor(severity);
            return (
              <div key={severity} className="flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-[2px]"
                  style={{ backgroundColor: color.fill }}
                />
                <span className="text-[10px] text-gray-500">
                  {color.label || severity}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {isLoading && buckets.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <ComponentLoader />
          </div>
        )}
        {!isLoading && error && <ErrorMessage message={error} />}
        {!isLoading && !error && pivotedData.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-gray-400">
            No logs for the selected time range and filters
          </div>
        )}
        {!error && pivotedData.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={pivotedData}
              margin={{ top: 6, right: 12, bottom: 2, left: 0 }}
              barCategoryGap="18%"
              barGap={0}
            >
              <CartesianGrid
                strokeDasharray="none"
                stroke="var(--ou-chart-grid, #f1f5f9)"
                vertical={false}
              />
              <XAxis
                dataKey="time"
                tickFormatter={(time: string): string => {
                  return formatLogChartTickTime(time, includeDateInTicks);
                }}
                tick={{ fontSize: 10, fill: "var(--ou-chart-tick, #94a3b8)" }}
                axisLine={{ stroke: "var(--ou-chart-grid, #e2e8f0)" }}
                tickLine={false}
                minTickGap={40}
                interval="preserveStartEnd"
                dy={4}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--ou-chart-tick, #94a3b8)" }}
                axisLine={false}
                tickLine={false}
                width={56}
                allowDecimals={false}
                tickFormatter={formatLogCount}
              />
              <Tooltip
                content={<HistogramTooltip />}
                cursor={{ fill: "rgba(99,102,241,0.04)" }}
              />
              {severities.map((severity: string, index: number) => {
                return (
                  <Bar
                    key={severity}
                    dataKey={severity}
                    stackId="severity"
                    fill={getSeverityColor(severity).fill}
                    radius={
                      index === severities.length - 1
                        ? [3, 3, 0, 0]
                        : [0, 0, 0, 0]
                    }
                    isAnimationActive={false}
                    maxBarSize={28}
                  />
                );
              })}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

function arePropsEqual(prev: ComponentProps, next: ComponentProps): boolean {
  if (
    prev.componentId.toString() !== next.componentId.toString() ||
    prev.refreshTick !== next.refreshTick ||
    prev.isEditMode !== next.isEditMode ||
    prev.isSelected !== next.isSelected ||
    prev.dashboardComponentWidthInPx !== next.dashboardComponentWidthInPx ||
    prev.dashboardComponentHeightInPx !== next.dashboardComponentHeightInPx
  ) {
    return false;
  }

  if (
    !JSONFunctions.deepEqual(
      prev.dashboardStartAndEndDate,
      next.dashboardStartAndEndDate,
    )
  ) {
    return false;
  }

  return (
    JSONFunctions.deepEqual(
      prev.component.arguments,
      next.component.arguments,
    ) && JSONFunctions.deepEqual(prev.variables, next.variables)
  );
}

export default React.memo(DashboardLogChartComponentElement, arePropsEqual);
