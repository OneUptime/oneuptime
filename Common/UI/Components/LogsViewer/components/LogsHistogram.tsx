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
import { getSeverityColor, getAllSeverityKeys } from "./severityColors";
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
      <div className="flex h-16 items-center justify-center bg-white">
        <ComponentLoader />
      </div>
    );
  }

  if (pivotedData.length === 0) {
    return <></>;
  }

  return (
    <div className="bg-white px-2 pb-0 pt-2">
      <div className="h-16">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={pivotedData}
            margin={{ top: 2, right: 4, bottom: 0, left: 0 }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            barCategoryGap="15%"
          >
            <XAxis
              dataKey="time"
              tickFormatter={formatTickTime}
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
              width={40}
              allowDecimals={false}
            />
            <Tooltip
              content={<HistogramTooltip />}
              cursor={{ fill: "rgba(99,102,241,0.06)" }}
            />
            {activeSeverities.map((severity: string) => (
              <Bar
                key={severity}
                dataKey={severity}
                stackId="severity"
                fill={getSeverityColor(severity).fill}
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              />
            ))}
            {selectionStart && selectionEnd && (
              <ReferenceArea
                x1={selectionStart}
                x2={selectionEnd}
                fill="rgba(99,102,241,0.15)"
                stroke="rgba(99,102,241,0.4)"
                strokeWidth={1}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default LogsHistogram;
