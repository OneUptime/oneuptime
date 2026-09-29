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
  ChartZoomRecord,
  doubleClickOn,
  dragAcross,
  MetricViewRecord,
  resetChartZoomStandIns,
  settle,
  windowKey,
} from "./ChartZoomHarness";

/*
 * Issue #4105 on the Metrics tab of every Kubernetes resource detail page
 * (node, pod, container, deployment, statefulset, daemonset, job, cronjob,
 * namespace). The tab is an EmbeddedMetricCard that owns its range - the
 * pages have no range of their own - so the card keeps the zoom: a drag on
 * any chart in the tab narrows every chart in it, the node's network
 * throughput chart included, and a double-click on any of them (or Reset
 * zoom beside the tab's picker) puts the tab back on the past hour. Before,
 * a drag narrowed the tab with no way back but the picker.
 *
 * The pages, the metrics tab, its card and the network chart are real.
 * MetricView and the line chart are stood in for (see ChartZoomHarness); the
 * card's picker is reduced to a button showing its range; the other tabs are
 * stubbed; the network fetch is stubbed and records the window it asks for.
 */

type NetworkFetch = { start: Date; end: Date; nodeName: string | undefined };

const mockFetchNetworkThroughput: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: () => {
        return Promise.resolve({
          clusterIdentifier: "prod-cluster",
          name: "Prod",
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

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("84858d6c-1111-4aaa-8bbb-000000000001");
      },
      getLastParamAsString: () => {
        return "web";
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

// The tab's own picker: shows its range, and can pick "Past 1 Day".
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

// The other tabs are not what these tests are about.
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesLogsTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="stub-KubernetesLogsTab" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesContainersTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="stub-KubernetesContainersTab" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesEnvVarsTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="stub-KubernetesEnvVarsTab" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesVolumeMountsTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="stub-KubernetesVolumeMountsTab" />;
      },
    };
  },
);

import NodeDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/NodeDetail";
import PodDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/PodDetail";
import ContainerDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/ContainerDetail";
import DeploymentDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/DeploymentDetail";
import StatefulSetDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/StatefulSetDetail";
import DaemonSetDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/DaemonSetDetail";
import JobDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/JobDetail";
import CronJobDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/CronJobDetail";
import NamespaceDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/NamespaceDetail";
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

function latestNetworkFetch(): NetworkFetch {
  const fetches: Array<NetworkFetch> = networkFetches();
  const latest: NetworkFetch | undefined = fetches[fetches.length - 1];

  if (!latest) {
    throw new Error("The network chart has not fetched");
  }

  return latest;
}

async function openMetricsTab(
  Page: React.FunctionComponent<PageComponentProps>,
): Promise<void> {
  render(<Page {...PAGE_PROPS} />);
  await settle();
  fireEvent.click(screen.getByRole("tab", { name: "Metrics" }));
  await settle();
  expect(screen.getByTestId("metric-view")).toBeInTheDocument();
}

function metricView(): HTMLElement {
  return screen.getByTestId("metric-view");
}

function metricWindow(): string {
  return metricView().getAttribute("data-window") || "";
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

function networkWindow(): string {
  return (
    within(networkSection())
      .getByTestId("line-chart")
      .getAttribute("data-window") || ""
  );
}

function picker(): string {
  return screen.getByTestId("card-picker").textContent || "";
}

function resetZoomButton(): HTMLElement | null {
  return screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  resetChartZoomStandIns();

  mockFetchNetworkThroughput.mockReset();
  mockFetchNetworkThroughput.mockImplementation((params: unknown) => {
    const request: { startDate: Date; endDate: Date } = params as {
      startDate: Date;
      endDate: Date;
    };
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

describe("the node Metrics tab: the metric charts and the network chart zoom together", () => {
  test("opens on the past hour, and every chart in the tab is handed the same zoom", async () => {
    await openMetricsTab(NodeDetailPage);

    expect(metricWindow()).toBe(PAST_HOUR_WINDOW);
    expect(networkWindow()).toBe(PAST_HOUR_WINDOW);
    expect(picker()).toBe(TimeRange.PAST_ONE_HOUR);

    const selects: Set<unknown> = new Set([
      ...chartZoomStandIns.metricViews.map(
        (view: MetricViewRecord): unknown => {
          return view.select;
        },
      ),
      ...chartZoomStandIns.lineCharts.map((chart: ChartZoomRecord): unknown => {
        return chart.select;
      }),
    ]);

    expect(selects.size).toBe(1);
    expect([...selects][0]).toBeInstanceOf(Function);
  });

  test("a drag on the network chart narrows the CPU, memory and filesystem charts, and refetches the node's traffic", async () => {
    await openMetricsTab(NodeDetailPage);

    await dragAcross(networkSection(), DRAG_START, DRAG_END);

    expect(metricWindow()).toBe(DRAG_WINDOW);
    expect(networkWindow()).toBe(DRAG_WINDOW);
    expect(
      windowKey(latestNetworkFetch().start, latestNetworkFetch().end),
    ).toBe(DRAG_WINDOW);
    expect(latestNetworkFetch().nodeName).toBe("web");
    expect(picker()).toBe(TimeRange.CUSTOM);
    expect(resetZoomButton()).toBeVisible();
  });

  test("a double-click on the metric charts undoes a zoom made on the network chart", async () => {
    await openMetricsTab(NodeDetailPage);

    await dragAcross(networkSection(), DRAG_START, DRAG_END);
    await doubleClickOn(metricView());

    expect(metricWindow()).toBe(PAST_HOUR_WINDOW);
    expect(networkWindow()).toBe(PAST_HOUR_WINDOW);
    expect(
      windowKey(latestNetworkFetch().start, latestNetworkFetch().end),
    ).toBe(PAST_HOUR_WINDOW);
    expect(picker()).toBe(TimeRange.PAST_ONE_HOUR);
    expect(resetZoomButton()).toBeNull();
  });

  test("a double-click on the network chart undoes a zoom made on the metric charts", async () => {
    await openMetricsTab(NodeDetailPage);

    await dragAcross(metricView(), DRAG_START, DRAG_END);
    expect(networkWindow()).toBe(DRAG_WINDOW);

    await doubleClickOn(networkSection());

    expect(metricWindow()).toBe(PAST_HOUR_WINDOW);
    expect(networkWindow()).toBe(PAST_HOUR_WINDOW);
  });

  test("zooming twice and resetting once goes back to the past hour", async () => {
    await openMetricsTab(NodeDetailPage);

    await dragAcross(metricView(), DRAG_START, DRAG_END);
    await dragAcross(networkSection(), NESTED_DRAG_START, NESTED_DRAG_END);

    expect(metricWindow()).toBe(NESTED_DRAG_WINDOW);
    expect(networkWindow()).toBe(NESTED_DRAG_WINDOW);

    fireEvent.click(resetZoomButton()!);
    await settle();

    expect(metricWindow()).toBe(PAST_HOUR_WINDOW);
    expect(networkWindow()).toBe(PAST_HOUR_WINDOW);
    expect(resetZoomButton()).toBeNull();
  });

  test("the Network Throughput header names the drag on hover, and the reset once zoomed", async () => {
    await openMetricsTab(NodeDetailPage);

    const hint: HTMLElement = within(networkSection()).getByTestId(
      TIME_RANGE_ZOOM_HINT_TEST_ID,
    );

    expect(hint).toHaveTextContent("Drag to zoom");
    expect(hint).toHaveClass("group-hover/zoomhint:opacity-100");
    expect(hint).toHaveClass("ml-auto");
    // In the header row, beside the title and its (i).
    expect(hint.parentElement).toBe(
      screen.getByText("Network Throughput").parentElement,
    );

    await dragAcross(networkSection(), DRAG_START, DRAG_END);

    expect(
      within(networkSection()).getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID),
    ).toHaveTextContent("Double-click to reset");
  });

  test("picking a range in the tab's picker ends the zoom", async () => {
    await openMetricsTab(NodeDetailPage);

    await dragAcross(networkSection(), DRAG_START, DRAG_END);
    fireEvent.click(screen.getByTestId("card-picker"));
    await settle();

    const oneDayAgo: Date = new Date(NOW.getTime() - 24 * 60 * MINUTE_MS);

    expect(picker()).toBe(TimeRange.PAST_ONE_DAY);
    expect(metricWindow()).toBe(windowKey(oneDayAgo, NOW));
    expect(networkWindow()).toBe(windowKey(oneDayAgo, NOW));
    expect(resetZoomButton()).toBeNull();

    const lastView: MetricViewRecord | undefined =
      chartZoomStandIns.metricViews[chartZoomStandIns.metricViews.length - 1];

    expect(lastView?.reset).toBeUndefined();
  });
});

describe("every resource Metrics tab zooms and resets its charts", () => {
  const PAGES: Array<[string, React.FunctionComponent<PageComponentProps>]> = [
    ["node", NodeDetailPage],
    ["pod", PodDetailPage],
    ["container", ContainerDetailPage],
    ["deployment", DeploymentDetailPage],
    ["statefulset", StatefulSetDetailPage],
    ["daemonset", DaemonSetDetailPage],
    ["job", JobDetailPage],
    ["cronjob", CronJobDetailPage],
    ["namespace", NamespaceDetailPage],
  ];

  test.each(PAGES)(
    "the %s Metrics tab: a drag narrows it, a double-click puts the past hour back",
    async (
      _kind: string,
      Page: React.FunctionComponent<PageComponentProps>,
    ) => {
      await openMetricsTab(Page);

      expect(metricWindow()).toBe(PAST_HOUR_WINDOW);
      expect(resetZoomButton()).toBeNull();

      await dragAcross(metricView(), DRAG_START, DRAG_END);

      expect(metricWindow()).toBe(DRAG_WINDOW);
      expect(picker()).toBe(TimeRange.CUSTOM);
      expect(resetZoomButton()).toBeVisible();

      await doubleClickOn(metricView());

      expect(metricWindow()).toBe(PAST_HOUR_WINDOW);
      expect(picker()).toBe(TimeRange.PAST_ONE_HOUR);
      expect(resetZoomButton()).toBeNull();
    },
  );

  test.each(PAGES)(
    "the %s Metrics tab offers no reset until it is zoomed",
    async (
      _kind: string,
      Page: React.FunctionComponent<PageComponentProps>,
    ) => {
      await openMetricsTab(Page);

      const lastView: MetricViewRecord | undefined =
        chartZoomStandIns.metricViews[chartZoomStandIns.metricViews.length - 1];

      expect(lastView?.select).toBeInstanceOf(Function);
      expect(lastView?.reset).toBeUndefined();

      // A stray double-click before any zoom leaves the tab where it is.
      await doubleClickOn(metricView());

      expect(metricWindow()).toBe(PAST_HOUR_WINDOW);
      expect(picker()).toBe(TimeRange.PAST_ONE_HOUR);
    },
  );
});
