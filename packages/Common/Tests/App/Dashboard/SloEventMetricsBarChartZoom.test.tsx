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
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 through the whole stack behind the SLO Metrics page's
 * Incident and Alert Metrics tabs, whose panels are BAR charts:
 *
 *   SloIncidentMetrics / SloAlertMetrics
 *     -> EmbeddedMetricCard (its own range and zoom, a week by default)
 *       -> MetricView -> MetricCharts -> ChartGroup
 *         -> the Bar chart wrapper -> the chart core
 *
 * Everything above the chart core is real; only the metric store and the
 * recharts-drawn core are stood in for. The core stand-in exposes the drag
 * and the double-click it was given as buttons, so this pins that the bar
 * panels of these tabs really do get the card's zoom: a drag on any panel
 * narrows the card, a double-click on any panel puts the week back.
 */

const SLO_ID_STRING: string = "0193c0de-5555-4aaa-8bbb-000000000005";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;
const ZOOM_START: Date = new Date("2026-09-25T00:00:00.000Z");
const ZOOM_END: Date = new Date("2026-09-26T00:00:00.000Z");

interface MockBarCoreProps {
  categories: Array<string>;
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
}

let mockDragWindow: [Date, Date] = [ZOOM_START, ZOOM_END];
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
        fetchExemplars: (): Promise<Array<unknown>> => {
          return Promise.resolve([]);
        },
        setQueryTopNOverride: (): undefined => {
          return undefined;
        },
        getQueryConfigTopNKey: (
          _queryConfig: unknown,
          index: number,
          scope?: string,
        ): string => {
          return `${scope || ""}:${index}`;
        },
        serializeAttributeFiltersForKey: (attributes: unknown): string => {
          return JSON.stringify(attributes || {});
        },
      },
      DEFAULT_TOP_N_SERIES: 10,
      SHOW_ALL_SERIES_TOP_N: 10_000,
      sanitizeAttributeFilters: (attributes: unknown): unknown => {
        return attributes;
      },
    };
  },
);

// The recharts-drawn core: shows which zoom it was handed, and offers it.
jest.mock(
  "../../../UI/Components/Charts/ChartLibrary/BarChart/BarChart",
  () => {
    return {
      __esModule: true,
      BarChart: (props: MockBarCoreProps): React.ReactElement => {
        return (
          <div
            data-testid="bar-chart-core"
            data-categories={props.categories.join(",")}
            data-select={mockIdOf(props.onTimeRangeSelect)}
            data-reset={mockIdOf(props.onTimeRangeReset)}
          >
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeSelect?.(mockDragWindow[0], mockDragWindow[1]);
              }}
            >
              Drag across the bars
            </button>
            <button
              type="button"
              onDoubleClick={() => {
                props.onTimeRangeReset?.();
              }}
            >
              Double-click the bars
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

jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (props: {
      dashboardStartAndEndDate: { range: string };
    }): React.ReactElement => {
      return (
        <span data-testid="card-picker">
          {props.dashboardStartAndEndDate.range}
        </span>
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

import SloIncidentMetrics from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloIncidentMetrics";
import SloAlertMetrics from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloAlertMetrics";
import IncidentMetricTypeUtil from "../../../Utils/Incident/IncidentMetricType";
import AlertMetricTypeUtil from "../../../Utils/Alerts/AlertMetricType";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";

interface FetchCall {
  metricViewData: {
    startAndEndDate: { startValue: Date; endValue: Date };
    queryConfigs: Array<unknown>;
  };
}

function fetchCalls(): Array<FetchCall> {
  return fetchResultsMock.mock.calls.map((call: Array<unknown>): FetchCall => {
    return call[0] as FetchCall;
  });
}

function lastWindow(): [number, number] {
  const calls: Array<FetchCall> = fetchCalls();
  const last: FetchCall | undefined = calls[calls.length - 1];
  if (!last) {
    throw new Error("Nothing was fetched");
  }
  return [
    last.metricViewData.startAndEndDate.startValue.getTime(),
    last.metricViewData.startAndEndDate.endValue.getTime(),
  ];
}

// A week resolved at some point after NOW; MetricView floors the start.
function expectPastWeek(window: [number, number]): void {
  expect(window[1]).toBeGreaterThanOrEqual(NOW.getTime());
  expect(window[1] - window[0]).toBeGreaterThanOrEqual(7 * DAY_MS);
  expect(window[1] - window[0]).toBeLessThan(7 * DAY_MS + DAY_MS);
}

function bars(): Array<HTMLElement> {
  return screen.getAllByTestId("bar-chart-core");
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  mockDragWindow = [ZOOM_START, ZOOM_END];
  fetchResultsMock.mockReset();
  // One bar per query, inside whatever window was asked for.
  fetchResultsMock.mockImplementation(async (args: unknown) => {
    const call: FetchCall = args as FetchCall;
    const at: Date = new Date(
      call.metricViewData.startAndEndDate.startValue.getTime() + HOUR_MS,
    );
    return call.metricViewData.queryConfigs.map(() => {
      return { data: [{ timestamp: at, value: 3 }], truncated: false };
    });
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe.each([
  [
    "Incident Metrics",
    SloIncidentMetrics,
    IncidentMetricTypeUtil.getAllIncidentMetricTypes().length,
  ],
  [
    "Alert Metrics",
    SloAlertMetrics,
    AlertMetricTypeUtil.getAllAlertMetricTypes().length,
  ],
])(
  "SLO %s: bar panels zoom the card",
  (
    title: string,
    Component: React.FunctionComponent<{ sloId: ObjectID }>,
    panelCount: number,
  ) => {
    async function renderTab(): Promise<void> {
      render(<Component sloId={new ObjectID(SLO_ID_STRING)} />);
      await waitFor(() => {
        expect(bars()).toHaveLength(panelCount);
      });
      await settle();
    }

    test("every bar panel is handed the card's one drag, and no reset before a zoom", async () => {
      await renderTab();

      const selectIds: Array<string | null> = bars().map(
        (element: HTMLElement): string | null => {
          return element.getAttribute("data-select");
        },
      );
      expect(selectIds[0]).not.toBe("none");
      expect(new Set(selectIds).size).toBe(1);
      for (const element of bars()) {
        expect(element).toHaveAttribute("data-reset", "none");
      }
      // ChartGroup names the gesture over each bar panel.
      expect(screen.getAllByText("Drag to zoom")).toHaveLength(panelCount);
      expect(screen.getByText(title)).toBeInTheDocument();
    });

    test("a drag on a bar panel narrows the card; a double-click on ANOTHER panel puts the week back", async () => {
      await renderTab();
      expectPastWeek(lastWindow());
      fetchResultsMock.mockClear();

      fireEvent.click(
        screen.getAllByRole("button", { name: "Drag across the bars" })[0]!,
      );
      await settle();

      expect(lastWindow()).toEqual([ZOOM_START.getTime(), ZOOM_END.getTime()]);
      expect(screen.getByTestId("card-picker")).toHaveTextContent(
        TimeRange.CUSTOM,
      );
      expect(
        screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      ).toBeVisible();
      await waitFor(() => {
        const resetIds: Array<string | null> = bars().map(
          (element: HTMLElement): string | null => {
            return element.getAttribute("data-reset");
          },
        );
        expect(resetIds[0]).not.toBe("none");
        expect(new Set(resetIds).size).toBe(1);
      });
      expect(
        screen.getAllByText("Drag to zoom · double-click to reset"),
      ).toHaveLength(panelCount);
      fetchResultsMock.mockClear();

      fireEvent.doubleClick(
        screen.getAllByRole("button", { name: "Double-click the bars" })[
          panelCount - 1
        ]!,
      );
      await settle();

      expectPastWeek(lastWindow());
      expect(screen.getByTestId("card-picker")).toHaveTextContent(
        TimeRange.PAST_ONE_WEEK,
      );
      expect(
        screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      ).toBeNull();
    });
  },
);
