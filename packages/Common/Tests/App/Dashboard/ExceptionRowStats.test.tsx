import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import * as React from "react";
import ExceptionRow from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionRow";
import ExceptionTrendSparkline, {
  ExceptionTrendBar,
  SPARKLINE_HEIGHT,
  SPARKLINE_WIDTH,
  getExceptionTrendBars,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionTrendSparkline";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import {
  EXCEPTION_TREND_BUCKET_COUNT,
  ExceptionListStatsItem,
  emptyExceptionTrend,
} from "../../../Types/Telemetry/ExceptionListStats";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * Each row of the exceptions list, with its numbers over the list's range:
 * how many users it affected - only when an occurrence named one - and a
 * small trend chart of its occurrences, from sm up. While the page's numbers
 * are read, the chart's place is held; without them, the row is as before.
 */

const EXCEPTION_ID: string = "50000000-0000-4000-8000-000000000042";

function exceptionWith(
  values: Partial<TelemetryException> = {},
): TelemetryException {
  const exception: TelemetryException = new TelemetryException();
  exception._id = EXCEPTION_ID;
  exception.exceptionType = "TypeError";
  exception.message = "Cannot read properties of undefined (reading 'id')";
  exception.occuranceCount = 12;
  exception.firstSeenAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  exception.lastSeenAt = new Date(Date.now() - 60 * 1000);
  Object.assign(exception, values);
  return exception;
}

function statsWith(
  values: Partial<ExceptionListStatsItem> = {},
): ExceptionListStatsItem {
  const trend: Array<number> = emptyExceptionTrend();
  trend[3] = 4;
  trend[20] = 8;
  return {
    telemetryExceptionId: EXCEPTION_ID,
    affectedUsers: 3,
    trend,
    ...values,
  };
}

afterEach(() => {
  cleanup();
});

describe("the row's affected users", () => {
  test("say how many users, beside the events", () => {
    render(<ExceptionRow exception={exceptionWith()} stats={statsWith()} />);

    const users: HTMLElement = screen.getByTestId("exception-row-users");
    expect(users).toHaveTextContent("3 users");
    expect(users).toHaveAttribute(
      "title",
      "Distinct users this exception happened to in this time range",
    );
    // On the metadata line, after the events.
    expect(users.parentElement).toHaveTextContent(/12 events.*3 users/);
  });

  test("one user reads in the singular", () => {
    render(
      <ExceptionRow
        exception={exceptionWith()}
        stats={statsWith({ affectedUsers: 1 })}
      />,
    );

    expect(screen.getByTestId("exception-row-users")).toHaveTextContent(
      /^1 user$/,
    );
  });

  test("a large count is written the reader's way", () => {
    render(
      <ExceptionRow
        exception={exceptionWith()}
        stats={statsWith({ affectedUsers: 12345 })}
      />,
    );

    expect(screen.getByTestId("exception-row-users")).toHaveTextContent(
      "12,345 users",
    );
  });

  test("none named, or not counted: nothing, never '0 users'", () => {
    const { rerender } = render(
      <ExceptionRow
        exception={exceptionWith()}
        stats={statsWith({ affectedUsers: 0 })}
      />,
    );

    expect(screen.queryByTestId("exception-row-users")).toBeNull();

    rerender(
      <ExceptionRow
        exception={exceptionWith()}
        stats={statsWith({ affectedUsers: null })}
      />,
    );

    expect(screen.queryByTestId("exception-row-users")).toBeNull();
    expect(screen.queryByText(/0 users/)).toBeNull();
  });
});

describe("the row's trend chart", () => {
  test("one bar per slice of the range, labelled with the range's total", () => {
    render(<ExceptionRow exception={exceptionWith()} stats={statsWith()} />);

    const chart: HTMLElement = screen.getByTestId("exception-row-trend");
    expect(chart).toHaveAttribute("role", "img");
    expect(chart).toHaveAttribute("aria-label", "12 events in this time range");
    expect(chart.querySelectorAll("rect")).toHaveLength(
      EXCEPTION_TREND_BUCKET_COUNT,
    );
    expect(chart.querySelector("title")).toHaveTextContent(
      "12 events in this time range",
    );
  });

  test("is part of the row's button, so a click on it opens the exception", () => {
    render(<ExceptionRow exception={exceptionWith()} stats={statsWith()} />);

    expect(
      within(screen.getByRole("button")).getByTestId("exception-row-trend"),
    ).toBeInTheDocument();
  });

  test("is hidden on a phone: the row's words need the width", () => {
    render(<ExceptionRow exception={exceptionWith()} stats={statsWith()} />);

    expect(
      screen.getByTestId("exception-row-trend").parentElement!.className,
    ).toContain("max-sm:hidden");
  });

  test("red while open, grey once resolved or archived", () => {
    const { rerender } = render(
      <ExceptionRow exception={exceptionWith()} stats={statsWith()} />,
    );

    expect(
      screen.getByTestId("exception-row-trend").getAttribute("class"),
    ).toContain("text-red-400");

    for (const values of [{ isResolved: true }, { isArchived: true }]) {
      rerender(
        <ExceptionRow exception={exceptionWith(values)} stats={statsWith()} />,
      );
      expect(
        screen.getByTestId("exception-row-trend").getAttribute("class"),
      ).toContain("text-gray-300");
    }
  });

  test("while the page's numbers are read, the chart's place is held; without them, nothing", () => {
    const { rerender } = render(
      <ExceptionRow exception={exceptionWith()} isStatsLoading={true} />,
    );

    expect(screen.getByTestId("exception-row-trend-loading")).toHaveStyle({
      width: `${SPARKLINE_WIDTH}px`,
      height: `${SPARKLINE_HEIGHT}px`,
    });
    expect(screen.queryByTestId("exception-row-trend")).toBeNull();

    rerender(<ExceptionRow exception={exceptionWith()} />);

    expect(screen.queryByTestId("exception-row-trend-loading")).toBeNull();
    expect(screen.queryByTestId("exception-row-trend")).toBeNull();
    expect(screen.queryByTestId("exception-row-users")).toBeNull();
  });

  test("a range with no occurrence is a flat line, and reads so", () => {
    render(
      <ExceptionTrendSparkline trend={emptyExceptionTrend()} isMuted={false} />,
    );

    const chart: HTMLElement = screen.getByTestId("exception-row-trend");
    expect(chart).toHaveAttribute("aria-label", "0 events in this time range");
    for (const rect of Array.from(chart.querySelectorAll("rect"))) {
      expect(rect.getAttribute("height")).toBe("1");
    }
  });

  test("one occurrence reads in the singular", () => {
    const trend: Array<number> = emptyExceptionTrend();
    trend[0] = 1;
    render(<ExceptionTrendSparkline trend={trend} />);

    expect(screen.getByTestId("exception-row-trend")).toHaveAttribute(
      "aria-label",
      "1 event in this time range",
    );
  });
});

describe("where each bar goes", () => {
  test("the busiest slice is full height, the others in proportion, an empty one a hairline", () => {
    const bars: Array<ExceptionTrendBar> = getExceptionTrendBars([0, 5, 10]);

    expect(
      bars.map((bar: ExceptionTrendBar): number => {
        return bar.height;
      }),
    ).toEqual([1, 12, SPARKLINE_HEIGHT]);
  });

  test("a real bar is never shorter than a few pixels, so one occurrence beside thousands still shows", () => {
    const bars: Array<ExceptionTrendBar> = getExceptionTrendBars([1, 10000]);

    expect(bars[0]!.height).toBe(3);
  });

  test("a seeded sweep: bars fit the chart, side by side, oldest first", () => {
    const random: SeededRandom = seededRandom(9901);

    for (let round: number = 0; round < 500; round++) {
      const trend: Array<number> = new Array(EXCEPTION_TREND_BUCKET_COUNT)
        .fill(0)
        .map((): number => {
          return random(4) === 0 ? 0 : random(100000);
        });
      const bars: Array<ExceptionTrendBar> = getExceptionTrendBars(trend);
      const max: number = Math.max(...trend);
      const problems: Array<string> = [];

      expect(bars).toHaveLength(EXCEPTION_TREND_BUCKET_COUNT);

      bars.forEach((bar: ExceptionTrendBar, index: number): void => {
        const slot: number =
          (index * SPARKLINE_WIDTH) / EXCEPTION_TREND_BUCKET_COUNT;

        if (Math.abs(bar.x - slot) > 0.001) {
          problems.push(`${round}/${index}: x ${bar.x}`);
        }
        if (bar.x + bar.width > SPARKLINE_WIDTH) {
          problems.push(`${round}/${index}: past the right edge`);
        }
        if (bar.height < 1 || bar.height > SPARKLINE_HEIGHT) {
          problems.push(`${round}/${index}: height ${bar.height}`);
        }
        if (bar.count !== trend[index]) {
          problems.push(`${round}/${index}: count ${bar.count}`);
        }
        if (
          trend[index]! === max &&
          max > 0 &&
          bar.height !== SPARKLINE_HEIGHT
        ) {
          problems.push(`${round}/${index}: the busiest is not full height`);
        }
      });

      expect(problems).toEqual([]);

      // A busier slice is never drawn shorter than a quieter one.
      const byCount: Array<ExceptionTrendBar> = [...bars].sort(
        (a: ExceptionTrendBar, b: ExceptionTrendBar): number => {
          return a.count - b.count;
        },
      );
      const heightsByCount: Array<number> = byCount.map(
        (bar: ExceptionTrendBar): number => {
          return bar.height;
        },
      );
      expect(heightsByCount).toEqual(
        [...heightsByCount].sort((a: number, b: number): number => {
          return a - b;
        }),
      );
    }
  });

  test("no trend draws no bar", () => {
    expect(getExceptionTrendBars([])).toEqual([]);
  });
});
