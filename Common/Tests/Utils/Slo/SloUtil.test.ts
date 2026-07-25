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
});
