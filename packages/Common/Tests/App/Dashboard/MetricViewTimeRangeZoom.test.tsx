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

/*
 * Issue #4105: every metric chart can drag-zoom and double-click back out.
 * MetricView sits behind the metric explorer, every EmbeddedMetricCard, the
 * device health charts, the monitor previews, the monitor step forms and
 * the incident/alert snapshots, so it resolves the zoom its charts get:
 *
 *   1. disableChartZoom: none, and none borrowed from the page;
 *   2. the host's own onTimeRangeSelect / onTimeRangeReset;
 *   3. localChartZoom: a display-only zoom that never reaches the host;
 *   4. the enclosing page's zoom (TimeRangeZoomScope);
 *   5. otherwise its own window through onChange, with a way back.
 *
 * MetricCharts is stood in for: what matters is which handlers it is
 * handed and which window MetricView fetches.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();
const metricChartsMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<any>) => {
          return fetchResultsMock(...args);
        },
        getMetricTypes: () => {
          return Promise.resolve([]);
        },
        loadAllMetricsTypes: () => {
          return Promise.resolve({
            metricTypes: [],
            telemetryServices: [],
          });
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
      },
    };
  },
);

type CapturedCharts = {
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  onQueryConfigsChange?: ((queryConfigs: Array<unknown>) => void) | undefined;
  pageZoomSeen?: unknown;
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    const {
      useChartTimeRangeZoom,
    }: {
      useChartTimeRangeZoom: () => unknown;
    } = jest.requireActual(
      "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext",
    ) as { useChartTimeRangeZoom: () => unknown };
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        // What a chart inside would see from the page, if it looked.
        const pageZoomSeen: unknown = useChartTimeRangeZoom();
        metricChartsMock({ ...props, pageZoomSeen: pageZoomSeen });
        return React.createElement("div", {
          "data-testid": "metric-charts",
        });
      },
    };
  },
);

import MetricView from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView";
import { TimeRangeZoomProvider } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import TimeRange from "../../../Types/Time/TimeRange";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const WINDOW_START: Date = new Date("2026-09-28T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-09-28T11:00:00.000Z");
const ZOOM_START: Date = new Date("2026-09-28T10:20:00.000Z");
const ZOOM_END: Date = new Date("2026-09-28T10:30:00.000Z");

function buildData(overrides: Partial<MetricViewData> = {}): MetricViewData {
  return {
    queryConfigs: [
      {
        metricAliasData: { metricVariable: "a" },
        metricQueryData: {
          filterData: {
            metricName: "cpu.usage",
            attributes: {},
            aggegationType: MetricsAggregationType.Avg,
          },
        },
      },
    ],
    formulaConfigs: [],
    startAndEndDate: new InBetween<Date>(WINDOW_START, WINDOW_END),
    ...overrides,
  } as unknown as MetricViewData;
}

function latestCharts(): CapturedCharts {
  const calls: Array<Array<unknown>> = metricChartsMock.mock.calls;
  const last: Array<unknown> | undefined = calls[calls.length - 1];
  if (!last) {
    throw new Error("MetricCharts has not rendered");
  }
  return last[0] as CapturedCharts;
}

async function chartsRendered(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
  });
}

function windowOf(data: MetricViewData): [string, string] {
  return [
    data.startAndEndDate!.startValue.toISOString(),
    data.startAndEndDate!.endValue.toISOString(),
  ];
}

function fetchedWindows(): Array<[number, number]> {
  return fetchResultsMock.mock.calls.map(
    (call: Array<unknown>): [number, number] => {
      const data: MetricViewData = (
        call[0] as { metricViewData: MetricViewData }
      ).metricViewData;
      return [
        data.startAndEndDate!.startValue.getTime(),
        data.startAndEndDate!.endValue.getTime(),
      ];
    },
  );
}

/*
 * A host that round-trips MetricView's data through its own state, the way
 * the metric explorer and the device health charts do.
 */
const onHostChange: MockFunction = getJestMockFunction();

const StatefulHost: React.FunctionComponent<{
  initial: MetricViewData;
  localChartZoom?: boolean;
}> = (props: {
  initial: MetricViewData;
  localChartZoom?: boolean;
}): React.ReactElement => {
  const [data, setData] = React.useState<MetricViewData>(props.initial);
  return (
    <MetricView
      data={data}
      hideQueryElements={true}
      hideStartAndEndDate={true}
      {...(props.localChartZoom ? { localChartZoom: true } : {})}
      onChange={(next: MetricViewData) => {
        onHostChange(next);
        setData(next);
      }}
    />
  );
};

function fakePageZoom(isZoomed: boolean): TimeRangeZoom {
  return {
    isZoomed: isZoomed,
    rangeBeforeZoom: isZoomed ? { range: TimeRange.PAST_ONE_HOUR } : null,
    zoomToTimeRange: () => {},
    resetZoom: () => {},
  };
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  fetchResultsMock.mockReset();
  metricChartsMock.mockReset();
  onHostChange.mockReset();
  fetchResultsMock.mockReturnValue(
    Promise.resolve([{ data: [], truncated: false }]),
  );
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("MetricView drag-to-zoom on its own window", () => {
  test("a drag narrows the host's window through onChange, as a pinned range", async () => {
    render(<StatefulHost initial={buildData()} />);
    await chartsRendered();

    act(() => {
      latestCharts().onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
    });

    expect(onHostChange).toHaveBeenCalledTimes(1);
    const zoomed: MetricViewData = onHostChange.mock
      .calls[0]![0] as MetricViewData;
    expect(windowOf(zoomed)).toEqual([
      ZOOM_START.toISOString(),
      ZOOM_END.toISOString(),
    ]);
    expect(zoomed.rangeToken).toBeUndefined();
    // Everything else about the view is left alone.
    expect(zoomed.queryConfigs).toEqual(buildData().queryConfigs);
  });

  test("no reset is offered before a zoom; one is offered after", async () => {
    render(<StatefulHost initial={buildData()} />);
    await chartsRendered();

    expect(latestCharts().onTimeRangeReset).toBeUndefined();
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();

    act(() => {
      latestCharts().onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
    });

    expect(latestCharts().onTimeRangeReset).toBeInstanceOf(Function);
    expect(
      screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();
  });

  test("a double-click puts the host's original window back", async () => {
    render(<StatefulHost initial={buildData()} />);
    await chartsRendered();

    act(() => {
      latestCharts().onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
    });
    act(() => {
      latestCharts().onTimeRangeReset?.();
    });

    const restored: MetricViewData = onHostChange.mock
      .calls[1]![0] as MetricViewData;
    expect(windowOf(restored)).toEqual([
      WINDOW_START.toISOString(),
      WINDOW_END.toISOString(),
    ]);
    expect(latestCharts().onTimeRangeReset).toBeUndefined();
  });

  test("the Reset zoom button does what a double-click does", async () => {
    render(<StatefulHost initial={buildData()} />);
    await chartsRendered();

    act(() => {
      latestCharts().onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
    });
    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));

    const restored: MetricViewData = onHostChange.mock
      .calls[1]![0] as MetricViewData;
    expect(windowOf(restored)).toEqual([
      WINDOW_START.toISOString(),
      WINDOW_END.toISOString(),
    ]);
  });

  test("a relative window comes back relative: its preset, resolved against now", async () => {
    render(
      <StatefulHost
        initial={buildData({ rangeToken: TimeRange.PAST_THREE_HOURS })}
      />,
    );
    await chartsRendered();
    // waitFor ticks the fake clock; put "now" back where the test reads it.
    jest.setSystemTime(NOW);

    act(() => {
      latestCharts().onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
    });
    expect(
      (onHostChange.mock.calls[0]![0] as MetricViewData).rangeToken,
    ).toBeUndefined();

    act(() => {
      latestCharts().onTimeRangeReset?.();
    });

    const restored: MetricViewData = onHostChange.mock
      .calls[1]![0] as MetricViewData;
    expect(restored.rangeToken).toBe(TimeRange.PAST_THREE_HOURS);
    expect(restored.startAndEndDate!.endValue.toISOString()).toBe(
      NOW.toISOString(),
    );
    expect(restored.startAndEndDate!.startValue.toISOString()).toBe(
      "2026-09-28T09:00:00.000Z",
    );
  });

  test("a drag past now is cut at now", async () => {
    render(
      <StatefulHost
        initial={buildData({ rangeToken: TimeRange.PAST_ONE_HOUR })}
      />,
    );
    await chartsRendered();
    jest.setSystemTime(NOW);

    act(() => {
      latestCharts().onTimeRangeSelect?.(
        new Date("2026-09-28T11:50:00.000Z"),
        new Date("2026-09-28T12:01:00.000Z"),
      );
    });

    expect(windowOf(onHostChange.mock.calls[0]![0] as MetricViewData)[1]).toBe(
      NOW.toISOString(),
    );
  });
});

describe("MetricView inside a page that zooms", () => {
  test("its charts take the page's zoom, and the host's window is left to the page", async () => {
    const zoom: TimeRangeZoom = fakePageZoom(true);
    render(
      <TimeRangeZoomProvider zoom={zoom}>
        <StatefulHost initial={buildData()} />
      </TimeRangeZoomProvider>,
    );
    await chartsRendered();

    expect(latestCharts().onTimeRangeSelect).toBe(zoom.zoomToTimeRange);
    expect(latestCharts().onTimeRangeReset).toBe(zoom.resetZoom);
    // The page shows its own reset; the view does not add another.
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("an unzoomed page offers the drag but no reset", async () => {
    const zoom: TimeRangeZoom = fakePageZoom(false);
    render(
      <TimeRangeZoomProvider zoom={zoom}>
        <StatefulHost initial={buildData()} />
      </TimeRangeZoomProvider>,
    );
    await chartsRendered();

    expect(latestCharts().onTimeRangeSelect).toBe(zoom.zoomToTimeRange);
    expect(latestCharts().onTimeRangeReset).toBeUndefined();
  });

  test("the host's own handlers win over the page's", async () => {
    const hostSelect: MockFunction = getJestMockFunction();
    const hostReset: MockFunction = getJestMockFunction();
    render(
      <TimeRangeZoomProvider zoom={fakePageZoom(true)}>
        <MetricView
          data={buildData()}
          hideQueryElements={true}
          hideStartAndEndDate={true}
          onChange={() => {}}
          onTimeRangeSelect={
            hostSelect as unknown as (startTime: Date, endTime: Date) => void
          }
          onTimeRangeReset={hostReset as unknown as () => void}
        />
      </TimeRangeZoomProvider>,
    );
    await chartsRendered();

    act(() => {
      latestCharts().onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
      latestCharts().onTimeRangeReset?.();
    });

    expect(hostSelect).toHaveBeenCalledWith(ZOOM_START, ZOOM_END);
    expect(hostReset).toHaveBeenCalledTimes(1);
  });

  test("disableChartZoom gives the charts nothing, and hides the page's zoom from them", async () => {
    render(
      <TimeRangeZoomProvider zoom={fakePageZoom(true)}>
        <MetricView
          data={buildData()}
          hideQueryElements={true}
          hideStartAndEndDate={true}
          disableChartZoom={true}
          onChange={() => {}}
        />
      </TimeRangeZoomProvider>,
    );
    await chartsRendered();

    expect(latestCharts().onTimeRangeSelect).toBeUndefined();
    expect(latestCharts().onTimeRangeReset).toBeUndefined();
    /*
     * MetricCharts writes the (undefined) handler into every chart's props,
     * and a chart with no handler of its own would otherwise take the
     * page's. The view withdraws the page's zoom instead.
     */
    expect(latestCharts().pageZoomSeen).toBeNull();
  });
});

describe("MetricView display-only (local) zoom", () => {
  test("a drag narrows what the view fetches without telling the host", async () => {
    render(<StatefulHost initial={buildData()} localChartZoom={true} />);
    await chartsRendered();
    fetchResultsMock.mockClear();

    act(() => {
      latestCharts().onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
    });

    expect(onHostChange).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(fetchedWindows()).toContainEqual([
        ZOOM_START.getTime(),
        ZOOM_END.getTime(),
      ]);
    });
    expect(latestCharts().onTimeRangeReset).toBeInstanceOf(Function);
    expect(
      screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();
  });

  test("a double-click goes back to the host's window", async () => {
    render(<StatefulHost initial={buildData()} localChartZoom={true} />);
    await chartsRendered();

    act(() => {
      latestCharts().onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
    });
    fetchResultsMock.mockClear();
    act(() => {
      latestCharts().onTimeRangeReset?.();
    });

    expect(onHostChange).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(fetchedWindows().length).toBeGreaterThan(0);
    });
    const [start, end] = fetchedWindows()[fetchedWindows().length - 1]!;
    // Alignment may floor the start onto the bucket grid; the end is kept.
    expect(start).toBeLessThanOrEqual(WINDOW_START.getTime());
    expect(end).toBe(WINDOW_END.getTime());
    expect(latestCharts().onTimeRangeReset).toBeUndefined();
  });

  test("query edits reach the host on the host's own window, never the zoomed one", async () => {
    render(<StatefulHost initial={buildData()} localChartZoom={true} />);
    await chartsRendered();

    act(() => {
      latestCharts().onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
    });
    act(() => {
      latestCharts().onQueryConfigsChange?.(buildData().queryConfigs);
    });

    expect(onHostChange).toHaveBeenCalledTimes(1);
    expect(windowOf(onHostChange.mock.calls[0]![0] as MetricViewData)).toEqual([
      WINDOW_START.toISOString(),
      WINDOW_END.toISOString(),
    ]);
  });

  test("a new window from the host ends the local zoom", async () => {
    const LocalHost: React.FunctionComponent = (): React.ReactElement => {
      const [window, setWindow] = React.useState<InBetween<Date>>(
        new InBetween<Date>(WINDOW_START, WINDOW_END),
      );
      return (
        <>
          <button
            type="button"
            data-testid="new-rolling-window"
            onClick={() => {
              setWindow(
                new InBetween<Date>(new Date("2026-09-28T11:00:00.000Z"), NOW),
              );
            }}
          >
            new window
          </button>
          <MetricView
            data={buildData({ startAndEndDate: window })}
            hideQueryElements={true}
            hideStartAndEndDate={true}
            localChartZoom={true}
            onChange={() => {}}
          />
        </>
      );
    };

    render(<LocalHost />);
    await chartsRendered();

    act(() => {
      latestCharts().onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
    });
    expect(latestCharts().onTimeRangeReset).toBeInstanceOf(Function);

    fireEvent.click(screen.getByTestId("new-rolling-window"));

    expect(latestCharts().onTimeRangeReset).toBeUndefined();
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("a local zoom wins over the page's zoom", async () => {
    const zoom: TimeRangeZoom = fakePageZoom(false);
    render(
      <TimeRangeZoomProvider zoom={zoom}>
        <StatefulHost initial={buildData()} localChartZoom={true} />
      </TimeRangeZoomProvider>,
    );
    await chartsRendered();

    expect(latestCharts().onTimeRangeSelect).not.toBe(zoom.zoomToTimeRange);
  });
});
