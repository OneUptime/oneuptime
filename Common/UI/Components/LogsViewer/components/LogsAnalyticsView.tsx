import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  AreaChart,
  Area,
} from "recharts";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "../../../../Types/Time/RangeStartAndEndDateTime";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import API from "../../../Utils/API/API";
import URL from "../../../../Types/API/URL";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../../Types/JSON";
import { APP_API_URL } from "../../../Config";
import ModelAPI from "../../../Utils/ModelAPI/ModelAPI";
import ComponentLoader from "../../ComponentLoader/ComponentLoader";
import OneUptimeDate from "../../../../Types/Date";

type AnalyticsChartType = "timeseries" | "toplist" | "table";
type AnalyticsAggregation = "count" | "unique";

interface AnalyticsTimeseriesRow {
  time: string;
  count: number;
  groupValues: Record<string, string>;
}

interface AnalyticsTopItem {
  value: string;
  count: number;
}

interface AnalyticsTableRow {
  groupValues: Record<string, string>;
  count: number;
}

export interface LogsAnalyticsViewProps {
  timeRange: RangeStartAndEndDateTime;
  serviceIds?: Array<string> | undefined;
  appliedFacetFilters: Map<string, Set<string>>;
  logAttributes: Array<string>;
}

const CHART_COLORS: Array<string> = [
  "#6366f1", // indigo
  "#ec4899", // pink
  "#10b981", // emerald
  "#f59e0b", // amber
  "#06b6d4", // cyan
  "#8b5cf6", // violet
  "#f43f5e", // rose
  "#14b8a6", // teal
  "#64748b", // slate
  "#84cc16", // lime
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

const DIMENSION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "severityText", label: "Severity" },
  { value: "serviceId", label: "Service" },
  { value: "traceId", label: "Trace ID" },
  { value: "spanId", label: "Span ID" },
];

const TOP_LIST_LIMITS: Array<number> = [5, 10, 25, 50];

interface PivotedTimeseriesRow {
  time: string;
  [key: string]: number | string;
}

function pivotTimeseriesData(rows: Array<AnalyticsTimeseriesRow>): {
  pivotedData: Array<PivotedTimeseriesRow>;
  seriesKeys: Array<string>;
} {
  const map: Map<string, PivotedTimeseriesRow> = new Map();
  const seriesKeysSet: Set<string> = new Set();

  for (const row of rows) {
    let pivotRow: PivotedTimeseriesRow | undefined = map.get(row.time);

    if (!pivotRow) {
      pivotRow = { time: row.time };
      map.set(row.time, pivotRow);
    }

    const groupKey: string =
      Object.values(row.groupValues).join(" / ") || "count";
    seriesKeysSet.add(groupKey);
    pivotRow[groupKey] = ((pivotRow[groupKey] as number) || 0) + row.count;
  }

  return {
    pivotedData: Array.from(map.values()),
    seriesKeys: Array.from(seriesKeysSet),
  };
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

function formatYAxisTick(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
  }

  return value.toString();
}

function computeDefaultBucketSize(startTime: Date, endTime: Date): number {
  const diffMs: number = endTime.getTime() - startTime.getTime();
  const diffMinutes: number = diffMs / (1000 * 60);

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

interface AnalyticsTooltipProps {
  active?: boolean;
  label?: string;
  payload?: Array<{
    dataKey: string;
    value: number;
    color: string;
  }>;
}

const AnalyticsTooltip: FunctionComponent<AnalyticsTooltipProps> = (
  props: AnalyticsTooltipProps,
): ReactElement | null => {
  if (!props.active || !props.payload || props.payload.length === 0) {
    return null;
  }

  const entries: Array<{ key: string; value: number; color: string }> =
    props.payload
      .filter((entry: { value: number }): boolean => {
        return entry.value > 0;
      })
      .map(
        (entry: {
          dataKey: string;
          value: number;
          color: string;
        }): { key: string; value: number; color: string } => {
          return {
            key: entry.dataKey,
            value: entry.value,
            color: entry.color,
          };
        },
      );

  if (entries.length === 0) {
    return null;
  }

  const total: number = entries.reduce(
    (sum: number, e: { value: number }): number => {
      return sum + e.value;
    },
    0,
  );

  const formatTime: (label: string | undefined) => string = (
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
        {formatTime(props.label)}
      </p>
      <div className="space-y-1">
        {entries.map((entry: { key: string; value: number; color: string }) => {
          return (
            <div
              key={entry.key}
              className="flex items-center justify-between gap-8"
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-[3px]"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="text-xs text-gray-600">{entry.key}</span>
              </div>
              <span className="font-mono text-xs font-semibold tabular-nums text-gray-800">
                {entry.value.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
      {entries.length > 1 && (
        <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
          <span className="text-[11px] font-medium text-gray-400">Total</span>
          <span className="font-mono text-xs font-bold tabular-nums text-gray-900">
            {total.toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );
};

const LogsAnalyticsView: FunctionComponent<LogsAnalyticsViewProps> = (
  props: LogsAnalyticsViewProps,
): ReactElement => {
  const [chartType, setChartType] = useState<AnalyticsChartType>("timeseries");
  const [aggregation, setAggregation] = useState<AnalyticsAggregation>("count");
  const [aggregationField, setAggregationField] = useState<string>("");
  const [groupByFields, setGroupByFields] = useState<Array<string>>([
    "severityText",
  ]);
  const [topListLimit, setTopListLimit] = useState<number>(10);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [timeseriesData, setTimeseriesData] = useState<
    Array<AnalyticsTimeseriesRow>
  >([]);
  const [topListData, setTopListData] = useState<Array<AnalyticsTopItem>>([]);
  const [tableData, setTableData] = useState<Array<AnalyticsTableRow>>([]);

  const allDimensionOptions: Array<{ value: string; label: string }> =
    useMemo(() => {
      const attributeOptions: Array<{ value: string; label: string }> =
        props.logAttributes
          .filter((attr: string) => {
            return !DIMENSION_OPTIONS.some((opt: { value: string }) => {
              return opt.value === attr;
            });
          })
          .map((attr: string) => {
            return { value: attr, label: attr };
          });

      return [...DIMENSION_OPTIONS, ...attributeOptions];
    }, [props.logAttributes]);

  const fetchAnalytics: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      try {
        setIsLoading(true);

        const dateRange: InBetween<Date> =
          RangeStartAndEndDateTimeUtil.getStartAndEndDate(props.timeRange);

        const startTime: Date = dateRange.startValue;
        const endTime: Date = dateRange.endValue;

        const requestData: JSONObject = {
          chartType,
          aggregation,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          bucketSizeInMinutes: computeDefaultBucketSize(startTime, endTime),
        } as JSONObject;

        if (
          groupByFields.length > 0 &&
          groupByFields[0] &&
          groupByFields[0].length > 0
        ) {
          (requestData as Record<string, unknown>)["groupBy"] =
            groupByFields.filter((f: string) => {
              return f.length > 0;
            });
        }

        if (aggregation === "unique" && aggregationField) {
          (requestData as Record<string, unknown>)["aggregationField"] =
            aggregationField;
        }

        if (chartType === "toplist" || chartType === "table") {
          (requestData as Record<string, unknown>)["limit"] = topListLimit;
        }

        if (props.serviceIds) {
          (requestData as Record<string, unknown>)["serviceIds"] =
            props.serviceIds;
        }

        // Apply facet filters
        const severityValues: Set<string> | undefined =
          props.appliedFacetFilters.get("severityText");

        if (severityValues && severityValues.size > 0) {
          (requestData as Record<string, unknown>)["severityTexts"] =
            Array.from(severityValues);
        }

        const serviceFilterValues: Set<string> | undefined =
          props.appliedFacetFilters.get("serviceId");

        if (serviceFilterValues && serviceFilterValues.size > 0) {
          (requestData as Record<string, unknown>)["serviceIds"] =
            Array.from(serviceFilterValues);
        }

        const traceFilterValues: Set<string> | undefined =
          props.appliedFacetFilters.get("traceId");

        if (traceFilterValues && traceFilterValues.size > 0) {
          (requestData as Record<string, unknown>)["traceIds"] =
            Array.from(traceFilterValues);
        }

        const spanFilterValues: Set<string> | undefined =
          props.appliedFacetFilters.get("spanId");

        if (spanFilterValues && spanFilterValues.size > 0) {
          (requestData as Record<string, unknown>)["spanIds"] =
            Array.from(spanFilterValues);
        }

        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/logs/analytics",
            ),
            data: requestData,
            headers: {
              ...ModelAPI.getCommonHeaders(),
            },
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const data: unknown = response.data["data"] || [];

        if (chartType === "timeseries") {
          setTimeseriesData(data as Array<AnalyticsTimeseriesRow>);
        } else if (chartType === "toplist") {
          setTopListData(data as Array<AnalyticsTopItem>);
        } else {
          setTableData(data as Array<AnalyticsTableRow>);
        }
      } catch {
        // Silently degrade
        setTimeseriesData([]);
        setTopListData([]);
        setTableData([]);
      } finally {
        setIsLoading(false);
      }
    }, [
      chartType,
      aggregation,
      aggregationField,
      groupByFields,
      topListLimit,
      props.timeRange,
      props.serviceIds,
      props.appliedFacetFilters,
    ]);

  useEffect(() => {
    void fetchAnalytics();
  }, [fetchAnalytics]);

  const { pivotedData, seriesKeys } = useMemo(() => {
    return pivotTimeseriesData(timeseriesData);
  }, [timeseriesData]);

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
          aggregation,
          (val: string) => {
            setAggregation(val as AnalyticsAggregation);
          },
          [
            { value: "count", label: "Count" },
            { value: "unique", label: "Unique Count" },
          ],
        )}

        {aggregation === "unique" && (
          <>
            {renderSelectControl(
              "of",
              aggregationField,
              (val: string) => {
                setAggregationField(val);
              },
              [{ value: "", label: "Select field..." }, ...allDimensionOptions],
            )}
          </>
        )}

        <div className="h-4 w-px bg-gray-200" />

        {renderSelectControl(
          "Group by",
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
          [{ value: "", label: "None" }, ...allDimensionOptions],
        )}

        {groupByFields[0] &&
          groupByFields[0].length > 0 &&
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

        {(chartType === "toplist" || chartType === "table") && (
          <>
            <div className="h-4 w-px bg-gray-200" />
            {renderSelectControl(
              "Limit",
              topListLimit,
              (val: string) => {
                setTopListLimit(Number(val));
              },
              TOP_LIST_LIMITS.map((limit: number) => {
                return { value: limit, label: String(limit) };
              }),
            )}
          </>
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
              <span className="text-[11px] text-gray-500">{key}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const renderTimeseries: () => ReactElement = (): ReactElement => {
    if (pivotedData.length === 0) {
      return renderEmptyState();
    }

    const useAreaChart: boolean = seriesKeys.length === 1;

    return (
      <div className="px-2 pt-4 pb-2">
        {renderLegend()}
        <div style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            {useAreaChart ? (
              <AreaChart
                data={pivotedData}
                margin={{ top: 8, right: 20, bottom: 4, left: 0 }}
              >
                <defs>
                  <linearGradient
                    id="areaGradient0"
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
                  width={52}
                  allowDecimals={false}
                  tickFormatter={formatYAxisTick}
                />
                <Tooltip
                  content={<AnalyticsTooltip />}
                  cursor={{
                    stroke: "#c7d2fe",
                    strokeWidth: 1,
                    strokeDasharray: "4 4",
                  }}
                />
                <Area
                  dataKey={seriesKeys[0] || "count"}
                  stroke={CHART_COLORS[0]}
                  strokeWidth={2}
                  fill="url(#areaGradient0)"
                  dot={false}
                  activeDot={{
                    r: 4,
                    fill: CHART_COLORS[0],
                    stroke: "#fff",
                    strokeWidth: 2,
                  }}
                  isAnimationActive={false}
                />
              </AreaChart>
            ) : (
              <BarChart
                data={pivotedData}
                margin={{ top: 8, right: 20, bottom: 4, left: 0 }}
                barCategoryGap="20%"
                barGap={0}
              >
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
                  width={52}
                  allowDecimals={false}
                  tickFormatter={formatYAxisTick}
                />
                <Tooltip
                  content={<AnalyticsTooltip />}
                  cursor={{ fill: "rgba(99,102,241,0.04)" }}
                />
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

    const maxCount: number = Math.max(
      ...topListData.map((item: AnalyticsTopItem) => {
        return item.count;
      }),
      1,
    );

    const totalCount: number = topListData.reduce(
      (sum: number, item: AnalyticsTopItem) => {
        return sum + item.count;
      },
      0,
    );

    return (
      <div className="p-5">
        <div className="space-y-1.5">
          {topListData.map((item: AnalyticsTopItem, index: number) => {
            const percentage: number = (item.count / maxCount) * 100;
            const sharePercent: number =
              totalCount > 0 ? Math.round((item.count / totalCount) * 100) : 0;
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
                  className="h-2 w-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <div className="w-44 min-w-0 truncate text-sm font-medium text-gray-700">
                  {item.value || "(empty)"}
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
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="font-mono text-sm font-semibold tabular-nums text-gray-800">
                    {item.count.toLocaleString()}
                  </span>
                  <span className="w-10 text-right font-mono text-[11px] tabular-nums text-gray-400">
                    {sharePercent}%
                  </span>
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

    const maxCount: number = Math.max(
      ...tableData.map((row: AnalyticsTableRow) => {
        return row.count;
      }),
      1,
    );

    return (
      <div className="p-5">
        <div className="overflow-hidden rounded-lg border border-gray-200/80">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-200/80 bg-gray-50/80">
                <th className="w-10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  #
                </th>
                {groupKeys.map((key: string) => {
                  return (
                    <th
                      key={key}
                      className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400"
                    >
                      {key}
                    </th>
                  );
                })}
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  Count
                </th>
                <th className="w-48 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400" />
              </tr>
            </thead>
            <tbody>
              {tableData.map((row: AnalyticsTableRow, index: number) => {
                const barWidth: number = (row.count / maxCount) * 100;
                const color: string =
                  CHART_COLORS[index % CHART_COLORS.length] || CHART_COLORS[0]!;
                const mutedColor: string =
                  CHART_COLORS_MUTED[index % CHART_COLORS_MUTED.length] ||
                  CHART_COLORS_MUTED[0]!;

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
                          className="whitespace-nowrap px-4 py-2.5 text-sm text-gray-700"
                        >
                          {row.groupValues[key] || "(empty)"}
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-sm font-semibold tabular-nums text-gray-800">
                      {row.count.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="h-5 w-full overflow-hidden rounded bg-gray-50">
                        <div
                          className="h-full rounded transition-all duration-300"
                          style={{
                            width: `${barWidth}%`,
                            backgroundColor: mutedColor,
                            borderLeft: `2px solid ${color}`,
                          }}
                        />
                      </div>
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
          No data available for the selected query
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

export default LogsAnalyticsView;
