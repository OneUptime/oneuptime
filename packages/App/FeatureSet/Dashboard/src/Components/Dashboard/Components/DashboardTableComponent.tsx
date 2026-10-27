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
  TableColumnThresholds,
  TableGroupByAttribute,
  TableReduce,
  TableThresholdStyle,
} from "Common/Types/Dashboard/DashboardComponents/DashboardTableComponent";
import {
  TableColumnDisplay,
  getTableColumnDisplay,
  readTableColumnThresholds,
  readTableThresholdStyle,
} from "Common/Utils/Dashboard/TableThresholds";
import DashboardTableValueCell from "./DashboardTableValueCell";
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
import {
  DashboardDateTime,
  getDashboardDateTime,
} from "../Utils/DashboardDateTime";
import DashboardVariableInterpolation from "Common/Utils/Dashboard/VariableInterpolation";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  DASHBOARD_WIDGET_SORT_ARGUMENT,
  DashboardWidgetSortChoice,
  DashboardWidgetSortColumnInfo,
  DashboardWidgetSortDirection,
  DashboardWidgetSortKind,
  findDashboardWidgetSortColumn,
} from "Common/Types/Dashboard/DashboardWidgetSort";
import useDashboardWidgetSort, {
  DashboardWidgetSortState,
  useReportDashboardWidgetSortColumns,
} from "Common/UI/Utils/UseDashboardWidgetSort";
import DashboardSortableColumnHeader from "./DashboardSortableColumnHeader";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardTableComponent;
}

interface ValueColumn {
  key: string;
  label: string;
  decimals: number | undefined;
  // The unit written after each value (getTableColumnDisplay).
  unit: string | undefined;
  /*
   * What each stored value is multiplied by before it is shown: 100 for a
   * usage metric sent as a fraction and shown as a percent, else 1.
   */
  factor: number;
  // The column's thresholds (issue #5231); null when it has none in force.
  thresholds: TableColumnThresholds | null;
  /*
   * When false, the column is fetched but not rendered (lets formulas
   * reference the underlying metric variable without showing a column).
   */
  visible: boolean;
}

const TUPLE_SEPARATOR: string = "";

/*
 * A sort's column names which column the rows are ordered by:
 *   - "attr:<index>" → a group-by attribute column (grouped mode)
 *   - "timestamp"     → the time column (time-bucketed mode)
 *   - anything else   → a value column (its ValueColumn.key, e.g. "col:<id>")
 * Value column keys are always "col:"/"legacy:" prefixed, so they never
 * collide with these. The same keys name the widget's own sort
 * (`arguments.sort`, "col:<id>:desc") and a viewer's remembered pick.
 */
const ATTR_SORT_PREFIX: string = "attr:";
const TIMESTAMP_SORT_KEY: string = "timestamp";

/*
 * The table's own order, which it always had: grouped rows alphabetically
 * by their attributes - the first attribute, then the rest - and
 * time-bucketed rows oldest first.
 */
const GROUPED_DEFAULT_SORT: DashboardWidgetSortChoice = {
  column: `${ATTR_SORT_PREFIX}0`,
  direction: DashboardWidgetSortDirection.Ascending,
};

const TIME_DEFAULT_SORT: DashboardWidgetSortChoice = {
  column: TIMESTAMP_SORT_KEY,
  direction: DashboardWidgetSortDirection.Ascending,
};

interface ResolvedQueryData {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
  valueColumns: Array<ValueColumn>;
}

/*
 * Tabular view of OneUptime METRIC columns and formulas. Rendering rows
 * from an external Data Source is a separate widget type
 * (DashboardDataSourceTableComponent), so nothing here has to branch on
 * where the rows came from.
 */
const DashboardTableComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [metricResults, setMetricResults] = useState<Array<AggregatedResult>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
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

  /*
   * refreshTick is a dep so each auto-refresh re-resolves the relative
   * range ("Past 1 hour") to a fresh concrete window; without it the
   * window is frozen at mount and every refresh re-queries stale data.
   */
  const startAndEndDate: ReturnType<
    typeof RangeStartAndEndDateTimeUtil.getStartAndEndDate
  > = useMemo(() => {
    return RangeStartAndEndDateTimeUtil.getStartAndEndDate(
      props.dashboardStartAndEndDate,
    );
  }, [props.dashboardStartAndEndDate, props.refreshTick]);

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
  const thresholdStyle: TableThresholdStyle = readTableThresholdStyle(
    args.thresholdStyle,
  );

  const valueColumns: Array<ValueColumn> = resolved.valueColumns;
  const visibleValueColumns: Array<ValueColumn> = useMemo(() => {
    return valueColumns.filter((c: ValueColumn): boolean => {
      return c.visible;
    });
  }, [valueColumns]);

  /*
   * The columns a header click sorts by (issue #5082): every attribute
   * column (A to Z first) or the time column (newest first), and every
   * shown metric or formula column (highest first). The table holds every
   * row of its window before it trims to Max Rows, so it sorts them itself.
   */
  const sortColumns: Array<DashboardWidgetSortColumnInfo> = useMemo(() => {
    const columns: Array<DashboardWidgetSortColumnInfo> = isGroupedMode
      ? widgetGroupByAttributes.map(
          (
            attr: TableGroupByAttribute,
            attrIndex: number,
          ): DashboardWidgetSortColumnInfo => {
            return {
              key: `${ATTR_SORT_PREFIX}${attrIndex}`,
              title: attr.header || attr.key,
              kind: DashboardWidgetSortKind.Text,
              isTitleUserText: true,
            };
          },
        )
      : [
          {
            key: TIMESTAMP_SORT_KEY,
            title: "Timestamp",
            kind: DashboardWidgetSortKind.Date,
          },
        ];

    for (const column of visibleValueColumns) {
      columns.push({
        key: column.key,
        title: column.label,
        kind: DashboardWidgetSortKind.Number,
        isTitleUserText: true,
      });
    }

    return columns;
  }, [isGroupedMode, widgetGroupByAttributes, visibleValueColumns]);

  const widgetSort: DashboardWidgetSortState = useDashboardWidgetSort({
    dashboardId: props.dashboardId,
    componentId: props.componentId.toString(),
    columns: sortColumns,
    savedSort: (args as Record<string, unknown>)[
      DASHBOARD_WIDGET_SORT_ARGUMENT
    ],
    builtInSort: isGroupedMode ? GROUPED_DEFAULT_SORT : TIME_DEFAULT_SORT,
    onSavedSortChange: props.onWidgetSortChange,
  });

  useReportDashboardWidgetSortColumns(props.onWidgetSortColumnsChange, {
    columns: sortColumns,
    builtInSort: isGroupedMode ? GROUPED_DEFAULT_SORT : TIME_DEFAULT_SORT,
  });

  const sortConfig: { columnKey: string | null; direction: "asc" | "desc" } =
    useMemo(() => {
      return {
        columnKey: widgetSort.sort?.column || null,
        direction:
          widgetSort.sort?.direction === DashboardWidgetSortDirection.Descending
            ? "desc"
            : "asc",
      };
    }, [widgetSort.sort?.column, widgetSort.sort?.direction]);

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

    type Row = { tupleKey: string; values: Array<string> };

    /*
     * Default order (also used as the tie-break): alphabetical across the
     * whole attribute tuple.
     */
    const compareByTuple: (a: Row, b: Row) => number = (
      a: Row,
      b: Row,
    ): number => {
      for (let i: number = 0; i < a.values.length; i++) {
        const cmp: number = compareStrings(
          a.values[i] || "",
          b.values[i] || "",
        );
        if (cmp !== 0) {
          return cmp;
        }
      }
      return 0;
    };

    const colKey: string | null = sortConfig.columnKey;

    if (colKey && colKey.startsWith(ATTR_SORT_PREFIX)) {
      // Sort by a single group-by attribute column (e.g. the tenant name).
      const attrIndex: number = Number.parseInt(
        colKey.slice(ATTR_SORT_PREFIX.length),
        10,
      );
      const dir: 1 | -1 = sortConfig.direction === "asc" ? 1 : -1;
      filtered.sort((a: Row, b: Row): number => {
        const cmp: number = compareStrings(
          a.values[attrIndex] || "",
          b.values[attrIndex] || "",
        );
        // Fall back to full-tuple order so equal values stay deterministic.
        return (cmp !== 0 ? cmp : compareByTuple(a, b)) * dir;
      });
    } else if (colKey) {
      // Sort by a value column (metric/formula), reduced per row tuple.
      const dir: 1 | -1 = sortConfig.direction === "asc" ? 1 : -1;
      filtered.sort((a: Row, b: Row): number => {
        const av: number | undefined = reducedByColumnAndTuple
          .get(colKey)
          ?.get(a.tupleKey);
        const bv: number | undefined = reducedByColumnAndTuple
          .get(colKey)
          ?.get(b.tupleKey);
        const aMissing: boolean = av === undefined || Number.isNaN(av);
        const bMissing: boolean = bv === undefined || Number.isNaN(bv);
        // Missing values always sink to the bottom, regardless of direction.
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
      });
    } else {
      filtered.sort(compareByTuple);
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

  const timestampRows: Array<{
    timestampIso: string;
    timestampLabel: string;
    timestampTitle: string;
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
    type TimestampRow = {
      timestampIso: string;
      timestampLabel: string;
      timestampTitle: string;
      valuesByColumnKey: Map<string, number>;
    };
    const rows: Array<TimestampRow> = [];
    for (const [iso, perColumn] of timestampToValues) {
      // Same date + time shape every other widget's timestamp column uses.
      const timestamp: DashboardDateTime = getDashboardDateTime(iso);

      rows.push({
        timestampIso: iso,
        timestampLabel: timestamp.label,
        timestampTitle: timestamp.title,
        valuesByColumnKey: perColumn,
      });
    }

    const byTimestampAsc: (a: TimestampRow, b: TimestampRow) => number = (
      a: TimestampRow,
      b: TimestampRow,
    ): number => {
      return (
        OneUptimeDate.fromString(a.timestampIso).getTime() -
        OneUptimeDate.fromString(b.timestampIso).getTime()
      );
    };

    const colKey: string | null = sortConfig.columnKey;

    if (colKey && colKey !== TIMESTAMP_SORT_KEY) {
      // Sort by one of the value columns; ties fall back to chronological.
      const dir: 1 | -1 = sortConfig.direction === "asc" ? 1 : -1;
      rows.sort((a: TimestampRow, b: TimestampRow): number => {
        const av: number | undefined = a.valuesByColumnKey.get(colKey);
        const bv: number | undefined = b.valuesByColumnKey.get(colKey);
        const aMissing: boolean = av === undefined || Number.isNaN(av);
        const bMissing: boolean = bv === undefined || Number.isNaN(bv);
        if (aMissing && bMissing) {
          return byTimestampAsc(a, b);
        }
        if (aMissing) {
          return 1;
        }
        if (bMissing) {
          return -1;
        }
        return ((av as number) - (bv as number)) * dir;
      });
    } else {
      /*
       * Time column or default: order chronologically. Default (no active
       * sort) stays ascending as before; an explicit click can flip it.
       */
      const dir: 1 | -1 =
        colKey === TIMESTAMP_SORT_KEY && sortConfig.direction === "desc"
          ? -1
          : 1;
      rows.sort((a: TimestampRow, b: TimestampRow): number => {
        return byTimestampAsc(a, b) * dir;
      });
    }
    return rows.slice(0, maxRows);
  }, [isGroupedMode, metricResults, valueColumns, maxRows, sortConfig]);

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
                data-unsaved-changes-ignore
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
                placeholder={translator.translateText("Search rows…")}
                aria-label={translator.translateText("Search rows")}
                className="w-full h-8 pl-8 pr-7 text-xs rounded-md border border-gray-200 bg-white text-gray-700 placeholder-gray-400 shadow-sm transition-colors focus:outline-none focus:border-indigo-400 hover:border-gray-300"
              />
              {searchText.length > 0 && (
                <button
                  type="button"
                  onClick={(): void => {
                    setSearchText("");
                  }}
                  aria-label={translator.translateText("Clear search")}
                  title={translator.translateText("Clear search")}
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
              <TranslatedSentence
                template={{
                  one: "{{shown}} of {{count}} row",
                  other: "{{shown}} of {{count}} rows",
                }}
                count={allRowTuples.length}
                slots={{
                  shown: (
                    <span className="font-medium text-gray-500">
                      {translator.formatNumber(rowCount)}
                    </span>
                  ),
                }}
              />
            ) : (
              translator.translatePlural(
                { one: "{{count}} row", other: "{{count}} rows" },
                rowCount,
              )
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
                    (
                      attr: TableGroupByAttribute,
                      attrIndex: number,
                    ): ReactElement => {
                      return (
                        <DashboardSortableColumnHeader
                          key={`attr:${attrIndex}:${attr.key}`}
                          label={attr.header || attr.key}
                          isLabelUserText={true}
                          paddingClassName="px-3 py-2"
                          sortColumn={findDashboardWidgetSortColumn(
                            sortColumns,
                            `${ATTR_SORT_PREFIX}${attrIndex}`,
                          )}
                          sort={widgetSort.sort}
                          onSortClick={widgetSort.onColumnClick}
                        />
                      );
                    },
                  )
                : [
                    <DashboardSortableColumnHeader
                      key="timestamp"
                      label="Timestamp"
                      paddingClassName="px-3 py-2"
                      sortColumn={findDashboardWidgetSortColumn(
                        sortColumns,
                        TIMESTAMP_SORT_KEY,
                      )}
                      sort={widgetSort.sort}
                      onSortClick={widgetSort.onColumnClick}
                    />,
                  ]}
              {visibleValueColumns.map((column: ValueColumn): ReactElement => {
                return (
                  <DashboardSortableColumnHeader
                    key={column.key}
                    label={column.label}
                    isLabelUserText={true}
                    alignRight={true}
                    paddingClassName="px-3 py-2"
                    sortColumn={findDashboardWidgetSortColumn(
                      sortColumns,
                      column.key,
                    )}
                    sort={widgetSort.sort}
                    onSortClick={widgetSort.onColumnClick}
                  />
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
                            <DashboardTableValueCell
                              key={column.key}
                              value={value}
                              column={column}
                              defaultDecimals={defaultDecimals}
                              thresholdStyle={thresholdStyle}
                            />
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
                    timestampTitle: string;
                    valuesByColumnKey: Map<string, number>;
                  },
                  index: number,
                ): ReactElement => {
                  return (
                    <tr
                      key={`${row.timestampIso}-${index}`}
                      className="hover:bg-gray-50/50 transition-colors duration-100"
                    >
                      <td
                        className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap"
                        title={row.timestampTitle}
                      >
                        {row.timestampLabel}
                      </td>
                      {visibleValueColumns.map(
                        (column: ValueColumn): ReactElement => {
                          const value: number | undefined =
                            row.valuesByColumnKey.get(column.key);
                          return (
                            <DashboardTableValueCell
                              key={column.key}
                              value={value}
                              column={column}
                              defaultDecimals={defaultDecimals}
                              thresholdStyle={thresholdStyle}
                            />
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
                  {translator.translateText(
                    "No data available for the selected time range.",
                  )}
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

  /*
   * Widget-level attribute filter (e.g. environment = production). Applied
   * to every metric column's query so the whole table is scoped to the same
   * subset of series. Omitted when empty so unfiltered widgets behave exactly
   * as before.
   */
  const widgetAttributeFilters: DashboardTableComponent["arguments"]["attributeFilters"] =
    args.attributeFilters && Object.keys(args.attributeFilters).length > 0
      ? args.attributeFilters
      : undefined;

  if (columns.length > 0) {
    for (const column of columns) {
      const visible: boolean = column.showAsColumn !== false;
      const resolvedUnit: string | undefined =
        column.unit && column.unit.length > 0
          ? column.unit
          : column.kind === TableColumnKind.Metric && column.metricName
            ? unitsByMetricName.get(column.metricName)
            : undefined;
      /*
       * How the cells show the column - a usage metric sent as a fraction
       * shows as a percent - and the thresholds, compared in that scale.
       */
      const display: TableColumnDisplay =
        column.kind === TableColumnKind.Metric
          ? getTableColumnDisplay({
              columnUnit: column.unit,
              metricUnit: column.metricName
                ? unitsByMetricName.get(column.metricName)
                : undefined,
              metricName: column.metricName,
            })
          : getTableColumnDisplay({ columnUnit: column.unit });
      const thresholds: TableColumnThresholds | null =
        readTableColumnThresholds(column.thresholds);
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
              ...(widgetAttributeFilters
                ? { attributes: widgetAttributeFilters as any }
                : {}),
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
          unit: display.unit,
          factor: display.factor,
          thresholds,
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
          unit: display.unit,
          factor: display.factor,
          thresholds,
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
    const legacyDisplay: TableColumnDisplay = getTableColumnDisplay({
      metricUnit: legacyMetricName
        ? unitsByMetricName.get(legacyMetricName)
        : undefined,
      metricName: legacyMetricName,
    });
    valueColumns.push({
      key: `legacy:primary`,
      label:
        args.metricQueryConfig.metricAliasData?.legend ||
        args.metricQueryConfig.metricAliasData?.metricVariable?.toUpperCase() ||
        legacyMetricName ||
        "Value",
      decimals: undefined,
      unit: legacyDisplay.unit,
      factor: legacyDisplay.factor,
      thresholds: null,
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
      const legacyDisplay: TableColumnDisplay = getTableColumnDisplay({
        metricUnit: legacyMetricName
          ? unitsByMetricName.get(legacyMetricName)
          : undefined,
        metricName: legacyMetricName,
      });
      valueColumns.push({
        key: `legacy:q:${config.metricAliasData?.metricVariable || valueColumns.length}`,
        label:
          config.metricAliasData?.legend ||
          config.metricAliasData?.metricVariable?.toUpperCase() ||
          legacyMetricName ||
          "Value",
        decimals: undefined,
        unit: legacyDisplay.unit,
        factor: legacyDisplay.factor,
        thresholds: null,
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
        factor: 1,
        thresholds: null,
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

function compareStrings(a: string, b: string): number {
  /*
   * Locale-aware, case-insensitive, and numeric-aware so attribute values
   * like hostnames sort naturally: "server2" before "server10", and casing
   * doesn't split otherwise-identical groups.
   */
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
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
