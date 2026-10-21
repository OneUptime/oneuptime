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
 * Issue #4105 on the SLO Metrics page's metric cards.
 *
 *   - SLO Metrics tab (Components/Slo/SloMetrics.tsx): the Objective, Burn
 *     and Status cards share one range, so they share one zoom. A drag on
 *     any card's charts narrows all three, and a double-click on any of
 *     them - or "Reset zoom" in any card's header - puts the shared range
 *     back. Without the tab's zoom scope each card kept its own zoom over
 *     the shared range, so a double-click on a card other than the one
 *     dragged did nothing.
 *   - Incident and Alert Metrics tabs (SloIncidentMetrics /
 *     SloAlertMetrics): one card each, owning its own range (a week by
 *     default). Nothing SLO-specific was needed: the card keeps its own
 *     zoom and its bar panels now drag. Pinned here so the tabs keep it.
 *
 * EmbeddedMetricCard and MetricView are real; the metric store is fake and
 * MetricCharts is stood in for by a recorder that exposes the handlers it
 * would write into every chart panel as buttons, and says on the DOM which
 * handler each card's charts got.
 */

const SLO_ID_STRING: string = "0193c0de-5555-4aaa-8bbb-000000000005";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;
const ZOOM_START: Date = new Date("2026-09-28T06:00:00.000Z");
const ZOOM_END: Date = new Date("2026-09-28T08:00:00.000Z");
const INNER_ZOOM_START: Date = new Date("2026-09-28T06:30:00.000Z");
const INNER_ZOOM_END: Date = new Date("2026-09-28T07:00:00.000Z");

interface MockMetricChartsProps {
  metricViewData: { startAndEndDate?: { startValue: Date; endValue: Date } };
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
}

let mockDragWindow: [Date, Date] = [ZOOM_START, ZOOM_END];
// A stable id per handler, so the DOM can say which cards share one.
const mockHandlerIds: Map<unknown, number> = new Map<unknown, number>();

function mockIdOf(handler: unknown): string {
  if (!handler) {
    return "none";
  }
  if (!mockHandlerIds.has(handler)) {
    mockHandlerIds.set(handler, mockHandlerIds.size + 1);
  }
  return String(mockHandlerIds.get(handler));
}

const fetchResultsMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<unknown>): unknown => {
          return fetchResultsMock(...args);
        },
        getMetricTypes: (): Promise<Array<unknown>> => {
          return Promise.resolve([]);
        },
        loadAllMetricsTypes: (): Promise<unknown> => {
          return Promise.resolve({ metricTypes: [], telemetryServices: [] });
        },
        clearQueryTopNOverridesForScope: (): undefined => {
          return undefined;
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: MockMetricChartsProps): React.ReactElement => {
        return (
          <div
            data-testid="metric-charts"
            data-select={mockIdOf(props.onTimeRangeSelect)}
            data-reset={mockIdOf(props.onTimeRangeReset)}
          >
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeSelect?.(mockDragWindow[0], mockDragWindow[1]);
              }}
            >
              Drag across the charts
            </button>
            <button
              type="button"
              onDoubleClick={() => {
                props.onTimeRangeReset?.();
              }}
            >
              Double-click the charts
            </button>
          </div>
        );
      },
    };
  },
);

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

// Each card's picker: shows its range, and can pick "Past 1 Week".
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
          data-testid="card-picker"
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

import SloMetricsElement from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloMetrics";
import SloIncidentMetrics from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloIncidentMetrics";
import SloAlertMetrics from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloAlertMetrics";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";

const SLO_CARD_TITLES: Array<string> = ["Objective", "Burn", "Status"];

interface FetchCall {
  metricViewData: {
    startAndEndDate: { startValue: Date; endValue: Date };
    queryConfigs: Array<{
      metricQueryData: { filterData: { metricName: string } };
    }>;
  };
}

function fetchCalls(): Array<FetchCall> {
  return fetchResultsMock.mock.calls.map((call: Array<unknown>): FetchCall => {
    return call[0] as FetchCall;
  });
}

function windowOf(call: FetchCall): [number, number] {
  return [
    call.metricViewData.startAndEndDate.startValue.getTime(),
    call.metricViewData.startAndEndDate.endValue.getTime(),
  ];
}

// The metric names a fetch asked for, as one key: which card it was.
function cardOf(call: FetchCall): string {
  return call.metricViewData.queryConfigs
    .map(
      (queryConfig: {
        metricQueryData: { filterData: { metricName: string } };
      }): string => {
        return queryConfig.metricQueryData.filterData.metricName;
      },
    )
    .join(",");
}

const ZOOM_WINDOW: [number, number] = [
  ZOOM_START.getTime(),
  ZOOM_END.getTime(),
];

/*
 * A relative window resolved at some point after NOW. MetricView floors the
 * start onto its bucket grid, so the span may run a bucket over.
 */
function expectPast(window: [number, number], spanMs: number): void {
  expect(window[1]).toBeGreaterThanOrEqual(NOW.getTime());
  expect(window[1] - window[0]).toBeGreaterThanOrEqual(spanMs);
  expect(window[1] - window[0]).toBeLessThan(spanMs + HOUR_MS);
}

function cardByTitle(title: string): HTMLElement {
  const card: HTMLElement | null = screen
    .getByText(title)
    .closest('[data-testid="card"]');
  if (!card) {
    throw new Error(`No card titled ${title}`);
  }
  return card as HTMLElement;
}

function pickerOf(title: string): HTMLElement {
  return within(cardByTitle(title)).getByTestId("card-picker");
}

function chartsOf(title: string): HTMLElement {
  return within(cardByTitle(title)).getByTestId("metric-charts");
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderSloMetrics(): Promise<void> {
  render(<SloMetricsElement sloId={new ObjectID(SLO_ID_STRING)} />);
  await waitFor(() => {
    expect(screen.getAllByTestId("metric-charts")).toHaveLength(3);
  });
  await settle();
}

async function dragAcross(title: string): Promise<void> {
  fireEvent.click(
    within(cardByTitle(title)).getByRole("button", {
      name: "Drag across the charts",
    }),
  );
  await settle();
}

async function doubleClick(title: string): Promise<void> {
  fireEvent.doubleClick(
    within(cardByTitle(title)).getByRole("button", {
      name: "Double-click the charts",
    }),
  );
  await settle();
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  mockDragWindow = [ZOOM_START, ZOOM_END];
  fetchResultsMock.mockReset();
  fetchResultsMock.mockImplementation(async (args: unknown) => {
    return (args as FetchCall).metricViewData.queryConfigs.map(() => {
      return { data: [], truncated: false };
    });
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("SLO Metrics tab: the three cards share one zoom", () => {
  test("every card's charts get the tab's one zoom, with nothing to undo yet", async () => {
    await renderSloMetrics();

    const selectIds: Array<string | null> = SLO_CARD_TITLES.map(
      (title: string): string | null => {
        return chartsOf(title).getAttribute("data-select");
      },
    );
    expect(selectIds[0]).not.toBe("none");
    expect(new Set(selectIds).size).toBe(1);
    for (const title of SLO_CARD_TITLES) {
      expect(chartsOf(title)).toHaveAttribute("data-reset", "none");
      expect(pickerOf(title)).toHaveTextContent(TimeRange.PAST_ONE_DAY);
    }
    expect(
      screen.queryAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toEqual([]);
  });

  test("a drag on one card refetches all three cards for the window dragged out", async () => {
    await renderSloMetrics();
    fetchResultsMock.mockClear();

    await dragAcross("Objective");

    const calls: Array<FetchCall> = fetchCalls();
    // One fetch per card, each for the zoomed window.
    expect(new Set(calls.map(cardOf)).size).toBe(3);
    for (const call of calls) {
      expect(windowOf(call)).toEqual(ZOOM_WINDOW);
    }
  });

  test("every card's picker reads Custom, and every card's header offers Reset zoom", async () => {
    await renderSloMetrics();

    await dragAcross("Burn");

    for (const title of SLO_CARD_TITLES) {
      expect(pickerOf(title)).toHaveTextContent(TimeRange.CUSTOM);
      expect(
        within(cardByTitle(title)).getByTestId(
          RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
        ),
      ).toBeVisible();
    }
    const resetIds: Array<string | null> = SLO_CARD_TITLES.map(
      (title: string): string | null => {
        return chartsOf(title).getAttribute("data-reset");
      },
    );
    expect(resetIds[0]).not.toBe("none");
    expect(new Set(resetIds).size).toBe(1);
  });

  test("a double-click on a DIFFERENT card puts all three back on the past day", async () => {
    await renderSloMetrics();
    await dragAcross("Objective");
    fetchResultsMock.mockClear();

    await doubleClick("Status");

    const calls: Array<FetchCall> = fetchCalls();
    expect(new Set(calls.map(cardOf)).size).toBe(3);
    for (const call of calls) {
      expectPast(windowOf(call), DAY_MS);
    }
    for (const title of SLO_CARD_TITLES) {
      expect(pickerOf(title)).toHaveTextContent(TimeRange.PAST_ONE_DAY);
      expect(chartsOf(title)).toHaveAttribute("data-reset", "none");
    }
    expect(
      screen.queryAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toEqual([]);
  });

  test("Reset zoom in one card's header resets every card", async () => {
    await renderSloMetrics();
    await dragAcross("Status");

    fireEvent.click(
      within(cardByTitle("Burn")).getByTestId(
        RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
      ),
    );
    await settle();

    for (const title of SLO_CARD_TITLES) {
      expect(pickerOf(title)).toHaveTextContent(TimeRange.PAST_ONE_DAY);
    }
    expect(
      screen.queryAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toEqual([]);
  });

  test("after a zoom inside a zoom, one double-click returns to the past day", async () => {
    await renderSloMetrics();
    await dragAcross("Objective");

    mockDragWindow = [INNER_ZOOM_START, INNER_ZOOM_END];
    fetchResultsMock.mockClear();
    await dragAcross("Burn");
    expect(fetchCalls().length).toBeGreaterThan(0);
    for (const call of fetchCalls()) {
      expect(windowOf(call)).toEqual([
        INNER_ZOOM_START.getTime(),
        INNER_ZOOM_END.getTime(),
      ]);
    }

    fetchResultsMock.mockClear();
    await doubleClick("Objective");

    expect(fetchCalls().length).toBeGreaterThan(0);
    for (const call of fetchCalls()) {
      expectPast(windowOf(call), DAY_MS);
    }
    for (const title of SLO_CARD_TITLES) {
      expect(pickerOf(title)).toHaveTextContent(TimeRange.PAST_ONE_DAY);
    }
  });

  test("picking a range on one card ends the zoom on all of them", async () => {
    await renderSloMetrics();
    await dragAcross("Objective");

    fireEvent.click(pickerOf("Status"));
    await settle();

    for (const title of SLO_CARD_TITLES) {
      expect(pickerOf(title)).toHaveTextContent(TimeRange.PAST_ONE_WEEK);
      expect(chartsOf(title)).toHaveAttribute("data-reset", "none");
    }
    expect(
      screen.queryAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toEqual([]);

    // Nothing left to undo: a double-click leaves the week alone.
    fetchResultsMock.mockClear();
    await doubleClick("Burn");
    expect(fetchResultsMock).not.toHaveBeenCalled();
  });
});

describe("SLO Incident and Alert Metrics tabs: each card keeps its own zoom", () => {
  test.each([
    ["Incident Metrics", SloIncidentMetrics],
    ["Alert Metrics", SloAlertMetrics],
  ])(
    "%s: a drag narrows the card from its week, and a double-click puts the week back",
    async (
      title: string,
      Component: React.FunctionComponent<{ sloId: ObjectID }>,
    ) => {
      render(<Component sloId={new ObjectID(SLO_ID_STRING)} />);
      await waitFor(() => {
        expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
      });
      await settle();

      expect(pickerOf(title)).toHaveTextContent(TimeRange.PAST_ONE_WEEK);
      expect(chartsOf(title).getAttribute("data-select")).not.toBe("none");
      expect(chartsOf(title)).toHaveAttribute("data-reset", "none");
      expectPast(windowOf(fetchCalls()[0]!), 7 * DAY_MS);
      fetchResultsMock.mockClear();

      await dragAcross(title);

      expect(windowOf(fetchCalls()[0]!)).toEqual(ZOOM_WINDOW);
      expect(pickerOf(title)).toHaveTextContent(TimeRange.CUSTOM);
      expect(chartsOf(title).getAttribute("data-reset")).not.toBe("none");
      expect(
        within(cardByTitle(title)).getByTestId(
          RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
        ),
      ).toBeVisible();
      fetchResultsMock.mockClear();

      await doubleClick(title);

      expectPast(windowOf(fetchCalls()[0]!), 7 * DAY_MS);
      expect(pickerOf(title)).toHaveTextContent(TimeRange.PAST_ONE_WEEK);
      expect(chartsOf(title)).toHaveAttribute("data-reset", "none");
    },
  );

  test("the two event cards do not share a zoom: a drag on one leaves the other alone", async () => {
    render(
      <>
        <SloIncidentMetrics sloId={new ObjectID(SLO_ID_STRING)} />
        <SloAlertMetrics sloId={new ObjectID(SLO_ID_STRING)} />
      </>,
    );
    await waitFor(() => {
      expect(screen.getAllByTestId("metric-charts")).toHaveLength(2);
    });
    await settle();

    expect(chartsOf("Incident Metrics").getAttribute("data-select")).not.toBe(
      chartsOf("Alert Metrics").getAttribute("data-select"),
    );

    await dragAcross("Incident Metrics");

    expect(pickerOf("Incident Metrics")).toHaveTextContent(TimeRange.CUSTOM);
    expect(pickerOf("Alert Metrics")).toHaveTextContent(
      TimeRange.PAST_ONE_WEEK,
    );
    expect(
      within(cardByTitle("Alert Metrics")).queryByTestId(
        RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
      ),
    ).toBeNull();
  });
});
