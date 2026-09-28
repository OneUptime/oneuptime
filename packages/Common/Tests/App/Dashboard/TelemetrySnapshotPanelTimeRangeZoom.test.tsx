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
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 in the telemetry snapshot card: the incident / alert EPISODE
 * overviews (TelemetrySnapshotPanel) and the companion tabs every snapshot
 * card carries (TelemetryCompanionSignalTabs).
 *
 * - The primary metric chart is pinned to the window the monitor
 *   evaluated. It zooms itself alone and returns to that window.
 * - The companion tabs keep their own windows. The same card opens inside
 *   the investigation drawer, over pages whose charts zoom the page: none
 *   of that page's zoom may reach a companion (no "Reset zoom" in a
 *   companion's picker for the page behind the drawer, no retiming the
 *   page from the companion metric card), while the host's own primary
 *   element keeps whatever zoom the host gives it.
 *
 * MetricView and EmbeddedMetricCard are real; MetricCharts is stood in for
 * by buttons that call exactly the handlers MetricView hands the charts.
 * The log / trace / exception viewers are stood in for by what matters
 * here: the zoom they would see, and the Reset zoom their time picker
 * (TelemetryTimeRangePicker) renders from it.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();

interface MockChartsProps {
  metricViewData: {
    queryConfigs: Array<{
      metricQueryData: { filterData: { metricName?: unknown } };
    }>;
  };
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
}

const mockChartsByMetric: Record<string, MockChartsProps> = {};
// The zoom each stood-in viewer saw, by viewer.
const mockViewerZoom: Record<string, unknown> = {};

const MOCK_DRAG: { start: Date; end: Date } = {
  start: new Date("2026-09-14T17:50:00.000Z"),
  end: new Date("2026-09-14T17:55:00.000Z"),
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: MockChartsProps): React.ReactElement => {
        const metricName: string = String(
          props.metricViewData.queryConfigs[0]?.metricQueryData.filterData
            .metricName || "",
        );
        mockChartsByMetric[metricName] = props;

        return (
          <div data-testid={`charts-${metricName}`}>
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeSelect?.(MOCK_DRAG.start, MOCK_DRAG.end);
              }}
            >
              {`Drag across ${metricName}`}
            </button>
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeReset?.();
              }}
            >
              {`Double-click ${metricName}`}
            </button>
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<unknown>) => {
          return fetchResultsMock(...args);
        },
        loadAllMetricsTypes: () => {
          return Promise.resolve({ metricTypes: [], telemetryServices: [] });
        },
        getMetricTypes: () => {
          return Promise.resolve([]);
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
      },
    };
  },
);

function mockViewer(name: string): {
  __esModule: boolean;
  default: () => React.ReactElement;
} {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      const zoomContext: { useChartTimeRangeZoom: () => unknown } =
        jest.requireActual(
          "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext",
        ) as { useChartTimeRangeZoom: () => unknown };
      const resetButton: {
        default: React.FunctionComponent;
      } = jest.requireActual(
        "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton",
      ) as { default: React.FunctionComponent };

      mockViewerZoom[name] = zoomContext.useChartTimeRangeZoom();

      return (
        <div data-testid={`viewer-${name}`}>
          {/* What the viewer's time picker renders from the zoom it sees. */}
          <resetButton.default />
        </div>
      );
    },
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return mockViewer("logs");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer",
  () => {
    return mockViewer("traces");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer",
  () => {
    return mockViewer("exceptions");
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/useServiceNames",
  () => {
    return {
      __esModule: true,
      default: () => {
        return {};
      },
    };
  },
);

// The companion metric card's picker: shows the card's range.
jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (props: { dashboardStartAndEndDate: { range: string } }) => {
      return (
        <span data-testid="card-picker">
          {props.dashboardStartAndEndDate.range}
        </span>
      );
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

import TelemetrySnapshotPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySnapshotPanel";
import TelemetryCompanionSignalTabs from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryCompanionSignalTabs";
import {
  ChartTimeRangeZoomContextValue,
  TimeRangeZoomScope,
  useChartTimeRangeZoom,
} from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import ResetTimeRangeZoomButton, {
  RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
} from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../Types/ObjectID";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

const NOW: Date = new Date("2026-09-14T19:00:00.000Z");
const SNAPSHOT_START: Date = new Date("2026-09-14T17:45:00.000Z");
const SNAPSHOT_END: Date = new Date("2026-09-14T18:00:00.000Z");
const SNAPSHOT: InBetween<Date> = new InBetween<Date>(
  SNAPSHOT_START,
  SNAPSHOT_END,
);
const PRIMARY_METRIC: string = "system.cpu.utilization";
const COMPANION_METRIC: string = "checkout.latency";

// The range of the page behind the drawer, in the drawer tests.
const PAGE_START: Date = new Date("2026-09-14T12:00:00.000Z");
const PAGE_END: Date = new Date("2026-09-14T18:00:00.000Z");

type Window = [number, number];

function windowOf(start: Date, end: Date): Window {
  return [start.getTime(), end.getTime()];
}

function fetchedWindowsFor(metricName: string): Array<Window> {
  const windows: Array<Window> = [];
  for (const call of fetchResultsMock.mock.calls) {
    const data: MetricViewData = (call[0] as { metricViewData: MetricViewData })
      .metricViewData;
    const queried: boolean = data.queryConfigs.some(
      (queryConfig: MetricViewData["queryConfigs"][number]): boolean => {
        return (
          String(queryConfig.metricQueryData.filterData.metricName) ===
          metricName
        );
      },
    );
    if (queried && data.startAndEndDate) {
      windows.push([
        data.startAndEndDate.startValue.getTime(),
        data.startAndEndDate.endValue.getTime(),
      ]);
    }
  }
  return windows;
}

function lastFetchedWindowFor(metricName: string): Window | undefined {
  const windows: Array<Window> = fetchedWindowsFor(metricName);
  return windows[windows.length - 1];
}

function chartsOf(metricName: string): MockChartsProps {
  const charts: MockChartsProps | undefined = mockChartsByMetric[metricName];
  if (!charts) {
    throw new Error(`No charts rendered for ${metricName}`);
  }
  return charts;
}

async function press(label: string): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: label }));
}

/*
 * MetricView draws its charts once before it loads, then shows a loader
 * until its first fetch lands: wait for that fetch and the charts after.
 */
async function chartsSettled(metricName: string): Promise<void> {
  await waitFor(() => {
    expect(fetchedWindowsFor(metricName).length).toBeGreaterThan(0);
    expect(screen.getByTestId(`charts-${metricName}`)).toBeInTheDocument();
  });
}

function metricSnapshotQuery(startAndEndDate: InBetween<Date>): TelemetryQuery {
  return {
    telemetryType: TelemetryType.Metric,
    telemetryQuery: null,
    metricViewData: {
      startAndEndDate: startAndEndDate,
      queryConfigs: [
        {
          metricAliasData: {
            metricVariable: "a",
            title: "",
            description: "",
            legend: "",
            legendUnit: "",
          },
          metricQueryData: {
            filterData: {
              metricName: PRIMARY_METRIC,
              aggegationType: MetricsAggregationType.Avg,
            },
          },
        },
      ],
      formulaConfigs: [],
    },
  };
}

function logSnapshotQuery(): TelemetryQuery {
  return {
    telemetryType: TelemetryType.Log,
    telemetryQuery: { time: SNAPSHOT } as never,
    metricViewData: null,
  };
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  fetchResultsMock.mockReset();
  analyticsGetListMock.mockReset();
  for (const key of Object.keys(mockChartsByMetric)) {
    delete mockChartsByMetric[key];
  }
  for (const key of Object.keys(mockViewerZoom)) {
    delete mockViewerZoom[key];
  }
  fetchResultsMock.mockImplementation(() => {
    return Promise.resolve([{ data: [], truncated: false }]);
  });
  analyticsGetListMock.mockResolvedValue({
    data: [{ name: COMPANION_METRIC }],
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("the episode overview's snapshot panel: the primary metric chart", () => {
  function renderPanel(telemetryQuery: TelemetryQuery): RenderResult {
    return render(
      <TelemetrySnapshotPanel
        telemetryQuery={telemetryQuery}
        snapshotWindow={SNAPSHOT}
        seriesSummary=""
        eventNoun="incident"
      />,
    );
  }

  test("charts the snapshot window and offers a drag, with no reset yet", async () => {
    renderPanel(metricSnapshotQuery(SNAPSHOT));
    await chartsSettled(PRIMARY_METRIC);

    expect(lastFetchedWindowFor(PRIMARY_METRIC)).toEqual(
      windowOf(SNAPSHOT_START, SNAPSHOT_END),
    );
    expect(chartsOf(PRIMARY_METRIC).onTimeRangeSelect).toBeInstanceOf(Function);
    expect(chartsOf(PRIMARY_METRIC).onTimeRangeReset).toBeUndefined();
  });

  test("a drag zooms the chart; the badge keeps naming the snapshot window", async () => {
    renderPanel(metricSnapshotQuery(SNAPSHOT));
    await chartsSettled(PRIMARY_METRIC);

    await press(`Drag across ${PRIMARY_METRIC}`);

    await waitFor(() => {
      expect(lastFetchedWindowFor(PRIMARY_METRIC)).toEqual(
        windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
      );
    });
    expect(
      screen.getByText(
        OneUptimeDate.getInBetweenDatesAsFormattedString(SNAPSHOT),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();
  });

  test("a double-click returns to the snapshot window", async () => {
    renderPanel(metricSnapshotQuery(SNAPSHOT));
    await chartsSettled(PRIMARY_METRIC);

    await press(`Drag across ${PRIMARY_METRIC}`);
    await waitFor(() => {
      expect(chartsOf(PRIMARY_METRIC).onTimeRangeReset).toBeInstanceOf(
        Function,
      );
    });
    await press(`Double-click ${PRIMARY_METRIC}`);

    await waitFor(() => {
      expect(lastFetchedWindowFor(PRIMARY_METRIC)).toEqual(
        windowOf(SNAPSHOT_START, SNAPSHOT_END),
      );
    });
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("Reset zoom returns to the snapshot window too", async () => {
    renderPanel(metricSnapshotQuery(SNAPSHOT));
    await chartsSettled(PRIMARY_METRIC);

    await press(`Drag across ${PRIMARY_METRIC}`);
    fireEvent.click(
      await screen.findByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    );

    await waitFor(() => {
      expect(lastFetchedWindowFor(PRIMARY_METRIC)).toEqual(
        windowOf(SNAPSHOT_START, SNAPSHOT_END),
      );
    });
  });

  test("a stored snapshot whose bounds came back as ISO strings zooms and resets to the same instants", async () => {
    renderPanel(
      metricSnapshotQuery(
        new InBetween<Date>(
          SNAPSHOT_START.toISOString() as unknown as Date,
          SNAPSHOT_END.toISOString() as unknown as Date,
        ),
      ),
    );
    await chartsSettled(PRIMARY_METRIC);

    await press(`Drag across ${PRIMARY_METRIC}`);
    await waitFor(() => {
      expect(chartsOf(PRIMARY_METRIC).onTimeRangeReset).toBeInstanceOf(
        Function,
      );
    });
    await press(`Double-click ${PRIMARY_METRIC}`);

    await waitFor(() => {
      expect(lastFetchedWindowFor(PRIMARY_METRIC)).toEqual(
        windowOf(SNAPSHOT_START, SNAPSHOT_END),
      );
    });
  });

  test("the page re-deriving the same snapshot (new objects) keeps the zoom", async () => {
    const result: RenderResult = renderPanel(metricSnapshotQuery(SNAPSHOT));
    await chartsSettled(PRIMARY_METRIC);

    await press(`Drag across ${PRIMARY_METRIC}`);
    await waitFor(() => {
      expect(lastFetchedWindowFor(PRIMARY_METRIC)).toEqual(
        windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
      );
    });

    result.rerender(
      <TelemetrySnapshotPanel
        telemetryQuery={metricSnapshotQuery(
          new InBetween<Date>(
            new Date(SNAPSHOT_START.getTime()),
            new Date(SNAPSHOT_END.getTime()),
          ),
        )}
        snapshotWindow={
          new InBetween<Date>(
            new Date(SNAPSHOT_START.getTime()),
            new Date(SNAPSHOT_END.getTime()),
          )
        }
        seriesSummary=""
        eventNoun="incident"
      />,
    );

    expect(
      await screen.findByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();
    expect(lastFetchedWindowFor(PRIMARY_METRIC)).toEqual(
      windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
    );
  });

  test("a different snapshot window ends the zoom and charts that window", async () => {
    const result: RenderResult = renderPanel(metricSnapshotQuery(SNAPSHOT));
    await chartsSettled(PRIMARY_METRIC);

    await press(`Drag across ${PRIMARY_METRIC}`);
    await waitFor(() => {
      expect(chartsOf(PRIMARY_METRIC).onTimeRangeReset).toBeInstanceOf(
        Function,
      );
    });

    const nextStart: Date = new Date("2026-09-14T18:30:00.000Z");
    const nextEnd: Date = new Date("2026-09-14T18:45:00.000Z");
    result.rerender(
      <TelemetrySnapshotPanel
        telemetryQuery={metricSnapshotQuery(
          new InBetween<Date>(nextStart, nextEnd),
        )}
        snapshotWindow={new InBetween<Date>(nextStart, nextEnd)}
        seriesSummary=""
        eventNoun="incident"
      />,
    );

    await waitFor(() => {
      expect(lastFetchedWindowFor(PRIMARY_METRIC)).toEqual(
        windowOf(nextStart, nextEnd),
      );
    });
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test.each([
    ["Logs", "logs"],
    ["Traces", "traces"],
    ["Exceptions", "exceptions"],
  ])(
    "the %s companion tab zooms on its own terms: it sees no zoom from the card",
    async (tabName: string, viewer: string) => {
      renderPanel(metricSnapshotQuery(SNAPSHOT));
      await chartsSettled(PRIMARY_METRIC);

      fireEvent.click(screen.getByRole("tab", { name: tabName }));

      await screen.findByTestId(`viewer-${viewer}`);
      expect(mockViewerZoom[viewer]).toBeNull();
    },
  );
});

describe("the companion tabs inside a page that zooms (the investigation drawer's case)", () => {
  // What the host hands over as its primary element.
  let mockPrimaryZoom: ChartTimeRangeZoomContextValue | null = null;

  const PrimaryProbe: React.FunctionComponent = (): React.ReactElement => {
    mockPrimaryZoom = useChartTimeRangeZoom();
    return (
      <div data-testid="primary-probe">
        <button
          type="button"
          onClick={() => {
            mockPrimaryZoom?.onTimeRangeSelect(
              new Date("2026-09-14T14:00:00.000Z"),
              new Date("2026-09-14T15:00:00.000Z"),
            );
          }}
        >
          Zoom the page from the primary
        </button>
        <ResetTimeRangeZoomButton />
      </div>
    );
  };

  const ZoomingPage: React.FunctionComponent = (): React.ReactElement => {
    const [timeRange, setTimeRange] = React.useState<RangeStartAndEndDateTime>({
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(PAGE_START, PAGE_END),
    });
    return (
      <TimeRangeZoomScope
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
      >
        <span data-testid="page-range">
          {timeRange.startAndEndDate
            ? `${timeRange.startAndEndDate.startValue.toISOString()}/${timeRange.startAndEndDate.endValue.toISOString()}`
            : timeRange.range}
        </span>
        <TelemetryCompanionSignalTabs
          telemetryQuery={logSnapshotQuery()}
          snapshotWindow={SNAPSHOT}
          eventNoun="view"
          primarySignalElement={<PrimaryProbe />}
        />
      </TimeRangeZoomScope>
    );
  };

  const PAGE_RANGE_TEXT: string = `${PAGE_START.toISOString()}/${PAGE_END.toISOString()}`;

  beforeEach(() => {
    mockPrimaryZoom = null;
  });

  test("the host's primary element keeps the page's zoom", async () => {
    render(<ZoomingPage />);
    await screen.findByTestId("primary-probe");

    expect(mockPrimaryZoom).not.toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Zoom the page from the primary" }),
    );

    expect(screen.getByTestId("page-range")).toHaveTextContent(
      "2026-09-14T14:00:00.000Z/2026-09-14T15:00:00.000Z",
    );
    expect(
      within(screen.getByTestId("primary-probe")).getByTestId(
        RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
      ),
    ).toBeVisible();
  });

  test.each([
    ["Traces", "traces"],
    ["Exceptions", "exceptions"],
  ])(
    "the %s companion's picker never offers to reset the page behind it",
    async (tabName: string, viewer: string) => {
      render(<ZoomingPage />);
      await screen.findByTestId("primary-probe");

      // The page is zoomed (from its own chart)...
      fireEvent.click(
        screen.getByRole("button", { name: "Zoom the page from the primary" }),
      );
      expect(screen.getByTestId("page-range")).not.toHaveTextContent(
        PAGE_RANGE_TEXT,
      );

      // ...and the companion, which keeps its own window, is told nothing.
      fireEvent.click(screen.getByRole("tab", { name: tabName }));
      const companion: HTMLElement = await screen.findByTestId(
        `viewer-${viewer}`,
      );

      expect(mockViewerZoom[viewer]).toBeNull();
      expect(
        within(companion).queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      ).toBeNull();
    },
  );

  test("a drag on the companion metric card zooms the card, never the page", async () => {
    render(<ZoomingPage />);
    await screen.findByTestId("primary-probe");

    fireEvent.click(screen.getByRole("tab", { name: "Metrics" }));
    await chartsSettled(COMPANION_METRIC);

    // Pinned to the snapshot window, as a custom range.
    expect(lastFetchedWindowFor(COMPANION_METRIC)).toEqual(
      windowOf(SNAPSHOT_START, SNAPSHOT_END),
    );

    await press(`Drag across ${COMPANION_METRIC}`);

    await waitFor(() => {
      expect(lastFetchedWindowFor(COMPANION_METRIC)).toEqual(
        windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
      );
    });
    expect(screen.getByTestId("page-range")).toHaveTextContent(PAGE_RANGE_TEXT);
    // The card's own way back, not the page's.
    expect(
      screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();
  });

  test("a double-click on the companion metric card returns it to the snapshot window", async () => {
    render(<ZoomingPage />);
    await screen.findByTestId("primary-probe");

    fireEvent.click(screen.getByRole("tab", { name: "Metrics" }));
    await chartsSettled(COMPANION_METRIC);

    await press(`Drag across ${COMPANION_METRIC}`);
    await waitFor(() => {
      expect(chartsOf(COMPANION_METRIC).onTimeRangeReset).toBeInstanceOf(
        Function,
      );
    });
    await press(`Double-click ${COMPANION_METRIC}`);

    await waitFor(() => {
      expect(lastFetchedWindowFor(COMPANION_METRIC)).toEqual(
        windowOf(SNAPSHOT_START, SNAPSHOT_END),
      );
    });
    expect(screen.getByTestId("page-range")).toHaveTextContent(PAGE_RANGE_TEXT);
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("with the page zoomed, the companion metric card offers no reset of its own until it is zoomed", async () => {
    render(<ZoomingPage />);
    await screen.findByTestId("primary-probe");

    fireEvent.click(
      screen.getByRole("button", { name: "Zoom the page from the primary" }),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Metrics" }));
    await chartsSettled(COMPANION_METRIC);

    expect(chartsOf(COMPANION_METRIC).onTimeRangeReset).toBeUndefined();
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();

    // A double-click there is inert: the page stays zoomed where it was.
    await act(async () => {
      chartsOf(COMPANION_METRIC).onTimeRangeReset?.();
    });
    expect(screen.getByTestId("page-range")).toHaveTextContent(
      "2026-09-14T14:00:00.000Z/2026-09-14T15:00:00.000Z",
    );
  });
});
