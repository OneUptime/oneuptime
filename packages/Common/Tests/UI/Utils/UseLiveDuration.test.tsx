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
import type { SpyInstance } from "jest-mock";
import React, { FunctionComponent, ReactElement } from "react";
import OneUptimeDate from "../../../Types/Date";
import useLiveDuration, {
  formatDurationInSeconds,
  getLiveDuration,
  LiveDuration,
  LiveDurationDate,
  parseLiveDurationDate,
  ZERO_DURATION_TEXT,
} from "../../../UI/Utils/UseLiveDuration";

/*
 * useLiveDuration: a timeline row's duration, start to end for a finished
 * row, start to NOW for the row still in effect - re-read every second, and
 * worded exactly like the finished rows.
 *
 * Read through a real component (mount, re-render, unmount) under jest's fake
 * clock, which moves Date and the timer queue together.
 */

/*
 * Half a second past a boundary, so "aligned to the second" is visible: the
 * first tick lands 500 ms after mount, and every one after it 1000 ms apart.
 */
const NOW: Date = new Date("2026-10-02T12:45:57.500Z");

// The whole second NOW is in.
const WHOLE_SECOND: Date = new Date("2026-10-02T12:45:57.000Z");

/*
 * A start a whole number of seconds before WHOLE_SECOND, so each tick moves
 * the count on by one (the start part-way through a second is its own test).
 */
const secondsAgo: (seconds: number) => Date = (seconds: number): Date => {
  return new Date(WHOLE_SECOND.getTime() - seconds * 1000);
};

interface ProbeProps {
  startDate: LiveDurationDate;
  endDate?: LiveDurationDate | undefined;
}

let renderCount: number = 0;

const DurationProbe: FunctionComponent<ProbeProps> = (
  props: ProbeProps,
): ReactElement => {
  renderCount++;

  const duration: LiveDuration = useLiveDuration({
    startDate: props.startDate,
    endDate: props.endDate,
  });

  return (
    <div>
      <span data-testid="text">{duration.formattedDuration}</span>
      <span data-testid="seconds">
        {duration.durationInSeconds === null
          ? "null"
          : String(duration.durationInSeconds)}
      </span>
      <span data-testid="live">{duration.isLive ? "live" : "still"}</span>
    </div>
  );
};

function text(): string {
  return screen.getByTestId("text").textContent || "";
}

function seconds(): string {
  return screen.getByTestId("seconds").textContent || "";
}

function liveness(): string {
  return screen.getByTestId("live").textContent || "";
}

function advance(milliseconds: number): void {
  act(() => {
    jest.advanceTimersByTime(milliseconds);
  });
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  renderCount = 0;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    configurable: true,
  });
});

describe("parseLiveDurationDate", () => {
  test("keeps a Date as it is", () => {
    const date: Date = new Date("2026-10-02T12:43:03.000Z");

    expect(parseLiveDurationDate(date)).toBe(date);
  });

  test("parses an ISO string, which is how a row can arrive from the API", () => {
    expect(
      parseLiveDurationDate("2026-10-02T12:43:03.000Z")?.toISOString(),
    ).toBe("2026-10-02T12:43:03.000Z");
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
  ])("treats %s as no date", (_label: string, value: LiveDurationDate) => {
    expect(parseLiveDurationDate(value)).toBeNull();
  });

  test("treats an invalid date as no date rather than NaN", () => {
    expect(parseLiveDurationDate(new Date("not a date"))).toBeNull();
  });
});

describe("formatDurationInSeconds", () => {
  test.each([
    [1, "1 sec"],
    [2, "2 secs"],
    [59, "59 secs"],
    [60, "1 min"],
    [61, "1 min 1 sec"],
    [174, "2 mins 54 secs"],
    [3600, "1 hour"],
    [3661, "1 hour 1 min 1 sec"],
    [2 * 86400 + 3 * 3600, "2 days 3 hours"],
  ])("words %i seconds as %s", (value: number, expected: string) => {
    expect(formatDurationInSeconds(value)).toBe(expected);
  });

  test("words every value exactly as the finished timeline rows always have", () => {
    for (const value of [1, 7, 59, 60, 174, 3599, 3601, 86399, 90061]) {
      expect(formatDurationInSeconds(value)).toBe(
        OneUptimeDate.secondsToFormattedFriendlyTimeString(value),
      );
    }
  });

  test("says 0 secs where the shared wording would leave the cell blank", () => {
    // The regression: a just-started row read as an empty cell.
    expect(OneUptimeDate.secondsToFormattedFriendlyTimeString(0)).toBe("");
    expect(formatDurationInSeconds(0)).toBe(ZERO_DURATION_TEXT);
    expect(ZERO_DURATION_TEXT).toBe("0 secs");
  });

  test.each([
    ["a negative count", -5],
    ["NaN", NaN],
    ["Infinity", Infinity],
  ])("says 0 secs for %s", (_label: string, value: number) => {
    expect(formatDurationInSeconds(value)).toBe(ZERO_DURATION_TEXT);
  });

  test("drops a part second rather than rounding it up", () => {
    expect(formatDurationInSeconds(174.9)).toBe("2 mins 54 secs");
  });
});

describe("getLiveDuration", () => {
  test("a finished row runs from its start to its end, whatever now is", () => {
    const startDate: Date = new Date("2026-10-02T12:40:00.000Z");
    const endDate: Date = new Date("2026-10-02T12:43:00.000Z");

    expect(
      getLiveDuration({
        startDate: startDate,
        endDate: endDate,
        now: new Date("2027-01-01T00:00:00.000Z"),
      }),
    ).toEqual({
      isLive: false,
      durationInSeconds: 180,
      formattedDuration: "3 mins",
    });
  });

  test("a finished row reads exactly as the timelines' old formula did", () => {
    const startDate: Date = new Date("2026-10-02T09:12:31.000Z");
    const endDate: Date = new Date("2026-10-04T11:43:03.000Z");

    expect(
      getLiveDuration({ startDate: startDate, endDate: endDate, now: NOW })
        .formattedDuration,
    ).toBe(
      OneUptimeDate.differenceBetweenTwoDatesAsFromattedString(
        startDate,
        endDate,
      ),
    );
  });

  test("a row with no end runs from its start to now, and is live", () => {
    expect(getLiveDuration({ startDate: secondsAgo(174), now: NOW })).toEqual({
      isLive: true,
      durationInSeconds: 174,
      formattedDuration: "2 mins 54 secs",
    });
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
  ])(
    "an end of %s means it has not ended",
    (_label: string, endDate: LiveDurationDate) => {
      expect(
        getLiveDuration({
          startDate: secondsAgo(10),
          endDate: endDate,
          now: NOW,
        }).isLive,
      ).toBe(true);
    },
  );

  test("accepts the dates as ISO strings", () => {
    expect(
      getLiveDuration({
        startDate: "2026-10-02T12:40:00.000Z",
        endDate: "2026-10-02T12:41:30.000Z",
        now: NOW,
      }).formattedDuration,
    ).toBe("1 min 30 secs");
  });

  test("without a start there is no duration at all", () => {
    expect(
      getLiveDuration({
        startDate: undefined,
        endDate: undefined,
        now: NOW,
      }),
    ).toEqual({
      isLive: false,
      durationInSeconds: null,
      formattedDuration: "",
    });
  });

  test("a start ahead of this browser's clock reads 0 secs, not a blank or a negative", () => {
    const duration: LiveDuration = getLiveDuration({
      startDate: new Date(NOW.getTime() + 4000),
      now: NOW,
    });

    expect(duration.durationInSeconds).toBe(0);
    expect(duration.formattedDuration).toBe("0 secs");
    expect(duration.isLive).toBe(true);
  });

  test("an end recorded before the start reads 0 secs", () => {
    expect(
      getLiveDuration({
        startDate: secondsAgo(10),
        endDate: secondsAgo(20),
        now: NOW,
      }),
    ).toEqual({
      isLive: false,
      durationInSeconds: 0,
      formattedDuration: "0 secs",
    });
  });

  test("a row that started and ended in the same second reads 0 secs", () => {
    expect(
      getLiveDuration({
        startDate: secondsAgo(10),
        endDate: secondsAgo(10),
        now: NOW,
      }).formattedDuration,
    ).toBe("0 secs");
  });
});

describe("useLiveDuration", () => {
  describe("a row still in effect", () => {
    test("shows how long it has lasted on the very first render", () => {
      render(<DurationProbe startDate={secondsAgo(174)} />);

      expect(text()).toBe("2 mins 54 secs");
      expect(seconds()).toBe("174");
      expect(liveness()).toBe("live");
    });

    test("counts up once a second without a reload", () => {
      render(<DurationProbe startDate={secondsAgo(174)} />);

      // The first tick lands on the next whole second.
      advance(500);
      expect(text()).toBe("2 mins 55 secs");

      advance(1000);
      expect(text()).toBe("2 mins 56 secs");

      advance(1000);
      expect(text()).toBe("2 mins 57 secs");
    });

    test("does not change between ticks", () => {
      render(<DurationProbe startDate={secondsAgo(174)} />);

      advance(499);

      expect(text()).toBe("2 mins 54 secs");
    });

    test("rolls over from seconds into minutes, worded like a finished row", () => {
      render(<DurationProbe startDate={secondsAgo(58)} />);

      expect(text()).toBe("58 secs");

      advance(500);
      expect(text()).toBe("59 secs");

      advance(1000);
      expect(text()).toBe("1 min");

      advance(1000);
      expect(text()).toBe("1 min 1 sec");
    });

    test("rolls over into hours", () => {
      render(<DurationProbe startDate={secondsAgo(3599)} />);

      expect(text()).toBe("59 mins 59 secs");

      advance(500);
      expect(text()).toBe("1 hour");
    });

    test("keeps counting for a long time without drifting", () => {
      render(<DurationProbe startDate={NOW} />);

      advance(500);
      for (let tick: number = 0; tick < 600; tick++) {
        advance(1000);
      }

      // 600.5 seconds after it started.
      expect(text()).toBe("10 mins");
      expect(seconds()).toBe("600");
    });

    test("a start part-way through a second still moves on by exactly one a tick", () => {
      // 173.8 seconds before NOW.
      render(
        <DurationProbe startDate={new Date("2026-10-02T12:43:03.700Z")} />,
      );

      expect(seconds()).toBe("173");

      advance(500);
      expect(seconds()).toBe("174");

      advance(1000);
      expect(seconds()).toBe("175");

      advance(1000);
      expect(seconds()).toBe("176");
    });

    test("starts at 0 secs, not a blank cell", () => {
      render(<DurationProbe startDate={NOW} />);

      expect(text()).toBe("0 secs");

      // Half a second in: still under one whole second.
      advance(500);
      expect(text()).toBe("0 secs");

      advance(1000);
      expect(text()).toBe("1 sec");
    });

    test("counts from a start given as an ISO string", () => {
      render(<DurationProbe startDate={secondsAgo(61).toISOString()} />);

      expect(text()).toBe("1 min 1 sec");

      advance(500);
      expect(text()).toBe("1 min 2 secs");
    });

    test("arms exactly one timer", () => {
      render(<DurationProbe startDate={secondsAgo(10)} />);

      expect(jest.getTimerCount()).toBe(1);
    });

    test("re-renders only itself, once a second", () => {
      render(<DurationProbe startDate={secondsAgo(10)} />);

      const rendersAfterMount: number = renderCount;

      advance(500);
      advance(1000);
      advance(1000);

      expect(renderCount - rendersAfterMount).toBe(3);
    });

    test("catches up at once when a throttled background tab comes back", () => {
      render(<DurationProbe startDate={secondsAgo(10)} />);

      // A hidden tab: the wall clock moves on, the throttled timer does not.
      act(() => {
        Object.defineProperty(document, "visibilityState", {
          value: "hidden",
          configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
        jest.setSystemTime(new Date(NOW.getTime() + 5 * 60 * 1000));
      });

      expect(text()).toBe("10 secs");

      act(() => {
        Object.defineProperty(document, "visibilityState", {
          value: "visible",
          configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });

      expect(text()).toBe("5 mins 10 secs");
    });
  });

  describe("a finished row", () => {
    test("shows start to end", () => {
      render(
        <DurationProbe startDate={secondsAgo(400)} endDate={secondsAgo(226)} />,
      );

      expect(text()).toBe("2 mins 54 secs");
      expect(liveness()).toBe("still");
    });

    test("arms no timer at all", () => {
      render(
        <DurationProbe startDate={secondsAgo(400)} endDate={secondsAgo(226)} />,
      );

      expect(jest.getTimerCount()).toBe(0);
    });

    test("never changes, however long the page stays open", () => {
      render(
        <DurationProbe startDate={secondsAgo(400)} endDate={secondsAgo(226)} />,
      );

      advance(60 * 60 * 1000);

      expect(text()).toBe("2 mins 54 secs");
    });

    test("is not re-rendered by a clock", () => {
      render(
        <DurationProbe startDate={secondsAgo(400)} endDate={secondsAgo(226)} />,
      );

      const rendersAfterMount: number = renderCount;

      advance(10 * 1000);

      expect(renderCount).toBe(rendersAfterMount);
    });
  });

  describe("a row with no start", () => {
    test("has no duration and arms no timer", () => {
      render(<DurationProbe startDate={undefined} />);

      expect(text()).toBe("");
      expect(seconds()).toBe("null");
      expect(liveness()).toBe("still");
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe("when the row's end arrives", () => {
    test("stops counting and shows start to end", () => {
      const startDate: Date = secondsAgo(174);

      const view: ReturnType<typeof render> = render(
        <DurationProbe startDate={startDate} />,
      );

      advance(500);
      advance(1000);
      expect(text()).toBe("2 mins 56 secs");

      // The next refresh of the table brings the row in with an end.
      view.rerender(
        <DurationProbe
          startDate={startDate}
          endDate={new Date(startDate.getTime() + 180 * 1000)}
        />,
      );

      expect(text()).toBe("3 mins");
      expect(liveness()).toBe("still");
      expect(jest.getTimerCount()).toBe(0);

      advance(10 * 1000);
      expect(text()).toBe("3 mins");
    });

    test("an end given as an ISO string stops it too", () => {
      const startDate: Date = secondsAgo(30);

      const view: ReturnType<typeof render> = render(
        <DurationProbe startDate={startDate} />,
      );

      view.rerender(
        <DurationProbe
          startDate={startDate}
          endDate={new Date(startDate.getTime() + 45 * 1000).toISOString()}
        />,
      );

      expect(text()).toBe("45 secs");
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe("when a finished row is reopened", () => {
    test("counts again from the real current time, from its first render", () => {
      const startDate: Date = secondsAgo(100);

      const view: ReturnType<typeof render> = render(
        <DurationProbe startDate={startDate} endDate={secondsAgo(40)} />,
      );

      expect(text()).toBe("1 min");

      // Ten minutes later, the end is taken away (the next state was deleted).
      act(() => {
        jest.setSystemTime(new Date(NOW.getTime() + 10 * 60 * 1000));
      });

      view.rerender(<DurationProbe startDate={startDate} />);

      expect(text()).toBe("11 mins 40 secs");
      expect(liveness()).toBe("live");
      expect(jest.getTimerCount()).toBe(1);

      advance(500);
      expect(text()).toBe("11 mins 41 secs");
    });
  });

  describe("cleanup", () => {
    test("unmounting a live duration leaves no timer behind", () => {
      const view: ReturnType<typeof render> = render(
        <DurationProbe startDate={secondsAgo(10)} />,
      );

      expect(jest.getTimerCount()).toBe(1);

      view.unmount();

      expect(jest.getTimerCount()).toBe(0);
    });

    test("unmounting a live duration stops listening for the tab coming back", () => {
      const removeSpy: SpyInstance<Document["removeEventListener"]> =
        jest.spyOn(document, "removeEventListener");

      const view: ReturnType<typeof render> = render(
        <DurationProbe startDate={secondsAgo(10)} />,
      );

      view.unmount();

      expect(removeSpy).toHaveBeenCalledWith(
        "visibilitychange",
        expect.any(Function),
      );

      removeSpy.mockRestore();
    });

    test("a table's worth of rows arms one timer per live row and none for the rest", () => {
      render(
        <div>
          <DurationProbe startDate={secondsAgo(10)} />
          <DurationProbe startDate={secondsAgo(90)} endDate={secondsAgo(10)} />
          <DurationProbe startDate={secondsAgo(200)} endDate={secondsAgo(90)} />
          <DurationProbe
            startDate={secondsAgo(500)}
            endDate={secondsAgo(200)}
          />
        </div>,
      );

      expect(jest.getTimerCount()).toBe(1);
    });
  });
});
