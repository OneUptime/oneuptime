import {
  AiActivityInsight,
  AiActivityInsightKind,
  AiActivityInsightTone,
  AiActivityInsights,
  AiActivityInsightsTotals,
  AiActivitySubject,
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
 * The story it tells, the way the page should tell it:
 *
 *   - KubePodCrashLooping keeps coming back: 12 of the 20 incidents and
 *     alerts on the cluster this month, 5 of them in the last 7 days (up
 *     from 2), nearly always between 1 and 4 in the morning (UTC). AI found
 *     the web deployment runs out of memory after a rollout, and suggests a
 *     bigger memory limit. One of its fixes was applied and did not help;
 *     another waits for approval.
 *   - Error logs from checkout spiked: a risk spotted before anything paged.
 *   - Node node-3 was part of 14 of the 20, across two different problems.
 *   - AI applied a fix on its own, and it held.
 *   - KubeNodeNotReady came up 6 times and stopped after a fix on Sep 12.
 *   - A disk alert on node-3 came up once; its investigation's TL;DR call
 *     failed, so its finding comes from the report.
 *   - Under the hood: one investigation failed, one command was never picked
 *     up, three findings were confirmed and one rejected.
 */

export const INCIDENT_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
export const SECOND_INCIDENT_ID: string =
  "aaaaaaaa-0000-4000-8000-000000000003";
export const STOPPED_INCIDENT_ID: string =
  "aaaaaaaa-0000-4000-8000-000000000004";
export const ALERT_ID: string = "bbbbbbbb-0000-4000-8000-000000000002";
export const RUN_ID: string = "66666666-0000-4000-8000-000000000006";
export const SECOND_RUN_ID: string = "66666666-0000-4000-8000-000000000007";
export const INSIGHT_ID: string = "99999999-0000-4000-8000-000000000009";
export const SECOND_INSIGHT_ID: string = "99999999-0000-4000-8000-000000000010";

export const RECURRING_PROBLEM_KEY: string = "problem-0a1b2c3d";
export const STOPPED_PROBLEM_KEY: string = "problem-5c6d7e8f";
export const ONE_OFF_PROBLEM_KEY: string = "problem-4e5f6a7b";

export const RECURRING_PROBLEM_TITLE: string = "KubePodCrashLooping";
export const STOPPED_PROBLEM_TITLE: string = "KubeNodeNotReady";
export const ONE_OFF_PROBLEM_TITLE: string = "Disk almost full";
export const PREVENTIVE_INSIGHT_TITLE: string =
  "Error logs from checkout spiked 6x";
export const SECOND_PREVENTIVE_INSIGHT_TITLE: string =
  "p95 latency of GET /api/cart regressed 41%";

// The recurring problem's latest TL;DR, and the step its report suggests.
export const TLDR_FINDING: string =
  "The web deployment ran out of memory after the 14:02 rollout.";
export const NEXT_STEP: string =
  "Raise the web deployment's memory limit to 1 GiB.";
// The disk alert's finding: its TL;DR call failed, its report said this.
export const REPORT_FINDING: string =
  "The disk on node-3 filled up with container logs.";

// The window: 30 UTC days ending 2026-09-30.
export const WINDOW_START: string = "2026-09-01T00:00:00.000Z";
export const GENERATED_AT: string = "2026-09-30T12:00:00.000Z";

export const RECURRING_SUBJECT: AiActivitySubject = {
  kind: "incident",
  id: INCIDENT_ID,
  title: RECURRING_PROBLEM_TITLE,
  number: 42,
};

export const SECOND_RECURRING_SUBJECT: AiActivitySubject = {
  kind: "incident",
  id: SECOND_INCIDENT_ID,
  title: RECURRING_PROBLEM_TITLE,
  number: 40,
};

export const DISK_SUBJECT: AiActivitySubject = {
  kind: "alert",
  id: ALERT_ID,
  title: "Disk almost full on node-3",
  number: 812,
};

export const STOPPED_SUBJECT: AiActivitySubject = {
  kind: "incident",
  id: STOPPED_INCIDENT_ID,
  title: STOPPED_PROBLEM_TITLE,
  number: 31,
};

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

// The insights the page leads with, in the server's order.
export function makeInsightList(): Array<AiActivityInsight> {
  return [
    {
      kind: AiActivityInsightKind.RecurringProblem,
      tone: AiActivityInsightTone.Critical,
      count: 12,
      total: 20,
      recentCount: 5,
      previousCount: 2,
      problemKey: RECURRING_PROBLEM_KEY,
      title: RECURRING_PROBLEM_TITLE,
      firstSeenAt: "2026-09-04T01:10:00.000Z",
      lastSeenAt: "2026-09-30T02:05:00.000Z",
      finding: {
        aiRunId: RUN_ID,
        text: TLDR_FINDING,
        source: "tldr",
        at: "2026-09-30T02:12:00.000Z",
      },
      nextStep: NEXT_STEP,
      timeOfDay: {
        startHourUtc: 1,
        hours: 3,
        count: 11,
        total: 12,
        days: 9,
        totalDays: 10,
      },
      objects: [
        { name: "Namespace", value: "checkout", key: "k8s.namespace.name" },
        { name: "Pod", value: "web-7d9f-2xk", key: "k8s.pod.name" },
      ],
      subject: RECURRING_SUBJECT,
      evidence: [RECURRING_SUBJECT, SECOND_RECURRING_SUBJECT],
      evidenceCount: 12,
    },
    {
      kind: AiActivityInsightKind.FixesDidNotHelp,
      tone: AiActivityInsightTone.Critical,
      count: 1,
      total: 4,
      subject: RECURRING_SUBJECT,
      evidence: [RECURRING_SUBJECT],
      evidenceCount: 1,
    },
    {
      kind: AiActivityInsightKind.RiskSpotted,
      tone: AiActivityInsightTone.Critical,
      count: 3,
      title: PREVENTIVE_INSIGHT_TITLE,
      insightId: INSIGHT_ID,
      insightSeverity: AIInsightSeverity.High,
      insightType: AIInsightType.ErrorLogSpike,
      lastSeenAt: "2026-09-30T06:00:00.000Z",
    },
    {
      kind: AiActivityInsightKind.FixesAwaitingApproval,
      tone: AiActivityInsightTone.Warning,
      count: 1,
      subject: RECURRING_SUBJECT,
      evidence: [RECURRING_SUBJECT],
      evidenceCount: 1,
    },
    {
      kind: AiActivityInsightKind.Hotspot,
      tone: AiActivityInsightTone.Pattern,
      count: 14,
      total: 20,
      problemCount: 2,
      object: { name: "Node", value: "node-3", key: "k8s.node.name" },
      lastSeenAt: "2026-09-29T22:00:00.000Z",
      subject: DISK_SUBJECT,
      evidence: [DISK_SUBJECT, RECURRING_SUBJECT, SECOND_RECURRING_SUBJECT],
      evidenceCount: 14,
    },
    {
      kind: AiActivityInsightKind.FixedAutomatically,
      tone: AiActivityInsightTone.Positive,
      count: 1,
      verifiedCount: 1,
      subject: SECOND_RECURRING_SUBJECT,
      evidence: [SECOND_RECURRING_SUBJECT],
      evidenceCount: 1,
    },
    {
      kind: AiActivityInsightKind.ProblemStopped,
      tone: AiActivityInsightTone.Positive,
      count: 6,
      problemKey: STOPPED_PROBLEM_KEY,
      title: STOPPED_PROBLEM_TITLE,
      fixedAt: "2026-09-12T09:00:00.000Z",
      lastSeenAt: "2026-09-12T08:00:00.000Z",
      subject: STOPPED_SUBJECT,
      evidence: [STOPPED_SUBJECT],
      evidenceCount: 6,
    },
  ];
}

export function makeTotals(
  overrides: Partial<AiActivityInsightsTotals> = {},
): AiActivityInsightsTotals {
  return {
    occurrences: 20,
    investigations: 8,
    completedInvestigations: 6,
    failedInvestigations: 1,
    activeInvestigations: 1,
    confirmedFindings: 3,
    rejectedFindings: 1,
    problems: 3,
    recurringProblems: 2,
    fixes: 4,
    commands: 37,
    failedCommands: 2,
    timedOutCommands: 1,
    ...overrides,
  };
}

export function makeInsights(
  overrides: Partial<AiActivityInsights> = {},
): AiActivityInsights {
  return {
    windowInDays: 30,
    windowStart: WINDOW_START,
    generatedAt: GENERATED_AT,
    totals: makeTotals(),
    insights: makeInsightList(),
    problems: [
      {
        key: RECURRING_PROBLEM_KEY,
        title: RECURRING_PROBLEM_TITLE,
        occurrenceCount: 12,
        recentOccurrenceCount: 5,
        previousOccurrenceCount: 2,
        investigationCount: 5,
        subjectCount: 4,
        isRecurring: true,
        firstSeenAt: "2026-09-04T01:10:00.000Z",
        lastSeenAt: "2026-09-30T02:05:00.000Z",
        latestSubject: RECURRING_SUBJECT,
        objects: [
          {
            name: "Namespace",
            value: "checkout",
            key: "k8s.namespace.name",
            count: 12,
          },
          {
            name: "Pod",
            value: "web-7d9f-2xk",
            key: "k8s.pod.name",
            count: 3,
          },
        ],
        latestFinding: {
          aiRunId: RUN_ID,
          text: TLDR_FINDING,
          source: "tldr",
          at: "2026-09-30T02:12:00.000Z",
        },
        latestNextStep: NEXT_STEP,
        timeOfDay: {
          startHourUtc: 1,
          hours: 3,
          count: 11,
          total: 12,
          days: 9,
          totalDays: 10,
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
        key: STOPPED_PROBLEM_KEY,
        title: STOPPED_PROBLEM_TITLE,
        occurrenceCount: 6,
        recentOccurrenceCount: 0,
        previousOccurrenceCount: 0,
        investigationCount: 2,
        subjectCount: 2,
        isRecurring: true,
        firstSeenAt: "2026-09-02T04:00:00.000Z",
        lastSeenAt: "2026-09-12T08:00:00.000Z",
        latestSubject: STOPPED_SUBJECT,
        objects: [
          { name: "Node", value: "node-2", key: "k8s.node.name", count: 6 },
        ],
        verdicts: {
          confirmed: 1,
          rejected: 0,
          matched: 0,
          partlyMatched: 0,
          mismatched: 0,
        },
        fixes: {
          proposed: 1,
          applied: 1,
          verified: 1,
          failed: 0,
          awaitingApproval: 0,
        },
      },
      {
        key: ONE_OFF_PROBLEM_KEY,
        title: ONE_OFF_PROBLEM_TITLE,
        occurrenceCount: 1,
        recentOccurrenceCount: 1,
        previousOccurrenceCount: 0,
        investigationCount: 1,
        subjectCount: 1,
        isRecurring: false,
        firstSeenAt: "2026-09-26T10:00:00.000Z",
        lastSeenAt: "2026-09-26T10:00:00.000Z",
        latestSubject: DISK_SUBJECT,
        objects: [
          { name: "Node", value: "node-3", key: "k8s.node.name", count: 1 },
        ],
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
        name: "Node",
        value: "node-3",
        key: "k8s.node.name",
        occurrenceCount: 14,
        investigationCount: 4,
        problemCount: 2,
        lastSeenAt: "2026-09-29T22:00:00.000Z",
      },
      {
        name: "Namespace",
        value: "checkout",
        key: "k8s.namespace.name",
        occurrenceCount: 12,
        investigationCount: 5,
        problemCount: 1,
        lastSeenAt: "2026-09-30T02:05:00.000Z",
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
      {
        id: SECOND_INSIGHT_ID,
        title: SECOND_PREVENTIVE_INSIGHT_TITLE,
        insightType: AIInsightType.TraceLatencyRegression,
        severity: AIInsightSeverity.Medium,
        status: AIInsightStatus.Detected,
        lastSeenAt: "2026-09-29T18:00:00.000Z",
        occurrenceCount: 1,
      },
    ],
    isPartial: false,
    ...overrides,
  };
}

/*
 * A scope AI worked on where nothing stands out: one disk alert that came
 * up once, no fix, no risk. The page says so instead of inventing a
 * headline.
 */
export function makeQuietInsights(): AiActivityInsights {
  const busy: AiActivityInsights = makeInsights();

  return makeInsights({
    totals: makeTotals({
      occurrences: 2,
      investigations: 2,
      completedInvestigations: 2,
      failedInvestigations: 0,
      activeInvestigations: 0,
      confirmedFindings: 0,
      rejectedFindings: 0,
      problems: 1,
      recurringProblems: 0,
      fixes: 0,
      commands: 9,
      failedCommands: 0,
      timedOutCommands: 0,
    }),
    insights: [],
    problems: [busy.problems[2]!],
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
    preventiveInsights: [],
  });
}

// A scope OneUptime AI has not worked on in the window: zeros and quiet days.
export function makeEmptyInsights(): AiActivityInsights {
  return makeInsights({
    totals: makeTotals({
      occurrences: 0,
      investigations: 0,
      completedInvestigations: 0,
      failedInvestigations: 0,
      activeInvestigations: 0,
      confirmedFindings: 0,
      rejectedFindings: 0,
      problems: 0,
      recurringProblems: 0,
      fixes: 0,
      commands: 0,
      failedCommands: 0,
      timedOutCommands: 0,
    }),
    insights: [],
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

// One insight of the fixture, by its kind.
export function insightOfKind(kind: AiActivityInsightKind): AiActivityInsight {
  const insight: AiActivityInsight | undefined = makeInsightList().find(
    (item: AiActivityInsight): boolean => {
      return item.kind === kind;
    },
  );

  if (!insight) {
    throw new Error(`The fixture has no ${kind} insight.`);
  }

  return insight;
}

// The insights as they cross the wire: plain JSON.
export function toBody(insights: AiActivityInsights): JSONObject {
  return JSON.parse(JSON.stringify(insights)) as JSONObject;
}
