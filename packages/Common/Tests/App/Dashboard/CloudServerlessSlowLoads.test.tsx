/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 follow-up on the Cloud environment and Serverless function
 * overviews when the span metrics are slower than the 30-second
 * auto-refresh. Their metrics effect was keyed on the model object, which
 * every tick replaced (the tick reloads the model), so its staleness guard
 * cancelled the metrics load still running for the same window and started
 * an identical one. When every load outlasted the interval, none ever
 * landed: the Requests / Invocations, Error rate and p95 tiles loading for
 * good, both charts skeletons, nothing to zoom.
 *
 * Each page is rendered for real (ResourceOverview, ChartCard, the hero's
 * AutoRefreshControl and picker) with the model and the instances answered
 * at once and the metric aggregates parked until a test answers them:
 *
 *   - a tick while the metrics load leaves it alone (the model and the live
 *     instance figures still refresh); it lands and fills the page;
 *   - a tick once they have landed reloads them for the slid window;
 *   - a zoom, its reset and Refresh still replace a running load, and the
 *     newest window wins whichever answer lands first;
 *   - the replaced load's answer landing does not let a tick replace the
 *     zoom's load while that one still runs.
 */

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const MIB: number = 1024 * 1024;

// A time on the test's day, e.g. at("11:36") or at("12:00:30").
function at(time: string): Date {
  const withSeconds: string = time.length === 5 ? `${time}:00` : time;
  return new Date(`2026-09-28T${withSeconds}.000Z`);
}

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      count: (...args: Array<unknown>): unknown => {
        return countMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>): unknown => {
        return aggregateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("aaaaaaaa-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("cccccccc-0000-4000-8000-000000000003");
      },
      navigate: (): void => {},
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (): string => {
        return "failed";
      },
    },
  };
});

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  const harness: { StandInLineChart: unknown } = jest.requireActual(
    "./TimeRangeZoomPageHarness",
  ) as { StandInLineChart: unknown };
  return { __esModule: true, default: harness.StandInLineChart };
});

import CloudResourceOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Overview";
import ServerlessFunctionOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Serverless/View/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  AUTO_REFRESH_MS,
  advance,
  Backlog,
  expectRefreshSettled,
} from "./SlowLoadHarness";
import {
  chartWindows,
  customRangeLabel,
  doubleClick,
  dragAcross,
  flush,
  pickerLabel,
  presetLabel,
  resetZoomButtons,
  windowOf,
  zoomCharts,
} from "./TimeRangeZoomPageHarness";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;
const PAST_HOUR: string = presetLabel(TimeRange.PAST_ONE_HOUR);

interface AggregateCall {
  modelType: { name: string };
  aggregateBy: {
    aggregationType: string;
    query: Record<string, unknown>;
    startTimestamp: Date;
    endTimestamp: Date;
  };
}

type Point = { timestamp: Date; value: number };

// A metric aggregate, parked until the test answers it.
interface SlowCall {
  start: Date;
  end: Date;
}

const backlog: Backlog<SlowCall> = new Backlog<SlowCall>();
let slow: boolean = true;

function endsAt(end: Date): (call: SlowCall) => boolean {
  return (call: SlowCall): boolean => {
    return call.end.getTime() === end.getTime();
  };
}

function same<T>(value: T, count: number): Array<T> {
  return Array.from({ length: count }, (): T => {
    return value;
  });
}

/*
 * One bucket a minute from 11:00 to 11:59, inside the asked-for window:
 * 10 spans a minute of which 1 errored, a 250 ms p95, 512 MiB of memory.
 * Over 11:00-12:00 that is 600 requests; over 11:00:30-12:00:30 (from
 * 11:01) 590; over 11:20-11:30 (11 buckets) 110.
 */
function points(call: AggregateCall): Array<Point> {
  const start: number = call.aggregateBy.startTimestamp.getTime();
  const end: number = call.aggregateBy.endTimestamp.getTime();
  const isError: boolean = call.aggregateBy.query["statusCode"] !== undefined;
  const value: number =
    call.modelType.name === "Metric"
      ? 512 * MIB
      : call.aggregateBy.aggregationType === "P95"
        ? 2.5e8
        : isError
          ? 1
          : 10;
  const result: Array<Point> = [];

  for (let minute: number = 0; minute < 60; minute++) {
    const time: Date = new Date(Date.UTC(2026, 8, 28, 11, minute));

    if (time.getTime() >= start && time.getTime() <= end) {
      result.push({ timestamp: time, value: value });
    }
  }

  return result;
}

interface OverviewCase {
  Page: React.FunctionComponent<PageComponentProps>;
  model: Record<string, unknown>;
  // Aggregates one metrics load asks for.
  metricsPerLoad: number;
  // The span-count tile: Requests on Cloud, Invocations on Serverless.
  countTile: string;
  // Calls that refresh the page's live figures on every refresh.
  liveCalls: () => number;
}

const OVERVIEWS: Array<[string, OverviewCase]> = [
  [
    "Cloud environment overview",
    {
      Page: CloudResourceOverview,
      model: {
        name: "prod · us-east-1",
        resourceIdentifier: "aws_ecs|123456789012|us-east-1",
        otelCollectorStatus: "connected",
        cloudPlatform: "aws_ecs",
        cloudProvider: "aws",
        cloudRegion: "us-east-1",
        cloudAccountId: "123456789012",
      },
      metricsPerLoad: 4, // 3 span aggregates + container memory
      countTile: "Requests",
      liveCalls: (): number => {
        return getListMock.mock.calls.length; // the instance list
      },
    },
  ],
  [
    "Serverless function overview",
    {
      Page: ServerlessFunctionOverview,
      model: {
        name: "checkout-handler",
        functionIdentifier: "checkout-handler",
        otelCollectorStatus: "connected",
        cloudPlatform: "aws_lambda",
        cloudRegion: "us-east-1",
        runtimeName: "nodejs",
        runtimeVersion: "20",
      },
      metricsPerLoad: 3, // count, errors, p95
      countTile: "Invocations",
      liveCalls: (): number => {
        return countMock.mock.calls.length; // the instance count
      },
    },
  ],
];

function tileOf(title: string): HTMLElement {
  // The first "About <title>" is the tile's; a chart card may share it.
  return screen
    .getAllByRole("button", { name: `About ${title}` })[0]!
    .closest(".rounded-xl") as HTMLElement;
}

async function mount(overview: OverviewCase): Promise<void> {
  // A fresh object per fetch, as the API returns.
  getItemMock.mockImplementation((): Promise<unknown> => {
    return Promise.resolve({ ...overview.model });
  });
  render(
    <MemoryRouter>
      <overview.Page {...PAGE_PROPS} />
    </MemoryRouter>,
  );
  await flush();
}

// Renders the page with its first metrics load answered at once.
async function mountPainted(overview: OverviewCase): Promise<void> {
  slow = false;
  await mount(overview);
  expect(zoomCharts()).toHaveLength(2);
  slow = true;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.localStorage.clear();
  getItemMock.mockReset();
  getListMock.mockReset();
  countMock.mockReset();
  aggregateMock.mockReset();
  backlog.clear();
  slow = true;

  getListMock.mockImplementation((): Promise<unknown> => {
    return Promise.resolve({
      data: [
        {
          instanceName: "task-a",
          latestCpuPercent: 80,
          latestMemoryBytes: 512 * MIB,
          lastSeenAt: new Date(Date.now() - 60_000),
        },
      ],
    });
  });
  countMock.mockResolvedValue(3);
  aggregateMock.mockImplementation((request: unknown): Promise<unknown> => {
    const call: AggregateCall = request as AggregateCall;
    const answer: { data: Array<Point> } = { data: points(call) };

    if (slow) {
      return backlog.park(
        {
          start: call.aggregateBy.startTimestamp,
          end: call.aggregateBy.endTimestamp,
        },
        answer,
      );
    }

    return Promise.resolve(answer);
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe.each(OVERVIEWS)(
  "%s: metrics that outlast the auto-refresh",
  (_name: string, overview: OverviewCase) => {
    test("a tick while the metrics load leaves it alone; it lands, fills the tiles and draws both charts", async () => {
      await mount(overview);

      expect(backlog.calls()).toHaveLength(overview.metricsPerLoad);
      expect(zoomCharts()).toHaveLength(0);
      const modelLoads: number = getItemMock.mock.calls.length;

      await advance(AUTO_REFRESH_MS);

      // The model reloaded; the metrics load was left to run.
      expect(getItemMock.mock.calls.length).toBe(modelLoads + 1);
      expect(backlog.calls()).toHaveLength(overview.metricsPerLoad);
      expectRefreshSettled();

      await advance(5_000);
      await backlog.release(endsAt(NOW));

      expect(tileOf(overview.countTile)).toHaveTextContent("600");
      expect(zoomCharts()).toHaveLength(2);
      expect(chartWindows()).toEqual(same(windowOf(at("11:00"), NOW), 2));
    });

    test("the model and the live instance figures still refresh on every tick while the metrics load", async () => {
      await mount(overview);
      const modelLoads: number = getItemMock.mock.calls.length;
      const liveLoads: number = overview.liveCalls();

      await advance(AUTO_REFRESH_MS);
      await advance(AUTO_REFRESH_MS);

      expect(getItemMock.mock.calls.length).toBe(modelLoads + 2);
      expect(overview.liveCalls()).toBe(liveLoads + 2);
      // All the while, one metrics load: the first.
      expect(backlog.calls()).toHaveLength(overview.metricsPerLoad);
    });

    test("after a load that outlasted three ticks lands, the next tick reloads the metrics for the slid hour, once", async () => {
      await mount(overview);

      await advance(3 * AUTO_REFRESH_MS + 5_000);
      expect(backlog.calls()).toHaveLength(overview.metricsPerLoad);
      await backlog.release(endsAt(NOW));
      expect(tileOf(overview.countTile)).toHaveTextContent("600");

      // 12:02:00: one tick, one metrics load, for the hour up to it.
      await advance(AUTO_REFRESH_MS - 5_000);
      expect(backlog.calls()).toHaveLength(overview.metricsPerLoad);
      expect(backlog.calls().every(endsAt(at("12:02")))).toBe(true);

      // 12:02:30: still running, so this tick leaves it alone.
      await advance(AUTO_REFRESH_MS);
      expect(backlog.calls()).toHaveLength(overview.metricsPerLoad);

      await backlog.release(endsAt(at("12:02")));
      expect(chartWindows()).toEqual(
        same(windowOf(at("11:02"), at("12:02")), 2),
      );
    });

    test("each tick once the metrics have landed reloads them for the slid hour", async () => {
      await mountPainted(overview);

      await advance(AUTO_REFRESH_MS);

      expect(backlog.calls()).toHaveLength(overview.metricsPerLoad);
      expect(backlog.calls().every(endsAt(at("12:00:30")))).toBe(true);
      await backlog.release(endsAt(at("12:00:30")));
      expect(tileOf(overview.countTile)).toHaveTextContent("590");
      expect(chartWindows()).toEqual(
        same(windowOf(at("11:00:30"), at("12:00:30")), 2),
      );
    });

    test("a drag during a slow auto-refresh load wins when its answer lands first", async () => {
      await mountPainted(overview);

      await advance(AUTO_REFRESH_MS);
      await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:30"));
      expect(backlog.calls()).toHaveLength(2 * overview.metricsPerLoad);

      await backlog.release(endsAt(at("11:30")));
      await backlog.release(endsAt(at("12:00:30")));

      expect(tileOf(overview.countTile)).toHaveTextContent("110");
      expect(chartWindows()).toEqual(
        same(windowOf(at("11:20"), at("11:30")), 2),
      );
      expect(pickerLabel()).toBe(customRangeLabel(at("11:20"), at("11:30")));
    });

    test("a drag during a slow auto-refresh load wins when the older answer lands first", async () => {
      await mountPainted(overview);

      await advance(AUTO_REFRESH_MS);
      await dragAcross(zoomCharts()[1]!, at("11:20"), at("11:30"));

      await backlog.release(endsAt(at("12:00:30")));
      // The replaced load is dropped: the tiles still wait for the zoom's.
      expect(tileOf(overview.countTile)).not.toHaveTextContent("590");

      await backlog.release(endsAt(at("11:30")));
      expect(tileOf(overview.countTile)).toHaveTextContent("110");
      expect(chartWindows()).toEqual(
        same(windowOf(at("11:20"), at("11:30")), 2),
      );
    });

    test("the replaced load landing does not let the next tick replace the zoom's load, which still lands", async () => {
      await mountPainted(overview);

      await advance(AUTO_REFRESH_MS);
      await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:30"));
      await advance(5_000);
      await backlog.release(endsAt(at("12:00:30")));

      // 12:01:00: the zoom's load is still running; the tick leaves it.
      await advance(AUTO_REFRESH_MS - 5_000);
      expect(backlog.calls()).toHaveLength(overview.metricsPerLoad);
      expect(backlog.calls().every(endsAt(at("11:30")))).toBe(true);

      await backlog.release(endsAt(at("11:30")));
      expect(tileOf(overview.countTile)).toHaveTextContent("110");
      expect(resetZoomButtons()).toHaveLength(1);
    });

    test("a double-click during the zoom's slow load puts the hour back, and that load wins", async () => {
      await mountPainted(overview);

      await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:30"));
      await advance(AUTO_REFRESH_MS);
      expect(backlog.calls()).toHaveLength(overview.metricsPerLoad);

      await doubleClick(zoomCharts()[1]!);
      await backlog.release(endsAt(at("12:00:30")));
      await backlog.release(endsAt(at("11:30")));

      expect(tileOf(overview.countTile)).toHaveTextContent("590");
      expect(chartWindows()).toEqual(
        same(windowOf(at("11:00:30"), at("12:00:30")), 2),
      );
      expect(pickerLabel()).toBe(PAST_HOUR);
    });

    test("Refresh while the metrics load starts them again at once, and the newer answer wins", async () => {
      await mount(overview);
      await advance(10_000);

      fireEvent.click(screen.getByTitle("Refresh now"));
      await flush();
      expect(backlog.calls()).toHaveLength(2 * overview.metricsPerLoad);

      // The first load, for the hour up to 12:00:00, is not drawn...
      await backlog.release(endsAt(NOW));
      expect(zoomCharts()).toHaveLength(0);

      // ...the Refresh's, for the hour up to 12:00:10, is.
      await backlog.release(endsAt(at("12:00:10")));
      expect(tileOf(overview.countTile)).toHaveTextContent("590");
      expect(chartWindows()).toEqual(
        same(windowOf(at("11:00:10"), at("12:00:10")), 2),
      );
    });

    test("with auto-refresh off, a slow metrics load lands as it always did", async () => {
      window.localStorage.setItem(
        overview.countTile === "Requests"
          ? "cloud-overview-auto-refresh-interval"
          : "serverless-overview-auto-refresh-interval",
        "off",
      );
      await mount(overview);

      await advance(5 * AUTO_REFRESH_MS);
      expect(backlog.calls()).toHaveLength(overview.metricsPerLoad);

      await backlog.release(endsAt(NOW));
      expect(tileOf(overview.countTile)).toHaveTextContent("600");
    });
  },
);

describe("Cloud environment overview: an environment with no scope yet", () => {
  test("never queries the metrics, tick or Refresh", async () => {
    await mount({
      ...OVERVIEWS[0]![1],
      model: {
        name: "hand-made",
        resourceIdentifier: "manual|env",
        otelCollectorStatus: "disconnected",
      },
    });

    await advance(AUTO_REFRESH_MS);
    fireEvent.click(screen.getByTitle("Refresh now"));
    await flush();
    await advance(AUTO_REFRESH_MS);

    expect(aggregateMock).not.toHaveBeenCalled();
    expect(tileOf("Requests")).toHaveTextContent("—");
  });
});
