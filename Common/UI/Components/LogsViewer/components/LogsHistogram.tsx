import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useCallback,
  useRef,
  useState,
} from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";
import { HistogramBucket } from "../types";
import {
  getSeverityColor,
  getAllSeverityKeys,
  SeverityColor,
} from "./severityColors";
import HistogramTooltip from "./HistogramTooltip";
import ComponentLoader from "../../ComponentLoader/ComponentLoader";

export interface LogsHistogramProps {
  buckets: Array<HistogramBucket>;
  isLoading: boolean;
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
}

interface PivotedRow {
  time: string;
  [severity: string]: number | string;
}

function pivotBuckets(buckets: Array<HistogramBucket>): Array<PivotedRow> {
  const map: Map<string, PivotedRow> = new Map();

  for (const bucket of buckets) {
    let row: PivotedRow | undefined = map.get(bucket.time);

    if (!row) {
      row = { time: bucket.time };
      map.set(bucket.time, row);
    }

    row[bucket.severity] =
      ((row[bucket.severity] as number) || 0) + bucket.count;
  }

  return Array.from(map.values());
}

function formatTickTime(time: string): string {
  const date: Date = new Date(time);

  if (isNaN(date.getTime())) {
    return time;
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatYAxisTick(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
  }

  return value.toString();
}

const LogsHistogram: FunctionComponent<LogsHistogramProps> = (
  props: LogsHistogramProps,
): ReactElement => {
  const [selectionStart, setSelectionStart] = useState<string | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<string | null>(null);
  const isSelecting: React.MutableRefObject<boolean> = useRef(false);

  const pivotedData: Array<PivotedRow> = useMemo(() => {
    return pivotBuckets(props.buckets);
  }, [props.buckets]);

  const activeSeverities: Array<string> = useMemo(() => {
    const present: Set<string> = new Set<string>();

    for (const bucket of props.buckets) {
      present.add(bucket.severity);
    }

    return getAllSeverityKeys().filter((key: string): boolean =>
      present.has(key),
    );
  }, [props.buckets]);

  const handleMouseDown: (e: any) => void = useCallback(
    (e: any): void => {
      if (!props.onTimeRangeSelect || !e?.activeLabel) {
        return;
      }

      isSelecting.current = true;
      setSelectionStart(e.activeLabel as string);
      setSelectionEnd(null);
    },
    [props.onTimeRangeSelect],
  );

  const handleMouseMove: (e: any) => void = useCallback(
    (e: any): void => {
      if (!isSelecting.current || !e?.activeLabel) {
        return;
      }

      setSelectionEnd(e.activeLabel as string);
    },
    [],
  );

  const handleMouseUp: () => void = useCallback((): void => {
    if (
      !isSelecting.current ||
      !selectionStart ||
      !selectionEnd ||
      !props.onTimeRangeSelect
    ) {
      isSelecting.current = false;
      setSelectionStart(null);
      setSelectionEnd(null);
      return;
    }

    isSelecting.current = false;

    const start: Date = new Date(selectionStart);
    const end: Date = new Date(selectionEnd);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      setSelectionStart(null);
      setSelectionEnd(null);
      return;
    }

    const earlierDate: Date = start < end ? start : end;
    const laterDate: Date = start < end ? end : start;

    props.onTimeRangeSelect(earlierDate, laterDate);

    setSelectionStart(null);
    setSelectionEnd(null);
  }, [selectionStart, selectionEnd, props.onTimeRangeSelect]);

  if (props.isLoading && pivotedData.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-gray-200 bg-white">
        <ComponentLoader />
      </div>
    );
  }

  if (pivotedData.length === 0) {
    return <></>;
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      {/* Header with legend */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500">
            Log Volume
          </span>
          {props.onTimeRangeSelect && (
            <span className="text-[10px] text-gray-300">
              Drag to zoom
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {activeSeverities.map((severity: string) => {
            const color: SeverityColor = getSeverityColor(severity);
            return (
              <div
                key={severity}
                className="flex items-center gap-1.5"
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: color.fill }}
                />
                <span className="text-[11px] text-gray-500">
                  {color.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Chart */}
      <div
        className="px-2 pb-1 pt-2"
        style={{ height: 120, cursor: props.onTimeRangeSelect ? "crosshair" : "default" }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={pivotedData}
            margin={{ top: 4, right: 8, bottom: 0, left: -4 }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            barCategoryGap="15%"
            barGap={0}
          >
            <XAxis
              dataKey="time"
              tickFormatter={formatTickTime}
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              axisLine={{ stroke: "#e5e7eb" }}
              tickLine={false}
              minTickGap={40}
              dy={4}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
              width={48}
              allowDecimals={false}
              tickFormatter={formatYAxisTick}
            />
            <Tooltip
              content={<HistogramTooltip />}
              cursor={{ fill: "rgba(99,102,241,0.06)" }}
            />
            {activeSeverities.map((severity: string, index: number) => {
              const isLast: boolean = index === activeSeverities.length - 1;
              return (
                <Bar
                  key={severity}
                  dataKey={severity}
                  stackId="severity"
                  fill={getSeverityColor(severity).fill}
                  radius={isLast ? [1.5, 1.5, 0, 0] : [0, 0, 0, 0]}
                  isAnimationActive={false}
                  maxBarSize={24}
                />
              );
            })}
            {selectionStart && selectionEnd && (
              <ReferenceArea
                x1={selectionStart}
                x2={selectionEnd}
                fill="rgba(99,102,241,0.12)"
                stroke="rgba(99,102,241,0.5)"
                strokeWidth={1}
                radius={2}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default LogsHistogram;
