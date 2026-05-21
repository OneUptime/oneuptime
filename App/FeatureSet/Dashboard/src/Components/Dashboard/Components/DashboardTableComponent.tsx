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
}

const TUPLE_SEPARATOR: string = "";

const DashboardTableComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [metricResults, setMetricResults] = useState<Array<AggregatedResult>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const primaryQueryConfig: MetricQueryConfigData | undefined =
    props.component.arguments.metricQueryConfig;
  const additionalQueryConfigs: Array<MetricQueryConfigData> | undefined =
    props.component.arguments.metricQueryConfigs;
  const formulaConfigsArg: Array<MetricFormulaConfigData> | undefined =
    props.component.arguments.metricFormulaConfigs;

  const queryConfigs: Array<MetricQueryConfigData> = useMemo(() => {
    const configs: Array<MetricQueryConfigData> = [];
    if (primaryQueryConfig) {
      configs.push(primaryQueryConfig);
    }
    if (additionalQueryConfigs && additionalQueryConfigs.length > 0) {
      configs.push(...additionalQueryConfigs);
    }
    return DashboardVariableInterpolation.applyToQueryConfigs(
      configs,
      props.variables,
    );
  }, [primaryQueryConfig, additionalQueryConfigs, props.variables]);

  const formulaConfigs: Array<MetricFormulaConfigData> = useMemo(() => {
    return formulaConfigsArg && formulaConfigsArg.length > 0
      ? formulaConfigsArg
      : [];
  }, [formulaConfigsArg]);

  const startAndEndDate: ReturnType<
    typeof RangeStartAndEndDateTimeUtil.getStartAndEndDate
  > = useMemo(() => {
    return RangeStartAndEndDateTimeUtil.getStartAndEndDate(
      props.dashboardStartAndEndDate,
    );
  }, [props.dashboardStartAndEndDate]);

  const metricViewData: MetricViewData = useMemo(() => {
    return {
      queryConfigs: queryConfigs,
      startAndEndDate: startAndEndDate,
      formulaConfigs: formulaConfigs,
    };
  }, [queryConfigs, startAndEndDate, formulaConfigs]);

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
      setError("Please select a metric. Click here to add a metric.");
      return;
    }

    if (!data.queryConfigs[0].metricQueryData.filterData?.aggegationType) {
      setIsLoading(false);
      setError(
        "Please select an aggregation. Click here to add an aggregation.",
      );
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
    queryConfigs,
    formulaConfigs,
    props.refreshTick,
    fetchAggregatedResults,
  ]);

  const attrKeys: Array<string> = useMemo(() => {
    return queryConfigs[0]?.metricQueryData.groupByAttributeKeys || [];
  }, [queryConfigs]);

  const isGroupedMode: boolean = attrKeys.length > 0;

  const reduce: TableReduce =
    props.component.arguments.reduce || TableReduce.Last;

  const decimals: number =
    typeof props.component.arguments.decimals === "number"
      ? props.component.arguments.decimals
      : 2;

  const maxRows: number = props.component.arguments.maxRows || 25;

  const valueColumns: Array<ValueColumn> = useMemo(() => {
    const columns: Array<ValueColumn> = [];
    for (const config of queryConfigs) {
      const variable: string = config.metricAliasData?.metricVariable || "";
      const label: string =
        config.metricAliasData?.legend ||
        config.metricAliasData?.title ||
        (variable ? variable.toUpperCase() : "") ||
        config.metricQueryData.filterData.metricName?.toString() ||
        "Value";
      columns.push({ key: `query:${variable || label}`, label: label });
    }
    for (const config of formulaConfigs) {
      const variable: string = config.metricAliasData?.metricVariable || "";
      const label: string =
        config.metricAliasData?.legend ||
        config.metricAliasData?.title ||
        (variable ? variable.toUpperCase() : "Formula");
      columns.push({ key: `formula:${variable || label}`, label: label });
    }
    return columns;
  }, [queryConfigs, formulaConfigs]);

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

  const rowTuples: Array<{
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
    tuples.sort(
      (
        a: { tupleKey: string; values: Array<string> },
        b: { tupleKey: string; values: Array<string> },
      ) => {
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
    return tuples.slice(0, maxRows);
  }, [isGroupedMode, metricResults, attrKeys, maxRows]);

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

  const title: string | undefined = props.component.arguments.tableTitle;
  const description: string | undefined =
    props.component.arguments.tableDescription;
  const showHeader: boolean = Boolean(title || description);

  const rowCount: number = isGroupedMode
    ? rowTuples.length
    : timestampRows.length;

  const totalColumnCount: number = isGroupedMode
    ? attrKeys.length + valueColumns.length
    : 1 + valueColumns.length;

  return (
    <div
      className="h-full overflow-auto flex flex-col"
      style={{
        opacity: isLoading ? 0.5 : 1,
        transition: "opacity 0.2s ease-in-out",
      }}
    >
      {showHeader && (
        <div className="px-2 pt-2 pb-1 flex-shrink-0">
          {title && (
            <h3 className="text-sm font-semibold text-gray-700 tracking-tight">
              {title}
            </h3>
          )}
          {description && (
            <p className="mt-0.5 text-xs text-gray-400">{description}</p>
          )}
        </div>
      )}
      <div className="flex items-center justify-between mb-2 px-2">
        <span className="text-xs text-gray-300 tabular-nums">
          {rowCount} {rowCount === 1 ? "row" : "rows"}
        </span>
      </div>
      <div className="flex-1 overflow-auto rounded-md border border-gray-100 mx-1 mb-1">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-gray-400 uppercase bg-gray-50/80 sticky top-0 border-b border-gray-100">
            <tr>
              {isGroupedMode
                ? attrKeys.map((key: string) => {
                    return (
                      <th
                        key={`attr:${key}`}
                        className="px-3 py-2 font-medium tracking-wider"
                      >
                        {key}
                      </th>
                    );
                  })
                : [
                    <th
                      key="timestamp"
                      className="px-3 py-2 font-medium tracking-wider"
                    >
                      Timestamp
                    </th>,
                  ]}
              {valueColumns.map((column: ValueColumn) => {
                return (
                  <th
                    key={column.key}
                    className="px-3 py-2 font-medium tracking-wider text-right"
                  >
                    {column.label}
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
                      {valueColumns.map((column: ValueColumn): ReactElement => {
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
                              formatValue(value, decimals)
                            )}
                          </td>
                        );
                      })}
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
                      {valueColumns.map((column: ValueColumn): ReactElement => {
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
                              formatValue(value, decimals)
                            )}
                          </td>
                        );
                      })}
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

function formatValue(value: number, decimals: number): string {
  const factor: number = Math.pow(10, Math.max(0, decimals));
  const rounded: number = Math.round(value * factor) / factor;
  return rounded.toLocaleString(undefined, {
    minimumFractionDigits: Math.max(0, decimals),
    maximumFractionDigits: Math.max(0, decimals),
  });
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
