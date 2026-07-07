import { AIChatWidget, AIChatWidgetSpan } from "Common/Types/AI/AIChatTypes";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  widget: AIChatWidget;
}

const MAX_SPANS: number = 40;
const BAR_COLORS: Array<string> = [
  "bg-indigo-500",
  "bg-violet-500",
  "bg-sky-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-cyan-500",
];

const TraceWaterfallWidget: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const spans: Array<AIChatWidgetSpan> = props.widget.data.spans || [];
  const totalDurationMs: number = Math.max(
    props.widget.data.totalDurationMs || 0,
    1,
  );

  // Depth = length of the parent chain, so children indent under their parent.
  const parentBySpanId: Map<string, string | undefined> = new Map();
  for (const span of spans) {
    parentBySpanId.set(span.spanId, span.parentSpanId);
  }

  const depthOf: (span: AIChatWidgetSpan) => number = (
    span: AIChatWidgetSpan,
  ): number => {
    let depth: number = 0;
    let current: string | undefined = span.parentSpanId;
    const seen: Set<string> = new Set();
    while (current && parentBySpanId.has(current) && !seen.has(current)) {
      seen.add(current);
      depth++;
      current = parentBySpanId.get(current);
      if (depth > 12) {
        break;
      }
    }
    return depth;
  };

  const shown: Array<AIChatWidgetSpan> = spans.slice(0, MAX_SPANS);

  return (
    <div className="space-y-1">
      {shown.map((span: AIChatWidgetSpan, index: number) => {
        const leftPercent: number = Math.min(
          99,
          (span.startOffsetMs / totalDurationMs) * 100,
        );
        const widthPercent: number = Math.max(
          1.5,
          Math.min(
            100 - leftPercent,
            (span.durationMs / totalDurationMs) * 100,
          ),
        );
        const depth: number = depthOf(span);
        const barColor: string = span.isError
          ? "bg-red-500"
          : BAR_COLORS[index % BAR_COLORS.length]!;

        return (
          <div key={span.spanId || index} className="flex items-center gap-2">
            <div
              className="min-w-0 flex-shrink-0 truncate text-[11px] text-gray-600"
              style={{
                width: "42%",
                paddingLeft: `${Math.min(depth, 8) * 10}px`,
              }}
              title={span.name}
            >
              {span.isError && (
                <span
                  className="mr-1 text-red-500"
                  title="Span recorded an error"
                >
                  ●
                </span>
              )}
              {span.name}
            </div>
            <div className="relative h-4 flex-1 rounded bg-gray-100">
              <div
                className={`absolute top-0 h-4 rounded ${barColor}`}
                style={{
                  left: `${leftPercent}%`,
                  width: `${widthPercent}%`,
                }}
                title={`${span.name} · ${span.durationMs} ms`}
              />
            </div>
            <div className="w-16 flex-shrink-0 text-right text-[11px] tabular-nums text-gray-500">
              {span.durationMs.toLocaleString()} ms
            </div>
          </div>
        );
      })}
      {spans.length > shown.length && (
        <div className="pt-1 text-[11px] text-gray-400">
          Showing {shown.length} of {spans.length} spans.
        </div>
      )}
    </div>
  );
};

export default TraceWaterfallWidget;
