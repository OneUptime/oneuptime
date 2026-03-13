import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Log from "../../../../Models/AnalyticsModels/Log";
import Service from "../../../../Models/DatabaseModels/Service";
import Dictionary from "../../../../Types/Dictionary";
import OneUptimeDate from "../../../../Types/Date";
import CopyTextButton from "../../CopyTextButton/CopyTextButton";
import ComponentLoader from "../../ComponentLoader/ComponentLoader";
import SeverityBadge from "./SeverityBadge";
import { getSeverityTheme, SeverityTheme } from "./severityTheme";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import {
  getLogsAttributeKeyFromColumnId,
  isLogsAttributeColumnId,
  normalizeLogsTableColumns,
} from "../types";

export interface LogsTableProps {
  logs: Array<Log>;
  serviceMap: Dictionary<Service>;
  isLoading: boolean;
  emptyMessage?: string | undefined;
  onRowClick: (log: Log, rowId: string) => void;
  selectedLogId?: string | null;
  renderExpandedContent?: (log: Log) => ReactElement | null;
  sortField?: LogsTableSortField | undefined;
  sortOrder?: SortOrder | undefined;
  onSortChange?: (field: LogsTableSortField) => void;
  selectedColumns?: Array<string> | undefined;
  focusedRowIndex?: number | undefined;
}

export const resolveLogIdentifier: (log: Log, index: number) => string = (
  log: Log,
  index: number,
): string => {
  const possibleIds: Array<unknown> = [
    (log as any).id,
    (log as any)._id,
    (log as any)._objectId,
    log.traceId,
    log.timeUnixNano,
  ];

  for (const candidate of possibleIds) {
    if (!candidate) {
      continue;
    }

    try {
      return candidate.toString();
    } catch {
      continue;
    }
  }

  return `log-row-${index}`;
};

export type LogsTableSortField = "time" | "severityText";

const stringifyLogValue: (value: unknown) => string = (
  value: unknown,
): string => {
  if (value === undefined || value === null) {
    return "-";
  }

  if (typeof value === "string") {
    return value || "-";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value.toString();
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const LogsTable: FunctionComponent<LogsTableProps> = (
  props: LogsTableProps,
): ReactElement => {
  const showEmptyState: boolean = !props.isLoading && props.logs.length === 0;
  const activeSortField: LogsTableSortField | undefined = props.sortField;
  const activeSortOrder: SortOrder = props.sortOrder || SortOrder.Descending;
  const selectedColumns: Array<string> = normalizeLogsTableColumns(
    props.selectedColumns,
  );
  const showTraceColumn: boolean = selectedColumns.includes("traceId");
  const showSpanColumn: boolean = selectedColumns.includes("spanId");

  const resolveSortIcon: (field: LogsTableSortField) => IconProp = (
    field: LogsTableSortField,
  ): IconProp => {
    if (activeSortField !== field) {
      return IconProp.ArrowUpDown;
    }

    return activeSortOrder === SortOrder.Descending
      ? IconProp.ChevronDown
      : IconProp.ChevronUp;
  };

  const resolveSortIconClass: (field: LogsTableSortField) => string = (
    field: LogsTableSortField,
  ): string => {
    const base: string = "h-3.5 w-3.5 flex-none transition-colors";
    if (activeSortField === field) {
      return `${base} text-indigo-500`;
    }

    return `${base} text-gray-300`;
  };

  const getHeaderCell: (columnId: string) => ReactElement = (
    columnId: string,
  ): ReactElement => {
    if (columnId === "time") {
      return (
        <th scope="col" className="px-4 py-2.5" key={columnId}>
          <button
            type="button"
            className={`flex items-center gap-2 text-left font-semibold tracking-wider text-gray-500 transition-colors hover:text-gray-700 focus:outline-none ${
              activeSortField === "time" ? "text-gray-700" : ""
            }`}
            onClick={() => {
              props.onSortChange?.("time");
            }}
            aria-sort={
              activeSortField === "time"
                ? activeSortOrder === SortOrder.Descending
                  ? "descending"
                  : "ascending"
                : "none"
            }
          >
            <span>Time</span>
            <Icon
              icon={resolveSortIcon("time")}
              className={resolveSortIconClass("time")}
              aria-hidden="true"
            />
          </button>
        </th>
      );
    }

    if (columnId === "severity") {
      return (
        <th scope="col" className="px-4 py-2.5" key={columnId}>
          <button
            type="button"
            className={`flex items-center gap-2 text-left font-semibold tracking-wider text-gray-500 transition-colors hover:text-gray-700 focus:outline-none ${
              activeSortField === "severityText" ? "text-gray-700" : ""
            }`}
            onClick={() => {
              props.onSortChange?.("severityText");
            }}
            aria-sort={
              activeSortField === "severityText"
                ? activeSortOrder === SortOrder.Descending
                  ? "descending"
                  : "ascending"
                : "none"
            }
          >
            <span>Severity</span>
            <Icon
              icon={resolveSortIcon("severityText")}
              className={resolveSortIconClass("severityText")}
              aria-hidden="true"
            />
          </button>
        </th>
      );
    }

    if (columnId === "service") {
      return (
        <th scope="col" className="px-4 py-2.5" key={columnId}>
          Service
        </th>
      );
    }

    if (columnId === "message") {
      return (
        <th scope="col" className="px-4 py-2.5" key={columnId}>
          Message
        </th>
      );
    }

    if (columnId === "traceId") {
      return (
        <th scope="col" className="px-4 py-2.5" key={columnId}>
          Trace ID
        </th>
      );
    }

    if (columnId === "spanId") {
      return (
        <th scope="col" className="px-4 py-2.5" key={columnId}>
          Span ID
        </th>
      );
    }

    return (
      <th scope="col" className="px-4 py-2.5" key={columnId}>
        {getLogsAttributeKeyFromColumnId(columnId) || columnId}
      </th>
    );
  };

  return (
    <div className="relative">
      <div className="overflow-x-auto bg-white">
        <table className="min-w-full">
          <thead className="bg-gray-50/80">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              {selectedColumns.map((columnId: string) => {
                return getHeaderCell(columnId);
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {props.logs.map((log: Log, index: number) => {
              const rowId: string = resolveLogIdentifier(log, index);
              const serviceId: string = log.serviceId?.toString() || "";
              const service: Service | undefined = props.serviceMap[serviceId];
              const serviceName: string =
                service?.name || serviceId || "Unknown";
              const serviceColor: string =
                (service?.serviceColor && service?.serviceColor.toString()) ||
                "#94a3b8";

              const message: string = log.body?.toString() || "";
              const traceId: string = log.traceId?.toString() || "";
              const spanId: string = log.spanId?.toString() || "";

              const isSelected: boolean = props.selectedLogId === rowId;
              const isFocused: boolean = props.focusedRowIndex === index;
              const severityTheme: SeverityTheme = getSeverityTheme(
                log.severityText,
              );

              return (
                <Fragment key={rowId}>
                  <tr
                    onClick={() => {
                      props.onRowClick(log, rowId);
                    }}
                    className={`group cursor-pointer align-top transition-colors hover:bg-gray-50/70 border-l-[3px] ${severityTheme.borderClass} ${
                      isSelected
                        ? "bg-indigo-50/50 ring-1 ring-inset ring-indigo-200"
                        : isFocused
                          ? "bg-gray-100/70 ring-1 ring-inset ring-gray-300"
                          : ""
                    }`}
                    data-focused={isFocused || undefined}
                    aria-selected={isSelected}
                    aria-expanded={isSelected}
                  >
                    {selectedColumns.map((columnId: string) => {
                      if (columnId === "time") {
                        return (
                          <td
                            className="whitespace-nowrap px-4 py-2 text-[13px] font-mono text-gray-600"
                            key={columnId}
                          >
                            {log.time
                              ? OneUptimeDate.getDateAsUserFriendlyFormattedString(
                                  log.time,
                                )
                              : "-"}
                          </td>
                        );
                      }

                      if (columnId === "service") {
                        return (
                          <td className="px-4 py-2" key={columnId}>
                            <div className="flex items-center gap-3 text-sm text-gray-700">
                              <span
                                className="h-2.5 w-2.5 flex-none rounded-full shadow-sm"
                                style={{ backgroundColor: serviceColor }}
                                aria-hidden="true"
                              />
                              <span className="truncate" title={serviceName}>
                                {serviceName}
                              </span>
                            </div>
                          </td>
                        );
                      }

                      if (columnId === "severity") {
                        return (
                          <td className="px-4 py-2" key={columnId}>
                            <SeverityBadge severity={log.severityText} />
                          </td>
                        );
                      }

                      if (columnId === "message") {
                        return (
                          <td className="px-4 py-2" key={columnId}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <p
                                  className="whitespace-pre-wrap break-words text-sm text-gray-800"
                                  title={message}
                                >
                                  {message || "-"}
                                </p>
                                {((traceId && !showTraceColumn) ||
                                  (spanId && !showSpanColumn)) && (
                                  <div className="flex flex-wrap gap-3 text-[11px] tracking-wide text-gray-400">
                                    {traceId && !showTraceColumn && (
                                      <span>Trace: {traceId}</span>
                                    )}
                                    {spanId && !showSpanColumn && (
                                      <span>Span: {spanId}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <CopyTextButton
                                textToBeCopied={message}
                                size="xs"
                                variant="ghost"
                                iconOnly={true}
                                title="Copy log message"
                                className="opacity-0 transition-opacity group-hover:opacity-100"
                              />
                            </div>
                          </td>
                        );
                      }

                      if (columnId === "traceId") {
                        return (
                          <td
                            className="max-w-xs px-4 py-2 text-sm text-gray-600"
                            key={columnId}
                          >
                            <span
                              className="block truncate font-mono"
                              title={traceId}
                            >
                              {traceId || "-"}
                            </span>
                          </td>
                        );
                      }

                      if (columnId === "spanId") {
                        return (
                          <td
                            className="max-w-xs px-4 py-2 text-sm text-gray-600"
                            key={columnId}
                          >
                            <span
                              className="block truncate font-mono"
                              title={spanId}
                            >
                              {spanId || "-"}
                            </span>
                          </td>
                        );
                      }

                      if (isLogsAttributeColumnId(columnId)) {
                        const attributeKey: string | null =
                          getLogsAttributeKeyFromColumnId(columnId);
                        const attributeValue: unknown =
                          attributeKey &&
                          typeof log.attributes === "object" &&
                          log.attributes
                            ? (log.attributes as Record<string, unknown>)[
                                attributeKey
                              ]
                            : undefined;

                        const displayValue: string =
                          stringifyLogValue(attributeValue);

                        return (
                          <td
                            className="max-w-xs px-4 py-2 text-sm text-gray-600"
                            key={columnId}
                          >
                            <span
                              className="block truncate"
                              title={displayValue}
                            >
                              {displayValue}
                            </span>
                          </td>
                        );
                      }

                      return (
                        <td
                          className="px-4 py-2 text-sm text-gray-600"
                          key={columnId}
                        >
                          -
                        </td>
                      );
                    })}
                  </tr>

                  {isSelected && props.renderExpandedContent && (
                    <tr className="bg-white">
                      <td
                        colSpan={selectedColumns.length}
                        className="px-6 pb-6 pt-3"
                      >
                        {props.renderExpandedContent(log)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {props.isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-sm">
          <ComponentLoader />
        </div>
      )}

      {showEmptyState && (
        <div className="flex h-full items-center justify-center px-6 py-12 text-center bg-white">
          <div className="w-full max-w-xl rounded-md border border-gray-200 bg-white p-6 text-left shadow-sm">
            <p className="font-mono text-sm uppercase text-gray-500">
              No logs found
            </p>
            <p className="mt-3 font-mono text-xs text-gray-400">
              {props.emptyMessage || "Adjust filters or check again later."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default LogsTable;
