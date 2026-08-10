import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import DashboardTableComponent from "Common/Types/Dashboard/DashboardComponents/DashboardTableComponent";
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
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import API from "Common/UI/Utils/API/API";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONValue } from "Common/Types/JSON";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardTableComponent;
}

type SortDirection = "asc" | "desc";

/*
 * Table renderer for widgets bound to an EXTERNAL Data Source: runs the
 * stored query through /data-source/query (Table result kind) and renders
 * the returned rows with client-side sorting. Styling mirrors the metric
 * table widget so the two modes are indistinguishable at a glance.
 */
const DashboardDataSourceTableComponent: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [result, setResult] = useState<DataSourceTableResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const queryConfig: DataSourceQueryConfig | undefined =
    props.component.arguments.dataSourceQueryConfig;

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

    if (
      !state.queryConfig ||
      !state.queryConfig.dataSourceId ||
      !state.queryConfig.query ||
      !state.startDate ||
      !state.endDate
    ) {
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

  const toggleSort: (key: string) => void = useCallback(
    (key: string): void => {
      if (sortKey === key) {
        setSortDirection(sortDirection === "asc" ? "desc" : "asc");
        return;
      }
      setSortKey(key);
      setSortDirection("asc");
    },
    [sortKey, sortDirection],
  );

  const sortedRows: Array<{ [key: string]: JSONValue }> = useMemo(() => {
    const rows: Array<{ [key: string]: JSONValue }> = result?.rows || [];
    if (!sortKey) {
      return rows;
    }
    const direction: number = sortDirection === "asc" ? 1 : -1;
    return [...rows].sort(
      (
        a: { [key: string]: JSONValue },
        b: { [key: string]: JSONValue },
      ): number => {
        const aValue: JSONValue = a[sortKey] ?? null;
        const bValue: JSONValue = b[sortKey] ?? null;
        if (aValue === null && bValue === null) {
          return 0;
        }
        if (aValue === null) {
          return direction;
        }
        if (bValue === null) {
          return -direction;
        }
        if (typeof aValue === "number" && typeof bValue === "number") {
          return (aValue - bValue) * direction;
        }
        return String(aValue).localeCompare(String(bValue)) * direction;
      },
    );
  }, [result, sortKey, sortDirection]);

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

  if (isPublicDashboard()) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-2">
        <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center">
          <div className="h-5 w-5 text-gray-300">
            <Icon icon={IconProp.Database} />
          </div>
        </div>
        <p className="text-xs text-gray-400 text-center max-w-48">
          External data sources are not available on public dashboards.
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
          {sortedRows.length} {sortedRows.length === 1 ? "row" : "rows"}
          {result?.truncated ? " (truncated)" : ""}
        </span>
      </div>
      {columns.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-gray-400">No rows returned.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto rounded-md border border-gray-100 mx-1 mb-1">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-gray-400 uppercase bg-gray-50/80 sticky top-0 border-b border-gray-100">
              <tr>
                {columns.map((column: DataSourceTableColumn): ReactElement => {
                  const isNumeric: boolean =
                    column.type === DataSourceTableColumnType.Number;
                  return (
                    <th
                      key={column.key}
                      className={`px-3 py-2 font-medium tracking-wider cursor-pointer select-none hover:bg-gray-100/60 ${
                        isNumeric ? "text-right" : ""
                      }`}
                      onClick={(): void => {
                        toggleSort(column.key);
                      }}
                      title="Click to sort"
                    >
                      {column.title}
                      {sortKey === column.key
                        ? sortDirection === "asc"
                          ? " ▲"
                          : " ▼"
                        : ""}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sortedRows.map(
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

export default DashboardDataSourceTableComponent;
