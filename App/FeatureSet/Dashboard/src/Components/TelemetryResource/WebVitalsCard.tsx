import React, { FunctionComponent, ReactElement } from "react";
import Card from "Common/UI/Components/Card/Card";
import { WebVital, formatDurationMs } from "./telemetryMetrics";

export interface WebVitalsCardProps {
  vitals: Array<WebVital>;
  loading: boolean;
}

const formatVital: (v: WebVital) => string = (v: WebVital): string => {
  if (v.value === null || !Number.isFinite(v.value)) {
    return "—";
  }
  if (v.unit === "ms") {
    return formatDurationMs(v.value);
  }
  return v.value.toFixed(3);
};

const ratingClasses: (v: WebVital) => { text: string; chip: string } = (
  v: WebVital,
): { text: string; chip: string } => {
  if (v.value === null || !Number.isFinite(v.value)) {
    return { text: "text-gray-400", chip: "bg-gray-100 text-gray-400" };
  }
  if (v.value < v.thresholds.warn) {
    return {
      text: "text-emerald-600",
      chip: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
    };
  }
  if (v.value < v.thresholds.danger) {
    return {
      text: "text-amber-600",
      chip: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
    };
  }
  return {
    text: "text-red-600",
    chip: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200",
  };
};

const ratingLabel: (v: WebVital) => string = (v: WebVital): string => {
  if (v.value === null || !Number.isFinite(v.value)) {
    return "—";
  }
  if (v.value < v.thresholds.warn) {
    return "Good";
  }
  if (v.value < v.thresholds.danger) {
    return "Needs work";
  }
  return "Poor";
};

const WebVitalsCard: FunctionComponent<WebVitalsCardProps> = (
  props: WebVitalsCardProps,
): ReactElement => {
  const anyReported: boolean = props.vitals.some((v: WebVital): boolean => {
    return v.value !== null && Number.isFinite(v.value);
  });

  return (
    <div className="mt-6">
      <Card
        title="Core Web Vitals"
        description="Real-user performance (averaged over the selected range). Reported when your browser instrumentation emits web-vital metrics over OpenTelemetry."
      >
        {props.loading ? (
          <div className="-mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_: unknown, idx: number) => {
              return (
                <div
                  key={`wv-skeleton-${idx}`}
                  className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="h-3 w-12 rounded bg-gray-100 animate-pulse" />
                  <div className="mt-3 h-7 w-16 rounded bg-gray-100 animate-pulse" />
                </div>
              );
            })}
          </div>
        ) : !anyReported ? (
          <div className="-mt-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
            <div className="text-sm font-medium text-gray-700">
              No web vitals reported yet
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Instrument your browser app to emit LCP / INP / CLS / FCP / TTFB
              as OpenTelemetry metrics and they will appear here automatically.
            </div>
          </div>
        ) : (
          <div className="-mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {props.vitals.map((v: WebVital): ReactElement => {
              const rc: { text: string; chip: string } = ratingClasses(v);
              return (
                <div
                  key={`wv-${v.key}`}
                  className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                      {v.key}
                    </span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${rc.chip}`}
                    >
                      {ratingLabel(v)}
                    </span>
                  </div>
                  <div className={`text-xl font-semibold ${rc.text}`}>
                    {formatVital(v)}
                  </div>
                  <div className="mt-1 text-[11px] text-gray-400 truncate">
                    {v.label}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};

export default WebVitalsCard;
