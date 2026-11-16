import SloUtil, {
  ErrorBudgetResult,
  MonitorTimelineSet,
  TimeSliResult,
} from "../../../Utils/Slo/SloUtil";
import TimeBeforeFirstCheck from "../../../Utils/Uptime/TimeBeforeFirstCheck";
import { UptimeWindow } from "../../../Utils/Uptime/UptimeUtil";
import { MeasuredFrom } from "../../../Utils/Monitor/MonitorFirstCheck";
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
 * AN SLO LEAVES OUT THE TIME BEFORE A MONITOR'S FIRST CHECK (issue #9031).
 *
 * Every monitor is created in the operational status, and nothing stands
 * behind that status until something has measured the monitor. An SLO used
 * to count that time as good: one over a monitor whose probe never
 * connected read 100% and spent no error budget for as long as the monitor
 * existed. Its monitors' rows now come with that time marked as not
 * monitored (TimeBeforeFirstCheck, applied where SloMonitorTimelines reads
 * them), so the SLI leaves it out of both the good time and the total, as
 * status pages leave it out of uptime (issue #8960):
 *
 *   - a monitor nothing has checked yet measures no time at all;
 *   - one checked mid-window is measured from its check;
 *   - a status something else recorded before the check counts as it is;
 *   - a manual monitor counts from the start.
 *
 * Every assertion is relative to a pinned "now", as in SloUtil.test.ts.
 */

const NOW: Date = new Date("2026-11-16T12:00:00.000Z");

const DAY_SECONDS: number = 86400;
const DAY_MS: number = DAY_SECONDS * 1000;

const MONITOR_A: ObjectID = new ObjectID(
  "9031a000-0000-4000-8000-000000000001",
);
const MONITOR_B: ObjectID = new ObjectID(
  "9031a000-0000-4000-8000-000000000002",
);

function makeStatus(data: {
  id: string;
  name: string;
  priority: number;
  isOperationalState: boolean;
  isOfflineState: boolean;
}): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status.id = new ObjectID(data.id);
  status.name = data.name;
  status.priority = data.priority;
  status.color = data.isOperationalState ? Green : Red;
  status.isOperationalState = data.isOperationalState;
  status.isOfflineState = data.isOfflineState;
  return status;
}

const OPERATIONAL: MonitorStatus = makeStatus({
  id: "9031b000-0000-4000-8000-000000000001",
  name: "Operational",
  priority: 1,
  isOperationalState: true,
  isOfflineState: false,
});
const OFFLINE: MonitorStatus = makeStatus({
  id: "9031b000-0000-4000-8000-000000000002",
  name: "Offline",
  priority: 2,
  isOperationalState: false,
  isOfflineState: true,
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

// A monitor's rows as SloMonitorTimelines hands them over: cut at its first check.
function monitorSet(
  monitorId: ObjectID,
  timelines: Array<MonitorStatusTimeline>,
  measuredFrom: MeasuredFrom,
): MonitorTimelineSet {
  return {
    monitorId: monitorId,
    timelines: TimeBeforeFirstCheck.markNotMonitored({
      monitorId: monitorId,
      timelines: timelines,
      measuredFrom: measuredFrom,
    }),
  };
}

// Created 40 days ago, Operational since, Offline for a day five days ago.
function createdFortyDaysAgo(
  monitorId: ObjectID,
): Array<MonitorStatusTimeline> {
  return [
    row({ monitorId, status: OPERATIONAL, from: 40, to: 5 }),
    row({ monitorId, status: OFFLINE, from: 5, to: 4 }),
    row({ monitorId, status: OPERATIONAL, from: 4 }),
  ];
}

// The monitor created 40 days ago that nothing has checked: one row.
function neverChecked(monitorId: ObjectID): Array<MonitorStatusTimeline> {
  return [row({ monitorId, status: OPERATIONAL, from: 40 })];
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

const MODES: Array<SloMultiMonitorMode> = [
  SloMultiMonitorMode.AnyDown,
  SloMultiMonitorMode.MonitorSecondsAverage,
];

describe("SloUtil and the time before a monitor's first check", () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  describe.each(MODES)("%s", (mode: SloMultiMonitorMode) => {
    test("a monitor nothing has checked yet measures no time: no data, never a healthy 100%", () => {
      expect(
        sli([monitorSet(MONITOR_A, neverChecked(MONITOR_A), null)], mode),
      ).toEqual({ badDays: 0, totalDays: 0, sliPercentage: 100 });

      // Before #9031 it read 30 good days.
      expect(
        sli([monitorSet(MONITOR_A, neverChecked(MONITOR_A), undefined)], mode),
      ).toEqual({ badDays: 0, totalDays: 30, sliPercentage: 100 });
    });

    test("a monitor checked ten days ago is measured from its check", () => {
      expect(
        sli(
          [monitorSet(MONITOR_A, createdFortyDaysAgo(MONITOR_A), daysAgo(10))],
          mode,
        ),
      ).toEqual({ badDays: 1, totalDays: 10, sliPercentage: 90 });
    });

    test("a monitor checked when it was created reads exactly as it did", () => {
      const timelines: Array<MonitorStatusTimeline> =
        createdFortyDaysAgo(MONITOR_A);

      expect(
        sli([monitorSet(MONITOR_A, timelines, daysAgo(40))], mode),
      ).toEqual(sli([{ monitorId: MONITOR_A, timelines: timelines }], mode));
    });

    test("a manual monitor counts from the start", () => {
      expect(
        sli(
          [monitorSet(MONITOR_A, createdFortyDaysAgo(MONITOR_A), undefined)],
          mode,
        ),
      ).toEqual({ badDays: 1, totalDays: 30, sliPercentage: (29 / 30) * 100 });
    });

    test("a status an incident recorded before the first check spends the budget; the operational time before the check does not count", () => {
      const timelines: Array<MonitorStatusTimeline> = [
        row({ monitorId: MONITOR_A, status: OPERATIONAL, from: 40, to: 20 }),
        row({ monitorId: MONITOR_A, status: OFFLINE, from: 20, to: 18 }),
        row({ monitorId: MONITOR_A, status: OPERATIONAL, from: 18 }),
      ];

      // Two days down, then nothing measured until the check eight days ago.
      expect(sli([monitorSet(MONITOR_A, timelines, daysAgo(8))], mode)).toEqual(
        { badDays: 2, totalDays: 10, sliPercentage: 80 },
      );
    });

    test("time with monitoring off before the first check stays out as it was", () => {
      const timelines: Array<MonitorStatusTimeline> = [
        row({ monitorId: MONITOR_A, status: OPERATIONAL, from: 40, to: 20 }),
        row({
          monitorId: MONITOR_A,
          status: OFFLINE,
          from: 20,
          to: 15,
          off: true,
        }),
        row({ monitorId: MONITOR_A, status: OPERATIONAL, from: 15 }),
      ];

      expect(sli([monitorSet(MONITOR_A, timelines, daysAgo(6))], mode)).toEqual(
        { badDays: 0, totalDays: 6, sliPercentage: 100 },
      );
    });

    test("a monitor nothing has checked yet adds nothing: the SLO reads as its checked monitor alone", () => {
      const checked: MonitorTimelineSet = monitorSet(
        MONITOR_A,
        createdFortyDaysAgo(MONITOR_A),
        daysAgo(40),
      );

      expect(
        sli(
          [checked, monitorSet(MONITOR_B, neverChecked(MONITOR_B), null)],
          mode,
        ),
      ).toEqual(sli([checked], mode));
    });
  });

  test("AnyDown: a monitor nothing had checked used to stand in for one whose monitoring was off; it no longer does", () => {
    const checked: MonitorTimelineSet = monitorSet(
      MONITOR_A,
      [
        row({ monitorId: MONITOR_A, status: OPERATIONAL, from: 40, to: 12 }),
        row({
          monitorId: MONITOR_A,
          status: OPERATIONAL,
          from: 12,
          to: 2,
          off: true,
        }),
        row({ monitorId: MONITOR_A, status: OFFLINE, from: 2 }),
      ],
      daysAgo(40),
    );

    // Before: B's thirty days counted, ten of them for A while it was off.
    expect(
      sli(
        [checked, monitorSet(MONITOR_B, neverChecked(MONITOR_B), undefined)],
        SloMultiMonitorMode.AnyDown,
      ),
    ).toEqual({ badDays: 2, totalDays: 30, sliPercentage: (28 / 30) * 100 });

    expect(
      sli(
        [checked, monitorSet(MONITOR_B, neverChecked(MONITOR_B), null)],
        SloMultiMonitorMode.AnyDown,
      ),
    ).toEqual({ badDays: 2, totalDays: 20, sliPercentage: 90 });
  });

  test("Monitor Seconds Average: a monitor nothing has checked yet no longer dilutes the downtime of the one that is", () => {
    const checked: MonitorTimelineSet = monitorSet(
      MONITOR_A,
      createdFortyDaysAgo(MONITOR_A),
      daysAgo(40),
    );

    expect(
      sli(
        [checked, monitorSet(MONITOR_B, neverChecked(MONITOR_B), undefined)],
        SloMultiMonitorMode.MonitorSecondsAverage,
      ),
    ).toEqual({ badDays: 1, totalDays: 60, sliPercentage: (59 / 60) * 100 });

    expect(
      sli(
        [checked, monitorSet(MONITOR_B, neverChecked(MONITOR_B), null)],
        SloMultiMonitorMode.MonitorSecondsAverage,
      ),
    ).toEqual({ badDays: 1, totalDays: 30, sliPercentage: (29 / 30) * 100 });
  });

  describe("the error budget", () => {
    const TARGET: number = 99;

    test("a rolling window's budget is the target's share of the time measured: from the first check", () => {
      const result: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines: [
          monitorSet(MONITOR_A, createdFortyDaysAgo(MONITOR_A), daysAgo(10)),
        ],
        downtimeStatuses: [OFFLINE],
        window: LAST_30_DAYS,
        mode: SloMultiMonitorMode.AnyDown,
      });

      const budget: ErrorBudgetResult = SloUtil.getErrorBudget({
        badSeconds: result.badSeconds,
        totalSeconds: result.totalSeconds,
        targetPercentage: TARGET,
      });

      expect(budget.budgetTotalSeconds).toBeCloseTo(0.01 * 10 * DAY_SECONDS, 6);
      expect(budget.budgetConsumedSeconds).toBe(DAY_SECONDS);
    });

    test("a calendar month's budget is the whole month's, so the first check moves the SLI but not the budget", () => {
      const month: {
        startDate: Date;
        endDate: Date;
        totalSecondsInFullPeriod: number;
      } = SloUtil.getCalendarMonthWindow({ timezone: "UTC", at: NOW });

      const timelines: Array<MonitorStatusTimeline> =
        createdFortyDaysAgo(MONITOR_A);

      const budgetOf: (measuredFrom: MeasuredFrom) => ErrorBudgetResult = (
        measuredFrom: MeasuredFrom,
      ): ErrorBudgetResult => {
        const result: TimeSliResult = SloUtil.computeTimeSli({
          perMonitorTimelines: [monitorSet(MONITOR_A, timelines, measuredFrom)],
          downtimeStatuses: [OFFLINE],
          window: { startDate: month.startDate, endDate: month.endDate },
          mode: SloMultiMonitorMode.AnyDown,
        });

        return SloUtil.getErrorBudget({
          badSeconds: result.badSeconds,
          totalSeconds: month.totalSecondsInFullPeriod,
          targetPercentage: TARGET,
        });
      };

      // Checked eight days ago, after the month began: the budget does not move.
      expect(budgetOf(daysAgo(8))).toEqual(budgetOf(undefined));
    });
  });

  describe("burn rate windows", () => {
    test("the data an SLO has reaches back to its first check, so a burn rule waits for a full window measured from it", () => {
      const firstCheck: Date = new Date(NOW.getTime() - 20 * 60 * 1000);

      // Created forty days ago, its probe connected twenty minutes ago.
      const sets: Array<MonitorTimelineSet> = [
        monitorSet(MONITOR_A, neverChecked(MONITOR_A), firstCheck),
      ];

      expect(
        SloUtil.getEarliestEventStartDate(sets, {
          startDate: daysAgo(30),
          endDate: NOW,
        }),
      ).toEqual(firstCheck);

      // Before: forty days of data, enough for every window.
      expect(
        SloUtil.getEarliestEventStartDate(
          [{ monitorId: MONITOR_A, timelines: neverChecked(MONITOR_A) }],
          { startDate: daysAgo(30), endDate: NOW },
        ),
      ).toEqual(daysAgo(30));

      // A status recorded before the check is data: it reaches back to it.
      expect(
        SloUtil.getEarliestEventStartDate(
          [monitorSet(MONITOR_A, createdFortyDaysAgo(MONITOR_A), firstCheck)],
          { startDate: daysAgo(30), endDate: NOW },
        ),
      ).toEqual(daysAgo(5));
    });

    test("a monitor nothing has checked yet has no data in any window: no burn", () => {
      const sets: Array<MonitorTimelineSet> = [
        monitorSet(MONITOR_A, neverChecked(MONITOR_A), null),
      ];

      const lastHour: UptimeWindow = {
        startDate: new Date(NOW.getTime() - 60 * 60 * 1000),
        endDate: NOW,
      };

      const result: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines: sets,
        downtimeStatuses: [OFFLINE],
        window: lastHour,
        mode: SloMultiMonitorMode.AnyDown,
      });

      expect(
        SloUtil.computeBurnRate({
          badSeconds: result.badSeconds,
          totalSeconds: result.totalSeconds,
          targetPercentage: 99.9,
        }),
      ).toBe(0);
      expect(SloUtil.getEarliestEventStartDate(sets, lastHour)).toBeNull();
    });
  });
});
