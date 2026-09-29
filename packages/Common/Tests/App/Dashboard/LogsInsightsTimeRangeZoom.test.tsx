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
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 on Logs > Insights. The page owns one time range; every panel
 * on it (stat cards, severity split, top errors, sources) and the error
 * drawer are fetched for it. The drawer's "When it happened" timeline is the
 * page's time chart: a drag across it retimes the WHOLE page, the drawer
 * stays open and follows, the picker reads Custom and offers Reset zoom, and
 * a double-click (or Reset zoom) puts the page back. A range picked from the
 * picker is still a new starting point that closes the drawer.
 *
 * The page's data layer (LogsInsightsApi) is mocked so every request's
 * scope can be read back; recharts is stood in for with a chart that lays
 * each bucket out as a div (see LogsHistogramDragTooltip.test.tsx).
 */

const histogramMock: MockFunction = getJestMockFunction();
const patternsMock: MockFunction = getJestMockFunction();
const breakdownMock: MockFunction = getJestMockFunction();
const facetsMock: MockFunction = getJestMockFunction();
const correlationMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsInsightsApi",
  () => {
    return {
      __esModule: true,
      fetchInsightsHistogram: (...args: Array<any>) => {
        return histogramMock(...args);
      },
      fetchTopErrorPatterns: (...args: Array<any>) => {
        return patternsMock(...args);
      },
      fetchResourceBreakdown: (...args: Array<any>) => {
        return breakdownMock(...args);
      },
      fetchScopeFacets: (...args: Array<any>) => {
        return facetsMock(...args);
      },
      fetchErrorPatternCorrelation: (...args: Array<any>) => {
        return correlationMock(...args);
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async () => {
        return { data: [], count: 0 };
      },
      getItem: async () => {
        return null;
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const ObjectIDModule: { default: new (id: string) => unknown } =
          jest.requireActual("../../../Types/ObjectID") as {
            default: new (id: string) => unknown;
          };
        return new ObjectIDModule.default(
          "11111111-1111-4111-8111-111111111111",
        );
      },
    },
  };
});

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return new Map();
    },
  };
});

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
        { "data-testid": "timeline-bars" },
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

import LogsDashboard from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsDashboard";
import { ERROR_PATTERN_TIMELINE_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/ErrorPatternDetail";
import {
  LogsInsightsScope,
  TopErrorPatternRow,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/LogsInsights";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { TIME_RANGE_ZOOM_HINT_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import { getTimeRangeButtonLabel } from "../../../UI/Components/Date/TimeRangePickerDropdown";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import TimeRange from "../../../Types/Time/TimeRange";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const PATTERN_TEXT: string = "connection refused to <ip>";

// The count the list reports, per window: a zoomed window counts fewer.
function patternRow(count: number, firstSeen: string): TopErrorPatternRow {
  return {
    pattern: PATTERN_TEXT,
    sampleBody: "connection refused to 10.0.0.5",
    count: count,
    firstSeenAt: new Date(firstSeen),
    lastSeenAt: new Date("2026-09-28T11:11:30.000Z"),
    resourceCount: 1,
    resourceIds: [],
    severities: ["Error"],
    traceCount: 0,
    sampleTraceIds: [],
  };
}

function isCustom(scope: LogsInsightsScope): boolean {
  return scope.timeRange.range === TimeRange.CUSTOM;
}

function windowOf(scope: LogsInsightsScope): string {
  if (!isCustom(scope)) {
    return scope.timeRange.range;
  }
  return `${scope.timeRange.startAndEndDate!.startValue.toISOString()}..${scope.timeRange.startAndEndDate!.endValue.toISOString()}`;
}

function lastScope(mock: MockFunction): string {
  const calls: Array<Array<unknown>> = mock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return windowOf(calls[calls.length - 1]![0] as LogsInsightsScope);
}

const ZOOMED: string = "2026-09-28T11:10:00.000Z..2026-09-28T11:12:00.000Z";

function pickerLabel(): string {
  return (
    screen.getByTestId("telemetry-time-range-picker-button").textContent || ""
  ).trim();
}

function drawer(): HTMLElement | null {
  return screen.queryByRole("dialog");
}

// The page's Reset zoom: the one beside the header picker, outside the drawer.
function pageResetButton(): HTMLElement | null {
  const panel: HTMLElement | null = drawer();

  return (
    screen
      .queryAllByRole("button", { name: "Reset zoom" })
      .find((button: HTMLElement): boolean => {
        return !panel || !panel.contains(button);
      }) || null
  );
}

// The drawer's own Reset zoom, above its timeline.
function drawerResetButton(): HTMLElement | null {
  const panel: HTMLElement | null = drawer();

  return panel
    ? within(panel).queryByRole("button", { name: "Reset zoom" })
    : null;
}

async function renderPage(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <LogsDashboard />
      </MemoryRouter>,
    );
  });

  await waitFor(() => {
    expect(
      screen.getByText("connection refused to 10.0.0.5", {
        selector: "p, span, div",
      }),
    ).toBeInTheDocument();
  });
}

async function openDrawer(): Promise<void> {
  fireEvent.click(
    screen
      .getAllByText("connection refused to 10.0.0.5")[0]!
      .closest("button")!,
  );

  await waitFor(() => {
    expect(
      screen.getByTestId(ERROR_PATTERN_TIMELINE_TEST_ID),
    ).toBeInTheDocument();
  });
}

function dragTimeline(fromIso: string, toIso: string): void {
  fireEvent.mouseDown(screen.getByTestId(`bar-${fromIso}`));
  fireEvent.mouseMove(screen.getByTestId(`bar-${toIso}`));
  fireEvent.mouseUp(screen.getByTestId(`bar-${toIso}`));
}

async function waitForPageOn(window: string): Promise<void> {
  for (const mock of [histogramMock, patternsMock, breakdownMock, facetsMock]) {
    await waitFor(() => {
      expect(lastScope(mock)).toBe(window);
    });
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.history.replaceState({}, "", "/");

  for (const mock of [
    histogramMock,
    patternsMock,
    breakdownMock,
    facetsMock,
    correlationMock,
  ]) {
    mock.mockReset();
  }

  histogramMock.mockImplementation(async () => {
    return [
      { time: "2026-09-28 11:10:00", severity: "Error", count: 8 },
      { time: "2026-09-28 11:10:00", severity: "Information", count: 40 },
    ];
  });
  patternsMock.mockImplementation(async (scope: LogsInsightsScope) => {
    return isCustom(scope)
      ? [patternRow(8, "2026-09-28T11:10:05.000Z")]
      : [patternRow(42, "2026-09-28T11:00:05.000Z")];
  });
  breakdownMock.mockImplementation(async () => {
    return [];
  });
  facetsMock.mockImplementation(async () => {
    return {};
  });
  correlationMock.mockImplementation(async () => {
    return {
      pattern: PATTERN_TEXT,
      bucketSizeInMinutes: 1,
      timeline: [
        { time: new Date("2026-09-28T11:10:00.000Z"), count: 3 },
        { time: new Date("2026-09-28T11:11:00.000Z"), count: 5 },
      ],
      coOccurringPatterns: [],
      attributes: [],
      resources: [],
      traces: [],
      samples: [],
    };
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("the error drawer's timeline zooms the Insights page", () => {
  test("the timeline draws every minute of the window, quiet ones included", async () => {
    await renderPage();
    await openDrawer();

    expect(
      screen.getByTestId("bar-2026-09-28T11:10:00.000Z"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("bar-2026-09-28T11:00:00.000Z"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("bar-2026-09-28T11:59:00.000Z"),
    ).toBeInTheDocument();
    expect(screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toHaveTextContent(
      "Drag to zoom",
    );
  });

  test("a drag re-fetches every panel on the page for the dragged window, and the drawer follows", async () => {
    await renderPage();
    await openDrawer();

    expect(lastScope(histogramMock)).toBe(TimeRange.PAST_ONE_HOUR);
    expect(lastScope(correlationMock)).toBe(TimeRange.PAST_ONE_HOUR);

    dragTimeline("2026-09-28T11:10:00.000Z", "2026-09-28T11:11:00.000Z");

    await waitForPageOn(ZOOMED);
    await waitFor(() => {
      expect(lastScope(correlationMock)).toBe(ZOOMED);
    });

    /*
     * The drawer stayed open through the page's reload - and stayed
     * MOUNTED: one correlation for the opening, one for the zoom. A drawer
     * unmounted by the loading state and mounted again would have asked a
     * third time.
     */
    expect(drawer()).not.toBeNull();
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(correlationMock).toHaveBeenCalledTimes(2);
    expect(pickerLabel()).toBe(
      getTimeRangeButtonLabel({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date("2026-09-28T11:10:00.000Z"),
          new Date("2026-09-28T11:12:00.000Z"),
        ),
      }),
    );
    expect(pageResetButton()).not.toBeNull();
  });

  test("the zoomed drawer takes its row from the reloaded list and counts its own window", async () => {
    await renderPage();
    await openDrawer();

    dragTimeline("2026-09-28T11:10:00.000Z", "2026-09-28T11:11:00.000Z");
    await waitFor(() => {
      expect(lastScope(correlationMock)).toBe(ZOOMED);
    });

    // 3 + 5 in the correlation fetched for the zoomed window.
    await waitFor(() => {
      expect(
        within(drawer()!).getByText(/^8 times in the selected time range/),
      ).toBeInTheDocument();
    });

    // First seen as the zoomed window's list reports it.
    expect(drawer()!).toHaveTextContent(
      `First seen ${OneUptimeDate.getDateAsLocalFormattedString(
        new Date("2026-09-28T11:10:05.000Z"),
      )}`,
    );
  });

  test("a double-click on the timeline puts the page back, drawer still open", async () => {
    await renderPage();
    await openDrawer();

    dragTimeline("2026-09-28T11:10:00.000Z", "2026-09-28T11:11:00.000Z");
    await waitForPageOn(ZOOMED);
    await waitFor(() => {
      expect(
        screen.getByTestId(ERROR_PATTERN_TIMELINE_TEST_ID),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toHaveTextContent(
      "Double-click to reset",
    );

    fireEvent.doubleClick(screen.getByTestId(ERROR_PATTERN_TIMELINE_TEST_ID));

    await waitForPageOn(TimeRange.PAST_ONE_HOUR);
    await waitFor(() => {
      expect(lastScope(correlationMock)).toBe(TimeRange.PAST_ONE_HOUR);
    });
    expect(drawer()).not.toBeNull();
    expect(pickerLabel()).toBe("Past 1 Hour");
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("Reset zoom beside the picker puts the page back too", async () => {
    await renderPage();
    await openDrawer();

    dragTimeline("2026-09-28T11:10:00.000Z", "2026-09-28T11:11:00.000Z");
    await waitForPageOn(ZOOMED);

    fireEvent.click(pageResetButton()!);

    await waitForPageOn(TimeRange.PAST_ONE_HOUR);
    expect(pickerLabel()).toBe("Past 1 Hour");
    expect(drawer()).not.toBeNull();
  });

  test("a range picked from the picker is a new starting point: the zoom ends and the drawer closes", async () => {
    await renderPage();
    await openDrawer();

    dragTimeline("2026-09-28T11:10:00.000Z", "2026-09-28T11:11:00.000Z");
    await waitForPageOn(ZOOMED);

    fireEvent.click(screen.getByTestId("telemetry-time-range-picker-button"));
    fireEvent.click(
      within(
        screen.getByTestId("telemetry-time-range-picker-dropdown"),
      ).getByText("Past 1 Day"),
    );

    await waitForPageOn(TimeRange.PAST_ONE_DAY);
    await waitFor(() => {
      expect(drawer()).toBeNull();
    });
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("a drag across two bars zooms the page to exactly those two buckets, right to left too", async () => {
    await renderPage();
    await openDrawer();

    dragTimeline("2026-09-28T11:11:00.000Z", "2026-09-28T11:10:00.000Z");

    await waitForPageOn(ZOOMED);
  });

  test("a drag across three bars keeps the last one whole", async () => {
    await renderPage();
    await openDrawer();

    dragTimeline("2026-09-28T11:20:00.000Z", "2026-09-28T11:22:00.000Z");

    await waitForPageOn("2026-09-28T11:20:00.000Z..2026-09-28T11:23:00.000Z");
  });
});

describe("a plain click on the drawer's timeline is not a zoom", () => {
  /*
   * The timeline sits in a drawer and retimes the whole Insights page, so a
   * click on a bar - to read its tooltip, or on the way to something else -
   * must not reload every panel on the page for one bucket.
   */
  function clickBar(iso: string): void {
    fireEvent.mouseDown(screen.getByTestId(`bar-${iso}`));
    fireEvent.mouseUp(screen.getByTestId(`bar-${iso}`));
  }

  function requestCounts(): Array<number> {
    return [histogramMock, patternsMock, breakdownMock, facetsMock].map(
      (mock: MockFunction): number => {
        return mock.mock.calls.length;
      },
    );
  }

  test("one click on a bar leaves the page, the picker and the drawer as they were", async () => {
    await renderPage();
    await openDrawer();
    const before: Array<number> = requestCounts();

    clickBar("2026-09-28T11:10:00.000Z");
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(requestCounts()).toEqual(before);
    expect(correlationMock).toHaveBeenCalledTimes(1);
    expect(pickerLabel()).toBe("Past 1 Hour");
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
    expect(screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toHaveTextContent(
      /^Drag to zoom$/,
    );
  });

  test("while zoomed, a click on a bar still zooms nothing, even after the double-click wait", async () => {
    await renderPage();
    await openDrawer();
    dragTimeline("2026-09-28T11:10:00.000Z", "2026-09-28T11:11:00.000Z");
    await waitForPageOn(ZOOMED);
    await waitFor(() => {
      expect(
        screen.getByTestId(ERROR_PATTERN_TIMELINE_TEST_ID),
      ).toBeInTheDocument();
    });
    const before: Array<number> = requestCounts();

    clickBar("2026-09-28T11:10:00.000Z");
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(requestCounts()).toEqual(before);
    expect(lastScope(histogramMock)).toBe(ZOOMED);
    expect(pageResetButton()).not.toBeNull();
  });

  test("a zoom into a stretch the error skipped: the message takes the double-click back, and selects no text", async () => {
    await renderPage();
    await openDrawer();

    correlationMock.mockImplementation(async () => {
      return {
        pattern: PATTERN_TEXT,
        bucketSizeInMinutes: 1,
        timeline: [],
        coOccurringPatterns: [],
        attributes: [],
        resources: [],
        traces: [],
        samples: [],
      };
    });
    dragTimeline("2026-09-28T11:10:00.000Z", "2026-09-28T11:11:00.000Z");
    await waitForPageOn(ZOOMED);

    const message: HTMLElement = await screen.findByText(
      "No bucketed occurrences to chart in this window.",
    );
    expect(message).toHaveClass("select-none");

    fireEvent.doubleClick(message);

    await waitForPageOn(TimeRange.PAST_ONE_HOUR);
  });
});

describe("the drawer offers its own way back from a zoom made in it", () => {
  /*
   * A zoom made on the drawer's timeline keeps the drawer open, and the
   * wide drawer covers the header picker and the Reset zoom beside it. So
   * the timeline's heading carries a Reset zoom of its own while the page
   * is zoomed: undoing the zoom needs neither the double-click nor the
   * drawer closed, and works from the keyboard.
   */
  async function zoomFromTheDrawer(): Promise<void> {
    await renderPage();
    await openDrawer();

    dragTimeline("2026-09-28T11:10:00.000Z", "2026-09-28T11:11:00.000Z");
    await waitForPageOn(ZOOMED);
    // The drawer's body is back once the zoomed correlation has landed.
    await waitFor(() => {
      expect(
        screen.getByTestId(ERROR_PATTERN_TIMELINE_TEST_ID),
      ).toBeInTheDocument();
    });
  }

  test("before any zoom the timeline's heading names the gesture and offers no reset", async () => {
    await renderPage();
    await openDrawer();

    expect(drawerResetButton()).toBeNull();
    expect(
      within(drawer()!).getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID),
    ).toHaveTextContent(/^Drag to zoom$/);
  });

  test("after a drag, Reset zoom sits beside the timeline's hint, naming the range it goes back to", async () => {
    await zoomFromTheDrawer();

    const button: HTMLElement | null = drawerResetButton();
    expect(button).not.toBeNull();

    // In the "When it happened" heading row, next to the hint.
    const hint: HTMLElement = within(drawer()!).getByTestId(
      TIME_RANGE_ZOOM_HINT_TEST_ID,
    );
    expect(hint).toHaveTextContent("Double-click to reset");
    expect(button!.parentElement).toBe(hint.parentElement);
    expect(hint.parentElement!.parentElement!).toHaveTextContent(
      "When it happened",
    );

    // It reads the page's zoom: the way back is to the page's own preset.
    expect(button).toHaveAttribute(
      "title",
      "Go back to Past 1 Hour, the time range before the zoom",
    );
    // The page keeps its own Reset zoom beside the picker as well.
    expect(pageResetButton()).not.toBeNull();
  });

  test("it puts the whole page back, and the drawer stays open on the original range", async () => {
    await zoomFromTheDrawer();
    const correlationsBefore: number = correlationMock.mock.calls.length;

    fireEvent.click(drawerResetButton()!);

    await waitForPageOn(TimeRange.PAST_ONE_HOUR);
    await waitFor(() => {
      expect(lastScope(correlationMock)).toBe(TimeRange.PAST_ONE_HOUR);
    });
    expect(correlationMock).toHaveBeenCalledTimes(correlationsBefore + 1);
    expect(pickerLabel()).toBe("Past 1 Hour");
    expect(drawer()).not.toBeNull();
    await waitFor(() => {
      expect(
        screen.getByTestId(ERROR_PATTERN_TIMELINE_TEST_ID),
      ).toBeInTheDocument();
    });

    // Nothing left to undo, in the drawer or beside the picker.
    expect(drawerResetButton()).toBeNull();
    expect(pageResetButton()).toBeNull();
    expect(
      within(drawer()!).getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID),
    ).toHaveTextContent(/^Drag to zoom$/);
  });

  test("it is a real button, so the keyboard reaches it with the drawer open", async () => {
    await zoomFromTheDrawer();

    const button: HTMLElement = drawerResetButton()!;
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");

    button.focus();
    expect(document.activeElement).toBe(button);
  });

  test("the page's own Reset zoom takes the drawer's away too", async () => {
    await zoomFromTheDrawer();

    fireEvent.click(pageResetButton()!);

    await waitForPageOn(TimeRange.PAST_ONE_HOUR);
    await waitFor(() => {
      expect(
        screen.getByTestId(ERROR_PATTERN_TIMELINE_TEST_ID),
      ).toBeInTheDocument();
    });
    expect(drawerResetButton()).toBeNull();
  });
});

describe("a superseded correlation never paints over the window the page is on", () => {
  /*
   * The drawer stays open while a zoom made on its timeline, or the reset
   * of one, moves the page, and each move asks for the drawer's correlation
   * again. A wide window answers slower than a narrow one, so the answers
   * can land in either order. Whichever does, the drawer describes the
   * window the page and its picker are on.
   */
  interface PendingCorrelation {
    window: string;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }

  const pending: Array<PendingCorrelation> = [];

  // One error bar at 11:10 and one at 11:11, with these counts.
  function correlationWith(
    first: number,
    second: number,
  ): Record<string, unknown> {
    return {
      pattern: PATTERN_TEXT,
      bucketSizeInMinutes: 1,
      timeline: [
        { time: new Date("2026-09-28T11:10:00.000Z"), count: first },
        { time: new Date("2026-09-28T11:11:00.000Z"), count: second },
      ],
      coOccurringPatterns: [],
      attributes: [],
      resources: [],
      traces: [],
      samples: [],
    };
  }

  // What the hour holds, and what the zoomed two minutes hold.
  const HOUR_ANSWER: Record<string, unknown> = correlationWith(20, 22);
  const ZOOMED_ANSWER: Record<string, unknown> = correlationWith(3, 5);

  function answerLater(): void {
    pending.length = 0;
    correlationMock.mockImplementation((scope: LogsInsightsScope) => {
      return new Promise(
        (resolve: (value: unknown) => void, reject: (error: Error) => void) => {
          pending.push({ window: windowOf(scope), resolve, reject });
        },
      );
    });
  }

  function drawerLoader(): HTMLElement | null {
    return within(drawer()!).queryByTestId("component-loader");
  }

  function drawerCount(pattern: RegExp): HTMLElement | null {
    return within(drawer()!).queryByText(pattern);
  }

  /*
   * The reader zoomed from the drawer (its correlation still out) and put
   * the page back with Reset zoom before it landed (that one out too).
   */
  async function zoomThenResetWhileBothAreOut(): Promise<{
    zoomed: PendingCorrelation;
    reset: PendingCorrelation;
  }> {
    await renderPage();
    await openDrawer();
    answerLater();

    dragTimeline("2026-09-28T11:10:00.000Z", "2026-09-28T11:11:00.000Z");
    await waitForPageOn(ZOOMED);
    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    expect(drawerLoader()).not.toBeNull();

    fireEvent.click(pageResetButton()!);
    await waitForPageOn(TimeRange.PAST_ONE_HOUR);
    await waitFor(() => {
      expect(pending).toHaveLength(2);
    });

    const [zoomed, reset] = pending as [PendingCorrelation, PendingCorrelation];
    expect(zoomed.window).toBe(ZOOMED);
    expect(reset.window).toBe(TimeRange.PAST_ONE_HOUR);
    return { zoomed, reset };
  }

  test("the zoomed window answering last does not replace the hour's correlation", async () => {
    const { zoomed, reset } = await zoomThenResetWhileBothAreOut();

    await act(async () => {
      reset.resolve(HOUR_ANSWER);
    });
    await waitFor(() => {
      expect(drawerCount(/^42 times in the past 1 hour/)).not.toBeNull();
    });

    await act(async () => {
      zoomed.resolve(ZOOMED_ANSWER);
    });

    expect(drawerCount(/^42 times in the past 1 hour/)).not.toBeNull();
    expect(drawerCount(/^8 times/)).toBeNull();
    expect(drawerLoader()).toBeNull();
  });

  test("the zoomed window answering first neither paints nor takes the loader down", async () => {
    const { zoomed, reset } = await zoomThenResetWhileBothAreOut();

    await act(async () => {
      zoomed.resolve(ZOOMED_ANSWER);
    });

    // Still waiting for the hour: no two-minute numbers under its heading.
    expect(drawerLoader()).not.toBeNull();
    expect(drawerCount(/^8 times/)).toBeNull();
    expect(screen.queryByTestId(ERROR_PATTERN_TIMELINE_TEST_ID)).toBeNull();

    await act(async () => {
      reset.resolve(HOUR_ANSWER);
    });

    await waitFor(() => {
      expect(drawerCount(/^42 times in the past 1 hour/)).not.toBeNull();
    });
    expect(drawerLoader()).toBeNull();
  });

  test("the zoomed window failing late does not put its error over the hour's correlation", async () => {
    const { zoomed, reset } = await zoomThenResetWhileBothAreOut();

    await act(async () => {
      reset.resolve(HOUR_ANSWER);
    });
    await waitFor(() => {
      expect(drawerCount(/^42 times in the past 1 hour/)).not.toBeNull();
    });

    await act(async () => {
      zoomed.reject(new Error("The correlation timed out"));
    });

    expect(drawerCount(/^42 times in the past 1 hour/)).not.toBeNull();
    expect(
      within(drawer()!).queryByText("The correlation timed out"),
    ).toBeNull();
  });

  test("the zoomed window failing first neither shows its error nor ends the wait", async () => {
    const { zoomed, reset } = await zoomThenResetWhileBothAreOut();

    await act(async () => {
      zoomed.reject(new Error("The correlation timed out"));
    });

    expect(drawerLoader()).not.toBeNull();
    expect(
      within(drawer()!).queryByText("The correlation timed out"),
    ).toBeNull();

    await act(async () => {
      reset.resolve(HOUR_ANSWER);
    });

    await waitFor(() => {
      expect(drawerCount(/^42 times in the past 1 hour/)).not.toBeNull();
    });
    expect(drawerLoader()).toBeNull();
  });

  test("the current window's own failure is still shown, with its retry", async () => {
    const { zoomed, reset } = await zoomThenResetWhileBothAreOut();

    await act(async () => {
      zoomed.resolve(ZOOMED_ANSWER);
    });
    await act(async () => {
      reset.reject(new Error("The correlation timed out"));
    });

    await waitFor(() => {
      expect(
        within(drawer()!).getByText("The correlation timed out"),
      ).toBeInTheDocument();
    });
    expect(drawerLoader()).toBeNull();
    expect(drawerCount(/^8 times/)).toBeNull();

    // The retry is the newest request, so its answer is the one shown.
    fireEvent.click(within(drawer()!).getByTestId("refresh-button"));
    await waitFor(() => {
      expect(pending).toHaveLength(3);
    });
    expect(pending[2]!.window).toBe(TimeRange.PAST_ONE_HOUR);
    expect(drawerLoader()).not.toBeNull();

    await act(async () => {
      pending[2]!.resolve(HOUR_ANSWER);
    });
    await waitFor(() => {
      expect(drawerCount(/^42 times in the past 1 hour/)).not.toBeNull();
    });
    expect(
      within(drawer()!).queryByText("The correlation timed out"),
    ).toBeNull();
  });
});

describe("the page without a chart zoom", () => {
  test("with the drawer closed, the page offers no zoom until a chart makes one", async () => {
    await renderPage();

    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
    expect(pickerLabel()).toBe("Past 1 Hour");
  });
});
