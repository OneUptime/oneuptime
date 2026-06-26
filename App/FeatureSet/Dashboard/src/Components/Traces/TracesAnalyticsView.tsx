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
import API from "Common/UI/Utils/API/API";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import OneUptimeDate from "Common/Types/Date";

type AnalyticsChartType = "timeseries" | "toplist" | "table";

interface TimeseriesRow {
  time: string;
  value: number;
  groupValues: Record<string, string>;
}

interface TopItem {
  value: string;
  metricValue: number;
  count: number;
}

interface TableRow {
  groupValues: Record<string, string>;
  count: number;
  errorCount: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p90DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
}

export interface TraceAnalyticsState {
  metric: string;
  groupBy: Array<string>;
}

export interface TracesAnalyticsViewProps {
  /*
   * The shared aggregation filter payload from TracesViewer — the exact
   * object the histogram/facets requests use (startTime, endTime, rootOnly,
   * span name / attribute / service filters). Every explorer filter applies
   * to the analytics automatically.
   */
  baseFilters: JSONObject;
  attributeKeys: Array<string>;
  serviceNameMap: Record<string, string>;
  /*
   * When provided, renders a "Create metric…" action that hands the current
   * analysis (metric + group-by) to the caller — used to prefill a Trace
   * Recording Rule so the analysis persists as a queryable metric.
   */
  onCreateMetric?: ((state: TraceAnalyticsState) => void) | undefined;
  // Bump to force a refetch (toolbar Refresh button).
  refreshTick?: number | undefined;
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

const CHART_COLORS_MUTED: Array<string> = [
  "rgba(99,102,241,0.15)",
  "rgba(236,72,153,0.15)",
  "rgba(16,185,129,0.15)",
  "rgba(245,158,11,0.15)",
  "rgba(6,182,212,0.15)",
  "rgba(139,92,246,0.15)",
  "rgba(244,63,94,0.15)",
  "rgba(20,184,166,0.15)",
  "rgba(100,116,139,0.15)",
  "rgba(132,204,22,0.15)",
];

const METRIC_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "count", label: "Request Count" },
  { value: "errorCount", label: "Error Count" },
  { value: "avgDuration", label: "Avg Response Time" },
  { value: "p50Duration", label: "Median Response Time (P50)" },
  { value: "p90Duration", label: "P90 Response Time" },
  { value: "p95Duration", label: "P95 Response Time" },
  { value: "p99Duration", label: "P99 Response Time" },
  { value: "minDuration", label: "Min Response Time" },
  { value: "maxDuration", label: "Max Response Time" },
];

const DIMENSION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "name", label: "Span Name" },
  { value: "primaryEntityId", label: "Service" },
  { value: "statusCode", label: "Status" },
  { value: "kind", label: "Span Kind" },
];

const TOP_LIST_LIMITS: Array<number> = [5, 10, 25, 50, 100];

const STATUS_LABEL: Record<string, string> = {
  "0": "Unset",
  "1": "Ok",
  "2": "Error",
};

const KIND_LABEL: Record<string, string> = {
  SPAN_KIND_SERVER: "Server",
  SPAN_KIND_CLIENT: "Client",
  SPAN_KIND_PRODUCER: "Producer",
  SPAN_KIND_CONSUMER: "Consumer",
  SPAN_KIND_INTERNAL: "Internal",
};

function isDurationMetric(metric: string): boolean {
  return metric !== "count" && metric !== "errorCount";
}

export function formatDurationMs(ms: number): string {
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

function computeDefaultBucketSize(startTime: Date, endTime: Date): number {
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
  if (diffMinutes <= 43200) {
    return 360;
  }
  return 1440;
}

interface PivotedRow {
  time: string;
  [series: string]: number | string;
}

interface AnalyticsTooltipProps {
  active?: boolean;
  label?: string;
  payload?: Array<{ dataKey: string; value: number; color?: string }>;
  isDuration: boolean;
}

const AnalyticsTooltip: FunctionComponent<AnalyticsTooltipProps> = (
  props: AnalyticsTooltipProps,
): ReactElement | null => {
  if (!props.active || !props.payload || props.payload.length === 0) {
    return null;
  }

  const formatLabel: (label: string | undefined) => string = (
    label: string | undefined,
  ): string => {
    if (!label) {
      return "";
    }
    const date: Date = OneUptimeDate.fromString(label);
    if (isNaN(date.getTime())) {
      return label;
    }
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  return (
    <div className="rounded-lg border border-gray-200/80 bg-white/95 px-3.5 py-2.5 shadow-lg backdrop-blur-sm">
      <p className="mb-2 border-b border-gray-100 pb-2 font-mono text-[11px] font-medium text-gray-400">
        {formatLabel(props.label)}
      </p>
      <div className="space-y-1">
        {props.payload.map(
          (entry: { dataKey: string; value: number; color?: string }) => {
            return (
              <div
                key={entry.dataKey}
                className="flex items-center justify-between gap-8"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-[3px]"
                    style={{ backgroundColor: entry.color || "#cbd5e1" }}
                  />
                  <span className="max-w-[260px] truncate text-xs text-gray-600">
                    {entry.dataKey}
                  </span>
                </div>
                <span className="font-mono text-xs font-semibold tabular-nums text-gray-800">
                  {props.isDuration
                    ? formatDurationMs(entry.value)
                    : entry.value.toLocaleString()}
                </span>
              </div>
            );
          },
        )}
      </div>
    </div>
  );
};

const TracesAnalyticsView: FunctionComponent<TracesAnalyticsViewProps> = (
  props: TracesAnalyticsViewProps,
): ReactElement => {
  const [chartType, setChartType] = useState<AnalyticsChartType>("timeseries");
  const [metric, setMetric] = useState<string>("count");
  const [groupByFields, setGroupByFields] = useState<Array<string>>(["name"]);
  const [limit, setLimit] = useState<number>(10);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [timeseriesData, setTimeseriesData] = useState<Array<TimeseriesRow>>(
    [],
  );
  const [topListData, setTopListData] = useState<Array<TopItem>>([]);
  const [tableData, setTableData] = useState<Array<TableRow>>([]);

  /*
   * Staleness guard: these aggregations can run for many seconds under
   * load; without a sequence check, an older slow response would clobber
   * the result of a newer query after the user changed the controls.
   */
  const requestSequenceRef: React.MutableRefObject<number> = useRef<number>(0);

  const isDuration: boolean = isDurationMetric(metric);

  const allDimensionOptions: Array<{ value: string; label: string }> =
    useMemo(() => {
      const attributeOptions: Array<{ value: string; label: string }> =
        props.attributeKeys
          .filter((attr: string) => {
            return !DIMENSION_OPTIONS.some((opt: { value: string }) => {
              return opt.value === attr;
            });
          })
          .map((attr: string) => {
            return { value: attr, label: attr };
          });

      return [...DIMENSION_OPTIONS, ...attributeOptions];
    }, [props.attributeKeys]);

  const displayGroupValue: (key: string, raw: string) => string = useCallback(
    (key: string, raw: string): string => {
      if (!raw) {
        return "(empty)";
      }
      if (key === "primaryEntityId") {
        return props.serviceNameMap[raw] || raw;
      }
      if (key === "statusCode") {
        return STATUS_LABEL[raw] || raw;
      }
      if (key === "kind") {
        return KIND_LABEL[raw] || raw;
      }
      return raw;
    },
    [props.serviceNameMap],
  );

  const fetchAnalytics: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const requestSequence: number = ++requestSequenceRef.current;
      const isStale: () => boolean = (): boolean => {
        return requestSequence !== requestSequenceRef.current;
      };
      try {
        setIsLoading(true);
        setError("");

        const startTime: Date = props.baseFilters["startTime"]
          ? OneUptimeDate.fromString(props.baseFilters["startTime"] as string)
          : OneUptimeDate.addRemoveHours(OneUptimeDate.getCurrentDate(), -1);
        const endTime: Date = props.baseFilters["endTime"]
          ? OneUptimeDate.fromString(props.baseFilters["endTime"] as string)
          : OneUptimeDate.getCurrentDate();

        const groupBy: Array<string> = groupByFields.filter((f: string) => {
          return f.length > 0;
        });

        const requestData: JSONObject = {
          ...props.baseFilters,
          chartType,
          metric,
          bucketSizeInMinutes: computeDefaultBucketSize(startTime, endTime),
          limit,
        };

        if (groupBy.length > 0) {
          requestData["groupBy"] = groupBy;
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

        if (chartType === "timeseries") {
          setTimeseriesData(data as Array<TimeseriesRow>);
        } else if (chartType === "toplist") {
          setTopListData(data as Array<TopItem>);
        } else {
          setTableData(data as Array<TableRow>);
        }
      } catch (err) {
        if (isStale()) {
          return;
        }
        setTimeseriesData([]);
        setTopListData([]);
        setTableData([]);
        setError(API.getFriendlyMessage(err));
      } finally {
        if (!isStale()) {
          setIsLoading(false);
        }
      }
    }, [
      chartType,
      metric,
      groupByFields,
      limit,
      props.baseFilters,
      props.refreshTick,
    ]);

  useEffect(() => {
    void fetchAnalytics();
  }, [fetchAnalytics]);

  const { pivotedData, seriesKeys } = useMemo(() => {
    const map: Map<string, PivotedRow> = new Map();
    const seriesKeysSet: Set<string> = new Set();
    const metricLabel: string =
      METRIC_OPTIONS.find((opt: { value: string }) => {
        return opt.value === metric;
      })?.label || metric;

    for (const row of timeseriesData) {
      let pivotRow: PivotedRow | undefined = map.get(row.time);
      if (!pivotRow) {
        pivotRow = { time: row.time };
        map.set(row.time, pivotRow);
      }

      const groupEntries: Array<[string, string]> = Object.entries(
        row.groupValues,
      );
      const seriesKey: string =
        groupEntries.length > 0
          ? groupEntries
              .map(([key, value]: [string, string]): string => {
                return displayGroupValue(key, value);
              })
              .join(" / ")
          : metricLabel;

      seriesKeysSet.add(seriesKey);
      pivotRow[seriesKey] = row.value;
    }

    return {
      pivotedData: Array.from(map.values()),
      seriesKeys: Array.from(seriesKeysSet),
    };
  }, [timeseriesData, metric, displayGroupValue]);

  const renderSelectControl: (
    label: string,
    value: string | number,
    onChange: (val: string) => void,
    options: Array<{ value: string | number; label: string }>,
  ) => ReactElement = (
    label: string,
    value: string | number,
    onChange: (val: string) => void,
    options: Array<{ value: string | number; label: string }>,
  ): ReactElement => {
    return (
      <div className="flex items-center">
        <span className="mr-2 text-[11px] font-medium uppercase tracking-wider text-gray-400">
          {label}
        </span>
        <select
          className="appearance-none rounded-md border border-gray-200 bg-white px-2.5 py-1.5 pr-7 text-xs font-medium text-gray-700 shadow-sm transition-all hover:border-gray-300 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          value={value}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            onChange(e.target.value);
          }}
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 6px center",
          }}
        >
          {options.map((opt: { value: string | number; label: string }) => {
            return (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            );
          })}
        </select>
      </div>
    );
  };

  const renderQueryBuilder: () => ReactElement = (): ReactElement => {
    return (
      <div className="flex flex-wrap items-center gap-4 border-b border-gray-100 px-5 py-3">
        {renderSelectControl(
          "Chart",
          chartType,
          (val: string) => {
            setChartType(val as AnalyticsChartType);
            // Top list / table need a dimension — default to span name.
            if (val !== "timeseries" && !groupByFields[0]) {
              setGroupByFields(["name"]);
            }
          },
          [
            { value: "timeseries", label: "Timeseries" },
            { value: "toplist", label: "Top List" },
            { value: "table", label: "Table" },
          ],
        )}

        <div className="h-4 w-px bg-gray-200" />

        {renderSelectControl(
          "Measure",
          metric,
          (val: string) => {
            setMetric(val);
          },
          METRIC_OPTIONS,
        )}

        <div className="h-4 w-px bg-gray-200" />

        {renderSelectControl(
          "Split by",
          groupByFields[0] || "",
          (val: string) => {
            setGroupByFields((prev: Array<string>) => {
              const next: Array<string> = [...prev];
              next[0] = val;
              return next.filter((f: string) => {
                return f.length > 0;
              });
            });
          },
          chartType === "timeseries"
            ? [{ value: "", label: "None" }, ...allDimensionOptions]
            : allDimensionOptions,
        )}

        {groupByFields[0] &&
          groupByFields[0].length > 0 &&
          chartType !== "toplist" &&
          renderSelectControl(
            "then by",
            groupByFields[1] || "",
            (val: string) => {
              setGroupByFields((prev: Array<string>) => {
                const next: Array<string> = [prev[0] || ""];
                if (val.length > 0) {
                  next.push(val);
                }
                return next.filter((f: string) => {
                  return f.length > 0;
                });
              });
            },
            [
              { value: "", label: "None" },
              ...allDimensionOptions.filter((opt: { value: string }) => {
                return opt.value !== groupByFields[0];
              }),
            ],
          )}

        <div className="h-4 w-px bg-gray-200" />

        {renderSelectControl(
          "Top",
          limit,
          (val: string) => {
            setLimit(Number(val));
          },
          TOP_LIST_LIMITS.map((value: number) => {
            return { value, label: String(value) };
          }),
        )}

        {props.onCreateMetric && (
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 shadow-sm transition-colors hover:border-indigo-300 hover:bg-indigo-100"
            onClick={() => {
              props.onCreateMetric?.({
                metric,
                groupBy: groupByFields.filter((f: string) => {
                  return f.length > 0;
                }),
              });
            }}
            title="Persist this analysis as a metric via a Trace Recording Rule"
          >
            Create metric…
          </button>
        )}
      </div>
    );
  };

  const renderLegend: () => ReactElement = (): ReactElement => {
    if (seriesKeys.length <= 1) {
      return <></>;
    }

    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pb-2">
        {seriesKeys.map((key: string, index: number) => {
          return (
            <div key={key} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-[3px]"
                style={{
                  backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
                }}
              />
              <span className="max-w-[280px] truncate text-[11px] text-gray-500">
                {key}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  const yAxisFormatter: (value: number) => string = isDuration
    ? formatDurationMs
    : formatCount;

  const renderTimeseries: () => ReactElement = (): ReactElement => {
    if (pivotedData.length === 0) {
      return renderEmptyState();
    }

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
          tick={{ fontSize: 11, fill: "#94a3b8" }}
          axisLine={{ stroke: "#e2e8f0" }}
          tickLine={false}
          minTickGap={50}
          interval="preserveStartEnd"
          dy={8}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#94a3b8" }}
          axisLine={false}
          tickLine={false}
          width={64}
          allowDecimals={isDuration}
          tickFormatter={yAxisFormatter}
        />
        <Tooltip
          content={<AnalyticsTooltip isDuration={isDuration} />}
          cursor={
            isDuration
              ? { stroke: "#c7d2fe", strokeWidth: 1, strokeDasharray: "4 4" }
              : { fill: "rgba(99,102,241,0.04)" }
          }
        />
      </>
    );

    return (
      <div className="px-2 pb-2 pt-4">
        {renderLegend()}
        <div style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            {isDuration ? (
              seriesKeys.length === 1 ? (
                <AreaChart
                  data={pivotedData}
                  margin={{ top: 8, right: 20, bottom: 4, left: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="traceAnalyticsArea"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor={CHART_COLORS[0]}
                        stopOpacity={0.2}
                      />
                      <stop
                        offset="95%"
                        stopColor={CHART_COLORS[0]}
                        stopOpacity={0.02}
                      />
                    </linearGradient>
                  </defs>
                  {sharedAxes}
                  <Area
                    dataKey={seriesKeys[0] || "value"}
                    stroke={CHART_COLORS[0]!}
                    strokeWidth={2}
                    fill="url(#traceAnalyticsArea)"
                    dot={false}
                    connectNulls={true}
                    isAnimationActive={false}
                  />
                </AreaChart>
              ) : (
                /*
                 * Duration series are never stacked — stacking percentiles
                 * across dimension values is meaningless. One line each.
                 */
                <LineChart
                  data={pivotedData}
                  margin={{ top: 8, right: 20, bottom: 4, left: 0 }}
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
              )
            ) : (
              <BarChart
                data={pivotedData}
                margin={{ top: 8, right: 20, bottom: 4, left: 0 }}
                barCategoryGap="20%"
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
                      radius={
                        index === seriesKeys.length - 1
                          ? [3, 3, 0, 0]
                          : [0, 0, 0, 0]
                      }
                      isAnimationActive={false}
                      maxBarSize={40}
                    />
                  );
                })}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  const renderTopList: () => ReactElement = (): ReactElement => {
    if (topListData.length === 0) {
      return renderEmptyState();
    }

    const groupByKey: string = groupByFields[0] || "";
    const maxValue: number = Math.max(
      ...topListData.map((item: TopItem) => {
        return item.metricValue;
      }),
      1,
    );

    return (
      <div className="p-5">
        <div className="space-y-1.5">
          {topListData.map((item: TopItem, index: number) => {
            const percentage: number = (item.metricValue / maxValue) * 100;
            const color: string =
              CHART_COLORS[index % CHART_COLORS.length] || CHART_COLORS[0]!;
            const mutedColor: string =
              CHART_COLORS_MUTED[index % CHART_COLORS_MUTED.length] ||
              CHART_COLORS_MUTED[0]!;

            return (
              <div
                key={index}
                className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-gray-50/80"
              >
                <span className="w-5 text-right font-mono text-[11px] font-medium text-gray-300">
                  {index + 1}
                </span>
                <div
                  className="h-2 w-2 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <div className="w-56 min-w-0 truncate text-sm font-medium text-gray-700">
                  {displayGroupValue(groupByKey, item.value)}
                </div>
                <div className="flex-1">
                  <div className="relative h-7 w-full overflow-hidden rounded-md bg-gray-50">
                    <div
                      className="absolute left-0 top-0 h-full rounded-md transition-all duration-300"
                      style={{
                        width: `${percentage}%`,
                        backgroundColor: mutedColor,
                        borderLeft: `3px solid ${color}`,
                      }}
                    />
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-3">
                  <span className="font-mono text-sm font-semibold tabular-nums text-gray-800">
                    {isDuration
                      ? formatDurationMs(item.metricValue)
                      : item.metricValue.toLocaleString()}
                  </span>
                  {isDuration && (
                    <span className="w-20 text-right font-mono text-[11px] tabular-nums text-gray-400">
                      {item.count.toLocaleString()} req
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderTable: () => ReactElement = (): ReactElement => {
    if (tableData.length === 0) {
      return renderEmptyState();
    }

    const groupKeys: Array<string> = Object.keys(
      tableData[0]?.groupValues || {},
    );

    const dimensionLabel: (key: string) => string = (key: string): string => {
      return (
        allDimensionOptions.find((opt: { value: string }) => {
          return opt.value === key;
        })?.label || key
      );
    };

    const headerCell: string =
      "px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400";

    return (
      <div className="p-5">
        <div className="overflow-x-auto rounded-lg border border-gray-200/80">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-200/80 bg-gray-50/80">
                <th className={`w-10 text-left ${headerCell}`}>#</th>
                {groupKeys.map((key: string) => {
                  return (
                    <th key={key} className={`text-left ${headerCell}`}>
                      {dimensionLabel(key)}
                    </th>
                  );
                })}
                <th className={`text-right ${headerCell}`}>Requests</th>
                <th className={`text-right ${headerCell}`}>Errors</th>
                <th className={`text-right ${headerCell}`}>Avg</th>
                <th className={`text-right ${headerCell}`}>P50</th>
                <th className={`text-right ${headerCell}`}>P90</th>
                <th className={`text-right ${headerCell}`}>P95</th>
                <th className={`text-right ${headerCell}`}>P99</th>
                <th className={`text-right ${headerCell}`}>Min</th>
                <th className={`text-right ${headerCell}`}>Max</th>
              </tr>
            </thead>
            <tbody>
              {tableData.map((row: TableRow, index: number) => {
                return (
                  <tr
                    key={index}
                    className="border-b border-gray-100/80 transition-colors last:border-b-0 hover:bg-gray-50/50"
                  >
                    <td className="px-4 py-2.5 font-mono text-[11px] text-gray-300">
                      {index + 1}
                    </td>
                    {groupKeys.map((key: string) => {
                      return (
                        <td
                          key={key}
                          className="max-w-[320px] truncate whitespace-nowrap px-4 py-2.5 text-sm text-gray-700"
                        >
                          {displayGroupValue(key, row.groupValues[key] || "")}
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-sm font-semibold tabular-nums text-gray-800">
                      {row.count.toLocaleString()}
                    </td>
                    <td
                      className={`whitespace-nowrap px-4 py-2.5 text-right font-mono text-sm tabular-nums ${
                        row.errorCount > 0
                          ? "font-semibold text-red-600"
                          : "text-gray-400"
                      }`}
                    >
                      {row.errorCount.toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-sm tabular-nums text-gray-700">
                      {formatDurationMs(row.avgDurationMs)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-sm tabular-nums text-gray-700">
                      {formatDurationMs(row.p50DurationMs)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-sm tabular-nums text-gray-700">
                      {formatDurationMs(row.p90DurationMs)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-sm tabular-nums text-gray-700">
                      {formatDurationMs(row.p95DurationMs)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-sm tabular-nums text-gray-700">
                      {formatDurationMs(row.p99DurationMs)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-xs tabular-nums text-gray-500">
                      {formatDurationMs(row.minDurationMs)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-xs tabular-nums text-gray-500">
                      {formatDurationMs(row.maxDurationMs)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderEmptyState: () => ReactElement = (): ReactElement => {
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-3">
        <svg
          className="h-10 w-10 text-gray-200"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
          />
        </svg>
        <p className="text-sm text-gray-400">
          {error || "No data available for the selected query"}
        </p>
      </div>
    );
  };

  const renderChart: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return (
        <div className="flex h-72 items-center justify-center">
          <ComponentLoader />
        </div>
      );
    }

    if (chartType === "timeseries") {
      return renderTimeseries();
    }

    if (chartType === "toplist") {
      return renderTopList();
    }

    return renderTable();
  };

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200/80 bg-white shadow-sm">
      {renderQueryBuilder()}
      {renderChart()}
    </div>
  );
};

export default TracesAnalyticsView;
