import SloUtil, {
  CalendarMonthWindow,
  DowntimeInterval,
  ErrorBudgetResult,
  TimeSliResult,
} from "../../../Utils/Slo/SloUtil";
import UptimeUtil, { UptimeWindow } from "../../../Utils/Uptime/UptimeUtil";
import { Green, Red } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import SloMultiMonitorMode from "../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";

/*
 * Every assertion is relative to a pinned "now" so the numbers are stable - the same
 * discipline as UptimeUtil.test.ts (uptime math used to drift with wall clock time).
 */
const NOW: Date = new Date("2026-07-19T00:00:00.000Z");

const MONITOR_A_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_B_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const MONITOR_C_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const SECONDS_IN_HOUR: number = 3600;
const SECONDS_IN_DAY: number = 86400;

const offlineStatus: MonitorStatus = new MonitorStatus();
offlineStatus.id = OFFLINE_STATUS_ID;
offlineStatus.name = "Offline";
offlineStatus.priority = 2;
offlineStatus.color = Red;

const downtimeStatuses: Array<MonitorStatus> = [offlineStatus];

type CreateTimelineFunction = (data: {
  statusId: ObjectID;
  name: string;
  priority: number;
  startsAt: string;
  endsAt?: string | undefined;
  monitorId: ObjectID;
}) => MonitorStatusTimeline;

const createTimeline: CreateTimelineFunction = (data: {
  statusId: ObjectID;
  name: string;
  priority: number;
  startsAt: string;
  endsAt?: string | undefined;
  monitorId: ObjectID;
}): MonitorStatusTimeline => {
  const monitorStatus: MonitorStatus = new MonitorStatus();
  monitorStatus.id = data.statusId;
  monitorStatus.name = data.name;
  monitorStatus.priority = data.priority;
  monitorStatus.color = data.name === "Offline" ? Red : Green;

  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
  timeline.monitorId = data.monitorId;
  timeline.monitorStatusId = data.statusId;
  timeline.monitorStatus = monitorStatus;
  timeline.startsAt = new Date(data.startsAt);

  // endsAt is left unset for open rows, matching what the database rows look like.
  if (data.endsAt) {
    timeline.endsAt = new Date(data.endsAt);
  }

  return timeline;
};

type StatusTimelineFunction = (
  monitorId: ObjectID,
  startsAt: string,
  endsAt?: string | undefined,
) => MonitorStatusTimeline;

const offline: StatusTimelineFunction = (
  monitorId: ObjectID,
  startsAt: string,
  endsAt?: string | undefined,
): MonitorStatusTimeline => {
  return createTimeline({
    statusId: OFFLINE_STATUS_ID,
    name: "Offline",
    priority: 2,
    startsAt,
    endsAt,
    monitorId,
  });
};

const operational: StatusTimelineFunction = (
  monitorId: ObjectID,
  startsAt: string,
  endsAt?: string | undefined,
): MonitorStatusTimeline => {
  return createTimeline({
    statusId: OPERATIONAL_STATUS_ID,
    name: "Operational",
    priority: 1,
    startsAt,
    endsAt,
    monitorId,
  });
};

describe("SloUtil", () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  /*
   * The case the whole util exists for: Monitor A Offline 10:00-11:00 while Monitor B
   * is Operational 10:30-12:00. Cross-monitor budget math must see the full hour of
   * downtime; UptimeUtil's priority flatten (built for rendering one status-page bar)
   * silently erases the 10:30-11:00 half of it.
   */
  describe("the union correctness case: A Offline 10:00-11:00, B Operational 10:30-12:00", () => {
    const window: UptimeWindow = {
      startDate: new Date("2026-07-18T10:00:00.000Z"),
      endDate: new Date("2026-07-18T13:00:00.000Z"),
    };

    const monitorATimelines: Array<MonitorStatusTimeline> = [
      offline(
        MONITOR_A_ID,
        "2026-07-18T10:00:00.000Z",
        "2026-07-18T11:00:00.000Z",
      ),
    ];

    const monitorBTimelines: Array<MonitorStatusTimeline> = [
      operational(
        MONITOR_B_ID,
        "2026-07-18T10:30:00.000Z",
        "2026-07-18T12:00:00.000Z",
      ),
    ];

    it("counts the full hour of downtime, not 30 minutes", () => {
      expect(
        SloUtil.getUnionDowntimeSeconds(
          [
            { monitorId: MONITOR_A_ID, timelines: monitorATimelines },
            { monitorId: MONITOR_B_ID, timelines: monitorBTimelines },
          ],
          downtimeStatuses,
          window,
        ),
      ).toBe(SECONDS_IN_HOUR);
    });

    it("documents the bug being avoided: the cross-monitor flatten yields only 1800s", () => {
      /*
       * This is why SloUtil does NOT feed multiple monitors into
       * UptimeUtil.getNonOverlappingMonitorEvents / getTotalDowntimeInSeconds: B's
       * Operational event ends later than A's Offline event, so the flatten truncates
       * the Offline event at 10:30. If UptimeUtil's flatten ever changes, revisit
       * SloUtil - this assertion pins the behaviour SloUtil works around.
       */
      expect(
        UptimeUtil.getTotalDowntimeInSeconds(
          [...monitorATimelines, ...monitorBTimelines],
          downtimeStatuses,
          window,
        ).totalDowntimeInSeconds,
      ).toBe(SECONDS_IN_HOUR / 2);
    });

    it("computes the AnyDown SLI over the shared window", () => {
      const result: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines: [
          { monitorId: MONITOR_A_ID, timelines: monitorATimelines },
          { monitorId: MONITOR_B_ID, timelines: monitorBTimelines },
        ],
        downtimeStatuses,
        window,
        mode: SloMultiMonitorMode.AnyDown,
      });

      // earliest first event is 10:00 (= window start), window end is in the past.
      expect(result.totalSeconds).toBe(3 * SECONDS_IN_HOUR);
      expect(result.badSeconds).toBe(SECONDS_IN_HOUR);
      expect(result.sliPercentage).toBeCloseTo((2 / 3) * 100, 10);
    });

    it("MonitorSecondsAverage gives a different (per-monitor weighted) answer", () => {
      const anyDown: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines: [
          { monitorId: MONITOR_A_ID, timelines: monitorATimelines },
          { monitorId: MONITOR_B_ID, timelines: monitorBTimelines },
        ],
        downtimeStatuses,
        window,
        mode: SloMultiMonitorMode.AnyDown,
      });

      const average: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines: [
          { monitorId: MONITOR_A_ID, timelines: monitorATimelines },
          { monitorId: MONITOR_B_ID, timelines: monitorBTimelines },
        ],
        downtimeStatuses,
        window,
        mode: SloMultiMonitorMode.MonitorSecondsAverage,
      });

      /*
       * Per-monitor windows (each clamped to its own first event, mirroring
       * UptimeUtil.getTotalDowntimeInSeconds): A is 10:00-13:00 = 10800s with 3600s
       * down; B is 10:30-13:00 = 9000s with 0s down.
       */
      expect(average.badSeconds).toBe(SECONDS_IN_HOUR);
      expect(average.totalSeconds).toBe(10800 + 9000);
      expect(average.sliPercentage).toBeCloseTo((1 - 3600 / 19800) * 100, 10);

      expect(average.sliPercentage).not.toBeCloseTo(anyDown.sliPercentage, 5);
      expect(average.totalSeconds).not.toBe(anyDown.totalSeconds);
    });
  });

  describe("getDowntimeIntervalsForMonitor", () => {
    const window: UptimeWindow = {
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      endDate: new Date("2026-07-11T00:00:00.000Z"),
    };

    it("returns only downtime intervals, clipped to the window", () => {
      const timelines: Array<MonitorStatusTimeline> = [
        // open row from before the window: end is imputed at the next row's start.
        operational(MONITOR_A_ID, "2026-06-01T00:00:00.000Z"),
        offline(
          MONITOR_A_ID,
          "2026-07-05T00:00:00.000Z",
          "2026-07-05T01:00:00.000Z",
        ),
        operational(MONITOR_A_ID, "2026-07-05T01:00:00.000Z"),
      ];

      const intervals: Array<DowntimeInterval> =
        SloUtil.getDowntimeIntervalsForMonitor(
          MONITOR_A_ID,
          timelines,
          downtimeStatuses,
          window,
        );

      expect(intervals).toHaveLength(1);
      expect(intervals[0]!.startDate.toISOString()).toBe(
        "2026-07-05T00:00:00.000Z",
      );
      expect(intervals[0]!.endDate.toISOString()).toBe(
        "2026-07-05T01:00:00.000Z",
      );
    });

    it("caps an open downtime row at the window end", () => {
      const openWindow: UptimeWindow = {
        startDate: new Date("2026-07-18T10:00:00.000Z"),
        endDate: new Date("2026-07-18T13:00:00.000Z"),
      };

      const intervals: Array<DowntimeInterval> =
        SloUtil.getDowntimeIntervalsForMonitor(
          MONITOR_A_ID,
          [offline(MONITOR_A_ID, "2026-07-18T10:00:00.000Z")],
          downtimeStatuses,
          openWindow,
        );

      expect(intervals).toHaveLength(1);
      expect(intervals[0]!.endDate.toISOString()).toBe(
        openWindow.endDate.toISOString(),
      );
    });

    it("ignores rows that belong to other monitors", () => {
      const intervals: Array<DowntimeInterval> =
        SloUtil.getDowntimeIntervalsForMonitor(
          MONITOR_A_ID,
          [
            offline(
              MONITOR_B_ID,
              "2026-07-05T00:00:00.000Z",
              "2026-07-06T00:00:00.000Z",
            ),
          ],
          downtimeStatuses,
          window,
        );

      expect(intervals).toHaveLength(0);
    });
  });

  describe("getUnionDowntimeSeconds", () => {
    const window: UptimeWindow = {
      startDate: new Date("2026-07-18T10:00:00.000Z"),
      endDate: new Date("2026-07-18T13:00:00.000Z"),
    };

    it("computes simple downtime for a single monitor", () => {
      expect(
        SloUtil.getUnionDowntimeSeconds(
          [
            {
              monitorId: MONITOR_A_ID,
              timelines: [
                offline(
                  MONITOR_A_ID,
                  "2026-07-18T10:00:00.000Z",
                  "2026-07-18T11:00:00.000Z",
                ),
              ],
            },
          ],
          downtimeStatuses,
          window,
        ),
      ).toBe(SECONDS_IN_HOUR);
    });

    it("merges overlapping and keeps disjoint downtime across three monitors", () => {
      const perMonitor: Array<{
        monitorId: ObjectID;
        timelines: Array<MonitorStatusTimeline>;
      }> = [
        {
          monitorId: MONITOR_A_ID,
          timelines: [
            offline(
              MONITOR_A_ID,
              "2026-07-18T10:00:00.000Z",
              "2026-07-18T11:00:00.000Z",
            ),
          ],
        },
        {
          monitorId: MONITOR_B_ID,
          timelines: [
            offline(
              MONITOR_B_ID,
              "2026-07-18T10:30:00.000Z",
              "2026-07-18T11:30:00.000Z",
            ),
          ],
        },
        {
          monitorId: MONITOR_C_ID,
          timelines: [
            offline(
              MONITOR_C_ID,
              "2026-07-18T12:00:00.000Z",
              "2026-07-18T12:30:00.000Z",
            ),
          ],
        },
      ];

      // 10:00-11:30 merged (5400s) + 12:00-12:30 disjoint (1800s).
      expect(
        SloUtil.getUnionDowntimeSeconds(perMonitor, downtimeStatuses, window),
      ).toBe(5400 + 1800);
    });

    it("merges adjacent intervals without double counting the boundary", () => {
      const perMonitor: Array<{
        monitorId: ObjectID;
        timelines: Array<MonitorStatusTimeline>;
      }> = [
        {
          monitorId: MONITOR_A_ID,
          timelines: [
            offline(
              MONITOR_A_ID,
              "2026-07-18T10:00:00.000Z",
              "2026-07-18T10:30:00.000Z",
            ),
          ],
        },
        {
          monitorId: MONITOR_B_ID,
          timelines: [
            offline(
              MONITOR_B_ID,
              "2026-07-18T10:30:00.000Z",
              "2026-07-18T11:00:00.000Z",
            ),
          ],
        },
      ];

      expect(
        SloUtil.getUnionDowntimeSeconds(perMonitor, downtimeStatuses, window),
      ).toBe(SECONDS_IN_HOUR);
    });

    it("returns 0 when nothing is down", () => {
      expect(
        SloUtil.getUnionDowntimeSeconds(
          [
            {
              monitorId: MONITOR_A_ID,
              timelines: [
                operational(MONITOR_A_ID, "2026-07-18T10:00:00.000Z"),
              ],
            },
          ],
          downtimeStatuses,
          window,
        ),
      ).toBe(0);
    });
  });

  describe("mergeIntervals", () => {
    it("merges overlaps, keeps disjoint intervals and drops empty ones", () => {
      const merged: Array<DowntimeInterval> = SloUtil.mergeIntervals([
        {
          startDate: new Date("2026-07-18T12:00:00.000Z"),
          endDate: new Date("2026-07-18T12:30:00.000Z"),
        },
        {
          startDate: new Date("2026-07-18T10:00:00.000Z"),
          endDate: new Date("2026-07-18T11:00:00.000Z"),
        },
        {
          startDate: new Date("2026-07-18T10:30:00.000Z"),
          endDate: new Date("2026-07-18T10:45:00.000Z"),
        },
        // empty interval - must be dropped.
        {
          startDate: new Date("2026-07-18T09:00:00.000Z"),
          endDate: new Date("2026-07-18T09:00:00.000Z"),
        },
      ]);

      expect(merged).toHaveLength(2);
      expect(merged[0]!.startDate.toISOString()).toBe(
        "2026-07-18T10:00:00.000Z",
      );
      expect(merged[0]!.endDate.toISOString()).toBe("2026-07-18T11:00:00.000Z");
      expect(merged[1]!.startDate.toISOString()).toBe(
        "2026-07-18T12:00:00.000Z",
      );
    });
  });

  describe("computeTimeSli", () => {
    it("computes a simple single-monitor SLI (AnyDown)", () => {
      const window: UptimeWindow = {
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-07-11T00:00:00.000Z"),
      };

      const timelines: Array<MonitorStatusTimeline> = [
        operational(MONITOR_A_ID, "2026-06-01T00:00:00.000Z"),
        offline(
          MONITOR_A_ID,
          "2026-07-05T00:00:00.000Z",
          "2026-07-05T01:00:00.000Z",
        ),
        operational(MONITOR_A_ID, "2026-07-05T01:00:00.000Z"),
      ];

      const result: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines: [
          { monitorId: MONITOR_A_ID, timelines: timelines },
        ],
        downtimeStatuses,
        window,
        mode: SloMultiMonitorMode.AnyDown,
      });

      // the monitor pre-dates the window, so the denominator is the full 10 days.
      expect(result.totalSeconds).toBe(10 * SECONDS_IN_DAY);
      expect(result.badSeconds).toBe(SECONDS_IN_HOUR);
      expect(result.sliPercentage).toBeCloseTo(
        ((10 * SECONDS_IN_DAY - SECONDS_IN_HOUR) / (10 * SECONDS_IN_DAY)) * 100,
        10,
      );
    });

    it("clamps the denominator of a young SLO to its first event (AnyDown)", () => {
      /*
       * 18-day window but the monitor's first event is 17 July - two days before the
       * pinned now. Without the clamp the 16 empty days would count as uptime and a
       * monitor that was down half its life would report ~97%.
       */
      const window: UptimeWindow = {
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-07-19T00:00:00.000Z"),
      };

      const timelines: Array<MonitorStatusTimeline> = [
        offline(MONITOR_A_ID, "2026-07-17T00:00:00.000Z"),
        operational(MONITOR_A_ID, "2026-07-18T00:00:00.000Z"),
      ];

      const result: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines: [
          { monitorId: MONITOR_A_ID, timelines: timelines },
        ],
        downtimeStatuses,
        window,
        mode: SloMultiMonitorMode.AnyDown,
      });

      expect(result.totalSeconds).toBe(2 * SECONDS_IN_DAY);
      expect(result.badSeconds).toBe(SECONDS_IN_DAY);
      expect(result.sliPercentage).toBeCloseTo(50, 10);
    });

    it("anchors the AnyDown window at the EARLIEST first event across monitors", () => {
      const window: UptimeWindow = {
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-07-19T00:00:00.000Z"),
      };

      const result: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines: [
          {
            monitorId: MONITOR_A_ID,
            timelines: [operational(MONITOR_A_ID, "2026-07-15T00:00:00.000Z")],
          },
          {
            // young monitor, down since its first event.
            monitorId: MONITOR_B_ID,
            timelines: [offline(MONITOR_B_ID, "2026-07-17T00:00:00.000Z")],
          },
        ],
        downtimeStatuses,
        window,
        mode: SloMultiMonitorMode.AnyDown,
      });

      // window is anchored at A's first event (15 July), not B's (17 July).
      expect(result.totalSeconds).toBe(4 * SECONDS_IN_DAY);
      expect(result.badSeconds).toBe(2 * SECONDS_IN_DAY);
      expect(result.sliPercentage).toBeCloseTo(50, 10);
    });

    it("clips the window end to now, not the future window end (AnyDown)", () => {
      // window runs to 1 August but now is 19 July.
      const window: UptimeWindow = {
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-08-01T00:00:00.000Z"),
      };

      const result: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines: [
          {
            monitorId: MONITOR_A_ID,
            timelines: [operational(MONITOR_A_ID, "2026-07-01T00:00:00.000Z")],
          },
        ],
        downtimeStatuses,
        window,
        mode: SloMultiMonitorMode.AnyDown,
      });

      expect(result.totalSeconds).toBe(18 * SECONDS_IN_DAY);
      expect(result.sliPercentage).toBe(100);
    });

    it.each([
      SloMultiMonitorMode.AnyDown,
      SloMultiMonitorMode.MonitorSecondsAverage,
    ])(
      "returns totalSeconds 0 and 100%% when there is no data at all (%s)",
      (mode: SloMultiMonitorMode) => {
        const window: UptimeWindow = {
          startDate: new Date("2026-07-01T00:00:00.000Z"),
          endDate: new Date("2026-07-11T00:00:00.000Z"),
        };

        for (const perMonitorTimelines of [
          [],
          [
            { monitorId: MONITOR_A_ID, timelines: [] },
            { monitorId: MONITOR_B_ID, timelines: [] },
          ],
        ]) {
          expect(
            SloUtil.computeTimeSli({
              perMonitorTimelines,
              downtimeStatuses,
              window,
              mode,
            }),
          ).toEqual({
            badSeconds: 0,
            totalSeconds: 0,
            sliPercentage: 100,
          });
        }
      },
    );

    it("treats rows that never overlap the window as a fully-up full window (AnyDown)", () => {
      /*
       * Same semantics as UptimeUtil's production-incident test: data exists but none
       * of it clips into the window, so the window reports 100% over its full length.
       */
      const window: UptimeWindow = {
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-07-11T00:00:00.000Z"),
      };

      const result: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines: [
          {
            monitorId: MONITOR_A_ID,
            timelines: [
              offline(
                MONITOR_A_ID,
                "2026-01-01T00:00:00.000Z",
                "2026-01-02T00:00:00.000Z",
              ),
            ],
          },
        ],
        downtimeStatuses,
        window,
        mode: SloMultiMonitorMode.AnyDown,
      });

      expect(result.totalSeconds).toBe(10 * SECONDS_IN_DAY);
      expect(result.badSeconds).toBe(0);
      expect(result.sliPercentage).toBe(100);
    });

    it("skips monitors with zero rows in MonitorSecondsAverage instead of diluting", () => {
      const window: UptimeWindow = {
        startDate: new Date("2026-07-17T00:00:00.000Z"),
        endDate: new Date("2026-07-19T00:00:00.000Z"),
      };

      const withEmptyMonitor: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines: [
          {
            monitorId: MONITOR_A_ID,
            timelines: [offline(MONITOR_A_ID, "2026-07-17T00:00:00.000Z")],
          },
          { monitorId: MONITOR_B_ID, timelines: [] },
        ],
        downtimeStatuses,
        window,
        mode: SloMultiMonitorMode.MonitorSecondsAverage,
      });

      // monitor B contributes nothing: the SLI is A's alone - 0%.
      expect(withEmptyMonitor.totalSeconds).toBe(2 * SECONDS_IN_DAY);
      expect(withEmptyMonitor.badSeconds).toBe(2 * SECONDS_IN_DAY);
      expect(withEmptyMonitor.sliPercentage).toBeCloseTo(0, 10);
    });
  });

  describe("getErrorBudget", () => {
    it("computes the budget from bad/total seconds", () => {
      // 99.9% target over ~11.6 days: 0.1% of 1,000,000s = 1000s of budget.
      const budget: ErrorBudgetResult = SloUtil.getErrorBudget({
        badSeconds: 400,
        totalSeconds: 1000000,
        targetPercentage: 99.9,
      });

      expect(budget.budgetTotalSeconds).toBeCloseTo(1000, 6);
      expect(budget.budgetConsumedSeconds).toBe(400);
      expect(budget.budgetRemainingSeconds).toBeCloseTo(600, 6);
      expect(budget.budgetRemainingPercentage).toBeCloseTo(60, 6);
    });

    it("computes the budget from an SLI percentage", () => {
      const budget: ErrorBudgetResult = SloUtil.getErrorBudget({
        sliPercentage: 99.95,
        totalSeconds: 1000000,
        targetPercentage: 99.9,
      });

      expect(budget.budgetConsumedSeconds).toBeCloseTo(500, 6);
      expect(budget.budgetRemainingSeconds).toBeCloseTo(500, 6);
      expect(budget.budgetRemainingPercentage).toBeCloseTo(50, 6);
    });

    it("goes SIGNED negative when over budget - never clamped here", () => {
      const budget: ErrorBudgetResult = SloUtil.getErrorBudget({
        badSeconds: 1500,
        totalSeconds: 1000000,
        targetPercentage: 99.9,
      });

      expect(budget.budgetRemainingSeconds).toBeCloseTo(-500, 6);
      expect(budget.budgetRemainingSeconds).toBeLessThan(0);
      expect(budget.budgetRemainingPercentage).toBeCloseTo(-50, 6);
      expect(budget.budgetRemainingPercentage).toBeLessThan(0);
    });

    it("caps the remaining percentage at 100", () => {
      // degenerate negative consumption must not report more than a full budget.
      const budget: ErrorBudgetResult = SloUtil.getErrorBudget({
        badSeconds: -10,
        totalSeconds: 1000000,
        targetPercentage: 99.9,
      });

      expect(budget.budgetRemainingPercentage).toBe(100);
    });

    it("reports a full budget when no time has elapsed", () => {
      expect(
        SloUtil.getErrorBudget({
          badSeconds: 0,
          totalSeconds: 0,
          targetPercentage: 99.9,
        }),
      ).toEqual({
        budgetTotalSeconds: 0,
        budgetConsumedSeconds: 0,
        budgetRemainingSeconds: 0,
        budgetRemainingPercentage: 100,
      });
    });

    it.each([100, 100.5, 0, -5])(
      "rejects a target of %s%%",
      (targetPercentage: number) => {
        expect(() => {
          return SloUtil.getErrorBudget({
            badSeconds: 0,
            totalSeconds: 1000,
            targetPercentage,
          });
        }).toThrow(BadDataException);
      },
    );

    it("rejects a call with neither sliPercentage nor badSeconds", () => {
      expect(() => {
        return SloUtil.getErrorBudget({
          totalSeconds: 1000,
          targetPercentage: 99.9,
        });
      }).toThrow(BadDataException);
    });
  });

  describe("computeBurnRate", () => {
    it("computes the burn rate as badFraction / allowedBadFraction", () => {
      // burning 1% of the period against a 0.1% allowance = 10x burn.
      expect(
        SloUtil.computeBurnRate({
          badSeconds: 36,
          totalSeconds: 3600,
          targetPercentage: 99.9,
        }),
      ).toBeCloseTo(10, 10);
    });

    it("returns exactly 1 when burning at precisely the sustainable rate", () => {
      expect(
        SloUtil.computeBurnRate({
          badSeconds: (1 - 99.9 / 100) * 3600,
          totalSeconds: 3600,
          targetPercentage: 99.9,
        }),
      ).toBeCloseTo(1, 10);
    });

    it("works with event counts the same as with seconds", () => {
      // 1 bad request out of 1000 against a 99% target: 0.1% / 1% = 0.1x.
      expect(
        SloUtil.computeBurnRate({
          badSeconds: 1,
          totalSeconds: 1000,
          targetPercentage: 99,
        }),
      ).toBeCloseTo(0.1, 10);
    });

    it("returns 0 for a no-data window", () => {
      expect(
        SloUtil.computeBurnRate({
          badSeconds: 0,
          totalSeconds: 0,
          targetPercentage: 99.9,
        }),
      ).toBe(0);
    });

    it("returns 0 when nothing is bad", () => {
      expect(
        SloUtil.computeBurnRate({
          badSeconds: 0,
          totalSeconds: 3600,
          targetPercentage: 99.9,
        }),
      ).toBe(0);
    });

    it.each([100, 0])(
      "rejects a target of %s%%",
      (targetPercentage: number) => {
        expect(() => {
          return SloUtil.computeBurnRate({
            badSeconds: 1,
            totalSeconds: 100,
            targetPercentage,
          });
        }).toThrow(BadDataException);
      },
    );
  });

  describe("computeSloStatus hysteresis (threshold 20)", () => {
    type StatusCase = [SloStatus, number, SloStatus];

    const cases: Array<StatusCase> = [
      // plain healthy.
      [SloStatus.Healthy, 50, SloStatus.Healthy],
      [SloStatus.Healthy, 20.001, SloStatus.Healthy],
      // enter AtRisk at <= threshold.
      [SloStatus.Healthy, 20, SloStatus.AtRisk],
      [SloStatus.Healthy, 10, SloStatus.AtRisk],
      // hysteresis: stays AtRisk in the band between threshold and threshold + 5...
      [SloStatus.AtRisk, 21, SloStatus.AtRisk],
      [SloStatus.AtRisk, 24.999, SloStatus.AtRisk],
      // ...and exits only at >= threshold + 5.
      [SloStatus.AtRisk, 25, SloStatus.Healthy],
      [SloStatus.AtRisk, 30, SloStatus.Healthy],
      // enter BudgetExhausted at <= 0 from any state.
      [SloStatus.Healthy, 0, SloStatus.BudgetExhausted],
      [SloStatus.AtRisk, -10, SloStatus.BudgetExhausted],
      // hysteresis: stays exhausted below 2...
      [SloStatus.BudgetExhausted, 1.5, SloStatus.BudgetExhausted],
      // ...then exits into AtRisk (still under the at-risk threshold).
      [SloStatus.BudgetExhausted, 2, SloStatus.AtRisk],
      [SloStatus.BudgetExhausted, 30, SloStatus.Healthy],
      // never emits Misconfigured/Paused - the caller owns those.
      [SloStatus.Paused, 50, SloStatus.Healthy],
      [SloStatus.Misconfigured, 1, SloStatus.AtRisk],
    ];

    it.each(cases)(
      "from %s with %s%% remaining -> %s",
      (
        currentStatus: SloStatus,
        budgetRemainingPercentage: number,
        expected: SloStatus,
      ) => {
        expect(
          SloUtil.computeSloStatus({
            budgetRemainingPercentage,
            currentStatus,
            atRiskThresholdPercentage: 20,
          }),
        ).toBe(expected);
      },
    );

    it("does not flap on a value oscillating just above the threshold", () => {
      // dips to 19 -> AtRisk; recovers to 22 -> must STAY AtRisk; back to 19 -> AtRisk.
      let status: SloStatus = SloStatus.Healthy;

      for (const remaining of [19, 22, 19, 23, 24.9]) {
        status = SloUtil.computeSloStatus({
          budgetRemainingPercentage: remaining,
          currentStatus: status,
          atRiskThresholdPercentage: 20,
        });

        expect(status).toBe(SloStatus.AtRisk);
      }

      // only a real recovery clears it.
      expect(
        SloUtil.computeSloStatus({
          budgetRemainingPercentage: 25,
          currentStatus: status,
          atRiskThresholdPercentage: 20,
        }),
      ).toBe(SloStatus.Healthy);
    });
  });

  describe("getCalendarMonthWindow", () => {
    it("returns the full UTC month containing the instant", () => {
      const window: CalendarMonthWindow = SloUtil.getCalendarMonthWindow({
        at: new Date("2026-07-15T12:34:56.000Z"),
      });

      expect(window.startDate.toISOString()).toBe("2026-07-01T00:00:00.000Z");
      expect(window.endDate.toISOString()).toBe("2026-08-01T00:00:00.000Z");
      expect(window.totalSecondsInFullPeriod).toBe(31 * SECONDS_IN_DAY);
    });

    it("handles month boundaries exactly", () => {
      const firstInstantOfJuly: CalendarMonthWindow =
        SloUtil.getCalendarMonthWindow({
          at: new Date("2026-07-01T00:00:00.000Z"),
          timezone: "UTC",
        });

      expect(firstInstantOfJuly.startDate.toISOString()).toBe(
        "2026-07-01T00:00:00.000Z",
      );

      const lastInstantOfJune: CalendarMonthWindow =
        SloUtil.getCalendarMonthWindow({
          at: new Date("2026-06-30T23:59:59.999Z"),
          timezone: "UTC",
        });

      expect(lastInstantOfJune.startDate.toISOString()).toBe(
        "2026-06-01T00:00:00.000Z",
      );
      expect(lastInstantOfJune.endDate.toISOString()).toBe(
        "2026-07-01T00:00:00.000Z",
      );
      expect(lastInstantOfJune.totalSecondsInFullPeriod).toBe(
        30 * SECONDS_IN_DAY,
      );
    });

    it("gets February right in normal and leap years", () => {
      expect(
        SloUtil.getCalendarMonthWindow({
          at: new Date("2026-02-10T00:00:00.000Z"),
        }).totalSecondsInFullPeriod,
      ).toBe(28 * SECONDS_IN_DAY);

      expect(
        SloUtil.getCalendarMonthWindow({
          at: new Date("2028-02-10T00:00:00.000Z"),
        }).totalSecondsInFullPeriod,
      ).toBe(29 * SECONDS_IN_DAY);
    });

    it("resolves the month in the SLO's timezone, not UTC", () => {
      // 1 July 02:00 UTC is still 30 June 22:00 in New York - the JUNE window.
      const window: CalendarMonthWindow = SloUtil.getCalendarMonthWindow({
        at: new Date("2026-07-01T02:00:00.000Z"),
        timezone: "America/New_York",
      });

      expect(window.startDate.toISOString()).toBe("2026-06-01T04:00:00.000Z");
      expect(window.endDate.toISOString()).toBe("2026-07-01T04:00:00.000Z");
      expect(window.totalSecondsInFullPeriod).toBe(30 * SECONDS_IN_DAY);
    });

    it("uses real elapsed seconds across a DST transition", () => {
      // March 2026 in New York springs forward on 8 March: the month is 1h shorter.
      const window: CalendarMonthWindow = SloUtil.getCalendarMonthWindow({
        at: new Date("2026-03-15T12:00:00.000Z"),
        timezone: "America/New_York",
      });

      expect(window.startDate.toISOString()).toBe("2026-03-01T05:00:00.000Z");
      expect(window.endDate.toISOString()).toBe("2026-04-01T04:00:00.000Z");
      expect(window.totalSecondsInFullPeriod).toBe(
        31 * SECONDS_IN_DAY - SECONDS_IN_HOUR,
      );
    });

    it("rejects an unknown timezone", () => {
      expect(() => {
        return SloUtil.getCalendarMonthWindow({
          at: NOW,
          timezone: "Not/AZone",
        });
      }).toThrow(BadDataException);
    });
  });

  describe("roundForDisplay", () => {
    it("floors to the requested precision, like UptimeUtil", () => {
      expect(SloUtil.roundForDisplay(99.999, UptimePrecision.TWO_DECIMAL)).toBe(
        99.99,
      );
      expect(
        SloUtil.roundForDisplay(66.6666, UptimePrecision.ONE_DECIMAL),
      ).toBe(66.6);
    });
  });

  describe("getEarliestEventStartDate", () => {
    const window: UptimeWindow = {
      startDate: new Date("2026-07-18T10:00:00.000Z"),
      endDate: new Date("2026-07-18T13:00:00.000Z"),
    };

    it("returns null when there are no monitors attached at all", () => {
      expect(SloUtil.getEarliestEventStartDate([], window)).toBeNull();
    });

    it("returns null when every attached monitor has zero timeline rows", () => {
      expect(
        SloUtil.getEarliestEventStartDate(
          [
            { monitorId: MONITOR_A_ID, timelines: [] },
            { monitorId: MONITOR_B_ID, timelines: [] },
          ],
          window,
        ),
      ).toBeNull();
    });

    it("returns null when rows exist but none of them overlap the window", () => {
      /*
       * January rows against a July window: nothing clips in, so this window can
       * see no data. Callers must read this as "cannot judge", NOT as "no
       * downtime" - the burn-rate evaluator refuses to evaluate a rule at all
       * when this is null.
       */
      expect(
        SloUtil.getEarliestEventStartDate(
          [
            {
              monitorId: MONITOR_A_ID,
              timelines: [
                offline(
                  MONITOR_A_ID,
                  "2026-01-01T00:00:00.000Z",
                  "2026-01-02T00:00:00.000Z",
                ),
              ],
            },
          ],
          window,
        ),
      ).toBeNull();
    });

    it("returns the earliest event start across ALL monitors, not just the first monitor in the array", () => {
      // the earliest row deliberately belongs to the SECOND entry of the array.
      const earliest: Date | null = SloUtil.getEarliestEventStartDate(
        [
          {
            monitorId: MONITOR_A_ID,
            timelines: [operational(MONITOR_A_ID, "2026-07-18T12:00:00.000Z")],
          },
          {
            monitorId: MONITOR_B_ID,
            timelines: [
              offline(
                MONITOR_B_ID,
                "2026-07-18T10:15:00.000Z",
                "2026-07-18T10:45:00.000Z",
              ),
            ],
          },
          {
            monitorId: MONITOR_C_ID,
            timelines: [operational(MONITOR_C_ID, "2026-07-18T11:00:00.000Z")],
          },
        ],
        window,
      );

      expect(earliest!.toISOString()).toBe("2026-07-18T10:15:00.000Z");
    });

    it("returns the earliest of several rows belonging to one monitor", () => {
      const earliest: Date | null = SloUtil.getEarliestEventStartDate(
        [
          {
            monitorId: MONITOR_A_ID,
            timelines: [
              // deliberately out of chronological order in the array.
              offline(
                MONITOR_A_ID,
                "2026-07-18T12:00:00.000Z",
                "2026-07-18T12:30:00.000Z",
              ),
              operational(
                MONITOR_A_ID,
                "2026-07-18T10:30:00.000Z",
                "2026-07-18T12:00:00.000Z",
              ),
              operational(MONITOR_A_ID, "2026-07-18T12:30:00.000Z"),
            ],
          },
        ],
        window,
      );

      expect(earliest!.toISOString()).toBe("2026-07-18T10:30:00.000Z");
    });

    it("reports the CLIPPED window start for an event that began before the window, matching the SLI denominator's clamp exactly", () => {
      /*
       * The gate (this helper) and the clamp (computeTimeSli) must never drift:
       * both run through UptimeUtil.getMonitorEventsForId, so an event that
       * started before the window reports the WINDOW start, and the denominator
       * is therefore the full window.
       */
      const perMonitorTimelines: Array<{
        monitorId: ObjectID;
        timelines: Array<MonitorStatusTimeline>;
      }> = [
        {
          monitorId: MONITOR_A_ID,
          timelines: [operational(MONITOR_A_ID, "2026-07-18T08:00:00.000Z")],
        },
      ];

      const earliest: Date | null = SloUtil.getEarliestEventStartDate(
        perMonitorTimelines,
        window,
      );

      expect(earliest!.toISOString()).toBe("2026-07-18T10:00:00.000Z");
      expect(earliest!.getTime()).toBe(window.startDate.getTime());

      const sli: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines,
        downtimeStatuses,
        window,
        mode: SloMultiMonitorMode.AnyDown,
      });

      // the clamp moved nothing: the full three-hour window is the denominator.
      expect(sli.totalSeconds).toBe(3 * SECONDS_IN_HOUR);
    });

    it("never returns a date before the window start, even for a months-old open row", () => {
      const earliest: Date | null = SloUtil.getEarliestEventStartDate(
        [
          {
            monitorId: MONITOR_A_ID,
            timelines: [offline(MONITOR_A_ID, "2026-01-01T00:00:00.000Z")],
          },
        ],
        window,
      );

      expect(earliest!.getTime()).toBeGreaterThanOrEqual(
        window.startDate.getTime(),
      );
      expect(earliest!.toISOString()).toBe("2026-07-18T10:00:00.000Z");
    });
  });

  /*
   * THE REGRESSION: a monitor whose first event is 5 minutes old with 20 seconds
   * of downtime used to PAGE on a 60-minute burn rule.
   *
   * computeTimeSli clamps its denominator forward to the earliest observed
   * event. Inside a fixed-length burn window that silently turns the denominator
   * into the DATA AGE: 20s/3600s (5.6x burn, below a 14.4x page threshold)
   * becomes 20s/300s (66.7x, far above it). Both the long and the short window
   * then measure the same few minutes, both breach, and the multi-window rule -
   * whose entire purpose is to demand SUSTAINED evidence before paging - pages on
   * seconds of data. Every freshly created SLO + monitor pair paged on its first
   * blip.
   *
   * The fix is a gate, not a change to the clamp: EvaluateSlos.evaluateBurnRateRule
   * calls getEarliestEventStartDate and SKIPS the rule when the earliest observed
   * data is AFTER (now - longWindowInMinutes). These tests pin both halves - the
   * gate's answer, and the math that makes the gate necessary.
   */
  describe("getEarliestEventStartDate: the young-monitor false-page regression", () => {
    const SIXTY_MINUTE_WINDOW: UptimeWindow = {
      startDate: new Date("2026-07-18T23:00:00.000Z"),
      endDate: NOW,
    };

    // first ever row is 5 minutes old and carries 20 seconds of downtime.
    const youngMonitor: Array<{
      monitorId: ObjectID;
      timelines: Array<MonitorStatusTimeline>;
    }> = [
      {
        monitorId: MONITOR_A_ID,
        timelines: [
          offline(
            MONITOR_A_ID,
            "2026-07-18T23:55:00.000Z",
            "2026-07-18T23:55:20.000Z",
          ),
          operational(MONITOR_A_ID, "2026-07-18T23:55:20.000Z"),
        ],
      },
    ];

    it("reports data as only 5 minutes old, i.e. AFTER the start of a 60-minute window - the exact condition the worker skips on", () => {
      const earliest: Date | null = SloUtil.getEarliestEventStartDate(
        youngMonitor,
        SIXTY_MINUTE_WINDOW,
      );

      expect(earliest!.toISOString()).toBe("2026-07-18T23:55:00.000Z");

      // the worker's gate, expressed exactly as EvaluateSlos computes it.
      const longWindowStart: Date = new Date(NOW.getTime() - 60 * 60 * 1000);

      expect(earliest!.getTime()).toBeGreaterThan(longWindowStart.getTime());

      const shouldSkipRule: boolean =
        !earliest || earliest.getTime() > longWindowStart.getTime();

      expect(shouldSkipRule).toBe(true);
    });

    it("a monitor with a full hour of history does NOT trip the gate", () => {
      const earliest: Date | null = SloUtil.getEarliestEventStartDate(
        [
          {
            monitorId: MONITOR_A_ID,
            timelines: [operational(MONITOR_A_ID, "2026-07-18T20:00:00.000Z")],
          },
        ],
        SIXTY_MINUTE_WINDOW,
      );

      const longWindowStart: Date = new Date(NOW.getTime() - 60 * 60 * 1000);

      // clipped to the window start, which is exactly the long window start.
      expect(earliest!.getTime()).toBe(longWindowStart.getTime());
      expect(earliest!.getTime()).not.toBeGreaterThan(
        longWindowStart.getTime(),
      );
    });

    it("documents WHY the gate exists: the 60-minute denominator collapses to 300 seconds of data age, not 3600", () => {
      const sli: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines: youngMonitor,
        downtimeStatuses,
        window: SIXTY_MINUTE_WINDOW,
        mode: SloMultiMonitorMode.AnyDown,
      });

      // NOT 3600 - the clamp is still there, which is why the gate is needed.
      expect(sli.totalSeconds).toBe(300);
      expect(sli.badSeconds).toBe(20);
      expect(sli.sliPercentage).toBeCloseTo(93.3333333333, 8);
    });

    it("documents the false page: 20s of downtime reads as 66.7x burn instead of 5.6x, crossing a 14.4x page threshold", () => {
      const sli: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines: youngMonitor,
        downtimeStatuses,
        window: SIXTY_MINUTE_WINDOW,
        mode: SloMultiMonitorMode.AnyDown,
      });

      const collapsedBurnRate: number = SloUtil.computeBurnRate({
        badSeconds: sli.badSeconds,
        totalSeconds: sli.totalSeconds,
        targetPercentage: 99.9,
      });

      const honestBurnRate: number = SloUtil.computeBurnRate({
        badSeconds: 20,
        totalSeconds: 60 * 60,
        targetPercentage: 99.9,
      });

      expect(collapsedBurnRate).toBeCloseTo(66.6666666667, 6);
      expect(honestBurnRate).toBeCloseTo(5.5555555556, 6);

      // the canonical fast-burn page threshold sits between the two.
      const PAGE_THRESHOLD: number = 14.4;

      expect(collapsedBurnRate).toBeGreaterThan(PAGE_THRESHOLD);
      expect(honestBurnRate).toBeLessThan(PAGE_THRESHOLD);
    });

    it("the same 20 seconds inside a monitor that HAS an hour of history stays below the page threshold", () => {
      const oldMonitor: Array<{
        monitorId: ObjectID;
        timelines: Array<MonitorStatusTimeline>;
      }> = [
        {
          monitorId: MONITOR_A_ID,
          timelines: [
            operational(
              MONITOR_A_ID,
              "2026-07-18T12:00:00.000Z",
              "2026-07-18T23:55:00.000Z",
            ),
            offline(
              MONITOR_A_ID,
              "2026-07-18T23:55:00.000Z",
              "2026-07-18T23:55:20.000Z",
            ),
            operational(MONITOR_A_ID, "2026-07-18T23:55:20.000Z"),
          ],
        },
      ];

      const sli: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines: oldMonitor,
        downtimeStatuses,
        window: SIXTY_MINUTE_WINDOW,
        mode: SloMultiMonitorMode.AnyDown,
      });

      expect(sli.totalSeconds).toBe(3600);
      expect(sli.badSeconds).toBe(20);
      expect(
        SloUtil.computeBurnRate({
          badSeconds: sli.badSeconds,
          totalSeconds: sli.totalSeconds,
          targetPercentage: 99.9,
        }),
      ).toBeCloseTo(5.5555555556, 6);
    });
  });

  describe("computeTimeSli: the zero-data contract the worker guards on", () => {
    it("returns exactly {0, 0, 100} for no rows at all - which EvaluateSlos must treat as Misconfigured, never as a healthy 100%", () => {
      /*
       * The 100 here is NOT a measurement: there is nothing to measure. The
       * zero-data guard in App/FeatureSet/Workers/Jobs/Slo/EvaluateSlos.ts
       * (`if (sli.totalSeconds === 0)`) turns this into SloStatus.Misconfigured
       * and writes no history row - without it, an enabled SLO whose monitor has
       * never written a MonitorStatusTimeline row would persist as Healthy with
       * currentSliPercentage 100, a full error budget, and sli.percent = 100
       * charts: a green SLO that measures nothing.
       */
      const result: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines: [{ monitorId: MONITOR_A_ID, timelines: [] }],
        downtimeStatuses,
        window: {
          startDate: new Date("2026-07-01T00:00:00.000Z"),
          endDate: new Date("2026-07-11T00:00:00.000Z"),
        },
        mode: SloMultiMonitorMode.AnyDown,
      });

      expect(result).toEqual({
        badSeconds: 0,
        totalSeconds: 0,
        sliPercentage: 100,
      });

      // the budget derived from it is empty too - nothing to spend, nothing spent.
      expect(
        SloUtil.getErrorBudget({
          badSeconds: result.badSeconds,
          totalSeconds: result.totalSeconds,
          targetPercentage: 99.9,
        }).budgetTotalSeconds,
      ).toBe(0);
    });

    it("returns totalSeconds 0 for a window whose whole length is in the future", () => {
      // pinned now is 19 July: a window that starts tomorrow has no elapsed time.
      const result: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines: [
          {
            monitorId: MONITOR_A_ID,
            timelines: [operational(MONITOR_A_ID, "2026-07-01T00:00:00.000Z")],
          },
        ],
        downtimeStatuses,
        window: {
          startDate: new Date("2026-07-20T00:00:00.000Z"),
          endDate: new Date("2026-07-21T00:00:00.000Z"),
        },
        mode: SloMultiMonitorMode.AnyDown,
      });

      expect(result).toEqual({
        badSeconds: 0,
        totalSeconds: 0,
        sliPercentage: 100,
      });
    });
  });

  describe("computeTimeSli: AnyDown vs MonitorSecondsAverage denominator anchoring", () => {
    /*
     * One old monitor (data since 1 June, always up) and one young monitor
     * (created 18 July, down ever since). The two modes anchor their
     * denominators differently and MUST disagree:
     *
     * - AnyDown anchors the WHOLE SLO at the earliest event across monitors, so
     *   the old monitor's history extends the window the young monitor is judged
     *   over.
     * - MonitorSecondsAverage anchors PER MONITOR, so the young monitor only
     *   contributes the seconds it has actually existed for.
     */
    const window: UptimeWindow = {
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      endDate: new Date("2026-07-19T00:00:00.000Z"),
    };

    const perMonitorTimelines: Array<{
      monitorId: ObjectID;
      timelines: Array<MonitorStatusTimeline>;
    }> = [
      {
        monitorId: MONITOR_A_ID,
        timelines: [operational(MONITOR_A_ID, "2026-06-01T00:00:00.000Z")],
      },
      {
        monitorId: MONITOR_B_ID,
        timelines: [offline(MONITOR_B_ID, "2026-07-18T00:00:00.000Z")],
      },
    ];

    it("AnyDown measures the young monitor's outage over the OLD monitor's 18-day window", () => {
      const result: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines,
        downtimeStatuses,
        window,
        mode: SloMultiMonitorMode.AnyDown,
      });

      expect(result.totalSeconds).toBe(18 * SECONDS_IN_DAY);
      expect(result.badSeconds).toBe(SECONDS_IN_DAY);
      expect(result.sliPercentage).toBeCloseTo((17 / 18) * 100, 10);
    });

    it("MonitorSecondsAverage sums a per-monitor denominator, so the young monitor only contributes its own day", () => {
      const result: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines,
        downtimeStatuses,
        window,
        mode: SloMultiMonitorMode.MonitorSecondsAverage,
      });

      // 18 days (A, clipped to the window) + 1 day (B, clamped to its first event).
      expect(result.totalSeconds).toBe(19 * SECONDS_IN_DAY);
      expect(result.badSeconds).toBe(SECONDS_IN_DAY);
      expect(result.sliPercentage).toBeCloseTo((1 - 1 / 19) * 100, 10);
    });

    it("the two modes really do disagree on this input (94.44% vs 94.74%)", () => {
      const anyDown: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines,
        downtimeStatuses,
        window,
        mode: SloMultiMonitorMode.AnyDown,
      });

      const average: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines,
        downtimeStatuses,
        window,
        mode: SloMultiMonitorMode.MonitorSecondsAverage,
      });

      expect(anyDown.sliPercentage).toBeCloseTo(94.4444444444, 8);
      expect(average.sliPercentage).toBeCloseTo(94.7368421053, 8);
      expect(average.sliPercentage).toBeGreaterThan(anyDown.sliPercentage);
    });
  });

  describe("interval union edge cases", () => {
    const window: UptimeWindow = {
      startDate: new Date("2026-07-18T09:00:00.000Z"),
      endDate: new Date("2026-07-18T14:00:00.000Z"),
    };

    it("merges exactly-touching intervals (end === next start) into ONE interval", () => {
      const merged: Array<DowntimeInterval> = SloUtil.mergeIntervals([
        {
          startDate: new Date("2026-07-18T10:00:00.000Z"),
          endDate: new Date("2026-07-18T10:30:00.000Z"),
        },
        {
          startDate: new Date("2026-07-18T10:30:00.000Z"),
          endDate: new Date("2026-07-18T11:00:00.000Z"),
        },
      ]);

      expect(merged).toHaveLength(1);
      expect(merged[0]!.startDate.toISOString()).toBe(
        "2026-07-18T10:00:00.000Z",
      );
      expect(merged[0]!.endDate.toISOString()).toBe("2026-07-18T11:00:00.000Z");
    });

    it("absorbs a fully nested interval instead of extending or splitting the outer one", () => {
      const merged: Array<DowntimeInterval> = SloUtil.mergeIntervals([
        {
          startDate: new Date("2026-07-18T10:00:00.000Z"),
          endDate: new Date("2026-07-18T12:00:00.000Z"),
        },
        {
          startDate: new Date("2026-07-18T10:30:00.000Z"),
          endDate: new Date("2026-07-18T11:00:00.000Z"),
        },
        {
          startDate: new Date("2026-07-18T11:15:00.000Z"),
          endDate: new Date("2026-07-18T11:30:00.000Z"),
        },
      ]);

      expect(merged).toHaveLength(1);
      expect(merged[0]!.startDate.toISOString()).toBe(
        "2026-07-18T10:00:00.000Z",
      );
      expect(merged[0]!.endDate.toISOString()).toBe("2026-07-18T12:00:00.000Z");
    });

    it("drops an inverted interval whose end precedes its start", () => {
      expect(
        SloUtil.mergeIntervals([
          {
            startDate: new Date("2026-07-18T12:00:00.000Z"),
            endDate: new Date("2026-07-18T11:00:00.000Z"),
          },
        ]),
      ).toHaveLength(0);
    });

    it("counts overlapping down rows of ONE monitor once: 10:00-11:00 plus 10:30-11:30 is 5400s, not 7200s", () => {
      /*
       * Duplicate/overlapping rows for a single monitor do happen (retried
       * writes, probe races). The union must not double-count them.
       */
      expect(
        SloUtil.getUnionDowntimeSeconds(
          [
            {
              monitorId: MONITOR_A_ID,
              timelines: [
                offline(
                  MONITOR_A_ID,
                  "2026-07-18T10:00:00.000Z",
                  "2026-07-18T11:00:00.000Z",
                ),
                offline(
                  MONITOR_A_ID,
                  "2026-07-18T10:30:00.000Z",
                  "2026-07-18T11:30:00.000Z",
                ),
              ],
            },
          ],
          downtimeStatuses,
          window,
        ),
      ).toBe(5400);
    });

    it("counts a down row fully nested inside another down row of the same monitor once", () => {
      expect(
        SloUtil.getUnionDowntimeSeconds(
          [
            {
              monitorId: MONITOR_A_ID,
              timelines: [
                offline(
                  MONITOR_A_ID,
                  "2026-07-18T10:00:00.000Z",
                  "2026-07-18T12:00:00.000Z",
                ),
                offline(
                  MONITOR_A_ID,
                  "2026-07-18T10:30:00.000Z",
                  "2026-07-18T11:00:00.000Z",
                ),
              ],
            },
          ],
          downtimeStatuses,
          window,
        ),
      ).toBe(2 * SECONDS_IN_HOUR);
    });

    it("chains three monitors whose outages touch end-to-start into one continuous 3600s outage", () => {
      expect(
        SloUtil.getUnionDowntimeSeconds(
          [
            {
              monitorId: MONITOR_A_ID,
              timelines: [
                offline(
                  MONITOR_A_ID,
                  "2026-07-18T10:00:00.000Z",
                  "2026-07-18T10:20:00.000Z",
                ),
              ],
            },
            {
              monitorId: MONITOR_B_ID,
              timelines: [
                offline(
                  MONITOR_B_ID,
                  "2026-07-18T10:20:00.000Z",
                  "2026-07-18T10:40:00.000Z",
                ),
              ],
            },
            {
              monitorId: MONITOR_C_ID,
              timelines: [
                offline(
                  MONITOR_C_ID,
                  "2026-07-18T10:40:00.000Z",
                  "2026-07-18T11:00:00.000Z",
                ),
              ],
            },
          ],
          downtimeStatuses,
          window,
        ),
      ).toBe(SECONDS_IN_HOUR);
    });
  });

  describe("getErrorBudget edge cases", () => {
    it("reports a full untouched budget when totalSeconds is 0 and only an SLI percentage is given", () => {
      // the no-elapsed-window short circuit runs before either input is used.
      expect(
        SloUtil.getErrorBudget({
          sliPercentage: 42,
          totalSeconds: 0,
          targetPercentage: 99.9,
        }),
      ).toEqual({
        budgetTotalSeconds: 0,
        budgetConsumedSeconds: 0,
        budgetRemainingSeconds: 0,
        budgetRemainingPercentage: 100,
      });
    });

    it("prefers badSeconds over sliPercentage when both are supplied", () => {
      // 99% target over 86400s: 864s of budget; badSeconds says 432s were spent.
      const budget: ErrorBudgetResult = SloUtil.getErrorBudget({
        badSeconds: 432,
        sliPercentage: 50,
        totalSeconds: SECONDS_IN_DAY,
        targetPercentage: 99,
      });

      expect(budget.budgetConsumedSeconds).toBe(432);
      expect(budget.budgetRemainingSeconds).toBeCloseTo(432, 6);
      expect(budget.budgetRemainingPercentage).toBeCloseTo(50, 6);
    });

    it("reports a signed overage of exactly -1136s / -131.48% when 2000s burn a 864s budget", () => {
      // 99% target over one day: budget is 864s and 2000s of downtime blew it.
      const budget: ErrorBudgetResult = SloUtil.getErrorBudget({
        badSeconds: 2000,
        totalSeconds: SECONDS_IN_DAY,
        targetPercentage: 99,
      });

      expect(budget.budgetTotalSeconds).toBeCloseTo(864, 6);
      expect(budget.budgetConsumedSeconds).toBe(2000);
      expect(budget.budgetRemainingSeconds).toBeCloseTo(-1136, 6);
      expect(budget.budgetRemainingPercentage).toBeCloseTo(-131.4814814815, 8);
    });

    it("reports exactly 0% remaining when the budget is consumed to the last second", () => {
      const budget: ErrorBudgetResult = SloUtil.getErrorBudget({
        badSeconds: 864,
        totalSeconds: SECONDS_IN_DAY,
        targetPercentage: 99,
      });

      expect(budget.budgetRemainingSeconds).toBeCloseTo(0, 6);
      expect(budget.budgetRemainingPercentage).toBeCloseTo(0, 6);
    });

    it("keeps a fractional 99.99% target honest: 8.64s of budget in a day", () => {
      const budget: ErrorBudgetResult = SloUtil.getErrorBudget({
        badSeconds: 4.32,
        totalSeconds: SECONDS_IN_DAY,
        targetPercentage: 99.99,
      });

      expect(budget.budgetTotalSeconds).toBeCloseTo(8.64, 6);
      expect(budget.budgetRemainingSeconds).toBeCloseTo(4.32, 6);
      expect(budget.budgetRemainingPercentage).toBeCloseTo(50, 6);
    });
  });

  describe("computeBurnRate edge cases", () => {
    it.each([
      [99.9, 1000],
      [99.5, 200],
      [99, 100],
      [95, 20],
    ])(
      "a total outage at a %s%% target burns exactly %sx (1 / allowedBadFraction)",
      (targetPercentage: number, expectedBurnRate: number) => {
        expect(
          SloUtil.computeBurnRate({
            badSeconds: 3600,
            totalSeconds: 3600,
            targetPercentage,
          }),
        ).toBeCloseTo(expectedBurnRate, 6);
      },
    );

    it("burns 2x against a fractional 99.5% target when 1% of the window is bad", () => {
      expect(
        SloUtil.computeBurnRate({
          badSeconds: 36,
          totalSeconds: 3600,
          targetPercentage: 99.5,
        }),
      ).toBeCloseTo(2, 10);
    });

    it("burns 100x against a fractional 99.99% target when 1% of the window is bad", () => {
      expect(
        SloUtil.computeBurnRate({
          badSeconds: 36,
          totalSeconds: 3600,
          targetPercentage: 99.99,
        }),
      ).toBeCloseTo(100, 8);
    });

    it("returns 0 for an empty window even when badSeconds is non-zero (no denominator, no evidence)", () => {
      expect(
        SloUtil.computeBurnRate({
          badSeconds: 42,
          totalSeconds: 0,
          targetPercentage: 99.9,
        }),
      ).toBe(0);
    });

    it("crosses the canonical 14.4x page threshold at exactly 1.44% of a 99.9% window", () => {
      // 51.84s of a 3600s hour = 1.44%; the 30-day fast-burn threshold is 14.4x.
      expect(
        SloUtil.computeBurnRate({
          badSeconds: 51.84,
          totalSeconds: 3600,
          targetPercentage: 99.9,
        }),
      ).toBeCloseTo(14.4, 6);
    });
  });

  describe("computeSloStatus: the full hysteresis band walk (threshold 20)", () => {
    type BandStep = { remaining: number; expected: SloStatus };

    it("walks Healthy -> AtRisk -> (held AtRisk inside the 20-25 band) -> Healthy without flapping", () => {
      const steps: Array<BandStep> = [
        { remaining: 80, expected: SloStatus.Healthy },
        { remaining: 25, expected: SloStatus.Healthy },
        { remaining: 20.000001, expected: SloStatus.Healthy },
        // enters at <= threshold.
        { remaining: 20, expected: SloStatus.AtRisk },
        { remaining: 12, expected: SloStatus.AtRisk },
        // held through the whole band above the threshold.
        { remaining: 20.5, expected: SloStatus.AtRisk },
        { remaining: 22, expected: SloStatus.AtRisk },
        { remaining: 24.999999, expected: SloStatus.AtRisk },
        // exits only at threshold + 5.
        { remaining: 25, expected: SloStatus.Healthy },
        { remaining: 24.999999, expected: SloStatus.Healthy },
      ];

      let status: SloStatus = SloStatus.Healthy;

      for (const step of steps) {
        status = SloUtil.computeSloStatus({
          budgetRemainingPercentage: step.remaining,
          currentStatus: status,
          atRiskThresholdPercentage: 20,
        });

        expect(status).toBe(step.expected);
      }
    });

    it("enters BudgetExhausted at exactly 0 and holds it until the budget reaches 2%", () => {
      const steps: Array<BandStep> = [
        { remaining: 0.1, expected: SloStatus.AtRisk },
        // enters at <= 0.
        { remaining: 0, expected: SloStatus.BudgetExhausted },
        { remaining: -55, expected: SloStatus.BudgetExhausted },
        // held all the way up to (but not including) 2.
        { remaining: 0.5, expected: SloStatus.BudgetExhausted },
        { remaining: 1.999999, expected: SloStatus.BudgetExhausted },
        // exits at exactly 2 - into AtRisk, still under the at-risk threshold.
        { remaining: 2, expected: SloStatus.AtRisk },
      ];

      let status: SloStatus = SloStatus.Healthy;

      for (const step of steps) {
        status = SloUtil.computeSloStatus({
          budgetRemainingPercentage: step.remaining,
          currentStatus: status,
          atRiskThresholdPercentage: 20,
        });

        expect(status).toBe(step.expected);
      }
    });

    it("does not flap while a rolling window oscillates around 0% remaining", () => {
      // bad seconds ageing out of a rolling window re-cross 0 repeatedly.
      let status: SloStatus = SloStatus.BudgetExhausted;

      for (const remaining of [-2, 0, 1, 0.2, 1.99, -0.5, 1.5]) {
        status = SloUtil.computeSloStatus({
          budgetRemainingPercentage: remaining,
          currentStatus: status,
          atRiskThresholdPercentage: 20,
        });

        expect(status).toBe(SloStatus.BudgetExhausted);
      }

      // only a real recovery past 2% clears it.
      expect(
        SloUtil.computeSloStatus({
          budgetRemainingPercentage: 2.5,
          currentStatus: status,
          atRiskThresholdPercentage: 20,
        }),
      ).toBe(SloStatus.AtRisk);
    });

    it("a full recovery jumps straight from BudgetExhausted to Healthy in one step", () => {
      expect(
        SloUtil.computeSloStatus({
          budgetRemainingPercentage: 100,
          currentStatus: SloStatus.BudgetExhausted,
          atRiskThresholdPercentage: 20,
        }),
      ).toBe(SloStatus.Healthy);
    });

    it("honours a custom at-risk threshold of 50 for both entry and the 55% exit", () => {
      expect(
        SloUtil.computeSloStatus({
          budgetRemainingPercentage: 50,
          currentStatus: SloStatus.Healthy,
          atRiskThresholdPercentage: 50,
        }),
      ).toBe(SloStatus.AtRisk);

      expect(
        SloUtil.computeSloStatus({
          budgetRemainingPercentage: 54.9,
          currentStatus: SloStatus.AtRisk,
          atRiskThresholdPercentage: 50,
        }),
      ).toBe(SloStatus.AtRisk);

      expect(
        SloUtil.computeSloStatus({
          budgetRemainingPercentage: 55,
          currentStatus: SloStatus.AtRisk,
          atRiskThresholdPercentage: 50,
        }),
      ).toBe(SloStatus.Healthy);
    });

    it("a threshold of 0 leaves only the exhausted band, so 0.5% remaining is still Healthy", () => {
      expect(
        SloUtil.computeSloStatus({
          budgetRemainingPercentage: 0.5,
          currentStatus: SloStatus.Healthy,
          atRiskThresholdPercentage: 0,
        }),
      ).toBe(SloStatus.Healthy);

      expect(
        SloUtil.computeSloStatus({
          budgetRemainingPercentage: 0,
          currentStatus: SloStatus.Healthy,
          atRiskThresholdPercentage: 0,
        }),
      ).toBe(SloStatus.BudgetExhausted);
    });
  });

  describe("getCalendarMonthWindow: full-period denominators and zone edges", () => {
    it("reports the FULL month, not the elapsed part, ten minutes into the 1st", () => {
      /*
       * The budget denominator is fixed at period start. If it were elapsed
       * time, a one-minute blip at 00:10 on the 1st would read as instant budget
       * exhaustion (60s against a 600s window).
       */
      const window: CalendarMonthWindow = SloUtil.getCalendarMonthWindow({
        at: new Date("2026-07-01T00:10:00.000Z"),
        timezone: "UTC",
      });

      expect(window.startDate.toISOString()).toBe("2026-07-01T00:00:00.000Z");
      expect(window.totalSecondsInFullPeriod).toBe(31 * SECONDS_IN_DAY);
      expect(window.totalSecondsInFullPeriod).not.toBe(600);
    });

    it("reports the FULL month on the last second of the month too", () => {
      const window: CalendarMonthWindow = SloUtil.getCalendarMonthWindow({
        at: new Date("2026-07-31T23:59:59.000Z"),
        timezone: "UTC",
      });

      expect(window.totalSecondsInFullPeriod).toBe(31 * SECONDS_IN_DAY);
    });

    it("gets a 28-day February right in a non-UTC zone with a half-hour offset", () => {
      // Asia/Kolkata is UTC+5:30 year round: the month starts at 18:30 UTC.
      const window: CalendarMonthWindow = SloUtil.getCalendarMonthWindow({
        at: new Date("2027-02-14T00:00:00.000Z"),
        timezone: "Asia/Kolkata",
      });

      expect(window.startDate.toISOString()).toBe("2027-01-31T18:30:00.000Z");
      expect(window.endDate.toISOString()).toBe("2027-02-28T18:30:00.000Z");
      expect(window.totalSecondsInFullPeriod).toBe(28 * SECONDS_IN_DAY);
    });

    it("a fall-back DST month in New York is one real hour LONGER than 30 days", () => {
      // November 2026 falls back on 1 November: 30 days + 3600 real seconds.
      const window: CalendarMonthWindow = SloUtil.getCalendarMonthWindow({
        at: new Date("2026-11-15T12:00:00.000Z"),
        timezone: "America/New_York",
      });

      expect(window.startDate.toISOString()).toBe("2026-11-01T04:00:00.000Z");
      expect(window.endDate.toISOString()).toBe("2026-12-01T05:00:00.000Z");
      expect(window.totalSecondsInFullPeriod).toBe(
        30 * SECONDS_IN_DAY + SECONDS_IN_HOUR,
      );
    });

    it("a spring-forward month in New York loses an hour of real budget denominator", () => {
      const marchWindow: CalendarMonthWindow = SloUtil.getCalendarMonthWindow({
        at: new Date("2026-03-15T12:00:00.000Z"),
        timezone: "America/New_York",
      });

      const utcMarchWindow: CalendarMonthWindow =
        SloUtil.getCalendarMonthWindow({
          at: new Date("2026-03-15T12:00:00.000Z"),
          timezone: "UTC",
        });

      expect(
        utcMarchWindow.totalSecondsInFullPeriod -
          marchWindow.totalSecondsInFullPeriod,
      ).toBe(SECONDS_IN_HOUR);
    });

    it("defaults to UTC when no timezone is supplied", () => {
      expect(
        SloUtil.getCalendarMonthWindow({
          at: new Date("2026-03-15T12:00:00.000Z"),
        }).startDate.toISOString(),
      ).toBe(
        SloUtil.getCalendarMonthWindow({
          at: new Date("2026-03-15T12:00:00.000Z"),
          timezone: "UTC",
        }).startDate.toISOString(),
      );
    });
  });
});
