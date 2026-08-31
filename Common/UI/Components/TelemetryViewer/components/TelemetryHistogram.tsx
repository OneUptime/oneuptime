import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
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
import { HistogramBucket, HistogramSeriesOption } from "../types";
import TelemetryHistogramTooltip from "./TelemetryHistogramTooltip";
import ComponentLoader from "../../ComponentLoader/ComponentLoader";
import OneUptimeDate from "../../../../Types/Date";

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
  const [selectionStart, setSelectionStart] = useState<string | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<string | null>(null);
  const isSelecting: React.MutableRefObject<boolean> = useRef(false);
  /*
   * Mirrors isSelecting for rendering. The ref stays the authority so a
   * mouseup handled twice (chart *and* window, below) cannot commit the same
   * drag twice; the state is only here so the drag can change what is drawn.
   */
  const [isDragging, setIsDragging] = useState<boolean>(false);

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

    for (const bucket of props.buckets) {
      present.add(bucket.series);
    }

    return props.series.filter((option: HistogramSeriesOption): boolean => {
      return present.has(option.key);
    });
  }, [props.buckets, props.series]);

  const handleMouseDown: (e: any) => void = useCallback(
    (e: any): void => {
      if (!props.onTimeRangeSelect || !e?.activeLabel) {
        return;
      }

      isSelecting.current = true;
      setIsDragging(true);
      setSelectionStart(e.activeLabel as string);
      setSelectionEnd(null);
    },
    [props.onTimeRangeSelect],
  );

  const handleMouseMove: (e: any) => void = useCallback((e: any): void => {
    if (!isSelecting.current || !e?.activeLabel) {
      return;
    }

    setSelectionEnd(e.activeLabel as string);
  }, []);

  const handleMouseUp: () => void = useCallback((): void => {
    if (
      !isSelecting.current ||
      !selectionStart ||
      !selectionEnd ||
      !props.onTimeRangeSelect
    ) {
      isSelecting.current = false;
      setIsDragging(false);
      setSelectionStart(null);
      setSelectionEnd(null);
      return;
    }

    isSelecting.current = false;
    setIsDragging(false);

    const start: Date = OneUptimeDate.fromString(selectionStart);
    const end: Date = OneUptimeDate.fromString(selectionEnd);

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

  /*
   * Readers routinely drag past the edge of a 120px-tall chart and let go
   * outside it, where the chart's own mouseup never fires. Without this the
   * drag would never end: the selection band would stay painted and the
   * tooltip would stay suppressed until the next click.
   */
  useEffect(() => {
    if (!isDragging) {
      return undefined;
    }

    const finishDragOutsideChart: () => void = (): void => {
      handleMouseUp();
    };

    window.addEventListener("mouseup", finishDragOutsideChart);

    return () => {
      window.removeEventListener("mouseup", finishDragOutsideChart);
    };
  }, [isDragging, handleMouseUp]);

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
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500">
            {props.title || "Volume"}
          </span>
          {props.onTimeRangeSelect && (
            <span className="text-[10px] text-gray-300">Drag to zoom</span>
          )}
          {props.onZoomOut && (
            <span className="text-[10px] text-gray-300">
              Double-click to zoom out
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
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
          onDoubleClick={props.onZoomOut}
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
                {...(isDragging ? { active: false } : {})}
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
      )}
    </div>
  );
};

export default TelemetryHistogram;
