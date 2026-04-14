import React, { FunctionComponent, ReactElement } from "react";
import Span, { SpanStatus, SpanKind } from "Common/Models/AnalyticsModels/Span";
import Service from "Common/Models/DatabaseModels/Service";
import OneUptimeDate from "Common/Types/Date";
import SpanUtil from "../../Utils/SpanUtil";

export interface TraceRowProps {
  span: Span;
  service?: Service | undefined;
  maxDurationNano: number;
  onClick?: () => void;
}

type StatusTheme = {
  stripe: string;
  bar: string;
  pillBg: string;
  pillText: string;
  label: string;
};

function getStatusTheme(status: number | undefined | null): StatusTheme {
  if (status === SpanStatus.Error) {
    return {
      stripe: "bg-red-500",
      bar: "bg-red-400",
      pillBg: "bg-red-50",
      pillText: "text-red-700",
      label: "Error",
    };
  }
  if (status === SpanStatus.Ok) {
    return {
      stripe: "bg-emerald-500",
      bar: "bg-emerald-400",
      pillBg: "bg-emerald-50",
      pillText: "text-emerald-700",
      label: "Ok",
    };
  }
  return {
    stripe: "bg-gray-300",
    bar: "bg-gray-300",
    pillBg: "bg-gray-50",
    pillText: "text-gray-500",
    label: "Unset",
  };
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
      ? Math.max(1, Math.min(100, (durationNano / maxDurationNano) * 100))
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
    traceIdStr.length > 14 ? `${traceIdStr.slice(0, 14)}…` : traceIdStr;

  const theme: StatusTheme = getStatusTheme(span.statusCode);

  const kindLabel: string | null = span.kind
    ? SpanUtil.getSpanKindFriendlyName(span.kind as SpanKind)
    : null;

  const statusMessage: string | undefined =
    (span as unknown as { statusMessage?: string }).statusMessage || undefined;

  return (
    <button
      type="button"
      onClick={props.onClick}
      className="group relative block w-full overflow-hidden border-l-2 border-transparent bg-white text-left transition-colors hover:bg-indigo-50/40 focus:outline-none focus-visible:bg-indigo-50/60"
    >
      {/* Status stripe (left edge) */}
      <span
        aria-hidden="true"
        className={`absolute left-0 top-0 h-full w-0.5 ${theme.stripe}`}
      />

      <div className="px-4 pt-3 pb-2.5">
        {/* Primary row: service · span name · kind  ·············· duration */}
        <div className="flex min-w-0 items-center gap-2.5">
          {/* Service pill */}
          <span
            className="inline-flex max-w-[160px] items-center gap-1.5 truncate rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] font-medium text-gray-700"
            style={
              serviceColor
                ? { borderColor: `${serviceColor}40`, color: serviceColor }
                : undefined
            }
            title={serviceName}
          >
            <span
              className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
              style={{ backgroundColor: serviceColor || "#9ca3af" }}
            />
            <span className="truncate">{serviceName}</span>
          </span>

          {/* Span name — visual hero */}
          <span
            className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900"
            title={spanName}
          >
            {spanName}
          </span>

          {/* Kind tag */}
          {kindLabel && (
            <span className="hidden flex-shrink-0 rounded border border-gray-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500 sm:inline-block">
              {kindLabel}
            </span>
          )}

          {/* Status pill (only shown when meaningful) */}
          {span.statusCode === SpanStatus.Error && (
            <span
              className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${theme.pillBg} ${theme.pillText}`}
            >
              {theme.label}
            </span>
          )}

          {/* Duration */}
          <span className="flex-shrink-0 font-mono text-sm font-semibold tabular-nums text-gray-900">
            {durationLabel}
          </span>

          {/* Chevron — appears on hover */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="ml-0.5 h-4 w-4 flex-shrink-0 text-gray-300 opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
              clipRule="evenodd"
            />
          </svg>
        </div>

        {/* Secondary row: trace id · time · status message */}
        <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-gray-400">
          {shortTraceId && (
            <span
              className="truncate font-mono text-gray-500"
              title={traceIdStr}
            >
              {shortTraceId}
            </span>
          )}

          {startTimeDate && (
            <>
              <span className="text-gray-300">·</span>
              <span title={startTimeDate.toISOString()}>
                {formatRelativeTime(startTimeDate)}
              </span>
              <span className="text-gray-300">
                {formatAbsoluteTime(startTimeDate)}
              </span>
            </>
          )}

          {statusMessage && span.statusCode === SpanStatus.Error && (
            <>
              <span className="text-gray-300">·</span>
              <span
                className="truncate text-red-500"
                title={statusMessage}
              >
                {statusMessage}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Duration bar — full-width track at the bottom edge */}
      <div className="relative h-0.5 w-full bg-gray-50">
        <div
          className={`absolute left-0 top-0 h-full ${theme.bar} transition-all duration-300`}
          style={{ width: `${durationPct}%` }}
        />
      </div>
    </button>
  );
};

export default TraceRow;
