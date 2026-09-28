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
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 on the SLO overview's budget burn-down card
 * (Components/Slo/SloBudgetBurnDownCard.tsx). The overview has no time
 * range of its own - the card is drawn over the SLO's current compliance
 * window - so the card keeps a zoom of its own:
 *
 *   - a drag narrows the card to the window dragged out, fetched at a finer
 *     bucket size, and never reaches anything outside the card;
 *   - a double-click on the chart, or "Reset zoom" in the header, returns
 *     to the compliance window as it is NOW, not as it was when the zoom
 *     was made;
 *   - a calendar month is drawn into the future (through to its reset), so
 *     a zoom stops at now, and the even-burn line keeps the whole month's
 *     slope inside the zoom.
 *
 * The card is rendered for real over a fake SloHistory endpoint; the chart
 * canvas is a recorder that resolves its zoom exactly as the real chart
 * wrapper does and exposes the gestures as buttons.
 */

type MockZoomHandlers = {
  onTimeRangeSelect: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset: (() => void) | undefined;
};

interface MockChartProps {
  data: Array<{ seriesName: string; data: Array<{ x: Date; y: number }> }>;
  xAxis: {
    options: { type: string; min: Date; max: Date; precision?: string };
  };
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

let mockLastChart: MockChartRecord | null = null;
let mockDragWindow: [Date, Date] = [new Date(0), new Date(0)];

const aggregateMock: MockFunction = getJestMockFunction();

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
        return new ObjectIDType("7d3f1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b");
      },
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
      mockLastChart = { props: props, zoom: zoom };
      return (
        <div data-testid="line-chart">
          <button
            type="button"
            onClick={() => {
              zoom.onTimeRangeSelect?.(mockDragWindow[0], mockDragWindow[1]);
            }}
          >
            Drag across the burn-down
          </button>
          <button
            type="button"
            onDoubleClick={() => {
              zoom.onTimeRangeReset?.();
            }}
          >
            Double-click the burn-down
          </button>
        </div>
      );
    },
  };
});

import SloBudgetBurnDownCard, {
  BURN_DOWN_IDEAL_SERIES_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloBudgetBurnDownCard";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import XAxisPrecision from "../../../UI/Components/Charts/Types/XAxis/XAxisPrecision";
import ResetTimeRangeZoomButton, {
  RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
} from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { TIME_RANGE_ZOOM_HINT_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import {
  TimeRangeZoomProvider,
  TimeRangeZoomScope,
} from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";

const SLO_ID: ObjectID = new ObjectID("5f8b7c1e2d3a4b5c6d7e8f90");
const NOW: Date = new Date("2026-09-15T12:00:00.000Z");
const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;
const WINDOW_START: Date = new Date(NOW.getTime() - 30 * DAY_MS);

const ZOOM_START: Date = new Date("2026-09-14T00:00:00.000Z");
const ZOOM_END: Date = new Date("2026-09-14T06:00:00.000Z");

interface AggregateRequest {
  aggregateBy: {
    aggregationInterval: AggregationInterval;
    startTimestamp: Date;
    endTimestamp: Date;
  };
}

// The "now" every part of the card reads; a test can move it on.
let currentNow: Date = NOW;
// Windows the fake endpoint has no history for.
let quietWindows: Array<[number, number]> = [];

type SloOverrides = {
  [K in keyof ServiceLevelObjective]?: ServiceLevelObjective[K] | undefined;
};

function buildSlo(overrides: SloOverrides = {}): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo.targetPercentage = 99.9;
  slo.windowType = SloWindowType.Rolling;
  slo.windowDays = 30;
  slo.timezone = "UTC";
  slo.atRiskThresholdPercentage = 25;
  slo.lastEvaluatedAt = new Date("2026-09-15T11:58:00.000Z");
  Object.assign(slo, overrides);
  return slo;
}

const CALENDAR_SLO: SloOverrides = {
  windowType: SloWindowType.CalendarMonth,
  timezone: "UTC",
};

function card(
  slo: ServiceLevelObjective,
  refreshToken: string = "t1",
): React.ReactElement {
  return (
    <MemoryRouter>
      <SloBudgetBurnDownCard
        sloId={SLO_ID}
        slo={slo}
        refreshToken={refreshToken}
      />
    </MemoryRouter>
  );
}

function requests(): Array<AggregateRequest> {
  return aggregateMock.mock.calls.map(
    (call: Array<unknown>): AggregateRequest => {
      return call[0] as AggregateRequest;
    },
  );
}

function lastRequest(): AggregateRequest {
  const all: Array<AggregateRequest> = requests();
  const last: AggregateRequest | undefined = all[all.length - 1];
  if (!last) {
    throw new Error("No history was requested");
  }
  return last;
}

function windowOf(request: AggregateRequest): [number, number] {
  return [
    request.aggregateBy.startTimestamp.getTime(),
    request.aggregateBy.endTimestamp.getTime(),
  ];
}

function chart(): MockChartRecord {
  if (!mockLastChart) {
    throw new Error("The burn-down chart has not rendered");
  }
  return mockLastChart;
}

function chartWindow(): [number, number] {
  return [
    chart().props.xAxis.options.min.getTime(),
    chart().props.xAxis.options.max.getTime(),
  ];
}

function resetZoomButton(): HTMLElement | null {
  return screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

// Lets the history a gesture asked for land, inside act.
async function settle(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderCard(
  slo: ServiceLevelObjective = buildSlo(),
): Promise<RenderResult> {
  const result: RenderResult = render(card(slo));
  await screen.findByTestId("line-chart");
  await settle();
  return result;
}

async function dragAcross(start: Date, end: Date): Promise<void> {
  mockDragWindow = [start, end];
  fireEvent.click(
    screen.getByRole("button", { name: "Drag across the burn-down" }),
  );
  await settle();
}

async function doubleClickChart(): Promise<void> {
  fireEvent.doubleClick(
    screen.getByRole("button", { name: "Double-click the burn-down" }),
  );
  await settle();
}

beforeEach(() => {
  currentNow = NOW;
  quietWindows = [];
  mockLastChart = null;
  mockDragWindow = [ZOOM_START, ZOOM_END];
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(currentNow.getTime());
  });
  aggregateMock.mockReset();
  aggregateMock.mockImplementation(async (args: unknown) => {
    const request: AggregateRequest = args as AggregateRequest;
    const [start, end]: [number, number] = windowOf(request);
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
        { timestamp: new Date(start + 5 * MINUTE_MS).toISOString(), value: 80 },
        { timestamp: new Date(end - 5 * MINUTE_MS).toISOString(), value: 62.5 },
      ],
    };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("SloBudgetBurnDownCard: its own zoom", () => {
  test("the chart can be dragged but has nothing to undo yet; the card names the gesture", async () => {
    await renderCard();

    expect(chart().zoom.onTimeRangeSelect).toBeInstanceOf(Function);
    expect(chart().zoom.onTimeRangeReset).toBeUndefined();
    expect(resetZoomButton()).toBeNull();

    const hint: HTMLElement = screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID);
    expect(hint).toHaveTextContent("Drag to zoom");
    expect(hint).toHaveClass("group-hover:opacity-100");
    expect(hint.closest(".group")).not.toBeNull();
    expect(
      within(hint.closest(".group") as HTMLElement).getByTestId(
        "slo-burn-down-chart",
      ),
    ).toBeInTheDocument();
    // Above the chart, in place of the body's margin; not shown on a phone.
    expect(hint.parentElement).toHaveClass("hidden", "md:flex", "h-4");
    expect(hint.parentElement?.parentElement).toHaveClass("mt-4", "md:mt-0");
  });

  test("a drag narrows the card to the window dragged out, fetched at a finer bucket size", async () => {
    await renderCard();
    expect(windowOf(lastRequest())).toEqual([
      WINDOW_START.getTime(),
      NOW.getTime(),
    ]);
    expect(lastRequest().aggregateBy.aggregationInterval).toBe(
      AggregationInterval.Hour,
    );
    aggregateMock.mockClear();

    await dragAcross(ZOOM_START, ZOOM_END);

    await waitFor(() => {
      expect(requests()).toHaveLength(1);
    });
    expect(windowOf(lastRequest())).toEqual([
      ZOOM_START.getTime(),
      ZOOM_END.getTime(),
    ]);
    expect(lastRequest().aggregateBy.aggregationInterval).toBe(
      AggregationInterval.FiveMinutes,
    );

    await waitFor(() => {
      expect(chartWindow()).toEqual([ZOOM_START.getTime(), ZOOM_END.getTime()]);
    });
    expect(chart().props.xAxis.options.precision).toBe(
      XAxisPrecision.EVERY_FIVE_MINUTES,
    );
  });

  test("while zoomed the header offers Reset zoom and the chart can reset", async () => {
    await renderCard();

    await dragAcross(ZOOM_START, ZOOM_END);

    const reset: HTMLElement | null = resetZoomButton();
    expect(reset).toBeVisible();
    // Beside "Open metrics", in the card's header.
    expect(
      within(reset!.parentElement as HTMLElement).getByRole("link", {
        name: "Open metrics",
      }),
    ).toBeInTheDocument();
    expect(chart().zoom.onTimeRangeReset).toBeInstanceOf(Function);
    expect(screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toHaveTextContent(
      "Drag to zoom · double-click to reset",
    );
  });

  test("a double-click on the chart returns to the whole compliance window", async () => {
    await renderCard();
    await dragAcross(ZOOM_START, ZOOM_END);
    await waitFor(() => {
      expect(chartWindow()).toEqual([ZOOM_START.getTime(), ZOOM_END.getTime()]);
    });
    aggregateMock.mockClear();

    await doubleClickChart();

    await waitFor(() => {
      expect(requests()).toHaveLength(1);
    });
    expect(windowOf(lastRequest())).toEqual([
      WINDOW_START.getTime(),
      NOW.getTime(),
    ]);
    expect(lastRequest().aggregateBy.aggregationInterval).toBe(
      AggregationInterval.Hour,
    );
    await waitFor(() => {
      expect(chartWindow()).toEqual([WINDOW_START.getTime(), NOW.getTime()]);
    });
    expect(resetZoomButton()).toBeNull();
    expect(chart().zoom.onTimeRangeReset).toBeUndefined();
  });

  test("Reset zoom in the header does what a double-click does", async () => {
    await renderCard();
    await dragAcross(ZOOM_START, ZOOM_END);
    aggregateMock.mockClear();

    fireEvent.click(resetZoomButton()!);
    await settle();

    await waitFor(() => {
      expect(windowOf(lastRequest())).toEqual([
        WINDOW_START.getTime(),
        NOW.getTime(),
      ]);
    });
    expect(resetZoomButton()).toBeNull();
  });

  test("a zoom inside a zoom still resets straight to the compliance window", async () => {
    await renderCard();
    await dragAcross(ZOOM_START, ZOOM_END);

    const innerStart: Date = new Date("2026-09-14T01:00:00.000Z");
    const innerEnd: Date = new Date("2026-09-14T02:00:00.000Z");
    aggregateMock.mockClear();
    await dragAcross(innerStart, innerEnd);
    await waitFor(() => {
      expect(windowOf(lastRequest())).toEqual([
        innerStart.getTime(),
        innerEnd.getTime(),
      ]);
    });

    aggregateMock.mockClear();
    await doubleClickChart();

    await waitFor(() => {
      expect(windowOf(lastRequest())).toEqual([
        WINDOW_START.getTime(),
        NOW.getTime(),
      ]);
    });
    expect(resetZoomButton()).toBeNull();
  });

  test("a drag that starts before the compliance window starts where the window does", async () => {
    await renderCard();
    aggregateMock.mockClear();

    await dragAcross(
      new Date(WINDOW_START.getTime() - 2 * HOUR_MS),
      new Date(WINDOW_START.getTime() + 4 * HOUR_MS),
    );

    await waitFor(() => {
      expect(requests()).toHaveLength(1);
    });
    expect(windowOf(lastRequest())).toEqual([
      WINDOW_START.getTime(),
      WINDOW_START.getTime() + 4 * HOUR_MS,
    ]);
  });

  test("a right-to-left drag zooms to the same window", async () => {
    await renderCard();
    aggregateMock.mockClear();

    await dragAcross(ZOOM_END, ZOOM_START);

    await waitFor(() => {
      expect(requests()).toHaveLength(1);
    });
    expect(windowOf(lastRequest())).toEqual([
      ZOOM_START.getTime(),
      ZOOM_END.getTime(),
    ]);
  });

  test("a double-click with nothing zoomed does not refetch", async () => {
    await renderCard();
    aggregateMock.mockClear();

    await doubleClickChart();

    expect(aggregateMock).not.toHaveBeenCalled();
  });
});

describe("SloBudgetBurnDownCard: a zoom and the live window", () => {
  test("a new evaluation keeps the zoom; a reset then returns to the window as it is now", async () => {
    const slo: ServiceLevelObjective = buildSlo();
    const { rerender }: RenderResult = await renderCard(slo);
    await dragAcross(ZOOM_START, ZOOM_END);
    await waitFor(() => {
      expect(chartWindow()).toEqual([ZOOM_START.getTime(), ZOOM_END.getTime()]);
    });

    // Ten minutes on, the next evaluation lands.
    currentNow = new Date(NOW.getTime() + 10 * MINUTE_MS);
    aggregateMock.mockClear();
    rerender(card(slo, "t2"));
    await settle();

    await waitFor(() => {
      expect(requests()).toHaveLength(1);
    });
    // Still the zoom: the new history is read for the zoomed window.
    expect(windowOf(lastRequest())).toEqual([
      ZOOM_START.getTime(),
      ZOOM_END.getTime(),
    ]);
    expect(resetZoomButton()).toBeVisible();

    aggregateMock.mockClear();
    await doubleClickChart();

    // Back to the live window - ending at the new now, not a snapshot.
    await waitFor(() => {
      expect(windowOf(lastRequest())).toEqual([
        currentNow.getTime() - 30 * DAY_MS,
        currentNow.getTime(),
      ]);
    });
  });
});

describe("SloBudgetBurnDownCard: a calendar month", () => {
  const MONTH_START: Date = new Date("2026-09-01T00:00:00.000Z");
  const MONTH_RESET: Date = new Date("2026-10-01T00:00:00.000Z");
  const MONTH_MS: number = MONTH_RESET.getTime() - MONTH_START.getTime();

  test("a drag into the rest of the month stops at now", async () => {
    await renderCard(buildSlo(CALENDAR_SLO));
    // Unzoomed, the axis runs through to the reset.
    expect(chartWindow()).toEqual([
      MONTH_START.getTime(),
      MONTH_RESET.getTime(),
    ]);
    aggregateMock.mockClear();

    await dragAcross(
      new Date("2026-09-10T00:00:00.000Z"),
      new Date("2026-09-20T00:00:00.000Z"),
    );

    await waitFor(() => {
      expect(requests()).toHaveLength(1);
    });
    expect(windowOf(lastRequest())).toEqual([
      new Date("2026-09-10T00:00:00.000Z").getTime(),
      NOW.getTime(),
    ]);
    await waitFor(() => {
      expect(chartWindow()).toEqual([
        new Date("2026-09-10T00:00:00.000Z").getTime(),
        NOW.getTime(),
      ]);
    });
  });

  test("the even-burn line inside a zoom keeps the whole month's slope", async () => {
    await renderCard(buildSlo(CALENDAR_SLO));

    const zoomStart: Date = new Date("2026-09-10T00:00:00.000Z");
    const zoomEnd: Date = new Date("2026-09-11T00:00:00.000Z");
    await dragAcross(zoomStart, zoomEnd);

    await waitFor(() => {
      expect(chartWindow()).toEqual([zoomStart.getTime(), zoomEnd.getTime()]);
    });

    const ideal:
      | { seriesName: string; data: Array<{ x: Date; y: number }> }
      | undefined = chart().props.data.find(
      (series: { seriesName: string }): boolean => {
        return series.seriesName === BURN_DOWN_IDEAL_SERIES_NAME;
      },
    );
    expect(ideal).toBeDefined();

    const idealAt: (date: Date) => number = (date: Date): number => {
      return 100 * (1 - (date.getTime() - MONTH_START.getTime()) / MONTH_MS);
    };

    const points: Array<{ x: Date; y: number }> = ideal!.data;
    // Nine days into a thirty-day month: 70% left, not a fresh 100%.
    expect(points[0]!.x.getTime()).toBe(zoomStart.getTime());
    expect(points[0]!.y).toBeCloseTo(70, 10);
    expect(points[points.length - 1]!.x.getTime()).toBe(zoomEnd.getTime());
    expect(points[points.length - 1]!.y).toBeCloseTo(idealAt(zoomEnd), 10);
    for (const point of points) {
      expect(point.x.getTime()).toBeGreaterThanOrEqual(zoomStart.getTime());
      expect(point.x.getTime()).toBeLessThanOrEqual(zoomEnd.getTime());
      expect(point.y).toBeCloseTo(idealAt(point.x), 10);
    }
    // One point per 30-minute bucket of the zoomed day, plus its end.
    expect(chart().props.xAxis.options.precision).toBe(
      XAxisPrecision.EVERY_THIRTY_MINUTES,
    );
    expect(points).toHaveLength(48 + 1);
  });

  test("a drag entirely in the rest of the month is ignored", async () => {
    await renderCard(buildSlo(CALENDAR_SLO));
    aggregateMock.mockClear();

    await dragAcross(
      new Date("2026-09-20T00:00:00.000Z"),
      new Date("2026-09-25T00:00:00.000Z"),
    );

    expect(aggregateMock).not.toHaveBeenCalled();
    expect(resetZoomButton()).toBeNull();
    expect(chartWindow()).toEqual([
      MONTH_START.getTime(),
      MONTH_RESET.getTime(),
    ]);
  });

  test("a reset returns to the whole month, through to the reset", async () => {
    await renderCard(buildSlo(CALENDAR_SLO));
    await dragAcross(
      new Date("2026-09-10T00:00:00.000Z"),
      new Date("2026-09-11T00:00:00.000Z"),
    );
    aggregateMock.mockClear();

    await doubleClickChart();

    await waitFor(() => {
      expect(chartWindow()).toEqual([
        MONTH_START.getTime(),
        MONTH_RESET.getTime(),
      ]);
    });
    expect(windowOf(lastRequest())).toEqual([
      MONTH_START.getTime(),
      MONTH_RESET.getTime(),
    ]);
  });
});

describe("SloBudgetBurnDownCard: an empty zoom", () => {
  test("a zoom into a stretch with no history can be undone from the empty state", async () => {
    await renderCard();
    quietWindows = [[ZOOM_START.getTime(), ZOOM_END.getTime()]];

    await dragAcross(ZOOM_START, ZOOM_END);

    const empty: HTMLElement = await screen.findByTestId("slo-burn-down-empty");
    expect(empty).toHaveTextContent("No budget history in the zoomed window");
    expect(empty).toHaveTextContent("Reset zoom");
    expect(resetZoomButton()).toBeVisible();
    aggregateMock.mockClear();

    fireEvent.doubleClick(empty);
    await settle();

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    });
    expect(windowOf(lastRequest())).toEqual([
      WINDOW_START.getTime(),
      NOW.getTime(),
    ]);
    expect(resetZoomButton()).toBeNull();
  });
});

describe("SloBudgetBurnDownCard: the zoom stays in the card", () => {
  const PAGE_RANGE: RangeStartAndEndDateTime = {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(
      new Date("2026-09-15T10:00:00.000Z"),
      new Date("2026-09-15T11:00:00.000Z"),
    ),
  };

  test("inside a page that zooms, a drag on the burn-down never retimes the page", async () => {
    const onPageRangeChange: MockFunction = getJestMockFunction();
    render(
      <TimeRangeZoomScope
        timeRange={PAGE_RANGE}
        onTimeRangeChange={
          onPageRangeChange as unknown as (
            range: RangeStartAndEndDateTime,
          ) => void
        }
      >
        <div data-testid="page-reset">
          <ResetTimeRangeZoomButton />
        </div>
        {card(buildSlo())}
      </TimeRangeZoomScope>,
    );
    await screen.findByTestId("line-chart");
    await settle();
    aggregateMock.mockClear();

    await dragAcross(ZOOM_START, ZOOM_END);

    expect(onPageRangeChange).not.toHaveBeenCalled();
    // The card zoomed itself...
    await waitFor(() => {
      expect(windowOf(lastRequest())).toEqual([
        ZOOM_START.getTime(),
        ZOOM_END.getTime(),
      ]);
    });
    // ...and the page's own Reset zoom has nothing to offer.
    expect(
      within(screen.getByTestId("page-reset")).queryByTestId(
        RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
      ),
    ).toBeNull();
  });

  test("a page that is zoomed does not hand the burn-down its reset", async () => {
    const pageReset: MockFunction = getJestMockFunction();
    const pageZoom: TimeRangeZoom = {
      isZoomed: true,
      rangeBeforeZoom: { range: TimeRange.PAST_ONE_DAY },
      zoomToTimeRange: (): void => {},
      resetZoom: pageReset as unknown as () => void,
    };
    render(
      <TimeRangeZoomProvider zoom={pageZoom}>
        {card(buildSlo())}
      </TimeRangeZoomProvider>,
    );
    await screen.findByTestId("line-chart");
    await settle();
    aggregateMock.mockClear();

    // The card is not zoomed, so the chart has nothing to reset...
    expect(chart().zoom.onTimeRangeReset).toBeUndefined();
    expect(resetZoomButton()).toBeNull();

    await doubleClickChart();

    // ...and a double-click reaches neither the page nor the card.
    expect(pageReset).not.toHaveBeenCalled();
    expect(aggregateMock).not.toHaveBeenCalled();
  });
});
