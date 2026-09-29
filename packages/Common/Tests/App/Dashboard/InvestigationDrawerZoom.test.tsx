/** @timezone UTC */

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
 * Issue #4105 inside the investigation drawer. The drawer is a panel over a
 * page, pinned to one window by whatever opened it. Its charts - the log
 * volume histogram and the metric card's charts - now zoom the WHOLE drawer:
 * the log stats, top patterns, findings, the metric card, the companion
 * tabs, the header and the AI prompt all move to the dragged window, and a
 * double-click on any chart (or Reset zoom) returns to the pinned window.
 * The page underneath is never retimed.
 *
 * The companion tabs and the metric card are separately tested surfaces;
 * here they are stand-ins that record what they are handed, and the card's
 * stand-in zooms whatever zoom it finds in context, the way the real card's
 * charts do. Recharts is stood in for so the histogram can be dragged.
 */

const histogramMock: MockFunction = getJestMockFunction();
const patternsMock: MockFunction = getJestMockFunction();
const companionTabsMock: MockFunction = getJestMockFunction();
const embeddedCardMock: MockFunction = getJestMockFunction();
const eventOverlayMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        eventOverlayMock(props);
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsInsightsApi",
  () => {
    return {
      __esModule: true,
      fetchLogsHistogramRaw: (...args: Array<any>) => {
        return histogramMock(...args);
      },
      fetchTopErrorPatterns: (...args: Array<any>) => {
        return patternsMock(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryCompanionSignalTabs",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        companionTabsMock(props);
        const react: typeof React = jest.requireActual("react") as typeof React;
        return react.createElement(
          "div",
          { "data-testid": "companion-tabs" },
          props["primarySignalElement"] as React.ReactElement,
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;
    const zoomContext: {
      useChartTimeRangeZoom: () => {
        onTimeRangeSelect: (startTime: Date, endTime: Date) => void;
        onTimeRangeReset: (() => void) | undefined;
        isZoomed: boolean;
      } | null;
    } = jest.requireActual(
      "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext",
    ) as {
      useChartTimeRangeZoom: () => {
        onTimeRangeSelect: (startTime: Date, endTime: Date) => void;
        onTimeRangeReset: (() => void) | undefined;
        isZoomed: boolean;
      } | null;
    };

    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        embeddedCardMock(props);
        const zoom: {
          onTimeRangeSelect: (startTime: Date, endTime: Date) => void;
          onTimeRangeReset: (() => void) | undefined;
          isZoomed: boolean;
        } | null = zoomContext.useChartTimeRangeZoom();

        return react.createElement(
          "div",
          { "data-testid": "embedded-metric-card" },
          react.createElement(
            "span",
            { "data-testid": "card-sees-zoomed" },
            String(Boolean(zoom?.isZoomed)),
          ),
          react.createElement(
            "button",
            {
              type: "button",
              onClick: () => {
                zoom?.onTimeRangeSelect(
                  new Date("2026-08-20T10:06:00.000Z"),
                  new Date("2026-08-20T10:09:00.000Z"),
                );
              },
            },
            "Drag on a metric chart",
          ),
          react.createElement(
            "button",
            {
              type: "button",
              onClick: () => {
                zoom?.onTimeRangeReset?.();
              },
            },
            "Double-click a metric chart",
          ),
          react.createElement(
            "button",
            {
              type: "button",
              onClick: () => {
                (props["onTimeRangeChange"] as (range: unknown) => void)({
                  range: "Past 1 Hour",
                });
              },
            },
            "Pick Past 1 Hour on the card",
          ),
        );
      },
    };
  },
);

jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  interface StubRow {
    time: string;
  }

  interface StubChartProps {
    data: Array<StubRow>;
    children?: React.ReactNode;
    onMouseDown?: (state: { activeLabel: string }) => void;
    onMouseMove?: (state: { activeLabel: string }) => void;
    onMouseUp?: (state: { activeLabel: string }) => void;
  }

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    BarChart: (props: StubChartProps) => {
      return react.createElement(
        "div",
        { "data-testid": "volume-bars" },
        props.data.map((row: StubRow) => {
          return react.createElement("div", {
            key: row.time,
            "data-testid": `bar-${row.time}`,
            onMouseDown: () => {
              props.onMouseDown?.({ activeLabel: row.time });
            },
            onMouseMove: () => {
              props.onMouseMove?.({ activeLabel: row.time });
            },
            onMouseUp: () => {
              props.onMouseUp?.({ activeLabel: row.time });
            },
          });
        }),
        props.children,
      );
    },
    Bar: nothing,
    XAxis: nothing,
    YAxis: nothing,
    Tooltip: nothing,
    ReferenceArea: nothing,
  };
});

import InvestigationDrawer from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/InvestigationDrawer";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { TimeRangeZoomProvider } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import { DOUBLE_CLICK_DISAMBIGUATION_MS } from "../../../UI/Components/Charts/ChartLibrary/Utils/DoubleClick";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

const NOW: Date = new Date("2026-08-20T12:00:00.000Z");

// The window the opener pinned: fifteen minutes, so one-minute bars.
const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-08-20T10:00:00.000Z"),
  new Date("2026-08-20T10:15:00.000Z"),
);

const PINNED: string = "2026-08-20T10:00:00.000Z..2026-08-20T10:15:00.000Z";

const BAR_A: string = "2026-08-20 10:03:00";
const BAR_B: string = "2026-08-20 10:04:00";

function buildViewData(): MetricViewData {
  return {
    queryConfigs: [
      {
        metricAliasData: { metricVariable: "a" },
        metricQueryData: {
          filterData: {
            metricName: "cpu.usage",
            attributes: { "host.name": "web-01" },
            aggegationType: MetricsAggregationType.Avg,
          },
        },
      },
    ],
    formulaConfigs: [],
    startAndEndDate: null,
  } as unknown as MetricViewData;
}

function lastHistogramWindow(): string {
  const calls: Array<Array<unknown>> = histogramMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const body: Record<string, unknown> = calls[calls.length - 1]![0] as Record<
    string,
    unknown
  >;
  return `${body["startTime"]}..${body["endTime"]}`;
}

function lastPatternWindow(): string {
  const calls: Array<Array<unknown>> = patternsMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const scope: { timeRange: RangeStartAndEndDateTime } = calls[
    calls.length - 1
  ]![0] as { timeRange: RangeStartAndEndDateTime };
  return `${scope.timeRange.startAndEndDate!.startValue.toISOString()}..${scope.timeRange.startAndEndDate!.endValue.toISOString()}`;
}

function lastProps(mock: MockFunction): Record<string, unknown> {
  const calls: Array<Array<unknown>> = mock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0] as Record<string, unknown>;
}

function companionWindow(): string {
  const window: InBetween<Date> = lastProps(companionTabsMock)[
    "snapshotWindow"
  ] as InBetween<Date>;
  return `${window.startValue.toISOString()}..${window.endValue.toISOString()}`;
}

function cardWindow(): string {
  const range: RangeStartAndEndDateTime = lastProps(embeddedCardMock)[
    "timeRange"
  ] as RangeStartAndEndDateTime;
  if (range.range !== TimeRange.CUSTOM) {
    return range.range;
  }
  return `${range.startAndEndDate!.startValue.toISOString()}..${range.startAndEndDate!.endValue.toISOString()}`;
}

function headerWindow(startIso: string, endIso: string): string {
  return `${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
    new Date(startIso),
  )} - ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
    new Date(endIso),
  )}`;
}

async function renderDrawer(
  window: InBetween<Date> = WINDOW,
): Promise<ReturnType<typeof render>> {
  let rendered: ReturnType<typeof render> | null = null;

  await act(async () => {
    rendered = render(
      <InvestigationDrawer
        title="host.name=web-01"
        window={window}
        metricViewData={buildViewData()}
        onClose={() => {}}
      />,
    );
  });

  await waitFor(() => {
    expect(screen.getByTestId(`bar-${BAR_A}`)).toBeInTheDocument();
  });

  return rendered!;
}

async function waitForDrawerOn(window: string): Promise<void> {
  await waitFor(() => {
    expect(lastHistogramWindow()).toBe(window);
  });
  await waitFor(() => {
    expect(lastPatternWindow()).toBe(window);
  });
  await waitFor(() => {
    expect(screen.getByTestId(`bar-${BAR_A}`)).toBeInTheDocument();
  });
  expect(companionWindow()).toBe(window);
  expect(cardWindow()).toBe(window);
}

function histogramPlot(): HTMLElement {
  return screen.getByTestId("volume-bars").parentElement!.parentElement!;
}

function resetButton(): HTMLElement | null {
  return screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  histogramMock.mockReset();
  patternsMock.mockReset();
  companionTabsMock.mockReset();
  embeddedCardMock.mockReset();
  eventOverlayMock.mockReset();

  histogramMock.mockImplementation(async () => {
    return [
      { time: BAR_A, severity: "Information", count: 90 },
      { time: BAR_B, severity: "Error", count: 10 },
    ];
  });
  patternsMock.mockImplementation(async () => {
    return [];
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("the drawer's log volume chart zooms the whole drawer", () => {
  test("the volume request names its bucket size, so the chart knows how wide its bars are", async () => {
    await renderDrawer();

    expect(lastProps(histogramMock)).toMatchObject({
      startTime: "2026-08-20T10:00:00.000Z",
      endTime: "2026-08-20T10:15:00.000Z",
      bucketSizeInMinutes: 1,
    });
    expect(screen.getByText("Click or drag to zoom")).toBeInTheDocument();
  });

  test("a drag moves every signal in the drawer to the dragged window", async () => {
    await renderDrawer();
    await waitForDrawerOn(PINNED);

    fireEvent.mouseDown(screen.getByTestId(`bar-${BAR_A}`));
    fireEvent.mouseMove(screen.getByTestId(`bar-${BAR_B}`));
    fireEvent.mouseUp(screen.getByTestId(`bar-${BAR_B}`));

    const zoomed: string = "2026-08-20T10:03:00.000Z..2026-08-20T10:05:00.000Z";
    await waitForDrawerOn(zoomed);

    // The event markers are read for the same window.
    const overlay: { window: InBetween<Date> } = lastProps(
      eventOverlayMock,
    ) as unknown as { window: InBetween<Date> };
    expect(overlay.window.startValue.toISOString()).toBe(
      "2026-08-20T10:03:00.000Z",
    );
    // And the header says so.
    expect(
      screen.getByText(
        headerWindow("2026-08-20T10:03:00.000Z", "2026-08-20T10:05:00.000Z"),
      ),
    ).toBeInTheDocument();
    expect(resetButton()).toBeInTheDocument();
  });

  test("a click on one bar zooms into that minute", async () => {
    await renderDrawer();

    fireEvent.mouseDown(screen.getByTestId(`bar-${BAR_B}`));
    fireEvent.mouseUp(screen.getByTestId(`bar-${BAR_B}`));

    await waitForDrawerOn("2026-08-20T10:04:00.000Z..2026-08-20T10:05:00.000Z");
  });

  test("a double-click on the chart returns the drawer to the pinned window", async () => {
    await renderDrawer();

    fireEvent.mouseDown(screen.getByTestId(`bar-${BAR_A}`));
    fireEvent.mouseUp(screen.getByTestId(`bar-${BAR_B}`));
    await waitForDrawerOn("2026-08-20T10:03:00.000Z..2026-08-20T10:05:00.000Z");

    expect(screen.getByText("Double-click to reset")).toBeInTheDocument();
    fireEvent.doubleClick(histogramPlot());
    act(() => {
      jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);
    });

    await waitForDrawerOn(PINNED);
    expect(resetButton()).toBeNull();
    expect(
      screen.getByText(
        headerWindow("2026-08-20T10:00:00.000Z", "2026-08-20T10:15:00.000Z"),
      ),
    ).toBeInTheDocument();
  });

  test("the previous window's numbers are cleared while the zoomed ones load", async () => {
    await renderDrawer();
    await waitFor(() => {
      expect(screen.getByText("100")).toBeInTheDocument();
    });

    let resolveZoomed: ((value: Array<unknown>) => void) | null = null;
    histogramMock.mockImplementation(() => {
      return new Promise((resolve: (value: Array<unknown>) => void) => {
        resolveZoomed = resolve;
      });
    });

    fireEvent.mouseDown(screen.getByTestId(`bar-${BAR_A}`));
    fireEvent.mouseUp(screen.getByTestId(`bar-${BAR_B}`));

    await waitFor(() => {
      expect(screen.queryByText("100")).toBeNull();
    });
    expect(screen.getAllByText("…").length).toBeGreaterThan(0);

    await act(async () => {
      resolveZoomed!([{ time: BAR_A, severity: "Error", count: 7 }]);
    });
    await waitFor(() => {
      expect(screen.getAllByText("7").length).toBeGreaterThan(0);
    });
  });
});

describe("the metric card shares the drawer's zoom", () => {
  test("the card is controlled by the drawer's window and sees its zoom", async () => {
    await renderDrawer();

    expect(lastProps(embeddedCardMock)["defaultTimeRange"]).toBeUndefined();
    expect(cardWindow()).toBe(PINNED);
    expect(screen.getByTestId("card-sees-zoomed")).toHaveTextContent("false");
  });

  test("a drag on a metric chart zooms the whole drawer, log chart included", async () => {
    await renderDrawer();

    fireEvent.click(screen.getByText("Drag on a metric chart"));

    await waitForDrawerOn("2026-08-20T10:06:00.000Z..2026-08-20T10:09:00.000Z");
    expect(screen.getByTestId("card-sees-zoomed")).toHaveTextContent("true");
    expect(screen.getByText("Double-click to reset")).toBeInTheDocument();
  });

  test("a double-click on a metric chart undoes a zoom made on the log chart", async () => {
    await renderDrawer();

    fireEvent.mouseDown(screen.getByTestId(`bar-${BAR_A}`));
    fireEvent.mouseUp(screen.getByTestId(`bar-${BAR_B}`));
    await waitForDrawerOn("2026-08-20T10:03:00.000Z..2026-08-20T10:05:00.000Z");

    fireEvent.click(screen.getByText("Double-click a metric chart"));

    await waitForDrawerOn(PINNED);
  });

  test("a range picked on the card moves the drawer, and Reset zoom still leads back to the pinned window", async () => {
    await renderDrawer();

    fireEvent.click(screen.getByText("Pick Past 1 Hour on the card"));

    await waitFor(() => {
      expect(lastHistogramWindow()).toBe(
        "2026-08-20T11:00:00.000Z..2026-08-20T12:00:00.000Z",
      );
    });
    // The card keeps showing the range as picked.
    expect(cardWindow()).toBe(TimeRange.PAST_ONE_HOUR);
    expect(resetButton()).toBeInTheDocument();

    fireEvent.click(resetButton()!);

    await waitForDrawerOn(PINNED);
  });
});

describe("the drawer never retimes the page under it", () => {
  test("a page zoom around the drawer is shadowed and never called", async () => {
    const pageSelect: MockFunction = getJestMockFunction();
    const pageReset: MockFunction = getJestMockFunction();
    const pageZoom: TimeRangeZoom = {
      isZoomed: true,
      rangeBeforeZoom: { range: TimeRange.PAST_ONE_DAY },
      zoomToTimeRange: (startTime: Date, endTime: Date): void => {
        pageSelect(startTime, endTime);
      },
      resetZoom: (): void => {
        pageReset();
      },
    };

    await act(async () => {
      render(
        <TimeRangeZoomProvider zoom={pageZoom}>
          <InvestigationDrawer
            window={WINDOW}
            metricViewData={buildViewData()}
            onClose={() => {}}
          />
        </TimeRangeZoomProvider>,
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId(`bar-${BAR_A}`)).toBeInTheDocument();
    });

    // The page is zoomed; the drawer is not.
    expect(screen.getByTestId("card-sees-zoomed")).toHaveTextContent("false");
    expect(resetButton()).toBeNull();

    fireEvent.click(screen.getByText("Drag on a metric chart"));
    await waitForDrawerOn("2026-08-20T10:06:00.000Z..2026-08-20T10:09:00.000Z");
    fireEvent.click(screen.getByText("Double-click a metric chart"));
    await waitForDrawerOn(PINNED);

    expect(pageSelect).not.toHaveBeenCalled();
    expect(pageReset).not.toHaveBeenCalled();
  });

  test("an opener that pins a new window starts the drawer fresh", async () => {
    const rendered: ReturnType<typeof render> = await renderDrawer();

    fireEvent.click(screen.getByText("Drag on a metric chart"));
    await waitForDrawerOn("2026-08-20T10:06:00.000Z..2026-08-20T10:09:00.000Z");

    const nextWindow: InBetween<Date> = new InBetween<Date>(
      new Date("2026-08-20T09:00:00.000Z"),
      new Date("2026-08-20T09:15:00.000Z"),
    );

    await act(async () => {
      rendered.rerender(
        <InvestigationDrawer
          title="host.name=web-01"
          window={nextWindow}
          metricViewData={buildViewData()}
          onClose={() => {}}
        />,
      );
    });

    await waitFor(() => {
      expect(lastHistogramWindow()).toBe(
        "2026-08-20T09:00:00.000Z..2026-08-20T09:15:00.000Z",
      );
    });
    expect(resetButton()).toBeNull();
  });
});

describe("an opener re-rendering with an equal view keeps the drawer as it is", () => {
  /*
   * A dashboard chart widget rebuilds its metricViewData on every
   * auto-refresh tick, with the same queries and the drawer's window
   * unchanged. Nothing in the drawer may reload, or blank what it shows,
   * for that: the stats would flash "…", the chart would turn into a
   * spinner, Findings would claim nothing stands out, and Explain with AI
   * or Save to incident clicked in that gap would carry no log evidence.
   */
  async function rerenderWithEqualView(
    rendered: ReturnType<typeof render>,
    window: InBetween<Date> = new InBetween<Date>(
      new Date(WINDOW.startValue.getTime()),
      new Date(WINDOW.endValue.getTime()),
    ),
  ): Promise<void> {
    await act(async () => {
      rendered.rerender(
        <InvestigationDrawer
          title="host.name=web-01"
          window={window}
          metricViewData={buildViewData()}
          onClose={() => {}}
        />,
      );
    });
  }

  test("the stats, the chart and the patterns stay on screen, and nothing is asked again", async () => {
    patternsMock.mockImplementation(async () => {
      return [
        {
          pattern: "connection refused to <ip>",
          sampleBody: "connection refused to 10.0.0.5",
          count: 10,
        },
      ];
    });
    const rendered: ReturnType<typeof render> = await renderDrawer();
    await waitFor(() => {
      expect(screen.getByText("100")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        screen.getByText("connection refused to 10.0.0.5"),
      ).toBeInTheDocument();
    });
    // The finding the evidence supports (all ten errors are this pattern).
    expect(
      screen.getByText(/^One error pattern accounts for ~100%/),
    ).toBeInTheDocument();
    const histogramCalls: number = histogramMock.mock.calls.length;
    const patternCalls: number = patternsMock.mock.calls.length;

    // The refetch this would have started never lands, to catch any blanking.
    histogramMock.mockImplementation(() => {
      return new Promise(() => {});
    });
    patternsMock.mockImplementation(() => {
      return new Promise(() => {});
    });

    await rerenderWithEqualView(rendered);
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(histogramMock.mock.calls.length).toBe(histogramCalls);
    expect(patternsMock.mock.calls.length).toBe(patternCalls);
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.queryAllByText("…")).toHaveLength(0);
    expect(screen.getByTestId(`bar-${BAR_A}`)).toBeInTheDocument();
    expect(
      screen.getByText("connection refused to 10.0.0.5"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).toBeNull();
    // Findings still read the evidence, rather than "nothing stands out".
    expect(
      screen.getByText(/^One error pattern accounts for ~100%/),
    ).toBeInTheDocument();
  });

  test("the metric card, the companion tabs and the event markers are handed the same queries", async () => {
    const rendered: ReturnType<typeof render> = await renderDrawer();
    const cardQueries: unknown = lastProps(embeddedCardMock)["queryConfigs"];
    const companionQuery: unknown = lastProps(companionTabsMock)[
      "telemetryQuery"
    ];
    const markerQueries: unknown = (
      lastProps(eventOverlayMock) as { queryConfigs: unknown }
    ).queryConfigs;

    await rerenderWithEqualView(rendered);

    /*
     * Same objects, not equal copies: the card resets its Top-N override on
     * a new query array, and the companion tabs' discovery effect and the
     * event markers refetch on a new one.
     */
    expect(lastProps(embeddedCardMock)["queryConfigs"]).toBe(cardQueries);
    expect(lastProps(companionTabsMock)["telemetryQuery"]).toBe(
      companionQuery,
    );
    expect(
      (lastProps(eventOverlayMock) as { queryConfigs: unknown }).queryConfigs,
    ).toBe(markerQueries);
  });

  test("a zoom made in the drawer survives the re-render, and is not reloaded", async () => {
    const rendered: ReturnType<typeof render> = await renderDrawer();

    fireEvent.mouseDown(screen.getByTestId(`bar-${BAR_A}`));
    fireEvent.mouseUp(screen.getByTestId(`bar-${BAR_B}`));
    const zoomed: string = "2026-08-20T10:03:00.000Z..2026-08-20T10:05:00.000Z";
    await waitForDrawerOn(zoomed);
    await waitFor(() => {
      expect(screen.getByText("100")).toBeInTheDocument();
    });
    const histogramCalls: number = histogramMock.mock.calls.length;

    await rerenderWithEqualView(rendered);

    expect(histogramMock.mock.calls.length).toBe(histogramCalls);
    expect(lastHistogramWindow()).toBe(zoomed);
    expect(cardWindow()).toBe(zoomed);
    expect(companionWindow()).toBe(zoomed);
    expect(resetButton()).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  test("a range picked on the card survives the re-render too", async () => {
    const rendered: ReturnType<typeof render> = await renderDrawer();

    fireEvent.click(screen.getByText("Pick Past 1 Hour on the card"));
    await waitFor(() => {
      expect(lastHistogramWindow()).toBe(
        "2026-08-20T11:00:00.000Z..2026-08-20T12:00:00.000Z",
      );
    });

    await rerenderWithEqualView(rendered);

    expect(cardWindow()).toBe(TimeRange.PAST_ONE_HOUR);
    expect(resetButton()).toBeInTheDocument();
  });

  test("a genuinely different scope does reload, and clears the old scope's numbers meanwhile", async () => {
    const rendered: ReturnType<typeof render> = await renderDrawer();
    await waitFor(() => {
      expect(screen.getByText("100")).toBeInTheDocument();
    });

    let resolveNext: ((value: Array<unknown>) => void) | null = null;
    histogramMock.mockImplementation(() => {
      return new Promise((resolve: (value: Array<unknown>) => void) => {
        resolveNext = resolve;
      });
    });

    const otherHost: MetricViewData = buildViewData();
    (
      otherHost.queryConfigs[0]!.metricQueryData.filterData as unknown as {
        attributes: Record<string, string>;
      }
    ).attributes = { "host.name": "web-02" };

    await act(async () => {
      rendered.rerender(
        <InvestigationDrawer
          title="host.name=web-02"
          window={WINDOW}
          metricViewData={otherHost}
          onClose={() => {}}
        />,
      );
    });

    await waitFor(() => {
      expect(lastProps(histogramMock)).toMatchObject({
        attributes: { "host.name": "web-02" },
      });
    });
    expect(screen.queryByText("100")).toBeNull();
    expect(screen.getAllByText("…").length).toBeGreaterThan(0);

    await act(async () => {
      resolveNext!([{ time: BAR_A, severity: "Error", count: 7 }]);
    });
    await waitFor(() => {
      expect(screen.getAllByText("7").length).toBeGreaterThan(0);
    });
  });
});

describe("what the drawer hands on follows its window", () => {
  test("Explain with AI describes the zoomed window", async () => {
    const dispatchSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(GlobalEvents, "dispatchEvent")
      .mockImplementation(() => {
        return undefined;
      });

    await renderDrawer();
    fireEvent.click(screen.getByText("Drag on a metric chart"));
    await waitForDrawerOn("2026-08-20T10:06:00.000Z..2026-08-20T10:09:00.000Z");

    fireEvent.click(screen.getByText("Explain with AI"));

    const detail: { prompt: string } = dispatchSpy.mock.calls[
      dispatchSpy.mock.calls.length - 1
    ]![1] as { prompt: string };
    expect(detail.prompt).toContain(
      `${OneUptimeDate.getDateAsFormattedString(
        new Date("2026-08-20T10:06:00.000Z"),
      )} — ${OneUptimeDate.getDateAsFormattedString(
        new Date("2026-08-20T10:09:00.000Z"),
      )}`,
    );
  });
});
