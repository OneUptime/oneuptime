import { fireEvent, within } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import {
  ChartTimeRangeZoomContextValue,
  ChartTimeRangeZoomHandlers,
  resolveChartTimeRangeZoom,
  useChartTimeRangeZoom,
} from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import XAxisType from "../../../UI/Components/Charts/Types/XAxis/XAxisType";

/*
 * A stand-in for the Line, Area and Bar chart wrappers, for tests that
 * check a whole PAGE's drag-to-zoom (issue #4105). A real recharts surface
 * cannot be dragged in jsdom, and what a page test needs to know is which
 * zoom each chart ended up with, not how recharts paints a selection band.
 *
 * The stand-in resolves its zoom exactly the way the wrappers do (the
 * host's own handlers, else the page's, and only on a time axis), then
 * offers the two gestures:
 *
 *   - a "drag" button, which selects the window set by dragAcrossChart;
 *   - a double-click on the plot, listened for only while a reset is
 *     offered, as on the real chart.
 *
 * Use it from a jest.mock factory, keeping the wrapper's other exports
 * (MetricCharts reads the palettes from them):
 *
 *   jest.mock("../../../UI/Components/Charts/Area/AreaChart", () => {
 *     return (
 *       jest.requireActual("./ChartZoomStandIn") as typeof import("./ChartZoomStandIn")
 *     ).chartModuleStandIn(
 *       "area",
 *       jest.requireActual("../../../UI/Components/Charts/Area/AreaChart"),
 *     );
 *   });
 */

export const CHART_STAND_IN_TEST_ID: string = "chart-stand-in";
export const CHART_STAND_IN_DRAG_TEST_ID: string = "chart-stand-in-drag";

export interface ChartStandInProps {
  data?: Array<{ seriesName: string }> | undefined;
  xAxis: {
    options: {
      type: XAxisType | string;
      min?: Date | string | undefined;
      max?: Date | string | undefined;
    };
  };
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  disableTimeRangeZoom?: boolean | undefined;
}

interface DragWindow {
  start: Date;
  end: Date;
}

// The zoom each rendered chart ended up with, by its plot element.
const zoomByChart: Map<HTMLElement, ChartTimeRangeZoomHandlers> = new Map();

// The window the next press of a chart's "drag" button selects.
let nextDragWindow: DragWindow | null = null;

function toIsoString(value: Date | string | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value ? new Date(value).toISOString() : "";
}

interface StandInProps extends ChartStandInProps {
  kind: string;
}

const ChartStandIn: FunctionComponent<StandInProps> = (
  props: StandInProps,
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
  const onTimeRangeSelect:
    | ((startTime: Date, endTime: Date) => void)
    | undefined = zoom.onTimeRangeSelect;
  const onTimeRangeReset: (() => void) | undefined = zoom.onTimeRangeReset;

  return (
    <div
      data-testid={CHART_STAND_IN_TEST_ID}
      data-kind={props.kind}
      data-window={`${toIsoString(props.xAxis.options.min)}/${toIsoString(props.xAxis.options.max)}`}
      data-series={(props.data || [])
        .map((series: { seriesName: string }): string => {
          return series.seriesName;
        })
        .join(",")}
      ref={(element: HTMLDivElement | null): void => {
        if (element) {
          zoomByChart.set(element, zoom);
        }
      }}
      {...(onTimeRangeReset
        ? {
            onDoubleClick: (): void => {
              onTimeRangeReset();
            },
          }
        : {})}
    >
      {onTimeRangeSelect ? (
        <button
          type="button"
          data-testid={CHART_STAND_IN_DRAG_TEST_ID}
          onClick={() => {
            if (nextDragWindow) {
              onTimeRangeSelect(nextDragWindow.start, nextDragWindow.end);
            }
          }}
        >
          drag
        </button>
      ) : null}
    </div>
  );
};

// A chart wrapper module with its default export swapped for the stand-in.
export function chartModuleStandIn(
  kind: string,
  actualModule: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...actualModule,
    __esModule: true,
    default: (props: ChartStandInProps): ReactElement => {
      return <ChartStandIn {...props} kind={kind} />;
    },
  };
}

export function resetChartStandIns(): void {
  zoomByChart.clear();
  nextDragWindow = null;
}

// The zoom a rendered chart ended up with.
export function zoomOfChart(chart: HTMLElement): ChartTimeRangeZoomHandlers {
  const zoom: ChartTimeRangeZoomHandlers | undefined = zoomByChart.get(chart);

  if (!zoom) {
    throw new Error("That element is not a rendered chart stand-in.");
  }

  return zoom;
}

// The x-axis window a chart was drawn over, as "startISO/endISO".
export function windowOfChart(chart: HTMLElement): string {
  return chart.getAttribute("data-window") || "";
}

export function windowText(start: Date, end: Date): string {
  return `${start.toISOString()}/${end.toISOString()}`;
}

// A drag across the chart that selects [start, end).
export function dragAcrossChart(
  chart: HTMLElement,
  start: Date,
  end: Date,
): void {
  nextDragWindow = { start: start, end: end };
  fireEvent.click(within(chart).getByTestId(CHART_STAND_IN_DRAG_TEST_ID));
}

export function doubleClickChart(chart: HTMLElement): void {
  fireEvent.doubleClick(chart);
}

// Whether the chart offers a drag at all.
export function canDrag(chart: HTMLElement): boolean {
  return within(chart).queryByTestId(CHART_STAND_IN_DRAG_TEST_ID) !== null;
}
