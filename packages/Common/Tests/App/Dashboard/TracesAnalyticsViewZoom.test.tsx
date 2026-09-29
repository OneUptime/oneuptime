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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105: the traces Analytics timeseries zooms the explorer it sits
 * in (TracesExplorerTimeRangeZoom.test.tsx drives that end to end). This
 * file pins the view on its own: where its zoom comes from, how wide a
 * clicked bucket is, and the edges - an empty zoomed window, the non-time
 * charts. Recharts is stood in for (see LogsHistogramDragTooltip.test.tsx).
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: () => {
        return "error";
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

  interface StubRow {
    time: string;
  }

  interface StubChartProps {
    data: Array<StubRow>;
    children?: React.ReactNode;
    onMouseDown?: (state: { activeLabel: string }) => void;
    onMouseMove?: (state: { activeLabel: string }) => void;
    onMouseUp?: (state: { activeLabel: string }) => void;
  }

  const chart: (props: StubChartProps) => React.ReactElement = (
    props: StubChartProps,
  ): React.ReactElement => {
    return react.createElement(
      "div",
      null,
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

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    AreaChart: chart,
    BarChart: chart,
    LineChart: chart,
    Area: nothing,
    Bar: nothing,
    Line: nothing,
    XAxis: nothing,
    YAxis: nothing,
    CartesianGrid: nothing,
    Tooltip: nothing,
    ReferenceArea: nothing,
  };
});

import TracesAnalyticsView, {
  TRACES_ANALYTICS_TIMESERIES_TEST_ID,
  TRACES_ANALYTICS_ZOOM_HINT_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesAnalyticsView";
import { TimeRangeZoomProvider } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import TimeRange from "../../../Types/Time/TimeRange";

const NOW: Date = new Date("2026-09-17T12:00:00.000Z");

const BUCKET_A: string = "2026-09-17 10:15:00";
const BUCKET_B: string = "2026-09-17 10:20:00";

// Six hours of spans, which the view buckets by five minutes.
const SIX_HOURS: Record<string, string> = {
  startTime: "2026-09-17T06:00:00.000Z",
  endTime: "2026-09-17T12:00:00.000Z",
};

let answerEmpty: boolean = false;

interface SpyZoom {
  zoom: TimeRangeZoom;
  select: MockFunction;
  reset: MockFunction;
}

function spyZoom(isZoomed: boolean): SpyZoom {
  const select: MockFunction = getJestMockFunction();
  const reset: MockFunction = getJestMockFunction();
  return {
    select,
    reset,
    zoom: {
      isZoomed: isZoomed,
      rangeBeforeZoom: isZoomed ? { range: TimeRange.PAST_ONE_DAY } : null,
      zoomToTimeRange: (startTime: Date, endTime: Date): void => {
        select(startTime, endTime);
      },
      resetZoom: (): void => {
        reset();
      },
    },
  };
}

function view(
  extra: {
    onTimeRangeSelect?: (startTime: Date, endTime: Date) => void;
    onTimeRangeReset?: () => void;
  } = {},
): React.ReactElement {
  return (
    <TracesAnalyticsView
      baseFilters={SIX_HOURS}
      attributeKeys={[]}
      serviceNameMap={{}}
      onTimeRangeSelect={extra.onTimeRangeSelect}
      onTimeRangeReset={extra.onTimeRangeReset}
    />
  );
}

function windows(mock: MockFunction): Array<[string, string]> {
  return mock.mock.calls.map((call: Array<unknown>): [string, string] => {
    return [(call[0] as Date).toISOString(), (call[1] as Date).toISOString()];
  });
}

async function waitForChart(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId(`bucket-${BUCKET_A}`)).toBeInTheDocument();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  answerEmpty = false;
  postMock.mockReset();
  postMock.mockImplementation(async (args: { data: Record<string, any> }) => {
    if (answerEmpty) {
      return { data: { data: [] } };
    }
    if (args.data["chartType"] === "table") {
      return {
        data: {
          data: [
            {
              groupValues: { name: "GET /" },
              count: 4,
              errorCount: 0,
              avgDurationMs: 1,
              p50DurationMs: 1,
              p90DurationMs: 1,
              p95DurationMs: 1,
              p99DurationMs: 1,
              minDurationMs: 1,
              maxDurationMs: 1,
            },
          ],
        },
      };
    }
    return {
      data: {
        data: [BUCKET_A, BUCKET_B].map((time: string) => {
          return { time, value: 3, groupValues: { name: "GET /" } };
        }),
      },
    };
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("TracesAnalyticsView's zoom", () => {
  test("a click on one bucket zooms into that bucket's five minutes, the width its request asked for", async () => {
    const zoom: SpyZoom = spyZoom(false);
    render(
      <TimeRangeZoomProvider zoom={zoom.zoom}>{view()}</TimeRangeZoomProvider>,
    );
    await waitForChart();

    expect(postMock.mock.calls[0]![0]).toMatchObject({
      data: { bucketSizeInMinutes: 5 },
    });

    fireEvent.mouseDown(screen.getByTestId(`bucket-${BUCKET_B}`));
    fireEvent.mouseUp(screen.getByTestId(`bucket-${BUCKET_B}`));

    expect(windows(zoom.select)).toEqual([
      ["2026-09-17T10:20:00.000Z", "2026-09-17T10:25:00.000Z"],
    ]);
  });

  test("handlers the host passes win over the explorer's zoom", async () => {
    const around: SpyZoom = spyZoom(true);
    const hostSelect: MockFunction = getJestMockFunction();
    const hostReset: MockFunction = getJestMockFunction();

    render(
      <TimeRangeZoomProvider zoom={around.zoom}>
        {view({
          onTimeRangeSelect: (startTime: Date, endTime: Date): void => {
            hostSelect(startTime, endTime);
          },
          onTimeRangeReset: (): void => {
            hostReset();
          },
        })}
      </TimeRangeZoomProvider>,
    );
    await waitForChart();

    fireEvent.mouseDown(screen.getByTestId(`bucket-${BUCKET_A}`));
    fireEvent.mouseMove(screen.getByTestId(`bucket-${BUCKET_B}`));
    fireEvent.mouseUp(screen.getByTestId(`bucket-${BUCKET_B}`));
    fireEvent.doubleClick(
      screen.getByTestId(TRACES_ANALYTICS_TIMESERIES_TEST_ID),
    );

    expect(windows(hostSelect)).toEqual([
      ["2026-09-17T10:15:00.000Z", "2026-09-17T10:25:00.000Z"],
    ]);
    expect(hostReset).toHaveBeenCalledTimes(1);
    expect(around.select).not.toHaveBeenCalled();
    expect(around.reset).not.toHaveBeenCalled();
  });

  test("outside any explorer and with no handlers the chart is plain", async () => {
    render(view());
    await waitForChart();

    expect(screen.queryByTestId(TRACES_ANALYTICS_ZOOM_HINT_TEST_ID)).toBeNull();
    expect(screen.getByTestId(TRACES_ANALYTICS_TIMESERIES_TEST_ID)).toHaveStyle(
      { cursor: "default" },
    );
  });

  test("a zoom into a quiet stretch: the empty chart takes the double-click back", async () => {
    answerEmpty = true;
    const zoom: SpyZoom = spyZoom(true);

    render(
      <TimeRangeZoomProvider zoom={zoom.zoom}>{view()}</TimeRangeZoomProvider>,
    );

    const empty: HTMLElement = await screen.findByText(
      "No data available for the selected query",
    );
    // The double-click must not also select a word of the message.
    expect(empty.closest(".select-none")).not.toBeNull();
    fireEvent.doubleClick(empty);

    expect(zoom.reset).toHaveBeenCalledTimes(1);
  });

  test("the table has no time axis and no zoom", async () => {
    const zoom: SpyZoom = spyZoom(false);
    render(
      <TimeRangeZoomProvider zoom={zoom.zoom}>{view()}</TimeRangeZoomProvider>,
    );
    await waitForChart();

    fireEvent.change(screen.getAllByRole("combobox")[0]!, {
      target: { value: "table" },
    });

    await waitFor(() => {
      expect(screen.getByText("GET /")).toBeInTheDocument();
    });
    expect(screen.queryByTestId(TRACES_ANALYTICS_ZOOM_HINT_TEST_ID)).toBeNull();
    expect(
      screen.queryByTestId(TRACES_ANALYTICS_TIMESERIES_TEST_ID),
    ).toBeNull();
  });
});
