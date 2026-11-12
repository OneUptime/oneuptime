import SloUtil, {
  ErrorBudgetResult,
  MonitorTimelineSet,
  TimeSliResult,
} from "../../../Utils/Slo/SloUtil";
import { UptimeWindow } from "../../../Utils/Uptime/UptimeUtil";
import { Green, Red } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import SloMultiMonitorMode from "../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN SLO LEAVES OUT THE TIME A MONITOR'S MONITORING WAS OFF (issue #6480).
 *
 * Nothing checks a monitor whose monitoring is turned off, so the status it
 * holds is what its last check saw before that. An SLO used to count that
 * time as the status: a monitor switched off while Offline spent the error
 * budget for as long as it stayed off, and one switched off while up earned
 * good time nothing measured. That time is now in neither the numerator nor
 * the denominator of the SLI (MonitorStatusTimeline.isMonitoringOff):
 *
 *   - AnyDown (the service is down while any monitor is) leaves out the time
 *     NONE of its monitors was monitored; while one still is, it speaks for
 *     the service.
 *   - MonitorSecondsAverage leaves out each monitor's own time off.
 *
 * Every assertion is relative to a pinned "now", as in SloUtil.test.ts.
 */

const NOW: Date = new Date("2026-07-19T00:00:00.000Z");

const DAY_SECONDS: number = 86400;
const DAY_MS: number = DAY_SECONDS * 1000;

const MONITOR_A: ObjectID = new ObjectID(
  "6480c000-0000-4000-8000-000000000001",
);
const MONITOR_B: ObjectID = new ObjectID(
  "6480c000-0000-4000-8000-000000000002",
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
  id: "6480d000-0000-4000-8000-000000000001",
  name: "Operational",
  priority: 1,
});
const OFFLINE: MonitorStatus = makeStatus({
  id: "6480d000-0000-4000-8000-000000000002",
  name: "Offline",
  priority: 2,
});

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

const LAST_30_DAYS: UptimeWindow = { startDate: daysAgo(30), endDate: NOW };

function row(data: {
  monitorId: ObjectID;
  status: MonitorStatus;
  from: number;
  to?: number | undefined;
  off?: boolean | undefined;
}): MonitorStatusTimeline {
  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
  timeline.monitorId = data.monitorId;
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

// Operational, Offline for three days, then turned off while Offline a week ago.
function turnedOffWhileOffline(monitorId: ObjectID): MonitorTimelineSet {
  return {
    monitorId: monitorId,
    timelines: [
      row({ monitorId, status: OPERATIONAL, from: 48, to: 10 }),
      row({ monitorId, status: OFFLINE, from: 10, to: 7 }),
      row({ monitorId, status: OFFLINE, from: 7, off: true }),
    ],
  };
}

function upThroughout(monitorId: ObjectID): MonitorTimelineSet {
  return {
    monitorId: monitorId,
    timelines: [row({ monitorId, status: OPERATIONAL, from: 60 })],
  };
}

function sli(
  perMonitorTimelines: Array<MonitorTimelineSet>,
  mode: SloMultiMonitorMode,
  window: UptimeWindow = LAST_30_DAYS,
): { badDays: number; totalDays: number; sliPercentage: number } {
  const result: TimeSliResult = SloUtil.computeTimeSli({
    perMonitorTimelines,
    downtimeStatuses: [OFFLINE],
    window,
    mode,
  });

  return {
    badDays: result.badSeconds / DAY_SECONDS,
    totalDays: result.totalSeconds / DAY_SECONDS,
    sliPercentage: result.sliPercentage,
  };
}

describe("SloUtil leaves out the time a monitor's monitoring was off", () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  describe("one monitor, turned off while Offline a week ago", () => {
    test.each([
      SloMultiMonitorMode.AnyDown,
      SloMultiMonitorMode.MonitorSecondsAverage,
    ])(
      "%s: three bad days of the 23 it was checked, not ten of 30",
      (mode: SloMultiMonitorMode) => {
        const result: {
          badDays: number;
          totalDays: number;
          sliPercentage: number;
        } = sli([turnedOffWhileOffline(MONITOR_A)], mode);

        expect(result.badDays).toBe(3);
        expect(result.totalDays).toBe(23);
        expect(result.sliPercentage).toBeCloseTo((20 / 23) * 100, 9);
      },
    );

    test("the week off spends none of a 99.9% target's error budget", () => {
      const result: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines: [turnedOffWhileOffline(MONITOR_A)],
        downtimeStatuses: [OFFLINE],
        window: LAST_30_DAYS,
        mode: SloMultiMonitorMode.AnyDown,
      });

      const budget: ErrorBudgetResult = SloUtil.getErrorBudget({
        badSeconds: result.badSeconds,
        totalSeconds: result.totalSeconds,
        targetPercentage: 99.9,
      });

      expect(budget.budgetConsumedSeconds).toBe(3 * DAY_SECONDS);
      expect(budget.budgetTotalSeconds).toBeCloseTo(
        0.001 * 23 * DAY_SECONDS,
        6,
      );
    });

    test("a burn rate window that lies wholly in the time off reads no data, and so no burn", () => {
      const lastDay: UptimeWindow = { startDate: daysAgo(1), endDate: NOW };

      const result: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines: [turnedOffWhileOffline(MONITOR_A)],
        downtimeStatuses: [OFFLINE],
        window: lastDay,
        mode: SloMultiMonitorMode.AnyDown,
      });

      expect(result).toEqual({
        badSeconds: 0,
        totalSeconds: 0,
        sliPercentage: 100,
      });
      expect(
        SloUtil.computeBurnRate({
          badSeconds: result.badSeconds,
          totalSeconds: result.totalSeconds,
          targetPercentage: 99.9,
        }),
      ).toBe(0);
    });
  });

  describe("two monitors, one turned off while Offline, the other up throughout", () => {
    const monitors: Array<MonitorTimelineSet> = [
      upThroughout(MONITOR_A),
      turnedOffWhileOffline(MONITOR_B),
    ];

    test("AnyDown: the monitor still checked speaks for the service - 30 days measured, the three checked Offline days bad", () => {
      const result: {
        badDays: number;
        totalDays: number;
        sliPercentage: number;
      } = sli(monitors, SloMultiMonitorMode.AnyDown);

      expect(result.badDays).toBe(3);
      expect(result.totalDays).toBe(30);
      expect(result.sliPercentage).toBeCloseTo((27 / 30) * 100, 9);
    });

    test("MonitorSecondsAverage: 30 days of the one, 23 of the other", () => {
      const result: {
        badDays: number;
        totalDays: number;
        sliPercentage: number;
      } = sli(monitors, SloMultiMonitorMode.MonitorSecondsAverage);

      expect(result.badDays).toBe(3);
      expect(result.totalDays).toBe(53);
      expect(result.sliPercentage).toBeCloseTo((50 / 53) * 100, 9);
    });
  });

  test("AnyDown with both monitors off at once leaves out only the three days they overlap", () => {
    const monitors: Array<MonitorTimelineSet> = [
      {
        monitorId: MONITOR_A,
        timelines: [
          row({ monitorId: MONITOR_A, status: OPERATIONAL, from: 60, to: 10 }),
          row({
            monitorId: MONITOR_A,
            status: OFFLINE,
            from: 10,
            to: 5,
            off: true,
          }),
          row({ monitorId: MONITOR_A, status: OPERATIONAL, from: 5 }),
        ],
      },
      {
        monitorId: MONITOR_B,
        timelines: [
          row({ monitorId: MONITOR_B, status: OPERATIONAL, from: 60, to: 8 }),
          row({
            monitorId: MONITOR_B,
            status: OFFLINE,
            from: 8,
            to: 2,
            off: true,
          }),
          row({ monitorId: MONITOR_B, status: OPERATIONAL, from: 2 }),
        ],
      },
    ];

    expect(sli(monitors, SloMultiMonitorMode.AnyDown)).toEqual({
      badDays: 0,
      totalDays: 27,
      sliPercentage: 100,
    });
  });

  test("every monitor off for the whole window: no data - totalSeconds 0, which the evaluator never reads as healthy", () => {
    const monitors: Array<MonitorTimelineSet> = [
      {
        monitorId: MONITOR_A,
        timelines: [
          row({ monitorId: MONITOR_A, status: OFFLINE, from: 45, off: true }),
        ],
      },
      {
        monitorId: MONITOR_B,
        timelines: [
          row({
            monitorId: MONITOR_B,
            status: OPERATIONAL,
            from: 40,
            off: true,
          }),
        ],
      },
    ];

    for (const mode of [
      SloMultiMonitorMode.AnyDown,
      SloMultiMonitorMode.MonitorSecondsAverage,
    ]) {
      expect(sli(monitors, mode)).toEqual({
        badDays: 0,
        totalDays: 0,
        sliPercentage: 100,
      });
    }
  });

  test("a status event that does not say its monitoring is off counts as it always did: ten bad days of 30", () => {
    const monitors: Array<MonitorTimelineSet> = [
      {
        monitorId: MONITOR_A,
        timelines: [
          row({ monitorId: MONITOR_A, status: OPERATIONAL, from: 48, to: 10 }),
          row({ monitorId: MONITOR_A, status: OFFLINE, from: 10, to: 7 }),
          row({ monitorId: MONITOR_A, status: OFFLINE, from: 7, off: false }),
        ],
      },
    ];

    for (const mode of [
      SloMultiMonitorMode.AnyDown,
      SloMultiMonitorMode.MonitorSecondsAverage,
    ]) {
      const result: {
        badDays: number;
        totalDays: number;
        sliPercentage: number;
      } = sli(monitors, mode);

      expect(result.badDays).toBe(10);
      expect(result.totalDays).toBe(30);
      expect(result.sliPercentage).toBeCloseTo((20 / 30) * 100, 9);
    }
  });

  test("AnyDown ignores another monitor's rows that came in a monitor's set, as the events do", () => {
    const monitors: Array<MonitorTimelineSet> = [
      {
        monitorId: MONITOR_A,
        timelines: [
          row({ monitorId: MONITOR_A, status: OPERATIONAL, from: 60 }),
          // B's switch, in A's set: says nothing of A.
          row({ monitorId: MONITOR_B, status: OFFLINE, from: 20, off: true }),
        ],
      },
    ];

    expect(sli(monitors, SloMultiMonitorMode.AnyDown)).toEqual({
      badDays: 0,
      totalDays: 30,
      sliPercentage: 100,
    });
  });
});
