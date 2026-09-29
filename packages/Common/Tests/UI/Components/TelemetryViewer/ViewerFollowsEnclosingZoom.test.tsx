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
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * Issue #4105: an explorer (the logs viewer, and the traces, exceptions and
 * security events viewers on the telemetry shell) keeps a zoom of its own
 * over the window its host owns, and shadows any zoom offered around it. A
 * telemetry snapshot pins its primary explorer to the window the snapshot
 * shows and offers the snapshot's zoom around it: there the explorer must
 * FOLLOW that zoom instead, so a drag on its histogram retimes the whole
 * snapshot and one reset undoes it all.
 *
 * The rule (useViewerTimeRangeZoom, shouldFollowEnclosingZoom): an explorer
 * follows the zoom around it only while that zoom says it is over the
 * explorer's very window. Then a drag on any of its charts goes to that
 * zoom, a double-click and "Reset zoom" go to that zoom's reset (offered
 * only while it is zoomed), and the explorer keeps no zoom of its own, so
 * its picker offers no second "Reset zoom". Anywhere else - no zoom around,
 * or a zoom over another window - it zooms on its own exactly as before.
 *
 * Driven here with the hook in a page that zooms, and with the real
 * telemetry shell and logs viewer in one. Recharts is stood in for so the
 * histograms and the analytics chart can be dragged (see
 * LogsHistogramDragTooltip.test.tsx).
 */

const getListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

// The logs viewer loads services and log attributes on mount.
jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyErrorMessage: (error: Error) => {
        return error.message;
      },
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
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
    Area: nothing,
    Bar: nothing,
    XAxis: nothing,
    YAxis: nothing,
    CartesianGrid: nothing,
    Tooltip: nothing,
    ReferenceArea: nothing,
  };
});

// Imported after the mocks so the viewers pick the stand-ins up.
import useViewerTimeRangeZoom, {
  shouldFollowEnclosingZoom,
  ViewerTimeRangeZoom,
} from "../../../../UI/Components/TelemetryViewer/useViewerTimeRangeZoom";
import TelemetryViewer from "../../../../UI/Components/TelemetryViewer/TelemetryViewer";
import LogsViewer from "../../../../UI/Components/LogsViewer/LogsViewer";
import { LOGS_ANALYTICS_TIMESERIES_TEST_ID } from "../../../../UI/Components/LogsViewer/components/LogsAnalyticsView";
import {
  ChartTimeRangeZoomContextValue,
  TimeRangeZoomProvider,
  useChartTimeRangeZoom,
} from "../../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import useTimeRangeZoom, {
  TimeRangeZoom,
} from "../../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import TimeRangeZoomUtil from "../../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomUtil";
import ResetTimeRangeZoomButton, {
  RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
} from "../../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { getTimeRangeButtonLabel } from "../../../../UI/Components/Date/TimeRangePickerDropdown";
import { HistogramBucket as LogsHistogramBucket } from "../../../../UI/Components/LogsViewer/types";
import {
  HistogramBucket,
  HistogramSeriesOption,
} from "../../../../UI/Components/TelemetryViewer/types";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import LogSeverity from "../../../../Types/Log/LogSeverity";
import RangeStartAndEndDateTime from "../../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../../Types/Time/TimeRange";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const MINUTE_MS: number = 60 * 1000;

function custom(startIso: string, endIso: string): RangeStartAndEndDateTime {
  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(new Date(startIso), new Date(endIso)),
  };
}

// The window the explorer is pinned to, and the zoom around it is over.
const WINDOW_TEXT: string =
  "2026-09-28T10:00:00.000Z..2026-09-28T10:15:00.000Z";
const WINDOW: RangeStartAndEndDateTime = custom(
  "2026-09-28T10:00:00.000Z",
  "2026-09-28T10:15:00.000Z",
);
// A window of the page's that the explorer does not show.
const OTHER_TEXT: string = "2026-09-28T08:00:00.000Z..2026-09-28T09:00:00.000Z";
const OTHER: RangeStartAndEndDateTime = custom(
  "2026-09-28T08:00:00.000Z",
  "2026-09-28T09:00:00.000Z",
);

// A drag inside WINDOW, and a second one inside that.
const SLICE_START: string = "2026-09-28T10:03:00.000Z";
const SLICE_END: string = "2026-09-28T10:05:00.000Z";
const SLICE_TEXT: string = `${SLICE_START}..${SLICE_END}`;
const NESTED_START: string = "2026-09-28T10:03:30.000Z";
const NESTED_END: string = "2026-09-28T10:04:00.000Z";

// Volume histogram bars, one minute each; a drag from A to B covers both.
const BAR_A: string = "2026-09-28 10:03:00";
const BAR_B: string = "2026-09-28 10:04:00";
const BAR_C: string = "2026-09-28 10:05:00";

// The logs viewer's Analytics timeseries buckets, from the API.
const ANALYTICS_A: string = "2026-09-28 10:07:00";
const ANALYTICS_B: string = "2026-09-28 10:08:00";

const SERIES: Array<HistogramSeriesOption> = [
  { key: "ok", label: "OK", color: "#34d399" },
];

const TELEMETRY_BUCKETS: Array<HistogramBucket> = [BAR_A, BAR_B, BAR_C].map(
  (time: string): HistogramBucket => {
    return { time, series: "ok", count: 3 };
  },
);

const LOGS_BUCKETS: Array<LogsHistogramBucket> = [BAR_A, BAR_B, BAR_C].map(
  (time: string): LogsHistogramBucket => {
    return { time, severity: LogSeverity.Error, count: 3 };
  },
);

// Dates restored from a URL can arrive as strings; print both the same way.
function iso(date: unknown): string {
  return new Date(date as Date | string).toISOString();
}

function windowOf(range: RangeStartAndEndDateTime | null | undefined): string {
  if (!range) {
    return "none";
  }

  if (range.range !== TimeRange.CUSTOM) {
    return range.range;
  }

  return `${iso(range.startAndEndDate!.startValue)}..${iso(
    range.startAndEndDate!.endValue,
  )}`;
}

function read(testId: string): string {
  return screen.getByTestId(testId).textContent || "";
}

// What a page offers the charts below it (see TimeRangeZoomProvider).
function offered(
  timeRange: RangeStartAndEndDateTime | null,
  isZoomed: boolean = false,
): ChartTimeRangeZoomContextValue {
  return {
    onTimeRangeSelect: (): void => {},
    onTimeRangeReset: isZoomed ? (): void => {} : undefined,
    isZoomed: isZoomed,
    rangeBeforeZoom: isZoomed ? OTHER : null,
    timeRange: timeRange,
  };
}

type UsePinFollowFunction = (
  pinnedTo: RangeStartAndEndDateTime | null,
  apply: (range: RangeStartAndEndDateTime) => void,
) => void;

/*
 * How the explorers' hosts follow a window they are pinned to: a new one,
 * by value, is applied; the same one handed over again is not (see the
 * pin-follow effects of DashboardLogsViewer, TracesViewer and
 * ExceptionsViewer). Like theirs, it lands a render after the pin moves.
 */
const usePinFollow: UsePinFollowFunction = (
  pinnedTo: RangeStartAndEndDateTime | null,
  apply: (range: RangeStartAndEndDateTime) => void,
): void => {
  const pinKey: string = TimeRangeZoomUtil.getRangeKey(pinnedTo);
  const lastPinKey: React.MutableRefObject<string> = useRef<string>(pinKey);

  useEffect(() => {
    if (lastPinKey.current === pinKey) {
      return;
    }

    lastPinKey.current = pinKey;

    if (pinnedTo) {
      apply(pinnedTo);
    }
  }, [pinKey]);
};

const pageChangeSpy: MockFunction = getJestMockFunction();
const explorerSelectSpy: MockFunction = getJestMockFunction();
const explorerChangeSpy: MockFunction = getJestMockFunction();

let latestPage: TimeRangeZoom | null = null;
let setPageRangeFromOutside:
  | ((range: RangeStartAndEndDateTime) => void)
  | null = null;

function page(): TimeRangeZoom {
  if (!latestPage) {
    throw new Error("the page has not rendered");
  }
  return latestPage;
}

function pageMovesTo(range: RangeStartAndEndDateTime): void {
  act(() => {
    setPageRangeFromOutside!(range);
  });
}

interface ZoomingPageProps {
  initialRange: RangeStartAndEndDateTime;
  // Whether the explorer is pinned to the page's range, as a snapshot's is.
  pinExplorer: boolean;
  // Whether the page offers its zoom around the explorer at all.
  offersZoom?: boolean | undefined;
  explorer: (pinnedTo: RangeStartAndEndDateTime | null) => ReactElement;
}

/*
 * A page that owns a range and zooms it, with its own "Reset zoom" (the way
 * the telemetry snapshot offers one beside its badge), around an explorer.
 */
const ZoomingPage: FunctionComponent<ZoomingPageProps> = (
  props: ZoomingPageProps,
): ReactElement => {
  const [pageRange, setPageRange] = useState<RangeStartAndEndDateTime>(
    props.initialRange,
  );

  const zoom: TimeRangeZoom = useTimeRangeZoom({
    timeRange: pageRange,
    onTimeRangeChange: (next: RangeStartAndEndDateTime): void => {
      pageChangeSpy(next);
      setPageRange(next);
    },
  });

  latestPage = zoom;
  setPageRangeFromOutside = setPageRange;

  const explorer: ReactElement = (
    <div data-testid="explorer">
      {props.explorer(props.pinExplorer ? pageRange : null)}
    </div>
  );

  return (
    <div>
      <span data-testid="page-window">{windowOf(pageRange)}</span>
      <span data-testid="page-zoomed">{String(zoom.isZoomed)}</span>
      {props.offersZoom === false ? (
        explorer
      ) : (
        <TimeRangeZoomProvider zoom={zoom}>
          <div data-testid="page-reset">
            <ResetTimeRangeZoomButton />
          </div>
          {explorer}
        </TimeRangeZoomProvider>
      )}
    </div>
  );
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  latestPage = null;
  setPageRangeFromOutside = null;
  pageChangeSpy.mockReset();
  explorerSelectSpy.mockReset();
  explorerChangeSpy.mockReset();
  getListMock.mockReset();
  postMock.mockReset();
  getListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 0 };
  });
  postMock.mockImplementation(
    async (args: { url: { toString: () => string } }) => {
      if (args.url.toString().includes("/telemetry/logs/analytics")) {
        return {
          data: {
            data: [ANALYTICS_A, ANALYTICS_B].map((time: string) => {
              return { time, count: 4, groupValues: {} };
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
});

describe("shouldFollowEnclosingZoom: which zoom around an explorer it follows", () => {
  test("no zoom around the explorer: nothing to follow", () => {
    expect(shouldFollowEnclosingZoom(null, WINDOW)).toBe(false);
  });

  test("a zoom over another window is not followed", () => {
    expect(shouldFollowEnclosingZoom(offered(OTHER), WINDOW)).toBe(false);
    // Zoomed or not.
    expect(shouldFollowEnclosingZoom(offered(OTHER, true), WINDOW)).toBe(false);
  });

  test("a window that shares one edge is another window", () => {
    expect(
      shouldFollowEnclosingZoom(
        offered(custom("2026-09-28T10:00:00.000Z", "2026-09-28T10:14:59.000Z")),
        WINDOW,
      ),
    ).toBe(false);
    expect(
      shouldFollowEnclosingZoom(
        offered(custom("2026-09-28T10:00:01.000Z", "2026-09-28T10:15:00.000Z")),
        WINDOW,
      ),
    ).toBe(false);
  });

  test("a relative range and a custom one are different windows", () => {
    expect(
      shouldFollowEnclosingZoom(
        offered({ range: TimeRange.PAST_ONE_HOUR }),
        WINDOW,
      ),
    ).toBe(false);
    expect(
      shouldFollowEnclosingZoom(offered(WINDOW), {
        range: TimeRange.PAST_ONE_HOUR,
      }),
    ).toBe(false);
  });

  test("a zoom over the explorer's very window is followed, compared by value", () => {
    expect(shouldFollowEnclosingZoom(offered(WINDOW), WINDOW)).toBe(true);
    // New objects, the same instants.
    expect(
      shouldFollowEnclosingZoom(
        offered(custom("2026-09-28T10:00:00.000Z", "2026-09-28T10:15:00.000Z")),
        custom("2026-09-28T10:00:00.000Z", "2026-09-28T10:15:00.000Z"),
      ),
    ).toBe(true);
    // Zoomed or not: the zoom's range is where it is now.
    expect(shouldFollowEnclosingZoom(offered(WINDOW, true), WINDOW)).toBe(true);
  });

  test("a window restored with string dates is still the same window", () => {
    expect(
      shouldFollowEnclosingZoom(offered(WINDOW), {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          "2026-09-28T10:00:00.000Z" as unknown as Date,
          "2026-09-28T10:15:00.000Z" as unknown as Date,
        ),
      }),
    ).toBe(true);
  });

  test("the same relative range is the same window, whatever it resolved to", () => {
    expect(
      shouldFollowEnclosingZoom(offered({ range: TimeRange.PAST_ONE_DAY }), {
        range: TimeRange.PAST_ONE_DAY,
      }),
    ).toBe(true);
  });

  /*
   * The investigation drawer offers a zoom that names no range, and so can
   * any hand-built one: nothing ties it to the explorer's window, so the
   * explorer keeps shadowing it with its own, as it always has.
   */
  test("a zoom that does not say which range it is over is not followed", () => {
    expect(shouldFollowEnclosingZoom(offered(null), WINDOW)).toBe(false);
    expect(shouldFollowEnclosingZoom(offered(null, true), WINDOW)).toBe(false);
  });

  test("an explorer that has no window of its own follows nothing", () => {
    expect(shouldFollowEnclosingZoom(offered(WINDOW), undefined)).toBe(false);
  });
});

/*
 * The hook in a real page: the page owns a range and zooms it; the explorer
 * owns its window the way the Dashboard explorers do (a drag becomes a
 * custom window, a pick is applied as it comes) and, when pinned, follows
 * the page's range the way a snapshot's primary explorer follows the
 * snapshot's window.
 */
let latestExplorer: ViewerTimeRangeZoom | null = null;

function explorer(): ViewerTimeRangeZoom {
  if (!latestExplorer) {
    throw new Error("the explorer has not rendered");
  }
  return latestExplorer;
}

interface ProbeExplorerProps {
  pinnedTo: RangeStartAndEndDateTime | null;
  initial: RangeStartAndEndDateTime;
  // False for a host that cannot apply a zoom (no select handler).
  canZoom: boolean;
}

const ProbeExplorer: FunctionComponent<ProbeExplorerProps> = (
  props: ProbeExplorerProps,
): ReactElement => {
  const [range, setRange] = useState<RangeStartAndEndDateTime>(props.initial);

  usePinFollow(props.pinnedTo, setRange);

  const zoom: ViewerTimeRangeZoom = useViewerTimeRangeZoom({
    timeRange: range,
    onTimeRangeSelect: props.canZoom
      ? (startTime: Date, endTime: Date): void => {
          explorerSelectSpy(startTime, endTime);
          setRange({
            range: TimeRange.CUSTOM,
            startAndEndDate: new InBetween<Date>(startTime, endTime),
          });
        }
      : undefined,
    onTimeRangeChange: (next: RangeStartAndEndDateTime): void => {
      explorerChangeSpy(next);
      setRange(next);
    },
  });

  latestExplorer = zoom;

  return (
    <div>
      <span data-testid="explorer-window">{windowOf(range)}</span>
      <span data-testid="follows">{String(zoom.followsEnclosingZoom)}</span>
      <span data-testid="explorer-zoomed">
        {String(Boolean(zoom.zoom?.isZoomed))}
      </span>
      <span data-testid="before-zoom">
        {windowOf(zoom.zoom?.rangeBeforeZoom || null)}
      </span>
      <span data-testid="can-zoom-out">{String(Boolean(zoom.onZoomOut))}</span>
    </div>
  );
};

interface ProbePageOptions {
  pageRange: RangeStartAndEndDateTime;
  explorerRange: RangeStartAndEndDateTime;
  pinExplorer: boolean;
  offersZoom?: boolean | undefined;
  canZoom?: boolean | undefined;
}

function renderProbePage(options: ProbePageOptions): void {
  render(
    <ZoomingPage
      initialRange={options.pageRange}
      pinExplorer={options.pinExplorer}
      offersZoom={options.offersZoom}
      explorer={(pinnedTo: RangeStartAndEndDateTime | null): ReactElement => {
        return (
          <ProbeExplorer
            pinnedTo={pinnedTo}
            initial={options.explorerRange}
            canZoom={options.canZoom !== false}
          />
        );
      }}
    />,
  );
}

function drag(startIso: string, endIso: string): void {
  act(() => {
    explorer().onTimeRangeSelect!(new Date(startIso), new Date(endIso));
  });
}

function zoomOut(): void {
  act(() => {
    explorer().onZoomOut!();
  });
}

// A snapshot pinning its explorer to the snapshot's window.
function renderFollowingExplorer(canZoom: boolean = true): void {
  renderProbePage({
    pageRange: WINDOW,
    explorerRange: WINDOW,
    pinExplorer: true,
    canZoom: canZoom,
  });
}

describe("the hook: with no zoom around it, or one over another window, the explorer zooms on its own", () => {
  test("no zoom around: a drag reaches the explorer's host and the explorer is zoomed", () => {
    renderProbePage({
      pageRange: WINDOW,
      explorerRange: WINDOW,
      pinExplorer: false,
      offersZoom: false,
    });

    drag(SLICE_START, SLICE_END);

    expect(explorerSelectSpy).toHaveBeenCalledTimes(1);
    expect(read("explorer-window")).toBe(SLICE_TEXT);
    expect(read("explorer-zoomed")).toBe("true");
    expect(read("before-zoom")).toBe(WINDOW_TEXT);
    expect(pageChangeSpy).not.toHaveBeenCalled();
    expect(read("page-window")).toBe(WINDOW_TEXT);

    zoomOut();

    expect(explorerChangeSpy).toHaveBeenCalledTimes(1);
    expect(windowOf(explorerChangeSpy.mock.calls[0]![0] as never)).toBe(
      WINDOW_TEXT,
    );
    expect(read("explorer-window")).toBe(WINDOW_TEXT);
    expect(read("can-zoom-out")).toBe("false");
    expect(pageChangeSpy).not.toHaveBeenCalled();
  });

  test("a zoom around over another window: the explorer's own zoom, and the page is never touched", () => {
    renderProbePage({
      pageRange: OTHER,
      explorerRange: WINDOW,
      pinExplorer: false,
    });

    drag(SLICE_START, SLICE_END);

    expect(explorerSelectSpy).toHaveBeenCalledTimes(1);
    expect(read("explorer-zoomed")).toBe("true");
    expect(read("page-window")).toBe(OTHER_TEXT);

    zoomOut();

    expect(read("explorer-window")).toBe(WINDOW_TEXT);
    expect(pageChangeSpy).not.toHaveBeenCalled();
    expect(read("page-window")).toBe(OTHER_TEXT);
  });

  test("a zoomed page over another window offers the explorer no way back of the page's", () => {
    renderProbePage({
      pageRange: OTHER,
      explorerRange: WINDOW,
      pinExplorer: false,
    });

    act(() => {
      page().zoomToTimeRange(
        new Date("2026-09-28T08:10:00.000Z"),
        new Date("2026-09-28T08:20:00.000Z"),
      );
    });

    expect(read("page-zoomed")).toBe("true");
    expect(read("explorer-zoomed")).toBe("false");
    expect(read("can-zoom-out")).toBe("false");

    // A stray double-click in the explorer leaves the page zoomed.
    act(() => {
      explorer().zoom!.resetZoom();
    });
    expect(read("page-zoomed")).toBe("true");
  });

  test("a zoom around that names no range is shadowed, as before", () => {
    const aroundSelect: MockFunction = getJestMockFunction();
    const aroundReset: MockFunction = getJestMockFunction();
    const handBuilt: TimeRangeZoom = {
      isZoomed: true,
      rangeBeforeZoom: OTHER,
      zoomToTimeRange: (startTime: Date, endTime: Date): void => {
        aroundSelect(startTime, endTime);
      },
      resetZoom: (): void => {
        aroundReset();
      },
    };

    render(
      <TimeRangeZoomProvider zoom={handBuilt}>
        <ProbeExplorer pinnedTo={null} initial={WINDOW} canZoom={true} />
      </TimeRangeZoomProvider>,
    );

    expect(read("explorer-zoomed")).toBe("false");

    drag(SLICE_START, SLICE_END);
    zoomOut();

    expect(aroundSelect).not.toHaveBeenCalled();
    expect(aroundReset).not.toHaveBeenCalled();
    expect(explorerSelectSpy).toHaveBeenCalledTimes(1);
    expect(explorerChangeSpy).toHaveBeenCalledTimes(1);
  });

  test("a host that cannot zoom, under a zoom over another window, offers no drag (as before)", () => {
    renderProbePage({
      pageRange: OTHER,
      explorerRange: WINDOW,
      pinExplorer: false,
      canZoom: false,
    });

    expect(explorer().zoom).toBeNull();
    expect(explorer().onTimeRangeSelect).toBeUndefined();
    expect(explorer().onZoomOut).toBeUndefined();
  });
});

describe("the hook: a zoom around over the explorer's very window is followed", () => {
  test("it is adopted: the explorer says so, and is not zoomed while the page is not", () => {
    renderFollowingExplorer();

    expect(read("follows")).toBe("true");
    expect(read("explorer-zoomed")).toBe("false");
    expect(read("can-zoom-out")).toBe("false");
    expect(explorer().onTimeRangeSelect).toBeInstanceOf(Function);
  });

  test("a drag zooms the page, not the explorer's host; the explorer follows the page there", () => {
    renderFollowingExplorer();

    drag(SLICE_START, SLICE_END);

    expect(explorerSelectSpy).not.toHaveBeenCalled();
    expect(pageChangeSpy).toHaveBeenCalledTimes(1);
    expect(windowOf(pageChangeSpy.mock.calls[0]![0] as never)).toBe(SLICE_TEXT);
    expect(read("page-window")).toBe(SLICE_TEXT);
    expect(read("page-zoomed")).toBe("true");
    // Pinned to the page's range, the explorer is on the slice, still following.
    expect(read("explorer-window")).toBe(SLICE_TEXT);
    expect(read("follows")).toBe("true");
  });

  test("while the page is zoomed the explorer is too, with the page's way back", () => {
    renderFollowingExplorer();

    drag(SLICE_START, SLICE_END);

    expect(read("explorer-zoomed")).toBe("true");
    expect(read("can-zoom-out")).toBe("true");
    expect(read("before-zoom")).toBe(WINDOW_TEXT);
    // The zoom it hands on is over the page's range.
    expect(windowOf(explorer().zoom!.timeRange)).toBe(SLICE_TEXT);
  });

  test("a double-click resets the page, and the explorer follows it back", () => {
    renderFollowingExplorer();
    drag(SLICE_START, SLICE_END);

    zoomOut();

    expect(explorerChangeSpy).not.toHaveBeenCalled();
    expect(pageChangeSpy).toHaveBeenCalledTimes(2);
    expect(windowOf(pageChangeSpy.mock.calls[1]![0] as never)).toBe(
      WINDOW_TEXT,
    );
    expect(read("page-window")).toBe(WINDOW_TEXT);
    expect(read("page-zoomed")).toBe("false");
    expect(read("explorer-window")).toBe(WINDOW_TEXT);
    expect(read("explorer-zoomed")).toBe("false");
    expect(read("can-zoom-out")).toBe("false");
  });

  test("the zoom it hands its charts resets the page too", () => {
    renderFollowingExplorer();
    drag(SLICE_START, SLICE_END);

    act(() => {
      explorer().zoom!.resetZoom();
    });

    expect(read("page-window")).toBe(WINDOW_TEXT);
    expect(read("explorer-window")).toBe(WINDOW_TEXT);
  });

  test("the page's own reset (the snapshot badge's) takes the explorer back with it", () => {
    renderFollowingExplorer();
    drag(SLICE_START, SLICE_END);

    act(() => {
      page().resetZoom();
    });

    expect(read("page-window")).toBe(WINDOW_TEXT);
    expect(read("explorer-window")).toBe(WINDOW_TEXT);
    expect(read("explorer-zoomed")).toBe("false");
  });

  test("it keeps no zoom of its own: once the page is reset there is nothing left to undo", () => {
    renderFollowingExplorer();
    drag(SLICE_START, SLICE_END);
    act(() => {
      page().resetZoom();
    });
    const pageChanges: number = pageChangeSpy.mock.calls.length;

    act(() => {
      explorer().zoom!.resetZoom();
    });

    expect(pageChangeSpy.mock.calls.length).toBe(pageChanges);
    expect(explorerChangeSpy).not.toHaveBeenCalled();
    expect(read("explorer-window")).toBe(WINDOW_TEXT);
  });

  test("before any zoom a double-click has nothing to do: none is offered, and a stray one changes nothing", () => {
    renderFollowingExplorer();

    expect(explorer().onZoomOut).toBeUndefined();

    act(() => {
      explorer().zoom!.resetZoom();
    });

    expect(pageChangeSpy).not.toHaveBeenCalled();
    expect(explorerChangeSpy).not.toHaveBeenCalled();
  });

  test("a second drag zooms within the first; one reset returns to the window before both", () => {
    renderFollowingExplorer();

    drag(SLICE_START, SLICE_END);
    drag(NESTED_START, NESTED_END);

    expect(read("page-window")).toBe(`${NESTED_START}..${NESTED_END}`);
    expect(read("explorer-window")).toBe(`${NESTED_START}..${NESTED_END}`);
    expect(read("before-zoom")).toBe(WINDOW_TEXT);

    zoomOut();

    expect(read("page-window")).toBe(WINDOW_TEXT);
    expect(read("explorer-window")).toBe(WINDOW_TEXT);
  });

  test("two drags before anything re-renders both reach the page", () => {
    renderFollowingExplorer();

    act(() => {
      explorer().onTimeRangeSelect!(new Date(SLICE_START), new Date(SLICE_END));
      explorer().onTimeRangeSelect!(
        new Date(NESTED_START),
        new Date(NESTED_END),
      );
    });

    expect(explorerSelectSpy).not.toHaveBeenCalled();
    expect(read("page-window")).toBe(`${NESTED_START}..${NESTED_END}`);

    zoomOut();

    expect(read("page-window")).toBe(WINDOW_TEXT);
  });

  test("the drag is handed over as it came: the page cuts it at the end of its own range", () => {
    renderFollowingExplorer();

    drag("2026-09-28T10:14:00.000Z", "2026-09-28T10:16:00.000Z");

    expect(read("page-window")).toBe(
      "2026-09-28T10:14:00.000Z..2026-09-28T10:15:00.000Z",
    );
  });

  test("a host that cannot zoom on its own still hands a drag to the zoom it follows", () => {
    renderFollowingExplorer(false);

    expect(read("follows")).toBe("true");
    // Nothing of its own to offer its charts; the page's reaches them as is.
    expect(explorer().zoom).toBeNull();

    drag(SLICE_START, SLICE_END);

    expect(read("page-window")).toBe(SLICE_TEXT);
    expect(read("explorer-window")).toBe(SLICE_TEXT);
    expect(explorer().onZoomOut).toBeInstanceOf(Function);

    zoomOut();

    expect(read("page-window")).toBe(WINDOW_TEXT);
  });

  test("its callbacks keep their identity as it starts and stops following", () => {
    renderProbePage({
      pageRange: WINDOW,
      explorerRange: WINDOW,
      pinExplorer: false,
    });
    const select: unknown = explorer().onTimeRangeSelect;
    const pick: unknown = explorer().onTimeRangeChange;
    const zoomTo: unknown = explorer().zoom!.zoomToTimeRange;
    const reset: unknown = explorer().zoom!.resetZoom;
    expect(read("follows")).toBe("true");

    pageMovesTo(OTHER);
    expect(read("follows")).toBe("false");

    pageMovesTo(WINDOW);
    expect(read("follows")).toBe("true");

    expect(explorer().onTimeRangeSelect).toBe(select);
    expect(explorer().onTimeRangeChange).toBe(pick);
    expect(explorer().zoom!.zoomToTimeRange).toBe(zoomTo);
    expect(explorer().zoom!.resetZoom).toBe(reset);
  });
});

describe("the hook: an explorer stops following once the zoom around is over another window", () => {
  test("the page moving off the explorer's window: the explorer is on its own again, with no zoom", () => {
    renderProbePage({
      pageRange: WINDOW,
      explorerRange: WINDOW,
      pinExplorer: false,
    });
    expect(read("follows")).toBe("true");

    pageMovesTo(OTHER);

    expect(read("follows")).toBe("false");
    expect(read("explorer-window")).toBe(WINDOW_TEXT);
    expect(read("explorer-zoomed")).toBe("false");
    expect(read("can-zoom-out")).toBe("false");

    // A drag now zooms the explorer alone.
    drag(SLICE_START, SLICE_END);

    expect(explorerSelectSpy).toHaveBeenCalledTimes(1);
    expect(pageChangeSpy).not.toHaveBeenCalled();
    expect(read("page-window")).toBe(OTHER_TEXT);
    expect(read("explorer-zoomed")).toBe("true");
    expect(read("before-zoom")).toBe(WINDOW_TEXT);
  });

  test("a page zoom it followed is not the explorer's to undo once it stops following", () => {
    renderProbePage({
      pageRange: WINDOW,
      explorerRange: WINDOW,
      pinExplorer: false,
    });

    // The explorer follows; the drag zooms the page (the explorer is not pinned).
    drag(SLICE_START, SLICE_END);
    expect(read("page-window")).toBe(SLICE_TEXT);
    expect(read("page-zoomed")).toBe("true");

    // Now the explorer is on a window the page's zoom is not over.
    expect(read("explorer-window")).toBe(WINDOW_TEXT);
    expect(read("follows")).toBe("false");
    expect(read("explorer-zoomed")).toBe("false");
    expect(read("can-zoom-out")).toBe("false");

    act(() => {
      explorer().zoom!.resetZoom();
    });
    expect(read("page-zoomed")).toBe("true");
    expect(read("page-window")).toBe(SLICE_TEXT);
  });

  test("the explorer's own picker moving it off the window: it stops following, and the page keeps its zoom", () => {
    renderFollowingExplorer();
    drag(SLICE_START, SLICE_END);
    expect(read("page-zoomed")).toBe("true");

    act(() => {
      explorer().onTimeRangeChange!({ range: TimeRange.PAST_ONE_DAY });
    });

    expect(explorerChangeSpy).toHaveBeenCalledWith({
      range: TimeRange.PAST_ONE_DAY,
    });
    expect(read("explorer-window")).toBe(TimeRange.PAST_ONE_DAY);
    expect(read("follows")).toBe("false");
    expect(read("explorer-zoomed")).toBe("false");
    // The page's zoom is the page's: a pick in the explorer does not end it.
    expect(read("page-window")).toBe(SLICE_TEXT);
    expect(read("page-zoomed")).toBe("true");
  });

  test("a pinned explorer that stopped following starts again when the page's reset re-pins it", () => {
    renderFollowingExplorer();
    drag(SLICE_START, SLICE_END);
    act(() => {
      explorer().onTimeRangeChange!({ range: TimeRange.PAST_ONE_DAY });
    });
    expect(read("follows")).toBe("false");

    act(() => {
      page().resetZoom();
    });

    expect(read("explorer-window")).toBe(WINDOW_TEXT);
    expect(read("follows")).toBe("true");

    drag(SLICE_START, SLICE_END);
    expect(read("page-window")).toBe(SLICE_TEXT);
    expect(explorerSelectSpy).not.toHaveBeenCalled();
  });

  test("a zoom of the explorer's own is dropped when it starts following, and does not come back when it stops", () => {
    renderProbePage({
      pageRange: OTHER,
      explorerRange: WINDOW,
      pinExplorer: false,
    });

    // The explorer zooms itself to the slice.
    drag(SLICE_START, SLICE_END);
    expect(read("explorer-zoomed")).toBe("true");

    // The page's range comes onto the explorer's window: it follows now.
    pageMovesTo(custom(SLICE_START, SLICE_END));
    expect(read("follows")).toBe("true");
    // The page is not zoomed, so neither is the explorer: its own zoom is gone.
    expect(read("explorer-zoomed")).toBe("false");
    expect(read("can-zoom-out")).toBe("false");

    // And the page moving away again does not bring it back.
    pageMovesTo(OTHER);
    expect(read("follows")).toBe("false");
    expect(read("explorer-zoomed")).toBe("false");
    expect(read("can-zoom-out")).toBe("false");

    act(() => {
      explorer().zoom!.resetZoom();
    });
    expect(explorerChangeSpy).not.toHaveBeenCalled();
    expect(read("explorer-window")).toBe(SLICE_TEXT);
  });
});

/*
 * The telemetry shell (the traces, exceptions and security events
 * explorers) inside a page that zooms. Its host owns the window the way
 * TracesViewer does and, when pinned, follows the page's range the way a
 * snapshot's primary explorer follows the snapshot's window.
 */
interface Item {
  id: string;
}

// An analytics chart a host renders in the histogram's place: it zooms whatever it finds in context.
const StandInAnalyticsChart: FunctionComponent = (): ReactElement => {
  const zoom: ChartTimeRangeZoomContextValue | null = useChartTimeRangeZoom();

  return (
    <div data-testid="analytics-chart">
      <button
        type="button"
        onClick={() => {
          zoom?.onTimeRangeSelect(new Date(SLICE_START), new Date(SLICE_END));
        }}
      >
        Drag on analytics
      </button>
      <button
        type="button"
        onClick={() => {
          zoom?.onTimeRangeReset?.();
        }}
      >
        Double-click analytics
      </button>
    </div>
  );
};

interface ShellExplorerProps {
  pinnedTo: RangeStartAndEndDateTime | null;
  initial: RangeStartAndEndDateTime;
  analytics: boolean;
}

const TelemetryShellExplorer: FunctionComponent<ShellExplorerProps> = (
  props: ShellExplorerProps,
): ReactElement => {
  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(
    props.initial,
  );

  usePinFollow(props.pinnedTo, setTimeRange);

  return (
    <div>
      <span data-testid="explorer-window">{windowOf(timeRange)}</span>
      <TelemetryViewer<Item>
        items={[]}
        isLoading={false}
        renderRow={(item: Item): ReactElement => {
          return <span>{item.id}</span>;
        }}
        getRowKey={(item: Item): string => {
          return item.id;
        }}
        searchValue=""
        onSearchChange={(): void => {}}
        onSearchSubmit={(): void => {}}
        timeRange={timeRange}
        onTimeRangeChange={(next: RangeStartAndEndDateTime): void => {
          explorerChangeSpy(next);
          setTimeRange(next);
        }}
        page={1}
        pageSize={50}
        totalCount={0}
        onPageChange={(): void => {}}
        onPageSizeChange={(): void => {}}
        showHistogram={true}
        histogramBuckets={TELEMETRY_BUCKETS}
        histogramSeries={SERIES}
        histogramBucketIntervalMs={MINUTE_MS}
        onHistogramTimeRangeSelect={(startTime: Date, endTime: Date): void => {
          explorerSelectSpy(startTime, endTime);
          setTimeRange({
            range: TimeRange.CUSTOM,
            startAndEndDate: new InBetween<Date>(startTime, endTime),
          });
        }}
        mainContentOverride={
          props.analytics ? <StandInAnalyticsChart /> : undefined
        }
      />
    </div>
  );
};

// The logs viewer, hosted the way DashboardLogsViewer hosts it.
const LogsShellExplorer: FunctionComponent<ShellExplorerProps> = (
  props: ShellExplorerProps,
): ReactElement => {
  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(
    props.initial,
  );

  usePinFollow(props.pinnedTo, setTimeRange);

  return (
    <div>
      <span data-testid="explorer-window">{windowOf(timeRange)}</span>
      <LogsViewer
        logs={[]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={(): void => {}}
        showFilters={true}
        histogramBuckets={LOGS_BUCKETS}
        histogramLoading={false}
        histogramBucketIntervalMs={MINUTE_MS}
        onHistogramTimeRangeSelect={(startTime: Date, endTime: Date): void => {
          explorerSelectSpy(startTime, endTime);
          setTimeRange({
            range: TimeRange.CUSTOM,
            startAndEndDate: new InBetween<Date>(startTime, endTime),
          });
        }}
        timeRange={timeRange}
        onTimeRangeChange={(next: RangeStartAndEndDateTime): void => {
          explorerChangeSpy(next);
          setTimeRange(next);
        }}
        viewMode={props.analytics ? "analytics" : "list"}
        onViewModeChange={(): void => {}}
      />
    </div>
  );
};

interface ShellCase {
  name: string;
  pickerTestId: string;
  element: (props: ShellExplorerProps) => ReactElement;
}

const SHELLS: Array<ShellCase> = [
  {
    name: "the telemetry shell",
    pickerTestId: "telemetry-time-range-picker-button",
    element: (props: ShellExplorerProps): ReactElement => {
      return <TelemetryShellExplorer {...props} />;
    },
  },
  {
    name: "the logs viewer",
    pickerTestId: "log-time-range-picker-button",
    element: (props: ShellExplorerProps): ReactElement => {
      return <LogsShellExplorer {...props} />;
    },
  },
];

interface ShellPageOptions {
  pageRange: RangeStartAndEndDateTime;
  explorerRange: RangeStartAndEndDateTime;
  pinExplorer: boolean;
  analytics?: boolean | undefined;
}

async function renderShellPage(
  shell: ShellCase,
  options: ShellPageOptions,
): Promise<void> {
  await act(async () => {
    render(
      <ZoomingPage
        initialRange={options.pageRange}
        pinExplorer={options.pinExplorer}
        explorer={(pinnedTo: RangeStartAndEndDateTime | null): ReactElement => {
          return shell.element({
            pinnedTo: pinnedTo,
            initial: options.explorerRange,
            analytics: Boolean(options.analytics),
          });
        }}
      />,
    );
  });

  await waitFor(() => {
    expect(screen.getByTestId(`bucket-${BAR_A}`)).toBeInTheDocument();
  });
}

function dragHistogram(): void {
  fireEvent.mouseDown(screen.getByTestId(`bucket-${BAR_A}`));
  fireEvent.mouseMove(screen.getByTestId(`bucket-${BAR_B}`));
  fireEvent.mouseUp(screen.getByTestId(`bucket-${BAR_B}`));
}

// The element a volume histogram takes its double-click on.
function histogramPlot(): HTMLElement {
  return screen.getByTestId(`bucket-${BAR_A}`).parentElement!.parentElement!
    .parentElement!;
}

function pickerLabel(shell: ShellCase): string {
  return (screen.getByTestId(shell.pickerTestId).textContent || "").trim();
}

function resetButtons(): Array<HTMLElement> {
  return screen.queryAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

function explorerResetButtons(): Array<HTMLElement> {
  return within(screen.getByTestId("explorer")).queryAllByTestId(
    RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
  );
}

function pageResetButton(): HTMLElement {
  return within(screen.getByTestId("page-reset")).getByTestId(
    RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
  );
}

const SLICE_LABEL: string = getTimeRangeButtonLabel(
  custom(SLICE_START, SLICE_END),
);

describe.each(SHELLS)(
  "$name pinned to the window of the zoom around it follows that zoom",
  (shell: ShellCase) => {
    async function renderFollowing(analytics: boolean = false): Promise<void> {
      await renderShellPage(shell, {
        pageRange: WINDOW,
        explorerRange: WINDOW,
        pinExplorer: true,
        analytics: analytics,
      });
    }

    test("a drag on the histogram retimes the page, never the explorer's host, and the explorer follows", async () => {
      await renderFollowing();

      dragHistogram();

      expect(explorerSelectSpy).not.toHaveBeenCalled();
      expect(pageChangeSpy).toHaveBeenCalledTimes(1);
      expect(read("page-window")).toBe(SLICE_TEXT);
      await waitFor(() => {
        expect(read("explorer-window")).toBe(SLICE_TEXT);
      });
      expect(pickerLabel(shell)).toBe(SLICE_LABEL);
    });

    test("the page's Reset zoom is the only one: the explorer's picker offers none", async () => {
      await renderFollowing();

      dragHistogram();
      await waitFor(() => {
        expect(read("explorer-window")).toBe(SLICE_TEXT);
      });

      expect(resetButtons()).toHaveLength(1);
      expect(pageResetButton()).toBeVisible();
      expect(explorerResetButtons()).toHaveLength(0);
    });

    test("the histogram offers the page's double-click once the page is zoomed", async () => {
      await renderFollowing();

      expect(screen.queryByText("Double-click to reset")).toBeNull();

      dragHistogram();

      // The page's zoom, not one of the explorer's own.
      expect(read("page-zoomed")).toBe("true");
      await waitFor(() => {
        expect(screen.getByText("Double-click to reset")).toBeInTheDocument();
      });
    });

    test("a double-click on the histogram resets the page, and the explorer with it", async () => {
      await renderFollowing();
      dragHistogram();
      expect(read("page-zoomed")).toBe("true");
      await waitFor(() => {
        expect(screen.getByText("Double-click to reset")).toBeInTheDocument();
      });

      fireEvent.doubleClick(histogramPlot());

      expect(read("page-window")).toBe(WINDOW_TEXT);
      expect(read("page-zoomed")).toBe("false");
      await waitFor(() => {
        expect(read("explorer-window")).toBe(WINDOW_TEXT);
      });
      expect(explorerChangeSpy).not.toHaveBeenCalled();
      expect(resetButtons()).toHaveLength(0);
      expect(screen.queryByText("Double-click to reset")).toBeNull();
    });

    test("the page's Reset zoom takes the explorer back too", async () => {
      await renderFollowing();
      dragHistogram();
      await waitFor(() => {
        expect(read("explorer-window")).toBe(SLICE_TEXT);
      });

      fireEvent.click(pageResetButton());

      expect(read("page-window")).toBe(WINDOW_TEXT);
      await waitFor(() => {
        expect(read("explorer-window")).toBe(WINDOW_TEXT);
      });
      expect(resetButtons()).toHaveLength(0);
    });

    test("a second drag, then one double-click: back on the window from before both", async () => {
      await renderFollowing();
      dragHistogram();
      await waitFor(() => {
        expect(read("explorer-window")).toBe(SLICE_TEXT);
      });

      // From 10:04 into the 10:05 bar: cut at the end of the slice.
      fireEvent.mouseDown(screen.getByTestId(`bucket-${BAR_B}`));
      fireEvent.mouseMove(screen.getByTestId(`bucket-${BAR_C}`));
      fireEvent.mouseUp(screen.getByTestId(`bucket-${BAR_C}`));

      expect(read("page-window")).toBe(
        "2026-09-28T10:04:00.000Z..2026-09-28T10:05:00.000Z",
      );
      await waitFor(() => {
        expect(read("explorer-window")).toBe(
          "2026-09-28T10:04:00.000Z..2026-09-28T10:05:00.000Z",
        );
      });

      fireEvent.doubleClick(histogramPlot());

      expect(read("page-window")).toBe(WINDOW_TEXT);
      await waitFor(() => {
        expect(read("explorer-window")).toBe(WINDOW_TEXT);
      });
      expect(explorerSelectSpy).not.toHaveBeenCalled();
    });
  },
);

describe.each(SHELLS)(
  "$name under a zoom over another window keeps its own zoom, as before",
  (shell: ShellCase) => {
    async function renderOwn(): Promise<void> {
      await renderShellPage(shell, {
        pageRange: OTHER,
        explorerRange: WINDOW,
        pinExplorer: false,
      });
    }

    test("a drag on the histogram reaches the explorer's host alone", async () => {
      await renderOwn();

      dragHistogram();

      expect(explorerSelectSpy).toHaveBeenCalledTimes(1);
      expect(read("explorer-window")).toBe(SLICE_TEXT);
      expect(pageChangeSpy).not.toHaveBeenCalled();
      expect(read("page-window")).toBe(OTHER_TEXT);
    });

    test("its picker offers its own Reset zoom, which puts its window back", async () => {
      await renderOwn();
      dragHistogram();

      expect(explorerResetButtons()).toHaveLength(1);
      // The page is not zoomed: its button shows nothing.
      expect(resetButtons()).toHaveLength(1);

      fireEvent.click(explorerResetButtons()[0]!);

      expect(explorerChangeSpy).toHaveBeenCalledTimes(1);
      expect(read("explorer-window")).toBe(WINDOW_TEXT);
      expect(pageChangeSpy).not.toHaveBeenCalled();
      expect(resetButtons()).toHaveLength(0);
    });

    test("a double-click on the histogram undoes its own zoom, not the page's", async () => {
      await renderOwn();
      act(() => {
        page().zoomToTimeRange(
          new Date("2026-09-28T08:10:00.000Z"),
          new Date("2026-09-28T08:20:00.000Z"),
        );
      });
      dragHistogram();

      fireEvent.doubleClick(histogramPlot());

      expect(read("explorer-window")).toBe(WINDOW_TEXT);
      expect(read("page-zoomed")).toBe("true");
      expect(read("page-window")).toBe(
        "2026-09-28T08:10:00.000Z..2026-09-28T08:20:00.000Z",
      );
    });

    test("a zoomed page's Reset zoom is not offered in the explorer's picker", async () => {
      await renderOwn();

      act(() => {
        page().zoomToTimeRange(
          new Date("2026-09-28T08:10:00.000Z"),
          new Date("2026-09-28T08:20:00.000Z"),
        );
      });

      expect(pageResetButton()).toBeVisible();
      expect(explorerResetButtons()).toHaveLength(0);
    });
  },
);

describe("the charts a follower renders in the histogram's place share the zoom it follows", () => {
  test("the telemetry shell's analytics content: a drag retimes the page, a double-click resets it", async () => {
    await act(async () => {
      render(
        <ZoomingPage
          initialRange={WINDOW}
          pinExplorer={true}
          explorer={(
            pinnedTo: RangeStartAndEndDateTime | null,
          ): ReactElement => {
            return (
              <TelemetryShellExplorer
                pinnedTo={pinnedTo}
                initial={WINDOW}
                analytics={true}
              />
            );
          }}
        />,
      );
    });

    fireEvent.click(screen.getByText("Drag on analytics"));

    expect(explorerSelectSpy).not.toHaveBeenCalled();
    expect(read("page-window")).toBe(SLICE_TEXT);
    await waitFor(() => {
      expect(read("explorer-window")).toBe(SLICE_TEXT);
    });
    // One way back, the page's.
    expect(resetButtons()).toHaveLength(1);
    expect(explorerResetButtons()).toHaveLength(0);

    fireEvent.click(screen.getByText("Double-click analytics"));

    expect(read("page-window")).toBe(WINDOW_TEXT);
    await waitFor(() => {
      expect(read("explorer-window")).toBe(WINDOW_TEXT);
    });
    expect(explorerChangeSpy).not.toHaveBeenCalled();
  });

  test("the logs viewer's Analytics chart: a drag retimes the page, a double-click resets it", async () => {
    await renderShellPage(SHELLS[1]!, {
      pageRange: WINDOW,
      explorerRange: WINDOW,
      pinExplorer: true,
      analytics: true,
    });
    await waitFor(() => {
      expect(screen.getByTestId(`bucket-${ANALYTICS_A}`)).toBeInTheDocument();
    });

    fireEvent.mouseDown(screen.getByTestId(`bucket-${ANALYTICS_A}`));
    fireEvent.mouseMove(screen.getByTestId(`bucket-${ANALYTICS_B}`));
    fireEvent.mouseUp(screen.getByTestId(`bucket-${ANALYTICS_B}`));

    expect(explorerSelectSpy).not.toHaveBeenCalled();
    expect(pageChangeSpy).toHaveBeenCalledTimes(1);
    expect(read("page-window")).toBe(
      "2026-09-28T10:07:00.000Z..2026-09-28T10:09:00.000Z",
    );
    await waitFor(() => {
      expect(read("explorer-window")).toBe(
        "2026-09-28T10:07:00.000Z..2026-09-28T10:09:00.000Z",
      );
    });
    // One way back, the page's.
    expect(resetButtons()).toHaveLength(1);
    expect(explorerResetButtons()).toHaveLength(0);

    // The chart reloads for the slice before it can be double-clicked.
    await waitFor(() => {
      expect(
        screen.getByTestId(LOGS_ANALYTICS_TIMESERIES_TEST_ID),
      ).toBeInTheDocument();
    });
    fireEvent.doubleClick(
      screen.getByTestId(LOGS_ANALYTICS_TIMESERIES_TEST_ID),
    );

    expect(read("page-window")).toBe(WINDOW_TEXT);
    await waitFor(() => {
      expect(read("explorer-window")).toBe(WINDOW_TEXT);
    });
  });
});
