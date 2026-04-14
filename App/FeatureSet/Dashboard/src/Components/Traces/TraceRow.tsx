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
  dot: string;
  ring: string;
  bar: string;
  barTrack: string;
  pillBg: string;
  pillText: string;
  label: string;
};

function getStatusTheme(status: number | undefined | null): StatusTheme {
  if (status === SpanStatus.Error) {
    return {
      dot: "bg-red-500",
      ring: "ring-red-100",
      bar: "bg-red-500",
      barTrack: "bg-red-50",
      pillBg: "bg-red-50",
      pillText: "text-red-700",
      label: "Error",
    };
  }
  if (status === SpanStatus.Ok) {
    return {
      dot: "bg-emerald-500",
      ring: "ring-emerald-100",
      bar: "bg-emerald-500",
      barTrack: "bg-gray-100",
      pillBg: "bg-emerald-50",
      pillText: "text-emerald-700",
      label: "Ok",
    };
  }
  return {
    dot: "bg-gray-300",
    ring: "ring-gray-100",
    bar: "bg-gray-400",
    barTrack: "bg-gray-100",
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
  if (day < 30) {
    return `${day}d ago`;
  }
  const mo: number = Math.floor(day / 30);
  if (mo < 12) {
    return `${mo}mo ago`;
  }
  const yr: number = Math.floor(mo / 12);
  return `${yr}y ago`;
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
      ? Math.max(2, Math.min(100, (durationNano / maxDurationNano) * 100))
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
    traceIdStr.length > 16 ? `${traceIdStr.slice(0, 16)}…` : traceIdStr;

  const theme: StatusTheme = getStatusTheme(span.statusCode);

  // Only surface kind when it's meaningful (non-internal)
  const kindRaw: SpanKind | undefined = span.kind as SpanKind | undefined;
  const kindLabel: string | null =
    kindRaw && kindRaw !== SpanKind.Internal
      ? SpanUtil.getSpanKindFriendlyName(kindRaw)
      : null;

  const statusMessage: string | undefined =
    (span as unknown as { statusMessage?: string }).statusMessage || undefined;

  const isError: boolean = span.statusCode === SpanStatus.Error;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onClick}
      onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onClick?.();
        }
      }}
      className="group relative cursor-pointer border-b border-gray-100 bg-white transition-colors duration-150 last:border-b-0 hover:bg-gray-50/70 focus:outline-none focus-visible:bg-indigo-50/40 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-indigo-300"
    >
      <div className="flex items-center gap-4 px-5 py-3">
        {/* Status indicator */}
        <span
          aria-label={`Status: ${theme.label}`}
          className={`relative flex h-2 w-2 flex-shrink-0 items-center justify-center`}
        >
          <span
            className={`absolute inline-flex h-full w-full rounded-full ${theme.dot} opacity-60 ${
              isError ? "animate-ping" : ""
            }`}
          />
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${theme.dot} ring-2 ${theme.ring}`}
          />
        </span>

        {/* Service + Span name + (kind) — main content, takes available width */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {/* Service pill */}
          <span
            className="inline-flex max-w-[180px] flex-shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium"
            style={{
              borderColor: serviceColor ? `${serviceColor}33` : "#e5e7eb",
              backgroundColor: serviceColor ? `${serviceColor}0d` : "#f9fafb",
              color: serviceColor || "#374151",
            }}
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

          {/* Kind — only when meaningful */}
          {kindLabel && (
            <span className="hidden flex-shrink-0 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-500 md:inline-block">
              {kindLabel}
            </span>
          )}

          {/* Error pill */}
          {isError && (
            <span
              className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${theme.pillBg} ${theme.pillText}`}
            >
              {theme.label}
            </span>
          )}
        </div>

        {/* Right column: inline duration sparkbar + value + time, fixed width for tabular alignment */}
        <div className="flex flex-shrink-0 items-center gap-4">
          {/* Inline duration bar */}
          <div className="hidden items-center gap-2 sm:flex">
            <div
              className={`relative h-1 w-24 overflow-hidden rounded-full ${theme.barTrack}`}
            >
              <div
                className={`absolute left-0 top-0 h-full rounded-full ${theme.bar} transition-all duration-300`}
                style={{ width: `${durationPct}%` }}
              />
            </div>
          </div>

          {/* Duration value */}
          <div className="w-16 text-right font-mono text-sm font-semibold tabular-nums text-gray-900">
            {durationLabel}
          </div>

          {/* Time */}
          {startTimeDate && (
            <div
              className="hidden w-20 text-right text-xs text-gray-400 md:block"
              title={`${formatAbsoluteTime(startTimeDate)} — ${startTimeDate.toISOString()}`}
            >
              {formatRelativeTime(startTimeDate)}
            </div>
          )}

          {/* Chevron */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
            className="h-4 w-4 flex-shrink-0 text-gray-300 transition-all duration-150 group-hover:translate-x-0.5 group-hover:text-gray-500"
          >
            <path
              fillRule="evenodd"
              d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </div>

      {/* Sub-row: trace id + status message (error only) */}
      <div className="flex items-center gap-3 px-5 pb-2.5 pl-[3.25rem] text-[11px] text-gray-400">
        {shortTraceId && (
          <span
            className="font-mono tracking-tight text-gray-400 transition-colors group-hover:text-gray-500"
            title={`trace ${traceIdStr}`}
          >
            {shortTraceId}
          </span>
        )}

        {startTimeDate && (
          <>
            <span aria-hidden="true" className="text-gray-300">
              ·
            </span>
            <span className="tabular-nums">
              {formatAbsoluteTime(startTimeDate)}
            </span>
          </>
        )}

        {isError && statusMessage && (
          <>
            <span aria-hidden="true" className="text-gray-300">
              ·
            </span>
            <span
              className="min-w-0 truncate text-red-500"
              title={statusMessage}
            >
              {statusMessage}
            </span>
          </>
        )}
      </div>
    </div>
  );
};

export default TraceRow;
