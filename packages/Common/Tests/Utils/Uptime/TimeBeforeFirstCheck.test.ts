import TimeBeforeFirstCheck from "../../../Utils/Uptime/TimeBeforeFirstCheck";
import UptimeUtil, {
  MonitoringOffSpan,
  UptimeWindow,
} from "../../../Utils/Uptime/UptimeUtil";
import MonitorEvent from "../../../Utils/Uptime/MonitorEvent";
import MonitorFirstCheck, {
  MeasuredFrom,
} from "../../../Utils/Monitor/MonitorFirstCheck";
import { Blue, Gray500, Green, Red, Yellow } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE TIME BEFORE A MONITOR'S FIRST CHECK, IN ITS ROWS (issue #9031).
 *
 * Every monitor is created in the operational status, and nothing stands
 * behind it until something has measured the monitor. The status pages cut
 * that time out of uptime in SQL (issue #8960); TimeBeforeFirstCheck cuts
 * it out of the rows an SLO measures, by the same rule, marking it as time
 * with monitoring off so the SLO math leaves it out of both the good time
 * and the total:
 *
 *   - a period of a status a monitor starts in, before the first check,
 *     starts at the first check - all of it while nothing has checked it;
 *   - a status something else recorded, and time with monitoring off, count
 *     as they are;
 *   - a monitor measured from the start, or checked from the start of its
 *     rows, gets its very rows back.
 *
 * The drawn timelines at the end hold the rows it returns to a reference
 * written apart from it: the events the rows make (UptimeUtil, which every
 * SLO figure is measured from) cut at the first check one by one, as the
 * status pages' reference cuts them
 * (MonitorStatusTimelineMonitoringOffPostgres), and the time with
 * monitoring off they mark - on timelines with open rows in the middle,
 * overlapping, zero-length and inverted rows too.
 */

const NOW: Date = new Date("2026-11-16T12:00:00.000Z");

const DAY_SECONDS: number = 86400;
const DAY_MS: number = DAY_SECONDS * 1000;
const HOUR_MS: number = 3600 * 1000;

const MONITOR: ObjectID = new ObjectID("90310000-0000-4000-8000-000000000001");
const OTHER_MONITOR: ObjectID = new ObjectID(
  "90310000-0000-4000-8000-000000000002",
);

function makeStatus(data: {
  id: string;
  name: string;
  priority: number;
  color: Color;
  isOperationalState?: boolean | undefined;
  isOfflineState?: boolean | undefined;
}): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status.id = new ObjectID(data.id);
  status.name = data.name;
  status.priority = data.priority;
  status.color = data.color;

  if (data.isOperationalState !== undefined) {
    status.isOperationalState = data.isOperationalState;
  }

  if (data.isOfflineState !== undefined) {
    status.isOfflineState = data.isOfflineState;
  }

  return status;
}

const OPERATIONAL: MonitorStatus = makeStatus({
  id: "90311000-0000-4000-8000-000000000001",
  name: "Operational",
  priority: 1,
  color: Green,
  isOperationalState: true,
  isOfflineState: false,
});

const DEGRADED: MonitorStatus = makeStatus({
  id: "90311000-0000-4000-8000-000000000002",
  name: "Degraded",
  priority: 2,
  color: Yellow,
  isOperationalState: false,
  isOfflineState: false,
});

const OFFLINE: MonitorStatus = makeStatus({
  id: "90311000-0000-4000-8000-000000000003",
  name: "Offline",
  priority: 3,
  color: Red,
  isOperationalState: false,
  isOfflineState: true,
});

// Flagged both ways: not a status a monitor starts in.
const OPERATIONAL_AND_OFFLINE: MonitorStatus = makeStatus({
  id: "90311000-0000-4000-8000-000000000004",
  name: "Partly operational",
  priority: 4,
  color: Blue,
  isOperationalState: true,
  isOfflineState: true,
});

// Read without its flags: counts as it is.
const UNFLAGGED: MonitorStatus = makeStatus({
  id: "90311000-0000-4000-8000-000000000005",
  name: "Unflagged",
  priority: 5,
  color: Gray500,
});

const EVERY_STATUS: Array<MonitorStatus> = [
  OPERATIONAL,
  DEGRADED,
  OFFLINE,
  OPERATIONAL_AND_OFFLINE,
  UNFLAGGED,
];

function statusById(statusId: string): MonitorStatus {
  return EVERY_STATUS.find((status: MonitorStatus): boolean => {
    return status.id!.toString() === statusId;
  })!;
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

const LAST_30_DAYS: UptimeWindow = { startDate: daysAgo(30), endDate: NOW };

function row(data: {
  status: MonitorStatus;
  from: number;
  to?: number | undefined;
  off?: boolean | undefined;
  monitorId?: ObjectID | undefined;
}): MonitorStatusTimeline {
  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
  timeline.monitorId = data.monitorId || MONITOR;
  timeline.monitorStatusId = data.status.id!;
  timeline.monitorStatus = data.status;
  timeline.startsAt = daysAgo(data.from);

  if (data.to !== undefined) {
    timeline.endsAt = daysAgo(data.to);
  }

  if (data.off !== undefined) {
    timeline.isMonitoringOff = data.off;
  }

  return timeline;
}

function cut(
  timelines: Array<MonitorStatusTimeline>,
  measuredFrom: MeasuredFrom,
): Array<MonitorStatusTimeline> {
  return TimeBeforeFirstCheck.markNotMonitored({
    monitorId: MONITOR,
    timelines: timelines,
    measuredFrom: measuredFrom,
  });
}

// Each event as [status name, days ago it started, days ago it ended].
function eventsInDays(
  timelines: Array<MonitorStatusTimeline>,
  window: UptimeWindow = LAST_30_DAYS,
  monitorId: ObjectID = MONITOR,
): Array<[string, number, number]> {
  return UptimeUtil.getMonitorEventsForId(monitorId, timelines, window).map(
    (event: MonitorEvent): [string, number, number] => {
      return [
        event.label,
        (NOW.getTime() - new Date(event.startDate).getTime()) / DAY_MS,
        (NOW.getTime() - new Date(event.endDate).getTime()) / DAY_MS,
      ];
    },
  );
}

// Days of the window in which the monitor was not monitored.
function notMonitoredDays(
  timelines: Array<MonitorStatusTimeline>,
  window: UptimeWindow = LAST_30_DAYS,
): number {
  return (
    UptimeUtil.getNotMonitoredSeconds({
      items: timelines,
      startDate: window.startDate,
      endDate: window.endDate,
    }) / DAY_SECONDS
  );
}

describe("TimeBeforeFirstCheck.markNotMonitored", () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  describe("a monitor whose rows hold no time before its first check gets its very rows back", () => {
    test("one measured from the start: a manual monitor, or any before the upgrade has put its history right", () => {
      const timelines: Array<MonitorStatusTimeline> = [
        row({ status: OPERATIONAL, from: 40, to: 10 }),
        row({ status: OFFLINE, from: 10, to: 9 }),
        row({ status: OPERATIONAL, from: 9 }),
      ];

      expect(cut(timelines, undefined)).toBe(timelines);
    });

    test("one checked when it was created, before its first row: every monitor measured before the upgrade", () => {
      const timelines: Array<MonitorStatusTimeline> = [
        row({ status: OPERATIONAL, from: 40, to: 10 }),
        row({ status: OFFLINE, from: 10, to: 9 }),
        row({ status: OPERATIONAL, from: 9 }),
      ];

      expect(cut(timelines, daysAgo(40.5))).toBe(timelines);
      // At the very instant its first row starts: nothing starts before it.
      expect(cut(timelines, daysAgo(40))).toBe(timelines);
    });

    test("one whose only time before its first check is a status something else recorded", () => {
      const timelines: Array<MonitorStatusTimeline> = [
        row({ status: OFFLINE, from: 40, to: 10 }),
        row({ status: OPERATIONAL, from: 10 }),
      ];

      expect(cut(timelines, daysAgo(10))).toBe(timelines);
    });

    test("one with no rows", () => {
      const timelines: Array<MonitorStatusTimeline> = [];

      expect(cut(timelines, null)).toBe(timelines);
    });
  });

  test("a monitor nothing has checked yet: all of its starting status is time not monitored, and it has no event", () => {
    const timelines: Array<MonitorStatusTimeline> = [
      row({ status: OPERATIONAL, from: 40 }),
    ];

    const cutTimelines: Array<MonitorStatusTimeline> = cut(timelines, null);

    expect(cutTimelines).toHaveLength(1);
    expect(cutTimelines[0]!.isMonitoringOff).toBe(true);
    // Still open: it runs on to now, as the row it stands for.
    expect(cutTimelines[0]!.endsAt).toBeUndefined();
    expect(eventsInDays(cutTimelines)).toEqual([]);
    expect(notMonitoredDays(cutTimelines)).toBe(30);

    // Before: thirty days up.
    expect(eventsInDays(timelines)).toEqual([["Operational", 30, 0]]);
    expect(notMonitoredDays(timelines)).toBe(0);
  });

  test("a monitor checked ten days ago is measured from its check: the row it was created with is cut in two there", () => {
    const timelines: Array<MonitorStatusTimeline> = [
      row({ status: OPERATIONAL, from: 40 }),
    ];

    const cutTimelines: Array<MonitorStatusTimeline> = cut(
      timelines,
      daysAgo(10),
    );

    expect(cutTimelines).toHaveLength(2);
    expect(cutTimelines[0]!.isMonitoringOff).toBe(true);
    expect(cutTimelines[0]!.startsAt).toEqual(daysAgo(40));
    expect(cutTimelines[0]!.endsAt).toEqual(daysAgo(10));
    expect(cutTimelines[1]!.isMonitoringOff).toBeUndefined();
    expect(cutTimelines[1]!.startsAt).toEqual(daysAgo(10));
    expect(cutTimelines[1]!.endsAt).toBeUndefined();

    expect(eventsInDays(cutTimelines)).toEqual([["Operational", 10, 0]]);
    expect(notMonitoredDays(cutTimelines)).toBe(20);
  });

  test("a status an incident recorded before the first check counts as it is; the operational time around it does not", () => {
    const timelines: Array<MonitorStatusTimeline> = [
      row({ status: OPERATIONAL, from: 40, to: 20 }),
      row({ status: OFFLINE, from: 20, to: 15 }),
      row({ status: OPERATIONAL, from: 15 }),
    ];

    const cutTimelines: Array<MonitorStatusTimeline> = cut(
      timelines,
      daysAgo(5),
    );

    expect(eventsInDays(cutTimelines)).toEqual([
      ["Offline", 20, 15],
      ["Operational", 5, 0],
    ]);
    // Ten days before the window's twentieth, and ten between the incident and the check.
    expect(notMonitoredDays(cutTimelines)).toBe(20);
  });

  test("a status flagged operational and offline, and one read without its flags, are not statuses a monitor starts in", () => {
    const timelines: Array<MonitorStatusTimeline> = [
      row({ status: OPERATIONAL_AND_OFFLINE, from: 40, to: 20 }),
      row({ status: UNFLAGGED, from: 20, to: 12 }),
      row({ status: DEGRADED, from: 12, to: 8 }),
      row({ status: OPERATIONAL, from: 8 }),
    ];

    expect(eventsInDays(cut(timelines, null))).toEqual([
      ["Partly operational", 30, 20],
      ["Unflagged", 20, 12],
      ["Degraded", 12, 8],
    ]);
  });

  test("time with monitoring off stays as it was, and stays out", () => {
    const timelines: Array<MonitorStatusTimeline> = [
      row({ status: OPERATIONAL, from: 40, to: 25 }),
      row({ status: OPERATIONAL, from: 25, to: 18, off: true }),
      row({ status: OPERATIONAL, from: 18 }),
    ];

    const cutTimelines: Array<MonitorStatusTimeline> = cut(
      timelines,
      daysAgo(12),
    );

    expect(cutTimelines[1]).toBe(timelines[1]);
    expect(eventsInDays(cutTimelines)).toEqual([["Operational", 12, 0]]);
    expect(notMonitoredDays(cutTimelines)).toBe(18);
  });

  test("rows of another monitor that came with the monitor's are left as they are", () => {
    const otherRow: MonitorStatusTimeline = row({
      status: OPERATIONAL,
      from: 40,
      monitorId: OTHER_MONITOR,
    });

    const cutTimelines: Array<MonitorStatusTimeline> = cut(
      [row({ status: OPERATIONAL, from: 40 }), otherRow],
      null,
    );

    expect(cutTimelines).toContain(otherRow);
    expect(otherRow.isMonitoringOff).toBeUndefined();
    expect(eventsInDays(cutTimelines, LAST_30_DAYS, OTHER_MONITOR)).toEqual([
      ["Operational", 30, 0],
    ]);
  });

  test("the rows it is handed are never changed", () => {
    const timelines: Array<MonitorStatusTimeline> = [
      row({ status: OPERATIONAL, from: 40, to: 20 }),
      row({ status: OPERATIONAL, from: 20 }),
    ];

    const before: Array<[number, number | undefined, unknown]> = timelines.map(
      (
        timeline: MonitorStatusTimeline,
      ): [number, number | undefined, unknown] => {
        return [
          timeline.startsAt!.getTime(),
          timeline.endsAt?.getTime(),
          timeline.isMonitoringOff,
        ];
      },
    );

    cut(timelines, daysAgo(30));
    cut(timelines, null);

    expect(
      timelines.map(
        (
          timeline: MonitorStatusTimeline,
        ): [number, number | undefined, unknown] => {
          return [
            timeline.startsAt!.getTime(),
            timeline.endsAt?.getTime(),
            timeline.isMonitoringOff,
          ];
        },
      ),
    ).toEqual(before);
  });

  test("cut twice reads as cut once", () => {
    const timelines: Array<MonitorStatusTimeline> = [
      row({ status: OPERATIONAL, from: 40, to: 20 }),
      row({ status: OFFLINE, from: 20, to: 19 }),
      row({ status: OPERATIONAL, from: 19 }),
    ];

    const once: Array<MonitorStatusTimeline> = cut(timelines, daysAgo(10));
    const twice: Array<MonitorStatusTimeline> = cut(once, daysAgo(10));

    expect(eventsInDays(twice)).toEqual(eventsInDays(once));
    expect(notMonitoredDays(twice)).toBe(notMonitoredDays(once));
  });

  test("an open row before the first check that the next row ends keeps ending there once a later row is cut in two", () => {
    // A corrupt timeline: the first row was never closed.
    const timelines: Array<MonitorStatusTimeline> = [
      row({ status: OFFLINE, from: 40 }),
      row({ status: OPERATIONAL, from: 30 }),
    ];

    const cutTimelines: Array<MonitorStatusTimeline> = cut(
      timelines,
      daysAgo(20),
    );

    expect(
      eventsInDays(cutTimelines, { startDate: daysAgo(45), endDate: NOW }),
    ).toEqual([
      ["Offline", 40, 30],
      ["Operational", 20, 0],
    ]);
  });

  test("a first check after now leaves out all of the starting status, as the statements do", () => {
    const timelines: Array<MonitorStatusTimeline> = [
      row({ status: OPERATIONAL, from: 40 }),
    ];

    const cutTimelines: Array<MonitorStatusTimeline> = cut(
      timelines,
      new Date(NOW.getTime() + HOUR_MS),
    );

    expect(eventsInDays(cutTimelines)).toEqual([]);
  });

  test("a first check that cannot be read counts from the start", () => {
    const timelines: Array<MonitorStatusTimeline> = [
      row({ status: OPERATIONAL, from: 40 }),
    ];

    expect(cut(timelines, new Date(Number.NaN))).toBe(timelines);
  });
});

/*
 * DRAWN TIMELINES, HELD TO A REFERENCE.
 *
 * The reference reads the rows as they came - their events and their time
 * with monitoring off, from UptimeUtil, clipped to the window - and cuts each
 * event of a status a monitor starts in at the first check: what a status
 * page's statements leave out (MonitorStatusTimelineMonitoringOffPostgres
 * cuts its events the same way). The cut rows must make exactly those
 * events, and mark as monitoring off exactly the time the rows marked plus
 * the time cut away, with their first row where it was: every figure an SLO
 * reads comes from these three.
 */
describe("TimeBeforeFirstCheck on drawn timelines", () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  type Interval = [number, number];

  function union(intervals: Array<Interval>): Array<Interval> {
    const merged: Array<Interval> = [];

    for (const interval of [...intervals].sort(
      (a: Interval, b: Interval): number => {
        return a[0] - b[0];
      },
    )) {
      if (!(interval[1] > interval[0])) {
        continue;
      }

      const last: Interval | undefined = merged[merged.length - 1];

      if (last && interval[0] <= last[1]) {
        last[1] = Math.max(last[1], interval[1]);
        continue;
      }

      merged.push([interval[0], interval[1]]);
    }

    return merged;
  }

  function eventTuples(
    timelines: Array<MonitorStatusTimeline>,
    window: UptimeWindow,
  ): Array<[string, number, number]> {
    return UptimeUtil.getMonitorEventsForId(MONITOR, timelines, window)
      .map((event: MonitorEvent): [string, number, number] => {
        return [
          event.eventStatusId.toString(),
          new Date(event.startDate).getTime(),
          new Date(event.endDate).getTime(),
        ];
      })
      .sort(
        (a: [string, number, number], b: [string, number, number]): number => {
          return a[1] - b[1] || a[2] - b[2] || a[0].localeCompare(b[0]);
        },
      );
  }

  function referenceEvents(
    timelines: Array<MonitorStatusTimeline>,
    window: UptimeWindow,
    firstCheckAt: number,
  ): Array<[string, number, number]> {
    const events: Array<[string, number, number]> = [];

    for (const event of eventTuples(timelines, window)) {
      const [statusId, start, end] = event;

      if (
        !MonitorFirstCheck.isStartingStatus(statusById(statusId)) ||
        start >= firstCheckAt
      ) {
        events.push(event);
        continue;
      }

      if (firstCheckAt < end) {
        events.push([statusId, firstCheckAt, end]);
      }
    }

    return events.sort(
      (a: [string, number, number], b: [string, number, number]): number => {
        return a[1] - b[1] || a[2] - b[2] || a[0].localeCompare(b[0]);
      },
    );
  }

  function offIntervals(
    timelines: Array<MonitorStatusTimeline>,
    window: UptimeWindow,
  ): Array<Interval> {
    return UptimeUtil.getMonitoringOffSpans(timelines, window)
      .filter((span: MonitoringOffSpan): boolean => {
        return span.monitorId.toString() === MONITOR.toString();
      })
      .map((span: MonitoringOffSpan): Interval => {
        return [span.startDate.getTime(), span.endDate.getTime()];
      });
  }

  function referenceOffIntervals(
    timelines: Array<MonitorStatusTimeline>,
    window: UptimeWindow,
    firstCheckAt: number,
  ): Array<Interval> {
    const intervals: Array<Interval> = offIntervals(timelines, window);

    for (const [statusId, start, end] of eventTuples(timelines, window)) {
      if (
        MonitorFirstCheck.isStartingStatus(statusById(statusId)) &&
        start < firstCheckAt
      ) {
        intervals.push([start, Math.min(end, firstCheckAt)]);
      }
    }

    return union(intervals);
  }

  function firstRowStart(timelines: Array<MonitorStatusTimeline>): number {
    return Math.min(
      ...timelines
        .filter((timeline: MonitorStatusTimeline): boolean => {
          return timeline.monitorId!.toString() === MONITOR.toString();
        })
        .map((timeline: MonitorStatusTimeline): number => {
          return timeline.startsAt!.getTime();
        }),
    );
  }

  interface DrawnTimeline {
    timelines: Array<MonitorStatusTimeline>;
    instants: Array<number>;
  }

  /*
   * One monitor's rows, back to back from a start in the last 60 days, the
   * last one open - and, now and then, what a corrupt or edited timeline
   * holds: a row left open in the middle, a row that runs past the next
   * one's start, one of no length, one that ends before it starts, two that
   * start together. Some rows mark monitoring off, and a row of another
   * monitor comes along.
   */
  function drawTimeline(random: SeededRandom): DrawnTimeline {
    const timelines: Array<MonitorStatusTimeline> = [];
    const instants: Array<number> = [];
    const rowCount: number = 1 + random(8);
    let start: number = NOW.getTime() - (1 + random(60)) * DAY_MS;

    for (let index: number = 0; index < rowCount; index++) {
      const isLast: boolean = index === rowCount - 1;
      const length: number =
        random(10) === 0 ? 0 : Math.round((random() * 8 + 0.01) * DAY_MS);
      const end: number = Math.min(start + length, NOW.getTime());

      const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
      // Operational most often, as a monitor's timeline is.
      const status: MonitorStatus =
        random(3) === 0
          ? EVERY_STATUS[random(EVERY_STATUS.length)]!
          : OPERATIONAL;
      timeline.monitorId = MONITOR;
      timeline.monitorStatusId = status.id!;
      timeline.monitorStatus = status;
      timeline.startsAt = new Date(start);
      timeline.isMonitoringOff = random(6) === 0;

      const corruption: number = random(14);

      if (!isLast && corruption !== 0) {
        if (corruption === 1) {
          // Runs past the next row's start.
          timeline.endsAt = new Date(end + Math.round(random() * 2 * DAY_MS));
        } else if (corruption === 2) {
          // Ends before it starts.
          timeline.endsAt = new Date(start - Math.round(random() * DAY_MS));
        } else {
          timeline.endsAt = new Date(end);
        }
      }

      timelines.push(timeline);
      instants.push(start, end);

      // Now and then the next row starts with this one.
      start = random(12) === 0 ? start : end;
    }

    if (random(3) === 0) {
      const other: MonitorStatusTimeline = new MonitorStatusTimeline();
      other.monitorId = OTHER_MONITOR;
      other.monitorStatusId = OPERATIONAL.id!;
      other.monitorStatus = OPERATIONAL;
      other.startsAt = new Date(timelines[0]!.startsAt!.getTime() - DAY_MS);
      timelines.push(other);
    }

    return { timelines: timelines, instants: instants };
  }

  // A first check: never, before or on a row's edge, inside, or after now.
  function drawMeasuredFrom(
    random: SeededRandom,
    instants: Array<number>,
  ): MeasuredFrom {
    const choice: number = random(6);

    if (choice === 0) {
      return null;
    }

    if (choice === 1) {
      return new Date(instants[random(instants.length)]!);
    }

    if (choice === 2) {
      return new Date(Math.min(...instants) - random(5) * DAY_MS);
    }

    if (choice === 3) {
      return new Date(NOW.getTime() + HOUR_MS);
    }

    const earliest: number = Math.min(...instants);

    return new Date(
      earliest + Math.round(random() * (NOW.getTime() - earliest)),
    );
  }

  function drawWindow(random: SeededRandom): UptimeWindow {
    const start: number =
      NOW.getTime() - Math.round(random() * 70 * DAY_MS) - HOUR_MS;
    const end: number =
      random(4) === 0
        ? NOW.getTime() + DAY_MS
        : start + Math.round(random() * (NOW.getTime() - start));

    return { startDate: new Date(start), endDate: new Date(end) };
  }

  test("2,000 drawn timelines: the cut rows make the reference's events and time not monitored", () => {
    const random: SeededRandom = seededRandom(9031);
    let cases: number = 0;
    let casesCut: number = 0;

    for (let drawn: number = 0; drawn < 2000; drawn++) {
      const timeline: DrawnTimeline = drawTimeline(random);
      const measuredFrom: MeasuredFrom = drawMeasuredFrom(
        random,
        timeline.instants,
      );
      const firstCheckAt: number =
        measuredFrom === null ? Infinity : measuredFrom!.getTime();

      const cutTimelines: Array<MonitorStatusTimeline> = cut(
        timeline.timelines,
        measuredFrom,
      );

      if (cutTimelines !== timeline.timelines) {
        casesCut++;
      }

      for (let windowIndex: number = 0; windowIndex < 3; windowIndex++) {
        const window: UptimeWindow = drawWindow(random);

        expect(eventTuples(cutTimelines, window)).toEqual(
          referenceEvents(timeline.timelines, window, firstCheckAt),
        );

        expect(union(offIntervals(cutTimelines, window))).toEqual(
          referenceOffIntervals(timeline.timelines, window, firstCheckAt),
        );

        cases++;
      }

      expect(firstRowStart(cutTimelines)).toBe(
        firstRowStart(timeline.timelines),
      );
    }

    expect(cases).toBe(6000);
    // The draws reach both sides: rows cut, and rows handed back as they were.
    expect(casesCut).toBeGreaterThan(600);
    expect(casesCut).toBeLessThan(1900);
  });
});
