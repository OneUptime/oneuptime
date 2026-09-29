/** @timezone UTC */
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  chartZoomStandIns,
  doubleClickOn,
  dragAcross,
  resetChartZoomStandIns,
  settle,
  windowKey,
} from "./ChartZoomHarness";

/*
 * Issue #4105 on the Kubernetes network throughput chart - the Insights
 * page's Network card and a node's Metrics tab - which fetches its own
 * points for the window its host hands it.
 *
 * - Every zoom, reset and Refresh reloads it. It used to swap its 300px
 *   chart for a 192px skeleton each time: the chart vanished from under the
 *   pointer that had just dragged on it and everything below moved. The
 *   last chart now stays, on the window it was fetched for, dimmed and
 *   marked "Refreshing" - as MetricView keeps the charts beside it - and
 *   only the first load shows a skeleton, at the chart's height.
 * - A zoom is a Custom window, which the card's Refresh re-resolves to the
 *   same instants, so Refresh never reached the chart while zoomed - not
 *   even to retry a failed load. It now reloads on the card's Refresh.
 *
 * The chart, the Insights page, the node detail page, their cards and the
 * zoom are real. The network fetch is stubbed (one point a minute of the
 * window asked for) and can be held or failed; MetricView and the line
 * chart are stood in for (see ChartZoomHarness).
 */

type NetworkFetch = { start: Date; end: Date; nodeName: string | undefined };

const mockFetchNetworkThroughput: MockFunction = getJestMockFunction();

// While true, the network chart finds no traffic in any window.
let mockNetworkIsQuiet: boolean = false;
// While true, every network fetch fails.
let mockNetworkFails: boolean = false;
// While set, network fetches wait for the test to answer them.
let heldNetworkFetches: Array<{
  request: NetworkFetch;
  release: () => void;
  fail: () => void;
}> | null = null;

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("0193c0de-9999-4aaa-8bbb-000000000009");
      },
      getLastParamAsString: () => {
        return "node-a";
      },
      navigate: () => {
        return undefined;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: () => {
        return Promise.resolve({
          clusterIdentifier: "production-us-east-1",
          name: "Production",
        });
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: () => {
        return "Could not load";
      },
    },
  };
});

// Allocatable CPU for the CPU % transforms: none, which is fine here.
jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: () => {
        return Promise.resolve({ data: [] });
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesObjectFetcher",
  () => {
    return {
      __esModule: true,
      fetchLatestK8sObject: () => {
        return Promise.resolve(null);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/useNodeAllocatableCpu",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesNetworkUtils",
  () => {
    const actual: {
      default: Record<string, unknown>;
    } & Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesNetworkUtils",
    ) as { default: Record<string, unknown> } & Record<string, unknown>;

    return {
      __esModule: true,
      ...actual,
      default: {
        ...actual.default,
        fetchNetworkThroughput: (...args: Array<unknown>) => {
          return mockFetchNetworkThroughput(...args);
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView",
  () => {
    return {
      __esModule: true,
      default: (
        jest.requireActual(
          "./ChartZoomHarness",
        ) as typeof import("./ChartZoomHarness")
      ).StandInMetricView,
    };
  },
);

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual(
        "./ChartZoomHarness",
      ) as typeof import("./ChartZoomHarness")
    ).StandInLineChart,
  };
});

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

// Each card's own picker: shows its range, and can pick "Past 1 Day".
jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (props: {
      dashboardStartAndEndDate: { range: string };
      onChange: (value: { range: string }) => void;
    }) => {
      return (
        <button
          type="button"
          data-testid="card-picker"
          onClick={() => {
            props.onChange({ range: "Past 1 Day" });
          }}
        >
          {props.dashboardStartAndEndDate.range}
        </button>
      );
    },
  };
});

// The node page's other tabs are not what these tests are about.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesOverviewTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="stub-KubernetesOverviewTab" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesEventsTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="stub-KubernetesEventsTab" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesYamlTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="stub-KubernetesYamlTab" />;
      },
    };
  },
);

import KubernetesNetworkThroughputChart, {
  NETWORK_THROUGHPUT_REFETCHING_TEST_ID,
  NETWORK_THROUGHPUT_SKELETON_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/KubernetesNetworkThroughputChart";
import KubernetesClusterInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Insights";
import NodeDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/NodeDetail";
import { EmbeddedMetricCardRefreshContext } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCardRefresh";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { TimeRangeZoomProvider } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import TimeRange from "../../../Types/Time/TimeRange";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const MINUTE_MS: number = 60 * 1000;

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const ONE_HOUR_AGO: Date = new Date("2026-09-28T11:00:00.000Z");

const DRAG_START: Date = new Date("2026-09-28T11:20:00.000Z");
const DRAG_END: Date = new Date("2026-09-28T11:30:00.000Z");

const PAST_HOUR_WINDOW: string = windowKey(ONE_HOUR_AGO, NOW);
const DRAG_WINDOW: string = windowKey(DRAG_START, DRAG_END);

const NO_TRAFFIC: string =
  "No network traffic reported for the selected time range.";
const COULD_NOT_REFRESH: string =
  "Couldn't refresh — showing previously loaded data.";

function networkFetches(): Array<NetworkFetch> {
  return mockFetchNetworkThroughput.mock.calls.map(
    (call: Array<unknown>): NetworkFetch => {
      const params: { startDate: Date; endDate: Date; nodeName?: string } =
        call[0] as { startDate: Date; endDate: Date; nodeName?: string };
      return {
        start: params.startDate,
        end: params.endDate,
        nodeName: params.nodeName,
      };
    },
  );
}

function networkWindows(): Array<string> {
  return networkFetches().map((fetch: NetworkFetch): string => {
    return windowKey(fetch.start, fetch.end);
  });
}

function pointsFor(request: NetworkFetch): {
  receive: Array<{ x: Date; y: number }>;
  transmit: Array<{ x: Date; y: number }>;
} {
  if (mockNetworkIsQuiet) {
    return { receive: [], transmit: [] };
  }

  const points: Array<{ x: Date; y: number }> = [];
  for (
    let time: number = request.start.getTime();
    time < request.end.getTime();
    time += MINUTE_MS
  ) {
    points.push({ x: new Date(time), y: 1000 });
  }

  return { receive: points, transmit: points };
}

// The last window the stand-in line chart was drawn over.
function drawnWindow(): string {
  return screen.getByTestId("line-chart").getAttribute("data-window") || "";
}

function releaseHeld(): void {
  const held: Array<{ release: () => void }> = heldNetworkFetches || [];
  heldNetworkFetches = null;
  for (const fetch of held) {
    fetch.release();
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  resetChartZoomStandIns();
  mockNetworkIsQuiet = false;
  mockNetworkFails = false;
  heldNetworkFetches = null;

  mockFetchNetworkThroughput.mockReset();
  mockFetchNetworkThroughput.mockImplementation((params: unknown) => {
    const raw: { startDate: Date; endDate: Date; nodeName?: string } =
      params as { startDate: Date; endDate: Date; nodeName?: string };
    const request: NetworkFetch = {
      start: raw.startDate,
      end: raw.endDate,
      nodeName: raw.nodeName,
    };

    if (mockNetworkFails) {
      return Promise.reject(new Error("503 Service Unavailable"));
    }

    if (!heldNetworkFetches) {
      return Promise.resolve(pointsFor(request));
    }

    const held: Array<{
      request: NetworkFetch;
      release: () => void;
      fail: () => void;
    }> = heldNetworkFetches;

    return new Promise(
      (
        resolve: (value: ReturnType<typeof pointsFor>) => void,
        reject: (reason: Error) => void,
      ) => {
        held.push({
          request: request,
          release: () => {
            resolve(pointsFor(request));
          },
          fail: () => {
            reject(new Error("503 Service Unavailable"));
          },
        });
      },
    );
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("KubernetesNetworkThroughputChart: what it shows while it loads", () => {
  interface HostProps {
    start?: Date | undefined;
    end?: Date | undefined;
    nodeName?: string | undefined;
    refreshNonce?: number | undefined;
    isZoomed?: boolean | undefined;
    heightInPx?: number | undefined;
    resetZoom?: (() => void) | undefined;
  }

  function zoomOf(props: HostProps): TimeRangeZoom {
    return {
      isZoomed: Boolean(props.isZoomed),
      rangeBeforeZoom: props.isZoomed
        ? { range: TimeRange.PAST_ONE_HOUR }
        : null,
      zoomToTimeRange: () => {},
      resetZoom:
        props.resetZoom ||
        (() => {
          return undefined;
        }),
    };
  }

  function host(props: HostProps = {}): React.ReactElement {
    return (
      <EmbeddedMetricCardRefreshContext.Provider
        value={props.refreshNonce || 0}
      >
        <TimeRangeZoomProvider zoom={zoomOf(props)}>
          <KubernetesNetworkThroughputChart
            clusterIdentifier="production-us-east-1"
            nodeName={props.nodeName}
            startDate={props.start || ONE_HOUR_AGO}
            endDate={props.end || NOW}
            heightInPx={props.heightInPx}
          />
        </TimeRangeZoomProvider>
      </EmbeddedMetricCardRefreshContext.Provider>
    );
  }

  test("the first load is a skeleton the chart's own height - 300px unless told otherwise", async () => {
    heldNetworkFetches = [];
    const { rerender } = render(host());

    expect(screen.getByTestId(NETWORK_THROUGHPUT_SKELETON_TEST_ID)).toHaveStyle(
      { height: "300px" },
    );
    expect(screen.queryByTestId("line-chart")).toBeNull();

    rerender(host({ heightInPx: 180 }));
    expect(screen.getByTestId(NETWORK_THROUGHPUT_SKELETON_TEST_ID)).toHaveStyle(
      { height: "180px" },
    );

    releaseHeld();
    await settle();

    expect(
      screen.queryByTestId(NETWORK_THROUGHPUT_SKELETON_TEST_ID),
    ).toBeNull();
    expect(drawnWindow()).toBe(PAST_HOUR_WINDOW);
    expect(
      screen.queryByTestId(NETWORK_THROUGHPUT_REFETCHING_TEST_ID),
    ).toBeNull();
  });

  test("a new window keeps the last chart on screen, on the window it was fetched for, until the new points land", async () => {
    const { rerender } = render(host());
    await settle();
    const chartBefore: HTMLElement = screen.getByTestId("line-chart");

    heldNetworkFetches = [];
    rerender(host({ start: DRAG_START, end: DRAG_END, isZoomed: true }));
    await settle();

    // Still the past hour's chart, drawn over the past hour, marked as loading.
    expect(networkWindows().slice(-1)).toEqual([DRAG_WINDOW]);
    expect(
      screen.queryByTestId(NETWORK_THROUGHPUT_SKELETON_TEST_ID),
    ).toBeNull();
    expect(drawnWindow()).toBe(PAST_HOUR_WINDOW);
    expect(
      screen.getByTestId(NETWORK_THROUGHPUT_REFETCHING_TEST_ID),
    ).toHaveTextContent("Refreshing");
    expect(
      screen.getByTestId("line-chart").closest('[aria-busy="true"]'),
    ).not.toBe(null);

    releaseHeld();
    await settle();

    expect(drawnWindow()).toBe(DRAG_WINDOW);
    expect(
      screen.queryByTestId(NETWORK_THROUGHPUT_REFETCHING_TEST_ID),
    ).toBeNull();
    // The same chart all along: a reload does not remount it.
    expect(screen.getByTestId("line-chart")).toBe(chartBefore);
  });

  test("the card's Refresh reloads the very same window, keeping the chart meanwhile", async () => {
    const { rerender } = render(host({ start: DRAG_START, end: DRAG_END }));
    await settle();
    expect(networkWindows()).toEqual([DRAG_WINDOW]);

    heldNetworkFetches = [];
    rerender(host({ start: DRAG_START, end: DRAG_END, refreshNonce: 1 }));
    await settle();

    expect(networkWindows()).toEqual([DRAG_WINDOW, DRAG_WINDOW]);
    expect(drawnWindow()).toBe(DRAG_WINDOW);
    expect(
      screen.getByTestId(NETWORK_THROUGHPUT_REFETCHING_TEST_ID),
    ).toBeInTheDocument();

    releaseHeld();
    await settle();
    expect(
      screen.queryByTestId(NETWORK_THROUGHPUT_REFETCHING_TEST_ID),
    ).toBeNull();
  });

  test("a new window with the same instants does not reload; only the card's Refresh does", async () => {
    const { rerender } = render(host({ start: DRAG_START, end: DRAG_END }));
    await settle();

    rerender(host({ start: new Date(DRAG_START), end: new Date(DRAG_END) }));
    await settle();
    expect(networkWindows()).toHaveLength(1);

    rerender(
      host({
        start: new Date(DRAG_START),
        end: new Date(DRAG_END),
        refreshNonce: 1,
      }),
    );
    await settle();
    expect(networkWindows()).toHaveLength(2);
  });

  test("a failed reload keeps the last chart, says it could not refresh, and the next Refresh clears it", async () => {
    const { rerender } = render(host());
    await settle();

    mockNetworkFails = true;
    rerender(host({ refreshNonce: 1 }));
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent(COULD_NOT_REFRESH);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load");
    expect(drawnWindow()).toBe(PAST_HOUR_WINDOW);
    expect(
      screen.queryByTestId(NETWORK_THROUGHPUT_REFETCHING_TEST_ID),
    ).toBeNull();

    // A retry in flight keeps the alert: no blink out and back.
    mockNetworkFails = false;
    heldNetworkFetches = [];
    rerender(host({ refreshNonce: 2 }));
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(COULD_NOT_REFRESH);
    expect(
      screen.getByTestId(NETWORK_THROUGHPUT_REFETCHING_TEST_ID),
    ).toBeInTheDocument();

    releaseHeld();
    await settle();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(drawnWindow()).toBe(PAST_HOUR_WINDOW);
  });

  test("a failed first load shows the error; while zoomed a double-click on it resets, and it is not selectable", async () => {
    mockNetworkFails = true;
    const resetZoom: MockFunction = getJestMockFunction();
    const { rerender } = render(
      host({ resetZoom: resetZoom as unknown as () => void }),
    );
    await settle();

    const message: HTMLElement = screen.getByText("Could not load");
    expect(message.closest(".select-none")).not.toBe(null);
    expect(screen.queryByTestId("line-chart")).toBeNull();

    // Not zoomed: the double-click has nothing to undo.
    fireEvent.doubleClick(message);
    expect(resetZoom).not.toHaveBeenCalled();

    rerender(
      host({ isZoomed: true, resetZoom: resetZoom as unknown as () => void }),
    );
    fireEvent.doubleClick(screen.getByText("Could not load"));
    expect(resetZoom).toHaveBeenCalledTimes(1);
  });

  test("a retry after a failed first load is a skeleton, then the chart", async () => {
    mockNetworkFails = true;
    const { rerender } = render(host());
    await settle();
    expect(screen.getByText("Could not load")).toBeInTheDocument();

    mockNetworkFails = false;
    heldNetworkFetches = [];
    rerender(host({ refreshNonce: 1 }));
    await settle();

    expect(
      screen.getByTestId(NETWORK_THROUGHPUT_SKELETON_TEST_ID),
    ).toBeInTheDocument();
    expect(screen.queryByText("Could not load")).toBeNull();

    releaseHeld();
    await settle();
    expect(drawnWindow()).toBe(PAST_HOUR_WINDOW);
  });

  test("a quiet window keeps the chart's height, is not selectable, and takes the reset double-click only while zoomed", async () => {
    mockNetworkIsQuiet = true;
    const resetZoom: MockFunction = getJestMockFunction();
    const { rerender } = render(
      host({ heightInPx: 240, resetZoom: resetZoom as unknown as () => void }),
    );
    await settle();

    const empty: HTMLElement = screen.getByText(NO_TRAFFIC);
    expect(empty).toHaveStyle({ height: "240px" });
    expect(empty).toHaveClass("select-none");

    fireEvent.doubleClick(empty);
    expect(resetZoom).not.toHaveBeenCalled();

    rerender(
      host({
        heightInPx: 240,
        isZoomed: true,
        resetZoom: resetZoom as unknown as () => void,
      }),
    );
    fireEvent.doubleClick(screen.getByText(NO_TRAFFIC));
    expect(resetZoom).toHaveBeenCalledTimes(1);
  });

  test("another node starts over from the skeleton rather than show the last node's traffic", async () => {
    const { rerender } = render(host({ nodeName: "node-a" }));
    await settle();
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();

    heldNetworkFetches = [];
    rerender(host({ nodeName: "node-b" }));
    await settle();

    expect(screen.queryByTestId("line-chart")).toBeNull();
    expect(
      screen.getByTestId(NETWORK_THROUGHPUT_SKELETON_TEST_ID),
    ).toBeInTheDocument();
    expect(networkFetches().slice(-1)[0]?.nodeName).toBe("node-b");

    releaseHeld();
    await settle();
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  });

  test("an answer for a window the chart has moved on from is not drawn", async () => {
    const { rerender } = render(host());
    await settle();

    heldNetworkFetches = [];
    rerender(host({ start: DRAG_START, end: DRAG_END }));
    await settle();
    const zoomFetch: Array<{ release: () => void }> = heldNetworkFetches;
    heldNetworkFetches = null;

    // Back to the past hour before the zoom's answer arrives.
    rerender(host());
    await settle();
    expect(drawnWindow()).toBe(PAST_HOUR_WINDOW);

    for (const fetch of zoomFetch) {
      fetch.release();
    }
    await settle();

    expect(drawnWindow()).toBe(PAST_HOUR_WINDOW);
    expect(
      screen.queryByTestId(NETWORK_THROUGHPUT_REFETCHING_TEST_ID),
    ).toBeNull();
  });
});

describe("cluster Insights: the Network card", () => {
  async function renderInsights(): Promise<void> {
    render(<KubernetesClusterInsights {...PAGE_PROPS} />);
    await settle();
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  }

  // The card whose title (a section title span) reads `title`.
  function card(title: string): HTMLElement {
    const found: HTMLElement | null = screen
      .getByText(title, { selector: "span" })
      .closest('[data-testid="card"]');

    if (!found) {
      throw new Error(`No card titled "${title}"`);
    }

    return found as HTMLElement;
  }

  function refreshOf(title: string): HTMLElement {
    return within(card(title)).getByRole("button", { name: "Refresh" });
  }

  test("while zoomed, the Network card's Refresh reloads the chart for the zoomed window", async () => {
    await renderInsights();
    await dragAcross(card("Network"), DRAG_START, DRAG_END);
    expect(networkWindows().slice(-1)).toEqual([DRAG_WINDOW]);

    const fetchesBefore: number = networkFetches().length;
    jest.setSystemTime(new Date(NOW.getTime() + MINUTE_MS));
    fireEvent.click(refreshOf("Network"));
    await settle();

    expect(networkFetches()).toHaveLength(fetchesBefore + 1);
    expect(networkWindows().slice(-1)).toEqual([DRAG_WINDOW]);
    expect(
      within(card("Network")).getByTestId("card-picker"),
    ).toHaveTextContent(TimeRange.CUSTOM);
  });

  test("while zoomed, Refresh retries a failed load", async () => {
    await renderInsights();

    mockNetworkFails = true;
    await dragAcross(card("Network"), DRAG_START, DRAG_END);
    expect(within(card("Network")).getByRole("alert")).toHaveTextContent(
      COULD_NOT_REFRESH,
    );

    mockNetworkFails = false;
    fireEvent.click(refreshOf("Network"));
    await settle();

    expect(within(card("Network")).queryByRole("alert")).toBeNull();
    expect(
      within(card("Network"))
        .getByTestId("line-chart")
        .getAttribute("data-window"),
    ).toBe(DRAG_WINDOW);
  });

  test("on the past hour, Refresh re-resolves the hour and reloads the chart once - not twice", async () => {
    await renderInsights();

    const fetchesBefore: number = networkFetches().length;
    const later: Date = new Date(NOW.getTime() + MINUTE_MS);
    jest.setSystemTime(later);
    fireEvent.click(refreshOf("Network"));
    await settle();

    expect(networkFetches()).toHaveLength(fetchesBefore + 1);
    expect(networkWindows().slice(-1)).toEqual([
      windowKey(new Date(later.getTime() - 60 * MINUTE_MS), later),
    ]);
  });

  test("a zoom keeps the network chart on screen, over the past hour, until the zoomed window's points land", async () => {
    await renderInsights();
    const chartBefore: HTMLElement = within(card("Network")).getByTestId(
      "line-chart",
    );

    heldNetworkFetches = [];
    await dragAcross(card("Network"), DRAG_START, DRAG_END);

    expect(within(card("Network")).getByTestId("line-chart")).toBe(chartBefore);
    expect(chartBefore.getAttribute("data-window")).toBe(PAST_HOUR_WINDOW);
    expect(
      within(card("Network")).getByTestId(
        NETWORK_THROUGHPUT_REFETCHING_TEST_ID,
      ),
    ).toBeInTheDocument();
    // The zoom took: every card's picker is on it already.
    expect(
      within(card("Network")).getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();

    releaseHeld();
    await settle();

    expect(chartBefore.getAttribute("data-window")).toBe(DRAG_WINDOW);
  });

  test("a double-click on the chart it kept on screen resets the zoom, as on any chart", async () => {
    await renderInsights();
    await dragAcross(card("Network"), DRAG_START, DRAG_END);

    heldNetworkFetches = [];
    await doubleClickOn(card("Network"));

    expect(networkWindows().slice(-1)).toEqual([PAST_HOUR_WINDOW]);
    // Still the zoomed chart until the past hour's points land.
    expect(
      within(card("Network"))
        .getByTestId("line-chart")
        .getAttribute("data-window"),
    ).toBe(DRAG_WINDOW);

    releaseHeld();
    await settle();
    expect(
      within(card("Network"))
        .getByTestId("line-chart")
        .getAttribute("data-window"),
    ).toBe(PAST_HOUR_WINDOW);
  });
});

describe("a node's Metrics tab: the network chart", () => {
  async function openNodeMetricsTab(): Promise<void> {
    render(<NodeDetailPage {...PAGE_PROPS} />);
    await settle();
    fireEvent.click(screen.getByRole("tab", { name: "Metrics" }));
    await settle();
    expect(screen.getByTestId("metric-view")).toBeInTheDocument();
  }

  // The node's network chart, with the header row above it.
  function networkSection(): HTMLElement {
    const section: HTMLElement | null = screen
      .getByText("Network Throughput")
      .closest('[class~="group/zoomhint"]');

    if (!section) {
      throw new Error("No Network Throughput section");
    }

    return section as HTMLElement;
  }

  test("while zoomed, the tab's Refresh reloads the node's traffic for the zoomed window", async () => {
    await openNodeMetricsTab();
    await dragAcross(networkSection(), DRAG_START, DRAG_END);
    expect(networkWindows().slice(-1)).toEqual([DRAG_WINDOW]);

    const fetchesBefore: number = networkFetches().length;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await settle();

    expect(networkFetches()).toHaveLength(fetchesBefore + 1);
    expect(networkFetches().slice(-1)[0]).toEqual({
      start: DRAG_START,
      end: DRAG_END,
      nodeName: "node-a",
    });
    expect(chartZoomStandIns.metricViews.slice(-1)[0]?.window).toBe(
      DRAG_WINDOW,
    );
  });

  test("a zoom keeps the node's chart on screen until the zoomed window's points land", async () => {
    await openNodeMetricsTab();
    const chartBefore: HTMLElement =
      within(networkSection()).getByTestId("line-chart");

    heldNetworkFetches = [];
    await dragAcross(networkSection(), DRAG_START, DRAG_END);

    expect(within(networkSection()).getByTestId("line-chart")).toBe(
      chartBefore,
    );
    expect(chartBefore.getAttribute("data-window")).toBe(PAST_HOUR_WINDOW);

    releaseHeld();
    await settle();
    expect(chartBefore.getAttribute("data-window")).toBe(DRAG_WINDOW);
  });
});
