import * as React from "react";
import {
  ChartTimeRangeZoomHandlers,
  resolveChartTimeRangeZoom,
  useChartTimeRangeZoom,
} from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import SeriesPoint from "../../../UI/Components/Charts/Types/SeriesPoints";
import XAxisType from "../../../UI/Components/Charts/Types/XAxis/XAxisType";

/*
 * A stand-in for the chart library's line / area / bar wrappers, for the
 * page tests of issue #4105 (drag across any chart to zoom the page,
 * double-click any chart to go back). jsdom has no layout, so a real
 * recharts surface can neither be dragged nor tell which bucket is under
 * the pointer; what a page test needs is the zoom each chart ENDS UP WITH.
 *
 * So the stand-in resolves its zoom exactly as the real wrappers do - the
 * host's own handlers, else the page's (resolveChartTimeRangeZoom over
 * useChartTimeRangeZoom) - records it, and exposes the two gestures:
 *
 *   - a button "Drag across <chart>" that performs a drag over the window
 *     set in standInDrag;
 *   - the plot itself (data-testid "chart <chart>") takes a double-click,
 *     which resets only while a reset is offered, like the real chart.
 *
 * A chart is named by its series names (" + " between them), with its y-axis
 * legend in brackets when it has one: "Read + Write [ops/s]".
 *
 * Use it from a test with:
 *
 *   jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
 *     return {
 *       ...(jest.requireActual("../../../UI/Components/Charts/Line/LineChart") as Record<string, unknown>),
 *       __esModule: true,
 *       default: (jest.requireActual("./ChartZoomStandIn") as { default: unknown }).default,
 *     };
 *   });
 */

export interface StandInChartProps {
  data: Array<SeriesPoint>;
  xAxis: {
    options: {
      type: XAxisType;
      min: Date | number;
      max: Date | number;
      precision?: unknown;
    };
  };
  yAxis?: { legend?: string | undefined } | undefined;
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  disableTimeRangeZoom?: boolean | undefined;
}

export interface StandInChartRecord {
  name: string;
  zoom: ChartTimeRangeZoomHandlers;
  props: StandInChartProps;
}

// The latest render of every stood-in chart, by name.
export const standInCharts: Map<string, StandInChartRecord> = new Map();

// The window the next "Drag across ..." click selects.
export const standInDrag: { start: Date; end: Date } = {
  start: new Date(0),
  end: new Date(0),
};

export function getStandInChartName(
  data: Array<SeriesPoint>,
  yAxisLegend: string | undefined,
): string {
  const series: string = data
    .map((item: SeriesPoint): string => {
      return item.seriesName;
    })
    .join(" + ");
  return yAxisLegend ? `${series} [${yAxisLegend}]` : series;
}

export function getStandInChart(name: string): StandInChartRecord {
  const record: StandInChartRecord | undefined = standInCharts.get(name);
  if (!record) {
    throw new Error(
      `The chart "${name}" has not rendered. Rendered: ${Array.from(
        standInCharts.keys(),
      ).join(", ")}`,
    );
  }
  return record;
}

export function resetStandInCharts(): void {
  standInCharts.clear();
  standInDrag.start = new Date(0);
  standInDrag.end = new Date(0);
}

const ChartZoomStandIn: React.FunctionComponent<StandInChartProps> = (
  props: StandInChartProps,
): React.ReactElement => {
  const zoom: ChartTimeRangeZoomHandlers = resolveChartTimeRangeZoom({
    onTimeRangeSelect: props.onTimeRangeSelect,
    onTimeRangeReset: props.onTimeRangeReset,
    isTimeAxis:
      props.xAxis.options.type === XAxisType.Time ||
      props.xAxis.options.type === XAxisType.Date,
    disableTimeRangeZoom: props.disableTimeRangeZoom,
    pageZoom: useChartTimeRangeZoom(),
  });
  const name: string = getStandInChartName(props.data, props.yAxis?.legend);

  standInCharts.set(name, { name: name, zoom: zoom, props: props });

  return (
    <div data-testid={`chart ${name}`} onDoubleClick={zoom.onTimeRangeReset}>
      <button
        type="button"
        onClick={() => {
          zoom.onTimeRangeSelect?.(standInDrag.start, standInDrag.end);
        }}
      >
        {`Drag across ${name}`}
      </button>
    </div>
  );
};

export default ChartZoomStandIn;
