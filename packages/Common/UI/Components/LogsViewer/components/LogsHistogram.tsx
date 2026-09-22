import React, { FunctionComponent, ReactElement, useMemo } from "react";
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
import OneUptimeDate from "../../../../Types/Date";
import useHistogramRangeSelection, {
  HistogramRangeSelectionState,
} from "../../Charts/Utils/useHistogramRangeSelection";

export interface LogsHistogramProps {
  buckets: Array<HistogramBucket>;
  isLoading: boolean;
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  /*
   * Set only while the chart is showing a window the reader dragged out of
   * it. Double-clicking the chart then puts them back on the window they
   * started from.
   */
  onZoomOut?: (() => void) | undefined;
  /*
   * How much time one bar covers. With it a click on a bar zooms into that
   * bar and a drag zooms through the end of the last bar it covered; without
   * it a selection can only run from one bar's start to another's.
   */
  bucketIntervalMs?: number | undefined;
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
  const date: Date = OneUptimeDate.fromString(time);

  if (isNaN(date.getTime())) {
    return time;
  }

  return OneUptimeDate.getLocalTimeString(date, {
    use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
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
  const selection: HistogramRangeSelectionState = useHistogramRangeSelection({
    onTimeRangeSelect: props.onTimeRangeSelect,
    onZoomOut: props.onZoomOut,
    bucketIntervalMs: props.bucketIntervalMs,
  });

  const pivotedData: Array<PivotedRow> = useMemo(() => {
    return pivotBuckets(props.buckets);
  }, [props.buckets]);

  const activeSeverities: Array<string> = useMemo(() => {
    const present: Set<string> = new Set<string>();

    for (const bucket of props.buckets) {
      present.add(bucket.severity);
    }

    return getAllSeverityKeys().filter((key: string): boolean => {
      return present.has(key);
    });
  }, [props.buckets]);

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
          <span className="text-xs font-medium text-gray-500">Log Volume</span>
          {props.onTimeRangeSelect && (
            <span className="text-[10px] text-gray-300">
              {selection.canClickToZoom
                ? "Click or drag to zoom"
                : "Drag to zoom"}
            </span>
          )}
          {props.onZoomOut && (
            <span className="text-[10px] text-gray-300">
              Double-click to zoom out
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {activeSeverities.map((severity: string) => {
            const color: SeverityColor = getSeverityColor(severity);
            return (
              <div key={severity} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: color.fill }}
                />
                <span className="text-[11px] text-gray-500">{color.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Chart */}
      <div
        className="select-none px-2 pb-1 pt-2"
        style={{
          height: 120,
          cursor: props.onTimeRangeSelect ? "crosshair" : "default",
        }}
        onDoubleClick={selection.onDoubleClick}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={pivotedData}
            margin={{ top: 4, right: 8, bottom: 0, left: -4 }}
            onMouseDown={selection.onMouseDown}
            onMouseMove={selection.onMouseMove}
            onMouseUp={selection.onMouseUp}
            barCategoryGap="15%"
            barGap={0}
          >
            <XAxis
              dataKey="time"
              tickFormatter={formatTickTime}
              tick={{
                fontSize: 10,
                fill: "var(--ou-chart-tick, #9ca3af)",
              }}
              axisLine={{ stroke: "var(--ou-chart-grid, #e5e7eb)" }}
              tickLine={false}
              minTickGap={40}
              dy={4}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{
                fontSize: 10,
                fill: "var(--ou-chart-tick, #9ca3af)",
              }}
              axisLine={false}
              tickLine={false}
              width={48}
              allowDecimals={false}
              tickFormatter={formatYAxisTick}
            />
            {/*
             * The tooltip is pinned shut for the length of a drag: it would
             * otherwise sit over the very bars the reader is trying to read
             * while they pick the range. Dropping the prop hands control back
             * to recharts once the drag ends.
             */}
            <Tooltip
              content={<HistogramTooltip />}
              cursor={{ fill: "rgba(99,102,241,0.06)" }}
              {...(selection.isDragging ? { active: false } : {})}
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
            {selection.selectionStart && selection.selectionEnd && (
              <ReferenceArea
                x1={selection.selectionStart}
                x2={selection.selectionEnd}
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
