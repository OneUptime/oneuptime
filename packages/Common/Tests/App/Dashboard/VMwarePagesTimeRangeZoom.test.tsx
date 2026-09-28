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
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 on the VMware vCenter pages, rendered for real with the
 * network mocked and the charts replaced by the zoom stand-ins (see
 * TimeRangeZoomPageHarness):
 *
 *   - the overview's four resource-usage charts hold the page's one zoom:
 *     a drag on any of them reloads the golden metrics (charts and the Host
 *     CPU / Memory / CPU Ready tiles) for the window dragged out, and a
 *     double-click on any other one, or Reset zoom beside the picker, puts
 *     the range back. The inventory (health, counts, top consumers) is the
 *     current state and is not reloaded by a zoom.
 *   - Insights: seven metric cards share one range and now one zoom. A drag
 *     in any card retimes all seven, a double-click in any other card (or
 *     Reset zoom in any card's header) puts them all back.
 */

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");

function at(time: string): Date {
  return new Date(`2026-09-28T${time}:00.000Z`);
}

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>) => {
        return aggregateMock(...args);
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
        return new ObjectIDType("11111111-1111-4111-8111-111111111111");
      },
      navigate: () => {},
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
        return new ObjectIDType("22222222-2222-4222-8222-222222222222");
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
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView",
  () => {
    const harness: { StandInMetricView: unknown } = jest.requireActual(
      "./TimeRangeZoomPageHarness",
    ) as { StandInMetricView: unknown };
    return { __esModule: true, default: harness.StandInMetricView };
  },
);

jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  const harness: { StandInRangeStartAndEndDateView: unknown } =
    jest.requireActual("./TimeRangeZoomPageHarness") as {
      StandInRangeStartAndEndDateView: unknown;
    };
  return {
    __esModule: true,
    default: harness.StandInRangeStartAndEndDateView,
  };
});

// Event markers are fetched per card; not what these tests look at.
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

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("section", { "data-testid": "details" });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import VMwareVCenterOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/Index";
import VMwareVCenterInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/Insights";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import VMwareResourceModel from "../../../Models/DatabaseModels/VMwareResource";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  cardPickers,
  chartWindows,
  customRangeLabel,
  deferred,
  Deferred,
  doubleClick,
  dragAcross,
  expectOneSharedZoom,
  expectRevealedOnHoverOf,
  flush,
  metricViews,
  pickPreset,
  pickerLabel,
  presetLabel,
  resetZoomButtons,
  windowOf,
  zoomCharts,
  zoomHints,
} from "./TimeRangeZoomPageHarness";
import { inventoryRow, vcenterModel } from "./VMwareTooltipHarness";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

interface AggregateCall {
  aggregateBy: {
    query: { name: string };
    startTimestamp: Date;
    endTimestamp: Date;
  };
}

type Point = {
  timestamp: Date;
  value: number;
  attributes: Record<string, string>;
};

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

const HOST: Record<string, string> = {
  "resource.vcenter.datacenter.name": "dc1",
  "resource.vcenter.host.name": "esx01",
};

/*
 * One ESXi host whose CPU runs at 10% until 11:45 and 60% after: the Host
 * CPU tile (the last five minutes of the window) reads 60% on the default
 * half hour and 10% on a window zoomed in before 11:45.
 */
function goldenPoints(call: AggregateCall): Array<Point> {
  if (call.aggregateBy.query.name !== "vcenter.host.cpu.utilization") {
    return [];
  }

  const start: number = call.aggregateBy.startTimestamp.getTime();
  const end: number = call.aggregateBy.endTimestamp.getTime();
  const points: Array<Point> = [];

  for (let minute: number = 0; minute < 60; minute++) {
    const time: Date = new Date(Date.UTC(2026, 8, 28, 11, minute));

    if (time.getTime() < start || time.getTime() > end) {
      continue;
    }

    points.push({
      timestamp: time,
      value: time.getTime() < at("11:45").getTime() ? 10 : 60,
      attributes: HOST,
    });
  }

  return points;
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
  aggregateMock.mockReset();
  holdAggregates = false;
  heldAggregates = [];

  getItemMock.mockResolvedValue(vcenterModel());
  getListMock.mockImplementation((): Promise<unknown> => {
    const rows: Array<VMwareResourceModel> = [
      inventoryRow({
        kind: "Host",
        externalId: "host/dc1/esx01",
        name: "esx01",
        datacenterName: "dc1",
        latestCpuPercent: 42,
        metricsUpdatedAt: NOW,
      }),
    ];
    return Promise.resolve({ data: rows, count: rows.length });
  });
  aggregateMock.mockImplementation((request: unknown) => {
    const call: AggregateCall = request as AggregateCall;
    const answer: { data: Array<Point> } = { data: goldenPoints(call) };

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

// ------------------------------------------------------------------ overview

const OVERVIEW_CHARTS: number = 4; // Host CPU, Host Memory, Datastore Used, VM CPU Ready
const GOLDEN_FETCHES: number = 8; // aggregates per golden-metrics load

function hostCpuTile(): HTMLElement {
  // The first "About Host CPU" is the tile's.
  return screen
    .getAllByRole("button", { name: "About Host CPU" })[0]!
    .closest(".rounded-xl") as HTMLElement;
}

async function renderOverview(): Promise<void> {
  render(<VMwareVCenterOverview {...PAGE_PROPS} />);
  await flush();
  expect(zoomCharts()).toHaveLength(OVERVIEW_CHARTS);
}

function lastGoldenWindows(): Array<[string, string]> {
  return windowsOf(aggregateCalls().slice(-GOLDEN_FETCHES));
}

describe("VMware vCenter overview: one zoom for the resource-usage charts", () => {
  test("the four charts hold the page's one zoom; the section heading names the gesture", async () => {
    await renderOverview();

    expectOneSharedZoom({ zoomed: false });
    expect(chartWindows()).toEqual(
      same(windowOf(at("11:30"), NOW), OVERVIEW_CHARTS),
    );
    expect(pickerLabel()).toBe(presetLabel(TimeRange.PAST_THIRTY_MINS));

    const hints: Array<HTMLElement> = zoomHints();
    expect(hints).toHaveLength(1);
    const section: HTMLElement = expectRevealedOnHoverOf(hints[0]!);
    expect(section).toHaveTextContent("vCenter resource usage");
    expect(section.querySelectorAll('[data-testid="zoom-chart"]')).toHaveLength(
      OVERVIEW_CHARTS,
    );
  });

  test("a drag on Host Memory reloads every golden metric for the dragged window", async () => {
    await renderOverview();
    expect(hostCpuTile()).toHaveTextContent("60.0%");
    const golden: number = aggregateCalls().length;
    const inventoryLoads: number = getListMock.mock.calls.length;

    await dragAcross(zoomCharts()[1]!, at("11:36"), at("11:44"));

    expect(aggregateCalls().length).toBe(golden + GOLDEN_FETCHES);
    expect(lastGoldenWindows()).toEqual(
      same(windowOf(at("11:36"), at("11:44")), GOLDEN_FETCHES),
    );
    expect(chartWindows()).toEqual(
      same(windowOf(at("11:36"), at("11:44")), OVERVIEW_CHARTS),
    );
    // The tile follows the zoom: 11:39-11:44 is before the host got busy.
    expect(hostCpuTile()).toHaveTextContent("10.0%");
    // The inventory is the current state, not a time series: left alone.
    expect(getListMock.mock.calls.length).toBe(inventoryLoads);

    expect(pickerLabel()).toBe(customRangeLabel(at("11:36"), at("11:44")));
    expect(resetZoomButtons()).toHaveLength(1);
    expectOneSharedZoom({ zoomed: true });
    expect(zoomHints()[0]).toHaveTextContent(
      "Drag to zoom · double-click to reset",
    );
  });

  test("a double-click on another chart puts the half hour back", async () => {
    await renderOverview();
    await dragAcross(zoomCharts()[0]!, at("11:36"), at("11:44"));

    await doubleClick(zoomCharts()[3]!);

    expect(lastGoldenWindows()).toEqual(
      same(windowOf(at("11:30"), NOW), GOLDEN_FETCHES),
    );
    expect(chartWindows()).toEqual(
      same(windowOf(at("11:30"), NOW), OVERVIEW_CHARTS),
    );
    expect(hostCpuTile()).toHaveTextContent("60.0%");
    expect(pickerLabel()).toBe(presetLabel(TimeRange.PAST_THIRTY_MINS));
    expect(resetZoomButtons()).toHaveLength(0);
    expectOneSharedZoom({ zoomed: false });
  });

  test("Reset zoom beside the picker puts the half hour back, after any number of zooms", async () => {
    await renderOverview();
    await dragAcross(zoomCharts()[2]!, at("11:36"), at("11:44"));
    await dragAcross(zoomCharts()[1]!, at("11:38"), at("11:40"));
    expect(pickerLabel()).toBe(customRangeLabel(at("11:38"), at("11:40")));

    fireEvent.click(resetZoomButtons()[0]!);
    await flush();

    expect(lastGoldenWindows()[0]).toEqual(windowOf(at("11:30"), NOW));
    expect(pickerLabel()).toBe(presetLabel(TimeRange.PAST_THIRTY_MINS));
  });

  test("the picker ends the zoom", async () => {
    await renderOverview();
    await dragAcross(zoomCharts()[0]!, at("11:36"), at("11:44"));

    await pickPreset("Past 1 Hour");

    expect(lastGoldenWindows()[0]).toEqual(windowOf(at("11:00"), NOW));
    expect(resetZoomButtons()).toHaveLength(0);
    expectOneSharedZoom({ zoomed: false });
  });

  test("auto-refresh keeps the zoomed window; the inventory refreshes as before", async () => {
    await renderOverview();
    await dragAcross(zoomCharts()[0]!, at("11:36"), at("11:44"));
    const inventoryLoads: number = getListMock.mock.calls.length;

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flush();

    expect(lastGoldenWindows()).toEqual(
      same(windowOf(at("11:36"), at("11:44")), GOLDEN_FETCHES),
    );
    expect(getListMock.mock.calls.length).toBeGreaterThan(inventoryLoads);
    expect(resetZoomButtons()).toHaveLength(1);
  });

  test("a slow golden-metrics response for the zoom cannot repaint the page after the reset", async () => {
    await renderOverview();
    holdAggregates = true;

    await dragAcross(zoomCharts()[0]!, at("11:36"), at("11:44"));
    await doubleClick(zoomCharts()[1]!);

    await releaseAggregatesEndingAt(NOW);
    await releaseAggregatesEndingAt(at("11:44"));

    expect(chartWindows()).toEqual(
      same(windowOf(at("11:30"), NOW), OVERVIEW_CHARTS),
    );
    expect(hostCpuTile()).toHaveTextContent("60.0%");
  });
});

// ------------------------------------------------------------------ insights

const INSIGHTS_CARDS: number = 7;

async function renderInsights(): Promise<void> {
  getItemMock.mockResolvedValue({ name: "prod-vcenter" });
  render(<VMwareVCenterInsights {...PAGE_PROPS} />);
  await flush();
  expect(metricViews()).toHaveLength(INSIGHTS_CARDS);
}

function cardRanges(): Array<string> {
  return cardPickers().map((picker: HTMLElement): string => {
    return picker.textContent || "";
  });
}

describe("VMware Insights: seven cards, one zoom", () => {
  test("every card hands its charts the page's one zoom, with nothing to reset yet", async () => {
    await renderInsights();

    expectOneSharedZoom({ zoomed: false, among: metricViews() });
    expect(chartWindows(metricViews())).toEqual(
      same(windowOf(at("11:00"), NOW), INSIGHTS_CARDS),
    );
    expect(cardRanges()).toEqual(same(TimeRange.PAST_ONE_HOUR, INSIGHTS_CARDS));
    expect(resetZoomButtons()).toHaveLength(0);
  });

  test("a drag in the Datastores card retimes all seven cards", async () => {
    await renderInsights();

    await dragAcross(metricViews()[2]!, at("11:20"), at("11:30"));

    expect(chartWindows(metricViews())).toEqual(
      same(windowOf(at("11:20"), at("11:30")), INSIGHTS_CARDS),
    );
    expect(cardRanges()).toEqual(same(TimeRange.CUSTOM, INSIGHTS_CARDS));
    // Every card offers the way back in its header.
    expect(resetZoomButtons()).toHaveLength(INSIGHTS_CARDS);
    expectOneSharedZoom({ zoomed: true, among: metricViews() });
  });

  test("a double-click in a different card puts every card back on the hour", async () => {
    await renderInsights();
    await dragAcross(metricViews()[0]!, at("11:20"), at("11:30"));

    await doubleClick(metricViews()[6]!);

    expect(chartWindows(metricViews())).toEqual(
      same(windowOf(at("11:00"), NOW), INSIGHTS_CARDS),
    );
    expect(cardRanges()).toEqual(same(TimeRange.PAST_ONE_HOUR, INSIGHTS_CARDS));
    expect(resetZoomButtons()).toHaveLength(0);
    expectOneSharedZoom({ zoomed: false, among: metricViews() });
  });

  test("Reset zoom in any card's header resets every card", async () => {
    await renderInsights();
    await dragAcross(metricViews()[1]!, at("11:20"), at("11:30"));

    fireEvent.click(resetZoomButtons()[4]!);
    await flush();

    expect(cardRanges()).toEqual(same(TimeRange.PAST_ONE_HOUR, INSIGHTS_CARDS));
    expect(resetZoomButtons()).toHaveLength(0);
  });

  test("drilling in twice, one double-click climbs all the way out", async () => {
    await renderInsights();

    await dragAcross(metricViews()[0]!, at("11:20"), at("11:40"));
    await dragAcross(metricViews()[3]!, at("11:25"), at("11:30"));
    expect(chartWindows(metricViews())[5]).toEqual(
      windowOf(at("11:25"), at("11:30")),
    );

    await doubleClick(metricViews()[5]!);

    expect(chartWindows(metricViews())).toEqual(
      same(windowOf(at("11:00"), NOW), INSIGHTS_CARDS),
    );
  });

  test("a card's own picker ends the zoom for every card", async () => {
    await renderInsights();
    await dragAcross(metricViews()[0]!, at("11:20"), at("11:30"));

    fireEvent.click(cardPickers()[3]!);
    await flush();

    expect(cardRanges()).toEqual(same(TimeRange.PAST_ONE_DAY, INSIGHTS_CARDS));
    expect(resetZoomButtons()).toHaveLength(0);
    expectOneSharedZoom({ zoomed: false, among: metricViews() });
  });

  test("a card's Refresh while zoomed keeps every card on the zoomed window", async () => {
    await renderInsights();
    await dragAcross(metricViews()[0]!, at("11:20"), at("11:30"));

    fireEvent.click(screen.getAllByRole("button", { name: "Refresh" })[2]!);
    await flush();

    expect(chartWindows(metricViews())).toEqual(
      same(windowOf(at("11:20"), at("11:30")), INSIGHTS_CARDS),
    );
    expect(resetZoomButtons()).toHaveLength(INSIGHTS_CARDS);
  });
});
