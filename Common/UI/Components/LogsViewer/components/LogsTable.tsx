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

const LogsTable: FunctionComponent<LogsTableProps> = (
  props: LogsTableProps,
): ReactElement => {
  const showEmptyState: boolean = !props.isLoading && props.logs.length === 0;
  const activeSortField: LogsTableSortField | undefined = props.sortField;
  const activeSortOrder: SortOrder = props.sortOrder || SortOrder.Descending;

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
      return `${base} text-indigo-300`;
    }

    return `${base} text-slate-600`;
  };

  return (
    <div className="relative">
      <div className="overflow-x-auto overflow-y-hidden border-b border-slate-900 bg-slate-950">
        <table className="min-w-full divide-y divide-slate-900/80">
          <thead className="bg-slate-950">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-200">
              <th scope="col" className="px-4 py-3">
                <button
                  type="button"
                  className={`flex items-center gap-2 text-left font-semibold tracking-wider text-slate-300 transition-colors hover:text-slate-100 focus:outline-none ${
                    activeSortField === "time" ? "text-slate-100" : ""
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
              <th scope="col" className="px-4 py-3">
                Service
              </th>
              <th scope="col" className="px-4 py-3">
                <button
                  type="button"
                  className={`flex items-center gap-2 text-left font-semibold tracking-wider text-slate-300 transition-colors hover:text-slate-100 focus:outline-none ${
                    activeSortField === "severityText" ? "text-slate-100" : ""
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
              <th scope="col" className="px-4 py-3">
                Message
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-900/70 bg-slate-950">
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
              const severityTheme: SeverityTheme = getSeverityTheme(
                log.severityText,
              );

              return (
                <Fragment key={rowId}>
                  <tr
                    onClick={() => {
                      props.onRowClick(log, rowId);
                    }}
                    className={`group cursor-pointer align-top transition-colors duration-150 hover:bg-slate-900 ${
                      isSelected
                        ? "bg-slate-900 ring-1 ring-inset ring-indigo-500/40"
                        : ""
                    }`}
                    aria-selected={isSelected}
                    aria-expanded={isSelected}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-[13px] font-mono text-slate-200">
                      {log.time
                        ? OneUptimeDate.getDateAsUserFriendlyFormattedString(
                            log.time,
                          )
                        : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 text-sm text-slate-300">
                        <span
                          className="h-2.5 w-2.5 flex-none rounded-full border border-slate-900/40 shadow-sm"
                          style={{ backgroundColor: serviceColor }}
                          aria-hidden="true"
                        />
                        <span className="truncate" title={serviceName}>
                          {serviceName}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <SeverityBadge severity={log.severityText} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <p
                            className={`whitespace-pre-wrap break-words text-sm text-slate-200 transition-colors duration-150 group-hover:text-slate-50 ${severityTheme.textClass}`}
                            title={message}
                          >
                            {message || "-"}
                          </p>
                          {(traceId || spanId) && (
                            <div className="flex flex-wrap gap-3 text-[11px] tracking-wide text-slate-500">
                              {traceId && <span>Trace: {traceId}</span>}
                              {spanId && <span>Span: {spanId}</span>}
                            </div>
                          )}
                        </div>
                        <CopyTextButton
                          textToBeCopied={message}
                          size="xs"
                          variant="ghost"
                          iconOnly={true}
                          title="Copy log message"
                        />
                      </div>
                    </td>
                  </tr>

                  {isSelected && props.renderExpandedContent && (
                    <tr className="bg-slate-950/70">
                      <td colSpan={4} className="px-6 pb-6 pt-3">
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
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 backdrop-blur-md">
          <ComponentLoader />
        </div>
      )}

      {showEmptyState && (
        <div className="flex h-full items-center justify-center px-6 py-12 text-center bg-slate-950">
          <div className="w-full max-w-xl rounded-md border border-slate-900/70 bg-slate-950 p-6 text-left shadow-inner">
            <p className="font-mono text-sm uppercase text-slate-400">
              No logs found
            </p>
            <p className="mt-3 font-mono text-xs text-slate-500">
              {props.emptyMessage || "Adjust filters or check again later."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default LogsTable;
