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
  renderHook,
  screen,
  RenderHookResult,
  waitFor,
  within,
} from "@testing-library/react";
import { Mock } from "jest-mock";
import React from "react";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import IconProp from "../../../Types/Icon/IconProp";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import { TABLE_EMPTY_STATE_TEST_ID } from "../../../UI/Components/Table/TableEmptyState";
import TelemetryFirstStepsEmptyState, {
  TELEMETRY_FIRST_STEPS_GUTTER_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryFirstStepsEmptyState";
import {
  offersPastWeek,
  PAST_WEEK_RANGE,
  showsTelemetryFirstSteps,
  TELEMETRY_FIRST_STEPS_COPY,
  TelemetryFirstStepsSignal,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryFirstSteps";
import useProjectHasExceptions from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/useProjectHasExceptions";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { goTo, PROJECT_ID, routeFor } from "./SideMenuHarness";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

/*
 * The empty Logs, Traces, Metrics and Exceptions explorer of a project that
 * may not be sending that signal yet. It used to say "No logs found. Time
 * range: past 1 hour. Try adjusting filters or expanding the time range." to
 * a project with no filters and nothing sent, and offered no way to the
 * Setup Guide that would fill it.
 */

const HOUR: RangeStartAndEndDateTime = { range: TimeRange.PAST_ONE_HOUR };

function customWindow(hours: number): RangeStartAndEndDateTime {
  const end: Date = new Date("2026-10-18T12:00:00.000Z");
  const start: Date = new Date(end.getTime() - hours * 60 * 60 * 1000);

  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(start, end),
  };
}

let navigateSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/logs`);
  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {
      // Stay on the page.
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the first steps of an empty explorer", () => {
  const cases: Array<{
    signal: TelemetryFirstStepsSignal;
    title: string;
    description: string;
    setup: string;
    setupPage: string;
    icon: IconProp;
  }> = [
    {
      signal: TelemetryFirstStepsSignal.Logs,
      title: "No logs here yet",
      description: "Logs appear here as soon as your apps send them.",
      setup: "Set up logs",
      setupPage: PageMap.LOGS_DOCUMENTATION,
      icon: IconProp.Logs,
    },
    {
      signal: TelemetryFirstStepsSignal.Traces,
      title: "No traces here yet",
      description: "Traces appear here as soon as your apps send them.",
      setup: "Set up tracing",
      setupPage: PageMap.TRACES_DOCUMENTATION,
      icon: IconProp.Waterfall,
    },
    {
      signal: TelemetryFirstStepsSignal.Metrics,
      title: "No metrics here yet",
      description:
        "Metrics appear here as soon as your apps or hosts send them.",
      setup: "Set up metrics",
      setupPage: PageMap.METRICS_DOCUMENTATION,
      icon: IconProp.Heartbeat,
    },
    {
      signal: TelemetryFirstStepsSignal.Exceptions,
      title: "No exceptions here yet",
      description: "Exceptions appear here as soon as your apps report them.",
      setup: "Set up exception tracking",
      setupPage: PageMap.EXCEPTIONS_DOCUMENTATION,
      icon: IconProp.Bug,
    },
    {
      signal: TelemetryFirstStepsSignal.Profiles,
      title: "No profiles here yet",
      description:
        "Profiles show where your code spends its time and memory. They appear here as soon as your apps or hosts send them.",
      setup: "Set up profiling",
      setupPage: PageMap.PROFILES_DOCUMENTATION,
      icon: IconProp.Fire,
    },
  ];

  test.each(cases)(
    "$signal: says what appears here, and opens the product's setup guide",
    (testCase: (typeof cases)[number]) => {
      render(
        <TelemetryFirstStepsEmptyState
          signal={testCase.signal}
          timeRange={HOUR}
          onTimeRangeChange={jest.fn()}
        />,
      );

      const state: HTMLElement = screen.getByTestId(
        TELEMETRY_FIRST_STEPS_COPY[testCase.signal].dataTestId,
      );

      expect(within(state).getByText(testCase.title)).toBeInTheDocument();
      expect(within(state).getByText(testCase.description)).toBeInTheDocument();
      expect(TELEMETRY_FIRST_STEPS_COPY[testCase.signal].icon).toBe(
        testCase.icon,
      );

      // Nothing about filters nobody set.
      expect(state.textContent).not.toMatch(/filter/i);

      fireEvent.click(
        within(state).getByRole("button", { name: testCase.setup }),
      );

      expect(navigateSpy).toHaveBeenCalledTimes(1);
      expect(String(navigateSpy.mock.calls[0]![0])).toBe(
        routeFor(testCase.setupPage),
      );
    },
  );

  test("is drawn like every other empty list", () => {
    render(
      <TelemetryFirstStepsEmptyState
        signal={TelemetryFirstStepsSignal.Logs}
        timeRange={HOUR}
        onTimeRangeChange={jest.fn()}
      />,
    );

    const state: HTMLElement = screen.getByTestId("logs-first-steps");

    // TableEmptyState, the empty list of every table, with the caller's id.
    expect(state).toHaveAttribute("data-empty-state-kind", "empty");
    expect(screen.queryByTestId(TABLE_EMPTY_STATE_TEST_ID)).toBeNull();
    expect(
      within(state).getByRole("heading", { name: "No logs here yet" }),
    ).toBeInTheDocument();
    // The product's own icon on the illustration.
    expect(
      within(state)
        .getByTestId("logs-first-steps-illustration")
        .querySelector(`[data-icon="${IconProp.Logs}"]`),
    ).not.toBeNull();
  });

  test.each(Object.values(TelemetryFirstStepsSignal))(
    "%s: keeps side room on a phone, where the empty state has none of its own",
    (signal: TelemetryFirstStepsSignal) => {
      /*
       * The explorers' list box has no padding, and TableEmptyState pads
       * itself from sm up only: on a phone the sentence and the full-width
       * Set up button ran from border to border.
       */
      render(
        <TelemetryFirstStepsEmptyState
          signal={signal}
          timeRange={HOUR}
          onTimeRangeChange={jest.fn()}
        />,
      );

      const testId: string = TELEMETRY_FIRST_STEPS_COPY[signal].dataTestId;
      const gutter: HTMLElement = screen.getByTestId(`${testId}-gutter`);

      expect(TELEMETRY_FIRST_STEPS_GUTTER_CLASS_NAME).toBe("px-4 sm:px-0");
      expect(gutter).toHaveClass("px-4", "sm:px-0");
      expect(within(gutter).getByTestId(testId)).toBeInTheDocument();
      // From sm up the empty state's own padding is the only one.
      expect(screen.getByTestId(testId)).toHaveClass("sm:px-6");
    },
  );

  test("offers the past week while the explorer shows less, and switches to it", () => {
    const onTimeRangeChange: Mock<(range: RangeStartAndEndDateTime) => void> =
      jest.fn<(range: RangeStartAndEndDateTime) => void>();

    render(
      <TelemetryFirstStepsEmptyState
        signal={TelemetryFirstStepsSignal.Traces}
        timeRange={HOUR}
        onTimeRangeChange={onTimeRangeChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show the past week" }));

    expect(onTimeRangeChange).toHaveBeenCalledWith(PAST_WEEK_RANGE);
    expect(PAST_WEEK_RANGE).toEqual({ range: TimeRange.PAST_ONE_WEEK });
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test.each([
    TimeRange.PAST_ONE_WEEK,
    TimeRange.PAST_TWO_WEEKS,
    TimeRange.PAST_ONE_MONTH,
    TimeRange.PAST_THREE_MONTHS,
  ])(
    "does not offer the past week over %s, which already covers it",
    (range: TimeRange) => {
      render(
        <TelemetryFirstStepsEmptyState
          signal={TelemetryFirstStepsSignal.Metrics}
          timeRange={{ range: range }}
          onTimeRangeChange={jest.fn()}
        />,
      );

      expect(
        screen.queryByRole("button", { name: "Show the past week" }),
      ).toBeNull();
      expect(
        screen.getByRole("button", { name: "Set up metrics" }),
      ).toBeInTheDocument();
    },
  );

  test("offers no longer range where one cannot help: Exceptions", () => {
    render(
      <TelemetryFirstStepsEmptyState
        signal={TelemetryFirstStepsSignal.Exceptions}
        timeRange={HOUR}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Show the past week" }),
    ).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  test("offers no longer range without a window: the Profiler's Overview", () => {
    // A range handler alone is not enough: there is no window to widen.
    render(
      <TelemetryFirstStepsEmptyState
        signal={TelemetryFirstStepsSignal.Profiles}
        onTimeRangeChange={jest.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Show the past week" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Set up profiling" }),
    ).toBeInTheDocument();
  });
});

describe("offersPastWeek", () => {
  test.each([
    TimeRange.PAST_FIVE_MINS,
    TimeRange.PAST_FIFTEEN_MINS,
    TimeRange.PAST_THIRTY_MINS,
    TimeRange.PAST_ONE_HOUR,
    TimeRange.PAST_TWO_HOURS,
    TimeRange.PAST_THREE_HOURS,
    TimeRange.PAST_ONE_DAY,
    TimeRange.PAST_TWO_DAYS,
  ])("offers it over %s", (range: TimeRange) => {
    expect(offersPastWeek({ range: range })).toBe(true);
  });

  test("measures a custom window: shorter than a week offers it", () => {
    expect(offersPastWeek(customWindow(2))).toBe(true);
    expect(offersPastWeek(customWindow(6 * 24))).toBe(true);
  });

  test("measures a custom window: a week or more does not", () => {
    expect(offersPastWeek(customWindow(7 * 24))).toBe(false);
    expect(offersPastWeek(customWindow(30 * 24))).toBe(false);
  });
});

describe("showsTelemetryFirstSteps", () => {
  const unnarrowed: {
    hasFirstSteps: boolean;
    isEmpty: boolean;
    filterCount: number;
    searchText: string;
  } = { hasFirstSteps: true, isEmpty: true, filterCount: 0, searchText: "" };

  test("an empty list nothing narrows, on a product page", () => {
    expect(showsTelemetryFirstSteps(unnarrowed)).toBe(true);
    expect(showsTelemetryFirstSteps({ ...unnarrowed, searchText: "  " })).toBe(
      true,
    );
  });

  test("never on an embed, which keeps its own message", () => {
    expect(
      showsTelemetryFirstSteps({ ...unnarrowed, hasFirstSteps: false }),
    ).toBe(false);
  });

  test("never over rows", () => {
    expect(showsTelemetryFirstSteps({ ...unnarrowed, isEmpty: false })).toBe(
      false,
    );
  });

  test("never when a filter or a search emptied the list: that one says try other filters", () => {
    expect(showsTelemetryFirstSteps({ ...unnarrowed, filterCount: 1 })).toBe(
      false,
    );
    expect(
      showsTelemetryFirstSteps({ ...unnarrowed, searchText: "status:error" }),
    ).toBe(false);
  });
});

describe("useProjectHasExceptions", () => {
  let countSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    countSpy = jest.spyOn(ModelAPI, "count");
  });

  test("asks nothing until the list is empty and unnarrowed", async () => {
    countSpy.mockResolvedValue(0 as never);

    const hook: RenderHookResult<boolean | null, { shouldAsk: boolean }> =
      renderHook<boolean | null, { shouldAsk: boolean }>(
        (props: { shouldAsk: boolean }) => {
          return useProjectHasExceptions(props.shouldAsk);
        },
        { initialProps: { shouldAsk: false } },
      );

    await act(async () => {
      await Promise.resolve();
    });

    expect(countSpy).not.toHaveBeenCalled();
    expect(hook.result.current).toBeNull();
  });

  test("a project without a single exception: false, from one count over every state", async () => {
    countSpy.mockResolvedValue(0 as never);

    const hook: ReturnType<typeof renderHook> = renderHook(() => {
      return useProjectHasExceptions(true);
    });

    await waitFor(() => {
      expect(hook.result.current).toBe(false);
    });

    expect(countSpy).toHaveBeenCalledTimes(1);
    // No status, time or class filter: any exception the project ever had.
    expect(
      (countSpy.mock.calls[0]![0] as { query: Record<string, unknown> }).query,
    ).toEqual({});
  });

  test("a project with exceptions: true", async () => {
    countSpy.mockResolvedValue(3 as never);

    const hook: ReturnType<typeof renderHook> = renderHook(() => {
      return useProjectHasExceptions(true);
    });

    await waitFor(() => {
      expect(hook.result.current).toBe(true);
    });
  });

  test("a count that fails reads as 'has some', so nobody is sent to a setup guide by an error", async () => {
    countSpy.mockRejectedValue(new Error("network") as never);

    const hook: ReturnType<typeof renderHook> = renderHook(() => {
      return useProjectHasExceptions(true);
    });

    await waitFor(() => {
      expect(hook.result.current).toBe(true);
    });
  });

  test("asks once, however often the list empties again", async () => {
    countSpy.mockResolvedValue(0 as never);

    const hook: RenderHookResult<boolean | null, { shouldAsk: boolean }> =
      renderHook<boolean | null, { shouldAsk: boolean }>(
        (props: { shouldAsk: boolean }) => {
          return useProjectHasExceptions(props.shouldAsk);
        },
        { initialProps: { shouldAsk: true } },
      );

    await waitFor(() => {
      expect(hook.result.current).toBe(false);
    });

    hook.rerender({ shouldAsk: false });
    hook.rerender({ shouldAsk: true });

    await act(async () => {
      await Promise.resolve();
    });

    expect(countSpy).toHaveBeenCalledTimes(1);
  });
});
