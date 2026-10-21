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
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 on the SLO's Error Budget History (Components/Slo/
 * SloHistoryCharts.tsx - the Metrics page's history tab and the legacy
 * Charts route). Its three charts share one range, so they share one zoom:
 * a drag across any of them narrows all three - refetched at a bucket size
 * fit for the narrower window - and a double-click on any of them, or
 * "Reset zoom" beside the range picker, puts the range from before the zoom
 * back. A zoom into a stretch with no history leaves no chart to
 * double-click, so the empty states take the double-click instead.
 *
 * The component is rendered for real, Card included, over a fake data
 * layer. The chart canvas is stood in for by a recorder that resolves its
 * zoom exactly as the real chart wrapper does and exposes the gestures as
 * buttons.
 */

const SLO_ID_STRING: string = "0193c0de-5555-4aaa-8bbb-000000000005";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const ZOOM_START: Date = new Date("2026-09-20T00:00:00.000Z");
const ZOOM_END: Date = new Date("2026-09-20T06:00:00.000Z");
const INNER_ZOOM_START: Date = new Date("2026-09-20T01:00:00.000Z");
const INNER_ZOOM_END: Date = new Date("2026-09-20T02:00:00.000Z");

type MockZoomHandlers = {
  onTimeRangeSelect: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset: (() => void) | undefined;
};

interface MockChartProps {
  data: Array<{ seriesName: string }>;
  xAxis: { options: { type: string; min: Date; max: Date } };
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  disableTimeRangeZoom?: boolean | undefined;
}

interface MockChartRecord {
  props: MockChartProps;
  zoom: MockZoomHandlers;
}

type MockZoomContextModule =
  typeof import("../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext");

const mockCharts: Map<string, MockChartRecord> = new Map<
  string,
  MockChartRecord
>();
let mockDragWindow: [Date, Date] = [ZOOM_START, ZOOM_END];

const aggregateMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

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
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (): string => {
        return "Could not load";
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
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  const zoomContext: MockZoomContextModule = jest.requireActual(
    "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext",
  ) as MockZoomContextModule;
  return {
    __esModule: true,
    default: (props: MockChartProps): React.ReactElement => {
      const zoom: MockZoomHandlers = zoomContext.resolveChartTimeRangeZoom({
        onTimeRangeSelect: props.onTimeRangeSelect,
        onTimeRangeReset: props.onTimeRangeReset,
        isTimeAxis:
          props.xAxis.options.type === "time" ||
          props.xAxis.options.type === "date",
        disableTimeRangeZoom: props.disableTimeRangeZoom,
        pageZoom: zoomContext.useChartTimeRangeZoom(),
      });
      const name: string = props.data[0]?.seriesName || "";
      mockCharts.set(name, { props: props, zoom: zoom });
      return (
        <div data-testid="line-chart" data-series={name}>
          <button
            type="button"
            onClick={() => {
              zoom.onTimeRangeSelect?.(mockDragWindow[0], mockDragWindow[1]);
            }}
          >
            {`Drag across ${name}`}
          </button>
          <button
            type="button"
            onDoubleClick={() => {
              zoom.onTimeRangeReset?.();
            }}
          >
            {`Double-click ${name}`}
          </button>
        </div>
      );
    },
  };
});

// The view's own picker: shows its range, and can pick "Past 1 Week".
jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (props: {
      dashboardStartAndEndDate: { range: string };
      onChange: (value: { range: string }) => void;
    }): React.ReactElement => {
      return (
        <button
          type="button"
          data-testid="range-picker"
          onClick={() => {
            props.onChange({ range: "Past 1 Week" });
          }}
        >
          {props.dashboardStartAndEndDate.range}
        </button>
      );
    },
  };
});

jest.mock("../../../UI/Components/ComponentLoader/ComponentLoader", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <div data-testid="component-loader" />;
    },
  };
});

jest.mock("../../../UI/Components/EmptyState/EmptyState", () => {
  return {
    __esModule: true,
    default: (props: {
      title?: string;
      description?: string;
    }): React.ReactElement => {
      return (
        <div data-testid="empty-state">
          <span>{props.title}</span>
          <span>{props.description}</span>
        </div>
      );
    },
  };
});

jest.mock("../../../UI/Components/ErrorMessage/ErrorMessage", () => {
  return {
    __esModule: true,
    default: (props: { message: string }): React.ReactElement => {
      return <div data-testid="error-message">{props.message}</div>;
    },
  };
});

import SloHistoryCharts from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloHistoryCharts";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { TIME_RANGE_ZOOM_HINT_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";

const SLI_CHART: string = "SLI %";
const BUDGET_CHART: string = "Budget Remaining %";
const BURN_CHART: string = "Burn Rate";
const ALL_CHARTS: Array<string> = [SLI_CHART, BUDGET_CHART, BURN_CHART];

interface AggregateCall {
  aggregateBy: {
    query: { metricName: string };
    aggregationInterval: AggregationInterval;
    startTimestamp: Date;
    endTimestamp: Date;
  };
}

// One row per metric, inside whatever window was asked for.
let quietWindows: Array<[number, number]> = [];

function arrange(): void {
  aggregateMock.mockImplementation(async (args: unknown) => {
    const call: AggregateCall = args as AggregateCall;
    const start: number = call.aggregateBy.startTimestamp.getTime();
    const end: number = call.aggregateBy.endTimestamp.getTime();
    const isQuiet: boolean = quietWindows.some(
      (window: [number, number]): boolean => {
        return window[0] === start && window[1] === end;
      },
    );
    if (isQuiet) {
      return { data: [] };
    }
    return {
      data: [
        {
          timestamp: new Date(start + 60 * 1000).toISOString(),
          value: "99.5",
        },
      ],
    };
  });
  getItemMock.mockImplementation(async () => {
    const slo: ServiceLevelObjective = new ServiceLevelObjective();
    slo.targetPercentage = 99.9;
    slo.atRiskThresholdPercentage = 25;
    return slo;
  });
  getListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 10000 };
  });
}

function chart(name: string): MockChartRecord {
  const record: MockChartRecord | undefined = mockCharts.get(name);
  if (!record) {
    throw new Error(`The ${name} chart has not rendered`);
  }
  return record;
}

function aggregateCalls(): Array<AggregateCall> {
  return aggregateMock.mock.calls.map((args: Array<unknown>): AggregateCall => {
    return args[0] as AggregateCall;
  });
}

function windowOf(call: AggregateCall): [number, number] {
  return [
    call.aggregateBy.startTimestamp.getTime(),
    call.aggregateBy.endTimestamp.getTime(),
  ];
}

const ZOOM_WINDOW: [number, number] = [
  ZOOM_START.getTime(),
  ZOOM_END.getTime(),
];

// "Past 1 Month" resolved at some point after NOW.
function expectPastMonth(window: [number, number]): void {
  expect(window[1]).toBeGreaterThanOrEqual(NOW.getTime());
  expect(window[0]).toBe(
    OneUptimeDate.addRemoveMonths(new Date(window[1]), -1).getTime(),
  );
}

function resetZoomButton(): HTMLElement | null {
  return screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderCharts(): Promise<void> {
  render(<SloHistoryCharts sloId={new ObjectID(SLO_ID_STRING)} />);
  await waitFor(() => {
    expect(screen.getAllByTestId("line-chart")).toHaveLength(3);
  });
  await settle();
}

async function dragAcross(name: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: `Drag across ${name}` }));
  await settle();
}

async function doubleClick(name: string): Promise<void> {
  fireEvent.doubleClick(
    screen.getByRole("button", { name: `Double-click ${name}` }),
  );
  await settle();
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  mockCharts.clear();
  mockDragWindow = [ZOOM_START, ZOOM_END];
  quietWindows = [];
  aggregateMock.mockReset();
  getItemMock.mockReset();
  getListMock.mockReset();
  arrange();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("SLO history charts: one zoom for the three charts", () => {
  test("all three charts take the view's one zoom, with nothing to undo yet", async () => {
    await renderCharts();

    const select: ((startTime: Date, endTime: Date) => void) | undefined =
      chart(SLI_CHART).zoom.onTimeRangeSelect;
    expect(select).toBeInstanceOf(Function);
    for (const name of ALL_CHARTS) {
      expect(chart(name).zoom.onTimeRangeSelect).toBe(select);
      expect(chart(name).zoom.onTimeRangeReset).toBeUndefined();
    }
    expect(resetZoomButton()).toBeNull();
    expect(screen.getByTestId("range-picker")).toHaveTextContent(
      TimeRange.PAST_ONE_MONTH,
    );
  });

  test("each card names the gesture on hover", async () => {
    await renderCharts();

    const hints: Array<HTMLElement> = screen.getAllByTestId(
      TIME_RANGE_ZOOM_HINT_TEST_ID,
    );
    expect(hints).toHaveLength(3);
    for (const hint of hints) {
      expect(hint).toHaveTextContent("Drag to zoom");
      expect(hint).toHaveClass("group-hover/zoomhint:opacity-100");
      // The card is the hover group, so the hint shows over its chart.
      const card: HTMLElement | null = hint.closest('[data-testid="card"]');
      expect(card).not.toBeNull();
      expect(card).toHaveClass("group/zoomhint");
      expect(
        within(card as HTMLElement).getByTestId("line-chart"),
      ).toBeInTheDocument();
      /*
       * A row in the card body, in place of its top margin on desktop and
       * not shown on a phone - not in the header, where it squeezed the
       * description and left a gap under the title on a phone.
       */
      expect(hint.parentElement).toHaveClass("max-md:hidden", "md:flex", "h-4");
      expect(hint.parentElement?.parentElement).toHaveClass("mt-4", "md:mt-0");
    }
  });

  test("the view starts on the past month at hourly buckets", async () => {
    await renderCharts();

    const calls: Array<AggregateCall> = aggregateCalls();
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expectPastMonth(windowOf(call));
      expect(call.aggregateBy.aggregationInterval).toBe(
        AggregationInterval.Hour,
      );
    }
  });
});

describe("SLO history charts: a drag zooms all three", () => {
  test("a drag on one chart refetches all three series for the window, at finer buckets", async () => {
    await renderCharts();
    aggregateMock.mockClear();

    await dragAcross(SLI_CHART);

    const calls: Array<AggregateCall> = aggregateCalls();
    expect(
      calls
        .map((call: AggregateCall): string => {
          return call.aggregateBy.query.metricName;
        })
        .sort(),
    ).toEqual(
      ["burn.rate", "error.budget.remaining.percent", "sli.percent"].sort(),
    );
    for (const call of calls) {
      expect(windowOf(call)).toEqual(ZOOM_WINDOW);
      // Six hours: five-minute buckets rather than the month's hourly ones.
      expect(call.aggregateBy.aggregationInterval).toBe(
        AggregationInterval.FiveMinutes,
      );
    }
  });

  test("all three charts are redrawn over the zoomed window", async () => {
    await renderCharts();

    await dragAcross(BUDGET_CHART);

    for (const name of ALL_CHARTS) {
      const options: { min: Date; max: Date } = chart(name).props.xAxis.options;
      expect([options.min.getTime(), options.max.getTime()]).toEqual(
        ZOOM_WINDOW,
      );
    }
  });

  test("the picker reads Custom, Reset zoom appears beside it, and every chart can reset", async () => {
    await renderCharts();

    await dragAcross(BURN_CHART);

    const picker: HTMLElement = screen.getByTestId("range-picker");
    expect(picker).toHaveTextContent(TimeRange.CUSTOM);
    const reset: HTMLElement | null = resetZoomButton();
    expect(reset).toBeVisible();
    // Beside the picker, in the SLI card's header.
    expect(reset!.parentElement).toBe(picker.parentElement);

    const resetHandler: (() => void) | undefined =
      chart(SLI_CHART).zoom.onTimeRangeReset;
    expect(resetHandler).toBeInstanceOf(Function);
    for (const name of ALL_CHARTS) {
      expect(chart(name).zoom.onTimeRangeReset).toBe(resetHandler);
    }
    for (const hint of screen.getAllByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)) {
      expect(hint).toHaveTextContent("Double-click to reset");
    }
  });

  test("a drag that runs past now is cut at the end of the range", async () => {
    await renderCharts();
    // waitFor ticks the fake clock; put "now" back where the test reads it.
    jest.setSystemTime(NOW);
    aggregateMock.mockClear();
    mockDragWindow = [
      new Date("2026-09-28T09:00:00.000Z"),
      new Date("2026-09-28T13:00:00.000Z"),
    ];

    await dragAcross(SLI_CHART);

    for (const call of aggregateCalls()) {
      expect(windowOf(call)).toEqual([
        new Date("2026-09-28T09:00:00.000Z").getTime(),
        NOW.getTime(),
      ]);
    }
    expect(aggregateCalls()).toHaveLength(3);
  });
});

describe("SLO history charts: back out of a zoom", () => {
  test("a double-click on a DIFFERENT chart restores the past month for all three", async () => {
    await renderCharts();
    await dragAcross(SLI_CHART);
    aggregateMock.mockClear();

    await doubleClick(BURN_CHART);

    const calls: Array<AggregateCall> = aggregateCalls();
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expectPastMonth(windowOf(call));
      expect(call.aggregateBy.aggregationInterval).toBe(
        AggregationInterval.Hour,
      );
    }
    expect(screen.getByTestId("range-picker")).toHaveTextContent(
      TimeRange.PAST_ONE_MONTH,
    );
    expect(resetZoomButton()).toBeNull();
    for (const name of ALL_CHARTS) {
      expect(chart(name).zoom.onTimeRangeReset).toBeUndefined();
    }
  });

  test("Reset zoom beside the picker does what a double-click does", async () => {
    await renderCharts();
    await dragAcross(BUDGET_CHART);
    aggregateMock.mockClear();

    fireEvent.click(resetZoomButton()!);
    await settle();

    for (const call of aggregateCalls()) {
      expectPastMonth(windowOf(call));
    }
    expect(aggregateCalls()).toHaveLength(3);
    expect(resetZoomButton()).toBeNull();
  });

  test("after a zoom inside a zoom, one double-click returns to the past month", async () => {
    await renderCharts();
    await dragAcross(SLI_CHART);

    mockDragWindow = [INNER_ZOOM_START, INNER_ZOOM_END];
    aggregateMock.mockClear();
    await dragAcross(BUDGET_CHART);
    expect(aggregateCalls()).toHaveLength(3);
    for (const call of aggregateCalls()) {
      expect(windowOf(call)).toEqual([
        INNER_ZOOM_START.getTime(),
        INNER_ZOOM_END.getTime(),
      ]);
    }

    aggregateMock.mockClear();
    await doubleClick(SLI_CHART);

    expect(aggregateCalls()).toHaveLength(3);
    for (const call of aggregateCalls()) {
      expectPastMonth(windowOf(call));
    }
    expect(screen.getByTestId("range-picker")).toHaveTextContent(
      TimeRange.PAST_ONE_MONTH,
    );
    expect(resetZoomButton()).toBeNull();
  });

  test("a double-click with nothing zoomed refetches nothing", async () => {
    await renderCharts();
    aggregateMock.mockClear();

    await doubleClick(SLI_CHART);

    expect(aggregateMock).not.toHaveBeenCalled();
  });

  test("a zoom into a stretch with no history can be undone from the empty chart", async () => {
    await renderCharts();
    quietWindows = [ZOOM_WINDOW];

    await dragAcross(SLI_CHART);

    const empties: Array<HTMLElement> =
      await screen.findAllByTestId("empty-state");
    expect(empties).toHaveLength(3);
    // The empty state says how to get back.
    expect(empties[0]).toHaveTextContent("No history in this range");
    expect(empties[0]).toHaveTextContent(
      "Double-click here, or use Reset zoom, to go back.",
    );
    aggregateMock.mockClear();

    fireEvent.doubleClick(empties[1]!);
    await settle();

    for (const call of aggregateCalls()) {
      expectPastMonth(windowOf(call));
    }
    expect(aggregateCalls()).toHaveLength(3);
    expect(resetZoomButton()).toBeNull();
  });

  test("an empty range that was never zoomed keeps its usual advice, and a double-click does nothing", async () => {
    aggregateMock.mockImplementation(async () => {
      return { data: [] };
    });
    render(<SloHistoryCharts sloId={new ObjectID(SLO_ID_STRING)} />);
    const empties: Array<HTMLElement> =
      await screen.findAllByTestId("empty-state");
    expect(empties[0]).toHaveTextContent("Widen the time range");
    aggregateMock.mockClear();

    fireEvent.doubleClick(empties[0]!);
    await settle();

    expect(aggregateMock).not.toHaveBeenCalled();
  });
});

describe("SLO history charts: the zoom and the rest of the view", () => {
  test("picking a range ends the zoom", async () => {
    await renderCharts();
    await dragAcross(SLI_CHART);
    aggregateMock.mockClear();

    fireEvent.click(screen.getByTestId("range-picker"));
    await settle();

    expect(screen.getByTestId("range-picker")).toHaveTextContent(
      TimeRange.PAST_ONE_WEEK,
    );
    expect(resetZoomButton()).toBeNull();
    for (const name of ALL_CHARTS) {
      expect(chart(name).zoom.onTimeRangeReset).toBeUndefined();
    }
    expect(aggregateCalls()).toHaveLength(3);
    for (const call of aggregateCalls()) {
      const [start, end]: [number, number] = windowOf(call);
      expect(end - start).toBe(7 * 24 * 60 * 60 * 1000);
    }

    // With the zoom over, a double-click has nothing to undo.
    aggregateMock.mockClear();
    await doubleClick(BURN_CHART);
    expect(aggregateMock).not.toHaveBeenCalled();
  });

  test("the minute refresh keeps the zoom: the same window is fetched again", async () => {
    await renderCharts();
    await dragAcross(SLI_CHART);
    aggregateMock.mockClear();

    act(() => {
      jest.advanceTimersByTime(60 * 1000);
    });
    await settle();

    expect(aggregateCalls()).toHaveLength(3);
    for (const call of aggregateCalls()) {
      expect(windowOf(call)).toEqual(ZOOM_WINDOW);
    }
    expect(resetZoomButton()).toBeVisible();
    expect(screen.getByTestId("range-picker")).toHaveTextContent(
      TimeRange.CUSTOM,
    );
  });
});
