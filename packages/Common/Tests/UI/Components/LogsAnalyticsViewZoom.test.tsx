/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { DOUBLE_CLICK_DISAMBIGUATION_MS } from "../../../UI/Components/Charts/ChartLibrary/Utils/DoubleClick";

/*
 * Issue #4105: the Analytics view's timeseries is a time chart like the
 * volume histogram above it, so a drag across it zooms the logs viewer and a
 * double-click zooms back out. It uses the same click-or-drag selection as
 * the histogram, over the same bucket-start labels, and takes its zoom from
 * the viewer around it (or from handlers its host passes).
 *
 * Recharts is stood in for with a chart that lays each bucket out as a div
 * and forwards the mouse events the real one does - jsdom cannot lay out the
 * real SVG (see LogsHistogramDragTooltip.test.tsx).
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return new Map();
    },
  };
});

jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;
  const actual: Record<
    string,
    React.ComponentType<Record<string, unknown>>
  > = jest.requireActual("recharts") as Record<
    string,
    React.ComponentType<Record<string, unknown>>
  >;

  interface StubRow {
    time: string;
  }

  interface StubChartProps {
    data: Array<StubRow>;
    children?: React.ReactNode;
    style?: React.CSSProperties;
    onMouseDown?: (state: { activeLabel: string }) => void;
    onMouseMove?: (state: { activeLabel: string }) => void;
    onMouseUp?: (state: { activeLabel: string }) => void;
  }

  const chart: (
    testId: string,
    rootName: string,
  ) => (props: StubChartProps) => React.ReactElement = (
    testId: string,
    rootName: string,
  ) => {
    return (props: StubChartProps): React.ReactElement => {
      return react.createElement(
        "div",
        { "data-testid": testId },
        /*
         * The real chart root, sized and handed exactly the style the view
         * gives its own. Its .recharts-wrapper carries recharts' inline
         * `cursor: default` over the whole plot, so that element's cursor
         * is the one the reader sees.
         */
        react.createElement(actual[rootName]!, {
          data: props.data,
          width: 400,
          height: 200,
          ...(props.style ? { style: props.style } : {}),
        }),
        props.data.map((row: StubRow) => {
          return react.createElement("div", {
            key: row.time,
            "data-testid": `bucket-${row.time}`,
            onMouseDown: () => {
              props.onMouseDown?.({ activeLabel: row.time });
            },
            onMouseMove: () => {
              props.onMouseMove?.({ activeLabel: row.time });
            },
            onMouseUp: () => {
              props.onMouseUp?.({ activeLabel: row.time });
            },
          });
        }),
        props.children,
      );
    };
  };

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    AreaChart: chart("area-chart", "AreaChart"),
    BarChart: chart("bar-chart", "BarChart"),
    Area: nothing,
    Bar: nothing,
    XAxis: nothing,
    YAxis: nothing,
    CartesianGrid: nothing,
    Tooltip: (props: { active?: boolean }) => {
      return react.createElement("div", {
        "data-testid": "tooltip",
        "data-active": String(props.active),
      });
    },
    ReferenceArea: (props: { x1: string; x2: string }) => {
      return react.createElement("div", {
        "data-testid": "selection-band",
        "data-x1": props.x1,
        "data-x2": props.x2,
      });
    },
  };
});

// Imported after the mocks so the view picks them up.
import LogsAnalyticsView, {
  LOGS_ANALYTICS_TIMESERIES_TEST_ID,
  LOGS_ANALYTICS_ZOOM_HINT_TEST_ID,
} from "../../../UI/Components/LogsViewer/components/LogsAnalyticsView";
import { TimeRangeZoomProvider } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");

// One hour, so the view buckets by the minute.
const HOUR_WINDOW: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-09-28T11:00:00.000Z"),
    new Date("2026-09-28T12:00:00.000Z"),
  ),
};

// Six hours, which the view buckets by five minutes.
const SIX_HOUR_WINDOW: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-09-28T06:00:00.000Z"),
    new Date("2026-09-28T12:00:00.000Z"),
  ),
};

// ClickHouse's bucket labels: UTC, no zone marker.
const BUCKET_A: string = "2026-09-28 11:10:00";
const BUCKET_B: string = "2026-09-28 11:11:00";
const BUCKET_C: string = "2026-09-28 11:12:00";

type AnalyticsRequest = { data: Record<string, unknown> };

function singleSeriesRows(): Array<Record<string, unknown>> {
  return [BUCKET_A, BUCKET_B, BUCKET_C].map(
    (time: string, index: number): Record<string, unknown> => {
      return { time, count: index + 1, groupValues: {} };
    },
  );
}

function multiSeriesRows(): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const time of [BUCKET_A, BUCKET_B, BUCKET_C]) {
    rows.push({ time, count: 2, groupValues: { severityText: "Error" } });
    rows.push({ time, count: 5, groupValues: { severityText: "Info" } });
  }
  return rows;
}

function answerWith(rows: Array<Record<string, unknown>>): void {
  postMock.mockImplementation(async (request: AnalyticsRequest) => {
    if (request.data["chartType"] === "timeseries") {
      return { data: { data: rows } };
    }
    if (request.data["chartType"] === "toplist") {
      return { data: { data: [{ value: "Error", count: 4 }] } };
    }
    return {
      data: { data: [{ groupValues: { severityText: "Error" }, count: 4 }] },
    };
  });
}

interface SpyZoom {
  zoom: TimeRangeZoom;
  zoomToTimeRange: MockFunction;
  resetZoom: MockFunction;
}

function spyZoom(isZoomed: boolean): SpyZoom {
  const zoomToTimeRange: MockFunction = getJestMockFunction();
  const resetZoom: MockFunction = getJestMockFunction();

  return {
    zoomToTimeRange: zoomToTimeRange,
    resetZoom: resetZoom,
    zoom: {
      isZoomed: isZoomed,
      rangeBeforeZoom: isZoomed ? { range: TimeRange.PAST_ONE_DAY } : null,
      zoomToTimeRange: (startTime: Date, endTime: Date): void => {
        zoomToTimeRange(startTime, endTime);
      },
      resetZoom: (): void => {
        resetZoom();
      },
    },
  };
}

function view(
  timeRange: RangeStartAndEndDateTime,
  extra: {
    onTimeRangeSelect?: (startTime: Date, endTime: Date) => void;
    onTimeRangeReset?: () => void;
  } = {},
): React.ReactElement {
  return (
    <LogsAnalyticsView
      timeRange={timeRange}
      appliedFacetFilters={new Map()}
      logAttributes={[]}
      onTimeRangeSelect={extra.onTimeRangeSelect}
      onTimeRangeReset={extra.onTimeRangeReset}
    />
  );
}

async function renderInZoom(
  zoom: TimeRangeZoom | null,
  timeRange: RangeStartAndEndDateTime = HOUR_WINDOW,
): Promise<void> {
  render(
    <TimeRangeZoomProvider zoom={zoom}>
      {view(timeRange)}
    </TimeRangeZoomProvider>,
  );

  await waitFor(() => {
    expect(screen.getByTestId(`bucket-${BUCKET_A}`)).toBeInTheDocument();
  });
}

function drag(from: string, to: string): void {
  fireEvent.mouseDown(screen.getByTestId(`bucket-${from}`));
  fireEvent.mouseMove(screen.getByTestId(`bucket-${to}`));
  fireEvent.mouseUp(screen.getByTestId(`bucket-${to}`));
}

function click(label: string): void {
  fireEvent.mouseDown(screen.getByTestId(`bucket-${label}`));
  fireEvent.mouseUp(screen.getByTestId(`bucket-${label}`));
}

/*
 * The cursor the reader sees over the plot: the one on recharts' own
 * .recharts-wrapper, which fills the plot and sets `cursor: default` inline
 * unless the chart root is handed a style of its own.
 */
function plotCursor(): string {
  const wrapper: HTMLElement | null = screen
    .getByTestId(LOGS_ANALYTICS_TIMESERIES_TEST_ID)
    .querySelector(".recharts-wrapper");
  expect(wrapper).not.toBeNull();
  return wrapper!.style.cursor;
}

function windows(mock: MockFunction): Array<[string, string]> {
  return mock.mock.calls.map((call: Array<unknown>): [string, string] => {
    return [(call[0] as Date).toISOString(), (call[1] as Date).toISOString()];
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  postMock.mockReset();
  answerWith(singleSeriesRows());
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("the timeseries zooms the viewer it sits in", () => {
  test("a drag across buckets zooms into every bucket it covered, the last one included", async () => {
    const zoom: SpyZoom = spyZoom(false);
    await renderInZoom(zoom.zoom);

    drag(BUCKET_A, BUCKET_C);

    expect(windows(zoom.zoomToTimeRange)).toEqual([
      ["2026-09-28T11:10:00.000Z", "2026-09-28T11:13:00.000Z"],
    ]);
  });

  test("a right-to-left drag is the same window", async () => {
    const zoom: SpyZoom = spyZoom(false);
    await renderInZoom(zoom.zoom);

    drag(BUCKET_C, BUCKET_A);

    expect(windows(zoom.zoomToTimeRange)).toEqual([
      ["2026-09-28T11:10:00.000Z", "2026-09-28T11:13:00.000Z"],
    ]);
  });

  test("a click on one bucket zooms into that bucket at once while there is nothing to undo", async () => {
    const zoom: SpyZoom = spyZoom(false);
    await renderInZoom(zoom.zoom);

    click(BUCKET_B);

    expect(windows(zoom.zoomToTimeRange)).toEqual([
      ["2026-09-28T11:11:00.000Z", "2026-09-28T11:12:00.000Z"],
    ]);
  });

  test("the bucket width comes from the request that drew the rows", async () => {
    const zoom: SpyZoom = spyZoom(false);
    await renderInZoom(zoom.zoom, SIX_HOUR_WINDOW);

    expect(postMock.mock.calls[0]![0]).toMatchObject({
      data: { bucketSizeInMinutes: 5 },
    });

    click(BUCKET_B);

    expect(windows(zoom.zoomToTimeRange)).toEqual([
      ["2026-09-28T11:11:00.000Z", "2026-09-28T11:16:00.000Z"],
    ]);
  });

  test("while zoomed, a double-click zooms back out and swallows the clicks it is made of", async () => {
    const zoom: SpyZoom = spyZoom(true);
    await renderInZoom(zoom.zoom);

    click(BUCKET_A);
    click(BUCKET_A);
    fireEvent.doubleClick(
      screen.getByTestId(LOGS_ANALYTICS_TIMESERIES_TEST_ID),
    );

    act(() => {
      jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS * 4);
    });

    expect(zoom.resetZoom).toHaveBeenCalledTimes(1);
    expect(zoom.zoomToTimeRange).not.toHaveBeenCalled();
  });

  test("while zoomed, a single click still zooms in once the double-click window has passed", async () => {
    const zoom: SpyZoom = spyZoom(true);
    await renderInZoom(zoom.zoom);

    click(BUCKET_B);
    expect(zoom.zoomToTimeRange).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS);
    });

    expect(windows(zoom.zoomToTimeRange)).toEqual([
      ["2026-09-28T11:11:00.000Z", "2026-09-28T11:12:00.000Z"],
    ]);
  });

  test("a double-click with nothing to undo does nothing", async () => {
    const zoom: SpyZoom = spyZoom(false);
    await renderInZoom(zoom.zoom);

    fireEvent.doubleClick(
      screen.getByTestId(LOGS_ANALYTICS_TIMESERIES_TEST_ID),
    );

    expect(zoom.resetZoom).not.toHaveBeenCalled();
  });

  test("the plot offers the gesture: crosshair, and a hint naming it", async () => {
    await renderInZoom(spyZoom(false).zoom);

    expect(plotCursor()).toBe("crosshair");
    expect(
      screen.getByTestId(LOGS_ANALYTICS_ZOOM_HINT_TEST_ID),
    ).toHaveTextContent("Click or drag to zoom");
    expect(
      screen.getByTestId(LOGS_ANALYTICS_ZOOM_HINT_TEST_ID),
    ).not.toHaveTextContent("double-click");
  });

  test("while zoomed the hint names the way back", async () => {
    await renderInZoom(spyZoom(true).zoom);

    expect(
      screen.getByTestId(LOGS_ANALYTICS_ZOOM_HINT_TEST_ID),
    ).toHaveTextContent("Click or drag to zoom · double-click to reset");
  });

  test("the band follows the drag and goes once it is released", async () => {
    await renderInZoom(spyZoom(false).zoom);

    fireEvent.mouseDown(screen.getByTestId(`bucket-${BUCKET_A}`));
    fireEvent.mouseMove(screen.getByTestId(`bucket-${BUCKET_B}`));

    const band: HTMLElement = screen.getByTestId("selection-band");
    expect(band).toHaveAttribute("data-x1", BUCKET_A);
    expect(band).toHaveAttribute("data-x2", BUCKET_B);

    fireEvent.mouseUp(screen.getByTestId(`bucket-${BUCKET_B}`));

    expect(screen.queryByTestId("selection-band")).toBeNull();
  });

  test("the tooltip is pinned shut for the length of a drag", async () => {
    await renderInZoom(spyZoom(false).zoom);

    expect(screen.getByTestId("tooltip")).toHaveAttribute(
      "data-active",
      "undefined",
    );

    /*
     * A press alone is still a click: it renders nothing (a render under
     * the press could take its dblclick away), so the tooltip stays.
     */
    fireEvent.mouseDown(screen.getByTestId(`bucket-${BUCKET_A}`));
    expect(screen.getByTestId("tooltip")).toHaveAttribute(
      "data-active",
      "undefined",
    );

    // The drag leaves the pressed bar: the tooltip is held shut.
    fireEvent.mouseMove(screen.getByTestId(`bucket-${BUCKET_B}`));
    expect(screen.getByTestId("tooltip")).toHaveAttribute(
      "data-active",
      "false",
    );

    fireEvent.mouseUp(screen.getByTestId(`bucket-${BUCKET_B}`));
    expect(screen.getByTestId("tooltip")).toHaveAttribute(
      "data-active",
      "undefined",
    );
  });

  test("a drag released outside the chart still ends", async () => {
    const zoom: SpyZoom = spyZoom(false);
    await renderInZoom(zoom.zoom);

    fireEvent.mouseDown(screen.getByTestId(`bucket-${BUCKET_A}`));
    fireEvent.mouseMove(screen.getByTestId(`bucket-${BUCKET_C}`));
    fireEvent.mouseUp(window);

    expect(windows(zoom.zoomToTimeRange)).toEqual([
      ["2026-09-28T11:10:00.000Z", "2026-09-28T11:13:00.000Z"],
    ]);
    expect(screen.queryByTestId("selection-band")).toBeNull();
  });

  test("several series draw as stacked bars that zoom the same way", async () => {
    answerWith(multiSeriesRows());
    const zoom: SpyZoom = spyZoom(false);
    await renderInZoom(zoom.zoom);

    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
    expect(plotCursor()).toBe("crosshair");
    drag(BUCKET_A, BUCKET_B);

    expect(windows(zoom.zoomToTimeRange)).toEqual([
      ["2026-09-28T11:10:00.000Z", "2026-09-28T11:12:00.000Z"],
    ]);
    // The legend and the hint share a row.
    expect(
      screen.getByTestId(LOGS_ANALYTICS_ZOOM_HINT_TEST_ID),
    ).toBeInTheDocument();
  });
});

describe("where the zoom comes from", () => {
  test("with no zoom around it and none passed in, the chart is plain", async () => {
    render(view(HOUR_WINDOW));
    await waitFor(() => {
      expect(screen.getByTestId(`bucket-${BUCKET_A}`)).toBeInTheDocument();
    });

    expect(screen.queryByTestId(LOGS_ANALYTICS_ZOOM_HINT_TEST_ID)).toBeNull();
    // Nothing to drag: recharts keeps its own default cursor.
    expect(plotCursor()).toBe("default");

    // Nothing to report to; the drag must simply do nothing.
    drag(BUCKET_A, BUCKET_C);
    expect(screen.queryByTestId("selection-band")).toBeNull();
  });

  test("a viewer that withdraws its zoom (null) leaves the chart plain", async () => {
    await renderInZoom(null);

    expect(screen.queryByTestId(LOGS_ANALYTICS_ZOOM_HINT_TEST_ID)).toBeNull();
  });

  test("handlers the host passes win over the viewer's zoom", async () => {
    const around: SpyZoom = spyZoom(true);
    const hostSelect: MockFunction = getJestMockFunction();
    const hostReset: MockFunction = getJestMockFunction();

    render(
      <TimeRangeZoomProvider zoom={around.zoom}>
        {view(HOUR_WINDOW, {
          onTimeRangeSelect: (startTime: Date, endTime: Date): void => {
            hostSelect(startTime, endTime);
          },
          onTimeRangeReset: (): void => {
            hostReset();
          },
        })}
      </TimeRangeZoomProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId(`bucket-${BUCKET_A}`)).toBeInTheDocument();
    });

    drag(BUCKET_A, BUCKET_B);
    fireEvent.doubleClick(
      screen.getByTestId(LOGS_ANALYTICS_TIMESERIES_TEST_ID),
    );

    expect(hostSelect).toHaveBeenCalledTimes(1);
    expect(hostReset).toHaveBeenCalledTimes(1);
    expect(around.zoomToTimeRange).not.toHaveBeenCalled();
    expect(around.resetZoom).not.toHaveBeenCalled();
  });

  test("a host that passes only a reset gets no drag from the viewer", async () => {
    const around: SpyZoom = spyZoom(false);
    const hostReset: MockFunction = getJestMockFunction();

    render(
      <TimeRangeZoomProvider zoom={around.zoom}>
        {view(HOUR_WINDOW, {
          onTimeRangeReset: (): void => {
            hostReset();
          },
        })}
      </TimeRangeZoomProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId(`bucket-${BUCKET_A}`)).toBeInTheDocument();
    });

    drag(BUCKET_A, BUCKET_B);

    expect(around.zoomToTimeRange).not.toHaveBeenCalled();
  });
});

describe("only the timeseries is a time chart", () => {
  test.each([
    ["Top List", "toplist"],
    ["Table", "table"],
  ])(
    "the %s has no zoom affordance",
    async (_label: string, chartType: string) => {
      await renderInZoom(spyZoom(false).zoom);

      fireEvent.change(screen.getAllByRole("combobox")[0]!, {
        target: { value: chartType },
      });

      await waitFor(() => {
        expect(
          postMock.mock.calls.some((call: Array<unknown>): boolean => {
            return (
              (call[0] as AnalyticsRequest).data["chartType"] === chartType
            );
          }),
        ).toBe(true);
      });

      expect(
        screen.queryByTestId(LOGS_ANALYTICS_TIMESERIES_TEST_ID),
      ).toBeNull();
      expect(screen.queryByTestId(LOGS_ANALYTICS_ZOOM_HINT_TEST_ID)).toBeNull();
    },
  );
});

describe("a zoom into a quiet stretch", () => {
  test("the empty chart takes the double-click, so the way back is where the pointer is", async () => {
    answerWith([]);
    const zoom: SpyZoom = spyZoom(true);

    render(
      <TimeRangeZoomProvider zoom={zoom.zoom}>
        {view(HOUR_WINDOW)}
      </TimeRangeZoomProvider>,
    );

    const empty: HTMLElement = await screen.findByText(
      "No data available for the selected query",
    );
    // The double-click must not also select a word of the message.
    expect(empty.closest(".select-none")).not.toBeNull();
    fireEvent.doubleClick(empty);

    expect(zoom.resetZoom).toHaveBeenCalledTimes(1);
  });

  test("and does nothing when there is no zoom to undo", async () => {
    answerWith([]);
    const zoom: SpyZoom = spyZoom(false);

    render(
      <TimeRangeZoomProvider zoom={zoom.zoom}>
        {view(HOUR_WINDOW)}
      </TimeRangeZoomProvider>,
    );

    fireEvent.doubleClick(
      await screen.findByText("No data available for the selected query"),
    );

    expect(zoom.resetZoom).not.toHaveBeenCalled();
  });
});

describe("a new window refetches the timeseries", () => {
  test("the request follows the viewer's window, bucket size included", async () => {
    const zoom: SpyZoom = spyZoom(false);
    const { rerender } = render(
      <TimeRangeZoomProvider zoom={zoom.zoom}>
        {view(SIX_HOUR_WINDOW)}
      </TimeRangeZoomProvider>,
    );

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    rerender(
      <TimeRangeZoomProvider zoom={spyZoom(true).zoom}>
        {view(HOUR_WINDOW)}
      </TimeRangeZoomProvider>,
    );

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(2);
    });

    expect(postMock.mock.calls[1]![0]).toMatchObject({
      data: {
        chartType: "timeseries",
        startTime: "2026-09-28T11:00:00.000Z",
        endTime: "2026-09-28T12:00:00.000Z",
        bucketSizeInMinutes: 1,
      },
    });
  });

  test("a failed refetch after a zoom leaves nothing of the old window to drag across", async () => {
    const zoom: SpyZoom = spyZoom(false);
    const { rerender } = render(
      <TimeRangeZoomProvider zoom={zoom.zoom}>
        {view(SIX_HOUR_WINDOW)}
      </TimeRangeZoomProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId(`bucket-${BUCKET_A}`)).toBeInTheDocument();
    });

    postMock.mockImplementation(async () => {
      throw new Error("boom");
    });

    rerender(
      <TimeRangeZoomProvider zoom={zoom.zoom}>
        {view(HOUR_WINDOW)}
      </TimeRangeZoomProvider>,
    );

    expect(
      await screen.findByText("No data available for the selected query"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId(`bucket-${BUCKET_A}`)).toBeNull();
  });
});

describe("a superseded request never paints over the current window", () => {
  /*
   * A zoom, its reset and the picker can change the window faster than an
   * analytics request returns, and a wide window answers slower than a
   * narrow one. Whatever order the answers land in, the chart shows the
   * window the viewer is on - never the one the reader just left under a
   * picker, list and histogram that have moved on.
   */
  interface PendingRequest {
    request: AnalyticsRequest;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }

  const pending: Array<PendingRequest> = [];

  // The wide window's five-minute buckets, which the narrow one never has.
  const WIDE_A: string = "2026-09-28 06:05:00";
  const WIDE_B: string = "2026-09-28 06:10:00";

  function wideRows(): Array<Record<string, unknown>> {
    return [WIDE_A, WIDE_B].map((time: string): Record<string, unknown> => {
      return { time, count: 50, groupValues: {} };
    });
  }

  function answerLater(): void {
    pending.length = 0;
    postMock.mockImplementation((request: AnalyticsRequest) => {
      return new Promise(
        (resolve: (value: unknown) => void, reject: (error: Error) => void) => {
          pending.push({ request, resolve, reject });
        },
      );
    });
  }

  function loader(): HTMLElement | null {
    return screen.queryByTestId("component-loader");
  }

  /*
   * The viewer was on six hours (request A, still out) and the reader
   * zoomed into one (request B, also out).
   */
  async function zoomWhileTheWideRequestIsOut(
    zoom: TimeRangeZoom,
  ): Promise<{ wide: PendingRequest; narrow: PendingRequest }> {
    answerLater();
    const { rerender } = render(
      <TimeRangeZoomProvider zoom={zoom}>
        {view(SIX_HOUR_WINDOW)}
      </TimeRangeZoomProvider>,
    );
    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });

    rerender(
      <TimeRangeZoomProvider zoom={zoom}>
        {view(HOUR_WINDOW)}
      </TimeRangeZoomProvider>,
    );
    await waitFor(() => {
      expect(pending).toHaveLength(2);
    });

    const [wide, narrow] = pending as [PendingRequest, PendingRequest];
    expect(wide.request.data["bucketSizeInMinutes"]).toBe(5);
    expect(narrow.request.data["bucketSizeInMinutes"]).toBe(1);
    return { wide, narrow };
  }

  test("the wide window answering last does not replace the zoomed chart, nor its bucket width", async () => {
    const zoom: SpyZoom = spyZoom(false);
    const { wide, narrow } = await zoomWhileTheWideRequestIsOut(zoom.zoom);

    await act(async () => {
      narrow.resolve({ data: { data: singleSeriesRows() } });
    });
    await waitFor(() => {
      expect(screen.getByTestId(`bucket-${BUCKET_A}`)).toBeInTheDocument();
    });

    await act(async () => {
      wide.resolve({ data: { data: wideRows() } });
    });

    expect(screen.getByTestId(`bucket-${BUCKET_A}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`bucket-${WIDE_A}`)).toBeNull();
    // A click reads the zoomed window's one-minute width, not five.
    click(BUCKET_B);
    expect(windows(zoom.zoomToTimeRange)).toEqual([
      ["2026-09-28T11:11:00.000Z", "2026-09-28T11:12:00.000Z"],
    ]);
  });

  test("the wide window answering first neither paints nor takes the loader down", async () => {
    const { wide, narrow } = await zoomWhileTheWideRequestIsOut(
      spyZoom(false).zoom,
    );

    await act(async () => {
      wide.resolve({ data: { data: wideRows() } });
    });

    expect(loader()).toBeInTheDocument();
    expect(screen.queryByTestId(`bucket-${WIDE_A}`)).toBeNull();
    expect(
      screen.queryByText("No data available for the selected query"),
    ).toBeNull();

    await act(async () => {
      narrow.resolve({ data: { data: singleSeriesRows() } });
    });

    await waitFor(() => {
      expect(screen.getByTestId(`bucket-${BUCKET_A}`)).toBeInTheDocument();
    });
    expect(loader()).toBeNull();
    expect(screen.queryByTestId(`bucket-${WIDE_B}`)).toBeNull();
  });

  test("the wide window failing late does not blank the zoomed chart", async () => {
    const { wide, narrow } = await zoomWhileTheWideRequestIsOut(
      spyZoom(false).zoom,
    );

    await act(async () => {
      narrow.resolve({ data: { data: singleSeriesRows() } });
    });
    await waitFor(() => {
      expect(screen.getByTestId(`bucket-${BUCKET_A}`)).toBeInTheDocument();
    });

    await act(async () => {
      wide.reject(new Error("timed out"));
    });

    expect(screen.getByTestId(`bucket-${BUCKET_A}`)).toBeInTheDocument();
    expect(
      screen.queryByText("No data available for the selected query"),
    ).toBeNull();
  });

  test("the wide window failing first does not end the wait for the zoomed one", async () => {
    const { wide, narrow } = await zoomWhileTheWideRequestIsOut(
      spyZoom(false).zoom,
    );

    await act(async () => {
      wide.reject(new Error("timed out"));
    });

    expect(loader()).toBeInTheDocument();
    expect(
      screen.queryByText("No data available for the selected query"),
    ).toBeNull();

    await act(async () => {
      narrow.resolve({ data: { data: singleSeriesRows() } });
    });
    await waitFor(() => {
      expect(screen.getByTestId(`bucket-${BUCKET_A}`)).toBeInTheDocument();
    });
  });

  test("a timeseries answer landing after a switch to the top list keeps the loader up until the top list lands", async () => {
    answerLater();
    render(
      <TimeRangeZoomProvider zoom={spyZoom(false).zoom}>
        {view(HOUR_WINDOW)}
      </TimeRangeZoomProvider>,
    );
    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });

    fireEvent.change(screen.getAllByRole("combobox")[0]!, {
      target: { value: "toplist" },
    });
    await waitFor(() => {
      expect(pending).toHaveLength(2);
    });
    const [timeseries, topList] = pending as [PendingRequest, PendingRequest];
    expect(topList.request.data["chartType"]).toBe("toplist");

    await act(async () => {
      timeseries.resolve({ data: { data: singleSeriesRows() } });
    });

    // Not an empty top list: the top list has simply not answered yet.
    expect(loader()).toBeInTheDocument();
    expect(
      screen.queryByText("No data available for the selected query"),
    ).toBeNull();

    await act(async () => {
      topList.resolve({ data: { data: [{ value: "Error", count: 4 }] } });
    });
    await waitFor(() => {
      expect(screen.getByText("Error")).toBeInTheDocument();
    });
    expect(loader()).toBeNull();
  });
});
