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
} from "./TraceTableData";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardTraceTableComponent;
}

const HEADER_CELL: string =
  "px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400";

const DashboardTraceTableComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rows, setRows] = useState<Array<TraceTableRow>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Staleness guard — see TracesAnalyticsView for rationale.
  const requestSequenceRef: React.MutableRefObject<number> = useRef<number>(0);

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
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData, props.refreshTick]);

  const renderTable: () => ReactElement = (): ReactElement => {
    const groupKeys: Array<string> = Object.keys(rows[0]?.groupValues || {});

    return (
      <div className="overflow-auto rounded-lg border border-gray-200/80">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-gray-200/80 bg-gray-50/80">
              <th className={`w-8 text-left ${HEADER_CELL}`}>#</th>
              {groupKeys.map((key: string) => {
                return (
                  <th key={key} className={`text-left ${HEADER_CELL}`}>
                    {dimensionLabel(key)}
                  </th>
                );
              })}
              <th className={`text-right ${HEADER_CELL}`}>Requests</th>
              <th className={`text-right ${HEADER_CELL}`}>Errors</th>
              <th className={`text-right ${HEADER_CELL}`}>Avg</th>
              <th className={`text-right ${HEADER_CELL}`}>P50</th>
              <th className={`text-right ${HEADER_CELL}`}>P90</th>
              <th className={`text-right ${HEADER_CELL}`}>P95</th>
              <th className={`text-right ${HEADER_CELL}`}>P99</th>
              <th className={`text-right ${HEADER_CELL}`}>Min</th>
              <th className={`text-right ${HEADER_CELL}`}>Max</th>
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
        {isLoading && (
          <div className="flex h-full items-center justify-center">
            <ComponentLoader />
          </div>
        )}
        {!isLoading && error && <ErrorMessage message={error} />}
        {!isLoading && !error && !groupByAttribute && (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-gray-400">
            Choose a &ldquo;Group rows by&rdquo; dimension in the widget
            settings to populate this table.
          </div>
        )}
        {!isLoading && !error && groupByAttribute && rows.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-gray-400">
            No data for the selected time range
          </div>
        )}
        {!isLoading && !error && groupByAttribute && rows.length > 0 && (
          <div className="p-1">{renderTable()}</div>
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

export default React.memo(DashboardTraceTableComponentElement, arePropsEqual);
