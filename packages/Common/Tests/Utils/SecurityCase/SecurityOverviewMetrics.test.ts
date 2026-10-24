import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../../Models/DatabaseModels/SecurityCaseStatus";
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
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
import {
  TEST_PRIORITY_IDS,
  TEST_STATUS_IDS,
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
  buildTestPriority,
  buildTestStatus,
} from "../../Helpers/SecurityCaseValues";
import { describe, expect, test } from "@jest/globals";

const NOW: Date = new Date("2026-10-14T12:00:00Z");
const WINDOW_START: Date = new Date("2026-09-14T12:00:00Z");
const DETECTION_WINDOW_START: Date = new Date("2026-09-30T12:00:00Z");

const CRITICAL: string = TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical];
const HIGH: string = TEST_PRIORITY_IDS[SecurityCasePriorityLevel.High];
const MEDIUM: string = TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Medium];
const LOW: string = TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Low];
const INFORMATIONAL: string =
  TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Informational];

const NEW: string = TEST_STATUS_IDS[SecurityCaseStage.New];
const INVESTIGATING: string = TEST_STATUS_IDS[SecurityCaseStage.Acknowledged];
const CONTAINED: string = TEST_STATUS_IDS[SecurityCaseStage.Contained];
const CLOSED: string = TEST_STATUS_IDS[SecurityCaseStage.Closed];

// A team's own: an Emergency above Critical, Eradicating and a second closed status.
const EMERGENCY: string = "c1000000-0000-4000-8000-0000000000e1";
const ERADICATING: string = "c2000000-0000-4000-8000-0000000000a2";
const DUPLICATE: string = "c2000000-0000-4000-8000-0000000000a3";

function minutesAfter(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function caseRow(overrides: Partial<OverviewCaseRow>): OverviewCaseRow {
  return {
    createdAt: new Date("2026-10-13T08:00:00Z"),
    priorityId: MEDIUM,
    statusId: NEW,
    ...overrides,
  };
}

function compute(data: {
  openCases?: Array<OverviewCaseRow>;
  casesInWindow?: Array<OverviewCaseRow>;
  priorities?: Array<SecurityCasePriority>;
  statuses?: Array<SecurityCaseStatus>;
}): SecurityOverviewMetrics {
  return computeSecurityOverviewMetrics({
    priorities: data.priorities || buildDefaultTestPriorities(),
    statuses: data.statuses || buildDefaultTestStatuses(),
    openCases: data.openCases || [],
    casesInWindow: data.casesInWindow || [],
    detectionsInWindow: [],
    windowStart: WINDOW_START,
    detectionWindowStart: DETECTION_WINDOW_START,
    now: NOW,
  });
}

function buildTeamPriorities(): Array<SecurityCasePriority> {
  return [
    ...buildDefaultTestPriorities().map((priority: SecurityCasePriority) => {
      priority.order = (priority.order || 0) + 1;
      return priority;
    }),
    buildTestPriority({ id: EMERGENCY, name: "Emergency", order: 1 }),
  ];
}

function buildTeamStatuses(): Array<SecurityCaseStatus> {
  const statuses: Array<SecurityCaseStatus> = buildDefaultTestStatuses();
  statuses[3]!.order = 5; // Closed

  return [
    ...statuses,
    buildTestStatus({ id: ERADICATING, name: "Eradicating", order: 4 }),
    buildTestStatus({ id: DUPLICATE, name: "Closed - Duplicate", order: 6 }),
  ];
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
    const metrics: SecurityOverviewMetrics = compute({
      openCases: [
        caseRow({ priorityId: CRITICAL }),
        caseRow({
          priorityId: HIGH,
          statusId: INVESTIGATING,
          assignedToUserId: "u1",
        }),
        caseRow({
          priorityId: HIGH,
          statusId: CONTAINED,
          assignedToTeamId: "t1",
        }),
      ],
    });

    expect(metrics.openCases).toBe(3);
    // A team's queue is still nobody's until a person takes it.
    expect(metrics.unassignedOpenCases).toBe(2);
    expect(metrics.openByPriority).toEqual({
      [CRITICAL]: 1,
      [HIGH]: 2,
      [MEDIUM]: 0,
      [LOW]: 0,
      [INFORMATIONAL]: 0,
    });
    // Every priority, most urgent first: the order the bars are drawn in.
    expect(Object.keys(metrics.openByPriority)).toEqual([
      CRITICAL,
      HIGH,
      MEDIUM,
      LOW,
      INFORMATIONAL,
    ]);
    expect(metrics.openByStatus).toEqual({
      [NEW]: 1,
      [INVESTIGATING]: 1,
      [CONTAINED]: 1,
    });
    expect(metrics.criticalOpenCases).toBe(1);
    expect(metrics.highOpenCases).toBe(2);
  });

  test("counts the project's own priorities and statuses, by what each counts as", () => {
    const metrics: SecurityOverviewMetrics = compute({
      priorities: buildTeamPriorities(),
      statuses: buildTeamStatuses(),
      openCases: [
        caseRow({ priorityId: EMERGENCY, statusId: ERADICATING }),
        caseRow({ priorityId: CRITICAL }),
        caseRow({ priorityId: HIGH, statusId: ERADICATING }),
        caseRow({ priorityId: LOW }),
      ],
      casesInWindow: [
        caseRow({
          statusId: DUPLICATE,
          verdict: SecurityCaseVerdict.FalsePositive,
        }),
        caseRow({ statusId: ERADICATING }),
      ],
    });

    expect(Object.keys(metrics.openByPriority)).toEqual([
      EMERGENCY,
      CRITICAL,
      HIGH,
      MEDIUM,
      LOW,
      INFORMATIONAL,
    ]);
    expect(metrics.openByPriority[EMERGENCY]).toBe(1);
    // Eradicating is open: it sits before Closed. Closed - Duplicate is not.
    expect(metrics.openByStatus).toEqual({
      [NEW]: 2,
      [INVESTIGATING]: 0,
      [CONTAINED]: 0,
      [ERADICATING]: 2,
    });
    // Above Critical is critical too: the band turns red for it.
    expect(metrics.criticalOpenCases).toBe(2);
    expect(metrics.highOpenCases).toBe(1);
    // Closed - Duplicate closes the case, with its verdict.
    expect(metrics.casesClosedInWindow).toBe(1);
    expect(metrics.verdictsInWindow["False Positive"]).toBe(1);
  });

  test("a renamed priority is counted as before: by id, never by name", () => {
    const priorities: Array<SecurityCasePriority> =
      buildDefaultTestPriorities();
    priorities[0]!.name = "P1";
    priorities[1]!.name = "P2";

    const metrics: SecurityOverviewMetrics = compute({
      priorities,
      openCases: [caseRow({ priorityId: CRITICAL }), caseRow({ priorityId: HIGH })],
    });

    expect(metrics.openByPriority[CRITICAL]).toBe(1);
    expect(metrics.criticalOpenCases).toBe(1);
    expect(metrics.highOpenCases).toBe(1);
  });

  test("a case at a priority or status the project no longer has is counted open, at neither", () => {
    const metrics: SecurityOverviewMetrics = compute({
      openCases: [
        caseRow({
          priorityId: "c1000000-0000-4000-8000-0000000000ff",
          statusId: "c2000000-0000-4000-8000-0000000000ff",
        }),
      ],
    });

    expect(metrics.openCases).toBe(1);
    expect(Object.values(metrics.openByPriority)).toEqual([0, 0, 0, 0, 0]);
    expect(Object.values(metrics.openByStatus)).toEqual([0, 0, 0]);
    expect(metrics.criticalOpenCases).toBe(0);
    expect(metrics.highOpenCases).toBe(0);
  });

  test("averages each mean time over the cases that got there", () => {
    const opened: Date = new Date("2026-10-10T10:00:00Z");

    const metrics: SecurityOverviewMetrics = compute({
      casesInWindow: [
        caseRow({
          createdAt: opened,
          statusId: CLOSED,
          verdict: SecurityCaseVerdict.TruePositive,
          acknowledgedAt: minutesAfter(opened, 10),
          containedAt: minutesAfter(opened, 60),
          closedAt: minutesAfter(opened, 240),
        }),
        caseRow({
          createdAt: opened,
          statusId: CLOSED,
          verdict: SecurityCaseVerdict.FalsePositive,
          acknowledgedAt: minutesAfter(opened, 30),
          closedAt: minutesAfter(opened, 60),
        }),
        // Still open: counts toward nothing it has not reached.
        caseRow({ createdAt: opened }),
      ],
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
    const metrics: SecurityOverviewMetrics = compute({
      casesInWindow: [caseRow({ statusId: CLOSED })],
    });

    expect(metrics.verdictsInWindow["Undetermined"]).toBe(1);
    expect(metrics.meanTimeToAcknowledgeInMinutes).toBeNull();
    expect(metrics.meanTimeToCloseInMinutes).toBeNull();
  });

  test("buckets cases and detections by day, every day of the window present", () => {
    const metrics: SecurityOverviewMetrics = computeSecurityOverviewMetrics({
      priorities: buildDefaultTestPriorities(),
      statuses: buildDefaultTestStatuses(),
      openCases: [],
      casesInWindow: [
        caseRow({
          createdAt: new Date("2026-10-13T08:00:00Z"),
          priorityId: CRITICAL,
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
    ).toMatchObject({ total: 2, byKey: { [CRITICAL]: 1, [MEDIUM]: 1 } });

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
