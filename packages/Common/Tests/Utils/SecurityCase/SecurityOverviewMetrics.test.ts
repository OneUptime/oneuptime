import SecurityCasePriority from "../../../Types/SecurityCase/SecurityCasePriority";
import SecurityCaseStatus from "../../../Types/SecurityCase/SecurityCaseStatus";
import SecurityCaseVerdict from "../../../Types/SecurityCase/SecurityCaseVerdict";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import {
  DayCount,
  OverviewCaseRow,
  SecurityOverviewMetrics,
  computeSecurityOverviewMetrics,
  daysBetween,
  formatDurationInMinutes,
  utcDay,
} from "../../../Utils/SecurityCase/SecurityOverviewMetrics";
import { describe, expect, test } from "@jest/globals";

const NOW: Date = new Date("2026-10-14T12:00:00Z");
const WINDOW_START: Date = new Date("2026-09-14T12:00:00Z");
const DETECTION_WINDOW_START: Date = new Date("2026-09-30T12:00:00Z");

function minutesAfter(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function caseRow(overrides: Partial<OverviewCaseRow>): OverviewCaseRow {
  return {
    createdAt: new Date("2026-10-13T08:00:00Z"),
    priority: SecurityCasePriority.Medium,
    status: SecurityCaseStatus.New,
    ...overrides,
  };
}

describe("daysBetween", () => {
  test("lists every UTC day, both ends included", () => {
    expect(
      daysBetween(
        new Date("2026-10-12T23:00:00Z"),
        new Date("2026-10-14T01:00:00Z"),
      ),
    ).toEqual(["2026-10-12", "2026-10-13", "2026-10-14"]);
    expect(utcDay(new Date("2026-10-14T23:59:59Z"))).toBe("2026-10-14");
  });

  test("a window inside one day is that day", () => {
    expect(daysBetween(NOW, NOW)).toEqual(["2026-10-14"]);
  });
});

describe("computeSecurityOverviewMetrics", () => {
  test("counts the open queue by priority and status, and what nobody has", () => {
    const metrics: SecurityOverviewMetrics = computeSecurityOverviewMetrics({
      openCases: [
        caseRow({ priority: SecurityCasePriority.Critical }),
        caseRow({
          priority: SecurityCasePriority.High,
          status: SecurityCaseStatus.Investigating,
          assignedToUserId: "u1",
        }),
        caseRow({
          priority: SecurityCasePriority.High,
          status: SecurityCaseStatus.Contained,
          assignedToTeamId: "t1",
        }),
      ],
      casesInWindow: [],
      detectionsInWindow: [],
      windowStart: WINDOW_START,
      detectionWindowStart: DETECTION_WINDOW_START,
      now: NOW,
    });

    expect(metrics.openCases).toBe(3);
    // A team's queue is still nobody's until a person takes it.
    expect(metrics.unassignedOpenCases).toBe(2);
    expect(metrics.openByPriority).toMatchObject({
      Critical: 1,
      High: 2,
      Medium: 0,
      Low: 0,
      Informational: 0,
    });
    expect(metrics.openByStatus).toEqual({
      New: 1,
      Investigating: 1,
      Contained: 1,
    });
  });

  test("averages each mean time over the cases that got there", () => {
    const opened: Date = new Date("2026-10-10T10:00:00Z");

    const metrics: SecurityOverviewMetrics = computeSecurityOverviewMetrics({
      openCases: [],
      casesInWindow: [
        caseRow({
          createdAt: opened,
          status: SecurityCaseStatus.Closed,
          verdict: SecurityCaseVerdict.TruePositive,
          acknowledgedAt: minutesAfter(opened, 10),
          containedAt: minutesAfter(opened, 60),
          closedAt: minutesAfter(opened, 240),
        }),
        caseRow({
          createdAt: opened,
          status: SecurityCaseStatus.Closed,
          verdict: SecurityCaseVerdict.FalsePositive,
          acknowledgedAt: minutesAfter(opened, 30),
          closedAt: minutesAfter(opened, 60),
        }),
        // Still open: counts toward nothing it has not reached.
        caseRow({ createdAt: opened }),
      ],
      detectionsInWindow: [],
      windowStart: WINDOW_START,
      detectionWindowStart: DETECTION_WINDOW_START,
      now: NOW,
    });

    expect(metrics.meanTimeToAcknowledgeInMinutes).toBe(20);
    expect(metrics.meanTimeToContainInMinutes).toBe(60);
    expect(metrics.meanTimeToCloseInMinutes).toBe(150);
    expect(metrics.casesOpenedInWindow).toBe(3);
    expect(metrics.casesClosedInWindow).toBe(2);
    expect(metrics.verdictsInWindow).toMatchObject({
      "True Positive": 1,
      "False Positive": 1,
      "Benign Positive": 0,
      Undetermined: 0,
    });
  });

  test("reads a closed case without a verdict as Undetermined, and no data as no mean", () => {
    const metrics: SecurityOverviewMetrics = computeSecurityOverviewMetrics({
      openCases: [],
      casesInWindow: [caseRow({ status: SecurityCaseStatus.Closed })],
      detectionsInWindow: [],
      windowStart: WINDOW_START,
      detectionWindowStart: DETECTION_WINDOW_START,
      now: NOW,
    });

    expect(metrics.verdictsInWindow["Undetermined"]).toBe(1);
    expect(metrics.meanTimeToAcknowledgeInMinutes).toBeNull();
    expect(metrics.meanTimeToCloseInMinutes).toBeNull();
  });

  test("buckets cases and detections by day, every day of the window present", () => {
    const metrics: SecurityOverviewMetrics = computeSecurityOverviewMetrics({
      openCases: [],
      casesInWindow: [
        caseRow({
          createdAt: new Date("2026-10-13T08:00:00Z"),
          priority: SecurityCasePriority.Critical,
          mitreTactics: ["TA0006", "TA0001"],
        }),
        caseRow({
          createdAt: new Date("2026-10-13T20:00:00Z"),
          mitreTactics: ["TA0006"],
        }),
      ],
      detectionsInWindow: [
        {
          firstSeenAt: new Date("2026-10-14T01:00:00Z"),
          source: SecurityDetectionSource.DetectionRule,
          ruleName: "Brute force",
          detectionRuleId: "r1",
        },
        {
          firstSeenAt: new Date("2026-10-14T02:00:00Z"),
          source: SecurityDetectionSource.DetectionRule,
          ruleName: "Brute force",
          detectionRuleId: "r1",
        },
        {
          firstSeenAt: new Date("2026-10-12T02:00:00Z"),
          source: SecurityDetectionSource.ThreatIntel,
          ruleName: "Abuse feed",
        },
      ],
      windowStart: WINDOW_START,
      detectionWindowStart: DETECTION_WINDOW_START,
      now: NOW,
    });

    expect(metrics.casesOpenedPerDay).toHaveLength(31);
    expect(
      metrics.casesOpenedPerDay.find((day: DayCount) => {
        return day.day === "2026-10-13";
      }),
    ).toMatchObject({ total: 2, byKey: { Critical: 1, Medium: 1 } });

    expect(metrics.detectionsPerDay).toHaveLength(15);
    expect(
      metrics.detectionsPerDay.find((day: DayCount) => {
        return day.day === "2026-10-14";
      }),
    ).toMatchObject({ total: 2, byKey: { "Detection Rule": 2 } });

    expect(metrics.detectionsInWindow).toBe(3);
    expect(metrics.topRules).toEqual([
      { ruleName: "Brute force", detectionRuleId: "r1", count: 2 },
      { ruleName: "Abuse feed", detectionRuleId: null, count: 1 },
    ]);
    expect(metrics.topTactics).toEqual([
      { tacticId: "TA0006", count: 2 },
      { tacticId: "TA0001", count: 1 },
    ]);
  });
});

describe("formatDurationInMinutes", () => {
  test.each([
    [null, "—"],
    [0, "0 min"],
    [45, "45 min"],
    [60, "1 h"],
    [200, "3 h 20 min"],
    [1440, "1 d"],
    [3120, "2 d 4 h"],
  ])("%s minutes reads %s", (minutes: number | null, expected: string) => {
    expect(formatDurationInMinutes(minutes)).toBe(expected);
  });
});
