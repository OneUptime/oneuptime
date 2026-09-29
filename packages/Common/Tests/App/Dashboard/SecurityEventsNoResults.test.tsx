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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import SecurityEventsNoResults, {
  SECURITY_EVENTS_NO_RESULTS_ID,
  getShowTimeRangeButtonTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsNoResults";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * An empty Security Events table in a project that DOES have events. The
 * setup empty state (SecurityEventsEmptyState) is for a project that has
 * never received one; this says why the table is empty instead, and offers
 * the time range that would bring the newest event back.
 */

const NOW: Date = new Date("2026-09-18T12:00:00.000Z");
const DAY_MS: number = 24 * 60 * 60 * 1000;
const WINDOW_START: Date = new Date(NOW.getTime() - DAY_MS);

function root(): HTMLElement {
  return document.getElementById(SECURITY_EVENTS_NO_RESULTS_ID) as HTMLElement;
}

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("SecurityEventsNoResults", () => {
  test("with nothing known about older events, says only what is certain", () => {
    render(<SecurityEventsNoResults windowStartDate={WINDOW_START} />);

    expect(
      screen.getByRole("heading", {
        name: "No security events in this time range",
      }),
    ).toBeInTheDocument();
    expect(root()).toHaveTextContent(
      "Try a wider time range, or clear the filters applied to the table.",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("never sends someone who is already ingesting to the setup guide", () => {
    render(
      <SecurityEventsNoResults
        windowStartDate={WINDOW_START}
        latestEventTime={new Date(NOW.getTime() - 3 * DAY_MS)}
        onShowTimeRange={getJestMockFunction()}
      />,
    );

    expect(screen.queryByText("Read the setup guide")).toBeNull();
    expect(screen.queryByText("Connect a security product")).toBeNull();
    expect(screen.queryByText("No security events yet")).toBeNull();
  });

  test("when the newest event is older than the window, says when it arrived", () => {
    const latest: Date = new Date(NOW.getTime() - 3 * DAY_MS);

    render(
      <SecurityEventsNoResults
        windowStartDate={WINDOW_START}
        latestEventTime={latest}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "No security events in this time range",
      }),
    ).toBeInTheDocument();
    expect(root()).toHaveTextContent("The most recent security event arrived");
    expect(root()).toHaveTextContent(
      OneUptimeDate.getDateAsLocalFormattedString(latest),
    );
  });

  test("offers the narrowest range that reaches the newest event", () => {
    const onShowTimeRange: MockFunction = getJestMockFunction();

    render(
      <SecurityEventsNoResults
        windowStartDate={WINDOW_START}
        latestEventTime={new Date(NOW.getTime() - 3 * DAY_MS)}
        onShowTimeRange={onShowTimeRange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show past 1 week" }));

    expect(onShowTimeRange).toHaveBeenCalledTimes(1);
    expect(onShowTimeRange).toHaveBeenCalledWith({
      range: TimeRange.PAST_ONE_WEEK,
    });
  });

  test("for an event older than every preset, offers the window from just before it", () => {
    const onShowTimeRange: MockFunction = getJestMockFunction();
    const latest: Date = new Date(NOW.getTime() - 200 * DAY_MS);

    render(
      <SecurityEventsNoResults
        windowStartDate={WINDOW_START}
        latestEventTime={latest}
        onShowTimeRange={onShowTimeRange}
      />,
    );

    fireEvent.click(
      screen.getByTestId(`${SECURITY_EVENTS_NO_RESULTS_ID}-show-range`),
    );

    const picked: RangeStartAndEndDateTime = onShowTimeRange.mock
      .calls[0]![0] as RangeStartAndEndDateTime;
    expect(picked.range).toBe(TimeRange.CUSTOM);
    expect(new Date(picked.startAndEndDate!.startValue).getTime()).toBe(
      latest.getTime() - DAY_MS,
    );
    expect(new Date(picked.startAndEndDate!.endValue).getTime()).toBe(
      NOW.getTime(),
    );
  });

  test("without a way to change the range, offers no button", () => {
    render(
      <SecurityEventsNoResults
        windowStartDate={WINDOW_START}
        latestEventTime={new Date(NOW.getTime() - 3 * DAY_MS)}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
  });

  test("when the newest event is inside the window, blames the filters instead", () => {
    render(
      <SecurityEventsNoResults
        windowStartDate={WINDOW_START}
        latestEventTime={new Date(NOW.getTime() - 60 * 1000)}
        onShowTimeRange={getJestMockFunction()}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "No security events match these filters",
      }),
    ).toBeInTheDocument();
    expect(root()).toHaveTextContent(
      "Events have arrived in this time range, but none of them match the filters applied to the table.",
    );
    // Widening the window cannot help when the filters are what emptied it.
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("an event exactly at the window's start counts as inside it", () => {
    render(
      <SecurityEventsNoResults
        windowStartDate={WINDOW_START}
        latestEventTime={WINDOW_START}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "No security events match these filters",
      }),
    ).toBeInTheDocument();
  });

  test("uses the compact table padding, like the setup empty state", () => {
    render(<SecurityEventsNoResults windowStartDate={WINDOW_START} />);

    expect(root()).toHaveClass("py-4");
    // A side gutter on a phone, where the list card is flush otherwise.
    expect(root()).toHaveClass("px-4", "md:px-0");
    expect(root()).not.toHaveClass("pt-52");
  });
});

describe("getShowTimeRangeButtonTitle", () => {
  test.each([
    [TimeRange.PAST_ONE_HOUR, "Show past 1 hour"],
    [TimeRange.PAST_ONE_DAY, "Show past 1 day"],
    [TimeRange.PAST_ONE_WEEK, "Show past 1 week"],
    [TimeRange.PAST_ONE_MONTH, "Show past 1 month"],
    [TimeRange.PAST_THREE_MONTHS, "Show past 3 months"],
  ])("names %s", (range: TimeRange, title: string) => {
    expect(getShowTimeRangeButtonTitle({ range: range })).toBe(title);
  });

  test("names a custom window by the date it starts from", () => {
    const start: Date = new Date("2026-02-01T00:00:00.000Z");

    expect(
      getShowTimeRangeButtonTitle({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(start, NOW),
      }),
    ).toBe(
      `Show events since ${OneUptimeDate.getDateAsLocalFormattedString(start, true)}`,
    );
  });
});
