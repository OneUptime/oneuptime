import {
  AiActivityAttentionKind,
  AiActivityAttentionSeverity,
  AiActivityInsights,
  AiActivityTrendDay,
} from "../../../Types/AI/AiActivityInsights";
import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AIInsightStatus from "../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../Types/AI/AIInsightType";
import { JSONObject } from "../../../Types/JSON";

/*
 * What an AI Insights route answers for a scope OneUptime AI has worked on
 * (and for one it has not), shared by the AI Insights suites: the words
 * (AiActivityInsightsData.test.ts) and the pages that render them
 * (AiActivityInsightsPage.test.tsx).
 *
 * The story it tells: one problem (a crash-looping pod in "checkout") was
 * investigated five times across four incidents, a fix for it was applied
 * and did not help; a disk alert on node-3 was investigated once and its
 * TL;DR call failed, so its finding comes from the report; the error logs
 * from checkout spiked and a detector filed a preventive insight; one
 * command was never picked up by the agent and one investigation failed.
 */

export const INCIDENT_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
export const ALERT_ID: string = "bbbbbbbb-0000-4000-8000-000000000002";
export const RUN_ID: string = "66666666-0000-4000-8000-000000000006";
export const SECOND_RUN_ID: string = "66666666-0000-4000-8000-000000000007";
export const INSIGHT_ID: string = "99999999-0000-4000-8000-000000000009";

export const RECURRING_PROBLEM_KEY: string = "problem-0a1b2c3d";
export const ONE_OFF_PROBLEM_KEY: string = "problem-4e5f6a7b";

export const RECURRING_PROBLEM_TITLE: string = "KubePodCrashLooping";
export const ONE_OFF_PROBLEM_TITLE: string = "Disk almost full";
export const PREVENTIVE_INSIGHT_TITLE: string =
  "Error logs from checkout spiked 6x";

// The recurring problem's latest TL;DR.
export const TLDR_FINDING: string =
  "The web deployment ran out of memory after the 14:02 rollout.";
// The disk alert's finding: its TL;DR call failed, its report said this.
export const REPORT_FINDING: string =
  "The disk on node-3 filled up with container logs.";

// The window: 30 UTC days ending 2026-09-30.
export const WINDOW_START: string = "2026-09-01T00:00:00.000Z";
export const GENERATED_AT: string = "2026-09-30T12:00:00.000Z";

/*
 * Investigations per day: 5 in the last 7 days (2 on the last day, one of
 * them failed), 2 in the 7 before, 1 earlier.
 */
const INVESTIGATIONS_BY_DAY: Record<number, number> = {
  3: 1,
  17: 1,
  20: 1,
  25: 2,
  27: 1,
  29: 2,
};
const FAILED_BY_DAY: Record<number, number> = { 29: 1 };
const FIXES_BY_DAY: Record<number, number> = { 20: 1, 25: 2, 29: 1 };

export function makeTrend(): Array<AiActivityTrendDay> {
  const days: Array<AiActivityTrendDay> = [];

  for (let index: number = 0; index < 30; index++) {
    days.push({
      date: `2026-09-${String(index + 1).padStart(2, "0")}`,
      investigations: INVESTIGATIONS_BY_DAY[index] || 0,
      failedInvestigations: FAILED_BY_DAY[index] || 0,
      fixes: FIXES_BY_DAY[index] || 0,
    });
  }

  return days;
}

export function makeInsights(
  overrides: Partial<AiActivityInsights> = {},
): AiActivityInsights {
  return {
    windowInDays: 30,
    windowStart: WINDOW_START,
    generatedAt: GENERATED_AT,
    totals: {
      investigations: 8,
      completedInvestigations: 6,
      failedInvestigations: 1,
      activeInvestigations: 1,
      problems: 2,
      recurringProblems: 1,
      fixes: 4,
      commands: 37,
      failedCommands: 2,
      timedOutCommands: 1,
    },
    attention: [
      {
        kind: AiActivityAttentionKind.FixesFailed,
        severity: AiActivityAttentionSeverity.High,
        count: 1,
        subject: {
          kind: "incident",
          id: INCIDENT_ID,
          title: RECURRING_PROBLEM_TITLE,
          number: 42,
        },
      },
      {
        kind: AiActivityAttentionKind.RecurringProblem,
        severity: AiActivityAttentionSeverity.High,
        count: 5,
        recentCount: 3,
        problemKey: RECURRING_PROBLEM_KEY,
        title: RECURRING_PROBLEM_TITLE,
        subject: {
          kind: "incident",
          id: INCIDENT_ID,
          title: RECURRING_PROBLEM_TITLE,
          number: 42,
        },
      },
      {
        kind: AiActivityAttentionKind.PreventiveInsight,
        severity: AiActivityAttentionSeverity.High,
        count: 3,
        title: PREVENTIVE_INSIGHT_TITLE,
        insightId: INSIGHT_ID,
        insightSeverity: AIInsightSeverity.High,
      },
      {
        kind: AiActivityAttentionKind.InvestigationsFailed,
        severity: AiActivityAttentionSeverity.Medium,
        count: 1,
        total: 8,
      },
      {
        kind: AiActivityAttentionKind.CommandsTimedOut,
        severity: AiActivityAttentionSeverity.Medium,
        count: 1,
        total: 37,
      },
      {
        kind: AiActivityAttentionKind.Hotspot,
        severity: AiActivityAttentionSeverity.Low,
        count: 5,
        total: 8,
        object: { name: "Namespace", value: "checkout" },
      },
    ],
    problems: [
      {
        key: RECURRING_PROBLEM_KEY,
        title: RECURRING_PROBLEM_TITLE,
        investigationCount: 5,
        subjectCount: 4,
        isRecurring: true,
        firstSeenAt: "2026-09-04T08:00:00.000Z",
        lastSeenAt: "2026-09-30T07:00:00.000Z",
        latestSubject: {
          kind: "incident",
          id: INCIDENT_ID,
          title: RECURRING_PROBLEM_TITLE,
          number: 42,
        },
        objects: [
          { name: "Namespace", value: "checkout", count: 5 },
          { name: "Pod", value: "web-7d9f-2xk", count: 1 },
        ],
        latestFinding: {
          aiRunId: RUN_ID,
          text: TLDR_FINDING,
          source: "tldr",
          at: "2026-09-30T07:04:00.000Z",
        },
        verdicts: {
          confirmed: 2,
          rejected: 1,
          matched: 1,
          partlyMatched: 1,
          mismatched: 0,
        },
        fixes: {
          proposed: 3,
          applied: 2,
          verified: 1,
          failed: 1,
          awaitingApproval: 1,
        },
      },
      {
        key: ONE_OFF_PROBLEM_KEY,
        title: ONE_OFF_PROBLEM_TITLE,
        investigationCount: 1,
        subjectCount: 1,
        isRecurring: false,
        firstSeenAt: "2026-09-26T10:00:00.000Z",
        lastSeenAt: "2026-09-26T10:00:00.000Z",
        latestSubject: {
          kind: "alert",
          id: ALERT_ID,
          title: "Disk almost full on node-3",
        },
        objects: [{ name: "Node", value: "node-3", count: 1 }],
        latestFinding: {
          aiRunId: SECOND_RUN_ID,
          text: REPORT_FINDING,
          source: "report",
          at: "2026-09-26T10:06:00.000Z",
        },
        verdicts: {
          confirmed: 0,
          rejected: 0,
          matched: 0,
          partlyMatched: 0,
          mismatched: 0,
        },
        fixes: {
          proposed: 0,
          applied: 0,
          verified: 0,
          failed: 0,
          awaitingApproval: 0,
        },
      },
    ],
    hotspots: [
      {
        name: "Namespace",
        value: "checkout",
        investigationCount: 5,
        problemCount: 1,
        lastSeenAt: "2026-09-30T07:00:00.000Z",
      },
      {
        name: "Node",
        value: "node-3",
        investigationCount: 2,
        problemCount: 2,
        lastSeenAt: "2026-09-26T10:00:00.000Z",
      },
    ],
    fixOutcomes: {
      total: 4,
      planning: 0,
      awaitingApproval: 1,
      appliedAutomatically: 1,
      appliedAfterApproval: 1,
      dismissed: 1,
      noFixFound: 0,
      verified: 1,
      failed: 1,
      verifying: 0,
    },
    trend: makeTrend(),
    preventiveInsights: [
      {
        id: INSIGHT_ID,
        title: PREVENTIVE_INSIGHT_TITLE,
        insightType: AIInsightType.ErrorLogSpike,
        severity: AIInsightSeverity.High,
        status: AIInsightStatus.Detected,
        lastSeenAt: "2026-09-30T06:00:00.000Z",
        occurrenceCount: 3,
      },
    ],
    isPartial: false,
    ...overrides,
  };
}

// A scope OneUptime AI has not worked on in the window: zeros and quiet days.
export function makeEmptyInsights(): AiActivityInsights {
  return makeInsights({
    totals: {
      investigations: 0,
      completedInvestigations: 0,
      failedInvestigations: 0,
      activeInvestigations: 0,
      problems: 0,
      recurringProblems: 0,
      fixes: 0,
      commands: 0,
      failedCommands: 0,
      timedOutCommands: 0,
    },
    attention: [],
    problems: [],
    hotspots: [],
    fixOutcomes: {
      total: 0,
      planning: 0,
      awaitingApproval: 0,
      appliedAutomatically: 0,
      appliedAfterApproval: 0,
      dismissed: 0,
      noFixFound: 0,
      verified: 0,
      failed: 0,
      verifying: 0,
    },
    trend: makeTrend().map((day: AiActivityTrendDay): AiActivityTrendDay => {
      return { ...day, investigations: 0, failedInvestigations: 0, fixes: 0 };
    }),
    preventiveInsights: [],
  });
}

// The insights as they cross the wire: plain JSON.
export function toBody(insights: AiActivityInsights): JSONObject {
  return JSON.parse(JSON.stringify(insights)) as JSONObject;
}
