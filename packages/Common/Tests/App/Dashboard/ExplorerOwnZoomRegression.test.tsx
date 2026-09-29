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
  within,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement, useState } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 regressions. An explorer now follows a zoom offered around it
 * when that zoom is over the explorer's very window (a telemetry snapshot's
 * primary explorer). Everywhere else each explorer must still zoom exactly
 * as it did, on its own:
 *
 * - the Logs and Traces explorer pages, with no zoom around them: a drag
 *   zooms the explorer, a double-click or the picker's Reset zoom returns
 *   it to the window from before the zoom;
 * - an explorer under a zoom over another window, or one that names no
 *   window (the investigation drawer's kind), shadows it;
 * - the companion tabs of a snapshot card withdraw any zoom around them on
 *   purpose, so their explorers keep zooms of their own even under a page
 *   zoom over their very window.
 *
 * The explorer pages, the companion tabs and the explorers are real; the
 * APIs are mocked and recharts is stood in for so the histograms can be
 * dragged.
 */

const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      count: () => {
        return Promise.resolve(0);
      },
      getCommonHeaders: () => {
        return {};
      },
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

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: () => {
        return "error";
      },
      getFriendlyErrorMessage: () => {
        return "error";
      },
    },
  };
});

// No project: the logs explorer page then opens no realtime connection.
jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return null;
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySavedViewsControl",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

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

import LogsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Logs/Index";
import TracesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Traces/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import TelemetryCompanionSignalTabs from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryCompanionSignalTabs";
import {
  ChartTimeRangeZoomContextValue,
  TimeRangeZoomProvider,
  TimeRangeZoomScope,
  useChartTimeRangeZoom,
} from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import ResetTimeRangeZoomButton, {
  RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
} from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { getTimeRangeButtonLabel } from "../../../UI/Components/Date/TimeRangePickerDropdown";
import Log from "../../../Models/AnalyticsModels/Log";
import Route from "../../../Types/API/Route";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");

// The volume charts' bars; a drag from HIST_A to HIST_B covers both.
const HIST_A: string = "2026-09-28 11:20:00";
const HIST_B: string = "2026-09-28 11:21:00";
const HIST_C: string = "2026-09-28 11:22:00";
/*
 * That drag where the bars are a minute wide: the logs explorer's (as wide
 * as its histogram response says), and any explorer's over fifteen minutes.
 */
const ONE_MINUTE_BARS_ZOOM_TEXT: string =
  "2026-09-28T11:20:00.000Z..2026-09-28T11:22:00.000Z";

const LOGS_HISTOGRAM: string = "/telemetry/logs/histogram";
const TRACES_HISTOGRAM: string = "/telemetry/traces/histogram";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/logs"),
  currentProject: null,
  hasPaymentMethod: false,
};

function postedWindows(path: string): Array<string> {
  return postMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as {
        url: { toString: () => string };
        data: Record<string, unknown>;
      };
    })
    .filter((args: { url: { toString: () => string } }): boolean => {
      return args.url.toString().includes(path);
    })
    .map((args: { data: Record<string, unknown> }): string => {
      return `${args.data["startTime"]}..${args.data["endTime"]}`;
    });
}

function logListWindows(): Array<string> {
  return analyticsGetListMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as { modelType: unknown; query: Record<string, unknown> };
    })
    .filter((request: { modelType: unknown }): boolean => {
      return request.modelType === Log;
    })
    .map((request: { query: Record<string, unknown> }): string => {
      const time: InBetween<Date> = request.query["time"] as InBetween<Date>;
      return `${new Date(time.startValue).toISOString()}..${new Date(time.endValue).toISOString()}`;
    });
}

function last(windows: Array<string>): string | undefined {
  return windows[windows.length - 1];
}

/*
 * A relative window resolves against the clock on every fetch, and waitFor
 * moves the fake clock on: "the past hour" is checked by its shape.
 */
function isPastHour(window: string | undefined): boolean {
  if (!window) {
    return false;
  }
  const [startIso, endIso] = window.split("..") as [string, string];
  const startMs: number = new Date(startIso).getTime();
  const endMs: number = new Date(endIso).getTime();
  return endMs - startMs === 60 * 60 * 1000 && endMs >= NOW.getTime();
}

function drag(from: string, to: string, container?: HTMLElement): void {
  const scope: typeof screen | ReturnType<typeof within> = container
    ? within(container)
    : screen;
  fireEvent.mouseDown(scope.getByTestId(`bucket-${from}`));
  fireEvent.mouseMove(scope.getByTestId(`bucket-${to}`));
  fireEvent.mouseUp(scope.getByTestId(`bucket-${to}`));
}

// The element a volume histogram takes its double-click on.
function histogramPlot(container?: HTMLElement): HTMLElement {
  const scope: typeof screen | ReturnType<typeof within> = container
    ? within(container)
    : screen;
  return scope.getByTestId(`bucket-${HIST_A}`).parentElement!.parentElement!
    .parentElement!;
}

function resetButtons(container?: HTMLElement): Array<HTMLElement> {
  return (container ? within(container) : screen).queryAllByTestId(
    RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
  );
}

async function chartDrawn(container?: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(
      (container ? within(container) : screen).getByTestId(`bucket-${HIST_A}`),
    ).toBeInTheDocument();
  });
}

interface ExplorerCase {
  name: string;
  page: () => ReactElement;
  pickerTestId: string;
  // The window the explorer's list and volume chart were last asked for.
  latest: () => Array<string | undefined>;
  // The window a drag across HIST_A and HIST_B zooms it to.
  zoomText: string;
}

const EXPLORERS: Array<ExplorerCase> = [
  {
    name: "the Logs explorer page",
    page: (): ReactElement => {
      return <LogsPage {...PAGE_PROPS} />;
    },
    pickerTestId: "log-time-range-picker-button",
    latest: (): Array<string | undefined> => {
      return [last(logListWindows()), last(postedWindows(LOGS_HISTOGRAM))];
    },
    // Its bars are as wide as the histogram response says: a minute.
    zoomText: ONE_MINUTE_BARS_ZOOM_TEXT,
  },
  {
    name: "the Traces explorer page",
    page: (): ReactElement => {
      return <TracesPage {...PAGE_PROPS} />;
    },
    pickerTestId: "telemetry-time-range-picker-button",
    latest: (): Array<string | undefined> => {
      return [last(postedWindows(TRACES_HISTOGRAM))];
    },
    // It asks for about forty bars: over the past hour, two minutes each.
    zoomText: "2026-09-28T11:20:00.000Z..2026-09-28T11:23:00.000Z",
  },
];

async function expectExplorerOn(
  explorer: ExplorerCase,
  check: (window: string | undefined) => boolean,
): Promise<void> {
  await waitFor(() => {
    for (const window of explorer.latest()) {
      expect(`${window}: ${check(window)}`).toBe(`${window}: true`);
    }
  });
}

// Whether a window is the one a drag across HIST_A and HIST_B zoomed to.
function isDraggedWindow(
  explorer: ExplorerCase,
): (window: string | undefined) => boolean {
  return (window: string | undefined): boolean => {
    return window === explorer.zoomText;
  };
}

function labelOf(text: string): string {
  const [startIso, endIso] = text.split("..") as [string, string];
  return getTimeRangeButtonLabel({
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(new Date(startIso), new Date(endIso)),
  });
}

function pickerLabel(explorer: ExplorerCase): string {
  return (screen.getByTestId(explorer.pickerTestId).textContent || "").trim();
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  postMock.mockReset();
  getListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 0 };
  });
  analyticsGetListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 0 };
  });
  postMock.mockImplementation(
    async (args: { url: { toString: () => string } }) => {
      const url: string = args.url.toString();

      if (url.includes(LOGS_HISTOGRAM)) {
        return {
          data: {
            bucketSizeInMinutes: 1,
            buckets: [HIST_A, HIST_B, HIST_C].map((time: string) => {
              return { time, severity: "Error", count: 2 };
            }),
          },
        };
      }

      if (url.includes(TRACES_HISTOGRAM)) {
        return {
          data: {
            buckets: [HIST_A, HIST_B, HIST_C].map((time: string) => {
              return { time, series: "ok", count: 3 };
            }),
          },
        };
      }

      return { data: {} };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe.each(EXPLORERS)(
  "$name, with no zoom around it, zooms on its own as before",
  (explorer: ExplorerCase) => {
    async function renderExplorer(): Promise<void> {
      await act(async () => {
        render(explorer.page());
      });
      await chartDrawn();
      await expectExplorerOn(explorer, isPastHour);
    }

    test("a drag retimes the explorer and its picker offers Reset zoom", async () => {
      await renderExplorer();
      expect(resetButtons()).toHaveLength(0);

      drag(HIST_A, HIST_B);

      await expectExplorerOn(explorer, isDraggedWindow(explorer));
      expect(pickerLabel(explorer)).toBe(labelOf(explorer.zoomText));
      expect(resetButtons()).toHaveLength(1);
    });

    test("a double-click on the histogram returns it to the window from before the zoom", async () => {
      await renderExplorer();
      drag(HIST_A, HIST_B);
      await expectExplorerOn(explorer, isDraggedWindow(explorer));
      await chartDrawn();

      fireEvent.doubleClick(histogramPlot());

      await expectExplorerOn(explorer, isPastHour);
      expect(pickerLabel(explorer)).toBe("Past 1 Hour");
      expect(resetButtons()).toHaveLength(0);
    });

    test("the picker's Reset zoom returns it to the window from before the zoom", async () => {
      await renderExplorer();
      drag(HIST_A, HIST_B);
      await expectExplorerOn(explorer, isDraggedWindow(explorer));

      fireEvent.click(resetButtons()[0]!);

      await expectExplorerOn(explorer, isPastHour);
      expect(pickerLabel(explorer)).toBe("Past 1 Hour");
      expect(resetButtons()).toHaveLength(0);
    });
  },
);

// A page with a range of its own, zooming it, around an explorer page.
const pageRangeSpy: MockFunction = getJestMockFunction();

const PageAroundExplorer: FunctionComponent<{
  explorer: ExplorerCase;
  initialRange: RangeStartAndEndDateTime;
}> = (props: {
  explorer: ExplorerCase;
  initialRange: RangeStartAndEndDateTime;
}): ReactElement => {
  const [range, setRange] = useState<RangeStartAndEndDateTime>(
    props.initialRange,
  );

  return (
    <TimeRangeZoomScope
      timeRange={range}
      onTimeRangeChange={(next: RangeStartAndEndDateTime): void => {
        pageRangeSpy(next);
        setRange(next);
      }}
    >
      <div data-testid="page-reset">
        <ResetTimeRangeZoomButton />
      </div>
      <div data-testid="explorer">{props.explorer.page()}</div>
    </TimeRangeZoomScope>
  );
};

describe.each(EXPLORERS)(
  "$name under a zoom around it that it does not follow",
  (explorer: ExplorerCase) => {
    beforeEach(() => {
      pageRangeSpy.mockReset();
    });

    test("a page zoom over another window: a drag zooms the explorer alone, the page is untouched", async () => {
      await act(async () => {
        render(
          <PageAroundExplorer
            explorer={explorer}
            initialRange={{ range: TimeRange.PAST_ONE_WEEK }}
          />,
        );
      });
      await chartDrawn();

      drag(HIST_A, HIST_B);

      await expectExplorerOn(explorer, isDraggedWindow(explorer));
      expect(pageRangeSpy).not.toHaveBeenCalled();
      // The explorer's own way back, in its picker; none for the page.
      expect(resetButtons(screen.getByTestId("explorer"))).toHaveLength(1);
      expect(resetButtons(screen.getByTestId("page-reset"))).toHaveLength(0);

      fireEvent.doubleClick(histogramPlot());

      await expectExplorerOn(explorer, isPastHour);
      expect(pageRangeSpy).not.toHaveBeenCalled();
    });

    test("a zoom that names no window (the investigation drawer's kind) is shadowed: the explorer zooms itself", async () => {
      const aroundSelect: MockFunction = getJestMockFunction();
      const aroundReset: MockFunction = getJestMockFunction();
      const handBuilt: TimeRangeZoom = {
        isZoomed: true,
        rangeBeforeZoom: { range: TimeRange.PAST_ONE_WEEK },
        zoomToTimeRange: (startTime: Date, endTime: Date): void => {
          aroundSelect(startTime, endTime);
        },
        resetZoom: (): void => {
          aroundReset();
        },
      };

      await act(async () => {
        render(
          <TimeRangeZoomProvider zoom={handBuilt}>
            {explorer.page()}
          </TimeRangeZoomProvider>,
        );
      });
      await chartDrawn();

      // Zoomed around, not in the explorer: its picker offers nothing.
      expect(resetButtons()).toHaveLength(0);

      drag(HIST_A, HIST_B);
      await expectExplorerOn(explorer, isDraggedWindow(explorer));
      expect(resetButtons()).toHaveLength(1);

      fireEvent.click(resetButtons()[0]!);
      await expectExplorerOn(explorer, isPastHour);

      expect(aroundSelect).not.toHaveBeenCalled();
      expect(aroundReset).not.toHaveBeenCalled();
    });
  },
);

/*
 * A snapshot card's companion tabs inside a page whose zoom is over the
 * companions' very window: the tabs withdraw it on purpose, so the
 * companion explorers keep zooms of their own and never retime the page.
 */
const SNAPSHOT: InBetween<Date> = new InBetween<Date>(
  new Date("2026-09-28T11:15:00.000Z"),
  new Date("2026-09-28T11:30:00.000Z"),
);
const SNAPSHOT_TEXT: string =
  "2026-09-28T11:15:00.000Z..2026-09-28T11:30:00.000Z";

function metricSnapshotQuery(): TelemetryQuery {
  return {
    telemetryType: TelemetryType.Metric,
    telemetryQuery: null,
    metricViewData: {
      startAndEndDate: SNAPSHOT,
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
              metricName: "system.cpu.utilization",
              aggegationType: MetricsAggregationType.Avg,
            },
          },
        },
      ],
      formulaConfigs: [],
    },
  };
}

// The host's primary element: it zooms whatever the page offers it.
const PrimaryProbe: FunctionComponent = (): ReactElement => {
  const zoom: ChartTimeRangeZoomContextValue | null = useChartTimeRangeZoom();

  return (
    <button
      type="button"
      onClick={() => {
        zoom?.onTimeRangeSelect(
          new Date("2026-09-28T11:18:00.000Z"),
          new Date("2026-09-28T11:24:00.000Z"),
        );
      }}
    >
      Zoom the page from the primary
    </button>
  );
};

const PageOverTheSnapshot: FunctionComponent = (): ReactElement => {
  const [range, setRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.CUSTOM,
    startAndEndDate: SNAPSHOT,
  });

  return (
    <TimeRangeZoomScope
      timeRange={range}
      onTimeRangeChange={(next: RangeStartAndEndDateTime): void => {
        pageRangeSpy(next);
        setRange(next);
      }}
    >
      <div data-testid="page-reset">
        <ResetTimeRangeZoomButton />
      </div>
      <TelemetryCompanionSignalTabs
        telemetryQuery={metricSnapshotQuery()}
        snapshotWindow={SNAPSHOT}
        eventNoun="incident"
        primarySignalElement={<PrimaryProbe />}
      />
    </TimeRangeZoomScope>
  );
};

describe("companion tabs ignore a page zoom, even one over their very window", () => {
  beforeEach(() => {
    pageRangeSpy.mockReset();
  });

  test.each([
    ["Logs", LOGS_HISTOGRAM],
    ["Traces", TRACES_HISTOGRAM],
  ])(
    "the %s companion's drag zooms the companion alone, and its double-click undoes only that",
    async (tab: string, histogramPath: string) => {
      await act(async () => {
        render(<PageOverTheSnapshot />);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("tab", { name: tab }));
      });
      const panel: HTMLElement = screen.getByRole("tabpanel");
      await chartDrawn(panel);
      await waitFor(() => {
        expect(last(postedWindows(histogramPath))).toBe(SNAPSHOT_TEXT);
      });

      drag(HIST_A, HIST_B, panel);

      await waitFor(() => {
        expect(last(postedWindows(histogramPath))).toBe(
          ONE_MINUTE_BARS_ZOOM_TEXT,
        );
      });
      expect(pageRangeSpy).not.toHaveBeenCalled();
      // Its own way back, beside its own picker; the page is not zoomed.
      expect(resetButtons(panel)).toHaveLength(1);
      expect(resetButtons(screen.getByTestId("page-reset"))).toHaveLength(0);

      await chartDrawn(panel);
      fireEvent.doubleClick(histogramPlot(panel));

      await waitFor(() => {
        expect(last(postedWindows(histogramPath))).toBe(SNAPSHOT_TEXT);
      });
      expect(pageRangeSpy).not.toHaveBeenCalled();
      expect(resetButtons()).toHaveLength(0);
    },
  );

  test.each([["Logs"], ["Traces"]])(
    "a zoomed page's Reset zoom is never offered in the %s companion's picker",
    async (tab: string) => {
      await act(async () => {
        render(<PageOverTheSnapshot />);
      });

      fireEvent.click(
        screen.getByRole("button", { name: "Zoom the page from the primary" }),
      );
      expect(pageRangeSpy).toHaveBeenCalledTimes(1);
      expect(resetButtons(screen.getByTestId("page-reset"))).toHaveLength(1);

      await act(async () => {
        fireEvent.click(screen.getByRole("tab", { name: tab }));
      });
      const panel: HTMLElement = screen.getByRole("tabpanel");
      await chartDrawn(panel);

      expect(resetButtons(panel)).toHaveLength(0);
      expect(within(panel).queryByText("Double-click to reset")).toBeNull();
    },
  );
});
