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
  MetricViewRecord,
  resetChartZoomStandIns,
  settle,
  windowKey,
  windowOf,
} from "./ChartZoomHarness";

/*
 * Issue #4105 on the Kubernetes cluster pages built from several metric
 * cards over ONE page range: Insights (three cards, one of them the network
 * throughput chart), Control Plane (a card per tab, six tabs) and Service
 * Mesh (two or three cards per tab). A drag on any chart must narrow every
 * card on the page - on every tab - and a double-click on any chart, in any
 * card, must put the page back on the range from before the first zoom.
 * Before, a card could narrow the page but only the card that zoomed could
 * have undone it, and nothing could.
 *
 * The pages and their EmbeddedMetricCards are real. MetricView and the line
 * chart are stood in for (see ChartZoomHarness); the card's range picker is
 * reduced to a button showing its range; the network chart's data fetch is
 * stubbed and records the window it asks for.
 */

type NetworkFetch = { start: Date; end: Date; nodeName: string | undefined };

const mockFetchNetworkThroughput: MockFunction = getJestMockFunction();

// While true, the network chart finds no traffic in any window.
let mockNetworkIsQuiet: boolean = false;

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
        return Promise.resolve({ clusterIdentifier: "production-us-east-1" });
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

import KubernetesClusterInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Insights";
import KubernetesClusterControlPlane from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/ControlPlane";
import KubernetesClusterServiceMesh from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/ServiceMesh";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { TIME_RANGE_ZOOM_HINT_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import TimeRange from "../../../Types/Time/TimeRange";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const MINUTE_MS: number = 60 * 1000;

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const ONE_HOUR_AGO: Date = new Date("2026-09-28T11:00:00.000Z");

const DRAG_START: Date = new Date("2026-09-28T11:20:00.000Z");
const DRAG_END: Date = new Date("2026-09-28T11:30:00.000Z");
const NESTED_DRAG_START: Date = new Date("2026-09-28T11:22:00.000Z");
const NESTED_DRAG_END: Date = new Date("2026-09-28T11:25:00.000Z");

const PAST_HOUR_WINDOW: string = windowKey(ONE_HOUR_AGO, NOW);
const DRAG_WINDOW: string = windowKey(DRAG_START, DRAG_END);
const NESTED_DRAG_WINDOW: string = windowKey(
  NESTED_DRAG_START,
  NESTED_DRAG_END,
);

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

function latestNetworkWindow(): string {
  const fetches: Array<NetworkFetch> = networkFetches();
  const latest: NetworkFetch | undefined = fetches[fetches.length - 1];

  if (!latest) {
    throw new Error("The network chart has not fetched");
  }

  return windowKey(latest.start, latest.end);
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

function pickerOf(cardElement: HTMLElement): string {
  return within(cardElement).getByTestId("card-picker").textContent || "";
}

function resetButtons(): Array<HTMLElement> {
  return screen.queryAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

function latestMetricViewsWithReset(): Array<MetricViewRecord> {
  return chartZoomStandIns.metricViews.slice(-2);
}

async function openTab(name: string): Promise<void> {
  fireEvent.click(screen.getByRole("tab", { name: name }));
  await settle();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  resetChartZoomStandIns();
  mockNetworkIsQuiet = false;

  mockFetchNetworkThroughput.mockReset();
  mockFetchNetworkThroughput.mockImplementation((params: unknown) => {
    const request: { startDate: Date; endDate: Date } = params as {
      startDate: Date;
      endDate: Date;
    };

    if (mockNetworkIsQuiet) {
      return Promise.resolve({ receive: [], transmit: [] });
    }

    const points: Array<{ x: Date; y: number }> = [];
    for (
      let time: number = request.startDate.getTime();
      time < request.endDate.getTime();
      time += MINUTE_MS
    ) {
      points.push({ x: new Date(time), y: 1000 });
    }

    return Promise.resolve({ receive: points, transmit: points });
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("cluster Insights: three cards, one zoom", () => {
  const COMPUTE: string = "Compute & Storage";
  const NETWORK: string = "Network";
  const PODS: string = "Pods";

  async function renderInsights(): Promise<void> {
    render(<KubernetesClusterInsights {...PAGE_PROPS} />);
    await settle();
    expect(screen.getAllByTestId("metric-view")).toHaveLength(2);
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  }

  function allWindows(): Array<string> {
    return [
      windowOf(card(COMPUTE)),
      windowOf(card(NETWORK)),
      windowOf(card(PODS)),
    ];
  }

  function allPickers(): Array<string> {
    return [
      pickerOf(card(COMPUTE)),
      pickerOf(card(NETWORK)),
      pickerOf(card(PODS)),
    ];
  }

  test("opens on the past hour everywhere", async () => {
    await renderInsights();

    expect(allWindows()).toEqual([
      PAST_HOUR_WINDOW,
      PAST_HOUR_WINDOW,
      PAST_HOUR_WINDOW,
    ]);
    expect(latestNetworkWindow()).toBe(PAST_HOUR_WINDOW);
    expect(allPickers()).toEqual([
      TimeRange.PAST_ONE_HOUR,
      TimeRange.PAST_ONE_HOUR,
      TimeRange.PAST_ONE_HOUR,
    ]);
    expect(resetButtons()).toHaveLength(0);
  });

  test("both metric cards and the network chart are handed the same zoom: the page's", async () => {
    await renderInsights();

    const metricSelects: Set<unknown> = new Set(
      chartZoomStandIns.metricViews.map((view: MetricViewRecord): unknown => {
        return view.select;
      }),
    );
    const lineSelects: Set<unknown> = new Set(
      chartZoomStandIns.lineCharts.map(
        (chart: { select: unknown }): unknown => {
          return chart.select;
        },
      ),
    );

    expect(metricSelects.size).toBe(1);
    expect(lineSelects.size).toBe(1);
    expect([...metricSelects][0]).toBeInstanceOf(Function);
    expect([...lineSelects][0]).toBe([...metricSelects][0]);

    // The network chart is handed nothing: it takes the page's zoom.
    for (const chart of chartZoomStandIns.lineCharts) {
      expect(chart.hostSelect).toBeUndefined();
      expect(chart.hostReset).toBeUndefined();
    }
  });

  test("a drag on the network chart narrows all three cards and refetches the network data for the window", async () => {
    await renderInsights();

    await dragAcross(card(NETWORK), DRAG_START, DRAG_END);

    expect(allWindows()).toEqual([DRAG_WINDOW, DRAG_WINDOW, DRAG_WINDOW]);
    expect(latestNetworkWindow()).toBe(DRAG_WINDOW);
    expect(allPickers()).toEqual([
      TimeRange.CUSTOM,
      TimeRange.CUSTOM,
      TimeRange.CUSTOM,
    ]);
  });

  test("while zoomed, every card offers Reset zoom and every chart a double-click reset", async () => {
    await renderInsights();

    await dragAcross(card(COMPUTE), DRAG_START, DRAG_END);

    expect(resetButtons()).toHaveLength(3);
    for (const title of [COMPUTE, NETWORK, PODS]) {
      expect(
        within(card(title)).getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      ).toBeVisible();
    }
    for (const view of latestMetricViewsWithReset()) {
      expect(view.reset).toBeInstanceOf(Function);
    }
  });

  test("a double-click on the Pods chart undoes a zoom made on the network chart - all three cards go back", async () => {
    await renderInsights();

    await dragAcross(card(NETWORK), DRAG_START, DRAG_END);
    await doubleClickOn(card(PODS));

    expect(allWindows()).toEqual([
      PAST_HOUR_WINDOW,
      PAST_HOUR_WINDOW,
      PAST_HOUR_WINDOW,
    ]);
    expect(latestNetworkWindow()).toBe(PAST_HOUR_WINDOW);
    expect(allPickers()).toEqual([
      TimeRange.PAST_ONE_HOUR,
      TimeRange.PAST_ONE_HOUR,
      TimeRange.PAST_ONE_HOUR,
    ]);
    expect(resetButtons()).toHaveLength(0);
  });

  test("a double-click on the network chart undoes a zoom made on the Compute & Storage chart", async () => {
    await renderInsights();

    await dragAcross(card(COMPUTE), DRAG_START, DRAG_END);
    expect(latestNetworkWindow()).toBe(DRAG_WINDOW);

    await doubleClickOn(card(NETWORK));

    expect(allWindows()).toEqual([
      PAST_HOUR_WINDOW,
      PAST_HOUR_WINDOW,
      PAST_HOUR_WINDOW,
    ]);
  });

  test("Reset zoom beside any card's picker resets the whole page", async () => {
    await renderInsights();

    await dragAcross(card(PODS), DRAG_START, DRAG_END);
    fireEvent.click(
      within(card(NETWORK)).getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    );
    await settle();

    expect(allWindows()).toEqual([
      PAST_HOUR_WINDOW,
      PAST_HOUR_WINDOW,
      PAST_HOUR_WINDOW,
    ]);
    expect(resetButtons()).toHaveLength(0);
  });

  test("zooming twice and resetting once goes all the way back to the past hour", async () => {
    await renderInsights();

    await dragAcross(card(COMPUTE), DRAG_START, DRAG_END);
    await dragAcross(card(NETWORK), NESTED_DRAG_START, NESTED_DRAG_END);

    expect(allWindows()).toEqual([
      NESTED_DRAG_WINDOW,
      NESTED_DRAG_WINDOW,
      NESTED_DRAG_WINDOW,
    ]);

    await doubleClickOn(card(PODS));

    expect(allWindows()).toEqual([
      PAST_HOUR_WINDOW,
      PAST_HOUR_WINDOW,
      PAST_HOUR_WINDOW,
    ]);
  });

  test("picking a range in a card's picker ends the zoom for every card", async () => {
    await renderInsights();

    await dragAcross(card(COMPUTE), DRAG_START, DRAG_END);
    expect(resetButtons()).toHaveLength(3);

    fireEvent.click(within(card(PODS)).getByTestId("card-picker"));
    await settle();

    const oneDayAgo: Date = new Date(NOW.getTime() - 24 * 60 * MINUTE_MS);

    expect(allPickers()).toEqual([
      TimeRange.PAST_ONE_DAY,
      TimeRange.PAST_ONE_DAY,
      TimeRange.PAST_ONE_DAY,
    ]);
    expect(allWindows()).toEqual([
      windowKey(oneDayAgo, NOW),
      windowKey(oneDayAgo, NOW),
      windowKey(oneDayAgo, NOW),
    ]);
    expect(resetButtons()).toHaveLength(0);
    for (const view of latestMetricViewsWithReset()) {
      expect(view.reset).toBeUndefined();
    }
  });

  test("the network chart names the drag on hover, above the chart", async () => {
    await renderInsights();

    const hint: HTMLElement = within(card(NETWORK)).getByTestId(
      TIME_RANGE_ZOOM_HINT_TEST_ID,
    );

    expect(hint).toHaveTextContent("Drag to zoom");
    expect(hint).toHaveClass("group-hover/zoomhint:opacity-100");
    expect(hint.closest('[class~="group/zoomhint"]')).toBe(
      within(card(NETWORK))
        .getByTestId("line-chart")
        .closest('[class~="group/zoomhint"]'),
    );

    await dragAcross(card(NETWORK), DRAG_START, DRAG_END);

    expect(
      within(card(NETWORK)).getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID),
    ).toHaveTextContent("Double-click to reset");
  });

  test("a zoom into a stretch with no traffic can be undone by double-clicking the empty chart", async () => {
    await renderInsights();

    mockNetworkIsQuiet = true;
    await dragAcross(card(NETWORK), DRAG_START, DRAG_END);

    const empty: HTMLElement = within(card(NETWORK)).getByText(
      "No network traffic reported for the selected time range.",
    );

    fireEvent.doubleClick(empty);
    await settle();

    expect(allPickers()).toEqual([
      TimeRange.PAST_ONE_HOUR,
      TimeRange.PAST_ONE_HOUR,
      TimeRange.PAST_ONE_HOUR,
    ]);
    expect(latestNetworkWindow()).toBe(PAST_HOUR_WINDOW);
  });

  test("the empty network chart ignores a double-click when there is no zoom to undo", async () => {
    mockNetworkIsQuiet = true;
    render(<KubernetesClusterInsights {...PAGE_PROPS} />);
    await settle();

    const fetchesBefore: number = networkFetches().length;

    fireEvent.doubleClick(
      within(card(NETWORK)).getByText(
        "No network traffic reported for the selected time range.",
      ),
    );
    await settle();

    expect(networkFetches()).toHaveLength(fetchesBefore);
    expect(pickerOf(card(NETWORK))).toBe(TimeRange.PAST_ONE_HOUR);
  });
});

describe("cluster Control Plane: one zoom across every tab", () => {
  const TABS: Array<[string, string]> = [
    ["etcd", "etcd"],
    ["API Server", "API Server"],
    ["Scheduler", "Scheduler"],
    ["Controller Manager", "Controller Manager"],
    ["CoreDNS", "CoreDNS"],
    ["kube-proxy", "kube-proxy"],
  ];

  async function renderControlPlane(): Promise<void> {
    render(<KubernetesClusterControlPlane {...PAGE_PROPS} />);
    await settle();
    expect(screen.getAllByTestId("metric-view")).toHaveLength(1);
  }

  test("a zoom made on the etcd tab carries over to the API Server tab, and a double-click there undoes it", async () => {
    await renderControlPlane();

    await dragAcross(card("etcd"), DRAG_START, DRAG_END);
    expect(windowOf(card("etcd"))).toBe(DRAG_WINDOW);

    await openTab("API Server");

    const apiServer: HTMLElement = card("API Server");

    expect(windowOf(apiServer)).toBe(DRAG_WINDOW);
    expect(pickerOf(apiServer)).toBe(TimeRange.CUSTOM);
    expect(
      within(apiServer).getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();

    await doubleClickOn(apiServer);

    expect(windowOf(card("API Server"))).toBe(PAST_HOUR_WINDOW);
    expect(resetButtons()).toHaveLength(0);

    await openTab("etcd");

    expect(windowOf(card("etcd"))).toBe(PAST_HOUR_WINDOW);
    expect(pickerOf(card("etcd"))).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test.each(TABS)(
    "the %s tab zooms on a drag and resets on a double-click",
    async (tabName: string, cardTitle: string) => {
      await renderControlPlane();
      await openTab(tabName);

      await dragAcross(card(cardTitle), DRAG_START, DRAG_END);

      expect(windowOf(card(cardTitle))).toBe(DRAG_WINDOW);
      expect(pickerOf(card(cardTitle))).toBe(TimeRange.CUSTOM);

      await doubleClickOn(card(cardTitle));

      expect(windowOf(card(cardTitle))).toBe(PAST_HOUR_WINDOW);
      expect(pickerOf(card(cardTitle))).toBe(TimeRange.PAST_ONE_HOUR);
    },
  );

  test("Reset zoom in the card's header resets the page", async () => {
    await renderControlPlane();
    await openTab("CoreDNS");

    await dragAcross(card("CoreDNS"), DRAG_START, DRAG_END);
    fireEvent.click(
      within(card("CoreDNS")).getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    );
    await settle();

    expect(windowOf(card("CoreDNS"))).toBe(PAST_HOUR_WINDOW);
  });
});

describe("cluster Service Mesh: the cards of a tab zoom together", () => {
  const DATA_PLANE_EBPF: string = "Data Plane — eBPF";
  const AGENT: string = "Control Plane — Agent";
  const HUBBLE: string = "Hubble — Observability";

  async function renderServiceMesh(): Promise<void> {
    render(<KubernetesClusterServiceMesh {...PAGE_PROPS} />);
    await settle();
    expect(screen.getAllByTestId("metric-view")).toHaveLength(3);
  }

  function ciliumWindows(): Array<string> {
    return [DATA_PLANE_EBPF, AGENT, HUBBLE].map((title: string): string => {
      return windowOf(card(title));
    });
  }

  test("a drag on the Hubble card narrows all three Cilium cards; a double-click on the data-plane card undoes it", async () => {
    await renderServiceMesh();

    await dragAcross(card(HUBBLE), DRAG_START, DRAG_END);

    expect(ciliumWindows()).toEqual([DRAG_WINDOW, DRAG_WINDOW, DRAG_WINDOW]);
    expect(resetButtons()).toHaveLength(3);

    await doubleClickOn(card(DATA_PLANE_EBPF));

    expect(ciliumWindows()).toEqual([
      PAST_HOUR_WINDOW,
      PAST_HOUR_WINDOW,
      PAST_HOUR_WINDOW,
    ]);
    expect(resetButtons()).toHaveLength(0);
  });

  test("a zoom carries over to the Istio and Linkerd tabs, and can be undone from there", async () => {
    await renderServiceMesh();

    await dragAcross(card(AGENT), DRAG_START, DRAG_END);

    await openTab("Istio");

    const istioViews: Array<HTMLElement> = screen.getAllByTestId("metric-view");

    expect(istioViews).toHaveLength(3);
    for (const view of istioViews) {
      expect(view.getAttribute("data-window")).toBe(DRAG_WINDOW);
    }

    await openTab("Linkerd");

    const linkerdViews: Array<HTMLElement> =
      screen.getAllByTestId("metric-view");

    expect(linkerdViews).toHaveLength(2);
    for (const view of linkerdViews) {
      expect(view.getAttribute("data-window")).toBe(DRAG_WINDOW);
    }

    fireEvent.doubleClick(within(linkerdViews[1]!).getByTestId("chart-plot"));
    await settle();

    for (const view of screen.getAllByTestId("metric-view")) {
      expect(view.getAttribute("data-window")).toBe(PAST_HOUR_WINDOW);
    }

    await openTab("Cilium");

    expect(ciliumWindows()).toEqual([
      PAST_HOUR_WINDOW,
      PAST_HOUR_WINDOW,
      PAST_HOUR_WINDOW,
    ]);
  });
});
