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
  Legend,
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
  "#f43f5e", // rose
  "#10b981", // emerald
  "#f59e0b", // amber
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#84cc16", // lime
  "#d946ef", // fuchsia
  "#64748b", // slate
  "#ef4444", // red
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
  const date: Date = new Date(time);

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

  const renderQueryBuilder: () => ReactElement = (): ReactElement => {
    return (
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 bg-gray-50/50 px-4 py-3">
        {/* Chart type */}
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-gray-500">Chart</label>
          <select
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            value={chartType}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              setChartType(e.target.value as AnalyticsChartType);
            }}
          >
            <option value="timeseries">Timeseries</option>
            <option value="toplist">Top List</option>
            <option value="table">Table</option>
          </select>
        </div>

        {/* Aggregation */}
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-gray-500">Measure</label>
          <select
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            value={aggregation}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              setAggregation(e.target.value as AnalyticsAggregation);
            }}
          >
            <option value="count">Count</option>
            <option value="unique">Unique Count</option>
          </select>
        </div>

        {/* Aggregation field for unique count */}
        {aggregation === "unique" && (
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-gray-500">of</label>
            <select
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={aggregationField}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                setAggregationField(e.target.value);
              }}
            >
              <option value="">Select field...</option>
              {allDimensionOptions.map(
                (opt: { value: string; label: string }) => {
                  return (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  );
                },
              )}
            </select>
          </div>
        )}

        {/* Group by */}
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-gray-500">Group by</label>
          <select
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            value={groupByFields[0] || ""}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              const val: string = e.target.value;
              setGroupByFields((prev: Array<string>) => {
                const next: Array<string> = [...prev];
                next[0] = val;
                return next.filter((f: string) => {
                  return f.length > 0;
                });
              });
            }}
          >
            <option value="">None</option>
            {allDimensionOptions.map(
              (opt: { value: string; label: string }) => {
                return (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                );
              },
            )}
          </select>
        </div>

        {/* Second group by (only if first is set) */}
        {groupByFields[0] && groupByFields[0].length > 0 && (
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-gray-500">then by</label>
            <select
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={groupByFields[1] || ""}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                const val: string = e.target.value;
                setGroupByFields((prev: Array<string>) => {
                  const next: Array<string> = [prev[0] || ""];

                  if (val.length > 0) {
                    next.push(val);
                  }

                  return next.filter((f: string) => {
                    return f.length > 0;
                  });
                });
              }}
            >
              <option value="">None</option>
              {allDimensionOptions
                .filter((opt: { value: string }) => {
                  return opt.value !== groupByFields[0];
                })
                .map((opt: { value: string; label: string }) => {
                  return (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  );
                })}
            </select>
          </div>
        )}

        {/* Limit for top list and table */}
        {(chartType === "toplist" || chartType === "table") && (
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-gray-500">Limit</label>
            <select
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={topListLimit}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                setTopListLimit(Number(e.target.value));
              }}
            >
              {TOP_LIST_LIMITS.map((limit: number) => {
                return (
                  <option key={limit} value={limit}>
                    {limit}
                  </option>
                );
              })}
            </select>
          </div>
        )}
      </div>
    );
  };

  const renderTimeseries: () => ReactElement = (): ReactElement => {
    if (pivotedData.length === 0) {
      return renderEmptyState();
    }

    return (
      <div className="p-4" style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={pivotedData}
            margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
            barCategoryGap="15%"
            barGap={0}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis
              dataKey="time"
              tickFormatter={formatTickTime}
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              axisLine={{ stroke: "#e5e7eb" }}
              tickLine={false}
              minTickGap={40}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
              width={56}
              allowDecimals={false}
              tickFormatter={formatYAxisTick}
            />
            <Tooltip
              contentStyle={{
                fontSize: 12,
                borderRadius: 6,
                border: "1px solid #e5e7eb",
              }}
              labelFormatter={(label: string) => {
                const d: Date = new Date(label);

                if (isNaN(d.getTime())) {
                  return label;
                }

                return d.toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                });
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              iconType="square"
              iconSize={10}
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
                      ? [2, 2, 0, 0]
                      : [0, 0, 0, 0]
                  }
                  isAnimationActive={false}
                  maxBarSize={32}
                />
              );
            })}
          </BarChart>
        </ResponsiveContainer>
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

    return (
      <div className="p-4">
        <div className="space-y-2">
          {topListData.map((item: AnalyticsTopItem, index: number) => {
            const percentage: number = (item.count / maxCount) * 100;
            return (
              <div key={index} className="flex items-center gap-3">
                <div className="w-40 truncate text-xs font-medium text-gray-700">
                  {item.value || "(empty)"}
                </div>
                <div className="flex-1">
                  <div className="relative h-6 w-full overflow-hidden rounded bg-gray-100">
                    <div
                      className="absolute left-0 top-0 h-full rounded transition-all"
                      style={{
                        width: `${percentage}%`,
                        backgroundColor:
                          CHART_COLORS[index % CHART_COLORS.length],
                      }}
                    />
                    <div className="absolute right-2 top-0 flex h-full items-center text-xs font-medium text-gray-600">
                      {item.count.toLocaleString()}
                    </div>
                  </div>
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

    return (
      <div className="p-4">
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {groupKeys.map((key: string) => {
                  return (
                    <th
                      key={key}
                      className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    >
                      {key}
                    </th>
                  );
                })}
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Count
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {tableData.map((row: AnalyticsTableRow, index: number) => {
                return (
                  <tr key={index} className="hover:bg-gray-50">
                    {groupKeys.map((key: string) => {
                      return (
                        <td
                          key={key}
                          className="whitespace-nowrap px-4 py-2 text-xs text-gray-700"
                        >
                          {row.groupValues[key] || "(empty)"}
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium text-gray-900">
                      {row.count.toLocaleString()}
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
      <div className="flex h-64 items-center justify-center text-sm text-gray-400">
        No data available for the selected query.
      </div>
    );
  };

  const renderChart: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return (
        <div className="flex h-64 items-center justify-center">
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
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      {renderQueryBuilder()}
      {renderChart()}
    </div>
  );
};

export default LogsAnalyticsView;
