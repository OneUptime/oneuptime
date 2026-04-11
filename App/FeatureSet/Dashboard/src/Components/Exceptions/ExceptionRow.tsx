import React, { FunctionComponent, ReactElement } from "react";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import Service from "Common/Models/DatabaseModels/Service";

export interface ExceptionRowProps {
  exception: TelemetryException;
  service?: Service | undefined;
  onClick?: () => void;
}

function formatRelativeTime(time: Date): string {
  const now: Date = new Date();
  const diffMs: number = Math.max(0, now.getTime() - time.getTime());
  const sec: number = Math.floor(diffMs / 1000);
  if (sec < 60) {
    return `${sec}s ago`;
  }
  const min: number = Math.floor(sec / 60);
  if (min < 60) {
    return `${min}m ago`;
  }
  const hr: number = Math.floor(min / 60);
  if (hr < 24) {
    return `${hr}h ago`;
  }
  const day: number = Math.floor(hr / 24);
  return `${day}d ago`;
}

const ExceptionRow: FunctionComponent<ExceptionRowProps> = (
  props: ExceptionRowProps,
): ReactElement => {
  const { exception, service } = props;

  const exceptionType: string = exception.exceptionType || "Exception";
  const message: string = exception.message || "";
  const firstLine: string = message.split("\n")[0] || "";

  const occuranceCount: number = exception.occuranceCount || 0;

  const firstSeen: Date | null = exception.firstSeenAt
    ? new Date(exception.firstSeenAt as unknown as string)
    : null;
  const lastSeen: Date | null = exception.lastSeenAt
    ? new Date(exception.lastSeenAt as unknown as string)
    : null;

  const serviceName: string = service?.name || "unknown service";
  const serviceColor: string | undefined = service?.serviceColor?.toString();

  const isResolved: boolean = Boolean(exception.isResolved);
  const isArchived: boolean = Boolean(exception.isArchived);

  return (
    <button
      type="button"
      className="group block w-full px-4 py-3 text-left transition-colors hover:bg-indigo-50/40 focus:outline-none focus-visible:bg-indigo-50/60"
      onClick={props.onClick}
    >
      <div className="flex items-start gap-3">
        {/* Level dot */}
        <span
          className={`mt-1.5 inline-block h-2 w-2 flex-shrink-0 rounded-full ${
            isResolved
              ? "bg-emerald-400"
              : isArchived
                ? "bg-gray-300"
                : "bg-red-500"
          }`}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* Line 1: type + message */}
          <div className="min-w-0">
            <span className="font-mono text-xs font-semibold text-gray-900">
              {exceptionType}
            </span>
            {firstLine && (
              <span className="text-xs text-gray-700">
                <span className="text-gray-400">: </span>
                <span className="font-mono">{firstLine}</span>
              </span>
            )}
          </div>

          {/* Line 2: service + environment */}
          <div className="flex items-center gap-2 text-[11px]">
            <span
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-medium text-gray-600"
              style={
                serviceColor
                  ? { borderColor: serviceColor, color: serviceColor }
                  : undefined
              }
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: serviceColor || "#9ca3af" }}
              />
              {serviceName}
            </span>
            {exception.environment && (
              <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-500">
                {exception.environment}
              </span>
            )}
            {exception.fingerprint && (
              <span className="truncate font-mono text-[10px] text-gray-400">
                {exception.fingerprint.toString().slice(0, 12)}…
              </span>
            )}
          </div>

          {/* Line 3: metadata */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
            {firstSeen && (
              <span>
                first{" "}
                <span className="font-medium text-gray-700">
                  {formatRelativeTime(firstSeen)}
                </span>
              </span>
            )}
            {lastSeen && (
              <>
                <span className="text-gray-300">·</span>
                <span>
                  last{" "}
                  <span className="font-medium text-gray-700">
                    {formatRelativeTime(lastSeen)}
                  </span>
                </span>
              </>
            )}
            <span className="text-gray-300">·</span>
            <span>
              <span className="font-semibold tabular-nums text-gray-800">
                {occuranceCount.toLocaleString()}
              </span>{" "}
              events
            </span>
          </div>
        </div>

        {/* Status pill */}
        <div className="flex flex-shrink-0 items-center">
          {isResolved && (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
              Resolved
            </span>
          )}
          {!isResolved && isArchived && (
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-600">
              Archived
            </span>
          )}
          {!isResolved && !isArchived && (
            <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700">
              Unresolved
            </span>
          )}
        </div>
      </div>
    </button>
  );
};

export default ExceptionRow;
