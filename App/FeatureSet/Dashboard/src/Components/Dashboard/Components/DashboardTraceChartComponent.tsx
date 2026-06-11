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
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import DashboardTraceChartComponent from "Common/Types/Dashboard/DashboardComponents/DashboardTraceChartComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import API from "Common/UI/Utils/API/API";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import JSONFunctions from "Common/Types/JSONFunctions";
import DashboardResourceList from "../Utils/DashboardResourceList";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardTraceChartComponent;
}

interface TimeseriesRow {
  time: string;
  value: number;
  groupValues: Record<string, string>;
}

interface PivotedRow {
  time: string;
  [series: string]: number | string;
}

const CHART_COLORS: Array<string> = [
  "#6366f1",
  "#ec4899",
  "#10b981",
  "#f59e0b",
  "#06b6d4",
  "#8b5cf6",
  "#f43f5e",
  "#14b8a6",
  "#64748b",
  "#84cc16",
];

function isDurationMetric(metric: string): boolean {
  return metric !== "count" && metric !== "errorCount";
}

function formatDurationMs(ms: number): string {
  if (!isFinite(ms)) {
    return "-";
  }
  if (ms < 1) {
    return `${Math.round(ms * 1000)} µs`;
  }
  if (ms < 1000) {
    return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)} s`;
  }
  return `${(ms / 60000).toFixed(1)} min`;
}

function formatCount(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
  }
  return Math.round(value).toLocaleString();
}

function formatTickTime(time: string): string {
  const date: Date = OneUptimeDate.fromString(time);
  if (isNaN(date.getTime())) {
    return time;
  }
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function computeBucketSizeInMinutes(startTime: Date, endTime: Date): number {
  const diffMinutes: number =
    (endTime.getTime() - startTime.getTime()) / (1000 * 60);
  if (diffMinutes <= 60) {
    return 1;
  }
  if (diffMinutes <= 360) {
    return 5;
  }
  if (diffMinutes <= 1440) {
    return 15;
  }
  if (diffMinutes <= 10080) {
    return 60;
  }
  return 360;
}

// "key=value; key2=value2" → attribute filter record.
function parseAttributeFilters(
  raw: string | undefined,
): Record<string, string> {
  const filters: Record<string, string> = {};
  if (!raw) {
    return filters;
  }
  for (const pair of raw.split(";")) {
    const eqIndex: number = pair.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }
    const key: string = pair.substring(0, eqIndex).trim();
    const value: string = pair.substring(eqIndex + 1).trim();
    if (key && value) {
      filters[key] = value;
    }
  }
  return filters;
}

const DashboardTraceChartComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rows, setRows] = useState<Array<TimeseriesRow>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Staleness guard — see TracesAnalyticsView for rationale.
  const requestSequenceRef: React.MutableRefObject<number> = useRef<number>(0);

  const metric: string = props.component.arguments.metric || "count";
  const isDuration: boolean = isDurationMetric(metric);
  const groupByAttribute: string | undefined =
    props.component.arguments.groupByAttribute?.trim() || undefined;

  const fetchData: () => Promise<void> = useCallback(async () => {
    const requestSequence: number = ++requestSequenceRef.current;
    const isStale: () => boolean = (): boolean => {
      return requestSequence !== requestSequenceRef.current;
    };

    /*
     * The trace analytics endpoint requires an authenticated project
     * session — public dashboards have neither.
     */
    if (DashboardResourceList.isPublic()) {
      setIsLoading(false);
      setError("Trace charts are not available on public dashboards.");
      return;
    }

    setIsLoading(true);

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
      const requestData: JSONObject = {
        startTime: startAndEndDate.startValue.toISOString(),
        endTime: startAndEndDate.endValue.toISOString(),
        bucketSizeInMinutes: computeBucketSizeInMinutes(
          startAndEndDate.startValue,
          startAndEndDate.endValue,
        ),
        chartType: "timeseries",
        metric,
        /*
         * Dashboard form arguments are stored as strings — coerce so the
         * server-side numeric check doesn't silently fall back to 10.
         */
        limit: Number(props.component.arguments.topLimit) || 10,
        /*
         * Root spans only by default, matching the traces explorer the
         * user compares against.
         */
        rootOnly: !props.component.arguments.includeChildSpans,
      };

      const spanNameContains: string | undefined =
        props.component.arguments.spanNameContains?.trim() || undefined;
      if (spanNameContains) {
        requestData["spanNameSearches"] = [spanNameContains];
      }

      const attributes: Record<string, string> = parseAttributeFilters(
        props.component.arguments.attributeFilters,
      );
      if (Object.keys(attributes).length > 0) {
        requestData["attributes"] = attributes;
      }

      if (groupByAttribute) {
        requestData["groupBy"] = [groupByAttribute];
      }

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/telemetry/traces/analytics",
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
      const data: unknown = response.data["data"] || [];
      setRows(data as Array<TimeseriesRow>);
      setError(null);
    } catch (err: unknown) {
      if (isStale()) {
        return;
      }
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    if (!isStale()) {
      setIsLoading(false);
    }
  }, [
    props.dashboardStartAndEndDate,
    metric,
    groupByAttribute,
    props.component.arguments.spanNameContains,
    props.component.arguments.attributeFilters,
    props.component.arguments.topLimit,
    props.component.arguments.includeChildSpans,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData, props.refreshTick]);

  const { pivotedData, seriesKeys } = useMemo(() => {
    const map: Map<string, PivotedRow> = new Map();
    const seriesKeysSet: Set<string> = new Set();

    for (const row of rows) {
      let pivotRow: PivotedRow | undefined = map.get(row.time);
      if (!pivotRow) {
        pivotRow = { time: row.time };
        map.set(row.time, pivotRow);
      }
      const seriesKey: string =
        Object.values(row.groupValues || {}).join(" / ") || metric;
      seriesKeysSet.add(seriesKey);
      pivotRow[seriesKey] = row.value;
    }

    return {
      pivotedData: Array.from(map.values()),
      seriesKeys: Array.from(seriesKeysSet),
    };
  }, [rows, metric]);

  const valueFormatter: (value: number) => string = isDuration
    ? formatDurationMs
    : formatCount;

  const renderChart: () => ReactElement = (): ReactElement => {
    const sharedAxes: ReactElement = (
      <>
        <CartesianGrid
          strokeDasharray="none"
          stroke="#f1f5f9"
          vertical={false}
        />
        <XAxis
          dataKey="time"
          tickFormatter={formatTickTime}
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          axisLine={{ stroke: "#e2e8f0" }}
          tickLine={false}
          minTickGap={40}
          interval="preserveStartEnd"
          dy={4}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          axisLine={false}
          tickLine={false}
          width={56}
          allowDecimals={isDuration}
          tickFormatter={valueFormatter}
        />
        <Tooltip
          formatter={(value: unknown): string => {
            return valueFormatter(Number(value));
          }}
          labelFormatter={(label: unknown): string => {
            return formatTickTime(String(label ?? ""));
          }}
          contentStyle={{ fontSize: "11px" }}
        />
      </>
    );

    if (isDuration) {
      if (seriesKeys.length === 1) {
        return (
          <AreaChart
            data={pivotedData}
            margin={{ top: 6, right: 12, bottom: 2, left: 0 }}
          >
            {sharedAxes}
            <Area
              dataKey={seriesKeys[0] || "value"}
              stroke={CHART_COLORS[0]!}
              strokeWidth={2}
              fill="rgba(99,102,241,0.08)"
              dot={false}
              connectNulls={true}
              isAnimationActive={false}
            />
          </AreaChart>
        );
      }
      return (
        <LineChart
          data={pivotedData}
          margin={{ top: 6, right: 12, bottom: 2, left: 0 }}
        >
          {sharedAxes}
          {seriesKeys.map((key: string, index: number) => {
            return (
              <Line
                key={key}
                dataKey={key}
                stroke={CHART_COLORS[index % CHART_COLORS.length]!}
                strokeWidth={1.75}
                dot={false}
                connectNulls={true}
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      );
    }

    return (
      <BarChart
        data={pivotedData}
        margin={{ top: 6, right: 12, bottom: 2, left: 0 }}
        barCategoryGap="18%"
        barGap={0}
      >
        {sharedAxes}
        {seriesKeys.map((key: string, index: number) => {
          return (
            <Bar
              key={key}
              dataKey={key}
              stackId="group"
              fill={CHART_COLORS[index % CHART_COLORS.length]!}
              isAnimationActive={false}
              maxBarSize={28}
            />
          );
        })}
      </BarChart>
    );
  };

  return (
    <div className="flex h-full w-full flex-col">
      {props.component.arguments.title && (
        <div className="mb-1 px-1 text-sm font-medium text-gray-700">
          {props.component.arguments.title}
        </div>
      )}
      {seriesKeys.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-1 pb-1">
          {seriesKeys.map((key: string, index: number) => {
            return (
              <div key={key} className="flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-[2px]"
                  style={{
                    backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
                  }}
                />
                <span className="max-w-[180px] truncate text-[10px] text-gray-500">
                  {key}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {isLoading && (
          <div className="flex h-full items-center justify-center">
            <ComponentLoader />
          </div>
        )}
        {!isLoading && error && <ErrorMessage message={error} />}
        {!isLoading && !error && pivotedData.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-gray-400">
            No data for the selected time range
          </div>
        )}
        {!isLoading && !error && pivotedData.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            {renderChart()}
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

  return JSONFunctions.deepEqual(
    prev.component.arguments,
    next.component.arguments,
  );
}

export default React.memo(DashboardTraceChartComponentElement, arePropsEqual);
