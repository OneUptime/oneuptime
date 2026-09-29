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
import { chartZoomStandIns, resetChartZoomStandIns } from "./ChartZoomHarness";
import {
  RealChartRow,
  doubleClickRealRows,
  dragRealRows,
  realRowsOf,
  realRowsWindowOf,
  settleRealRows,
} from "./RealRowsLineChart";

/*
 * Issue #4105 on the Kubernetes network throughput chart - the Insights
 * page's Network card and a node's Metrics tab - with real drags on a
 * clock that is on no grid.
 *
 * The chart is drawn over the window its host hands it, "now minus N",
 * while its points (rates from the server's bucketed counters) sit on the
 * bucket grid. A drag must zoom the host to exactly the buckets under it:
 * the chart's own reload and the MetricView charts beside it all follow.
 * Rows used to carry the start of their slot instead of the bucket they
 * draw, which shifted every zoom by the window's offset from the grid.
 *
 * The pages, their cards, the chart, its network maths (KubernetesNetworkUtils)
 * and the zoom are real; so are the chart's rows and the drag, through
 * RealRowsLineChart. The metric aggregates answer the way the server does:
 * one row per bucket of the interval the query's window gets, at the
 * bucket's start. MetricView is stood in for (see ChartZoomHarness).
 */

type AggregateRequest = {
  aggregateBy: {
    query: { name: string; attributes?: Record<string, string> };
    startTimestamp: Date;
    endTimestamp: Date;
  };
};

type NetworkQuery = { start: Date; end: Date; node: string | undefined };

const mockAggregate: MockFunction = getJestMockFunction();

// The range the next pick in a card's picker chooses.
let mockPickedRange: string = "Past 1 Week";

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

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>) => {
        return mockAggregate(...args);
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
        "./RealRowsLineChart",
      ) as typeof import("./RealRowsLineChart")
    ).RealRowsLineChart,
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

// Each card's own picker: shows its range, and picks mockPickedRange.
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
            props.onChange({ range: mockPickedRange });
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

import KubernetesClusterInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Insights";
import NodeDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/NodeDetail";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { NETWORK_IO_METRIC_NAME } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesNetworkUtils";
import AggregationIntervalUtil from "../../../Types/BaseDatabase/AggregationIntervalUtil";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

// Twenty-three minutes and eleven seconds past noon: on no grid at all.
const NOW: Date = new Date("2026-09-28T12:23:11.000Z");

function at(iso: string): Date {
  return new Date(iso);
}

function windowKey(start: Date, end: Date): string {
  return `${start.toISOString()}/${end.toISOString()}`;
}

// The bucket starts a window's rows come back at, on the server's grid.
function bucketStartsFor(start: Date, end: Date): Array<number> {
  const interval: AggregationInterval =
    AggregationIntervalUtil.getAggregationIntervalForWindow({
      startDate: start,
      endDate: end,
    });
  const intervalMs: number =
    AggregationIntervalUtil.getAggregationIntervalMs(interval);
  const buckets: Array<number> = [];

  for (
    let time: number = AggregationIntervalUtil.floorDateToIntervalGrid(
      start,
      interval,
    ).getTime();
    time <= end.getTime();
    time += intervalMs
  ) {
    buckets.push(time);
  }

  return buckets;
}

/*
 * The cumulative network counter, a max per bucket per (node, interface,
 * direction): a steady 1 KB/s each way, so every bucket after the first
 * has a rate.
 */
function rowsFor(request: AggregateRequest): Array<Record<string, unknown>> {
  if (request.aggregateBy.query.name !== NETWORK_IO_METRIC_NAME) {
    return [];
  }

  return bucketStartsFor(
    new Date(request.aggregateBy.startTimestamp),
    new Date(request.aggregateBy.endTimestamp),
  ).flatMap((time: number): Array<Record<string, unknown>> => {
    return ["receive", "transmit"].map(
      (direction: string): Record<string, unknown> => {
        return {
          timestamp: new Date(time).toISOString(),
          value: time,
          attributes: {
            "resource.k8s.node.name": "node-a",
            direction: direction,
            interface: "eth0",
          },
        };
      },
    );
  });
}

function networkQueries(): Array<NetworkQuery> {
  return mockAggregate.mock.calls
    .map((call: Array<unknown>): AggregateRequest => {
      return call[0] as AggregateRequest;
    })
    .filter((request: AggregateRequest): boolean => {
      return request.aggregateBy.query.name === NETWORK_IO_METRIC_NAME;
    })
    .map((request: AggregateRequest): NetworkQuery => {
      return {
        start: new Date(request.aggregateBy.startTimestamp),
        end: new Date(request.aggregateBy.endTimestamp),
        node: request.aggregateBy.query.attributes?.["resource.k8s.node.name"],
      };
    });
}

function latestNetworkWindow(): string {
  const latest: NetworkQuery | undefined = networkQueries().slice(-1)[0];

  if (!latest) {
    throw new Error("The network chart has not queried");
  }

  return windowKey(latest.start, latest.end);
}

function rowStartingAt(container: HTMLElement, start: Date): RealChartRow {
  const row: RealChartRow | undefined = realRowsOf(container).find(
    (candidate: RealChartRow): boolean => {
      return candidate.bucketStart === start.toISOString();
    },
  );

  if (!row) {
    throw new Error(`No row starts at ${start.toISOString()}`);
  }

  return row;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  resetChartZoomStandIns();
  mockPickedRange = "Past 1 Week";

  mockAggregate.mockReset();
  mockAggregate.mockImplementation((request: unknown) => {
    return Promise.resolve({ data: rowsFor(request as AggregateRequest) });
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("cluster Insights: a drag on the network chart zooms the page to the buckets under it", () => {
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

  function metricViewWindows(): Array<string> {
    return chartZoomStandIns.metricViews
      .slice(-2)
      .map((view: { window: string }): string => {
        return view.window;
      });
  }

  async function renderInsights(): Promise<void> {
    render(<KubernetesClusterInsights {...PAGE_PROPS} />);
    await settleRealRows();
    expect(within(card("Network")).getByTestId("line-chart")).toBeTruthy();
  }

  async function pickInNetworkCard(range: string): Promise<void> {
    mockPickedRange = range;
    fireEvent.click(within(card("Network")).getByTestId("card-picker"));
    await settleRealRows();
  }

  test("on the past hour, the minute rows start on the minute, and a drag across 12:00-12:04 zooms every card to 12:00-12:05", async () => {
    await renderInsights();

    const pastHour: string = windowKey(new Date(NOW.getTime() - HOUR_MS), NOW);
    expect(realRowsWindowOf(card("Network"))).toBe(pastHour);
    expect(latestNetworkWindow()).toBe(pastHour);
    for (const row of realRowsOf(card("Network"))) {
      expect(new Date(row.bucketStart).getTime() % MINUTE_MS).toBe(0);
    }
    // The rates are drawn at the bucket they were read for.
    expect(
      rowStartingAt(card("Network"), at("2026-09-28T12:04:00.000Z")).values,
    ).toEqual({ Received: 1000, Transmitted: 1000 });

    await dragRealRows(
      card("Network"),
      at("2026-09-28T12:00:00.000Z"),
      at("2026-09-28T12:04:00.000Z"),
    );

    const zoomed: string = windowKey(
      at("2026-09-28T12:00:00.000Z"),
      at("2026-09-28T12:05:00.000Z"),
    );
    expect(latestNetworkWindow()).toBe(zoomed);
    expect(realRowsWindowOf(card("Network"))).toBe(zoomed);
    expect(metricViewWindows()).toEqual([zoomed, zoomed]);
    expect(
      screen.getAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toHaveLength(3);
  });

  test("on the past day, drawn quarter-hourly: a drag across 10:00 and 10:15 zooms to 10:00-10:30", async () => {
    await renderInsights();
    await pickInNetworkCard("Past 1 Day");

    expect(latestNetworkWindow()).toBe(
      windowKey(new Date(NOW.getTime() - DAY_MS), NOW),
    );

    await dragRealRows(
      card("Network"),
      at("2026-09-28T10:00:00.000Z"),
      at("2026-09-28T10:15:00.000Z"),
    );

    const zoomed: string = windowKey(
      at("2026-09-28T10:00:00.000Z"),
      at("2026-09-28T10:30:00.000Z"),
    );
    expect(latestNetworkWindow()).toBe(zoomed);
    expect(metricViewWindows()).toEqual([zoomed, zoomed]);
  });

  test("on the past week, drawn hourly: a drag across 10:00 and 11:00 zooms to 10:00-12:00, and a double-click goes back", async () => {
    await renderInsights();
    await pickInNetworkCard("Past 1 Week");

    const week: string = windowKey(new Date(NOW.getTime() - 7 * DAY_MS), NOW);
    expect(latestNetworkWindow()).toBe(week);

    await dragRealRows(
      card("Network"),
      at("2026-09-27T11:00:00.000Z"),
      at("2026-09-27T10:00:00.000Z"),
    );

    const zoomed: string = windowKey(
      at("2026-09-27T10:00:00.000Z"),
      at("2026-09-27T12:00:00.000Z"),
    );
    expect(latestNetworkWindow()).toBe(zoomed);
    expect(metricViewWindows()).toEqual([zoomed, zoomed]);

    await doubleClickRealRows(card("Network"));

    expect(latestNetworkWindow()).toBe(week);
    expect(
      screen.queryAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toHaveLength(0);
  });
});

describe("a node's Metrics tab: a drag on the network chart zooms the tab to the buckets under it", () => {
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

  async function openNodeMetricsTab(): Promise<void> {
    render(<NodeDetailPage {...PAGE_PROPS} />);
    await settleRealRows();
    fireEvent.click(screen.getByRole("tab", { name: "Metrics" }));
    await settleRealRows();
    expect(within(networkSection()).getByTestId("line-chart")).toBeTruthy();
  }

  test("on the past hour: a drag across 12:10-12:12 zooms the node's traffic and its metric charts to 12:10-12:13", async () => {
    await openNodeMetricsTab();

    expect(networkQueries().slice(-1)[0]?.node).toBe("node-a");

    await dragRealRows(
      networkSection(),
      at("2026-09-28T12:10:00.000Z"),
      at("2026-09-28T12:12:00.000Z"),
    );

    const zoomed: string = windowKey(
      at("2026-09-28T12:10:00.000Z"),
      at("2026-09-28T12:13:00.000Z"),
    );
    expect(latestNetworkWindow()).toBe(zoomed);
    expect(networkQueries().slice(-1)[0]?.node).toBe("node-a");
    expect(chartZoomStandIns.metricViews.slice(-1)[0]?.window).toBe(zoomed);
  });

  test("on the past week, picked in the tab: a drag across two hours zooms to exactly those hours", async () => {
    await openNodeMetricsTab();
    mockPickedRange = "Past 1 Week";
    fireEvent.click(screen.getByTestId("card-picker"));
    await settleRealRows();

    await dragRealRows(
      networkSection(),
      at("2026-09-26T22:00:00.000Z"),
      at("2026-09-26T23:00:00.000Z"),
    );

    expect(latestNetworkWindow()).toBe(
      windowKey(at("2026-09-26T22:00:00.000Z"), at("2026-09-27T00:00:00.000Z")),
    );
  });
});
