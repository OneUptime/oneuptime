import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import DashboardDataSourceTableComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardDataSourceTableComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import DataSourceTableResult, {
  DataSourceTableColumn,
  DataSourceTableColumnType,
} from "Common/Types/DataSource/DataSourceTableResult";
import DataSourceQueryConfig from "Common/Types/DataSource/DataSourceQueryConfig";
import DataSourceQueryUtil from "../../../Utils/DataSourceQuery";
import DataSourceQueryText from "Common/Utils/DataSource/DataSourceQueryText";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import { isPublicDashboard } from "../Utils/PublicDashboardContext";
import {
  isDataSourceQueryConfigured,
  sortDataSourceTableRows,
} from "../Utils/DataSourceWidget";
import DataSourceWidgetPlaceholder from "./DataSourceWidgetPlaceholder";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import API from "Common/UI/Utils/API/API";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import JSONFunctions from "Common/Types/JSONFunctions";
import { JSONValue } from "Common/Types/JSON";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  DASHBOARD_WIDGET_SORT_ARGUMENT,
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
import useDashboardWidgetColumns, {
  DashboardWidgetColumn,
  DashboardWidgetColumns,
} from "./DashboardWidgetColumns";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardDataSourceTableComponentType;
}

/*
 * How a result column sorts: numbers highest first, dates newest first,
 * everything else A to Z.
 */
function getColumnSortKind(
  column: DataSourceTableColumn,
): DashboardWidgetSortKind {
  if (column.type === DataSourceTableColumnType.Number) {
    return DashboardWidgetSortKind.Number;
  }

  if (column.type === DataSourceTableColumnType.Date) {
    return DashboardWidgetSortKind.Date;
  }

  return DashboardWidgetSortKind.Text;
}

/*
 * Table renderer for widgets bound to an EXTERNAL Data Source: runs the
 * stored query through /data-source/query (Table result kind) and renders
 * the returned rows. Styling mirrors the metric table widget so the two
 * modes are indistinguishable at a glance.
 *
 * The rows come in the query's own order. A header click sorts the rows
 * the query returned (issue #5082): its column first one way, then the
 * other, then back to the query's order - remembered in the viewer's
 * browser, with the widget's own sort (arguments.sort) as the order
 * everyone starts on. The widget's Max Rows trims AFTER sorting, so "top
 * 10 by this column" means what it says; the connector's own row cap still
 * applies first, as the query decides what comes back.
 */
const DashboardDataSourceTableComponent: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [result, setResult] = useState<DataSourceTableResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const sortColumns: Array<DashboardWidgetSortColumnInfo> = useMemo(() => {
    return (result?.columns || []).map(
      (column: DataSourceTableColumn): DashboardWidgetSortColumnInfo => {
        return {
          key: column.key,
          title: column.title,
          kind: getColumnSortKind(column),
          isTitleUserText: true,
        };
      },
    );
  }, [result]);

  // The query's order until a viewer or the widget's own sort says otherwise.
  const widgetSort: DashboardWidgetSortState = useDashboardWidgetSort({
    dashboardId: props.dashboardId,
    componentId: props.componentId.toString(),
    columns: sortColumns,
    // Before the first answer the columns are not known yet.
    areColumnsKnown: result !== null,
    savedSort: (props.component.arguments as Record<string, unknown>)[
      DASHBOARD_WIDGET_SORT_ARGUMENT
    ],
    builtInSort: null,
    onSavedSortChange: props.onWidgetSortChange,
  });

  useReportDashboardWidgetSortColumns(props.onWidgetSortColumnsChange, {
    columns: sortColumns,
    builtInSort: null,
  });

  const sortKey: string | null = widgetSort.sort?.column || null;
  const sortDirection: DashboardWidgetSortDirection =
    widgetSort.sort?.direction || DashboardWidgetSortDirection.Ascending;

  const rawQueryConfig: DataSourceQueryConfig | undefined =
    props.component.arguments.query;

  const isConfigured: boolean = isDataSourceQueryConfigured(rawQueryConfig);

  const queryConfig: DataSourceQueryConfig | undefined = isConfigured
    ? rawQueryConfig
    : undefined;

  const startAndEndDate: ReturnType<
    typeof RangeStartAndEndDateTimeUtil.getStartAndEndDate
  > = useMemo(() => {
    return RangeStartAndEndDateTimeUtil.getStartAndEndDate(
      props.dashboardStartAndEndDate,
    );
  }, [props.dashboardStartAndEndDate, props.refreshTick]);

  const fetchStateRef: React.MutableRefObject<{
    queryConfig: DataSourceQueryConfig | undefined;
    variables: Array<DashboardVariable> | undefined;
    startDate: Date | undefined;
    endDate: Date | undefined;
  }> = useRef({
    queryConfig: queryConfig,
    variables: props.variables,
    startDate: startAndEndDate?.startValue,
    endDate: startAndEndDate?.endValue,
  });
  fetchStateRef.current = {
    queryConfig: queryConfig,
    variables: props.variables,
    startDate: startAndEndDate?.startValue,
    endDate: startAndEndDate?.endValue,
  };

  // Monotonic id of the newest fetch — see the staleness guard below.
  const fetchSequenceRef: React.MutableRefObject<number> = useRef(0);

  const fetchRows: () => Promise<void> = useCallback(async () => {
    const state: typeof fetchStateRef.current = fetchStateRef.current;
    /*
     * Staleness guard: refresh ticks and config edits can overlap slow
     * requests — only the NEWEST fetch may write state, or an old
     * response would overwrite a newer result (and clear a newer error).
     */
    const fetchId: number = ++fetchSequenceRef.current;
    setIsLoading(true);

    if (!state.queryConfig || !state.startDate || !state.endDate) {
      setIsLoading(false);
      return;
    }

    try {
      const interpolatedQuery: string = DataSourceQueryText.applyVariables(
        state.queryConfig.query,
        state.variables,
      );
      const fetched: DataSourceTableResult =
        await DataSourceQueryUtil.fetchTable({
          queryConfig: { ...state.queryConfig, query: interpolatedQuery },
          startDate: state.startDate,
          endDate: state.endDate,
        });
      if (fetchId !== fetchSequenceRef.current) {
        return;
      }
      setResult(fetched);
      setError("");
    } catch (err: unknown) {
      if (fetchId !== fetchSequenceRef.current) {
        return;
      }
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (isPublicDashboard()) {
      setIsLoading(false);
      return;
    }
    fetchRows();
  }, [
    startAndEndDate,
    queryConfig,
    props.variables,
    props.refreshTick,
    fetchRows,
  ]);

  const sortedRows: Array<{ [key: string]: JSONValue }> = useMemo(() => {
    return sortDataSourceTableRows(result?.rows || [], sortKey, sortDirection);
  }, [result, sortKey, sortDirection]);

  /*
   * The widget's own row cap, applied AFTER sorting so "top 10 by this
   * column" means what it says. The connector's cap already ran server-side
   * — this only trims what gets drawn.
   */
  const visibleRows: Array<{ [key: string]: JSONValue }> = useMemo(() => {
    const maxRows: number | undefined = props.component.arguments.maxRows;
    if (maxRows === undefined || maxRows === null || maxRows <= 0) {
      return sortedRows;
    }
    return sortedRows.slice(0, maxRows);
  }, [sortedRows, props.component.arguments.maxRows]);

  const formatCell: (
    value: JSONValue,
    column: DataSourceTableColumn,
  ) => string = useCallback(
    (value: JSONValue, column: DataSourceTableColumn): string => {
      if (value === null || value === undefined) {
        return "-";
      }
      if (
        column.type === DataSourceTableColumnType.Number &&
        typeof value === "number"
      ) {
        return Number.isInteger(value)
          ? value.toLocaleString()
          : value.toLocaleString(undefined, { maximumFractionDigits: 4 });
      }
      if (column.type === DataSourceTableColumnType.Date) {
        const parsed: Date = new Date(String(value));
        return isNaN(parsed.getTime())
          ? String(value)
          : parsed.toLocaleString();
      }
      return String(value);
    },
    [],
  );

  const title: string | undefined = props.component.arguments.tableTitle;
  const description: string | undefined =
    props.component.arguments.tableDescription;

  /*
   * Its columns as wide as each person makes them: a number is never cut,
   * any other value gives way to 8rem (the first, the row's name, to 10rem).
   */
  const widgetColumns: DashboardWidgetColumns = useDashboardWidgetColumns(
    (result?.columns || []).map(
      (column: DataSourceTableColumn, index: number): DashboardWidgetColumn => {
        return {
          id: column.key,
          kind:
            column.type === DataSourceTableColumnType.Number
              ? ColumnWidthKind.Whole
              : index === 0
                ? ColumnWidthKind.Name
                : ColumnWidthKind.Text,
        };
      },
    ),
  );

  if (isPublicDashboard()) {
    return <DataSourceWidgetPlaceholder icon={IconProp.TableCells} />;
  }

  if (!isConfigured) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-1.5">
        <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center">
          <div className="h-5 w-5 text-indigo-300">
            <Icon icon={IconProp.TableCells} />
          </div>
        </div>
        <p className="text-xs font-medium text-gray-500">
          {title || translator.translateText("Data Source Table")}
        </p>
        <p className="text-xs text-gray-400 text-center">
          {translator.translateText("Click to configure a query")}
        </p>
      </div>
    );
  }

  if (isLoading && !result) {
    return (
      <div className="h-full flex flex-col animate-pulse p-1">
        <div className="h-3 w-24 bg-gray-100 rounded mb-3"></div>
        <div className="flex-1 space-y-2">
          {Array.from({ length: 5 }).map((_: unknown, i: number) => {
            return (
              <div key={i} className="flex gap-4">
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

  const columns: Array<DataSourceTableColumn> = result?.columns || [];

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
          {title && (
            <h3 className="text-sm font-semibold text-gray-700 tracking-tight truncate">
              {title}
            </h3>
          )}
          {description && (
            <p className="mt-0.5 text-xs text-gray-400">{description}</p>
          )}
        </div>
        <span className="text-xs text-gray-400 tabular-nums whitespace-nowrap">
          {translator.translatePlural(
            { one: "{{count}} row", other: "{{count}} rows" },
            visibleRows.length,
          )}
          {result?.truncated || visibleRows.length < sortedRows.length
            ? ` ${translator.translateText("(truncated)")}`
            : ""}
        </span>
      </div>
      {columns.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-gray-400">
            {translator.translateText("No rows returned.")}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto rounded-md border border-gray-100 mx-1 mb-1">
          {widgetColumns.resizable.styles}
          <table
            className={`${widgetColumns.tableWidthClassName} text-sm text-left`}
            {...widgetColumns.resizable.tableAttributes}
          >
            <thead className="text-xs text-gray-400 uppercase bg-gray-50/80 sticky top-0 border-b border-gray-100">
              <tr>
                {columns.map((column: DataSourceTableColumn): ReactElement => {
                  return (
                    <DashboardSortableColumnHeader
                      key={column.key}
                      label={column.title}
                      // The query's own column names, shown as written.
                      isLabelUserText={true}
                      alignRight={
                        column.type === DataSourceTableColumnType.Number
                      }
                      paddingClassName="px-3 py-2"
                      sortColumn={findDashboardWidgetSortColumn(
                        sortColumns,
                        column.key,
                      )}
                      sort={widgetSort.sort}
                      onSortClick={widgetSort.onColumnClick}
                      resize={widgetColumns.getResize(column.key)}
                    />
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visibleRows.map(
                (
                  row: { [key: string]: JSONValue },
                  rowIndex: number,
                ): ReactElement => {
                  return (
                    <tr key={rowIndex} className="hover:bg-gray-50/60">
                      {columns.map(
                        (column: DataSourceTableColumn): ReactElement => {
                          const isNumeric: boolean =
                            column.type === DataSourceTableColumnType.Number;
                          return (
                            <td
                              key={column.key}
                              className={`px-3 py-1.5 text-xs text-gray-600 ${
                                isNumeric ? "text-right tabular-nums" : ""
                              }`}
                            >
                              {formatCell(row[column.key] ?? null, column)}
                            </td>
                          );
                        },
                      )}
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
        </div>
      )}
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

  if (
    !JSONFunctions.deepEqual(prev.component.arguments, next.component.arguments)
  ) {
    return false;
  }

  return JSONFunctions.deepEqual(prev.variables, next.variables);
}

export default React.memo(DashboardDataSourceTableComponent, arePropsEqual);
