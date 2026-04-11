import React, { FunctionComponent, ReactElement } from "react";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import Service from "Common/Models/DatabaseModels/Service";
import OneUptimeDate from "Common/Types/Date";
import SpanUtil from "../../Utils/SpanUtil";

export interface TraceRowProps {
  span: Span;
  service?: Service | undefined;
  maxDurationNano: number;
  onClick?: () => void;
}

function statusDotColor(status: number | undefined | null): string {
  if (status === SpanStatus.Error) {
    return "bg-red-500";
  }
  if (status === SpanStatus.Ok) {
    return "bg-emerald-500";
  }
  return "bg-gray-300";
}

function statusBarColor(status: number | undefined | null): string {
  if (status === SpanStatus.Error) {
    return "bg-red-400";
  }
  if (status === SpanStatus.Ok) {
    return "bg-emerald-400";
  }
  return "bg-gray-300";
}

function formatRelativeTime(time: Date): string {
  const now: Date = new Date();
  const diffMs: number = now.getTime() - time.getTime();
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

function formatAbsoluteTime(time: Date): string {
  return time.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

const TraceRow: FunctionComponent<TraceRowProps> = (
  props: TraceRowProps,
): ReactElement => {
  const { span, service, maxDurationNano } = props;

  const durationNano: number = Number(span.durationUnixNano || 0);
  const durationPct: number =
    maxDurationNano > 0
      ? Math.max(2, Math.round((durationNano / maxDurationNano) * 100))
      : 0;

  const divisibilityFactor: ReturnType<typeof SpanUtil.getDivisibilityFactor> =
    SpanUtil.getDivisibilityFactor(durationNano);

  const durationLabel: string = SpanUtil.getSpanDurationAsString({
    divisibilityFactor,
    spanDurationInUnixNano: durationNano,
  });

  const startTimeDate: Date | null = span.startTime
    ? OneUptimeDate.fromString(span.startTime as unknown as string)
    : null;

  const serviceName: string = service?.name || "unknown service";
  const serviceColor: string | undefined = service?.serviceColor?.toString();

  const spanName: string = span.name || "(unnamed)";
  const traceIdStr: string = span.traceId?.toString() || "";
  const shortTraceId: string =
    traceIdStr.length > 12 ? `${traceIdStr.slice(0, 12)}…` : traceIdStr;

  return (
    <button
      type="button"
      className="group block w-full px-4 py-3 text-left transition-colors hover:bg-indigo-50/40 focus:outline-none focus-visible:bg-indigo-50/60"
      onClick={props.onClick}
    >
      <div className="flex items-start gap-3">
        {/* Status dot */}
        <span
          className={`mt-1 inline-block h-2 w-2 flex-shrink-0 rounded-full ${statusDotColor(
            span.statusCode,
          )}`}
        />

        {/* Main content */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* Line 1: service badge + span name */}
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] font-medium text-gray-700"
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
            <span className="truncate font-mono text-xs font-medium text-gray-900">
              {spanName}
            </span>
          </div>

          {/* Line 2: duration bar */}
          <div className="flex items-center gap-2">
            <div className="relative h-1.5 w-full max-w-md flex-1 rounded-full bg-gray-100">
              <div
                className={`absolute left-0 top-0 h-full rounded-full ${statusBarColor(
                  span.statusCode,
                )}`}
                style={{ width: `${durationPct}%` }}
              />
            </div>
            <span className="flex-shrink-0 font-mono text-[11px] tabular-nums text-gray-600">
              {durationLabel}
            </span>
          </div>

          {/* Line 3: metadata */}
          <div className="flex items-center gap-3 text-[11px] text-gray-400">
            {shortTraceId && (
              <span className="font-mono">trace {shortTraceId}</span>
            )}
            {startTimeDate && (
              <>
                <span>·</span>
                <span title={startTimeDate.toISOString()}>
                  {formatRelativeTime(startTimeDate)}
                </span>
                <span className="text-gray-300">
                  ({formatAbsoluteTime(startTimeDate)})
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </button>
  );
};

export default TraceRow;
