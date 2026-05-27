import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import DashboardTableComponent, {
  TableColumn,
  TableColumnKind,
  TableGroupByAttribute,
  TableReduce,
} from "Common/Types/Dashboard/DashboardComponents/DashboardTableComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricUtil from "../../Metrics/Utils/Metrics";
import API from "Common/UI/Utils/API/API";
import JSONFunctions from "Common/Types/JSONFunctions";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import OneUptimeDate from "Common/Types/Date";
import DashboardVariableInterpolation from "Common/Utils/Dashboard/VariableInterpolation";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardTableComponent;
}

interface ValueColumn {
  key: string;
  label: string;
  decimals: number | undefined;
  unit: string | undefined;
  /*
   * When false, the column is fetched but not rendered (lets formulas
   * reference the underlying metric variable without showing a column).
   */
  visible: boolean;
}

const TUPLE_SEPARATOR: string = "";

interface ResolvedQueryData {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
  valueColumns: Array<ValueColumn>;
}

const DashboardTableComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [metricResults, setMetricResults] = useState<Array<AggregatedResult>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  /*
   * Viewer-local UI state — not persisted in the widget config.
   * sortConfig.columnKey is null when no value column sort is active
   * (then rows fall back to the default attribute-tuple sort).
   */
  const [sortConfig, setSortConfig] = useState<{
    columnKey: string | null;
    direction: "asc" | "desc";
  }>({ columnKey: null, direction: "desc" });
  const [searchText, setSearchText] = useState<string>("");
  const [searchFocused, setSearchFocused] = useState<boolean>(false);

  const args: DashboardTableComponent["arguments"] =
    props.component.arguments || {};

  const widgetGroupByAttributes: Array<TableGroupByAttribute> = useMemo(() => {
    if (args.groupByAttributes && args.groupByAttributes.length > 0) {
      return args.groupByAttributes;
    }
    if (args.groupByAttributeKeys && args.groupByAttributeKeys.length > 0) {
      return args.groupByAttributeKeys.map(
        (key: string): TableGroupByAttribute => {
          return { key };
        },
      );
    }
    // Legacy widget fallback: read groupBy from primary query's metricQueryData.
    const legacy: Array<string> =
      args.metricQueryConfig?.metricQueryData?.groupByAttributeKeys || [];
    return legacy.map((key: string): TableGroupByAttribute => {
      return { key };
    });
  }, [
    args.groupByAttributes,
    args.groupByAttributeKeys,
    args.metricQueryConfig,
  ]);

  const widgetGroupByAttributeKeys: Array<string> = useMemo(() => {
    return widgetGroupByAttributes.map((a: TableGroupByAttribute): string => {
      return a.key;
    });
  }, [widgetGroupByAttributes]);

  const unitsByMetricName: Map<string, string> = useMemo(() => {
    const map: Map<string, string> = new Map();
    for (const m of props.metricTypes || []) {
      if (m.name && m.unit) {
        map.set(m.name, m.unit);
      }
    }
    return map;
  }, [props.metricTypes]);

  const resolved: ResolvedQueryData = useMemo(() => {
    return resolveQueries(args, widgetGroupByAttributeKeys, unitsByMetricName);
  }, [args, widgetGroupByAttributeKeys, unitsByMetricName]);

  const queryConfigsInterpolated: Array<MetricQueryConfigData> = useMemo(() => {
    return DashboardVariableInterpolation.applyToQueryConfigs(
      resolved.queryConfigs,
      props.variables,
    );
  }, [resolved.queryConfigs, props.variables]);

  const startAndEndDate: ReturnType<
    typeof RangeStartAndEndDateTimeUtil.getStartAndEndDate
  > = useMemo(() => {
    return RangeStartAndEndDateTimeUtil.getStartAndEndDate(
      props.dashboardStartAndEndDate,
    );
  }, [props.dashboardStartAndEndDate]);

  const metricViewData: MetricViewData = useMemo(() => {
    return {
      queryConfigs: queryConfigsInterpolated,
      startAndEndDate: startAndEndDate,
      formulaConfigs: resolved.formulaConfigs,
    };
  }, [queryConfigsInterpolated, startAndEndDate, resolved.formulaConfigs]);

  const metricViewDataRef: React.MutableRefObject<MetricViewData> =
    useRef<MetricViewData>(metricViewData);
  metricViewDataRef.current = metricViewData;

  const fetchAggregatedResults: () => Promise<void> = useCallback(async () => {
    const data: MetricViewData = metricViewDataRef.current;
    setIsLoading(true);

    if (!data.startAndEndDate?.startValue || !data.startAndEndDate?.endValue) {
      setIsLoading(false);
      setError("Please select a valid start and end date.");
      return;
    }

    if (
      !data.queryConfigs ||
      data.queryConfigs.length === 0 ||
      !data.queryConfigs[0] ||
      !data.queryConfigs[0].metricQueryData ||
      !data.queryConfigs[0].metricQueryData.filterData ||
      Object.keys(data.queryConfigs[0].metricQueryData.filterData).length === 0
    ) {
      setIsLoading(false);
      setError(
        "Add a metric column with a Metric Name to start populating the table.",
      );
      return;
    }

    if (!data.queryConfigs[0].metricQueryData.filterData?.aggegationType) {
      setIsLoading(false);
      setError("Pick an aggregation for your first metric column.");
      return;
    }

    try {
      const results: Array<AggregatedResult> = await MetricUtil.fetchResults({
        metricViewData: data,
        metricTypes: props.metricTypes,
      });

      setMetricResults(results);
      setError("");
    } catch (err: unknown) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  }, [props.metricTypes]);

  useEffect(() => {
    fetchAggregatedResults();
  }, [
    startAndEndDate,
    queryConfigsInterpolated,
    resolved.formulaConfigs,
    props.refreshTick,
    fetchAggregatedResults,
  ]);

  const attrKeys: Array<string> = widgetGroupByAttributeKeys;
  const isGroupedMode: boolean = attrKeys.length > 0;

  const reduce: TableReduce = args.reduce || TableReduce.Last;
  const defaultDecimals: number =
    typeof args.decimals === "number" ? args.decimals : 2;
  const maxRows: number = args.maxRows || 25;

  const valueColumns: Array<ValueColumn> = resolved.valueColumns;
  const visibleValueColumns: Array<ValueColumn> = useMemo(() => {
    return valueColumns.filter((c: ValueColumn): boolean => {
      return c.visible;
    });
  }, [valueColumns]);

  const reducedByColumnAndTuple: Map<
    string,
    Map<string, number>
  > = useMemo(() => {
    const byColumn: Map<string, Map<string, number>> = new Map();
    if (!isGroupedMode) {
      return byColumn;
    }
    for (let i: number = 0; i < valueColumns.length; i++) {
      const column: ValueColumn = valueColumns[i]!;
      const result: AggregatedResult | undefined = metricResults[i];
      const tupleToValues: Map<string, Array<AggregatedModel>> = new Map();
      if (result && result.data) {
        for (const row of result.data) {
          /*
           * Skip samples that don't carry every grouped-by attribute.
           * The server returns a single "null group" for these, which
           * otherwise renders as a stray "(unset)" row — meaningless
           * when the user explicitly grouped by an attribute.
           */
          if (!hasAllGroupByValues(row, attrKeys)) {
            continue;
          }
          const tupleKey: string = buildTupleKey(row, attrKeys);
          const existing: Array<AggregatedModel> | undefined =
            tupleToValues.get(tupleKey);
          if (existing) {
            existing.push(row);
          } else {
            tupleToValues.set(tupleKey, [row]);
          }
        }
      }
      const reducedForColumn: Map<string, number> = new Map();
      for (const [tupleKey, rows] of tupleToValues) {
        reducedForColumn.set(tupleKey, reduceRows(rows, reduce));
      }
      byColumn.set(column.key, reducedForColumn);
    }
    return byColumn;
  }, [isGroupedMode, metricResults, valueColumns, attrKeys, reduce]);

  const allRowTuples: Array<{
    tupleKey: string;
    values: Array<string>;
  }> = useMemo(() => {
    if (!isGroupedMode) {
      return [];
    }
    const seen: Map<string, Array<string>> = new Map();
    for (const result of metricResults) {
      if (!result || !result.data) {
        continue;
      }
      for (const row of result.data) {
        if (!hasAllGroupByValues(row, attrKeys)) {
          continue;
        }
        const tupleKey: string = buildTupleKey(row, attrKeys);
        if (!seen.has(tupleKey)) {
          seen.set(tupleKey, extractTupleValues(row, attrKeys));
        }
      }
    }
    const tuples: Array<{ tupleKey: string; values: Array<string> }> = [];
    for (const [tupleKey, values] of seen) {
      tuples.push({ tupleKey, values });
    }
    return tuples;
  }, [isGroupedMode, metricResults, attrKeys]);

  /*
   * Filter (by search text against any attribute value) + sort (either by
   * a value column the user clicked on, or alphabetically by attribute
   * tuple as the default) + slice to maxRows. Kept separate from
   * allRowTuples so that toggling sort/search doesn't re-derive the
   * underlying set from metricResults.
   */
  const rowTuples: Array<{
    tupleKey: string;
    values: Array<string>;
  }> = useMemo(() => {
    if (!isGroupedMode) {
      return [];
    }
    const needle: string = searchText.trim().toLowerCase();
    const filtered: Array<{ tupleKey: string; values: Array<string> }> = needle
      ? allRowTuples.filter(
          (t: { tupleKey: string; values: Array<string> }): boolean => {
            return t.values.some((v: string): boolean => {
              return v.toLowerCase().includes(needle);
            });
          },
        )
      : [...allRowTuples];

    if (sortConfig.columnKey) {
      const colKey: string = sortConfig.columnKey;
      const dir: 1 | -1 = sortConfig.direction === "asc" ? 1 : -1;
      filtered.sort(
        (
          a: { tupleKey: string; values: Array<string> },
          b: { tupleKey: string; values: Array<string> },
        ): number => {
          const av: number | undefined = reducedByColumnAndTuple
            .get(colKey)
            ?.get(a.tupleKey);
          const bv: number | undefined = reducedByColumnAndTuple
            .get(colKey)
            ?.get(b.tupleKey);
          const aMissing: boolean = av === undefined || Number.isNaN(av);
          const bMissing: boolean = bv === undefined || Number.isNaN(bv);
          // Missing values always sink to the bottom.
          if (aMissing && bMissing) {
            return 0;
          }
          if (aMissing) {
            return 1;
          }
          if (bMissing) {
            return -1;
          }
          return ((av as number) - (bv as number)) * dir;
        },
      );
    } else {
      filtered.sort(
        (
          a: { tupleKey: string; values: Array<string> },
          b: { tupleKey: string; values: Array<string> },
        ): number => {
          for (let i: number = 0; i < a.values.length; i++) {
            const av: string = a.values[i] || "";
            const bv: string = b.values[i] || "";
            if (av < bv) {
              return -1;
            }
            if (av > bv) {
              return 1;
            }
          }
          return 0;
        },
      );
    }
    return filtered.slice(0, maxRows);
  }, [
    isGroupedMode,
    allRowTuples,
    searchText,
    sortConfig,
    reducedByColumnAndTuple,
    maxRows,
  ]);

  const toggleValueColumnSort: (columnKey: string) => void = (
    columnKey: string,
  ): void => {
    setSortConfig(
      (prev: {
        columnKey: string | null;
        direction: "asc" | "desc";
      }): { columnKey: string | null; direction: "asc" | "desc" } => {
        if (prev.columnKey !== columnKey) {
          // First click on a new column → descending (largest first).
          return { columnKey, direction: "desc" };
        }
        if (prev.direction === "desc") {
          return { columnKey, direction: "asc" };
        }
        // Third click clears the sort and falls back to alphabetical.
        return { columnKey: null, direction: "desc" };
      },
    );
  };

  const timestampRows: Array<{
    timestampIso: string;
    timestampLabel: string;
    valuesByColumnKey: Map<string, number>;
  }> = useMemo(() => {
    if (isGroupedMode) {
      return [];
    }
    const timestampToValues: Map<string, Map<string, number>> = new Map();
    for (let i: number = 0; i < valueColumns.length; i++) {
      const column: ValueColumn = valueColumns[i]!;
      const result: AggregatedResult | undefined = metricResults[i];
      if (!result || !result.data) {
        continue;
      }
      for (const row of result.data) {
        const iso: string = String(row.timestamp);
        let perColumn: Map<string, number> | undefined =
          timestampToValues.get(iso);
        if (!perColumn) {
          perColumn = new Map();
          timestampToValues.set(iso, perColumn);
        }
        if (typeof row.value === "number" && Number.isFinite(row.value)) {
          perColumn.set(column.key, row.value);
        }
      }
    }
    const rows: Array<{
      timestampIso: string;
      timestampLabel: string;
      valuesByColumnKey: Map<string, number>;
    }> = [];
    for (const [iso, perColumn] of timestampToValues) {
      rows.push({
        timestampIso: iso,
        timestampLabel: OneUptimeDate.getDateAsLocalFormattedString(
          OneUptimeDate.fromString(iso),
        ),
        valuesByColumnKey: perColumn,
      });
    }
    rows.sort(
      (a: { timestampIso: string }, b: { timestampIso: string }): number => {
        return (
          OneUptimeDate.fromString(a.timestampIso).getTime() -
          OneUptimeDate.fromString(b.timestampIso).getTime()
        );
      },
    );
    return rows.slice(0, maxRows);
  }, [isGroupedMode, metricResults, valueColumns, maxRows]);

  if (isLoading && metricResults.length === 0) {
    return (
      <div className="h-full flex flex-col animate-pulse p-1">
        <div className="h-3 w-24 bg-gray-100 rounded mb-3"></div>
        <div className="flex-1 space-y-2">
          <div className="flex gap-4">
            <div className="h-3 w-32 bg-gray-100 rounded"></div>
            <div className="h-3 w-16 bg-gray-100 rounded ml-auto"></div>
          </div>
          {Array.from({ length: 5 }).map((_: unknown, i: number) => {
            return (
              <div
                key={i}
                className="flex gap-4"
                style={{ opacity: 1 - i * 0.15 }}
              >
                <div className="h-3 w-28 bg-gray-50 rounded"></div>
                <div className="h-3 w-14 bg-gray-50 rounded ml-auto"></div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-2">
        <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center">
          <div className="h-5 w-5 text-gray-300">
            <Icon icon={IconProp.TableCells} />
          </div>
        </div>
        <p className="text-xs text-gray-400 text-center max-w-48">{error}</p>
      </div>
    );
  }

  const title: string | undefined = args.tableTitle;
  const description: string | undefined = args.tableDescription;
  const showHeader: boolean = Boolean(title || description);

  const rowCount: number = isGroupedMode
    ? rowTuples.length
    : timestampRows.length;

  const totalColumnCount: number = isGroupedMode
    ? attrKeys.length + visibleValueColumns.length
    : 1 + visibleValueColumns.length;

  return (
    <div
      className="h-full overflow-auto flex flex-col"
      style={{
        opacity: isLoading ? 0.5 : 1,
        transition: "opacity 0.2s ease-in-out",
      }}
    >
      <div className="flex items-start justify-between gap-3 px-2 pt-2 pb-2 flex-shrink-0">
        <div className="min-w-0 flex-1">
          {showHeader && (
            <>
              {title && (
                <h3 className="text-sm font-semibold text-gray-700 tracking-tight truncate">
                  {title}
                </h3>
              )}
              {description && (
                <p className="mt-0.5 text-xs text-gray-400">{description}</p>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {isGroupedMode && (
            <div
              className={`group relative inline-flex items-center w-56 max-w-full transition-shadow ${
                searchFocused ? "ring-2 ring-indigo-100 rounded-md" : ""
              }`}
            >
              <span
                className={`absolute left-2.5 inline-flex h-3.5 w-3.5 pointer-events-none ${
                  searchFocused || searchText
                    ? "text-indigo-400"
                    : "text-gray-300"
                }`}
              >
                <Icon icon={IconProp.MagnifyingGlass} />
              </span>
              <input
                type="text"
                value={searchText}
                onChange={(e: React.ChangeEvent<HTMLInputElement>): void => {
                  setSearchText(e.target.value);
                }}
                onFocus={(): void => {
                  setSearchFocused(true);
                }}
                onBlur={(): void => {
                  setSearchFocused(false);
                }}
                placeholder="Search rows…"
                aria-label="Search rows"
                className="w-full h-8 pl-8 pr-7 text-xs rounded-md border border-gray-200 bg-white text-gray-700 placeholder-gray-400 shadow-sm transition-colors focus:outline-none focus:border-indigo-400 hover:border-gray-300"
              />
              {searchText.length > 0 && (
                <button
                  type="button"
                  onClick={(): void => {
                    setSearchText("");
                  }}
                  aria-label="Clear search"
                  title="Clear search"
                  className="absolute right-1.5 inline-flex h-5 w-5 items-center justify-center rounded text-gray-300 hover:text-gray-600 hover:bg-gray-100"
                >
                  <span className="h-3 w-3">
                    <Icon icon={IconProp.XMark} />
                  </span>
                </button>
              )}
            </div>
          )}
          <span className="text-xs text-gray-400 tabular-nums whitespace-nowrap">
            {isGroupedMode &&
            searchText.trim() !== "" &&
            allRowTuples.length !== rowCount ? (
              <>
                <span className="font-medium text-gray-500">{rowCount}</span>
                <span className="text-gray-300">
                  {" "}
                  of {allRowTuples.length}{" "}
                </span>
                {allRowTuples.length === 1 ? "row" : "rows"}
              </>
            ) : (
              <>
                {rowCount} {rowCount === 1 ? "row" : "rows"}
              </>
            )}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-auto rounded-md border border-gray-100 mx-1 mb-1">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-gray-400 uppercase bg-gray-50/80 sticky top-0 border-b border-gray-100">
            <tr>
              {isGroupedMode
                ? widgetGroupByAttributes.map(
                    (attr: TableGroupByAttribute): ReactElement => {
                      return (
                        <th
                          key={`attr:${attr.key}`}
                          className="px-3 py-2 font-medium tracking-wider"
                        >
                          {attr.header || attr.key}
                        </th>
                      );
                    },
                  )
                : [
                    <th
                      key="timestamp"
                      className="px-3 py-2 font-medium tracking-wider"
                    >
                      Timestamp
                    </th>,
                  ]}
              {visibleValueColumns.map((column: ValueColumn) => {
                const isActive: boolean = sortConfig.columnKey === column.key;
                const indicator: string = !isActive
                  ? "↕"
                  : sortConfig.direction === "asc"
                    ? "↑"
                    : "↓";
                return (
                  <th
                    key={column.key}
                    className="px-3 py-2 font-medium tracking-wider text-right cursor-pointer select-none hover:bg-gray-100/60"
                    onClick={(): void => {
                      toggleValueColumnSort(column.key);
                    }}
                    title="Click to sort"
                  >
                    <span className="inline-flex items-center gap-1 justify-end">
                      <span>{column.label}</span>
                      <span
                        className={
                          isActive
                            ? "text-indigo-500"
                            : "text-gray-300 opacity-60"
                        }
                      >
                        {indicator}
                      </span>
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isGroupedMode &&
              rowTuples.map(
                (
                  row: { tupleKey: string; values: Array<string> },
                  index: number,
                ): ReactElement => {
                  return (
                    <tr
                      key={`${row.tupleKey}-${index}`}
                      className="hover:bg-gray-50/50 transition-colors duration-100"
                    >
                      {row.values.map(
                        (value: string, attrIndex: number): ReactElement => {
                          return (
                            <td
                              key={`attr-${attrIndex}`}
                              className="px-3 py-2 text-gray-700 text-xs truncate"
                            >
                              {value || (
                                <span className="text-gray-300">(unset)</span>
                              )}
                            </td>
                          );
                        },
                      )}
                      {visibleValueColumns.map(
                        (column: ValueColumn): ReactElement => {
                          const map: Map<string, number> | undefined =
                            reducedByColumnAndTuple.get(column.key);
                          const value: number | undefined = map?.get(
                            row.tupleKey,
                          );
                          return (
                            <td
                              key={column.key}
                              className="px-3 py-2 text-gray-900 text-right tabular-nums text-xs font-semibold"
                            >
                              {value === undefined || Number.isNaN(value) ? (
                                <span className="text-gray-300">—</span>
                              ) : (
                                formatValue(
                                  value,
                                  column.decimals ?? defaultDecimals,
                                  column.unit,
                                )
                              )}
                            </td>
                          );
                        },
                      )}
                    </tr>
                  );
                },
              )}
            {!isGroupedMode &&
              timestampRows.map(
                (
                  row: {
                    timestampIso: string;
                    timestampLabel: string;
                    valuesByColumnKey: Map<string, number>;
                  },
                  index: number,
                ): ReactElement => {
                  return (
                    <tr
                      key={`${row.timestampIso}-${index}`}
                      className="hover:bg-gray-50/50 transition-colors duration-100"
                    >
                      <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">
                        {row.timestampLabel}
                      </td>
                      {visibleValueColumns.map(
                        (column: ValueColumn): ReactElement => {
                          const value: number | undefined =
                            row.valuesByColumnKey.get(column.key);
                          return (
                            <td
                              key={column.key}
                              className="px-3 py-2 text-gray-900 text-right tabular-nums text-xs font-semibold"
                            >
                              {value === undefined || Number.isNaN(value) ? (
                                <span className="text-gray-300">—</span>
                              ) : (
                                formatValue(
                                  value,
                                  column.decimals ?? defaultDecimals,
                                  column.unit,
                                )
                              )}
                            </td>
                          );
                        },
                      )}
                    </tr>
                  );
                },
              )}
            {rowCount === 0 && (
              <tr>
                <td
                  colSpan={totalColumnCount}
                  className="px-4 py-8 text-center text-gray-400 text-sm"
                >
                  No data available for the selected time range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/*
 * Translate the widget's user-facing config (columns + groupBy) into the
 * shape MetricUtil.fetchResults expects (queryConfigs + formulaConfigs).
 *
 * Legacy widgets that still use metricQueryConfig/metricQueryConfigs/
 * metricFormulaConfigs are also accepted: each legacy query/formula
 * becomes a column whose header is its metricVariable/legend.
 *
 * Output order is preserved so metricResults[i] always matches valueColumns[i].
 */
function resolveQueries(
  args: DashboardTableComponent["arguments"],
  widgetGroupByAttributeKeys: Array<string>,
  unitsByMetricName: Map<string, string>,
): ResolvedQueryData {
  const queryConfigs: Array<MetricQueryConfigData> = [];
  const formulaConfigs: Array<MetricFormulaConfigData> = [];
  const valueColumns: Array<ValueColumn> = [];

  const columns: Array<TableColumn> = args.columns || [];

  if (columns.length > 0) {
    for (const column of columns) {
      const visible: boolean = column.showAsColumn !== false;
      const resolvedUnit: string | undefined =
        column.unit && column.unit.length > 0
          ? column.unit
          : column.kind === TableColumnKind.Metric && column.metricName
            ? unitsByMetricName.get(column.metricName)
            : undefined;
      if (column.kind === TableColumnKind.Metric) {
        queryConfigs.push({
          metricAliasData: {
            metricVariable: column.variable,
            title: column.header,
            description: undefined,
            legend: column.header,
            legendUnit: resolvedUnit,
          },
          metricQueryData: {
            filterData: {
              metricName: column.metricName,
              aggegationType: column.aggregation || MetricsAggregationType.Avg,
            },
            groupBy: undefined,
            groupByAttributeKeys:
              widgetGroupByAttributeKeys.length > 0
                ? widgetGroupByAttributeKeys
                : undefined,
          },
        });
        valueColumns.push({
          key: `col:${column.id}`,
          label: column.header,
          decimals: column.decimals,
          unit: resolvedUnit,
          visible,
        });
      } else {
        formulaConfigs.push({
          metricAliasData: {
            metricVariable: column.variable,
            title: column.header,
            description: undefined,
            legend: column.header,
            legendUnit: resolvedUnit,
          },
          metricFormulaData: {
            metricFormula: column.formula || "",
          },
        });
        valueColumns.push({
          key: `col:${column.id}`,
          label: column.header,
          decimals: column.decimals,
          unit: resolvedUnit,
          visible,
        });
      }
    }
    /*
     * Reorder: queries first, then formulas — to match MetricUtil.fetchResults
     * which returns Array<AggregatedResult> with queries first then formulas.
     */
    return reorderResolved(columns, queryConfigs, formulaConfigs, valueColumns);
  }

  // Legacy fallback: build from metricQueryConfig + metricQueryConfigs + metricFormulaConfigs.
  if (args.metricQueryConfig) {
    const legacyMetricName: string | undefined =
      args.metricQueryConfig.metricQueryData?.filterData?.metricName?.toString();
    queryConfigs.push({
      ...args.metricQueryConfig,
      metricQueryData: {
        ...args.metricQueryConfig.metricQueryData,
        groupByAttributeKeys:
          widgetGroupByAttributeKeys.length > 0
            ? widgetGroupByAttributeKeys
            : args.metricQueryConfig.metricQueryData?.groupByAttributeKeys,
      },
    });
    valueColumns.push({
      key: `legacy:primary`,
      label:
        args.metricQueryConfig.metricAliasData?.legend ||
        args.metricQueryConfig.metricAliasData?.metricVariable?.toUpperCase() ||
        legacyMetricName ||
        "Value",
      decimals: undefined,
      unit: legacyMetricName
        ? unitsByMetricName.get(legacyMetricName)
        : undefined,
      visible: true,
    });
  }
  if (args.metricQueryConfigs && args.metricQueryConfigs.length > 0) {
    for (const config of args.metricQueryConfigs) {
      const legacyMetricName: string | undefined =
        config.metricQueryData?.filterData?.metricName?.toString();
      queryConfigs.push({
        ...config,
        metricQueryData: {
          ...config.metricQueryData,
          groupByAttributeKeys:
            widgetGroupByAttributeKeys.length > 0
              ? widgetGroupByAttributeKeys
              : config.metricQueryData?.groupByAttributeKeys,
        },
      });
      valueColumns.push({
        key: `legacy:q:${config.metricAliasData?.metricVariable || valueColumns.length}`,
        label:
          config.metricAliasData?.legend ||
          config.metricAliasData?.metricVariable?.toUpperCase() ||
          legacyMetricName ||
          "Value",
        decimals: undefined,
        unit: legacyMetricName
          ? unitsByMetricName.get(legacyMetricName)
          : undefined,
        visible: true,
      });
    }
  }
  if (args.metricFormulaConfigs && args.metricFormulaConfigs.length > 0) {
    for (const config of args.metricFormulaConfigs) {
      formulaConfigs.push(config);
      valueColumns.push({
        key: `legacy:f:${config.metricAliasData?.metricVariable || valueColumns.length}`,
        label:
          config.metricAliasData?.legend ||
          config.metricAliasData?.metricVariable?.toUpperCase() ||
          "Formula",
        decimals: undefined,
        unit: undefined,
        visible: true,
      });
    }
  }

  return { queryConfigs, formulaConfigs, valueColumns };
}

function reorderResolved(
  columns: Array<TableColumn>,
  queryConfigs: Array<MetricQueryConfigData>,
  formulaConfigs: Array<MetricFormulaConfigData>,
  valueColumns: Array<ValueColumn>,
): ResolvedQueryData {
  /*
   * MetricUtil.fetchResults returns AggregatedResult[] indexed as
   * [...queries, ...formulas]. The valueColumns above were pushed in
   * column order (mixed). Reindex valueColumns into the same query→formula
   * ordering so metricResults[i] aligns with valueColumns[i] at render.
   */
  const metricColumns: Array<ValueColumn> = [];
  const formulaColumns: Array<ValueColumn> = [];
  for (let i: number = 0; i < columns.length; i++) {
    const column: TableColumn = columns[i]!;
    const valueColumn: ValueColumn = valueColumns[i]!;
    if (column.kind === TableColumnKind.Metric) {
      metricColumns.push(valueColumn);
    } else {
      formulaColumns.push(valueColumn);
    }
  }
  return {
    queryConfigs,
    formulaConfigs,
    valueColumns: [...metricColumns, ...formulaColumns],
  };
}

function hasAllGroupByValues(
  row: AggregatedModel,
  attrKeys: Array<string>,
): boolean {
  if (attrKeys.length === 0) {
    return true;
  }
  const attributes: Record<string, unknown> = getAttributes(row);
  for (const key of attrKeys) {
    const value: unknown = attributes[key];
    if (value === undefined || value === null || value === "") {
      return false;
    }
  }
  return true;
}

function buildTupleKey(row: AggregatedModel, attrKeys: Array<string>): string {
  const attributes: Record<string, unknown> = getAttributes(row);
  const parts: Array<string> = attrKeys.map((key: string): string => {
    const value: unknown = attributes[key];
    if (value === undefined || value === null) {
      return "";
    }
    return String(value);
  });
  return parts.join(TUPLE_SEPARATOR);
}

function extractTupleValues(
  row: AggregatedModel,
  attrKeys: Array<string>,
): Array<string> {
  const attributes: Record<string, unknown> = getAttributes(row);
  return attrKeys.map((key: string): string => {
    const value: unknown = attributes[key];
    if (value === undefined || value === null) {
      return "";
    }
    return String(value);
  });
}

function getAttributes(row: AggregatedModel): Record<string, unknown> {
  const raw: unknown = (row as unknown as Record<string, unknown>)[
    "attributes"
  ];
  if (raw && typeof raw === "object") {
    return raw as Record<string, unknown>;
  }
  return {};
}

function reduceRows(rows: Array<AggregatedModel>, reduce: TableReduce): number {
  if (rows.length === 0) {
    return Number.NaN;
  }
  const values: Array<number> = rows
    .map((r: AggregatedModel): number => {
      return r.value;
    })
    .filter((v: number): boolean => {
      return typeof v === "number" && Number.isFinite(v);
    });
  if (values.length === 0) {
    return Number.NaN;
  }

  switch (reduce) {
    case TableReduce.Avg:
      return (
        values.reduce((sum: number, v: number) => {
          return sum + v;
        }, 0) / values.length
      );
    case TableReduce.Sum:
      return values.reduce((sum: number, v: number) => {
        return sum + v;
      }, 0);
    case TableReduce.Min:
      return Math.min(...values);
    case TableReduce.Max:
      return Math.max(...values);
    case TableReduce.Last:
    default: {
      const sorted: Array<AggregatedModel> = [...rows].sort(
        (a: AggregatedModel, b: AggregatedModel) => {
          return (
            OneUptimeDate.fromString(b.timestamp).getTime() -
            OneUptimeDate.fromString(a.timestamp).getTime()
          );
        },
      );
      return sorted[0]?.value ?? Number.NaN;
    }
  }
}

function formatValue(
  value: number,
  decimals: number,
  unit: string | undefined,
): string {
  const safeDecimals: number = Math.max(0, decimals);
  const factor: number = Math.pow(10, safeDecimals);
  const rounded: number = Math.round(value * factor) / factor;
  const formatted: string = rounded.toLocaleString(undefined, {
    minimumFractionDigits: safeDecimals,
    maximumFractionDigits: safeDecimals,
  });
  if (!unit) {
    return formatted;
  }
  /*
   * Render "% / ° / ‰" with no space; everything else with a single
   * space (so "12.3 MB" looks right but "12.3%" does too).
   */
  const noSpace: boolean = unit === "%" || unit === "°" || unit === "‰";
  return noSpace ? `${formatted}${unit}` : `${formatted} ${unit}`;
}

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

  if (!JSONFunctions.deepEqual(prev.variables, next.variables)) {
    return false;
  }

  return JSONFunctions.deepEqual(
    prev.component.arguments,
    next.component.arguments,
  );
}

export default React.memo(DashboardTableComponentElement, arePropsEqual);
