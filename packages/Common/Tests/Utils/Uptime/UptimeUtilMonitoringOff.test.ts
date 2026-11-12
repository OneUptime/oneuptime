import UptimeUtil, {
  MonitoringOffSpan,
  UptimeWindow,
} from "../../../Utils/Uptime/UptimeUtil";
import Event from "../../../Utils/Uptime/Event";
import MonitorEvent from "../../../Utils/Uptime/MonitorEvent";
import { Green, Red } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * TIME WITH A MONITOR'S MONITORING OFF IS NO TIME FOR UPTIME (issue #6480).
 *
 * Nothing checks a monitor whose monitoring is turned off, so the status it
 * holds is only what its last check saw before that - "Offline", say, for as
 * long as it stays off. Uptime used to count that time as the status: a
 * monitor left Offline and switched off for a week read a week of downtime,
 * and one left Operational read a week up.
 *
 * Turning monitoring off, or back on, now starts a status event of its own
 * that says so (MonitorStatusTimeline.isMonitoringOff), and UptimeUtil leaves
 * the time from one that marks it off to the next one that does not out of
 * both sides of the sum: it is neither up nor down. A group of monitors - a
 * monitor group, a status page group, an SLO - leaves out only the time none
 * of its monitors was monitored; while one still is, it speaks for them.
 *
 * Every assertion is relative to a pinned "now", as in UptimeUtil.test.ts.
 */

const NOW: Date = new Date("2026-07-19T00:00:00.000Z");

const DAY_SECONDS: number = 86400;
const DAY_MS: number = DAY_SECONDS * 1000;

const MONITOR_A: ObjectID = new ObjectID(
  "6480a000-0000-4000-8000-000000000001",
);
const MONITOR_B: ObjectID = new ObjectID(
  "6480a000-0000-4000-8000-000000000002",
);

function makeStatus(data: {
  id: string;
  name: string;
  priority: number;
}): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status.id = new ObjectID(data.id);
  status.name = data.name;
  status.priority = data.priority;
  status.color = data.name === "Offline" ? Red : Green;
  return status;
}

const OPERATIONAL: MonitorStatus = makeStatus({
  id: "6480b000-0000-4000-8000-000000000001",
  name: "Operational",
  priority: 1,
});
const OFFLINE: MonitorStatus = makeStatus({
  id: "6480b000-0000-4000-8000-000000000002",
  name: "Offline",
  priority: 2,
});

const DOWNTIME: Array<MonitorStatus> = [OFFLINE];

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

const LAST_30_DAYS: UptimeWindow = { startDate: daysAgo(30), endDate: NOW };

/*
 * A status event of a monitor, from `from` days ago to `to` days ago - open
 * (no endsAt) without one - with its monitoring off when `off` says so.
 */
function row(data: {
  status: MonitorStatus;
  from: number;
  to?: number | undefined;
  off?: boolean | undefined;
  monitorId?: ObjectID | undefined;
}): MonitorStatusTimeline {
  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
  timeline.monitorId = data.monitorId || MONITOR_A;
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

// Each event as [status name, days ago it started, days ago it ended].
function spansOf(
  events: Array<MonitorEvent | Event>,
): Array<[string, number, number]> {
  return events.map((event: MonitorEvent | Event): [string, number, number] => {
    return [
      event.label,
      (NOW.getTime() - new Date(event.startDate).getTime()) / DAY_MS,
      (NOW.getTime() - new Date(event.endDate).getTime()) / DAY_MS,
    ];
  });
}

function totals(
  rows: Array<MonitorStatusTimeline>,
  window?: UptimeWindow | undefined,
): { downtimeDays: number; periodDays: number } {
  const result: {
    totalDowntimeInSeconds: number;
    totalSecondsInTimePeriod: number;
  } = UptimeUtil.getTotalDowntimeInSeconds(rows, DOWNTIME, window);

  return {
    downtimeDays: result.totalDowntimeInSeconds / DAY_SECONDS,
    periodDays: result.totalSecondsInTimePeriod / DAY_SECONDS,
  };
}

function uptime(
  rows: Array<MonitorStatusTimeline>,
  window?: UptimeWindow | undefined,
): number {
  return UptimeUtil.calculateUptimePercentage(
    rows,
    UptimePrecision.THREE_DECIMAL,
    DOWNTIME,
    window,
  );
}

describe("UptimeUtil leaves out the time a monitor's monitoring was off", () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  /*
   * The issue: Operational, then Offline for three days, then its monitoring
   * turned off while Offline, a week ago. Over the last 30 days that read
   * ten days of downtime - 66.666% - of which seven nothing checked.
   */
  describe("the issue: a monitor left Offline when its monitoring was turned off", () => {
    const rows: Array<MonitorStatusTimeline> = [
      row({ status: OPERATIONAL, from: 48, to: 10 }),
      row({ status: OFFLINE, from: 10, to: 7 }),
      row({ status: OFFLINE, from: 7, off: true }),
    ];

    test("its uptime over the last 30 days counts the three days it was checked Offline, of the 23 it was checked: 86.956%", () => {
      expect(totals(rows, LAST_30_DAYS)).toEqual({
        downtimeDays: 3,
        periodDays: 23,
      });
      expect(uptime(rows, LAST_30_DAYS)).toBe(86.956);
    });

    test("its events end when monitoring was turned off: nothing after it, up or down", () => {
      expect(
        spansOf(
          UptimeUtil.getMonitorEventsForId(MONITOR_A, rows, LAST_30_DAYS),
        ),
      ).toEqual([
        ["Operational", 30, 10],
        ["Offline", 10, 7],
      ]);
    });

    test("without a window, from its first event to now, less the week it is off", () => {
      expect(totals(rows)).toEqual({ downtimeDays: 3, periodDays: 41 });
    });

    test("the time it is off is its time with monitoring off", () => {
      expect(
        UptimeUtil.getMonitoringOffSpans(rows, LAST_30_DAYS).map(
          (span: MonitoringOffSpan) => {
            return [
              span.monitorId.toString(),
              span.startDate.toISOString(),
              span.endDate.toISOString(),
            ];
          },
        ),
      ).toEqual([
        [MONITOR_A.toString(), daysAgo(7).toISOString(), NOW.toISOString()],
      ]);
      expect(
        UptimeUtil.getNotMonitoredSeconds({
          items: rows,
          startDate: LAST_30_DAYS.startDate,
          endDate: LAST_30_DAYS.endDate,
        }),
      ).toBe(7 * DAY_SECONDS);
    });

    test("left Operational instead, the week does not count as up either", () => {
      const leftUp: Array<MonitorStatusTimeline> = [
        row({ status: OPERATIONAL, from: 48, to: 10 }),
        row({ status: OFFLINE, from: 10, to: 7 }),
        row({ status: OPERATIONAL, from: 7, off: true }),
      ];

      expect(totals(leftUp, LAST_30_DAYS)).toEqual({
        downtimeDays: 3,
        periodDays: 23,
      });
      expect(uptime(leftUp, LAST_30_DAYS)).toBe(86.956);
    });
  });

  describe("turned back on, it counts again from that moment", () => {
    // Off for four days while Offline, back on still Offline for a day, then up.
    const rows: Array<MonitorStatusTimeline> = [
      row({ status: OPERATIONAL, from: 48, to: 18 }),
      row({ status: OFFLINE, from: 18, to: 14, off: true }),
      row({ status: OFFLINE, from: 14, to: 13, off: false }),
      row({ status: OPERATIONAL, from: 13, off: false }),
    ];

    test("the day Offline after it was turned back on counts; the four days off do not", () => {
      expect(totals(rows, LAST_30_DAYS)).toEqual({
        downtimeDays: 1,
        periodDays: 26,
      });
      expect(uptime(rows, LAST_30_DAYS)).toBe(96.153);
    });

    test("its events skip the four days and pick up at the moment it was turned back on", () => {
      expect(
        spansOf(
          UptimeUtil.getMonitorEventsForId(MONITOR_A, rows, LAST_30_DAYS),
        ),
      ).toEqual([
        ["Operational", 30, 18],
        ["Offline", 14, 13],
        ["Operational", 13, 0],
      ]);
    });
  });

  test("an open status event before the switch ends at the switch, and does not run on across the time it is off", () => {
    // The row before the switch never closed: it still ends where the next one starts.
    const rows: Array<MonitorStatusTimeline> = [
      row({ status: OFFLINE, from: 48 }),
      row({ status: OFFLINE, from: 9, off: true }),
    ];

    expect(
      spansOf(UptimeUtil.getMonitorEventsForId(MONITOR_A, rows, LAST_30_DAYS)),
    ).toEqual([["Offline", 30, 9]]);
    expect(totals(rows, LAST_30_DAYS)).toEqual({
      downtimeDays: 21,
      periodDays: 21,
    });
  });

  describe("a window nothing was monitored in", () => {
    // Turned off 40 days ago, and never back on.
    const rows: Array<MonitorStatusTimeline> = [
      row({ status: OPERATIONAL, from: 48, to: 40 }),
      row({ status: OFFLINE, from: 40, off: true }),
    ];

    test("measures no time at all, and so no downtime", () => {
      expect(totals(rows, LAST_30_DAYS)).toEqual({
        downtimeDays: 0,
        periodDays: 0,
      });
    });

    test("has no percentage of monitored time to show, where calculateUptimePercentage reads it as 100%", () => {
      expect(
        UptimeUtil.calculateUptimePercentageOfMonitoredTime(
          rows,
          UptimePrecision.THREE_DECIMAL,
          DOWNTIME,
          LAST_30_DAYS,
        ),
      ).toBeNull();
      expect(uptime(rows, LAST_30_DAYS)).toBe(100);
    });

    test("a monitor with no status events at all still reads 100%, as before", () => {
      expect(
        UptimeUtil.calculateUptimePercentageOfMonitoredTime(
          [],
          UptimePrecision.THREE_DECIMAL,
          DOWNTIME,
          LAST_30_DAYS,
        ),
      ).toBe(100);
    });
  });

  test("calculateUptimePercentageOfMonitoredTime is calculateUptimePercentage whenever some time was monitored", () => {
    const cases: Array<Array<MonitorStatusTimeline>> = [
      [row({ status: OPERATIONAL, from: 60 })],
      [
        row({ status: OPERATIONAL, from: 60, to: 5 }),
        row({ status: OFFLINE, from: 5 }),
      ],
      [
        row({ status: OPERATIONAL, from: 48, to: 10 }),
        row({ status: OFFLINE, from: 10, to: 7 }),
        row({ status: OFFLINE, from: 7, off: true }),
      ],
    ];

    for (const rows of cases) {
      for (const precision of [
        UptimePrecision.NO_DECIMAL,
        UptimePrecision.ONE_DECIMAL,
        UptimePrecision.TWO_DECIMAL,
        UptimePrecision.THREE_DECIMAL,
      ]) {
        expect(
          UptimeUtil.calculateUptimePercentageOfMonitoredTime(
            rows,
            precision,
            DOWNTIME,
            LAST_30_DAYS,
          ),
        ).toBe(
          UptimeUtil.calculateUptimePercentage(
            rows,
            precision,
            DOWNTIME,
            LAST_30_DAYS,
          ),
        );
      }
    }
  });

  /*
   * A pause by an incident declared by hand or by scheduled maintenance is
   * not monitoring turned off: what paused the monitor is what its status
   * shows, and it counts as before. Only a status event that says its
   * monitoring is off is left out - and a row read without the column says
   * nothing (the column is NOT NULL, defaulting to false).
   */
  test("a status event that does not say its monitoring is off counts as it always did", () => {
    const rows: Array<MonitorStatusTimeline> = [
      row({ status: OPERATIONAL, from: 48, to: 10 }),
      row({ status: OFFLINE, from: 10, to: 7, off: false }),
      // Read without the column: monitored.
      row({ status: OFFLINE, from: 7 }),
    ];

    expect(totals(rows, LAST_30_DAYS)).toEqual({
      downtimeDays: 10,
      periodDays: 30,
    });
    expect(uptime(rows, LAST_30_DAYS)).toBe(66.666);
    expect(
      UptimeUtil.getNotMonitoredSeconds({
        items: rows,
        startDate: LAST_30_DAYS.startDate,
        endDate: LAST_30_DAYS.endDate,
      }),
    ).toBe(0);
  });

  test("isMonitoringOff: only an explicit true", () => {
    const unread: MonitorStatusTimeline = row({ status: OFFLINE, from: 1 });
    const on: MonitorStatusTimeline = row({
      status: OFFLINE,
      from: 1,
      off: false,
    });
    const off: MonitorStatusTimeline = row({
      status: OFFLINE,
      from: 1,
      off: true,
    });

    expect(UptimeUtil.isMonitoringOff(unread)).toBe(false);
    expect(UptimeUtil.isMonitoringOff(on)).toBe(false);
    expect(UptimeUtil.isMonitoringOff(off)).toBe(true);
  });

  /*
   * Several monitors - a monitor group's Uptime Graph, a status page group,
   * an SLO - are measured over the time at least one of them was monitored:
   * while one still is, it speaks for them all (issue #6987).
   */
  describe("several monitors", () => {
    test("one turned off while Offline, the other still checked and up: the group is up throughout, 100% of 30 days", () => {
      const rows: Array<MonitorStatusTimeline> = [
        row({ status: OPERATIONAL, from: 60, monitorId: MONITOR_A }),
        row({ status: OPERATIONAL, from: 60, to: 7, monitorId: MONITOR_B }),
        row({ status: OFFLINE, from: 7, off: true, monitorId: MONITOR_B }),
      ];

      expect(totals(rows, LAST_30_DAYS)).toEqual({
        downtimeDays: 0,
        periodDays: 30,
      });
      expect(uptime(rows, LAST_30_DAYS)).toBe(100);
      expect(
        spansOf(UptimeUtil.getNonOverlappingMonitorEvents(rows, LAST_30_DAYS)),
      ).toEqual([["Operational", 30, 0]]);
    });

    test("the member's own Offline day before the switch still counts for the group", () => {
      const rows: Array<MonitorStatusTimeline> = [
        row({ status: OPERATIONAL, from: 60, monitorId: MONITOR_A }),
        row({ status: OPERATIONAL, from: 60, to: 10, monitorId: MONITOR_B }),
        row({ status: OFFLINE, from: 10, to: 9, monitorId: MONITOR_B }),
        row({ status: OPERATIONAL, from: 9, to: 1, monitorId: MONITOR_B }),
        row({ status: OFFLINE, from: 1, off: true, monitorId: MONITOR_B }),
      ];

      expect(totals(rows, LAST_30_DAYS)).toEqual({
        downtimeDays: 1,
        periodDays: 30,
      });
      expect(
        spansOf(
          UptimeUtil.getNonOverlappingMonitorEvents(rows, LAST_30_DAYS, {
            downtimeMonitorStatusIds: [OFFLINE.id!.toString()],
          }),
        ),
      ).toEqual([
        ["Operational", 30, 10],
        ["Offline", 10, 9],
        ["Operational", 9, 0],
      ]);
    });

    test("only the time both were off is left out: three days of overlap", () => {
      const rows: Array<MonitorStatusTimeline> = [
        row({ status: OPERATIONAL, from: 60, to: 10, monitorId: MONITOR_A }),
        row({
          status: OFFLINE,
          from: 10,
          to: 5,
          off: true,
          monitorId: MONITOR_A,
        }),
        row({ status: OPERATIONAL, from: 5, monitorId: MONITOR_A }),
        row({ status: OPERATIONAL, from: 60, to: 8, monitorId: MONITOR_B }),
        row({
          status: OFFLINE,
          from: 8,
          to: 2,
          off: true,
          monitorId: MONITOR_B,
        }),
        row({ status: OPERATIONAL, from: 2, monitorId: MONITOR_B }),
      ];

      expect(
        UptimeUtil.getNotMonitoredSeconds({
          items: rows,
          startDate: LAST_30_DAYS.startDate,
          endDate: LAST_30_DAYS.endDate,
        }),
      ).toBe(3 * DAY_SECONDS);
      expect(totals(rows, LAST_30_DAYS)).toEqual({
        downtimeDays: 0,
        periodDays: 27,
      });
      expect(
        UptimeUtil.getMonitoringOffSpans(rows, LAST_30_DAYS).map(
          (span: MonitoringOffSpan) => {
            return [
              span.monitorId.toString(),
              (NOW.getTime() - span.startDate.getTime()) / DAY_MS,
              (NOW.getTime() - span.endDate.getTime()) / DAY_MS,
            ];
          },
        ),
      ).toEqual([
        [MONITOR_A.toString(), 10, 5],
        [MONITOR_B.toString(), 8, 2],
      ]);
    });

    test("a monitor added after the other was turned off: the time between is no one's", () => {
      const rows: Array<MonitorStatusTimeline> = [
        row({ status: OPERATIONAL, from: 60, to: 10, monitorId: MONITOR_A }),
        row({ status: OPERATIONAL, from: 10, off: true, monitorId: MONITOR_A }),
        // B's first status event, four days after A was turned off.
        row({ status: OFFLINE, from: 6, to: 5, monitorId: MONITOR_B }),
        row({ status: OPERATIONAL, from: 5, monitorId: MONITOR_B }),
      ];

      expect(
        UptimeUtil.getNotMonitoredSeconds({
          items: rows,
          startDate: LAST_30_DAYS.startDate,
          endDate: LAST_30_DAYS.endDate,
        }),
      ).toBe(4 * DAY_SECONDS);
      expect(totals(rows, LAST_30_DAYS)).toEqual({
        downtimeDays: 1,
        periodDays: 26,
      });
    });

    test("every member off for the whole window: no time, and no percentage of it", () => {
      const rows: Array<MonitorStatusTimeline> = [
        row({ status: OFFLINE, from: 60, off: true, monitorId: MONITOR_A }),
        row({ status: OPERATIONAL, from: 45, off: true, monitorId: MONITOR_B }),
      ];

      expect(totals(rows, LAST_30_DAYS)).toEqual({
        downtimeDays: 0,
        periodDays: 0,
      });
      expect(
        UptimeUtil.calculateUptimePercentageOfMonitoredTime(
          rows,
          UptimePrecision.TWO_DECIMAL,
          DOWNTIME,
          LAST_30_DAYS,
        ),
      ).toBeNull();
    });
  });

  describe("getNotMonitoredSeconds", () => {
    test("zero when no status event marks monitoring off, even for time before a monitor's first one", () => {
      const rows: Array<MonitorStatusTimeline> = [
        row({ status: OPERATIONAL, from: 5, monitorId: MONITOR_A }),
        row({ status: OFFLINE, from: 3, monitorId: MONITOR_B }),
      ];

      expect(
        UptimeUtil.getNotMonitoredSeconds({
          items: rows,
          startDate: LAST_30_DAYS.startDate,
          endDate: LAST_30_DAYS.endDate,
        }),
      ).toBe(0);
    });

    test("zero for an empty or backwards period", () => {
      const rows: Array<MonitorStatusTimeline> = [
        row({ status: OFFLINE, from: 10, off: true }),
      ];

      expect(
        UptimeUtil.getNotMonitoredSeconds({
          items: rows,
          startDate: daysAgo(2),
          endDate: daysAgo(2),
        }),
      ).toBe(0);
      expect(
        UptimeUtil.getNotMonitoredSeconds({
          items: rows,
          startDate: daysAgo(1),
          endDate: daysAgo(3),
        }),
      ).toBe(0);
    });

    test("only the part of the time off inside the period", () => {
      const rows: Array<MonitorStatusTimeline> = [
        row({ status: OPERATIONAL, from: 60, to: 40 }),
        row({ status: OFFLINE, from: 40, to: 20, off: true }),
        row({ status: OPERATIONAL, from: 20 }),
      ];

      expect(
        UptimeUtil.getNotMonitoredSeconds({
          items: rows,
          startDate: LAST_30_DAYS.startDate,
          endDate: LAST_30_DAYS.endDate,
        }),
      ).toBe(10 * DAY_SECONDS);
    });

    test("back-to-back status events with monitoring off are one stretch, counted once", () => {
      const rows: Array<MonitorStatusTimeline> = [
        row({ status: OPERATIONAL, from: 60, to: 12 }),
        // A status change while off - an incident resolved by hand - stays off.
        row({ status: OFFLINE, from: 12, to: 8, off: true }),
        row({ status: OPERATIONAL, from: 8, to: 4, off: true }),
        row({ status: OPERATIONAL, from: 4 }),
      ];

      expect(
        UptimeUtil.getNotMonitoredSeconds({
          items: rows,
          startDate: LAST_30_DAYS.startDate,
          endDate: LAST_30_DAYS.endDate,
        }),
      ).toBe(8 * DAY_SECONDS);
      expect(totals(rows, LAST_30_DAYS)).toEqual({
        downtimeDays: 0,
        periodDays: 22,
      });
    });
  });

  test("getMonitoringOffSpans without a window runs an open one to now, and to the next event's start when there is one", () => {
    const rows: Array<MonitorStatusTimeline> = [
      row({ status: OPERATIONAL, from: 60, to: 50 }),
      // Open, but the next event ends it: an orphan a racing writer left.
      row({ status: OFFLINE, from: 50, off: true }),
      row({ status: OPERATIONAL, from: 45, to: 3 }),
      row({ status: OFFLINE, from: 3, off: true }),
    ];

    expect(
      UptimeUtil.getMonitoringOffSpans(rows).map((span: MonitoringOffSpan) => {
        return [
          (NOW.getTime() - span.startDate.getTime()) / DAY_MS,
          (NOW.getTime() - span.endDate.getTime()) / DAY_MS,
        ];
      }),
    ).toEqual([
      [50, 45],
      [3, 0],
    ]);
  });
});
