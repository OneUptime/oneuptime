/** @timezone UTC */

import LogsHistogram from "../../../UI/Components/LogsViewer/components/LogsHistogram";
import { HistogramBucket } from "../../../UI/Components/LogsViewer/types";
import LogSeverity from "../../../Types/Log/LogSeverity";
import OneUptimeDate from "../../../Types/Date";
import { render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ResponsiveContainer measures its parent, which is always 0x0 in jsdom, so the
 * chart renders nothing without a fixed size.
 */
jest.mock("recharts", () => {
  const actual: Record<string, any> = jest.requireActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return React.cloneElement(children, { width: 600, height: 300 });
    },
  };
});

function bucket(
  time: string,
  severity: string,
  count: number,
): HistogramBucket {
  return { time, severity, count };
}

/** One bar rectangle is drawn per severity per bucket that has a count. */
function barCount(container: HTMLElement): number {
  return container.querySelectorAll(".recharts-bar-rectangle").length;
}

/** One <g> per stacked series, i.e. per severity present in the data. */
function seriesCount(container: HTMLElement): number {
  return container.querySelectorAll(".recharts-bar").length;
}

/*
 * Matches a tick on either clock. The axis follows the machine's 12/24-hour
 * preference now, so a pattern that only knew "HH:mm" would quietly classify
 * every tick as a count label on an AM/PM machine and leave the assertions
 * below comparing empty arrays.
 */
const CLOCK_LABEL: RegExp = /^\d{1,2}:\d{2}( [AP]M)?$/;

/*
 * The tick labels are the machine's business, not the test's, so every case
 * that reads them says which clock it is asking about.
 */
function pinClock(use12HourFormat: boolean): void {
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(use12HourFormat);
}

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * Recharts portals tick labels out of their axis group, so the two axes are
 * told apart by what they render: the time axis is formatted as a clock, the
 * count axis as a number.
 */
function axisLabels(
  container: HTMLElement,
  axis: "time" | "count",
): Array<string> {
  const labels: Array<string> = Array.from(
    container.querySelectorAll(".recharts-cartesian-axis-tick-value"),
  ).map((tick: Element): string => {
    return tick.textContent || "";
  });

  return labels.filter((label: string): boolean => {
    return CLOCK_LABEL.test(label) === (axis === "time");
  });
}

const ONE_SEVERITY: Array<HistogramBucket> = [
  bucket("2026-08-05T11:58:00Z", LogSeverity.Error, 3),
  bucket("2026-08-05T11:59:00Z", LogSeverity.Error, 5),
  bucket("2026-08-05T12:00:00Z", LogSeverity.Error, 7),
];

describe("LogsHistogram", () => {
  describe("empty and loading states", () => {
    test("renders nothing when the window holds no logs", () => {
      const { container } = render(
        <LogsHistogram buckets={[]} isLoading={false} />,
      );

      expect(container.innerHTML).toBe("");
    });

    test("shows the loader on the very first load", () => {
      render(<LogsHistogram buckets={[]} isLoading={true} />);

      expect(screen.queryByTestId("component-loader")).not.toBeNull();
    });

    /*
     * Live mode refreshes the histogram every few seconds. Swapping the chart
     * for a loader on each poll would make it flash; the chart already on
     * screen stays until the new buckets land.
     */
    test("keeps the chart on screen while a refresh is in flight", () => {
      const { container } = render(
        <LogsHistogram buckets={ONE_SEVERITY} isLoading={true} />,
      );

      expect(screen.queryByTestId("component-loader")).toBeNull();
      expect(screen.queryByText("Log Volume")).not.toBeNull();
      expect(barCount(container)).toBe(3);
    });
  });

  describe("drawing the buckets", () => {
    test("draws one bar per bucket", () => {
      const { container } = render(
        <LogsHistogram buckets={ONE_SEVERITY} isLoading={false} />,
      );

      expect(barCount(container)).toBe(3);
      expect(seriesCount(container)).toBe(1);
    });

    test("stacks a bar per severity inside a bucket", () => {
      const { container } = render(
        <LogsHistogram
          buckets={[
            bucket("2026-08-05T12:00:00Z", LogSeverity.Error, 4),
            bucket("2026-08-05T12:00:00Z", LogSeverity.Warning, 6),
            bucket("2026-08-05T12:00:00Z", LogSeverity.Information, 9),
          ]}
          isLoading={false}
        />,
      );

      expect(seriesCount(container)).toBe(3);
      expect(barCount(container)).toBe(3);
    });

    test("labels the time axis in the reader's clock", () => {
      pinClock(false);

      const { container } = render(
        <LogsHistogram buckets={ONE_SEVERITY} isLoading={false} />,
      );

      expect(axisLabels(container, "time")).toContain("12:00");
    });

    /*
     * Noon is where the two clocks are hardest to tell apart - "12:00" is a
     * valid reading on both - so the marker is the whole assertion.
     */
    test("labels the time axis with AM/PM when that is the reader's clock", () => {
      pinClock(true);

      const { container } = render(
        <LogsHistogram buckets={ONE_SEVERITY} isLoading={false} />,
      );

      expect(axisLabels(container, "time")).toContain("12:00 PM");
    });

    test("lists only the severities present in the window", () => {
      render(
        <LogsHistogram
          buckets={[
            bucket("2026-08-05T12:00:00Z", LogSeverity.Error, 4),
            bucket("2026-08-05T12:00:00Z", LogSeverity.Debug, 1),
          ]}
          isLoading={false}
        />,
      );

      expect(screen.queryByText("Error")).not.toBeNull();
      expect(screen.queryByText("Debug")).not.toBeNull();
      expect(screen.queryByText("Fatal")).toBeNull();
    });
  });

  /*
   * What live mode looks like from the chart's side: the same component is
   * handed a fresh set of buckets every poll and has to redraw.
   */
  describe("when a live refresh brings new data", () => {
    test("adds a bar as a new bucket opens", () => {
      const view: ReturnType<typeof render> = render(
        <LogsHistogram buckets={ONE_SEVERITY} isLoading={false} />,
      );

      expect(barCount(view.container)).toBe(3);

      view.rerender(
        <LogsHistogram
          buckets={[
            ...ONE_SEVERITY,
            bucket("2026-08-05T12:01:00Z", LogSeverity.Error, 2),
          ]}
          isLoading={false}
        />,
      );

      expect(barCount(view.container)).toBe(4);
    });

    test("follows the window as it slides off the oldest bucket", () => {
      pinClock(false);

      const view: ReturnType<typeof render> = render(
        <LogsHistogram buckets={ONE_SEVERITY} isLoading={false} />,
      );

      expect(axisLabels(view.container, "time")).toContain("11:58");

      view.rerender(
        <LogsHistogram
          buckets={[
            ...ONE_SEVERITY.slice(1),
            bucket("2026-08-05T12:01:00Z", LogSeverity.Error, 2),
          ]}
          isLoading={false}
        />,
      );

      const labels: Array<string> = axisLabels(view.container, "time");
      expect(labels).not.toContain("11:58");
      expect(labels).toContain("12:01");
    });

    test("rescales the count axis as the newest bucket fills up", () => {
      const view: ReturnType<typeof render> = render(
        <LogsHistogram buckets={ONE_SEVERITY} isLoading={false} />,
      );

      const before: Array<string> = axisLabels(view.container, "count");

      view.rerender(
        <LogsHistogram
          buckets={[
            ...ONE_SEVERITY.slice(0, 2),
            bucket("2026-08-05T12:00:00Z", LogSeverity.Error, 400),
          ]}
          isLoading={false}
        />,
      );

      const after: Array<string> = axisLabels(view.container, "count");

      expect(after).not.toEqual(before);
      expect(Number(after[after.length - 1])).toBeGreaterThan(
        Number(before[before.length - 1]),
      );
    });

    test("adds a series and a legend entry when a new severity shows up", () => {
      const view: ReturnType<typeof render> = render(
        <LogsHistogram buckets={ONE_SEVERITY} isLoading={false} />,
      );

      expect(screen.queryByText("Fatal")).toBeNull();

      view.rerender(
        <LogsHistogram
          buckets={[
            ...ONE_SEVERITY,
            bucket("2026-08-05T12:00:00Z", LogSeverity.Fatal, 1),
          ]}
          isLoading={false}
        />,
      );

      expect(screen.queryByText("Fatal")).not.toBeNull();
      expect(seriesCount(view.container)).toBe(2);
    });

    test("empties the chart when the refreshed window has no logs", () => {
      const view: ReturnType<typeof render> = render(
        <LogsHistogram buckets={ONE_SEVERITY} isLoading={false} />,
      );

      view.rerender(<LogsHistogram buckets={[]} isLoading={false} />);

      expect(view.container.innerHTML).toBe("");
    });
  });

  describe("drag to zoom", () => {
    test("offers the affordance when the parent can act on a selection", () => {
      render(
        <LogsHistogram
          buckets={ONE_SEVERITY}
          isLoading={false}
          onTimeRangeSelect={() => {}}
        />,
      );

      expect(screen.queryByText("Drag to zoom")).not.toBeNull();
    });

    test("hides the affordance when there is nothing to zoom into", () => {
      render(<LogsHistogram buckets={ONE_SEVERITY} isLoading={false} />);

      expect(screen.queryByText("Drag to zoom")).toBeNull();
    });
  });
});
