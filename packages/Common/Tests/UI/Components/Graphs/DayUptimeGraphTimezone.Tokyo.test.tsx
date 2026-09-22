/**
 * @timezone Asia/Tokyo
 */
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import DayUptimeGraph, {
  BarChartRule,
  DayReading,
  NO_DATA_BAR_COLOR,
  UptimeBarDaySummary,
} from "../../../../UI/Components/Graphs/DayUptimeGraph";
import UptimeBarTooltip from "../../../../UI/Components/Graphs/UptimeBarTooltip";
import { StatusDuration } from "../../../../UI/Components/Graphs/UptimeDaySummary";
import UptimeBarDayModal from "../../../../UI/Components/MonitorGraphs/UptimeBarDayModal";
import Color from "../../../../Types/Color";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import UptimeBarTooltipIncident from "../../../../Types/Monitor/UptimeBarTooltipIncident";

/*
 * Root cause 3 of the grey bars on status.chainflip.io, seen from Tokyo.
 *
 * The status page's per-day readings are cut on UTC days (one cached payload
 * serves every visitor). The strip used to be drawn on the visitor's local
 * days and matched each reading to whichever local day its start fell in.
 * East of UTC a UTC midnight falls at 09:00 local, so for the first nine hours
 * of every Tokyo day today's bar had no reading at all - and the reading of
 * the day before was pushed onto the wrong bar.
 *
 * The fix draws the strip on the zone the readings were cut in (the
 * `timezone` prop) and labels the bars " (UTC)" when that is not the visitor's
 * own offset.
 *
 * Every test with a timezone prop fails on the pre-fix code: the prop did not
 * exist (a type error under ts-jest), and ignoring it gives exactly the
 * "without the timezone" results these tests also pin.
 */

const DAY_MS: number = 24 * 60 * 60 * 1000;

const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const OPERATIONAL_COLOR: Color = new Color("#1F9D55");
const OFFLINE_COLOR: Color = new Color("#C0392B");

// status.chainflip.io's own configuration.
const CF_DEFAULT_GREY: Color = new Color("#5F5F5F");
const CF_RULE_GREEN: Color = new Color("#46DA93");
const CF_RULE_ORANGE: Color = new Color("#EC9F0A");
const CF_RULE_RED: Color = new Color("#F64848");

const CF_RULES: Array<BarChartRule> = [
  { barColor: CF_RULE_GREEN, uptimePercentGreaterThanOrEqualTo: 97 },
  { barColor: CF_RULE_ORANGE, uptimePercentGreaterThanOrEqualTo: 50 },
  { barColor: CF_RULE_RED, uptimePercentGreaterThanOrEqualTo: 0 },
];

/*
 * A different uptime for every bucket, so a reading painted on the wrong bar
 * shows up as the wrong number rather than hiding behind an identical one.
 */
const PERCENTS: Array<number> = [90, 91, 92, 93, 94, 95];

interface BucketSpan {
  start: Date;
  end: Date;
}

/*
 * The server's UTC day buckets for a window, written out independently of the
 * code under test: one per UTC calendar day the window touches, the first
 * clipped to the window's start and the last to "now".
 */
function utcBucketSpans(windowStart: Date, windowEnd: Date): Array<BucketSpan> {
  const spans: Array<BucketSpan> = [];

  for (
    let midnight: number = Math.floor(windowStart.getTime() / DAY_MS) * DAY_MS;
    midnight < windowEnd.getTime();
    midnight += DAY_MS
  ) {
    spans.push({
      start: new Date(Math.max(midnight, windowStart.getTime())),
      end: new Date(Math.min(midnight + DAY_MS, windowEnd.getTime())),
    });
  }

  return spans;
}

function readingFor(span: BucketSpan, uptimePercent: number): DayReading {
  const coveredSeconds: number =
    (span.end.getTime() - span.start.getTime()) / 1000;
  const offlineSeconds: number = (coveredSeconds * (100 - uptimePercent)) / 100;

  const statusDurations: Array<StatusDuration> = [
    {
      label: "Operational",
      seconds: coveredSeconds - offlineSeconds,
      color: OPERATIONAL_COLOR,
      isDowntime: false,
      priority: 1,
    },
    {
      label: "Offline",
      seconds: offlineSeconds,
      color: OFFLINE_COLOR,
      isDowntime: true,
      priority: 3,
    },
  ];

  return {
    dayStart: span.start,
    daySeconds: coveredSeconds,
    coveredSeconds: coveredSeconds,
    statusDurations: statusDurations,
  };
}

function readingsAt(
  spans: Array<BucketSpan>,
  percents: Array<number>,
): Array<DayReading> {
  return spans.map((span: BucketSpan, index: number) => {
    return readingFor(span, percents[index] as number);
  });
}

type OnBarClickFunction = (
  date: Date,
  incidents: Array<UptimeBarTooltipIncident>,
  summary: UptimeBarDaySummary,
) => void;

type OnBarClickMock = ReturnType<typeof jest.fn<OnBarClickFunction>>;

function renderStrip(
  props: Partial<React.ComponentProps<typeof DayUptimeGraph>> &
    Pick<React.ComponentProps<typeof DayUptimeGraph>, "startDate" | "endDate">,
): { onBarClick: OnBarClickMock } {
  const onBarClick: OnBarClickMock = jest.fn<OnBarClickFunction>();

  render(
    <DayUptimeGraph
      events={[]}
      defaultBarColor={CF_DEFAULT_GREY}
      height={10}
      downtimeEventStatusIds={[OFFLINE_STATUS_ID]}
      onBarClick={onBarClick}
      {...props}
    />,
  );

  return { onBarClick: onBarClick };
}

function getBars(): Array<HTMLElement> {
  return screen.getAllByTestId("uptime-bar");
}

function getLabels(): Array<string | null> {
  return getBars().map((bar: HTMLElement) => {
    return bar.getAttribute("aria-label");
  });
}

function pinNow(now: Date): void {
  jest.useFakeTimers();
  jest.setSystemTime(now);
}

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

/*
 * 03:00 JST on Wednesday Sep 23 is 18:00 UTC on Tuesday Sep 22: Tokyo is
 * already on the next date. The window is the status page's - "now" back five
 * days - so it touches six UTC days.
 */
describe("DayUptimeGraph in Tokyo - early morning, when Tokyo is already on the next date", () => {
  const NOW: Date = new Date("2026-09-22T18:00:00.000Z");
  const START: Date = new Date("2026-09-17T18:00:00.000Z");
  const SPANS: Array<BucketSpan> = utcBucketSpans(START, NOW);
  const READINGS: Array<DayReading> = readingsAt(SPANS, PERCENTS);

  beforeEach(() => {
    pinNow(NOW);
  });

  test("the fixture is the page's window: five days back from now, six UTC buckets", () => {
    expect(OneUptimeDate.getSomeDaysAgoFromDate(NOW, 5).toISOString()).toBe(
      START.toISOString(),
    );
    expect(SPANS).toHaveLength(6);
    expect(SPANS[0]?.start.toISOString()).toBe("2026-09-17T18:00:00.000Z");
    expect(SPANS[5]?.start.toISOString()).toBe("2026-09-22T00:00:00.000Z");
    expect(SPANS[5]?.end.toISOString()).toBe(NOW.toISOString());
  });

  test("drawn on UTC days, there is one bar per bucket and bar i is painted from bucket i", () => {
    renderStrip({
      startDate: START,
      endDate: NOW,
      dayReadings: READINGS,
      timezone: "UTC",
    });

    expect(getBars()).toHaveLength(SPANS.length);
    expect(getLabels()).toEqual([
      "Sep 17, 2026 (UTC): 90% uptime",
      "Sep 18, 2026 (UTC): 91% uptime",
      "Sep 19, 2026 (UTC): 92% uptime",
      "Sep 20, 2026 (UTC): 93% uptime",
      "Sep 21, 2026 (UTC): 94% uptime",
      "Sep 22, 2026 (UTC): 95% uptime",
    ]);
  });

  test("the last bar is UTC's today and has a reading, not 'no data'", () => {
    renderStrip({
      startDate: START,
      endDate: NOW,
      dayReadings: READINGS,
      timezone: "UTC",
    });

    const lastLabel: string = getLabels()[5] || "";

    expect(lastLabel).toBe("Sep 22, 2026 (UTC): 95% uptime");
    expect(lastLabel).not.toContain("no data");
  });

  test("opening a bar hands back the UTC midnight it stands for", () => {
    const { onBarClick } = renderStrip({
      startDate: START,
      endDate: NOW,
      dayReadings: READINGS,
      timezone: "UTC",
    });

    getBars().forEach((bar: HTMLElement, index: number) => {
      fireEvent.click(bar);

      const call: Parameters<OnBarClickFunction> | undefined =
        onBarClick.mock.calls[index];
      const summary: UptimeBarDaySummary = call?.[2] as UptimeBarDaySummary;

      expect((call?.[0] as Date).toISOString()).toBe(
        `2026-09-${17 + index}T00:00:00.000Z`,
      );
      expect(summary.uptimePercent).toBeCloseTo(PERCENTS[index] as number, 6);
    });
  });

  test("the tooltip names the bar's UTC date, although Tokyo's calendar says Sep 23", async () => {
    renderStrip({
      startDate: START,
      endDate: NOW,
      dayReadings: READINGS,
      timezone: "UTC",
    });

    fireEvent.mouseEnter(getBars()[5] as HTMLElement);

    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    expect(screen.getByRole("tooltip")).toHaveTextContent("Sep 22, 2026 (UTC)");
  });

  /*
   * The pre-fix strip, documented. Drawn on Tokyo days, bar 0 holds the
   * starts of two buckets and keeps the first, the Sep 18 bucket (91%) is on
   * no bar at all, every later bar shows the previous local date's UTC
   * reading, and today - Sep 23 in Tokyo - has no reading.
   */
  test("without the timezone, today's bar has no reading and one bucket is on no bar at all", () => {
    renderStrip({
      startDate: START,
      endDate: NOW,
      dayReadings: READINGS,
    });

    const labels: Array<string | null> = getLabels();

    expect(labels).toEqual([
      "Sep 18, 2026: 90% uptime",
      "Sep 19, 2026: 92% uptime",
      "Sep 20, 2026: 93% uptime",
      "Sep 21, 2026: 94% uptime",
      "Sep 22, 2026: 95% uptime",
      "Sep 23, 2026: no data",
    ]);

    for (const label of labels) {
      expect(label).not.toContain("91% uptime");
    }
  });

  /*
   * status.chainflip.io's today, from Tokyo in the small hours: up all day,
   * no events (the pre-fix sort lost the open row), a UTC reading that says
   * Operational. The local strip had no reading for today's bar and drew it
   * as a day with no data; drawn on UTC days it is green at 100%.
   */
  test("status.chainflip.io's today: an Operational UTC reading paints today green at 100%, where the local strip found none", () => {
    const readings: Array<DayReading> = readingsAt(
      SPANS,
      [99, 99, 99, 99, 99, 100],
    );

    renderStrip({
      startDate: START,
      endDate: NOW,
      dayReadings: readings,
      barColorRules: CF_RULES,
      timezone: "UTC",
    });

    const today: HTMLElement = getBars()[5] as HTMLElement;

    expect(today).toHaveStyle({ backgroundColor: CF_RULE_GREEN.toString() });
    expect(today).not.toHaveStyle({
      backgroundColor: CF_DEFAULT_GREY.toString(),
    });
    expect(today.getAttribute("aria-label")).toBe(
      "Sep 22, 2026 (UTC): 100% uptime",
    );

    cleanup();

    // The same page on the pre-fix, local-day strip.
    renderStrip({
      startDate: START,
      endDate: NOW,
      dayReadings: readings,
      barColorRules: CF_RULES,
    });

    const localToday: HTMLElement = getBars()[5] as HTMLElement;

    expect(localToday).toHaveStyle({
      backgroundColor: NO_DATA_BAR_COLOR.toString(),
    });
    expect(localToday.getAttribute("aria-label")).toBe("Sep 23, 2026: no data");
  });
});

/*
 * 12:00 JST on Tuesday Sep 22 is 03:00 UTC the same day. After 09:00 JST each
 * UTC bucket starts inside the Tokyo day of the same date, so the pre-fix
 * strip happened to line up - which is why the bug only showed in Tokyo for
 * the first hours of the day.
 */
describe("DayUptimeGraph in Tokyo - midday, when the dates agree", () => {
  const NOW: Date = new Date("2026-09-22T03:00:00.000Z");
  const START: Date = new Date("2026-09-17T03:00:00.000Z");
  const SPANS: Array<BucketSpan> = utcBucketSpans(START, NOW);
  const READINGS: Array<DayReading> = readingsAt(SPANS, PERCENTS);

  beforeEach(() => {
    pinNow(NOW);
  });

  test("the UTC strip draws the same readings in the same order, and still says they are UTC days", () => {
    renderStrip({
      startDate: START,
      endDate: NOW,
      dayReadings: READINGS,
      timezone: "UTC",
    });

    expect(getLabels()).toEqual([
      "Sep 17, 2026 (UTC): 90% uptime",
      "Sep 18, 2026 (UTC): 91% uptime",
      "Sep 19, 2026 (UTC): 92% uptime",
      "Sep 20, 2026 (UTC): 93% uptime",
      "Sep 21, 2026 (UTC): 94% uptime",
      "Sep 22, 2026 (UTC): 95% uptime",
    ]);
  });

  test("without the timezone the local strip is unchanged: the same dates, no zone on the label", () => {
    renderStrip({
      startDate: START,
      endDate: NOW,
      dayReadings: READINGS,
    });

    expect(getLabels()).toEqual([
      "Sep 17, 2026: 90% uptime",
      "Sep 18, 2026: 91% uptime",
      "Sep 19, 2026: 92% uptime",
      "Sep 20, 2026: 93% uptime",
      "Sep 21, 2026: 94% uptime",
      "Sep 22, 2026: 95% uptime",
    ]);
  });

  test("a strip drawn in Tokyo's own zone reads like the default, with no zone on the label", () => {
    renderStrip({
      startDate: START,
      endDate: NOW,
      dayReadings: READINGS,
      timezone: "Asia/Tokyo",
    });

    expect(getLabels()).toEqual([
      "Sep 17, 2026: 90% uptime",
      "Sep 18, 2026: 91% uptime",
      "Sep 19, 2026: 92% uptime",
      "Sep 20, 2026: 93% uptime",
      "Sep 21, 2026: 94% uptime",
      "Sep 22, 2026: 95% uptime",
    ]);
  });
});

describe("Day labels in Tokyo", () => {
  test("the tooltip dates a UTC day as UTC, and without a zone as the visitor's own day", () => {
    // 18:00 UTC on Sep 22 is 03:00 on Sep 23 in Tokyo.
    const lateUtc: Date = new Date("2026-09-22T18:00:00.000Z");

    render(
      <UptimeBarTooltip
        date={new Date("2026-09-22T00:00:00.000Z")}
        timezone="UTC"
        uptimePercent={100}
        hasEvents={true}
        statusDurations={[]}
        incidents={[]}
      />,
    );

    expect(screen.getByText("Sep 22, 2026 (UTC)")).toBeInTheDocument();

    cleanup();

    render(
      <UptimeBarTooltip
        date={lateUtc}
        uptimePercent={100}
        hasEvents={true}
        statusDurations={[]}
        incidents={[]}
      />,
    );

    // Omitted: exactly the old local label.
    expect(screen.getByText("Sep 23, 2026")).toBeInTheDocument();
    expect(
      screen.getByText(
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(lateUtc, true),
      ),
    ).toBeInTheDocument();
  });

  test("a bar drawn in Tokyo's own zone is dated without a zone", () => {
    render(
      <UptimeBarTooltip
        date={new Date("2026-09-22T15:00:00.000Z")}
        timezone="Asia/Tokyo"
        uptimePercent={100}
        hasEvents={true}
        statusDurations={[]}
        incidents={[]}
      />,
    );

    expect(screen.getByText("Sep 23, 2026")).toBeInTheDocument();
  });

  test("the day dialog a UTC bar opens is titled with the same UTC date", () => {
    render(
      <UptimeBarDayModal
        date={new Date("2026-09-22T00:00:00.000Z")}
        timezone="UTC"
        incidents={[]}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Sep 22, 2026 (UTC)")).toBeInTheDocument();
  });
});
