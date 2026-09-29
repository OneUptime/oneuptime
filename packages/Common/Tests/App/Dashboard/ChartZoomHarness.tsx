import { act, fireEvent, within } from "@testing-library/react";
import React, { ReactElement } from "react";
import type { LineInternalProps } from "../../../UI/Components/Charts/Line/LineChart";
import {
  ChartTimeRangeZoomContextValue,
  ChartTimeRangeZoomHandlers,
  resolveChartTimeRangeZoom,
  useChartTimeRangeZoom,
} from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import XAxisType from "../../../UI/Components/Charts/Types/XAxis/XAxisType";

/*
 * Stand-ins for the charts of a page under a drag-to-zoom test (issue
 * #4105), and the gestures to drive them.
 *
 * A real recharts surface in jsdom has no geometry to drag across, so a
 * page suite swaps the chart for a stand-in and asks it for exactly what
 * the real one would do at the end of a gesture:
 *
 *   - the line chart resolves its zoom handlers the way the real wrapper
 *     does (its host's own, else the enclosing page's for a time axis);
 *   - the MetricView stand-in uses the handlers its host hands it, as the
 *     real view's charts do;
 *
 * and each renders a "drag" button (a finished drag-selection over
 * `chartZoomStandIns.dragWindow`) and a plot that takes a double-click.
 * Wire them up from a suite with:
 *
 *   jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
 *     return {
 *       __esModule: true,
 *       default: (jest.requireActual("./ChartZoomHarness") as
 *         typeof import("./ChartZoomHarness")).StandInLineChart,
 *     };
 *   });
 *
 * Note what is deliberately NOT here: what a page should do with a zoom.
 * Each suite spells out the windows it expects in full.
 */

export interface ChartZoomRecord {
  // What the chart's host passed.
  hostSelect: unknown;
  hostReset: unknown;
  hostDisable: unknown;
  // What the chart ended up with.
  select: ((startTime: Date, endTime: Date) => void) | undefined;
  reset: (() => void) | undefined;
}

export interface MetricViewRecord {
  window: string;
  queryTitles: Array<string>;
  select: ((startTime: Date, endTime: Date) => void) | undefined;
  reset: (() => void) | undefined;
}

export interface ChartZoomStandIns {
  // The window the next "drag" selects.
  dragWindow: { start: Date; end: Date };
  // Every render of every stand-in line chart, in order.
  lineCharts: Array<ChartZoomRecord>;
  // Every render of every stand-in MetricView, in order.
  metricViews: Array<MetricViewRecord>;
}

export const chartZoomStandIns: ChartZoomStandIns = {
  dragWindow: { start: new Date(0), end: new Date(0) },
  lineCharts: [],
  metricViews: [],
};

export function resetChartZoomStandIns(): void {
  chartZoomStandIns.dragWindow = { start: new Date(0), end: new Date(0) };
  chartZoomStandIns.lineCharts.length = 0;
  chartZoomStandIns.metricViews.length = 0;
}

export function windowKey(start: Date, end: Date): string {
  return `${new Date(start).toISOString()}/${new Date(end).toISOString()}`;
}

interface GestureTargetProps {
  onSelect: ((startTime: Date, endTime: Date) => void) | undefined;
  onReset: (() => void) | undefined;
}

const GestureTargets: React.FunctionComponent<GestureTargetProps> = (
  props: GestureTargetProps,
): ReactElement => {
  return (
    <>
      <button
        type="button"
        data-testid="chart-drag"
        onClick={() => {
          props.onSelect?.(
            chartZoomStandIns.dragWindow.start,
            chartZoomStandIns.dragWindow.end,
          );
        }}
      >
        drag
      </button>
      <div
        data-testid="chart-plot"
        onDoubleClick={() => {
          props.onReset?.();
        }}
      />
    </>
  );
};

export const StandInLineChart: React.FunctionComponent<LineInternalProps> = (
  props: LineInternalProps,
): ReactElement => {
  const pageZoom: ChartTimeRangeZoomContextValue | null =
    useChartTimeRangeZoom();
  const zoom: ChartTimeRangeZoomHandlers = resolveChartTimeRangeZoom({
    onTimeRangeSelect: props.onTimeRangeSelect,
    onTimeRangeReset: props.onTimeRangeReset,
    isTimeAxis:
      props.xAxis.options.type === XAxisType.Time ||
      props.xAxis.options.type === XAxisType.Date,
    disableTimeRangeZoom: props.disableTimeRangeZoom,
    pageZoom: pageZoom,
  });

  chartZoomStandIns.lineCharts.push({
    hostSelect: props.onTimeRangeSelect,
    hostReset: props.onTimeRangeReset,
    hostDisable: props.disableTimeRangeZoom,
    select: zoom.onTimeRangeSelect,
    reset: zoom.onTimeRangeReset,
  });

  const firstPoint: unknown = props.data[0]?.data[0]?.x;

  return (
    <div
      data-testid="line-chart"
      data-window={windowKey(
        props.xAxis.options.min as Date,
        props.xAxis.options.max as Date,
      )}
      data-series={props.data
        .map((series: { seriesName: string }): string => {
          return series.seriesName;
        })
        .join(",")}
      data-first-point={
        firstPoint ? new Date(firstPoint as Date).toISOString() : ""
      }
    >
      <GestureTargets
        onSelect={zoom.onTimeRangeSelect}
        onReset={zoom.onTimeRangeReset}
      />
    </div>
  );
};

export interface StandInMetricViewProps {
  data: {
    startAndEndDate?: { startValue: Date; endValue: Date } | undefined;
    queryConfigs?:
      | Array<{ metricAliasData?: { title?: string | undefined } }>
      | undefined;
  };
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
}

export const StandInMetricView: React.FunctionComponent<
  StandInMetricViewProps
> = (props: StandInMetricViewProps): ReactElement => {
  const start: Date = props.data.startAndEndDate?.startValue || new Date(0);
  const end: Date = props.data.startAndEndDate?.endValue || new Date(0);
  const queryTitles: Array<string> = (props.data.queryConfigs || []).map(
    (config: { metricAliasData?: { title?: string | undefined } }): string => {
      return config.metricAliasData?.title || "";
    },
  );

  chartZoomStandIns.metricViews.push({
    window: windowKey(start, end),
    queryTitles: queryTitles,
    select: props.onTimeRangeSelect,
    reset: props.onTimeRangeReset,
  });

  return (
    <div
      data-testid="metric-view"
      data-window={windowKey(start, end)}
      data-queries={queryTitles.join(",")}
    >
      <GestureTargets
        onSelect={props.onTimeRangeSelect}
        onReset={props.onTimeRangeReset}
      />
    </div>
  );
};

/*
 * Lets every stubbed request answer and the page settle WITHOUT moving the
 * fake clock (waitFor would): a relative range then resolves to exactly
 * the same window every time, so "back to Past 1 Hour" can be checked to
 * the millisecond.
 */
export async function settle(): Promise<void> {
  for (let i: number = 0; i < 25; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// A finished drag-selection over [start, end] on the chart in `container`.
export async function dragAcross(
  container: HTMLElement,
  start: Date,
  end: Date,
): Promise<void> {
  chartZoomStandIns.dragWindow = { start: start, end: end };
  fireEvent.click(within(container).getByTestId("chart-drag"));
  await settle();
}

// A double-click on the plot of the chart in `container`.
export async function doubleClickOn(container: HTMLElement): Promise<void> {
  fireEvent.doubleClick(within(container).getByTestId("chart-plot"));
  await settle();
}

// The window the chart in `container` is drawn over.
export function windowOf(container: HTMLElement): string {
  const chart: HTMLElement | null =
    within(container).queryByTestId("metric-view") ||
    within(container).queryByTestId("line-chart");

  if (!chart) {
    throw new Error("No chart in this container");
  }

  return chart.getAttribute("data-window") || "";
}
