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
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import StateTimelineDuration from "../../../../UI/Components/StateTimeline/StateTimelineDuration";
import OneUptimeDate from "../../../../Types/Date";

/*
 * A timeline row's Duration cell. The row still in effect counts up every
 * second as a `timer` (whose live region stays off, so a screen reader is not
 * read every tick); a finished row is plain, still text worded the same way.
 */

const NOW: Date = new Date("2026-10-02T12:45:57.500Z");
const WHOLE_SECOND: Date = new Date("2026-10-02T12:45:57.000Z");

const secondsAgo: (seconds: number) => Date = (seconds: number): Date => {
  return new Date(WHOLE_SECOND.getTime() - seconds * 1000);
};

function getDuration(): HTMLElement {
  return screen.getByTestId("state-timeline-duration");
}

function advance(milliseconds: number): void {
  act(() => {
    jest.advanceTimersByTime(milliseconds);
  });
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("StateTimelineDuration", () => {
  describe("the row still in effect", () => {
    test("shows how long it has lasted so far", () => {
      render(<StateTimelineDuration startDate={secondsAgo(174)} />);

      expect(getDuration()).toHaveTextContent(/^2 mins 54 secs$/);
    });

    test("counts up every second, with no reload", () => {
      render(<StateTimelineDuration startDate={secondsAgo(174)} />);

      advance(500);
      expect(getDuration()).toHaveTextContent(/^2 mins 55 secs$/);

      advance(1000);
      expect(getDuration()).toHaveTextContent(/^2 mins 56 secs$/);

      advance(5000);
      expect(getDuration()).toHaveTextContent(/^3 mins 1 sec$/);
    });

    test("is worded exactly like a finished row of the same length", () => {
      const startDate: Date = secondsAgo(3725);

      render(<StateTimelineDuration startDate={startDate} />);

      expect(getDuration()).toHaveTextContent(
        OneUptimeDate.differenceBetweenTwoDatesAsFromattedString(
          startDate,
          WHOLE_SECOND,
        ),
      );
    });

    test("is a timer, the ARIA role for a count of elapsed time", () => {
      render(<StateTimelineDuration startDate={secondsAgo(174)} />);

      expect(screen.getByRole("timer")).toBe(getDuration());
    });

    test("is not announced every second", () => {
      render(<StateTimelineDuration startDate={secondsAgo(174)} />);

      expect(getDuration()).toHaveAttribute("aria-live", "off");
    });

    test("carries the duration machine-readably, and keeps it current", () => {
      render(<StateTimelineDuration startDate={secondsAgo(174)} />);

      expect(getDuration().tagName).toBe("TIME");
      expect(getDuration()).toHaveAttribute("dateTime", "PT174S");

      advance(500);

      expect(getDuration()).toHaveAttribute("dateTime", "PT175S");
    });

    test("stands out from the finished rows, with digits that do not shuffle", () => {
      render(<StateTimelineDuration startDate={secondsAgo(174)} />);

      expect(getDuration()).toHaveClass("tabular-nums", "text-gray-900");
      expect(getDuration()).toHaveAttribute("data-live", "true");
    });

    test("reads 0 secs in its first second rather than an empty cell", () => {
      render(<StateTimelineDuration startDate={NOW} />);

      expect(getDuration()).toHaveTextContent(/^0 secs$/);
    });

    test("accepts its start as an ISO string", () => {
      render(
        <StateTimelineDuration startDate={secondsAgo(61).toISOString()} />,
      );

      expect(getDuration()).toHaveTextContent(/^1 min 1 sec$/);
    });

    test("an end of null still counts", () => {
      render(
        <StateTimelineDuration startDate={secondsAgo(61)} endDate={null} />,
      );

      advance(500);

      expect(getDuration()).toHaveTextContent(/^1 min 2 secs$/);
    });
  });

  describe("a finished row", () => {
    test("shows start to end", () => {
      render(
        <StateTimelineDuration
          startDate={secondsAgo(400)}
          endDate={secondsAgo(226)}
        />,
      );

      expect(getDuration()).toHaveTextContent(/^2 mins 54 secs$/);
    });

    test("is still: no timer role, no live region, nothing ticking", () => {
      render(
        <StateTimelineDuration
          startDate={secondsAgo(400)}
          endDate={secondsAgo(226)}
        />,
      );

      expect(screen.queryByRole("timer")).toBeNull();
      expect(getDuration()).not.toHaveAttribute("aria-live");
      expect(getDuration()).toHaveAttribute("data-live", "false");
      expect(getDuration()).not.toHaveClass("tabular-nums");
      expect(jest.getTimerCount()).toBe(0);

      advance(60 * 1000);
      expect(getDuration()).toHaveTextContent(/^2 mins 54 secs$/);
    });

    test("still carries its duration machine-readably", () => {
      render(
        <StateTimelineDuration
          startDate={secondsAgo(400)}
          endDate={secondsAgo(226)}
        />,
      );

      expect(getDuration()).toHaveAttribute("dateTime", "PT174S");
    });

    test("that lasted no time at all reads 0 secs", () => {
      render(
        <StateTimelineDuration
          startDate={secondsAgo(10)}
          endDate={secondsAgo(10)}
        />,
      );

      expect(getDuration()).toHaveTextContent(/^0 secs$/);
    });
  });

  test("a row with no start shows a placeholder and arms nothing", () => {
    render(<StateTimelineDuration startDate={undefined} />);

    expect(getDuration()).toHaveTextContent(/^-$/);
    expect(getDuration()).toHaveClass("text-gray-400");
    expect(screen.queryByRole("timer")).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  test("stops counting the moment the row's end arrives", () => {
    const startDate: Date = secondsAgo(174);

    const view: ReturnType<typeof render> = render(
      <StateTimelineDuration startDate={startDate} />,
    );

    advance(500);
    expect(getDuration()).toHaveTextContent(/^2 mins 55 secs$/);

    view.rerender(
      <StateTimelineDuration
        startDate={startDate}
        endDate={new Date(startDate.getTime() + 175 * 1000)}
      />,
    );

    expect(getDuration()).toHaveTextContent(/^2 mins 55 secs$/);
    expect(screen.queryByRole("timer")).toBeNull();
    expect(jest.getTimerCount()).toBe(0);

    advance(10 * 1000);
    expect(getDuration()).toHaveTextContent(/^2 mins 55 secs$/);
  });

  test("leaves no timer behind once it is gone", () => {
    const view: ReturnType<typeof render> = render(
      <StateTimelineDuration startDate={secondsAgo(174)} />,
    );

    expect(jest.getTimerCount()).toBe(1);

    view.unmount();

    expect(jest.getTimerCount()).toBe(0);
  });
});
