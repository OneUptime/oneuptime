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
  RealChartRow,
  doubleClickRealRows,
  dragRealRows,
  realRowsOf,
  realRowsWindowOf,
  settleRealRows,
} from "./RealRowsLineChart";

/*
 * Issue #4105 on the Kubernetes cluster Overview - the page in the
 * customer's screenshot - with real drags on a clock that is not on any
 * grid, as a reader's never is.
 *
 * A window like "Past 1 Week" starts at now minus seven days, 12:23:11
 * say, while the server buckets its points on the grid (toStartOfInterval):
 * the bar labelled 10:00 holds 10:00-11:00. Each chart row used to carry
 * the start of its SLOT (10:23:11) rather than of the bucket it draws, so a
 * drag across the 10:00 and 11:00 points zoomed the whole page to
 * 10:23:11-12:23:11 - dropping the first 23 minutes of the spike the reader
 * aimed at and adding 23 minutes nobody selected. Rows now carry the start
 * of the bucket they draw (XAxisUtil.getBucketStart), so a drag zooms the
 * page to exactly the buckets under it; these tests pin that on the page,
 * on every tier the Overview's presets draw.
 *
 * The page, its charts' rows (DataPointUtil) and the drag
 * (useChartRangeSelection) are real, through RealRowsLineChart. The metric
 * aggregates answer the way the server does: one row per bucket of the
 * interval the query's window gets, at the bucket's start.
 */

type AggregateRequest = {
  aggregateBy: {
    query: { name: string };
    startTimestamp: Date;
    endTimestamp: Date;
  };
};

type AggregateWindow = { name: string; start: Date; end: Date };

const mockAggregate: MockFunction = getJestMockFunction();
const mockInventorySummary: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("0193c0de-7777-4aaa-8bbb-000000000007");
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

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return mockInventorySummary(...args);
      },
      getFriendlyMessage: () => {
        return "Could not load";
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
          name: "production-us-east",
          clusterIdentifier: "production-us-east-1",
          otelCollectorStatus: "connected",
          lastSeenAt: new Date("2026-09-28T12:22:00.000Z"),
        });
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
      aggregate: (...args: Array<unknown>) => {
        return mockAggregate(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesResourceUtils",
  () => {
    const actual: {
      default: {
        formatCpuValue: (value: number | null) => string;
        formatMemoryValue: (bytes: number | null) => string;
      };
    } = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesResourceUtils",
    ) as {
      default: {
        formatCpuValue: (value: number | null) => string;
        formatMemoryValue: (bytes: number | null) => string;
      };
    };

    return {
      __esModule: true,
      default: {
        formatCpuValue: actual.default.formatCpuValue,
        formatMemoryValue: actual.default.formatMemoryValue,
        fetchResourceListWithMemory: () => {
          return Promise.resolve([]);
        },
        fetchNodeAllocatableMemory: () => {
          return Promise.resolve(new Map<string, number>());
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesObjectFetcher",
  () => {
    return {
      __esModule: true,
      ...(jest.requireActual(
        "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesObjectFetcher",
      ) as Record<string, unknown>),
      fetchClusterWarningEvents: () => {
        return Promise.resolve([]);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="resource-activity-cards" />;
      },
    };
  },
);

/*
 * The hero's refresh control, minus its animation-frame countdown: it still
 * renders the page's picker where the page puts it.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: (props: {
        timeRangePicker?: React.ReactElement | undefined;
        onManualRefresh: () => void;
      }) => {
        return (
          <div data-testid="auto-refresh-control">
            {props.timeRangePicker}
            <button type="button" onClick={props.onManualRefresh}>
              Refresh now
            </button>
          </div>
        );
      },
    };
  },
);

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="cluster-details" />;
    },
  };
});

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

import KubernetesClusterOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import AggregationIntervalUtil from "../../../Types/BaseDatabase/AggregationIntervalUtil";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX } from "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const REFRESH_STORAGE_KEY: string = "kubernetes-overview-auto-refresh-interval";

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

// Twenty-three minutes and eleven seconds past noon: on no grid at all.
const NOW: Date = new Date("2026-09-28T12:23:11.000Z");

const CHART_TITLES: Array<string> = [
  "Availability",
  "CPU",
  "Memory",
  "Filesystem",
  "Network",
];

// The six queries a golden-metrics load issues for the page's window.
const GOLDEN_METRICS: Array<string> = [
  "k8s.node.cpu.utilization",
  "k8s.node.memory.usage",
  "k8s.node.filesystem.usage",
  "k8s.node.filesystem.available",
  "k8s.node.network.io",
  "oneuptime.host.heartbeat",
];

const NODE_ATTRIBUTES: Record<string, string> = {
  "resource.k8s.node.name": "node-a",
};

function at(iso: string): Date {
  return new Date(iso);
}

function windowKey(start: Date, end: Date): string {
  return `${start.toISOString()}/${end.toISOString()}`;
}

/*
 * The bucket starts a window's rows come back at: the interval the server
 * picks for the window, on its grid, from the bucket holding the window's
 * start to the one holding its end.
 */
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

function rowsFor(request: AggregateRequest): Array<Record<string, unknown>> {
  const name: string = request.aggregateBy.query.name;
  const buckets: Array<number> = bucketStartsFor(
    new Date(request.aggregateBy.startTimestamp),
    new Date(request.aggregateBy.endTimestamp),
  );

  switch (name) {
    case "k8s.node.allocatable_cpu":
      return [
        {
          timestamp: new Date(request.aggregateBy.endTimestamp),
          value: 4,
          attributes: NODE_ATTRIBUTES,
        },
      ];
    case "k8s.node.cpu.utilization":
    case "k8s.node.memory.usage":
    case "k8s.node.filesystem.usage":
    case "k8s.node.filesystem.available":
      return buckets.map((time: number): Record<string, unknown> => {
        return {
          timestamp: new Date(time),
          value: name === "k8s.node.filesystem.available" ? 70 : 1,
          attributes: NODE_ATTRIBUTES,
        };
      });
    case "k8s.node.network.io":
      return buckets.flatMap((time: number): Array<Record<string, unknown>> => {
        return ["receive", "transmit"].map(
          (direction: string): Record<string, unknown> => {
            return {
              timestamp: new Date(time),
              value: time / 1000,
              attributes: {
                ...NODE_ATTRIBUTES,
                direction: direction,
                interface: "eth0",
              },
            };
          },
        );
      });
    case "oneuptime.host.heartbeat":
      return buckets.map((time: number): Record<string, unknown> => {
        return { timestamp: new Date(time), value: 2 };
      });
    default:
      return [];
  }
}

function goldenWindows(): Array<AggregateWindow> {
  return mockAggregate.mock.calls
    .map((call: Array<unknown>): AggregateWindow => {
      const request: AggregateRequest = call[0] as AggregateRequest;
      return {
        name: request.aggregateBy.query.name,
        start: new Date(request.aggregateBy.startTimestamp),
        end: new Date(request.aggregateBy.endTimestamp),
      };
    })
    .filter((window: AggregateWindow): boolean => {
      return GOLDEN_METRICS.includes(window.name);
    });
}

// Every golden query of the most recent load asked for exactly [start, end].
function expectLatestLoadFor(start: Date, end: Date): void {
  const load: Array<AggregateWindow> = goldenWindows().slice(
    -GOLDEN_METRICS.length,
  );

  expect(
    load
      .map((window: AggregateWindow): string => {
        return window.name;
      })
      .sort(),
  ).toEqual([...GOLDEN_METRICS].sort());

  for (const window of load) {
    expect({
      name: window.name,
      window: windowKey(window.start, window.end),
    }).toEqual({ name: window.name, window: windowKey(start, end) });
  }
}

// The golden chart card titled `title` (a tile can share the title).
function chartCard(title: string): HTMLElement {
  const cards: Array<HTMLElement> = screen
    .getAllByText(title, { selector: "span" })
    .map((span: HTMLElement): HTMLElement | null => {
      return span.closest('[class~="group/zoomhint"]');
    })
    .filter((card: HTMLElement | null): card is HTMLElement => {
      return card !== null && within(card).queryByTestId("line-chart") !== null;
    });

  if (cards.length !== 1) {
    throw new Error(
      `Expected one "${title}" chart card, found ${cards.length}`,
    );
  }

  return cards[0]!;
}

function chartWindows(): Array<string> {
  return CHART_TITLES.map((title: string): string => {
    return realRowsWindowOf(chartCard(title));
  });
}

function rowStartingAt(title: string, start: Date): RealChartRow {
  const row: RealChartRow | undefined = realRowsOf(chartCard(title)).find(
    (candidate: RealChartRow): boolean => {
      return candidate.bucketStart === start.toISOString();
    },
  );

  if (!row) {
    throw new Error(`No ${title} row starts at ${start.toISOString()}`);
  }

  return row;
}

async function renderOverview(): Promise<void> {
  render(<KubernetesClusterOverview {...PAGE_PROPS} />);
  await settleRealRows();
  expect(screen.getAllByTestId("line-chart")).toHaveLength(5);
}

async function pickPreset(label: string): Promise<void> {
  fireEvent.click(
    screen.getByTestId(`${TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX}-button`),
  );
  fireEvent.click(screen.getByRole("button", { name: label }));
  await settleRealRows();
}

function resetZoomButton(): HTMLElement | null {
  return screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.localStorage.setItem(REFRESH_STORAGE_KEY, "off");

  mockAggregate.mockReset();
  mockAggregate.mockImplementation((request: unknown) => {
    return Promise.resolve({ data: rowsFor(request as AggregateRequest) });
  });
  mockInventorySummary.mockReset();
  mockInventorySummary.mockImplementation(() => {
    return Promise.resolve({
      data: {
        nodeCount: 1,
        podCount: 4,
        namespaceCount: 2,
        podPhaseCounts: { running: 4, pending: 0, failed: 0, succeeded: 0 },
        nodeReadyCounts: { ready: 1, notReady: 0 },
        nodePressureCounts: {
          memoryPressure: 0,
          diskPressure: 0,
          pidPressure: 0,
        },
        degradedPods: [],
        degradedNodes: [],
      },
    });
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  jest.useRealTimers();
});

describe("the cluster Overview on Past 30 Minutes, drawn minute by minute", () => {
  const WINDOW_START: Date = new Date(NOW.getTime() - 30 * MINUTE_MS);

  test("the rows start on the minute although the window does not", async () => {
    await renderOverview();

    expect(WINDOW_START.toISOString()).toBe("2026-09-28T11:53:11.000Z");
    expect(chartWindows()).toEqual(
      CHART_TITLES.map((): string => {
        return windowKey(WINDOW_START, NOW);
      }),
    );

    for (const title of CHART_TITLES) {
      for (const row of realRowsOf(chartCard(title))) {
        expect(new Date(row.bucketStart).getTime() % MINUTE_MS).toBe(0);
      }
    }
    expect(rowStartingAt("CPU", at("2026-09-28T12:10:00.000Z")).label).toBe(
      "12:10",
    );
  });

  test("a drag across the 12:10 and 12:11 points zooms every chart and query to exactly 12:10-12:12", async () => {
    await renderOverview();

    await dragRealRows(
      chartCard("CPU"),
      at("2026-09-28T12:10:00.000Z"),
      at("2026-09-28T12:11:00.000Z"),
    );

    const start: Date = at("2026-09-28T12:10:00.000Z");
    const end: Date = at("2026-09-28T12:12:00.000Z");

    expectLatestLoadFor(start, end);
    expect(chartWindows()).toEqual(
      CHART_TITLES.map((): string => {
        return windowKey(start, end);
      }),
    );
    expect(resetZoomButton()).toBeVisible();
  });

  test("a drag the other way round, on another chart, zooms to the same buckets", async () => {
    await renderOverview();

    await dragRealRows(
      chartCard("Memory"),
      at("2026-09-28T12:11:00.000Z"),
      at("2026-09-28T12:10:00.000Z"),
    );

    expectLatestLoadFor(
      at("2026-09-28T12:10:00.000Z"),
      at("2026-09-28T12:12:00.000Z"),
    );
  });

  test("a drag over the first point takes in the whole first bucket, the part before the window included", async () => {
    await renderOverview();

    // The window starts at 11:53:11; its first point is the 11:53 bucket.
    expect(realRowsOf(chartCard("CPU"))[0]?.bucketStart).toBe(
      "2026-09-28T11:53:00.000Z",
    );

    await dragRealRows(
      chartCard("CPU"),
      at("2026-09-28T11:53:00.000Z"),
      at("2026-09-28T11:55:00.000Z"),
    );

    expectLatestLoadFor(
      at("2026-09-28T11:53:00.000Z"),
      at("2026-09-28T11:56:00.000Z"),
    );
  });

  test("a drag up to the point still filling up zooms to now, never past it", async () => {
    await renderOverview();

    await dragRealRows(
      chartCard("Network"),
      at("2026-09-28T12:21:00.000Z"),
      at("2026-09-28T12:23:00.000Z"),
    );

    expectLatestLoadFor(at("2026-09-28T12:21:00.000Z"), NOW);
  });
});

describe("the cluster Overview on the longer presets: a zoom lands on the buckets drawn", () => {
  test("Past 1 Day, drawn quarter-hourly: a drag across the 10:00 and 10:15 points zooms to 10:00-10:30", async () => {
    await renderOverview();
    await pickPreset("Past 1 Day");

    expectLatestLoadFor(new Date(NOW.getTime() - DAY_MS), NOW);
    expect(
      rowStartingAt("CPU", at("2026-09-28T10:00:00.000Z")).label,
    ).toContain("10:00");

    await dragRealRows(
      chartCard("CPU"),
      at("2026-09-28T10:00:00.000Z"),
      at("2026-09-28T10:15:00.000Z"),
    );

    expectLatestLoadFor(
      at("2026-09-28T10:00:00.000Z"),
      at("2026-09-28T10:30:00.000Z"),
    );
  });

  test("Past 1 Week, drawn hourly: a drag across the 10:00 and 11:00 points zooms to 10:00-12:00, not 10:23:11-12:23:11", async () => {
    await renderOverview();
    await pickPreset("Past 1 Week");

    expectLatestLoadFor(new Date(NOW.getTime() - 7 * DAY_MS), NOW);
    expect(
      rowStartingAt("CPU", at("2026-09-27T10:00:00.000Z")).label,
    ).toContain("10:00");

    await dragRealRows(
      chartCard("CPU"),
      at("2026-09-27T10:00:00.000Z"),
      at("2026-09-27T11:00:00.000Z"),
    );

    expectLatestLoadFor(
      at("2026-09-27T10:00:00.000Z"),
      at("2026-09-27T12:00:00.000Z"),
    );
    expect(chartWindows()).toEqual(
      CHART_TITLES.map((): string => {
        return windowKey(
          at("2026-09-27T10:00:00.000Z"),
          at("2026-09-27T12:00:00.000Z"),
        );
      }),
    );
  });

  test("Past 2 Weeks, drawn daily: a drag across two days zooms to exactly those two days", async () => {
    await renderOverview();
    await pickPreset("Past 2 Weeks");

    await dragRealRows(
      chartCard("Memory"),
      at("2026-09-20T00:00:00.000Z"),
      at("2026-09-21T00:00:00.000Z"),
    );

    expectLatestLoadFor(
      at("2026-09-20T00:00:00.000Z"),
      at("2026-09-22T00:00:00.000Z"),
    );
  });

  test("nested: the week, then two hours of it, then a quarter-hour of those, then one double-click back to the week", async () => {
    await renderOverview();
    await pickPreset("Past 1 Week");
    const week: [Date, Date] = [new Date(NOW.getTime() - 7 * DAY_MS), NOW];

    await dragRealRows(
      chartCard("CPU"),
      at("2026-09-27T10:00:00.000Z"),
      at("2026-09-27T11:00:00.000Z"),
    );
    // Two hours are drawn minute by minute.
    expect(
      realRowsOf(chartCard("Filesystem")).map((row: RealChartRow): string => {
        return row.bucketStart;
      }),
    ).toContain("2026-09-27T10:44:00.000Z");

    await dragRealRows(
      chartCard("Filesystem"),
      at("2026-09-27T10:30:00.000Z"),
      at("2026-09-27T10:44:00.000Z"),
    );

    expectLatestLoadFor(
      at("2026-09-27T10:30:00.000Z"),
      at("2026-09-27T10:45:00.000Z"),
    );

    await doubleClickRealRows(chartCard("Availability"));

    expectLatestLoadFor(week[0], week[1]);
    expect(resetZoomButton()).toBeNull();
  });
});
