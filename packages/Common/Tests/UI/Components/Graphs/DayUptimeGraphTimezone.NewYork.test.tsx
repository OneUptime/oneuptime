/**
 * @timezone America/New_York
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
import MonitorUptimeGraph from "../../../../UI/Components/MonitorGraphs/Uptime";
import UptimeBarDayModal from "../../../../UI/Components/MonitorGraphs/UptimeBarDayModal";
import Color from "../../../../Types/Color";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import UptimeBarTooltipIncident from "../../../../Types/Monitor/UptimeBarTooltipIncident";
import {
  UptimeDailyAggregate,
  UptimeDayBucket,
} from "../../../../Types/StatusPage/UptimeDailyAggregate";
import UptimeDailyAggregateUtil from "../../../../Utils/StatusPage/UptimeDailyAggregateUtil";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

/*
 * Root cause 3 of the grey bars on status.chainflip.io, seen from New York.
 *
 * The status page's per-day readings are cut on UTC days: the overview is one
 * cached payload shared by every visitor, so the server cannot cut them on
 * each visitor's local days. The strip used to be drawn on the VISITOR's
 * local days anyway, and each reading was matched to whichever local day its
 * start fell in. West of UTC a UTC midnight is the previous local evening, so
 * every bar showed the reading of the day AFTER the date on its label, and
 * during the day today's bar had no reading at all.
 *
 * The fix draws the strip on the zone the readings were cut in (the
 * `timezone` prop; `uptimeTimezone` on MonitorUptimeGraph) and says so on the
 * label with " (UTC)" when that is not the visitor's own offset.
 *
 * Every test with a timezone prop fails on the pre-fix code: the prop did not
 * exist (a type error under ts-jest), and ignoring it gives exactly the
 * "without the timezone" results these tests also pin.
 */

const DAY_MS: number = 24 * 60 * 60 * 1000;

const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
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

function spanSeconds(span: BucketSpan): number {
  return (span.end.getTime() - span.start.getTime()) / 1000;
}

function durationsAt(
  coveredSeconds: number,
  uptimePercent: number,
): Array<StatusDuration> {
  const offlineSeconds: number = (coveredSeconds * (100 - uptimePercent)) / 100;

  return [
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
}

function readingFor(span: BucketSpan, uptimePercent: number): DayReading {
  const coveredSeconds: number = spanSeconds(span);

  return {
    dayStart: span.start,
    daySeconds: coveredSeconds,
    coveredSeconds: coveredSeconds,
    statusDurations: durationsAt(coveredSeconds, uptimePercent),
  };
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
 * 22:30 EDT on Monday Sep 21 is 02:30 UTC on Tuesday Sep 22: the New York
 * visitor's calendar and UTC's disagree on the date. The window is the status
 * page's - "now" back five days - so it touches six UTC days.
 */
describe("DayUptimeGraph in New York - evening, when New York is still on the previous date", () => {
  const NOW: Date = new Date("2026-09-22T02:30:00.000Z");
  const START: Date = new Date("2026-09-17T02:30:00.000Z");
  const SPANS: Array<BucketSpan> = utcBucketSpans(START, NOW);
  const READINGS: Array<DayReading> = SPANS.map(
    (span: BucketSpan, index: number) => {
      return readingFor(span, PERCENTS[index] as number);
    },
  );

  const UTC_DAY_LABELS: Array<string> = [
    "Sep 17, 2026",
    "Sep 18, 2026",
    "Sep 19, 2026",
    "Sep 20, 2026",
    "Sep 21, 2026",
    "Sep 22, 2026",
  ];

  beforeEach(() => {
    pinNow(NOW);
  });

  test("the fixture is the page's window: five days back from now, six UTC buckets", () => {
    expect(OneUptimeDate.getSomeDaysAgoFromDate(NOW, 5).toISOString()).toBe(
      START.toISOString(),
    );
    expect(SPANS).toHaveLength(6);
    expect(SPANS[0]?.start.toISOString()).toBe("2026-09-17T02:30:00.000Z");
    expect(SPANS[0]?.end.toISOString()).toBe("2026-09-18T00:00:00.000Z");
    expect(SPANS[5]?.start.toISOString()).toBe("2026-09-22T00:00:00.000Z");
    expect(SPANS[5]?.end.toISOString()).toBe(NOW.toISOString());
  });

  test("drawn on UTC days, there is one bar per bucket", () => {
    renderStrip({
      startDate: START,
      endDate: NOW,
      dayReadings: READINGS,
      timezone: "UTC",
    });

    expect(getBars()).toHaveLength(SPANS.length);
    expect(screen.getByTestId("day-uptime-graph")).toHaveAttribute(
      "aria-label",
      "Uptime history for the last 6 days",
    );
  });

  test("bar i is painted from bucket i and named with that bucket's UTC date", () => {
    renderStrip({
      startDate: START,
      endDate: NOW,
      dayReadings: READINGS,
      timezone: "UTC",
    });

    expect(getLabels()).toEqual(
      UTC_DAY_LABELS.map((label: string, index: number) => {
        return `${label} (UTC): ${PERCENTS[index]}% uptime`;
      }),
    );
  });

  test("the last bar is UTC's today and carries today's reading, although New York is still on Sep 21", () => {
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

  test("opening a bar hands back the UTC midnight it stands for, with that bucket's reading", () => {
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
      const date: Date = call?.[0] as Date;
      const summary: UptimeBarDaySummary = call?.[2] as UptimeBarDaySummary;

      expect(date.toISOString()).toBe(`2026-09-${17 + index}T00:00:00.000Z`);
      expect(summary.date.toISOString()).toBe(date.toISOString());
      expect(summary.uptimePercent).toBeCloseTo(PERCENTS[index] as number, 6);
      expect(summary.statusDurations).toEqual(READINGS[index]?.statusDurations);
    });
  });

  test("the tooltip names the bar's UTC date and says it is UTC", async () => {
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
   * The pre-fix strip, documented. Drawn on New York days, each UTC bucket
   * starts at 20:00 the previous New York evening, so the bar labelled
   * "Sep 17" is painted from the Sep 18 UTC bucket (91%), and so on: every
   * bar shows the next day's reading.
   */
  test("without the timezone, the same readings land one day off: each bar shows the next UTC day", () => {
    renderStrip({
      startDate: START,
      endDate: NOW,
      dayReadings: READINGS,
    });

    expect(getLabels()).toEqual([
      "Sep 16, 2026: 90% uptime",
      "Sep 17, 2026: 91% uptime",
      "Sep 18, 2026: 92% uptime",
      "Sep 19, 2026: 93% uptime",
      "Sep 20, 2026: 94% uptime",
      "Sep 21, 2026: 95% uptime",
    ]);
  });
});

/*
 * 11:00 EDT on Tuesday Sep 22 is 15:00 UTC the same day: the dates agree, and
 * this is when the pre-fix strip lost today's reading altogether. Today's UTC
 * bucket starts at 00:00 UTC, which is 20:00 on Sep 21 in New York, so it
 * was matched to yesterday's bar and today's bar had nothing.
 */
describe("DayUptimeGraph in New York - daytime, when the dates agree", () => {
  const NOW: Date = new Date("2026-09-22T15:00:00.000Z");
  const START: Date = new Date("2026-09-17T15:00:00.000Z");
  const SPANS: Array<BucketSpan> = utcBucketSpans(START, NOW);
  const READINGS: Array<DayReading> = SPANS.map(
    (span: BucketSpan, index: number) => {
      return readingFor(span, PERCENTS[index] as number);
    },
  );

  beforeEach(() => {
    pinNow(NOW);
  });

  test("drawn on UTC days, every bucket has its own bar and today's bar has today's reading", () => {
    renderStrip({
      startDate: START,
      endDate: NOW,
      dayReadings: READINGS,
      timezone: "UTC",
    });

    expect(SPANS).toHaveLength(6);
    expect(getLabels()).toEqual([
      "Sep 17, 2026 (UTC): 90% uptime",
      "Sep 18, 2026 (UTC): 91% uptime",
      "Sep 19, 2026 (UTC): 92% uptime",
      "Sep 20, 2026 (UTC): 93% uptime",
      "Sep 21, 2026 (UTC): 94% uptime",
      "Sep 22, 2026 (UTC): 95% uptime",
    ]);
  });

  /*
   * The pre-fix strip, documented: bar 0 holds two buckets' starts and keeps
   * the first, the Sep 18 bucket (91%) is drawn on no bar at all, every later
   * bar shows the next day's reading, and today has no data.
   */
  test("without the timezone, today's bar has no reading and one bucket is on no bar at all", () => {
    renderStrip({
      startDate: START,
      endDate: NOW,
      dayReadings: READINGS,
    });

    const labels: Array<string | null> = getLabels();

    expect(labels).toEqual([
      "Sep 17, 2026: 90% uptime",
      "Sep 18, 2026: 92% uptime",
      "Sep 19, 2026: 93% uptime",
      "Sep 20, 2026: 94% uptime",
      "Sep 21, 2026: 95% uptime",
      "Sep 22, 2026: no data",
    ]);

    for (const label of labels) {
      expect(label).not.toContain("91% uptime");
    }
  });

  /*
   * status.chainflip.io's today, from New York: up all day, no events (the
   * pre-fix sort lost the open row), and a UTC reading that says Operational.
   * The pre-fix strip could not find that reading for today's bar and drew
   * it as a day with no data; drawn on UTC days it is green at 100%.
   */
  test("status.chainflip.io's today: an Operational UTC reading paints today green at 100%, where the local strip found none", () => {
    const readings: Array<DayReading> = SPANS.map(
      (span: BucketSpan, index: number) => {
        return readingFor(span, index === SPANS.length - 1 ? 100 : 99);
      },
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

    for (const bar of getBars()) {
      expect(bar).toHaveStyle({ backgroundColor: CF_RULE_GREEN.toString() });
    }

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
    expect(localToday.getAttribute("aria-label")).toBe("Sep 22, 2026: no data");
  });
});

/*
 * The status page's own wiring: the buckets come from the aggregate, the zone
 * from UptimeDailyAggregateUtil.getTimezone(aggregate), and MonitorUptimeGraph
 * hands that zone to the strip as uptimeTimezone. An aggregate from a server
 * that predates the field carries no zone, which means UTC - the zone the
 * server has always cut in.
 */
describe("MonitorUptimeGraph in New York - the status page's UTC buckets", () => {
  const NOW: Date = new Date("2026-09-22T15:00:00.000Z");
  const START: Date = new Date("2026-09-17T15:00:00.000Z");

  function makeStatus(isDown: boolean): MonitorStatus {
    const status: MonitorStatus = new MonitorStatus();
    status._id = isDown
      ? OFFLINE_STATUS_ID.toString()
      : OPERATIONAL_STATUS_ID.toString();
    status.name = isDown ? "Offline" : "Operational";
    status.color = isDown ? OFFLINE_COLOR : OPERATIONAL_COLOR;
    status.priority = isDown ? 3 : 1;
    return status;
  }

  function bucketsFor(
    spans: Array<BucketSpan>,
    up: MonitorStatus,
    down: MonitorStatus,
  ): Array<UptimeDayBucket> {
    return spans.map((span: BucketSpan, index: number): UptimeDayBucket => {
      const coveredSeconds: number = spanSeconds(span);
      const offlineSeconds: number =
        (coveredSeconds * (100 - (PERCENTS[index] as number))) / 100;

      return {
        bucketStart: span.start,
        bucketEnd: span.end,
        daySeconds: coveredSeconds,
        coveredSeconds: coveredSeconds,
        statusDurations: [
          {
            monitorStatusId: up.id as ObjectID,
            seconds: coveredSeconds - offlineSeconds,
          },
          { monitorStatusId: down.id as ObjectID, seconds: offlineSeconds },
        ],
      };
    });
  }

  beforeEach(() => {
    pinNow(NOW);
  });

  test("the aggregate's zone reaches the strip, so its bars are the buckets' UTC days", () => {
    const up: MonitorStatus = makeStatus(false);
    const down: MonitorStatus = makeStatus(true);
    const buckets: Array<UptimeDayBucket> = bucketsFor(
      utcBucketSpans(START, NOW),
      up,
      down,
    );

    const aggregate: UptimeDailyAggregate = {
      monitors: [{ monitorId: new ObjectID("monitor-lp"), buckets: buckets }],
      isComplete: true,
      completeFrom: null,
    };

    render(
      <MonitorUptimeGraph
        startDate={START}
        endDate={NOW}
        items={[]}
        uptimeBuckets={buckets}
        uptimeTimezone={UptimeDailyAggregateUtil.getTimezone(aggregate)}
        monitorStatuses={[up, down]}
        downtimeMonitorStatuses={[down]}
        defaultBarColor={CF_DEFAULT_GREY}
      />,
    );

    expect(getLabels()).toEqual([
      "Sep 17, 2026 (UTC): 90% uptime",
      "Sep 18, 2026 (UTC): 91% uptime",
      "Sep 19, 2026 (UTC): 92% uptime",
      "Sep 20, 2026 (UTC): 93% uptime",
      "Sep 21, 2026 (UTC): 94% uptime",
      "Sep 22, 2026 (UTC): 95% uptime",
    ]);

    // Today's bar is painted from today's bucket: Offline is its worst status.
    expect(getBars()[5]).toHaveStyle({
      backgroundColor: OFFLINE_COLOR.toString(),
    });
  });

  test("without uptimeTimezone the graph draws local days exactly as before, and today's UTC bucket misses today's bar", () => {
    const up: MonitorStatus = makeStatus(false);
    const down: MonitorStatus = makeStatus(true);

    render(
      <MonitorUptimeGraph
        startDate={START}
        endDate={NOW}
        items={[]}
        uptimeBuckets={bucketsFor(utcBucketSpans(START, NOW), up, down)}
        monitorStatuses={[up, down]}
        downtimeMonitorStatuses={[down]}
        defaultBarColor={CF_DEFAULT_GREY}
      />,
    );

    const labels: Array<string | null> = getLabels();

    expect(labels).toHaveLength(6);
    expect(labels[5]).toBe("Sep 22, 2026: no data");
    expect(getBars()[5]).toHaveStyle({
      backgroundColor: NO_DATA_BAR_COLOR.toString(),
    });
  });
});

describe("Day labels in New York", () => {
  const NOW: Date = new Date("2026-09-22T15:00:00.000Z");
  const START: Date = new Date("2026-09-17T15:00:00.000Z");
  const READINGS: Array<DayReading> = utcBucketSpans(START, NOW).map(
    (span: BucketSpan, index: number) => {
      return readingFor(span, PERCENTS[index] as number);
    },
  );

  interface StripLook {
    labels: Array<string | null>;
    colors: Array<string>;
  }

  function readStrip(): StripLook {
    return {
      labels: getLabels(),
      colors: getBars().map((bar: HTMLElement) => {
        return bar.style.backgroundColor;
      }),
    };
  }

  beforeEach(() => {
    pinNow(NOW);
  });

  test("a strip drawn in the visitor's own zone reads exactly like the default, with no zone on the label", () => {
    renderStrip({ startDate: START, endDate: NOW, dayReadings: READINGS });

    const byDefault: StripLook = readStrip();

    cleanup();

    renderStrip({
      startDate: START,
      endDate: NOW,
      dayReadings: READINGS,
      timezone: "America/New_York",
    });

    const inOwnZone: StripLook = readStrip();

    expect(inOwnZone).toEqual(byDefault);

    for (const label of inOwnZone.labels) {
      expect(label).not.toContain("(");
    }
  });

  test.each(["Not/A_Zone", "", "   "])(
    "an unusable zone %p falls back to the default strip",
    (timezone: string) => {
      renderStrip({ startDate: START, endDate: NOW, dayReadings: READINGS });

      const byDefault: StripLook = readStrip();

      cleanup();

      renderStrip({
        startDate: START,
        endDate: NOW,
        dayReadings: READINGS,
        timezone: timezone,
      });

      expect(readStrip()).toEqual(byDefault);
    },
  );

  test("the tooltip dates a UTC day as UTC, and without a zone as the visitor's own day", () => {
    const utcMidnight: Date = new Date("2026-09-22T00:00:00.000Z");

    render(
      <UptimeBarTooltip
        date={utcMidnight}
        timezone="UTC"
        uptimePercent={100}
        hasEvents={true}
        statusDurations={[]}
        incidents={[]}
      />,
    );

    expect(screen.getByText("Sep 22, 2026 (UTC)")).toBeInTheDocument();

    cleanup();

    // Omitted: exactly the old local label - 20:00 on Sep 21 in New York.
    render(
      <UptimeBarTooltip
        date={utcMidnight}
        uptimePercent={100}
        hasEvents={true}
        statusDurations={[]}
        incidents={[]}
      />,
    );

    expect(screen.getByText("Sep 21, 2026")).toBeInTheDocument();
    expect(
      screen.getByText(
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          utcMidnight,
          true,
        ),
      ),
    ).toBeInTheDocument();
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
    expect(screen.queryByText("Sep 21, 2026")).not.toBeInTheDocument();
  });
});
