import React, { FunctionComponent, ReactElement } from "react";
import Log from "../../../../Models/AnalyticsModels/Log";
import TelemetryService from "../../../../Models/DatabaseModels/TelemetryService";
import Dictionary from "../../../../Types/Dictionary";
import OneUptimeDate from "../../../../Types/Date";
import CopyTextButton from "../../CopyTextButton/CopyTextButton";
import ComponentLoader from "../../ComponentLoader/ComponentLoader";
import SeverityBadge from "./SeverityBadge";
import { getSeverityTheme } from "./severityTheme";

export interface LogsTableProps {
  logs: Array<Log>;
  serviceMap: Dictionary<TelemetryService>;
  isLoading: boolean;
  emptyMessage?: string | undefined;
  onRowClick: (log: Log, rowId: string) => void;
  selectedLogId?: string | null;
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
    } catch (err) {
      continue;
    }
  }

  return `log-row-${index}`;
};

const LogsTable: FunctionComponent<LogsTableProps> = (
  props: LogsTableProps,
): ReactElement => {
  const showEmptyState: boolean = !props.isLoading && props.logs.length === 0;

  return (
    <div className="relative">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-800">
          <thead className="bg-slate-900/70">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <th scope="col" className="px-4 py-3">Time</th>
              <th scope="col" className="px-4 py-3">Service</th>
              <th scope="col" className="px-4 py-3">Severity</th>
              <th scope="col" className="px-4 py-3">Message</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-950/50">
            {props.logs.map((log: Log, index: number) => {
              const rowId: string = resolveLogIdentifier(log, index);
              const serviceId: string = log.serviceId?.toString() || "";
              const service: TelemetryService | undefined =
                props.serviceMap[serviceId];
              const serviceName: string = service?.name || serviceId || "Unknown";
              const serviceColor: string =
                (service?.serviceColor && service?.serviceColor.toString()) ||
                "#94a3b8";

              const message: string = log.body?.toString() || "";
              const traceId: string = log.traceId?.toString() || "";
              const spanId: string = log.spanId?.toString() || "";

              const isSelected: boolean = props.selectedLogId === rowId;
              const severityTheme = getSeverityTheme(log.severityText);

              return (
                <tr
                  key={rowId}
                  onClick={() => {
                    props.onRowClick(log, rowId);
                  }}
                  className={`cursor-pointer align-top transition-colors duration-150 hover:bg-slate-900/70 ${
                    isSelected
                      ? "bg-slate-900/80 ring-1 ring-inset ring-indigo-400/40"
                      : ""
                  }`}
                  aria-selected={isSelected}
                >
                  <td className="whitespace-nowrap px-4 py-3 text-[13px] font-mono text-slate-300">
                    {log.time
                      ? OneUptimeDate.getDateAsUserFriendlyFormattedString(
                          log.time,
                        )
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 text-sm text-slate-200">
                      <span
                        className="h-2.5 w-2.5 flex-none rounded-full border border-slate-900/40"
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
                          className={`truncate text-sm text-slate-100 ${severityTheme.textClass}`}
                          title={message}
                        >
                          {message || "—"}
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
        <div className="flex items-center justify-center px-6 py-12 text-center">
          <div>
            <p className="text-sm font-semibold text-slate-200">
              No logs found
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {props.emptyMessage || "Adjust filters or check again later."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default LogsTable;
