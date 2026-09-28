import "@testing-library/jest-dom";
import { expect } from "@jest/globals";
import { act, fireEvent, screen, within } from "@testing-library/react";
import * as React from "react";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  ChartTimeRangeZoomContextValue,
  ChartTimeRangeZoomHandlers,
  resolveChartTimeRangeZoom,
  useChartTimeRangeZoom,
} from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { TIME_RANGE_ZOOM_HINT_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import XAxisType from "../../../UI/Components/Charts/Types/XAxis/XAxisType";
import { getTimeRangeButtonLabel } from "../../../UI/Components/Date/TimeRangePickerDropdown";
import { TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX } from "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";

/*
 * Helpers for the page-level drag-to-zoom suites (issue #4105): the Host,
 * VMware, Proxmox, Cloud and Serverless pages and the infrastructure
 * Metrics tab. Not a test file itself (no .test. in the name), so jest does
 * not run it.
 *
 * jsdom has no layout, so a real pointer drag across recharts can never be
 * resolved to a bucket (the chart library's own suites cover that). The
 * suites replace the line chart wrapper with StandInLineChart, which
 * resolves its zoom EXACTLY the way the real wrapper does - its host's
 * handlers, else the page's (resolveChartTimeRangeZoom) - and offers two
 * buttons: "drag" hands the chart's onTimeRangeSelect the window a test
 * asks for, and "double-click" calls its onTimeRangeReset when it has one,
 * as the chart library does. Everything above the chart - the page, its
 * TimeRangeZoomScope, its picker and its fetches - is the production code.
 *
 * Load it into a mock with jest.requireActual so the page and the test
 * share this one module:
 *
 *   jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
 *     const harness = jest.requireActual("./TimeRangeZoomPageHarness");
 *     return { __esModule: true, default: harness.StandInLineChart };
 *   });
 */

export const ZOOM_CHART_TEST_ID: string = "zoom-chart";

export interface StandInChartProps {
  data: Array<{ seriesName: string; data: Array<unknown> }>;
  xAxis: { options: { type: XAxisType; min: unknown; max: unknown } };
  syncid?: string | undefined;
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  disableTimeRangeZoom?: boolean | undefined;
}

interface DragWindow {
  start: Date;
  end: Date;
}

// The window the next click on a chart's "drag" button selects.
let nextDrag: DragWindow | null = null;

// What each mounted chart resolved on its latest render, by chart key.
const zoomByChartKey: Map<number, ChartTimeRangeZoomHandlers> = new Map();
let lastChartKey: number = 0;

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" || typeof value === "number") {
    return new Date(value).toISOString();
  }

  return "";
}

export const StandInLineChart: React.FunctionComponent<StandInChartProps> = (
  props: StandInChartProps,
): React.ReactElement => {
  const keyRef: React.MutableRefObject<number> = React.useRef<number>(0);

  if (keyRef.current === 0) {
    lastChartKey += 1;
    keyRef.current = lastChartKey;
  }

  const chartKey: number = keyRef.current;
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

  zoomByChartKey.set(chartKey, zoom);

  React.useEffect(() => {
    return () => {
      zoomByChartKey.delete(chartKey);
    };
  }, []);

  return (
    <div
      data-testid={ZOOM_CHART_TEST_ID}
      data-chart-key={chartKey}
      data-syncid={props.syncid || ""}
      data-window-start={toIsoString(props.xAxis.options.min)}
      data-window-end={toIsoString(props.xAxis.options.max)}
      data-series={props.data
        .map((series: { seriesName: string }): string => {
          return series.seriesName;
        })
        .join(",")}
    >
      <button
        type="button"
        data-testid="zoom-chart-drag"
        onClick={() => {
          if (nextDrag) {
            zoom.onTimeRangeSelect?.(nextDrag.start, nextDrag.end);
          }
        }}
      >
        Drag across the chart
      </button>
      <button
        type="button"
        data-testid="zoom-chart-double-click"
        onClick={() => {
          zoom.onTimeRangeReset?.();
        }}
      >
        Double-click the chart
      </button>
    </div>
  );
};

export const METRIC_VIEW_TEST_ID: string = "metric-view";

export interface StandInMetricViewProps {
  data: { startAndEndDate: { startValue: Date; endValue: Date } };
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  refreshNonce?: number | undefined;
}

/*
 * The MetricView an EmbeddedMetricCard renders (its own zoom handling has
 * its own suite). It shows the window the card hands it and plays the
 * card's handlers through the same "drag" / "double-click" buttons as the
 * chart stand-in, so the helpers below work on either.
 */
export const StandInMetricView: React.FunctionComponent<
  StandInMetricViewProps
> = (props: StandInMetricViewProps): React.ReactElement => {
  const keyRef: React.MutableRefObject<number> = React.useRef<number>(0);

  if (keyRef.current === 0) {
    lastChartKey += 1;
    keyRef.current = lastChartKey;
  }

  const viewKey: number = keyRef.current;

  zoomByChartKey.set(viewKey, {
    onTimeRangeSelect: props.onTimeRangeSelect,
    onTimeRangeReset: props.onTimeRangeReset,
  });

  React.useEffect(() => {
    return () => {
      zoomByChartKey.delete(viewKey);
    };
  }, []);

  return (
    <div
      data-testid={METRIC_VIEW_TEST_ID}
      data-chart-key={viewKey}
      data-window-start={toIsoString(props.data.startAndEndDate.startValue)}
      data-window-end={toIsoString(props.data.startAndEndDate.endValue)}
      data-refresh-nonce={String(props.refreshNonce ?? 0)}
    >
      <button
        type="button"
        data-testid="zoom-chart-drag"
        onClick={() => {
          if (nextDrag) {
            props.onTimeRangeSelect?.(nextDrag.start, nextDrag.end);
          }
        }}
      >
        Drag across the chart
      </button>
      <button
        type="button"
        data-testid="zoom-chart-double-click"
        onClick={() => {
          props.onTimeRangeReset?.();
        }}
      >
        Double-click the chart
      </button>
    </div>
  );
};

export const CARD_PICKER_TEST_ID: string = "card-picker";

export interface StandInRangeStartAndEndDateViewProps {
  dashboardStartAndEndDate: { range: string };
  onChange: (value: { range: string }) => void;
}

/*
 * An EmbeddedMetricCard's own picker: shows the card's range, and picks
 * "Past 1 Day" when pressed.
 */
export const StandInRangeStartAndEndDateView: React.FunctionComponent<
  StandInRangeStartAndEndDateViewProps
> = (props: StandInRangeStartAndEndDateViewProps): React.ReactElement => {
  return (
    <button
      type="button"
      data-testid={CARD_PICKER_TEST_ID}
      onClick={() => {
        props.onChange({ range: TimeRange.PAST_ONE_DAY });
      }}
    >
      {props.dashboardStartAndEndDate.range}
    </button>
  );
};

export function metricViews(): Array<HTMLElement> {
  return screen.queryAllByTestId(METRIC_VIEW_TEST_ID);
}

export function cardPickers(): Array<HTMLElement> {
  return screen.queryAllByTestId(CARD_PICKER_TEST_ID);
}

export interface StandInAutoRefreshControlProps {
  onManualRefresh: () => void;
  timeRangePicker?: React.ReactElement | undefined;
}

/*
 * The hero's refresh cluster, reduced to what these suites look at: the
 * page's own time picker (rendered for real, Reset zoom and all) and the
 * manual refresh.
 */
export const StandInAutoRefreshControl: React.FunctionComponent<
  StandInAutoRefreshControlProps
> = (props: StandInAutoRefreshControlProps): React.ReactElement => {
  return (
    <div data-testid="auto-refresh-control">
      {props.timeRangePicker ?? null}
      <button
        type="button"
        data-testid="manual-refresh"
        onClick={props.onManualRefresh}
      >
        Refresh now
      </button>
    </div>
  );
};

// Let every pending promise (mocked fetches, state updates) settle.
export async function flush(): Promise<void> {
  for (let i: number = 0; i < 15; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// The chart stand-ins on screen, in document order.
export function zoomCharts(): Array<HTMLElement> {
  return screen.queryAllByTestId(ZOOM_CHART_TEST_ID);
}

export function zoomChart(index: number): HTMLElement {
  const charts: Array<HTMLElement> = zoomCharts();
  const chart: HTMLElement | undefined = charts[index];

  if (!chart) {
    throw new Error(
      `Expected a chart at index ${index}; ${charts.length} on screen.`,
    );
  }

  return chart;
}

/*
 * The zoom each stand-in (chart or metric view) holds, in the order given;
 * the charts on screen by default.
 */
export function chartZooms(
  among: Array<HTMLElement> = zoomCharts(),
): Array<ChartTimeRangeZoomHandlers> {
  return among.map((element: HTMLElement): ChartTimeRangeZoomHandlers => {
    const zoom: ChartTimeRangeZoomHandlers | undefined = zoomByChartKey.get(
      Number(element.getAttribute("data-chart-key")),
    );

    if (!zoom) {
      throw new Error("A chart on screen has no recorded zoom.");
    }

    return zoom;
  });
}

/*
 * Every chart (by default: every chart on screen) holds the SAME zoom: one
 * drag handler, and one reset that exists exactly while the page is
 * zoomed. A chart with a zoom of its own would hold different functions.
 */
export function expectOneSharedZoom(options: {
  zoomed: boolean;
  among?: Array<HTMLElement> | undefined;
}): void {
  const zooms: Array<ChartTimeRangeZoomHandlers> = chartZooms(
    options.among || zoomCharts(),
  );

  expect(zooms.length).toBeGreaterThan(0);

  const first: ChartTimeRangeZoomHandlers = zooms[0]!;

  expect(first.onTimeRangeSelect).toBeInstanceOf(Function);

  for (const zoom of zooms) {
    expect(zoom.onTimeRangeSelect).toBe(first.onTimeRangeSelect);
    expect(zoom.onTimeRangeReset).toBe(first.onTimeRangeReset);
  }

  if (options.zoomed) {
    expect(first.onTimeRangeReset).toBeInstanceOf(Function);
  } else {
    expect(first.onTimeRangeReset).toBeUndefined();
  }
}

// A drag across `chart` that selects [start, end).
export async function dragAcross(
  chart: HTMLElement,
  start: Date,
  end: Date,
): Promise<void> {
  nextDrag = { start: start, end: end };
  fireEvent.click(within(chart).getByTestId("zoom-chart-drag"));
  nextDrag = null;
  await flush();
}

export async function doubleClick(chart: HTMLElement): Promise<void> {
  fireEvent.click(within(chart).getByTestId("zoom-chart-double-click"));
  await flush();
}

// The window a chart is drawn over, as ISO strings.
export function chartWindow(chart: HTMLElement): [string, string] {
  return [
    chart.getAttribute("data-window-start") || "",
    chart.getAttribute("data-window-end") || "",
  ];
}

export function chartWindows(
  among: Array<HTMLElement> = zoomCharts(),
): Array<[string, string]> {
  return among.map(chartWindow);
}

export function windowOf(start: Date, end: Date): [string, string] {
  return [start.toISOString(), end.toISOString()];
}

export function pickerButton(): HTMLElement {
  return screen.getByTestId(
    `${TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX}-button`,
  );
}

export function pickerLabel(): string {
  return (pickerButton().textContent || "").trim();
}

// What the page's picker reads once the page is on [start, end).
export function customRangeLabel(start: Date, end: Date): string {
  return getTimeRangeButtonLabel({
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(start, end),
  });
}

export function presetLabel(range: TimeRange): string {
  return getTimeRangeButtonLabel({ range: range });
}

// Pick a preset ("Past 1 Hour") in the page's own picker.
export async function pickPreset(label: string): Promise<void> {
  fireEvent.click(pickerButton());
  fireEvent.click(screen.getByRole("button", { name: label }));
  await flush();
}

export function resetZoomButtons(): Array<HTMLElement> {
  return screen.queryAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

export function zoomHints(): Array<HTMLElement> {
  return screen.queryAllByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID);
}

/*
 * A hint revealed on hover must sit inside an ancestor with the named
 * Tailwind group (group/zoomhint), or it would never become visible.
 */
export function expectRevealedOnHoverOf(hint: HTMLElement): HTMLElement {
  expect(hint).toHaveClass("group-hover/zoomhint:opacity-100");

  const group: HTMLElement | null = hint.closest('[class~="group/zoomhint"]');

  expect(group).not.toBeNull();

  return group as HTMLElement;
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  let reject: (error: Error) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>(
    (
      resolvePromise: (value: T) => void,
      rejectPromise: (error: Error) => void,
    ) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    },
  );

  return { promise: promise, resolve: resolve, reject: reject };
}
