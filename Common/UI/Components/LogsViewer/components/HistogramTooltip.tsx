import React, { FunctionComponent, ReactElement } from "react";
import { getSeverityColor } from "./severityColors";

export interface TooltipEntry {
  severity: string;
  count: number;
}

export interface HistogramTooltipProps {
  active?: boolean;
  label?: string;
  payload?: Array<{
    dataKey: string;
    value: number;
    payload: Record<string, number>;
  }>;
}

function formatTooltipTime(label: string | undefined): string {
  if (!label) {
    return "";
  }

  const date: Date = new Date(label);

  if (isNaN(date.getTime())) {
    return label;
  }

  const now: Date = new Date();
  const isToday: boolean = date.toDateString() === now.toDateString();

  const time: string = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  if (isToday) {
    return time;
  }

  const dateStr: string = date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });

  return `${dateStr}, ${time}`;
}

const HistogramTooltip: FunctionComponent<HistogramTooltipProps> = (
  props: HistogramTooltipProps,
): ReactElement | null => {
  if (!props.active || !props.payload || props.payload.length === 0) {
    return null;
  }

  const entries: Array<TooltipEntry> = props.payload
    .filter((entry: { value: number }): boolean => {
      return entry.value > 0;
    })
    .map((entry: { dataKey: string; value: number }): TooltipEntry => {
      return {
        severity: entry.dataKey,
        count: entry.value,
      };
    });

  if (entries.length === 0) {
    return null;
  }

  const total: number = entries.reduce(
    (sum: number, e: TooltipEntry): number => {
      return sum + e.count;
    },
    0,
  );

  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-2 shadow-md">
      <p className="mb-1.5 border-b border-gray-100 pb-1.5 font-mono text-[11px] font-medium text-gray-500">
        {formatTooltipTime(props.label)}
      </p>
      <div className="space-y-0.5">
        {entries.map((entry: TooltipEntry) => {
          const color: string = getSeverityColor(entry.severity).fill;
          const colorLabel: string =
            getSeverityColor(entry.severity).label || entry.severity;
          return (
            <div
              key={entry.severity}
              className="flex items-center justify-between gap-6 py-0.5"
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: color }}
                />
                <span className="text-xs text-gray-600">{colorLabel}</span>
              </div>
              <span className="font-mono text-xs font-semibold tabular-nums text-gray-800">
                {entry.count.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
      {entries.length > 1 && (
        <div className="mt-1.5 flex items-center justify-between border-t border-gray-100 pt-1.5">
          <span className="text-xs text-gray-500">Total</span>
          <span className="font-mono text-xs font-semibold tabular-nums text-gray-800">
            {total.toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );
};

export default HistogramTooltip;
