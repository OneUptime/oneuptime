import { act, fireEvent, within } from "@testing-library/react";
import React, { ReactElement, useMemo } from "react";
import type { LineInternalProps } from "../../../UI/Components/Charts/Line/LineChart";
import ChartDataPoint, {
  CHART_DATA_POINT_DATE_KEY,
  CHART_DATA_POINT_X_AXIS_KEY,
} from "../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";
import useChartRangeSelection, {
  ChartRangeSelection,
  RangeSelectionChartState,
} from "../../../UI/Components/Charts/ChartLibrary/Utils/UseChartRangeSelection";
import DataPointUtil from "../../../UI/Components/Charts/Utils/DataPoint";
import {
  ChartTimeRangeZoomContextValue,
  ChartTimeRangeZoomHandlers,
  resolveChartTimeRangeZoom,
  useChartTimeRangeZoom,
} from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import XAxisType from "../../../UI/Components/Charts/Types/XAxis/XAxisType";

/*
 * A line chart stand-in that drags the way the real one does (issue #4105).
 *
 * ChartZoomHarness's stand-in hands a page whatever window a test picks,
 * which is fine for "does the page follow a zoom" but blind to WHICH window
 * a real drag produces. This one keeps everything between the chart's props
 * and the zoom real:
 *
 *   - the rows are built by the real DataPointUtil from the props the page
 *     passes (series, x-axis window, precision), exactly as the real
 *     wrapper builds them - labels, and the bucket start every row carries;
 *   - a drag is driven through the real useChartRangeSelection hook, with
 *     recharts' part (which row is under the pointer) played by one element
 *     per row: press on a row, move to another, release there;
 *   - the zoom handlers are resolved the way the real wrapper resolves them.
 *
 * So the window a test sees the page re-fetch is the one a reader's drag
 * over those buckets would produce. Wire it up from a suite with:
 *
 *   jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
 *     return {
 *       __esModule: true,
 *       default: (jest.requireActual("./RealRowsLineChart") as
 *         typeof import("./RealRowsLineChart")).RealRowsLineChart,
 *     };
 *   });
 */

export const REAL_ROWS_CHART_TEST_ID: string = "line-chart";
export const REAL_ROWS_ROW_TEST_ID: string = "chart-row";
export const REAL_ROWS_PLOT_TEST_ID: string = "chart-plot";

export interface RealChartRow {
  label: string;
  // The start of the bucket the row draws, as an ISO string.
  bucketStart: string;
  // The row's value for each series drawn in it.
  values: Record<string, number>;
}

function toChartState(rowIndex: number): RangeSelectionChartState {
  return { activeTooltipIndex: rowIndex };
}

export const RealRowsLineChart: React.FunctionComponent<LineInternalProps> = (
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

  const rows: Array<ChartDataPoint> = useMemo(() => {
    return DataPointUtil.getChartDataPoints({
      seriesPoints: props.data || [],
      xAxis: props.xAxis,
      yAxis: props.yAxis,
    });
  }, [props.data, props.xAxis, props.yAxis]);

  const selection: ChartRangeSelection = useChartRangeSelection({
    data: rows,
    index: CHART_DATA_POINT_X_AXIS_KEY,
    onTimeRangeSelect: zoom.onTimeRangeSelect,
  });

  const seriesNames: Array<string> = (props.data || []).map(
    (series: { seriesName: string }): string => {
      return series.seriesName;
    },
  );

  return (
    <div
      data-testid={REAL_ROWS_CHART_TEST_ID}
      data-window={`${new Date(props.xAxis.options.min as Date).toISOString()}/${new Date(
        props.xAxis.options.max as Date,
      ).toISOString()}`}
      data-height={String(props.heightInPx ?? "")}
      data-can-select={String(selection.canSelect)}
      data-can-reset={String(Boolean(zoom.onTimeRangeReset))}
    >
      {rows.map((row: ChartDataPoint, rowIndex: number): ReactElement => {
        const values: Record<string, number> = {};
        for (const name of seriesNames) {
          if (typeof row[name] === "number") {
            values[name] = row[name] as number;
          }
        }
        return (
          <div
            key={`${String(row[CHART_DATA_POINT_DATE_KEY])}-${rowIndex}`}
            data-testid={REAL_ROWS_ROW_TEST_ID}
            data-label={String(row[CHART_DATA_POINT_X_AXIS_KEY])}
            data-bucket-start={new Date(
              row[CHART_DATA_POINT_DATE_KEY] as number,
            ).toISOString()}
            data-values={JSON.stringify(values)}
            onMouseDown={(event: React.MouseEvent<HTMLDivElement>) => {
              selection.chartEventProps.onMouseDown?.(
                toChartState(rowIndex),
                event as unknown as React.MouseEvent<SVGGraphicsElement>,
              );
            }}
            onMouseMove={(event: React.MouseEvent<HTMLDivElement>) => {
              selection.chartEventProps.onMouseMove?.(
                toChartState(rowIndex),
                event as unknown as React.MouseEvent<SVGGraphicsElement>,
              );
            }}
            onMouseUp={() => {
              selection.chartEventProps.onMouseUp?.(toChartState(rowIndex));
            }}
          />
        );
      })}
      <div
        data-testid={REAL_ROWS_PLOT_TEST_ID}
        onDoubleClick={() => {
          zoom.onTimeRangeReset?.();
        }}
      />
    </div>
  );
};

// The rows the chart in `container` draws, in order.
export function realRowsOf(container: HTMLElement): Array<RealChartRow> {
  const chart: HTMLElement = within(container).getByTestId(
    REAL_ROWS_CHART_TEST_ID,
  );

  return within(chart)
    .queryAllByTestId(REAL_ROWS_ROW_TEST_ID)
    .map((row: HTMLElement): RealChartRow => {
      return {
        label: row.getAttribute("data-label") || "",
        bucketStart: row.getAttribute("data-bucket-start") || "",
        values: JSON.parse(row.getAttribute("data-values") || "{}") as Record<
          string,
          number
        >,
      };
    });
}

function rowStartingAt(container: HTMLElement, bucketStart: Date): HTMLElement {
  const chart: HTMLElement = within(container).getByTestId(
    REAL_ROWS_CHART_TEST_ID,
  );
  const iso: string = bucketStart.toISOString();
  const row: HTMLElement | undefined = within(chart)
    .queryAllByTestId(REAL_ROWS_ROW_TEST_ID)
    .find((candidate: HTMLElement): boolean => {
      return candidate.getAttribute("data-bucket-start") === iso;
    });

  if (!row) {
    throw new Error(
      `No row draws the bucket starting at ${iso}; the rows start at ${realRowsOf(
        container,
      )
        .map((candidate: RealChartRow): string => {
          return candidate.bucketStart;
        })
        .join(", ")}`,
    );
  }

  return row;
}

/*
 * Lets every stubbed request answer and the page settle without moving the
 * fake clock (waitFor would).
 */
export async function settleRealRows(): Promise<void> {
  for (let i: number = 0; i < 25; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/*
 * A drag on the chart in `container`: pressed on the row drawing the bucket
 * that starts at `from`, moved to the row drawing the bucket that starts at
 * `to`, released there. Either way round, as a reader can drag either way.
 */
export async function dragRealRows(
  container: HTMLElement,
  from: Date,
  to: Date,
): Promise<void> {
  const pressed: HTMLElement = rowStartingAt(container, from);
  const released: HTMLElement = rowStartingAt(container, to);

  fireEvent.mouseDown(pressed, { button: 0, buttons: 1 });
  fireEvent.mouseMove(released, { buttons: 1 });
  fireEvent.mouseUp(released, { button: 0 });
  await settleRealRows();
}

// A double-click on the plot of the chart in `container`.
export async function doubleClickRealRows(
  container: HTMLElement,
): Promise<void> {
  fireEvent.doubleClick(
    within(within(container).getByTestId(REAL_ROWS_CHART_TEST_ID)).getByTestId(
      REAL_ROWS_PLOT_TEST_ID,
    ),
  );
  await settleRealRows();
}

// The window the chart in `container` is drawn over, as start/end ISO.
export function realRowsWindowOf(container: HTMLElement): string {
  return (
    within(container)
      .getByTestId(REAL_ROWS_CHART_TEST_ID)
      .getAttribute("data-window") || ""
  );
}
