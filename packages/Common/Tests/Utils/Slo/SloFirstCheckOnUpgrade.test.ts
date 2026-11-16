import SloUtil, {
  ErrorBudgetResult,
  MonitorTimelineSet,
  TimeSliResult,
} from "../../../Utils/Slo/SloUtil";
import TimeBeforeFirstCheck from "../../../Utils/Uptime/TimeBeforeFirstCheck";
import UptimeUtil, { UptimeWindow } from "../../../Utils/Uptime/UptimeUtil";
import MonitorEvent from "../../../Utils/Uptime/MonitorEvent";
import MonitorFirstCheck from "../../../Utils/Monitor/MonitorFirstCheck";
import {
  SloRecommendedBurnRateRule,
  getSloRecommendedBurnRateRules,
} from "../../../Utils/Slo/SloRecommendedBurnRateRules";
import { SLO_CURRENT_BURN_RATE_WINDOW_MINUTES } from "../../../Utils/Slo/SloEvaluation";
import { Blue, Green, Red, Yellow } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import SloMultiMonitorMode from "../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * AN SLO ON UPGRADE, AND ON DRAWN TIMELINES (issue #9031).
 *
 * An SLO now leaves out the time before each monitor's first check, as
 * status pages leave it out of uptime (#8960). That must not move an SLO on
 * upgrade: no burn rate rule may fire, hold or resolve, no status change and
 * no error budget figure move, because of how the upgrade stamps
 * Monitor.firstMeasuredAt. Two things hold that:
 *
 *   - Until BackfillMonitorFirstMeasuredAtForUptimeHistory has run, every
 *     monitor counts from the start (MonitorFirstCheck.getMeasuredFrom with
 *     isUptimeHistoryReady false). A result that came back during the
 *     upgrade stamps its monitor with the upgrade's time, and read as it is
 *     that would leave the monitor's whole history out: below, the same
 *     timelines read that way move most SLOs, which is what the wait is for.
 *   - Once it has run, every monitor something had checked before the
 *     upgrade holds the time it was created, and its rows start a moment
 *     after that (the service writes a monitor's first status row once the
 *     monitor is saved), so nothing is left out: the SLO reads exactly what
 *     it read before.
 *
 * Each drawn SLO is evaluated as the worker evaluates it
 * (Workers/Jobs/Slo/EvaluateSlos): its rows read as SloMonitorTimelines
 * reads them, over the window the worker fetches; its SLI and error budget
 * over its compliance window (a rolling one, or a calendar month in one of
 * nine zones, at instants by midnights and clock changes in them); the
 * status that budget moves it to from each status it can be in; the burn
 * rate over the current window and over both windows of each of its
 * recommended rules; and what each rule then does - fire, hold or resolve -
 * with the full-long-window gate. Before and after must be the same, figure
 * for figure.
 *
 * Then the new reading itself, on timelines whose monitors were first
 * checked after they were created, or never: held to a reference written
 * apart from SloUtil - each monitor's events cut at its first check one by
 * one, and the SLI measured over their union - so the time before a first
 * check is left out exactly, in every zone and window.
 */

const SECOND_MS: number = 1000;
const MINUTE_MS: number = 60 * SECOND_MS;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

function makeStatus(data: {
  id: string;
  name: string;
  priority: number;
  color: Color;
  isOperationalState: boolean;
  isOfflineState: boolean;
}): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status.id = new ObjectID(data.id);
  status.name = data.name;
  status.priority = data.priority;
  status.color = data.color;
  status.isOperationalState = data.isOperationalState;
  status.isOfflineState = data.isOfflineState;
  return status;
}

const OPERATIONAL: MonitorStatus = makeStatus({
  id: "90312000-0000-4000-8000-000000000001",
  name: "Operational",
  priority: 1,
  color: Green,
  isOperationalState: true,
  isOfflineState: false,
});
const DEGRADED: MonitorStatus = makeStatus({
  id: "90312000-0000-4000-8000-000000000002",
  name: "Degraded",
  priority: 2,
  color: Yellow,
  isOperationalState: false,
  isOfflineState: false,
});
const OFFLINE: MonitorStatus = makeStatus({
  id: "90312000-0000-4000-8000-000000000003",
  name: "Offline",
  priority: 3,
  color: Red,
  isOperationalState: false,
  isOfflineState: true,
});
// A project's own status flagged both ways: recorded, not started in.
const PARTLY_OPERATIONAL: MonitorStatus = makeStatus({
  id: "90312000-0000-4000-8000-000000000004",
  name: "Partly operational",
  priority: 4,
  color: Blue,
  isOperationalState: true,
  isOfflineState: true,
});

const EVERY_STATUS: Array<MonitorStatus> = [
  OPERATIONAL,
  DEGRADED,
  OFFLINE,
  PARTLY_OPERATIONAL,
];

function statusById(statusId: string): MonitorStatus {
  return EVERY_STATUS.find((status: MonitorStatus): boolean => {
    return status.id!.toString() === statusId;
  })!;
}

/*
 * The zones a calendar month is cut in: whole and half hours, three
 * quarters of an hour, a half-hour daylight saving change (Lord Howe), a
 * clock that changes at midnight (Santiago), the date line's other side.
 */
const ZONES: Array<string> = [
  "UTC",
  "America/New_York",
  "Europe/London",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Australia/Lord_Howe",
  "America/Santiago",
  "Pacific/Chatham",
  "Pacific/Auckland",
];

/*
 * When the SLO is evaluated: by month starts and clock changes in the zones
 * above, and on ordinary days.
 */
const EVALUATION_INSTANTS: Array<Date> = [
  // The US moves its clocks forward; New York's March is 23 hours short.
  new Date("2026-03-08T07:30:00.000Z"),
  // Europe moves forward an hour later in the month.
  new Date("2026-03-29T01:30:00.000Z"),
  // Lord Howe and Santiago fall back, Auckland and Chatham too.
  new Date("2026-04-05T03:30:00.000Z"),
  // Minutes into April in UTC, hours into it further east.
  new Date("2026-04-01T00:20:00.000Z"),
  // New Zealand and Chatham move forward.
  new Date("2026-09-27T14:15:00.000Z"),
  // Lord Howe moves forward half an hour.
  new Date("2026-10-04T15:45:00.000Z"),
  // The US falls back on the first of November.
  new Date("2026-11-01T06:10:00.000Z"),
  new Date("2026-11-16T12:00:00.000Z"),
  // Minutes before December in UTC, already December east of it.
  new Date("2026-11-30T23:50:00.000Z"),
  new Date("2026-07-15T09:41:00.000Z"),
];

const TARGETS: Array<number> = [95, 99, 99.5, 99.9, 99.95];

const AT_RISK_THRESHOLD_PERCENTAGE: number = 25;

interface DrawnMonitor {
  monitorId: ObjectID;
  monitorType: MonitorType;
  createdAt: Date;
  rows: Array<MonitorStatusTimeline>;
}

interface DrawnSlo {
  now: Date;
  monitors: Array<DrawnMonitor>;
  mode: SloMultiMonitorMode;
  targetPercentage: number;
  windowType: SloWindowType;
  windowDays: number;
  timezone: string;
  downtimeStatuses: Array<MonitorStatus>;
}

function monitorIdOf(slo: number, monitor: number): ObjectID {
  return new ObjectID(
    `9031c000-${String(slo).padStart(4, "0")}-4000-8000-${String(monitor).padStart(12, "0")}`,
  );
}

function makeRow(data: {
  monitorId: ObjectID;
  status: MonitorStatus;
  startsAt: number;
  endsAt: number | null;
  isMonitoringOff: boolean;
}): MonitorStatusTimeline {
  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
  timeline.monitorId = data.monitorId;
  timeline.monitorStatusId = data.status.id!;
  timeline.monitorStatus = data.status;
  timeline.startsAt = new Date(data.startsAt);
  timeline.isMonitoringOff = data.isMonitoringOff;

  if (data.endsAt !== null) {
    timeline.endsAt = new Date(data.endsAt);
  }

  return timeline;
}

/*
 * A monitor's whole timeline: created up to four months before `now`, its
 * first row a moment after, then rows back to back up to now, the last one
 * open. Mostly up; outages of minutes to days; now and then a burst of
 * flapping (a status a minute or less, for an hour or so); now and then its
 * monitoring off for a while, and back on.
 */
function drawMonitor(data: {
  random: SeededRandom;
  monitorId: ObjectID;
  now: number;
  monitorType: MonitorType;
}): DrawnMonitor {
  const random: SeededRandom = data.random;
  const createdAt: number =
    data.now - (2 * HOUR_MS + Math.round(random() * 120 * DAY_MS));

  const rows: Array<MonitorStatusTimeline> = [];
  let start: number = createdAt + random(500);
  let status: MonitorStatus = OPERATIONAL;
  let isMonitoringOff: boolean = false;
  let flappingUntil: number = 0;

  while (start < data.now) {
    let length: number;

    if (start < flappingUntil) {
      length = 5 * SECOND_MS + random(60) * SECOND_MS;
    } else if (status === OPERATIONAL && !isMonitoringOff) {
      length = Math.round(random() * random() * 20 * DAY_MS) + MINUTE_MS;
    } else {
      length = Math.round(random() * random() * 2 * DAY_MS) + SECOND_MS;
    }

    const end: number = start + length;
    const isLast: boolean = end >= data.now;

    rows.push(
      makeRow({
        monitorId: data.monitorId,
        status: status,
        startsAt: start,
        endsAt: isLast ? null : end,
        isMonitoringOff: isMonitoringOff,
      }),
    );

    if (isLast) {
      break;
    }

    start = end;

    const next: number = random(20);

    if (start >= flappingUntil && next === 0) {
      flappingUntil = start + Math.round(random() * 2 * HOUR_MS);
    }

    if (start < flappingUntil) {
      status = status === OPERATIONAL ? OFFLINE : OPERATIONAL;
      continue;
    }

    if (next === 1 || (isMonitoringOff && random(2) === 0)) {
      // Monitoring turned off, or back on, in the status it holds.
      isMonitoringOff = !isMonitoringOff;
      continue;
    }

    status =
      status === OPERATIONAL
        ? [DEGRADED, OFFLINE, OFFLINE, PARTLY_OPERATIONAL][random(4)]!
        : OPERATIONAL;
  }

  return {
    monitorId: data.monitorId,
    monitorType: data.monitorType,
    createdAt: new Date(createdAt),
    rows: rows,
  };
}

function drawSlo(random: SeededRandom, index: number): DrawnSlo {
  const now: Date = EVALUATION_INSTANTS[random(EVALUATION_INSTANTS.length)]!;
  const monitorCount: number = 1 + random(3);
  const monitors: Array<DrawnMonitor> = [];

  for (let monitor: number = 0; monitor < monitorCount; monitor++) {
    monitors.push(
      drawMonitor({
        random: random,
        monitorId: monitorIdOf(index, monitor),
        now: now.getTime(),
        monitorType: [
          MonitorType.Website,
          MonitorType.API,
          MonitorType.IncomingRequest,
          MonitorType.Ping,
          MonitorType.Manual,
        ][random(5)]!,
      }),
    );
  }

  return {
    now: now,
    monitors: monitors,
    mode:
      random(2) === 0
        ? SloMultiMonitorMode.AnyDown
        : SloMultiMonitorMode.MonitorSecondsAverage,
    targetPercentage: TARGETS[random(TARGETS.length)]!,
    windowType:
      random(2) === 0 ? SloWindowType.Rolling : SloWindowType.CalendarMonth,
    windowDays: [7, 28, 30][random(3)]!,
    timezone: ZONES[random(ZONES.length)]!,
    downtimeStatuses: random(2) === 0 ? [OFFLINE] : [OFFLINE, DEGRADED],
  };
}

// The compliance window, and a calendar month's whole budget base (EvaluateSlos.getComplianceWindow).
function complianceWindowOf(slo: DrawnSlo): {
  window: UptimeWindow;
  budgetTotalSecondsOverride: number | null;
} {
  if (slo.windowType === SloWindowType.CalendarMonth) {
    const month: {
      startDate: Date;
      endDate: Date;
      totalSecondsInFullPeriod: number;
    } = SloUtil.getCalendarMonthWindow({
      timezone: slo.timezone,
      at: slo.now,
    });

    return {
      window: { startDate: month.startDate, endDate: month.endDate },
      budgetTotalSecondsOverride: month.totalSecondsInFullPeriod,
    };
  }

  return {
    window: {
      startDate: new Date(slo.now.getTime() - slo.windowDays * DAY_MS),
      endDate: slo.now,
    },
    budgetTotalSecondsOverride: null,
  };
}

function rulesOf(slo: DrawnSlo): Array<SloRecommendedBurnRateRule> {
  return getSloRecommendedBurnRateRules({
    windowType: slo.windowType,
    windowDays: slo.windowDays,
  });
}

// What the worker reads its rows over: the window, and the longest lookback.
function fetchWindowOf(slo: DrawnSlo): UptimeWindow {
  const window: UptimeWindow = complianceWindowOf(slo).window;

  const longestLookbackInMinutes: number = Math.max(
    SLO_CURRENT_BURN_RATE_WINDOW_MINUTES,
    ...rulesOf(slo).map((rule: SloRecommendedBurnRateRule): number => {
      return rule.longWindowInMinutes;
    }),
  );

  return {
    startDate: new Date(
      Math.min(
        window.startDate.getTime(),
        slo.now.getTime() - longestLookbackInMinutes * MINUTE_MS,
      ),
    ),
    endDate: new Date(Math.max(window.endDate.getTime(), slo.now.getTime())),
  };
}

// The rows the fetch reads: started by its end, and ended at or after its start or open.
function rowsRead(
  rows: Array<MonitorStatusTimeline>,
  fetchWindow: UptimeWindow,
): Array<MonitorStatusTimeline> {
  return rows.filter((row: MonitorStatusTimeline): boolean => {
    return (
      row.startsAt!.getTime() <= fetchWindow.endDate.getTime() &&
      (!row.endsAt || row.endsAt.getTime() >= fetchWindow.startDate.getTime())
    );
  });
}

/*
 * The SLO's rows as SloMonitorTimelines hands them over, each monitor's
 * first check read as it reads it: `firstMeasuredAt` per monitor, and
 * whether the upgrade has put the column right for history. `cut` false is
 * the read before #9031: the rows as they came.
 */
function perMonitorTimelinesOf(data: {
  slo: DrawnSlo;
  cut: boolean;
  firstMeasuredAt: (monitor: DrawnMonitor) => Date | null;
  isUptimeHistoryReady: boolean;
}): Array<MonitorTimelineSet> {
  const fetchWindow: UptimeWindow = fetchWindowOf(data.slo);

  return data.slo.monitors.map((monitor: DrawnMonitor): MonitorTimelineSet => {
    const timelines: Array<MonitorStatusTimeline> = rowsRead(
      monitor.rows,
      fetchWindow,
    );

    if (!data.cut) {
      return { monitorId: monitor.monitorId, timelines: timelines };
    }

    return {
      monitorId: monitor.monitorId,
      timelines: TimeBeforeFirstCheck.markNotMonitored({
        monitorId: monitor.monitorId,
        timelines: timelines,
        measuredFrom: MonitorFirstCheck.getMeasuredFrom({
          monitor: {
            monitorType: monitor.monitorType,
            firstMeasuredAt: data.firstMeasuredAt(monitor),
          },
          isUptimeHistoryReady: data.isUptimeHistoryReady,
        }),
      }),
    };
  });
}

type RuleDecision = "fire" | "hold" | "resolve";

interface Evaluation {
  sli: TimeSliResult;
  // Null when the SLO measured no time: the worker marks it Misconfigured.
  budget: ErrorBudgetResult | null;
  // The status the budget moves the SLO to, from each status it may be in.
  nextStatuses: Array<SloStatus> | null;
  currentBurnRate: number | null;
  earliestData: number | null;
  rules: Array<{
    hasFullLongWindow: boolean;
    burnRateLong: number;
    burnRateShort: number;
    decision: RuleDecision;
  }> | null;
}

// Every figure the worker reads for a Monitor Uptime SLO, and what it does with them.
function evaluate(
  slo: DrawnSlo,
  perMonitorTimelines: Array<MonitorTimelineSet>,
): Evaluation {
  const compliance: {
    window: UptimeWindow;
    budgetTotalSecondsOverride: number | null;
  } = complianceWindowOf(slo);

  const sli: TimeSliResult = SloUtil.computeTimeSli({
    perMonitorTimelines: perMonitorTimelines,
    downtimeStatuses: slo.downtimeStatuses,
    window: compliance.window,
    mode: slo.mode,
  });

  if (sli.totalSeconds === 0) {
    return {
      sli: sli,
      budget: null,
      nextStatuses: null,
      currentBurnRate: null,
      earliestData: null,
      rules: null,
    };
  }

  const budget: ErrorBudgetResult = SloUtil.getErrorBudget({
    badSeconds: sli.badSeconds,
    totalSeconds:
      compliance.budgetTotalSecondsOverride !== null
        ? compliance.budgetTotalSecondsOverride
        : sli.totalSeconds,
    targetPercentage: slo.targetPercentage,
  });

  const burnRate: (lookbackInMinutes: number) => number = (
    lookbackInMinutes: number,
  ): number => {
    const lookback: TimeSliResult = SloUtil.computeTimeSli({
      perMonitorTimelines: perMonitorTimelines,
      downtimeStatuses: slo.downtimeStatuses,
      window: {
        startDate: new Date(slo.now.getTime() - lookbackInMinutes * MINUTE_MS),
        endDate: slo.now,
      },
      mode: slo.mode,
    });

    return SloUtil.computeBurnRate({
      badSeconds: lookback.badSeconds,
      totalSeconds: lookback.totalSeconds,
      targetPercentage: slo.targetPercentage,
    });
  };

  const earliestData: Date | null = SloUtil.getEarliestEventStartDate(
    perMonitorTimelines,
    fetchWindowOf(slo),
  );

  return {
    sli: sli,
    budget: budget,
    nextStatuses: [
      SloStatus.Healthy,
      SloStatus.AtRisk,
      SloStatus.BudgetExhausted,
    ].map((currentStatus: SloStatus): SloStatus => {
      return SloUtil.computeSloStatus({
        budgetRemainingPercentage: budget.budgetRemainingPercentage,
        currentStatus: currentStatus,
        atRiskThresholdPercentage: AT_RISK_THRESHOLD_PERCENTAGE,
      });
    }),
    currentBurnRate: burnRate(SLO_CURRENT_BURN_RATE_WINDOW_MINUTES),
    earliestData: earliestData ? earliestData.getTime() : null,
    rules: rulesOf(slo).map((rule: SloRecommendedBurnRateRule) => {
      const hasFullLongWindow: boolean = Boolean(
        earliestData &&
          earliestData.getTime() <=
            slo.now.getTime() - rule.longWindowInMinutes * MINUTE_MS,
      );
      const burnRateLong: number = burnRate(rule.longWindowInMinutes);
      const burnRateShort: number = burnRate(rule.shortWindowInMinutes);

      // EvaluateSlos.evaluateBurnRateRule.
      let decision: RuleDecision = "resolve";

      if (hasFullLongWindow && burnRateLong >= rule.burnRateThreshold) {
        decision = burnRateShort >= rule.burnRateThreshold ? "fire" : "hold";
      }

      return {
        hasFullLongWindow: hasFullLongWindow,
        burnRateLong: burnRateLong,
        burnRateShort: burnRateShort,
        decision: decision,
      };
    }),
  };
}

// Stamped by the backfills: every monitor something checked, from its creation.
function stampedWithCreation(monitor: DrawnMonitor): Date | null {
  return monitor.createdAt;
}

const SLO_COUNT: number = 200;

function drawSlos(seed: number): Array<DrawnSlo> {
  const random: SeededRandom = seededRandom(seed);
  const slos: Array<DrawnSlo> = [];

  for (let index: number = 0; index < SLO_COUNT; index++) {
    slos.push(drawSlo(random, index));
  }

  return slos;
}

describe("an SLO on upgrade (issue #9031)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("monitors something checked before the upgrade: every figure the worker reads, and what each burn rate rule does, is what it was", () => {
    let measured: number = 0;
    let firing: number = 0;
    let holding: number = 0;
    let budgetsSpent: number = 0;
    const zones: Set<string> = new Set<string>();

    for (const slo of drawSlos(90311)) {
      jest.useFakeTimers({ now: slo.now });

      const before: Evaluation = evaluate(
        slo,
        perMonitorTimelinesOf({
          slo: slo,
          cut: false,
          firstMeasuredAt: stampedWithCreation,
          isUptimeHistoryReady: true,
        }),
      );

      const after: Evaluation = evaluate(
        slo,
        perMonitorTimelinesOf({
          slo: slo,
          cut: true,
          firstMeasuredAt: stampedWithCreation,
          isUptimeHistoryReady: true,
        }),
      );

      expect(after).toEqual(before);

      if (before.budget) {
        measured++;
        budgetsSpent += before.budget.budgetConsumedSeconds > 0 ? 1 : 0;
      }

      for (const rule of before.rules || []) {
        firing += rule.decision === "fire" ? 1 : 0;
        holding += rule.decision === "hold" ? 1 : 0;
      }

      if (slo.windowType === SloWindowType.CalendarMonth) {
        zones.add(slo.timezone);
      }

      jest.useRealTimers();
    }

    // The drawn SLOs reach what the worker acts on: rules firing and holding, budgets spent.
    expect(measured).toBe(SLO_COUNT);
    expect(firing).toBeGreaterThan(10);
    expect(holding).toBeGreaterThan(0);
    expect(budgetsSpent).toBeGreaterThan(SLO_COUNT / 2);
    expect(zones.size).toBe(ZONES.length);
  });

  test("during the upgrade, before the history migration has run: monitors a result stamped with the upgrade's time read exactly as before", () => {
    let movedWithoutTheWait: number = 0;

    for (const slo of drawSlos(90312)) {
      jest.useFakeTimers({ now: slo.now });

      // The upgrade an hour before now: every monitor still unstamped, or stamped then.
      const upgradeAt: Date = new Date(slo.now.getTime() - HOUR_MS);
      const stampedByTheUpgrade: (monitor: DrawnMonitor) => Date | null = (
        monitor: DrawnMonitor,
      ): Date | null => {
        return monitor.monitorId.toString().endsWith("1") ? null : upgradeAt;
      };

      const before: Evaluation = evaluate(
        slo,
        perMonitorTimelinesOf({
          slo: slo,
          cut: false,
          firstMeasuredAt: stampedByTheUpgrade,
          isUptimeHistoryReady: false,
        }),
      );

      expect(
        evaluate(
          slo,
          perMonitorTimelinesOf({
            slo: slo,
            cut: true,
            firstMeasuredAt: stampedByTheUpgrade,
            isUptimeHistoryReady: false,
          }),
        ),
      ).toEqual(before);

      // What the wait holds back: those stamps read as first checks.
      const withoutTheWait: Evaluation = evaluate(
        slo,
        perMonitorTimelinesOf({
          slo: slo,
          cut: true,
          firstMeasuredAt: stampedByTheUpgrade,
          isUptimeHistoryReady: true,
        }),
      );

      if (JSON.stringify(withoutTheWait) !== JSON.stringify(before)) {
        movedWithoutTheWait++;
      }

      jest.useRealTimers();
    }

    expect(movedWithoutTheWait).toBeGreaterThan(SLO_COUNT * 0.8);
  });

  test("a monitor nothing has checked adds nothing: the SLO reads as its checked monitors alone, and one with none of them measures nothing", () => {
    let withoutAnyCheckedMonitor: number = 0;

    for (const slo of drawSlos(90313)) {
      jest.useFakeTimers({ now: slo.now });

      // The SLO's first monitor was never checked: its one row since it was created.
      const neverChecked: DrawnMonitor = {
        ...slo.monitors[0]!,
        monitorType: MonitorType.Website,
        rows: [
          makeRow({
            monitorId: slo.monitors[0]!.monitorId,
            status: OPERATIONAL,
            startsAt: slo.monitors[0]!.createdAt.getTime() + 100,
            endsAt: null,
            isMonitoringOff: false,
          }),
        ],
      };

      const withNeverChecked: DrawnSlo = {
        ...slo,
        monitors: [neverChecked, ...slo.monitors.slice(1)],
      };

      const firstMeasuredAt: (monitor: DrawnMonitor) => Date | null = (
        monitor: DrawnMonitor,
      ): Date | null => {
        return monitor === neverChecked ? null : monitor.createdAt;
      };

      const after: Evaluation = evaluate(
        withNeverChecked,
        perMonitorTimelinesOf({
          slo: withNeverChecked,
          cut: true,
          firstMeasuredAt: firstMeasuredAt,
          isUptimeHistoryReady: true,
        }),
      );

      if (slo.monitors.length === 1) {
        // No time at all: the worker marks the SLO and raises nothing.
        expect(after.sli.totalSeconds).toBe(0);
        expect(after.rules).toBeNull();

        // Before, it read up the whole time: nothing open for the guard to resolve.
        const before: Evaluation = evaluate(
          withNeverChecked,
          perMonitorTimelinesOf({
            slo: withNeverChecked,
            cut: false,
            firstMeasuredAt: firstMeasuredAt,
            isUptimeHistoryReady: true,
          }),
        );

        expect(before.sli.badSeconds).toBe(0);
        expect(
          (before.rules || []).every(
            (rule: { decision: RuleDecision }): boolean => {
              return rule.decision === "resolve";
            },
          ),
        ).toBe(true);

        withoutAnyCheckedMonitor++;
      } else {
        const checkedAlone: DrawnSlo = {
          ...slo,
          monitors: slo.monitors.slice(1),
        };

        expect(after).toEqual(
          evaluate(
            checkedAlone,
            perMonitorTimelinesOf({
              slo: checkedAlone,
              cut: true,
              firstMeasuredAt: firstMeasuredAt,
              isUptimeHistoryReady: true,
            }),
          ),
        );
      }

      jest.useRealTimers();
    }

    expect(withoutAnyCheckedMonitor).toBeGreaterThan(SLO_COUNT / 5);
  });
});

/*
 * THE REFERENCE: what an SLO measures, written apart from SloUtil.
 *
 * Each monitor's events in the window (UptimeUtil: the time with monitoring
 * off skipped), those of a status a monitor starts in cut at its first check
 * one by one, as a status page's statements cut them. The time measured is
 * the union of every monitor's events (Any Down) or the sum of each
 * monitor's (Monitor Seconds Average), the time down the union or sum of the
 * events in a downtime status. The drawn timelines run back to back from a
 * monitor's creation to now, so this is all a window holds.
 */
type Interval = [number, number];

function unionLength(intervals: Array<Interval>): number {
  let total: number = 0;
  let reach: number = -Infinity;

  for (const [start, end] of [...intervals].sort(
    (a: Interval, b: Interval): number => {
      return a[0] - b[0];
    },
  )) {
    total += Math.max(0, end - Math.max(start, reach));
    reach = Math.max(reach, end);
  }

  return total;
}

function referenceSli(data: {
  slo: DrawnSlo;
  window: UptimeWindow;
  firstCheckAt: (monitor: DrawnMonitor) => number;
}): { badSeconds: number; totalSeconds: number } {
  const downtimeStatusIds: Set<string> = new Set<string>(
    data.slo.downtimeStatuses.map((status: MonitorStatus): string => {
      return status.id!.toString();
    }),
  );

  const measuredByMonitor: Array<Array<Interval>> = [];
  const downByMonitor: Array<Array<Interval>> = [];

  for (const monitor of data.slo.monitors) {
    const firstCheckAt: number = data.firstCheckAt(monitor);
    const measured: Array<Interval> = [];
    const down: Array<Interval> = [];

    for (const event of UptimeUtil.getMonitorEventsForId(
      monitor.monitorId,
      rowsRead(monitor.rows, fetchWindowOf(data.slo)),
      data.window,
    )) {
      let start: number = new Date(event.startDate).getTime();
      const end: number = new Date(event.endDate).getTime();
      const statusId: string = event.eventStatusId.toString();

      if (
        MonitorFirstCheck.isStartingStatus(statusById(statusId)) &&
        start < firstCheckAt
      ) {
        if (firstCheckAt >= end) {
          continue;
        }

        start = firstCheckAt;
      }

      measured.push([start, end]);

      if (downtimeStatusIds.has(statusId)) {
        down.push([start, end]);
      }
    }

    measuredByMonitor.push(measured);
    downByMonitor.push(down);
  }

  if (data.slo.mode === SloMultiMonitorMode.MonitorSecondsAverage) {
    return {
      totalSeconds:
        measuredByMonitor.reduce((sum: number, measured: Array<Interval>) => {
          return sum + unionLength(measured);
        }, 0) / 1000,
      badSeconds:
        downByMonitor.reduce((sum: number, down: Array<Interval>) => {
          return sum + unionLength(down);
        }, 0) / 1000,
    };
  }

  return {
    totalSeconds: unionLength(measuredByMonitor.flat()) / 1000,
    badSeconds: unionLength(downByMonitor.flat()) / 1000,
  };
}

describe("an SLO measured from its monitors' first checks, on drawn timelines (issue #9031)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("its SLI and its burn rate windows leave out exactly the time before each first check, in every zone", () => {
    const random: SeededRandom = seededRandom(90314);
    let cut: number = 0;
    let neverCheckedCount: number = 0;

    for (const slo of drawSlos(90315)) {
      jest.useFakeTimers({ now: slo.now });

      /*
       * Each monitor first checked when it was created, some time after,
       * long after, or never - a manual monitor from the start whatever it
       * holds.
       */
      const firstMeasuredAtByMonitor: Map<string, Date | null> = new Map<
        string,
        Date | null
      >();

      for (const monitor of slo.monitors) {
        const choice: number = random(5);
        const lifetime: number =
          slo.now.getTime() - monitor.createdAt.getTime();

        firstMeasuredAtByMonitor.set(
          monitor.monitorId.toString(),
          choice === 0
            ? null
            : choice === 1
              ? monitor.createdAt
              : new Date(
                  monitor.createdAt.getTime() +
                    Math.round(random() * (choice === 2 ? 0.05 : 1) * lifetime),
                ),
        );
      }

      const firstMeasuredAt: (monitor: DrawnMonitor) => Date | null = (
        monitor: DrawnMonitor,
      ): Date | null => {
        return firstMeasuredAtByMonitor.get(monitor.monitorId.toString())!;
      };

      const firstCheckAt: (monitor: DrawnMonitor) => number = (
        monitor: DrawnMonitor,
      ): number => {
        if (monitor.monitorType === MonitorType.Manual) {
          return -Infinity;
        }

        const date: Date | null = firstMeasuredAt(monitor);

        return date === null ? Infinity : date.getTime();
      };

      const perMonitorTimelines: Array<MonitorTimelineSet> =
        perMonitorTimelinesOf({
          slo: slo,
          cut: true,
          firstMeasuredAt: firstMeasuredAt,
          isUptimeHistoryReady: true,
        });

      const compliance: UptimeWindow = complianceWindowOf(slo).window;

      const windows: Array<UptimeWindow> = [
        compliance,
        ...[
          SLO_CURRENT_BURN_RATE_WINDOW_MINUTES,
          ...rulesOf(slo).flatMap(
            (rule: SloRecommendedBurnRateRule): Array<number> => {
              return [rule.longWindowInMinutes, rule.shortWindowInMinutes];
            },
          ),
        ].map((minutes: number): UptimeWindow => {
          return {
            startDate: new Date(slo.now.getTime() - minutes * MINUTE_MS),
            endDate: slo.now,
          };
        }),
      ];

      for (const window of windows) {
        const sli: TimeSliResult = SloUtil.computeTimeSli({
          perMonitorTimelines: perMonitorTimelines,
          downtimeStatuses: slo.downtimeStatuses,
          window: window,
          mode: slo.mode,
        });

        const reference: { badSeconds: number; totalSeconds: number } =
          referenceSli({
            slo: slo,
            window: window,
            firstCheckAt: firstCheckAt,
          });

        expect(
          Math.abs(sli.totalSeconds - reference.totalSeconds),
        ).toBeLessThan(1e-3);
        expect(Math.abs(sli.badSeconds - reference.badSeconds)).toBeLessThan(
          1e-3,
        );
      }

      // What a burn rule's gate reads: data from the first check measured, at the earliest.
      const earliest: Date | null = SloUtil.getEarliestEventStartDate(
        perMonitorTimelines,
        fetchWindowOf(slo),
      );

      const referenceEarliest: number = Math.min(
        ...slo.monitors.flatMap((monitor: DrawnMonitor): Array<number> => {
          const events: Array<MonitorEvent> = UptimeUtil.getMonitorEventsForId(
            monitor.monitorId,
            rowsRead(monitor.rows, fetchWindowOf(slo)),
            fetchWindowOf(slo),
          );

          return events
            .map((event: MonitorEvent): number => {
              const start: number = new Date(event.startDate).getTime();
              const end: number = new Date(event.endDate).getTime();
              const statusId: string = event.eventStatusId.toString();

              if (
                !MonitorFirstCheck.isStartingStatus(statusById(statusId)) ||
                start >= firstCheckAt(monitor)
              ) {
                return start;
              }

              return firstCheckAt(monitor) < end
                ? firstCheckAt(monitor)
                : Infinity;
            })
            .filter((start: number): boolean => {
              return Number.isFinite(start);
            });
        }),
      );

      expect(earliest ? earliest.getTime() : Infinity).toBe(referenceEarliest);

      // Whether the first checks moved this SLO at all: most of them must.
      const uncut: TimeSliResult = SloUtil.computeTimeSli({
        perMonitorTimelines: perMonitorTimelinesOf({
          slo: slo,
          cut: false,
          firstMeasuredAt: firstMeasuredAt,
          isUptimeHistoryReady: true,
        }),
        downtimeStatuses: slo.downtimeStatuses,
        window: compliance,
        mode: slo.mode,
      });

      cut +=
        JSON.stringify(uncut) ===
        JSON.stringify(
          SloUtil.computeTimeSli({
            perMonitorTimelines: perMonitorTimelines,
            downtimeStatuses: slo.downtimeStatuses,
            window: compliance,
            mode: slo.mode,
          }),
        )
          ? 0
          : 1;

      neverCheckedCount += slo.monitors.some((monitor: DrawnMonitor) => {
        return (
          firstMeasuredAt(monitor) === null &&
          monitor.monitorType !== MonitorType.Manual
        );
      })
        ? 1
        : 0;

      jest.useRealTimers();
    }

    expect(cut).toBeGreaterThan(SLO_COUNT / 3);
    expect(neverCheckedCount).toBeGreaterThan(SLO_COUNT / 10);
  });
});
