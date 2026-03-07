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
  CartesianGrid,
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
      <div className="flex h-28 items-center justify-center rounded-lg border border-gray-100 bg-white">
        <ComponentLoader />
      </div>
    );
  }

  if (pivotedData.length === 0) {
    return <></>;
  }

  return (
    <div className="rounded-lg border border-gray-100 bg-white px-3 pb-1 pt-3">
      {/* Legend */}
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[11px] font-medium text-gray-400">
          Log Volume
        </span>
        <div className="flex items-center gap-3">
          {activeSeverities.map((severity: string) => {
            const color: SeverityColor = getSeverityColor(severity);
            return (
              <div
                key={severity}
                className="flex items-center gap-1"
              >
                <span
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ backgroundColor: color.fill }}
                />
                <span className="text-[10px] text-gray-400">
                  {color.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Chart */}
      <div className="h-24">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={pivotedData}
            margin={{ top: 0, right: 4, bottom: 0, left: -12 }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            barCategoryGap="20%"
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#f3f4f6"
              vertical={false}
            />
            <XAxis
              dataKey="time"
              tickFormatter={formatTickTime}
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              axisLine={{ stroke: "#e5e7eb" }}
              tickLine={false}
              minTickGap={50}
              dy={4}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
              width={44}
              allowDecimals={false}
            />
            <Tooltip
              content={<HistogramTooltip />}
              cursor={{ fill: "rgba(99,102,241,0.05)" }}
            />
            {activeSeverities.map((severity: string, index: number) => {
              const isLast: boolean = index === activeSeverities.length - 1;
              return (
                <Bar
                  key={severity}
                  dataKey={severity}
                  stackId="severity"
                  fill={getSeverityColor(severity).fill}
                  radius={isLast ? [2, 2, 0, 0] : [0, 0, 0, 0]}
                  isAnimationActive={false}
                />
              );
            })}
            {selectionStart && selectionEnd && (
              <ReferenceArea
                x1={selectionStart}
                x2={selectionEnd}
                fill="rgba(99,102,241,0.12)"
                stroke="rgba(99,102,241,0.4)"
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
