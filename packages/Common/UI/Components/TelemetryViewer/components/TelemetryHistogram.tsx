import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useMemo,
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
import { HistogramBucket, HistogramSeriesOption } from "../types";
import TelemetryHistogramTooltip from "./TelemetryHistogramTooltip";
import ComponentLoader from "../../ComponentLoader/ComponentLoader";
import OneUptimeDate from "../../../../Types/Date";
import useHistogramRangeSelection, {
  HistogramRangeSelectionState,
} from "../../Charts/Utils/useHistogramRangeSelection";

export interface TelemetryHistogramProps {
  buckets: Array<HistogramBucket>;
  isLoading: boolean;
  /*
   * All possible series stacked in the chart (in rendering order).
   * Only series that have at least one bucket will be drawn + legended.
   */
  series: Array<HistogramSeriesOption>;
  title?: string | undefined;
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
  // Extra controls rendered in the chart header (e.g. a metric selector).
  headerActions?: ReactNode;
  // Formats Y-axis ticks and tooltip values (e.g. milliseconds → "1.2 s").
  valueFormatter?: ((value: number) => string) | undefined;
}

interface PivotedRow {
  time: string;
  [series: string]: number | string;
}

function pivotBuckets(buckets: Array<HistogramBucket>): Array<PivotedRow> {
  const map: Map<string, PivotedRow> = new Map();

  for (const bucket of buckets) {
    let row: PivotedRow | undefined = map.get(bucket.time);

    if (!row) {
      row = { time: bucket.time };
      map.set(bucket.time, row);
    }

    row[bucket.series] = ((row[bucket.series] as number) || 0) + bucket.count;
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

const TelemetryHistogram: FunctionComponent<TelemetryHistogramProps> = (
  props: TelemetryHistogramProps,
): ReactElement => {
  const selection: HistogramRangeSelectionState = useHistogramRangeSelection({
    onTimeRangeSelect: props.onTimeRangeSelect,
    onZoomOut: props.onZoomOut,
    bucketIntervalMs: props.bucketIntervalMs,
  });

  const pivotedData: Array<PivotedRow> = useMemo(() => {
    return pivotBuckets(props.buckets);
  }, [props.buckets]);

  const seriesByKey: Record<string, HistogramSeriesOption> = useMemo(() => {
    const map: Record<string, HistogramSeriesOption> = {};
    for (const option of props.series) {
      map[option.key] = option;
    }
    return map;
  }, [props.series]);

  const activeSeries: Array<HistogramSeriesOption> = useMemo(() => {
    const present: Set<string> = new Set<string>();

    /*
     * A zero-count bucket holds a slot on the time axis (so a quiet stretch
     * reads as a gap rather than being squeezed out); it is not a sighting
     * of its series, which draws nothing and must not be legended.
     */
    for (const bucket of props.buckets) {
      if (bucket.count > 0) {
        present.add(bucket.series);
      }
    }

    return props.series.filter((option: HistogramSeriesOption): boolean => {
      return present.has(option.key);
    });
  }, [props.buckets, props.series]);

  if (props.isLoading && pivotedData.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-gray-200 bg-white">
        <ComponentLoader />
      </div>
    );
  }

  /*
   * With header actions (e.g. a metric selector) the header must survive an
   * empty result, or switching away from a metric with no data would strand
   * the user with no control to switch back.
   */
  if (pivotedData.length === 0 && !props.headerActions) {
    return <></>;
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      {/*
       * Below md the header wraps rather than overflowing: at phone width a
       * legend of several series plus the header actions ran past the
       * viewport and scrolled the whole page sideways. From md up it is the
       * single row it always was (md:flex-nowrap, md:gap-x-0).
       */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-gray-100 px-4 py-2 md:flex-nowrap md:gap-x-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 md:flex-nowrap">
          <span className="text-xs font-medium text-gray-500">
            {props.title || "Volume"}
          </span>
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 md:flex-nowrap">
          {activeSeries.map((option: HistogramSeriesOption) => {
            return (
              <div key={option.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: option.color }}
                />
                <span className="text-[11px] text-gray-500">
                  {option.label}
                </span>
              </div>
            );
          })}
          {props.headerActions}
        </div>
      </div>
      {pivotedData.length === 0 && (
        <div className="flex h-[120px] items-center justify-center text-xs text-gray-400">
          No data for this metric in the selected range
        </div>
      )}

      {pivotedData.length > 0 && (
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
                allowDecimals={Boolean(props.valueFormatter)}
                tickFormatter={props.valueFormatter || formatYAxisTick}
              />
              {/*
               * The tooltip is pinned shut for the length of a drag: it would
               * otherwise sit over the very bars the reader is trying to read
               * while they pick the range. Dropping the prop hands control back
               * to recharts once the drag ends.
               */}
              <Tooltip
                content={
                  <TelemetryHistogramTooltip
                    seriesByKey={seriesByKey}
                    valueFormatter={props.valueFormatter}
                  />
                }
                cursor={{ fill: "rgba(99,102,241,0.06)" }}
                {...(selection.isDragging ? { active: false } : {})}
              />
              {activeSeries.map(
                (option: HistogramSeriesOption, index: number) => {
                  const isLast: boolean = index === activeSeries.length - 1;
                  return (
                    <Bar
                      key={option.key}
                      dataKey={option.key}
                      stackId="series"
                      fill={option.color}
                      radius={isLast ? [1.5, 1.5, 0, 0] : [0, 0, 0, 0]}
                      isAnimationActive={false}
                      maxBarSize={24}
                    />
                  );
                },
              )}
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
      )}
    </div>
  );
};

export default TelemetryHistogram;
