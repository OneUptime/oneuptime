import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import DashboardTraceTableComponent from "Common/Types/Dashboard/DashboardComponents/DashboardTraceTableComponent";
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
import JSONFunctions from "Common/Types/JSONFunctions";
import DashboardResourceList from "../Utils/DashboardResourceList";
import {
  TraceTableRow,
  buildTraceTableRequest,
  dimensionLabel,
  displayGroupValue,
  formatDurationMs,
  isTraceTableGroupSortable,
} from "./TraceTableData";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import {
  DASHBOARD_WIDGET_SORT_ARGUMENT,
  DashboardWidgetSortColumnInfo,
  findDashboardWidgetSortColumn,
  formatDashboardWidgetSortChoice,
} from "Common/Types/Dashboard/DashboardWidgetSort";
import useDashboardWidgetSort, {
  DashboardWidgetSortState,
  useReportDashboardWidgetSortColumns,
} from "Common/UI/Utils/UseDashboardWidgetSort";
import {
  DashboardWidgetListSortColumn,
  getDashboardWidgetSortColumns,
  getDashboardWidgetSortSpec,
} from "Common/Utils/Dashboard/DashboardWidgetSorts";
import DashboardSortableColumnHeader from "./DashboardSortableColumnHeader";
import useDashboardWidgetColumns, {
  DashboardWidgetColumn,
  DashboardWidgetColumns,
} from "./DashboardWidgetColumns";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardTraceTableComponent;
}

// The rank column's header; the sortable ones draw their own.
const HEADER_CELL: string =
  "px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-gray-400";

// The metric columns, by their sort keys and header words.
const METRIC_HEADERS: Array<{ key: string; label: string }> = [
  { key: "count", label: "Requests" },
  { key: "errorCount", label: "Errors" },
  { key: "avg", label: "Avg" },
  { key: "p50", label: "P50" },
  { key: "p90", label: "P90" },
  { key: "p95", label: "P95" },
  { key: "p99", label: "P99" },
  { key: "min", label: "Min" },
  { key: "max", label: "Max" },
];

/*
 * The table's sortable columns (issue #5082): every metric column, and the
 * group column under the dimension's own name - unless the table is grouped
 * by a resource, whose ids the server names only after ranking the rows.
 */
function getTraceTableSortColumns(
  groupByAttribute: string | undefined,
): Array<DashboardWidgetSortColumnInfo> {
  return getDashboardWidgetSortColumns(DashboardComponentType.TraceTable)
    .filter((column: DashboardWidgetListSortColumn): boolean => {
      return (
        column.key !== "group" || isTraceTableGroupSortable(groupByAttribute)
      );
    })
    .map(
      (
        column: DashboardWidgetListSortColumn,
      ): DashboardWidgetSortColumnInfo => {
        return column.key === "group"
          ? { ...column, title: dimensionLabel(groupByAttribute || "") }
          : column;
      },
    );
}

const DashboardTraceTableComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [rows, setRows] = useState<Array<TraceTableRow>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Staleness guard — see TracesAnalyticsView for rationale.
  const requestSequenceRef: React.MutableRefObject<number> = useRef<number>(0);

  const groupByAttribute: string | undefined =
    props.component.arguments.groupByAttribute?.trim() || undefined;

  const sortColumns: Array<DashboardWidgetSortColumnInfo> =
    getTraceTableSortColumns(groupByAttribute);

  // The busiest groups first, unless the viewer or the widget says otherwise.
  const widgetSort: DashboardWidgetSortState = useDashboardWidgetSort({
    dashboardId: props.dashboardId,
    componentId: props.componentId.toString(),
    columns: sortColumns,
    savedSort: (props.component.arguments as Record<string, unknown>)[
      DASHBOARD_WIDGET_SORT_ARGUMENT
    ],
    builtInSort:
      getDashboardWidgetSortSpec(DashboardComponentType.TraceTable)
        ?.defaultSort || null,
    onSavedSortChange: props.onWidgetSortChange,
  });

  useReportDashboardWidgetSortColumns(props.onWidgetSortColumnsChange, {
    columns: sortColumns,
    builtInSort:
      getDashboardWidgetSortSpec(DashboardComponentType.TraceTable)
        ?.defaultSort || null,
  });

  /*
   * Its columns as wide as each person makes them, after each row's number:
   * the group's values give way to 10rem, a count or a duration is never
   * cut.
   */
  const groupKeysForWidths: Array<string> = Object.keys(
    rows[0]?.groupValues || {},
  );
  const widgetColumns: DashboardWidgetColumns = useDashboardWidgetColumns(
    [
      ...groupKeysForWidths.map(
        (key: string, index: number): DashboardWidgetColumn => {
          return {
            id: `group:${key}`,
            kind: index === 0 ? ColumnWidthKind.Name : ColumnWidthKind.Text,
          };
        },
      ),
      ...METRIC_HEADERS.map(
        (header: { key: string; label: string }): DashboardWidgetColumn => {
          return { id: header.key, kind: ColumnWidthKind.Whole };
        },
      ),
    ],
    1,
  );

  const sortKey: string = widgetSort.sort
    ? formatDashboardWidgetSortChoice(widgetSort.sort)
    : "";

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
      setError("Trace tables are not available on public dashboards.");
      return;
    }

    /*
     * A table is a breakdown by dimension — without a group-by there is
     * nothing to tabulate. Prompt instead of firing a request the backend
     * would reject.
     */
    if (!groupByAttribute) {
      setIsLoading(false);
      setRows([]);
      setError(null);
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
      const requestData: JSONObject = buildTraceTableRequest({
        arguments: props.component.arguments,
        startTime: startAndEndDate.startValue,
        endTime: startAndEndDate.endValue,
        variables: props.variables,
        sort: widgetSort.sort,
      });

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
      setRows(data as Array<TraceTableRow>);
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
    groupByAttribute,
    props.component.arguments.spanNameContains,
    props.component.arguments.attributeFilters,
    props.component.arguments.topLimit,
    props.component.arguments.includeChildSpans,
    props.variables,
    sortKey,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData, props.refreshTick]);

  const renderTable: () => ReactElement = (): ReactElement => {
    const groupKeys: Array<string> = Object.keys(rows[0]?.groupValues || {});

    return (
      <div className="overflow-auto rounded-lg border border-gray-200/80">
        {widgetColumns.resizable.styles}
        <table
          className={
            widgetColumns.resizable.areAllColumnsSized ? "w-max" : "min-w-full"
          }
          {...widgetColumns.resizable.tableAttributes}
        >
          <thead>
            <tr className="border-b border-gray-200/80 bg-gray-50/80 text-[11px] text-gray-400">
              <th className={`w-8 text-left ${HEADER_CELL}`}>#</th>
              {groupKeys.map((key: string, index: number) => {
                return (
                  <DashboardSortableColumnHeader
                    key={key}
                    label={dimensionLabel(key)}
                    paddingClassName="px-3 py-2"
                    sortColumn={
                      index === 0
                        ? findDashboardWidgetSortColumn(sortColumns, "group")
                        : null
                    }
                    sort={widgetSort.sort}
                    onSortClick={widgetSort.onColumnClick}
                    resize={widgetColumns.getResize(`group:${key}`)}
                  />
                );
              })}
              {METRIC_HEADERS.map(
                (header: { key: string; label: string }): ReactElement => {
                  return (
                    <DashboardSortableColumnHeader
                      key={header.key}
                      label={header.label}
                      alignRight={true}
                      paddingClassName="px-3 py-2"
                      sortColumn={findDashboardWidgetSortColumn(
                        sortColumns,
                        header.key,
                      )}
                      sort={widgetSort.sort}
                      onSortClick={widgetSort.onColumnClick}
                      resize={widgetColumns.getResize(header.key)}
                    />
                  );
                },
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row: TraceTableRow, index: number) => {
              return (
                <tr
                  key={index}
                  className="border-b border-gray-100/80 transition-colors last:border-b-0 hover:bg-gray-50/50"
                >
                  <td className="px-3 py-2 font-mono text-[11px] text-gray-300">
                    {index + 1}
                  </td>
                  {groupKeys.map((key: string) => {
                    return (
                      <td
                        key={key}
                        className="max-w-[280px] truncate whitespace-nowrap px-3 py-2 text-sm text-gray-700"
                      >
                        {displayGroupValue(key, row.groupValues[key] || "")}
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-sm font-semibold tabular-nums text-gray-800">
                    {row.count.toLocaleString()}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2 text-right font-mono text-sm tabular-nums ${
                      row.errorCount > 0
                        ? "font-semibold text-red-600"
                        : "text-gray-400"
                    }`}
                  >
                    {row.errorCount.toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-sm tabular-nums text-gray-700">
                    {formatDurationMs(row.avgDurationMs)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-sm tabular-nums text-gray-700">
                    {formatDurationMs(row.p50DurationMs)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-sm tabular-nums text-gray-700">
                    {formatDurationMs(row.p90DurationMs)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-sm tabular-nums text-gray-700">
                    {formatDurationMs(row.p95DurationMs)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-sm tabular-nums text-gray-700">
                    {formatDurationMs(row.p99DurationMs)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums text-gray-500">
                    {formatDurationMs(row.minDurationMs)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums text-gray-500">
                    {formatDurationMs(row.maxDurationMs)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="flex h-full w-full flex-col">
      {props.component.arguments.title && (
        <div className="mb-1 px-1 text-sm font-medium text-gray-700">
          {props.component.arguments.title}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {/*
         * The first read shows the loader; a later one - a refresh, a click
         * on a column header - keeps the rows in place, dimmed, so the table
         * does not flash away while it re-sorts.
         */}
        {isLoading && (rows.length === 0 || Boolean(error)) && (
          <div className="flex h-full items-center justify-center">
            <ComponentLoader />
          </div>
        )}
        {!isLoading && error && <ErrorMessage message={error} />}
        {!isLoading && !error && !groupByAttribute && (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-gray-400">
            {translator.translateText(
              "Choose a “Group rows by” dimension in the widget settings to populate this table.",
            )}
          </div>
        )}
        {!isLoading && !error && groupByAttribute && rows.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-gray-400">
            {translator.translateText("No data for the selected time range")}
          </div>
        )}
        {!error && groupByAttribute && rows.length > 0 && (
          <div
            className="p-1"
            style={{
              opacity: isLoading ? 0.5 : 1,
              transition: "opacity 0.2s ease-in-out",
            }}
          >
            {renderTable()}
          </div>
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

  if (
    !JSONFunctions.deepEqual(prev.component.arguments, next.component.arguments)
  ) {
    return false;
  }

  /*
   * Variable selections feed the request's attribute filter, so a toolbar
   * pick has to get past the memo — without this the widget keeps rendering
   * the pre-selection data.
   */
  return JSONFunctions.deepEqual(prev.variables, next.variables);
}

export default React.memo(DashboardTraceTableComponentElement, arePropsEqual);
