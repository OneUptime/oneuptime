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
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import StateTimelineEndsAt from "../../../../UI/Components/StateTimeline/StateTimelineEndsAt";
import { PillSize } from "../../../../UI/Components/Pill/Pill";
import OneUptimeDate from "../../../../Types/Date";

/*
 * A timeline row's Ends At cell: when it ended, exactly as the table writes a
 * DateTime column - or, for the row that has not ended, the pulsing
 * "Currently Active" marker in place of the grey words it used to be.
 */

const END: Date = new Date("2026-10-02T12:43:07.000Z");

beforeEach(() => {
  jest.useFakeTimers({ now: new Date("2026-10-02T12:45:57.500Z") });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("StateTimelineEndsAt", () => {
  describe("a finished row", () => {
    test("shows the end as the table shows every other date and time", () => {
      render(<StateTimelineEndsAt endDate={END} />);

      expect(screen.getByTestId("state-timeline-ends-at")).toHaveTextContent(
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(END, false),
      );
    });

    test("is a <time> carrying the exact instant", () => {
      render(<StateTimelineEndsAt endDate={END} />);

      const time: HTMLElement = screen.getByTestId("state-timeline-ends-at");

      expect(time.tagName).toBe("TIME");
      expect(time).toHaveAttribute("dateTime", "2026-10-02T12:43:07.000Z");
    });

    test("accepts the end as an ISO string", () => {
      render(<StateTimelineEndsAt endDate="2026-10-02T12:43:07.000Z" />);

      expect(screen.getByTestId("state-timeline-ends-at")).toHaveTextContent(
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(END, false),
      );
    });

    test("is not marked active", () => {
      render(<StateTimelineEndsAt endDate={END} />);

      expect(screen.queryByTestId("currently-active-indicator")).toBeNull();
      expect(screen.queryByText("Currently Active")).toBeNull();
    });
  });

  describe("the row that has not ended", () => {
    test.each([
      ["undefined", undefined],
      ["null", null],
    ])(
      "an end of %s shows the Currently Active marker",
      (_label: string, endDate: Date | null | undefined) => {
        render(<StateTimelineEndsAt endDate={endDate} />);

        const indicator: HTMLElement = screen.getByTestId(
          "currently-active-indicator",
        );

        expect(indicator).toHaveTextContent(/^Currently Active$/);
        expect(screen.queryByTestId("state-timeline-ends-at")).toBeNull();
      },
    );

    test("the marker pulses, but only where motion is welcome", () => {
      render(<StateTimelineEndsAt endDate={undefined} />);

      expect(screen.getByTestId("pill-dot-pulse")).toHaveClass(
        "motion-safe:animate-ping",
      );
    });

    test("the marker is sized to match the status pill when asked", () => {
      render(
        <StateTimelineEndsAt
          endDate={undefined}
          indicatorSize={PillSize.Small}
        />,
      );

      expect(
        within(screen.getByTestId("currently-active-indicator")).getByTestId(
          "pill",
        ),
      ).toHaveStyle({ fontSize: PillSize.Small });
    });

    test("costs no timer: only the duration beside it ticks", () => {
      render(<StateTimelineEndsAt endDate={undefined} />);

      expect(jest.getTimerCount()).toBe(0);
    });
  });

  test("the marker gives way to the end date once the row ends", () => {
    const view: ReturnType<typeof render> = render(
      <StateTimelineEndsAt endDate={undefined} />,
    );

    expect(screen.getByTestId("currently-active-indicator")).toBeVisible();

    view.rerender(<StateTimelineEndsAt endDate={END} />);

    expect(screen.queryByTestId("currently-active-indicator")).toBeNull();
    expect(screen.getByTestId("state-timeline-ends-at")).toHaveAttribute(
      "dateTime",
      END.toISOString(),
    );
  });
});
