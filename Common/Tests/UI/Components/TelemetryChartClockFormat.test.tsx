/** @timezone America/Los_Angeles */
/**
 * The reported bug, one layer below the time range picker: every timestamp the
 * Logs / Traces / Metrics explorers draw *inside* the chart - the histogram's
 * x-axis ticks and the tooltip that follows the cursor - was formatted with a
 * bare `date.toLocaleTimeString([], { hour12: false })`.
 *
 * That hardcodes a 24-hour clock over the user's own preference, and passes no
 * `timeZone`, so the digits come from the browser process instead of the zone
 * set in User Settings. Inside a single Logs explorer that produced two
 * different rules on one screen: LogsTable's Time column already goes through
 * OneUptimeDate (honouring both), while the histogram directly above it did
 * not.
 *
 * These render the real components rather than calling the formatters,
 * because a correct formatter is worth nothing if the chart stops reading from
 * it. The browser zone is pinned to Los Angeles by the docblock and every case
 * configures a different zone, so nothing here can pass by coincidence.
 */
import HistogramTooltip from "../../../UI/Components/LogsViewer/components/HistogramTooltip";
import LogsHistogram from "../../../UI/Components/LogsViewer/components/LogsHistogram";
import {
  formatTickTime as formatLogsAnalyticsTick,
  formatTooltipLabel as formatLogsAnalyticsTooltip,
} from "../../../UI/Components/LogsViewer/components/LogsAnalyticsView";
import TelemetryHistogram from "../../../UI/Components/TelemetryViewer/components/TelemetryHistogram";
import TelemetryHistogramTooltip from "../../../UI/Components/TelemetryViewer/components/TelemetryHistogramTooltip";
import { HistogramBucket as LogsBucket } from "../../../UI/Components/LogsViewer/types";
import {
  HistogramBucket as TelemetryBucket,
  HistogramSeriesOption,
} from "../../../UI/Components/TelemetryViewer/types";
import LogSeverity from "../../../Types/Log/LogSeverity";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ResponsiveContainer measures its parent, which is always 0x0 in jsdom, so
 * the chart draws no ticks at all without a fixed size.
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

/*
 * Three consecutive minutes straddling noon UTC. Noon is deliberate: it is the
 * reading a naive `hours % 12` turns into "0:00 PM", and it is where a 24-hour
 * "12:00" and a 12-hour "12:00 PM" differ only by the marker.
 */
const BUCKET_TIMES: Array<string> = [
  "2026-08-05T11:58:00Z",
  "2026-08-05T11:59:00Z",
  "2026-08-05T12:00:00Z",
];

const LOG_BUCKETS: Array<LogsBucket> = BUCKET_TIMES.map(
  (time: string, index: number): LogsBucket => {
    return { time, severity: LogSeverity.Error, count: index + 3 };
  },
);

const TELEMETRY_SERIES: Array<HistogramSeriesOption> = [
  { key: "ok", label: "OK", color: "#10b981" },
];

const TELEMETRY_BUCKETS: Array<TelemetryBucket> = BUCKET_TIMES.map(
  (time: string, index: number): TelemetryBucket => {
    return { time, series: "ok", count: index + 3 };
  },
);

/** Matches a clock reading on either clock, so it selects the time axis without assuming the fix. */
const CLOCK_LABEL: RegExp = /\d{1,2}:\d{2}/;

function timeAxisLabels(container: HTMLElement): Array<string> {
  return Array.from(
    container.querySelectorAll(".recharts-cartesian-axis-tick-value"),
  )
    .map((tick: Element): string => {
      return tick.textContent || "";
    })
    .filter((label: string): boolean => {
      return CLOCK_LABEL.test(label);
    });
}

/** The tooltip prints its timestamp in the first paragraph, above the counts. */
function tooltipTimestamp(container: HTMLElement): string {
  return (container.querySelector("p")?.textContent || "").trim();
}

function pin(use12HourFormat: boolean, timezone: Timezone): void {
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(use12HourFormat);
  OneUptimeDate.setUserTimezone(timezone);
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

interface HistogramSurface {
  name: string;
  render: () => HTMLElement;
}

const HISTOGRAMS: Array<HistogramSurface> = [
  {
    name: "logs",
    render: (): HTMLElement => {
      return render(<LogsHistogram buckets={LOG_BUCKETS} isLoading={false} />)
        .container;
    },
  },
  {
    name: "telemetry",
    render: (): HTMLElement => {
      return render(
        <TelemetryHistogram
          buckets={TELEMETRY_BUCKETS}
          series={TELEMETRY_SERIES}
          isLoading={false}
        />,
      ).container;
    },
  },
];

describe.each(HISTOGRAMS)(
  "the $name explorer histogram x-axis",
  (surface: HistogramSurface) => {
    test("labels its ticks with AM/PM on a machine set to a 12-hour clock", () => {
      pin(true, Timezone.UTC);

      const labels: Array<string> = timeAxisLabels(surface.render());

      expect(labels).toContain("12:00 PM");
      expect(labels).toContain("11:58 AM");
    });

    test("never leaves a bare 24-hour tick on a 12-hour machine", () => {
      pin(true, Timezone.UTC);

      const labels: Array<string> = timeAxisLabels(surface.render());

      expect(labels).not.toContain("12:00");
      expect(labels).not.toContain("11:58");
    });

    test("keeps 24-hour ticks on a machine set to a 24-hour clock", () => {
      pin(false, Timezone.UTC);

      const labels: Array<string> = timeAxisLabels(surface.render());

      expect(labels).toContain("12:00");
      expect(labels).toContain("11:58");
      expect(labels.join(" ")).not.toContain("PM");
    });

    /*
     * Los Angeles is the browser's zone here; Kolkata is the configured one.
     * 12:00 UTC is 05:00 in Los Angeles and 17:30 in Kolkata, so the two are
     * impossible to confuse.
     */
    test("draws the ticks in the configured timezone, not the browser's", () => {
      pin(false, Timezone.AsiaKolkata);

      const labels: Array<string> = timeAxisLabels(surface.render());

      expect(labels).toContain("17:30");
      expect(labels).not.toContain("05:00");
      expect(labels).not.toContain("12:00");
    });

    test("carries the configured timezone into the 12-hour reading too", () => {
      pin(true, Timezone.AsiaKolkata);

      expect(timeAxisLabels(surface.render())).toContain("5:30 PM");
    });
  },
);

interface TooltipSurface {
  name: string;
  render: (label: string) => HTMLElement;
}

const TOOLTIPS: Array<TooltipSurface> = [
  {
    name: "logs histogram",
    render: (label: string): HTMLElement => {
      return render(
        <HistogramTooltip
          active={true}
          label={label}
          payload={[
            {
              dataKey: LogSeverity.Error,
              value: 7,
              payload: {},
            },
          ]}
        />,
      ).container;
    },
  },
  {
    name: "telemetry histogram",
    render: (label: string): HTMLElement => {
      return render(
        <TelemetryHistogramTooltip
          active={true}
          label={label}
          payload={[{ dataKey: "ok", value: 7, payload: {} }]}
          seriesByKey={{ ok: TELEMETRY_SERIES[0] as HistogramSeriesOption }}
        />,
      ).container;
    },
  },
];

describe.each(TOOLTIPS)("the $name tooltip", (surface: TooltipSurface) => {
  /*
   * A bucket from a day that is definitely not today, so the branch under test
   * is the one that spells the date out.
   */
  const OLD_BUCKET: string = "2020-03-01T14:30:45.000Z";

  test("writes an older bucket with AM/PM on a 12-hour machine", () => {
    pin(true, Timezone.UTC);

    expect(tooltipTimestamp(surface.render(OLD_BUCKET))).toBe(
      "Mar 1, 2:30:45 PM",
    );
  });

  test("writes an older bucket on a 24-hour clock when that is the preference", () => {
    pin(false, Timezone.UTC);

    expect(tooltipTimestamp(surface.render(OLD_BUCKET))).toBe(
      "Mar 1, 14:30:45",
    );
  });

  test("reads the bucket in the configured timezone", () => {
    pin(false, Timezone.AsiaKolkata);

    // 14:30:45 UTC is 20:00:45 the same evening in Kolkata.
    expect(tooltipTimestamp(surface.render(OLD_BUCKET))).toBe(
      "Mar 1, 20:00:45",
    );
  });

  /*
   * Today's buckets drop the date - the explorer's range picker already says
   * which day is on screen. Which day counts as "today" has to be answered in
   * the configured zone; the old `toDateString()` comparison asked Los Angeles
   * instead, so for several hours either side of midnight in Kolkata the two
   * disagreed. "Now" is pinned in both cases below, because a comparison that
   * happens to be right at the hour the suite runs proves nothing.
   */
  function pinNow(instant: string): void {
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date(instant));
  }

  test("drops the date from a bucket on today's date in the configured timezone", () => {
    pin(false, Timezone.AsiaKolkata);
    // 21:30 on 1 March in Kolkata; still 08:00 that morning in Los Angeles.
    pinNow("2024-03-01T16:00:00.000Z");

    /*
     * 07:30 the same Kolkata morning - but the evening of 29 February in Los
     * Angeles, so the browser-zone comparison would have dated this bucket.
     */
    expect(tooltipTimestamp(surface.render("2024-03-01T02:00:00.000Z"))).toBe(
      "07:30:00",
    );
  });

  test("dates a bucket the browser's zone would have called today", () => {
    pin(false, Timezone.AsiaKolkata);
    // 00:30 on 2 March in Kolkata; still 11:00 on 1 March in Los Angeles.
    pinNow("2024-03-01T19:00:00.000Z");

    /*
     * 21:30 on 1 March in Kolkata - yesterday there, so it needs its date -
     * while Los Angeles puts it on the same day as "now" and would have
     * dropped it.
     */
    expect(tooltipTimestamp(surface.render("2024-03-01T16:00:00.000Z"))).toBe(
      "Mar 1, 21:30:00",
    );
  });

  test("spells the date out on a bucket from another day", () => {
    pin(false, Timezone.UTC);

    expect(tooltipTimestamp(surface.render(OLD_BUCKET))).toContain("Mar 1,");
  });

  test("leaves an unparseable label alone", () => {
    pin(true, Timezone.UTC);

    expect(tooltipTimestamp(surface.render("not-a-date"))).toBe("not-a-date");
  });
});

/*
 * The Logs explorer's analytics tab draws its own chart from the same buckets.
 * Its formatters are module-level so they can be checked directly - rendering
 * the view itself would need the whole telemetry API behind it.
 */
describe("the logs analytics chart", () => {
  test("labels x-axis ticks on the machine's clock and configured zone", () => {
    pin(true, Timezone.AsiaKolkata);
    expect(formatLogsAnalyticsTick("2026-08-05T12:00:00Z")).toBe("5:30 PM");

    jest.restoreAllMocks();

    pin(false, Timezone.AsiaKolkata);
    expect(formatLogsAnalyticsTick("2026-08-05T12:00:00Z")).toBe("17:30");
  });

  test("dates its tooltip label on the same clock", () => {
    pin(true, Timezone.UTC);
    expect(formatLogsAnalyticsTooltip("2026-08-05T12:00:00Z")).toBe(
      "Aug 5, 12:00 PM",
    );

    jest.restoreAllMocks();

    pin(false, Timezone.UTC);
    expect(formatLogsAnalyticsTooltip("2026-08-05T12:00:00Z")).toBe(
      "Aug 5, 12:00",
    );
  });

  test("leaves unparseable input alone", () => {
    pin(true, Timezone.UTC);

    expect(formatLogsAnalyticsTick("not-a-date")).toBe("not-a-date");
    expect(formatLogsAnalyticsTooltip("not-a-date")).toBe("not-a-date");
    expect(formatLogsAnalyticsTooltip(undefined)).toBe("");
  });
});
