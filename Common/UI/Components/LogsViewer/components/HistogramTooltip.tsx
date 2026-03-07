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

const HistogramTooltip: FunctionComponent<HistogramTooltipProps> = (
  props: HistogramTooltipProps,
): ReactElement | null => {
  if (!props.active || !props.payload || props.payload.length === 0) {
    return null;
  }

  const entries: Array<TooltipEntry> = props.payload
    .filter(
      (entry: { value: number }): boolean => {
        return entry.value > 0;
      },
    )
    .map(
      (entry: { dataKey: string; value: number }): TooltipEntry => ({
        severity: entry.dataKey,
        count: entry.value,
      }),
    );

  const total: number = entries.reduce(
    (sum: number, e: TooltipEntry): number => sum + e.count,
    0,
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-mono text-[10px] text-gray-400">
        {props.label}
      </p>
      {entries.map((entry: TooltipEntry) => {
        const color: string = getSeverityColor(entry.severity).fill;
        return (
          <div
            key={entry.severity}
            className="flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-gray-600">{entry.severity}</span>
            </div>
            <span className="font-mono font-medium text-gray-900">
              {entry.count.toLocaleString()}
            </span>
          </div>
        );
      })}
      {entries.length > 1 && (
        <div className="mt-1 border-t border-gray-100 pt-1 text-right font-mono font-medium text-gray-900">
          {total.toLocaleString()} total
        </div>
      )}
    </div>
  );
};

export default HistogramTooltip;
