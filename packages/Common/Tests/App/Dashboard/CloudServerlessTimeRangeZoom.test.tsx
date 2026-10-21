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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 on the Cloud environment and Serverless function overviews.
 * Each page is rendered for real (ResourceOverview, ChartCard, the real
 * time picker) with the network mocked and the line chart replaced by the
 * zoom stand-in (see TimeRangeZoomPageHarness):
 *
 *   - both trend charts hold the page's one zoom;
 *   - a drag on either refetches the span metrics (charts and the Requests
 *     / Invocations, Error rate and p95 tiles) for the window dragged out,
 *     and the picker reads Custom with Reset zoom beside it;
 *   - a double-click on the other chart, or Reset zoom, puts the hour back;
 *   - the live tiles (CPU, Memory, Instances) are not refetched by a zoom;
 *   - auto-refresh keeps a zoom pinned; a slow response for a window the
 *     reader left cannot land on the page.
 */

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const MIB: number = 1024 * 1024;

function at(time: string): Date {
  return new Date(`2026-09-28T${time}:00.000Z`);
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    const harness: { StandInAutoRefreshControl: unknown } = jest.requireActual(
      "./TimeRangeZoomPageHarness",
    ) as {
      StandInAutoRefreshControl: unknown;
    };
    return { __esModule: true, default: harness.StandInAutoRefreshControl };
  },
);

import CloudResourceOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Overview";
import ServerlessFunctionOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Serverless/View/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  chartWindows,
  customRangeLabel,
  deferred,
  Deferred,
  doubleClick,
  dragAcross,
  expectOneSharedZoom,
  expectRevealedOnHoverOf,
  flush,
  pickPreset,
  pickerLabel,
  presetLabel,
  resetZoomButtons,
  windowOf,
  zoomCharts,
  zoomHints,
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

function aggregateCalls(): Array<AggregateCall> {
  return aggregateMock.mock.calls.map((args: Array<unknown>): AggregateCall => {
    return args[0] as AggregateCall;
  });
}

function windowsOf(calls: Array<AggregateCall>): Array<[string, string]> {
  return calls.map((call: AggregateCall): [string, string] => {
    return [
      call.aggregateBy.startTimestamp.toISOString(),
      call.aggregateBy.endTimestamp.toISOString(),
    ];
  });
}

function same<T>(value: T, count: number): Array<T> {
  return Array.from({ length: count }, (): T => {
    return value;
  });
}

// From when there is any telemetry at all.
let telemetryFrom: Date = at("11:00");

/*
 * One bucket a minute from 11:00 to 11:59, inside the asked-for window:
 * 10 spans a minute of which 1 errored, a 250 ms p95, 512 MiB of memory.
 * Over the hour that is 600 requests; over 11:20-11:30 (11 buckets), 110.
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

    if (
      time.getTime() >= start &&
      time.getTime() <= end &&
      time.getTime() >= telemetryFrom.getTime()
    ) {
      result.push({ timestamp: time, value: value });
    }
  }

  return result;
}

interface HeldAggregate {
  call: AggregateCall;
  release: () => void;
}

let holdAggregates: boolean = false;
let heldAggregates: Array<HeldAggregate> = [];

async function releaseAggregatesEndingAt(end: Date): Promise<void> {
  const releasing: Array<HeldAggregate> = heldAggregates.filter(
    (held: HeldAggregate): boolean => {
      return held.call.aggregateBy.endTimestamp.getTime() === end.getTime();
    },
  );

  heldAggregates = heldAggregates.filter((held: HeldAggregate): boolean => {
    return !releasing.includes(held);
  });

  expect(releasing.length).toBeGreaterThan(0);

  for (const held of releasing) {
    held.release();
  }

  await flush();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.localStorage.clear();
  getItemMock.mockReset();
  getListMock.mockReset();
  countMock.mockReset();
  aggregateMock.mockReset();
  holdAggregates = false;
  heldAggregates = [];
  telemetryFrom = at("11:00");

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
  aggregateMock.mockImplementation((request: unknown) => {
    const call: AggregateCall = request as AggregateCall;
    const answer: { data: Array<Point> } = { data: points(call) };

    if (holdAggregates) {
      const held: Deferred<{ data: Array<Point> }> = deferred<{
        data: Array<Point>;
      }>();
      heldAggregates.push({
        call: call,
        release: (): void => {
          held.resolve(answer);
        },
      });
      return held.promise;
    }

    return Promise.resolve(answer);
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

function tileOf(title: string): HTMLElement {
  // The first "About <title>" is the tile's; a chart card may share it.
  return screen
    .getAllByRole("button", { name: `About ${title}` })[0]!
    .closest(".rounded-xl") as HTMLElement;
}

// ---------------------------------------------------------------------- cloud

const CLOUD_FETCHES: number = 4; // 3 span aggregates + container memory

/*
 * A fresh object per fetch, as the API returns: the pages refetch their
 * metrics when the model object changes (that is how auto-refresh reaches
 * them).
 */
function answerGetItemWith(item: Record<string, unknown>): void {
  getItemMock.mockImplementation((): Promise<unknown> => {
    return Promise.resolve({ ...item });
  });
}

async function renderCloud(): Promise<void> {
  answerGetItemWith({
    name: "prod · us-east-1",
    resourceIdentifier: "aws_ecs|123456789012|us-east-1",
    otelCollectorStatus: "connected",
    cloudPlatform: "aws_ecs",
    cloudProvider: "aws",
    cloudRegion: "us-east-1",
    cloudAccountId: "123456789012",
  });
  render(
    <MemoryRouter>
      <CloudResourceOverview {...PAGE_PROPS} />
    </MemoryRouter>,
  );
  await flush();
  expect(zoomCharts()).toHaveLength(2);
}

function lastCloudWindows(): Array<[string, string]> {
  return windowsOf(aggregateCalls().slice(-CLOUD_FETCHES));
}

describe("Cloud environment overview: one zoom for both charts", () => {
  test("Requests and Memory hold the page's one zoom; each card names the gesture on hover", async () => {
    await renderCloud();

    expectOneSharedZoom({ zoomed: false });
    expect(chartWindows()).toEqual(same(windowOf(at("11:00"), NOW), 2));
    expect(pickerLabel()).toBe(PAST_HOUR);

    const hints: Array<HTMLElement> = zoomHints();
    expect(hints).toHaveLength(2);
    for (const hint of hints) {
      expect(hint).toHaveTextContent("Drag to zoom");
      expect(
        expectRevealedOnHoverOf(hint).querySelector(
          '[data-testid="zoom-chart"]',
        ),
      ).not.toBeNull();
    }
  });

  test("a drag on Memory refetches both charts and the span tiles for the window", async () => {
    await renderCloud();
    expect(tileOf("Requests")).toHaveTextContent("600");
    const instanceLoads: number = getListMock.mock.calls.length;

    await dragAcross(zoomCharts()[1]!, at("11:20"), at("11:30"));

    expect(lastCloudWindows()).toEqual(
      same(windowOf(at("11:20"), at("11:30")), CLOUD_FETCHES),
    );
    expect(chartWindows()).toEqual(same(windowOf(at("11:20"), at("11:30")), 2));
    expect(tileOf("Requests")).toHaveTextContent("110");
    // CPU, Memory and Instances are the live instance list: not refetched.
    expect(getListMock.mock.calls.length).toBe(instanceLoads);

    expect(pickerLabel()).toBe(customRangeLabel(at("11:20"), at("11:30")));
    expect(resetZoomButtons()).toHaveLength(1);
    expectOneSharedZoom({ zoomed: true });
  });

  test("a double-click on Requests puts the hour back", async () => {
    await renderCloud();
    await dragAcross(zoomCharts()[1]!, at("11:20"), at("11:30"));

    await doubleClick(zoomCharts()[0]!);

    expect(lastCloudWindows()).toEqual(
      same(windowOf(at("11:00"), NOW), CLOUD_FETCHES),
    );
    expect(tileOf("Requests")).toHaveTextContent("600");
    expect(pickerLabel()).toBe(PAST_HOUR);
    expect(resetZoomButtons()).toHaveLength(0);
    expectOneSharedZoom({ zoomed: false });
  });

  test("Reset zoom beside the picker puts the hour back after nested zooms", async () => {
    await renderCloud();
    await dragAcross(zoomCharts()[0]!, at("11:10"), at("11:50"));
    await dragAcross(zoomCharts()[1]!, at("11:20"), at("11:30"));

    fireEvent.click(resetZoomButtons()[0]!);
    await flush();

    expect(lastCloudWindows()[0]).toEqual(windowOf(at("11:00"), NOW));
    expect(pickerLabel()).toBe(PAST_HOUR);
  });

  test("the picker ends the zoom", async () => {
    await renderCloud();
    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:30"));

    await pickPreset("Past 30 Minutes");

    expect(lastCloudWindows()[0]).toEqual(windowOf(at("11:30"), NOW));
    expect(resetZoomButtons()).toHaveLength(0);
  });

  test("auto-refresh while zoomed refetches the zoomed window and keeps the zoom", async () => {
    await renderCloud();
    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:30"));
    const afterZoom: number = aggregateCalls().length;

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flush();

    expect(aggregateCalls().length).toBe(afterZoom + CLOUD_FETCHES);
    expect(lastCloudWindows()).toEqual(
      same(windowOf(at("11:20"), at("11:30")), CLOUD_FETCHES),
    );
    expect(resetZoomButtons()).toHaveLength(1);
  });

  test("a chart zoomed into a quiet stretch resets from its empty state", async () => {
    telemetryFrom = at("11:40");
    await renderCloud();

    await dragAcross(zoomCharts()[0]!, at("11:10"), at("11:30"));

    const empties: Array<HTMLElement> = screen.getAllByText(
      "No data in this time range",
    );
    expect(empties).toHaveLength(2);

    fireEvent.doubleClick(empties[0]!);
    await flush();

    expect(zoomCharts()).toHaveLength(2);
    expect(pickerLabel()).toBe(PAST_HOUR);
  });

  test("a slow response for the zoomed window cannot land after the reset", async () => {
    await renderCloud();
    holdAggregates = true;

    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:30"));
    await doubleClick(zoomCharts()[1]!);

    await releaseAggregatesEndingAt(NOW);
    await releaseAggregatesEndingAt(at("11:30"));

    expect(tileOf("Requests")).toHaveTextContent("600");
    expect(chartWindows()).toEqual(same(windowOf(at("11:00"), NOW), 2));
  });
});

// ----------------------------------------------------------------- serverless

const SERVERLESS_FETCHES: number = 3; // count, errors, p95

async function renderServerless(): Promise<void> {
  answerGetItemWith({
    name: "checkout-handler",
    functionIdentifier: "checkout-handler",
    otelCollectorStatus: "connected",
    cloudPlatform: "aws_lambda",
    cloudRegion: "us-east-1",
    runtimeName: "nodejs",
    runtimeVersion: "20",
  });
  render(
    <MemoryRouter>
      <ServerlessFunctionOverview {...PAGE_PROPS} />
    </MemoryRouter>,
  );
  await flush();
  expect(zoomCharts()).toHaveLength(2);
}

function lastServerlessWindows(): Array<[string, string]> {
  return windowsOf(aggregateCalls().slice(-SERVERLESS_FETCHES));
}

describe("Serverless function overview: one zoom for both charts", () => {
  test("Invocations and p95 duration hold the page's one zoom", async () => {
    await renderServerless();

    expectOneSharedZoom({ zoomed: false });
    expect(chartWindows()).toEqual(same(windowOf(at("11:00"), NOW), 2));
    expect(zoomHints()).toHaveLength(2);
  });

  test("a drag on p95 duration refetches the charts and the span tiles for the window", async () => {
    await renderServerless();
    expect(tileOf("Invocations")).toHaveTextContent("600");
    const instanceCounts: number = countMock.mock.calls.length;

    await dragAcross(zoomCharts()[1]!, at("11:20"), at("11:30"));

    expect(lastServerlessWindows()).toEqual(
      same(windowOf(at("11:20"), at("11:30")), SERVERLESS_FETCHES),
    );
    expect(chartWindows()).toEqual(same(windowOf(at("11:20"), at("11:30")), 2));
    expect(tileOf("Invocations")).toHaveTextContent("110");
    // The Instances tile does not follow the range.
    expect(countMock.mock.calls.length).toBe(instanceCounts);
    expect(pickerLabel()).toBe(customRangeLabel(at("11:20"), at("11:30")));
    expect(resetZoomButtons()).toHaveLength(1);
    expectOneSharedZoom({ zoomed: true });
  });

  test("a double-click on Invocations, or Reset zoom, puts the hour back", async () => {
    await renderServerless();

    await dragAcross(zoomCharts()[1]!, at("11:20"), at("11:30"));
    await doubleClick(zoomCharts()[0]!);
    expect(lastServerlessWindows()[0]).toEqual(windowOf(at("11:00"), NOW));
    expect(tileOf("Invocations")).toHaveTextContent("600");
    expect(pickerLabel()).toBe(PAST_HOUR);

    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:30"));
    fireEvent.click(resetZoomButtons()[0]!);
    await flush();
    expect(pickerLabel()).toBe(PAST_HOUR);
    expect(resetZoomButtons()).toHaveLength(0);
  });

  test("auto-refresh while zoomed refetches the zoomed window", async () => {
    await renderServerless();
    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:30"));
    const afterZoom: number = aggregateCalls().length;

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flush();

    expect(aggregateCalls().length).toBe(afterZoom + SERVERLESS_FETCHES);
    expect(lastServerlessWindows()).toEqual(
      same(windowOf(at("11:20"), at("11:30")), SERVERLESS_FETCHES),
    );
    expect(tileOf("Invocations")).toHaveTextContent("110");
    expect(resetZoomButtons()).toHaveLength(1);
  });

  test("a slow response for the zoomed window cannot land after the reset", async () => {
    await renderServerless();
    holdAggregates = true;

    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:30"));
    await doubleClick(zoomCharts()[1]!);

    // The reset's answer first; the zoom's, late, must be dropped.
    await releaseAggregatesEndingAt(NOW);
    expect(tileOf("Invocations")).toHaveTextContent("600");

    await releaseAggregatesEndingAt(at("11:30"));
    expect(tileOf("Invocations")).toHaveTextContent("600");
    expect(chartWindows()).toEqual(same(windowOf(at("11:00"), NOW), 2));
  });

  test("a slow response for the old window cannot overwrite the zoom", async () => {
    await renderServerless();
    holdAggregates = true;

    // An auto-refresh of the hour is in flight when the reader zooms.
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flush();
    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:30"));

    await releaseAggregatesEndingAt(at("11:30"));
    await releaseAggregatesEndingAt(new Date(NOW.getTime() + 30_000));

    expect(tileOf("Invocations")).toHaveTextContent("110");
  });
});
