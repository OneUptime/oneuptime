import "@testing-library/jest-dom";
import {
  act,
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
  ChartZoomRecord,
  chartZoomStandIns,
  doubleClickOn as doubleClickOnChartIn,
  dragAcross as dragAcrossChartIn,
  resetChartZoomStandIns,
  settle,
  windowKey,
  windowOf,
} from "./ChartZoomHarness";

/*
 * Issue #4105, on the page in the customer's screenshot: the Kubernetes
 * cluster Overview. Dragging across any of its charts (Availability, CPU,
 * Memory, Filesystem, Network) must narrow the WHOLE page to the window
 * dragged out - every chart, every tile, the uptime badge, and the picker,
 * which then reads as a custom range with a "Reset zoom" button beside it.
 * A double-click on any chart (not just the one dragged on) must put the
 * page back on the range it had before the first zoom, however many zooms
 * deep the reader went.
 *
 * The page is rendered whole with its data sources stubbed. The metric
 * aggregates answer with a minute-by-minute series for exactly the window
 * each query asks for, so the tests can see which window every chart and
 * tile was drawn from. The line chart is stood in for (see
 * ChartZoomHarness): the stand-in resolves its zoom handlers the way the
 * real wrapper does - its host's, else the page's for a time axis - and
 * exposes them as a "drag" button and a double-clickable plot. The zoom
 * scope, the picker and its Reset zoom button are real.
 */

type AggregateWindow = { name: string; start: Date; end: Date };

type AggregateRequest = {
  aggregateBy: {
    query: { name: string };
    startTimestamp: Date;
    endTimestamp: Date;
  };
};

const mockAggregate: MockFunction = getJestMockFunction();
const mockInventorySummary: MockFunction = getJestMockFunction();
/*
 * When OneUptime itself was not receiving (issue #2825): asked for the
 * charts' window, so unlike the "now" snapshots it follows the zoom.
 */
const mockReceivingGaps: MockFunction = getJestMockFunction();
const mockFetchTopPods: MockFunction = getJestMockFunction();
const mockFetchWarnings: MockFunction = getJestMockFunction();

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

// The inventory summary: a "now" snapshot that must not follow the zoom.
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        const url: string = String(
          (args[0] as { url?: unknown } | undefined)?.url ?? "",
        );
        if (url.endsWith("/receiving-gaps")) {
          return mockReceivingGaps(...args);
        }
        return mockInventorySummary(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return (
          ((error as { message?: unknown } | null)?.message as string) ||
          "Could not load"
        );
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
          lastSeenAt: new Date("2026-09-28T11:59:00.000Z"),
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
        fetchResourceListWithMemory: (...args: Array<unknown>) => {
          return mockFetchTopPods(...args);
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
      fetchClusterWarningEvents: (...args: Array<unknown>) => {
        return mockFetchWarnings(...args);
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
 * renders the page's picker where the page puts it, and a Refresh button.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: (props: {
        timeRangePicker?: React.ReactElement | undefined;
        onManualRefresh: () => void;
        isRefreshing: boolean;
      }) => {
        return (
          <div
            data-testid="auto-refresh-control"
            data-refreshing={String(props.isRefreshing)}
          >
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
        "./ChartZoomHarness",
      ) as typeof import("./ChartZoomHarness")
    ).StandInLineChart,
  };
});

import KubernetesClusterOverview, {
  ClusterChartCard,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { TimeRangeZoomProvider } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { TIME_RANGE_ZOOM_HINT_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import {
  getTimeRangeButtonLabel,
  getTimeRangeLabel,
} from "../../../UI/Components/Date/TimeRangePickerDropdown";
import { TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX } from "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import IconProp from "../../../Types/Icon/IconProp";
import TimeRange from "../../../Types/Time/TimeRange";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const REFRESH_STORAGE_KEY: string = "kubernetes-overview-auto-refresh-interval";

const MINUTE_MS: number = 60 * 1000;

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const PAST_THIRTY_MINUTES_START: Date = new Date("2026-09-28T11:30:00.000Z");

const DRAG_START: Date = new Date("2026-09-28T11:40:00.000Z");
const DRAG_END: Date = new Date("2026-09-28T11:50:00.000Z");
const NESTED_DRAG_START: Date = new Date("2026-09-28T11:42:00.000Z");
const NESTED_DRAG_END: Date = new Date("2026-09-28T11:45:00.000Z");

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

const ALLOCATABLE_CPU_METRIC: string = "k8s.node.allocatable_cpu";

const NODE_ATTRIBUTES: Record<string, string> = {
  "resource.k8s.node.name": "node-a",
};

const ALLOCATABLE_CORES: number = 4;

/*
 * Cores in use at a minute: its minute-of-the-hour / 50, so the CPU tile
 * (the mean of a window's last five minutes) reads differently for every
 * window and shows which window it was computed from:
 *   Past 30 Minutes (11:30-12:00): minutes 55-59 -> 1.14 cores -> 28.5%
 *   the drag (11:40-11:50):        minutes 45-49 -> 0.94 cores -> 23.5%
 *   the nested drag (11:42-11:45): minutes 42-44 -> 0.86 cores -> 21.5%
 */
function coresInUseAt(time: number): number {
  return new Date(time).getUTCMinutes() / 50;
}

/*
 * The agent went quiet from 11:50 to 11:57, so the uptime badge reads
 * differently for every window too:
 *   Past 30 Minutes: 7 of the 30 minutes it can judge down -> 76.67%
 *     (the minute still filling up counts once a heartbeat is in)
 *   the drag (11:40-11:50): all 10 minutes up              -> 100.0%
 */
const OUTAGE_START: Date = new Date("2026-09-28T11:50:00.000Z");
const OUTAGE_END: Date = new Date("2026-09-28T11:57:00.000Z");
const UPTIME_PAST_THIRTY_MINUTES: string = "76.67% uptime";
const UPTIME_DRAG: string = "100.0% uptime";

const CPU_TILE_PAST_THIRTY_MINUTES: string = "28.5%";
const CPU_TILE_DRAG: string = "23.5%";
const CPU_TILE_NESTED_DRAG: string = "21.5%";

function minuteStartsWithin(start: Date, end: Date): Array<number> {
  const minutes: Array<number> = [];
  const first: number = Math.ceil(start.getTime() / MINUTE_MS) * MINUTE_MS;

  for (let time: number = first; time < end.getTime(); time += MINUTE_MS) {
    minutes.push(time);
  }

  return minutes;
}

/*
 * One row per minute of exactly the window asked for, shaped like each
 * metric's real rows.
 */
function rowsFor(request: AggregateRequest): Array<Record<string, unknown>> {
  const name: string = request.aggregateBy.query.name;
  const minutes: Array<number> = minuteStartsWithin(
    new Date(request.aggregateBy.startTimestamp),
    new Date(request.aggregateBy.endTimestamp),
  );

  switch (name) {
    case ALLOCATABLE_CPU_METRIC:
      return [
        {
          timestamp: new Date(request.aggregateBy.endTimestamp),
          value: ALLOCATABLE_CORES,
          attributes: NODE_ATTRIBUTES,
        },
      ];
    case "k8s.node.cpu.utilization":
      return minutes.map((time: number): Record<string, unknown> => {
        return {
          timestamp: new Date(time),
          value: coresInUseAt(time),
          attributes: NODE_ATTRIBUTES,
        };
      });
    case "k8s.node.memory.usage":
      return minutes.map((time: number): Record<string, unknown> => {
        return {
          timestamp: new Date(time),
          value: 2 * 1024 * 1024 * 1024,
          attributes: NODE_ATTRIBUTES,
        };
      });
    case "k8s.node.filesystem.usage":
    case "k8s.node.filesystem.available":
      return minutes.map((time: number): Record<string, unknown> => {
        return {
          timestamp: new Date(time),
          value: name === "k8s.node.filesystem.usage" ? 30 : 70,
          attributes: NODE_ATTRIBUTES,
        };
      });
    case "k8s.node.network.io":
      return minutes.flatMap((time: number): Array<Record<string, unknown>> => {
        return ["receive", "transmit"].map(
          (direction: string): Record<string, unknown> => {
            return {
              timestamp: new Date(time),
              value: time,
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
      return minutes
        .filter((time: number): boolean => {
          return time < OUTAGE_START.getTime() || time >= OUTAGE_END.getTime();
        })
        .map((time: number): Record<string, unknown> => {
          return { timestamp: new Date(time), value: 2 };
        });
    default:
      return [];
  }
}

/*
 * While set, aggregate answers are held back until the test releases them,
 * to play a slow response against a faster, newer one.
 */
let heldAggregates: Array<{
  release: () => void;
  fail: () => void;
}> | null = null;

function answerAggregate(
  request: AggregateRequest,
): Promise<{ data: Array<Record<string, unknown>> }> {
  if (!heldAggregates) {
    return Promise.resolve({ data: rowsFor(request) });
  }

  const held: Array<{ release: () => void; fail: () => void }> = heldAggregates;

  return new Promise(
    (
      resolve: (value: { data: Array<Record<string, unknown>> }) => void,
      reject: (reason: Error) => void,
    ) => {
      held.push({
        release: () => {
          resolve({ data: rowsFor(request) });
        },
        fail: () => {
          reject(new Error("The old window failed to load"));
        },
      });
    },
  );
}

function aggregateWindows(): Array<AggregateWindow> {
  return mockAggregate.mock.calls.map(
    (call: Array<unknown>): AggregateWindow => {
      const request: AggregateRequest = call[0] as AggregateRequest;
      return {
        name: request.aggregateBy.query.name,
        start: new Date(request.aggregateBy.startTimestamp),
        end: new Date(request.aggregateBy.endTimestamp),
      };
    },
  );
}

function goldenWindows(): Array<AggregateWindow> {
  return aggregateWindows().filter((window: AggregateWindow): boolean => {
    return GOLDEN_METRICS.includes(window.name);
  });
}

// The window each golden query of the most recent load asked for.
function latestGoldenLoad(): Array<AggregateWindow> {
  return goldenWindows().slice(-GOLDEN_METRICS.length);
}

function expectLatestLoadFor(start: Date, end: Date): void {
  const load: Array<AggregateWindow> = latestGoldenLoad();

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

async function renderOverview(): Promise<void> {
  render(<KubernetesClusterOverview {...PAGE_PROPS} />);
  await settle();
  expect(screen.getAllByTestId("line-chart")).toHaveLength(5);
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

function chartWindowOf(title: string): string {
  return windowOf(chartCard(title));
}

function chartWindows(): Array<string> {
  return CHART_TITLES.map((title: string): string => {
    return chartWindowOf(title);
  });
}

async function dragAcross(
  title: string,
  start: Date,
  end: Date,
): Promise<void> {
  await dragAcrossChartIn(chartCard(title), start, end);
}

async function doubleClickOn(title: string): Promise<void> {
  await doubleClickOnChartIn(chartCard(title));
}

function pickerLabel(): string {
  return (
    screen.getByTestId(`${TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX}-button`)
      .textContent || ""
  );
}

function customLabel(start: Date, end: Date): string {
  return getTimeRangeButtonLabel({
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(start, end),
  });
}

function resetZoomButton(): HTMLElement | null {
  return screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

const PAST_THIRTY_MINUTES_WINDOW: string = windowKey(
  PAST_THIRTY_MINUTES_START,
  NOW,
);
const DRAG_WINDOW: string = windowKey(DRAG_START, DRAG_END);
const NESTED_DRAG_WINDOW: string = windowKey(
  NESTED_DRAG_START,
  NESTED_DRAG_END,
);

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.localStorage.setItem(REFRESH_STORAGE_KEY, "off");

  heldAggregates = null;
  resetChartZoomStandIns();

  mockAggregate.mockReset();
  mockAggregate.mockImplementation((request: unknown) => {
    return answerAggregate(request as AggregateRequest);
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
  mockReceivingGaps.mockReset();
  mockReceivingGaps.mockImplementation(() => {
    return Promise.resolve({ data: { gaps: [] } });
  });
  mockFetchTopPods.mockReset();
  mockFetchTopPods.mockImplementation(() => {
    return Promise.resolve([]);
  });
  mockFetchWarnings.mockReset();
  mockFetchWarnings.mockImplementation(() => {
    return Promise.resolve([]);
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  jest.useRealTimers();
});

describe("cluster Overview before any zoom", () => {
  test("opens on Past 30 Minutes: every chart and every golden query covers it", async () => {
    await renderOverview();

    expect(pickerLabel()).toBe("Past 30 Minutes");
    expect(chartWindows()).toEqual(
      CHART_TITLES.map((): string => {
        return PAST_THIRTY_MINUTES_WINDOW;
      }),
    );
    expectLatestLoadFor(PAST_THIRTY_MINUTES_START, NOW);
    expect(screen.getByText(CPU_TILE_PAST_THIRTY_MINUTES)).toBeInTheDocument();
    expect(resetZoomButton()).toBeNull();
  });

  test("every chart takes one and the same zoom - the page's - and none is handed one of its own", async () => {
    await renderOverview();

    expect(chartZoomStandIns.lineCharts.length).toBeGreaterThanOrEqual(5);

    for (const record of chartZoomStandIns.lineCharts) {
      expect(record.hostSelect).toBeUndefined();
      expect(record.hostReset).toBeUndefined();
      expect(record.hostDisable).toBeUndefined();
      expect(record.select).toBeInstanceOf(Function);
    }

    const selects: Set<unknown> = new Set(
      chartZoomStandIns.lineCharts.map((record: ChartZoomRecord): unknown => {
        return record.select;
      }),
    );

    expect(selects.size).toBe(1);
  });

  test("no chart offers a reset while there is nothing to undo, so a stray double-click does nothing", async () => {
    await renderOverview();

    for (const record of chartZoomStandIns.lineCharts) {
      expect(record.reset).toBeUndefined();
    }

    const loadsBefore: number = goldenWindows().length;

    await doubleClickOn("CPU");

    expect(goldenWindows()).toHaveLength(loadsBefore);
    expect(pickerLabel()).toBe("Past 30 Minutes");
  });

  test("every golden chart card names the drag on hover", async () => {
    await renderOverview();

    const hints: Array<HTMLElement> = screen.getAllByTestId(
      TIME_RANGE_ZOOM_HINT_TEST_ID,
    );

    expect(hints).toHaveLength(5);

    for (const title of CHART_TITLES) {
      const hint: HTMLElement = within(chartCard(title)).getByTestId(
        TIME_RANGE_ZOOM_HINT_TEST_ID,
      );

      expect(hint).toHaveTextContent("Drag to zoom");
      expect(hint).toHaveClass("group-hover/zoomhint:opacity-100");
      expect(hint).toHaveClass("pointer-events-none");
    }
  });
});

describe("dragging across a cluster Overview chart", () => {
  test("narrows every chart on the page to the dragged window, not just the one dragged on", async () => {
    await renderOverview();

    await dragAcross("CPU", DRAG_START, DRAG_END);

    expect(chartWindows()).toEqual(
      CHART_TITLES.map((): string => {
        return DRAG_WINDOW;
      }),
    );
  });

  test("re-issues every golden-metrics query for the dragged window", async () => {
    await renderOverview();

    const loadsBefore: number = goldenWindows().length;

    await dragAcross("CPU", DRAG_START, DRAG_END);

    expect(goldenWindows()).toHaveLength(loadsBefore + GOLDEN_METRICS.length);
    expectLatestLoadFor(DRAG_START, DRAG_END);
  });

  test("the charts are drawn from the zoomed data, not the data from before", async () => {
    await renderOverview();

    await dragAcross("CPU", DRAG_START, DRAG_END);

    expect(
      within(chartCard("CPU"))
        .getByTestId("line-chart")
        .getAttribute("data-first-point"),
    ).toBe(DRAG_START.toISOString());
    expect(
      within(chartCard("Network"))
        .getByTestId("line-chart")
        .getAttribute("data-series"),
    ).toBe("In,Out");
  });

  test("the tiles follow: the CPU tile is read from the zoomed window's last five minutes", async () => {
    await renderOverview();

    await dragAcross("CPU", DRAG_START, DRAG_END);

    expect(screen.getByText(CPU_TILE_DRAG)).toBeInTheDocument();
    expect(screen.queryByText(CPU_TILE_PAST_THIRTY_MINUTES)).toBeNull();
  });

  test("the Availability tile and the uptime badge are read for the zoomed window as well", async () => {
    await renderOverview();

    const uptimeBadge: () => string = (): string => {
      return screen.getByText(/% uptime$/).textContent || "";
    };

    expect(uptimeBadge()).toBe(UPTIME_PAST_THIRTY_MINUTES);

    await dragAcross("Availability", DRAG_START, DRAG_END);

    expect(uptimeBadge()).toBe(UPTIME_DRAG);
    // The tile beside it says the same.
    expect(screen.getByText("100.0%")).toBeInTheDocument();

    await doubleClickOn("CPU");

    expect(uptimeBadge()).toBe(UPTIME_PAST_THIRTY_MINUTES);
  });

  test("the picker shows the dragged window as a custom range, with Reset zoom beside it", async () => {
    await renderOverview();

    await dragAcross("CPU", DRAG_START, DRAG_END);

    expect(pickerLabel()).toBe(customLabel(DRAG_START, DRAG_END));

    const reset: HTMLElement | null = resetZoomButton();

    expect(reset).toBeVisible();
    expect(reset).toHaveAttribute(
      "title",
      `Go back to ${getTimeRangeLabel(TimeRange.PAST_THIRTY_MINS)}, the time range before the zoom`,
    );
    // The button sits in the hero, beside the picker it undoes.
    expect(
      within(screen.getByTestId("auto-refresh-control")).getByTestId(
        RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
      ),
    ).toBe(reset);
  });

  test("every chart can now undo the zoom, and names the double-click", async () => {
    await renderOverview();

    await dragAcross("CPU", DRAG_START, DRAG_END);

    for (const title of CHART_TITLES) {
      expect(
        within(chartCard(title)).getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID),
      ).toHaveTextContent("Double-click to reset");
    }

    const zoomedRenders: Array<ChartZoomRecord> =
      chartZoomStandIns.lineCharts.slice(-5);

    for (const record of zoomedRenders) {
      expect(record.reset).toBeInstanceOf(Function);
    }
  });

  test("a drag from right to left zooms to the same window", async () => {
    await renderOverview();

    await dragAcross("Filesystem", DRAG_END, DRAG_START);

    expect(chartWindows()[0]).toBe(DRAG_WINDOW);
    expectLatestLoadFor(DRAG_START, DRAG_END);
  });

  test.each(CHART_TITLES)(
    "a drag on the %s chart zooms the whole page",
    async (title: string) => {
      await renderOverview();

      await dragAcross(title, DRAG_START, DRAG_END);

      expect(chartWindows()).toEqual(
        CHART_TITLES.map((): string => {
          return DRAG_WINDOW;
        }),
      );
      expect(pickerLabel()).toBe(customLabel(DRAG_START, DRAG_END));
    },
  );

  test("the 'now' snapshots - inventory, top consumers, warnings - are not refetched by a zoom", async () => {
    await renderOverview();

    const summaries: number = mockInventorySummary.mock.calls.length;
    const topPods: number = mockFetchTopPods.mock.calls.length;
    const warnings: number = mockFetchWarnings.mock.calls.length;

    await dragAcross("CPU", DRAG_START, DRAG_END);
    expect(chartWindowOf("CPU")).toBe(DRAG_WINDOW);
    await doubleClickOn("Memory");
    expect(chartWindowOf("CPU")).toBe(PAST_THIRTY_MINUTES_WINDOW);

    expect(mockInventorySummary.mock.calls).toHaveLength(summaries);
    expect(mockFetchTopPods.mock.calls).toHaveLength(topPods);
    expect(mockFetchWarnings.mock.calls).toHaveLength(warnings);
  });

  test("the 'Not monitored' stretches are asked for the zoomed window, every time the charts are", async () => {
    await renderOverview();

    const windowsAsked: () => Array<string> = (): Array<string> => {
      return mockReceivingGaps.mock.calls.map((call: Array<unknown>) => {
        const data: { startsAt: string; endsAt: string } = (
          call[0] as { data: { startsAt: string; endsAt: string } }
        ).data;
        return `${data.startsAt}|${data.endsAt}`;
      });
    };

    const before: number = windowsAsked().length;
    expect(before).toBeGreaterThan(0);

    await dragAcross("CPU", DRAG_START, DRAG_END);

    expect(windowsAsked().slice(before)).toContain(
      `${DRAG_START.toISOString()}|${DRAG_END.toISOString()}`,
    );
  });
});

describe("undoing a cluster Overview zoom", () => {
  test("a double-click on a DIFFERENT chart (Memory, after a drag on CPU) puts the page back on Past 30 Minutes", async () => {
    await renderOverview();

    await dragAcross("CPU", DRAG_START, DRAG_END);
    await doubleClickOn("Memory");

    expect(pickerLabel()).toBe("Past 30 Minutes");
    expect(chartWindows()).toEqual(
      CHART_TITLES.map((): string => {
        return PAST_THIRTY_MINUTES_WINDOW;
      }),
    );
    expect(resetZoomButton()).toBeNull();
  });

  test("the reset re-issues the golden queries for the original window, and the tiles read it again", async () => {
    await renderOverview();

    await dragAcross("CPU", DRAG_START, DRAG_END);
    await doubleClickOn("Memory");

    expectLatestLoadFor(PAST_THIRTY_MINUTES_START, NOW);
    expect(screen.getByText(CPU_TILE_PAST_THIRTY_MINUTES)).toBeInTheDocument();
  });

  test("once undone, no chart offers a reset any more", async () => {
    await renderOverview();

    await dragAcross("CPU", DRAG_START, DRAG_END);
    await doubleClickOn("Memory");

    for (const record of chartZoomStandIns.lineCharts.slice(-5)) {
      expect(record.reset).toBeUndefined();
    }

    for (const title of CHART_TITLES) {
      expect(
        within(chartCard(title)).getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID),
      ).toHaveTextContent(/^Drag to zoom$/);
    }
  });

  test("Reset zoom beside the picker does what a double-click does", async () => {
    await renderOverview();

    await dragAcross("Network", DRAG_START, DRAG_END);
    fireEvent.click(resetZoomButton()!);
    await settle();

    expect(pickerLabel()).toBe("Past 30 Minutes");
    expect(chartWindows()).toEqual(
      CHART_TITLES.map((): string => {
        return PAST_THIRTY_MINUTES_WINDOW;
      }),
    );
    expectLatestLoadFor(PAST_THIRTY_MINUTES_START, NOW);
    expect(resetZoomButton()).toBeNull();
  });

  test("a second drag inside the zoom narrows further, and ONE reset returns all the way to Past 30 Minutes", async () => {
    await renderOverview();

    await dragAcross("CPU", DRAG_START, DRAG_END);
    await dragAcross("Filesystem", NESTED_DRAG_START, NESTED_DRAG_END);

    expect(chartWindows()).toEqual(
      CHART_TITLES.map((): string => {
        return NESTED_DRAG_WINDOW;
      }),
    );
    expectLatestLoadFor(NESTED_DRAG_START, NESTED_DRAG_END);
    expect(pickerLabel()).toBe(customLabel(NESTED_DRAG_START, NESTED_DRAG_END));
    expect(screen.getByText(CPU_TILE_NESTED_DRAG)).toBeInTheDocument();
    // Still offering the way back to where the reader started.
    expect(resetZoomButton()).toHaveAttribute(
      "title",
      `Go back to ${getTimeRangeLabel(TimeRange.PAST_THIRTY_MINS)}, the time range before the zoom`,
    );

    await doubleClickOn("Availability");

    expect(pickerLabel()).toBe("Past 30 Minutes");
    expect(chartWindows()).toEqual(
      CHART_TITLES.map((): string => {
        return PAST_THIRTY_MINUTES_WINDOW;
      }),
    );
    expectLatestLoadFor(PAST_THIRTY_MINUTES_START, NOW);
    expect(resetZoomButton()).toBeNull();
  });

  test("picking a range in the picker ends the zoom: no Reset zoom, and a double-click no longer retimes the page", async () => {
    await renderOverview();

    await dragAcross("CPU", DRAG_START, DRAG_END);
    expect(resetZoomButton()).toBeVisible();

    fireEvent.click(
      screen.getByTestId(
        `${TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX}-button`,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Past 1 Hour" }));
    await settle();

    const oneHourAgo: Date = new Date(NOW.getTime() - 60 * MINUTE_MS);

    expect(pickerLabel()).toBe("Past 1 Hour");
    expect(resetZoomButton()).toBeNull();
    expect(chartWindowOf("CPU")).toBe(windowKey(oneHourAgo, NOW));
    expectLatestLoadFor(oneHourAgo, NOW);

    const loadsBefore: number = goldenWindows().length;

    await doubleClickOn("CPU");

    expect(goldenWindows()).toHaveLength(loadsBefore);
    expect(pickerLabel()).toBe("Past 1 Hour");
  });

  test("a zoom made after picking a range undoes back to THAT range", async () => {
    await renderOverview();

    fireEvent.click(
      screen.getByTestId(
        `${TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX}-button`,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Past 1 Hour" }));
    await settle();

    await dragAcross("CPU", DRAG_START, DRAG_END);

    expect(resetZoomButton()).toHaveAttribute(
      "title",
      `Go back to ${TimeRange.PAST_ONE_HOUR}, the time range before the zoom`,
    );

    await doubleClickOn("Network");

    expect(pickerLabel()).toBe("Past 1 Hour");
    expect(chartWindowOf("Memory")).toBe(
      windowKey(new Date(NOW.getTime() - 60 * MINUTE_MS), NOW),
    );
  });
});

describe("the cluster Overview zoom and its data loads", () => {
  test("auto-refresh keeps a zoomed page on the zoomed window, and the reset still works afterwards", async () => {
    window.localStorage.setItem(REFRESH_STORAGE_KEY, "30s");

    await renderOverview();
    await dragAcross("CPU", DRAG_START, DRAG_END);

    const loadsBefore: number = goldenWindows().length;

    await act(async () => {
      jest.advanceTimersByTime(30 * 1000);
    });
    await settle();

    // The tick reloaded, and for the pinned window rather than "now".
    expect(goldenWindows().length).toBe(loadsBefore + GOLDEN_METRICS.length);
    expectLatestLoadFor(DRAG_START, DRAG_END);
    expect(chartWindowOf("CPU")).toBe(DRAG_WINDOW);
    expect(pickerLabel()).toBe(customLabel(DRAG_START, DRAG_END));
    expect(resetZoomButton()).toBeVisible();

    await doubleClickOn("CPU");

    // Back on the preset, which now ends at the clock the tick moved on.
    const now: Date = new Date(Date.now());
    const thirtyMinutesEarlier: Date = new Date(now.getTime() - 30 * MINUTE_MS);

    expect(pickerLabel()).toBe("Past 30 Minutes");
    expect(chartWindowOf("CPU")).toBe(windowKey(thirtyMinutesEarlier, now));
    expectLatestLoadFor(thirtyMinutesEarlier, now);
  });

  test("a manual Refresh while zoomed reloads the zoomed window and keeps the zoom", async () => {
    await renderOverview();
    await dragAcross("CPU", DRAG_START, DRAG_END);

    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    await settle();

    expectLatestLoadFor(DRAG_START, DRAG_END);
    expect(chartWindowOf("Availability")).toBe(DRAG_WINDOW);
    expect(resetZoomButton()).toBeVisible();
  });

  test("a slow load from before the zoom cannot drag the charts back to the old window", async () => {
    await renderOverview();

    // A refresh for Past 30 Minutes goes out and is slow to answer...
    heldAggregates = [];
    const slowLoad: Array<{ release: () => void; fail: () => void }> =
      heldAggregates;
    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    await settle();
    heldAggregates = null;

    // ...the reader zooms in the meantime, and that answer comes back first.
    await dragAcross("CPU", DRAG_START, DRAG_END);
    expect(chartWindows()[0]).toBe(DRAG_WINDOW);

    for (const held of slowLoad) {
      held.release();
    }
    await settle();

    expect(chartWindows()).toEqual(
      CHART_TITLES.map((): string => {
        return DRAG_WINDOW;
      }),
    );
    expect(screen.getByText(CPU_TILE_DRAG)).toBeInTheDocument();
    expect(pickerLabel()).toBe(customLabel(DRAG_START, DRAG_END));
    expect(
      screen
        .getByTestId("auto-refresh-control")
        .getAttribute("data-refreshing"),
    ).toBe("false");
  });

  test("a load from before a reset that fails late does not put an error over the reset page", async () => {
    await renderOverview();
    await dragAcross("CPU", DRAG_START, DRAG_END);

    heldAggregates = [];
    const slowLoad: Array<{ release: () => void; fail: () => void }> =
      heldAggregates;
    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    await settle();
    heldAggregates = null;

    await doubleClickOn("Memory");
    expect(chartWindows()[0]).toBe(PAST_THIRTY_MINUTES_WINDOW);

    for (const held of slowLoad) {
      held.fail();
    }
    await settle();

    expect(screen.queryByText("The old window failed to load")).toBeNull();
    expect(chartWindows()).toEqual(
      CHART_TITLES.map((): string => {
        return PAST_THIRTY_MINUTES_WINDOW;
      }),
    );
  });

  test("allocatable CPU is read for the page's window, and never less than five minutes of it", async () => {
    await renderOverview();

    const allocatableFor: () => AggregateWindow = (): AggregateWindow => {
      const windows: Array<AggregateWindow> = aggregateWindows().filter(
        (window: AggregateWindow): boolean => {
          return window.name === ALLOCATABLE_CPU_METRIC;
        },
      );
      return windows[windows.length - 1]!;
    };

    // Past 30 Minutes: exactly the page's window (the golden load's lookup).
    const initialLookups: Array<string> = aggregateWindows()
      .filter((window: AggregateWindow): boolean => {
        return window.name === ALLOCATABLE_CPU_METRIC;
      })
      .map((window: AggregateWindow): string => {
        return windowKey(window.start, window.end);
      });
    expect(initialLookups).toContain(PAST_THIRTY_MINUTES_WINDOW);

    // A ten-minute zoom is wide enough to be read as it is.
    await dragAcross("CPU", DRAG_START, DRAG_END);
    expect(windowKey(allocatableFor().start, allocatableFor().end)).toBe(
      DRAG_WINDOW,
    );

    // A 40-second zoom would fall between samples: reach back five minutes.
    const shortStart: Date = new Date("2026-09-28T11:42:00.000Z");
    const shortEnd: Date = new Date("2026-09-28T11:42:40.000Z");
    await dragAcross("CPU", shortStart, shortEnd);

    expectLatestLoadFor(shortStart, shortEnd);
    expect(windowKey(allocatableFor().start, allocatableFor().end)).toBe(
      windowKey(new Date(shortEnd.getTime() - 5 * MINUTE_MS), shortEnd),
    );
    // So the CPU chart still has its denominator and draws.
    expect(
      within(chartCard("CPU"))
        .getByTestId("line-chart")
        .getAttribute("data-series"),
    ).toBe("CPU %");
  });
});

describe("ClusterChartCard on its own", () => {
  const WINDOW: { start: Date; end: Date } = {
    start: PAST_THIRTY_MINUTES_START,
    end: NOW,
  };

  function zoom(isZoomed: boolean): TimeRangeZoom {
    return {
      isZoomed: isZoomed,
      rangeBeforeZoom: isZoomed ? { range: TimeRange.PAST_ONE_HOUR } : null,
      zoomToTimeRange: () => {},
      resetZoom: () => {},
    };
  }

  function card(
    chartWindow: { start: Date; end: Date } | null,
  ): React.ReactElement {
    return (
      <ClusterChartCard
        title="CPU"
        icon={IconProp.ChartBar}
        iconColor="blue"
        data={[]}
        chartWindow={chartWindow}
        syncId="kubernetes-overview-x"
      />
    );
  }

  test("outside a page that zooms it shows no hint and its chart offers no zoom", () => {
    render(card(WINDOW));

    expect(screen.queryByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toBeNull();
    expect(
      chartZoomStandIns.lineCharts[chartZoomStandIns.lineCharts.length - 1]
        ?.select,
    ).toBeUndefined();
  });

  test("inside one, the hint is revealed on hover of the card and kept out of the header's way", () => {
    render(
      <TimeRangeZoomProvider zoom={zoom(false)}>
        {card(WINDOW)}
      </TimeRangeZoomProvider>,
    );

    const hint: HTMLElement = screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID);

    expect(hint).toHaveTextContent("Drag to zoom");
    expect(hint).toHaveClass("group-hover/zoomhint:opacity-100");
    expect(hint).toHaveClass("absolute");
    expect(hint.closest('[class~="group/zoomhint"]')).toBe(
      screen.getByTestId("line-chart").closest('[class~="group/zoomhint"]'),
    );
  });

  test("the hint is there before the chart is, and names the reset while zoomed", () => {
    render(
      <TimeRangeZoomProvider zoom={zoom(true)}>
        {card(null)}
      </TimeRangeZoomProvider>,
    );

    expect(screen.queryByTestId("line-chart")).toBeNull();
    expect(screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toHaveTextContent(
      "Double-click to reset",
    );
  });
});
