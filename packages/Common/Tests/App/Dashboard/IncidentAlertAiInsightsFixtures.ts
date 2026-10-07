import {
  AiActivityAttentionKind,
  AiActivityAttentionSeverity,
  AiActivitySubject,
  AiActivityTrendDay,
} from "../../../Types/AI/AiActivityInsights";
import { IncidentAlertAiInsights } from "../../../Types/AI/IncidentAlertAiInsights";
import { IncidentAlertAiSubjectKind } from "../../../Types/AI/IncidentAlertAiLogs";
import { JSONObject } from "../../../Types/JSON";

/*
 * What the Incidents' (or Alerts') AI Insights route answers for a project
 * OneUptime AI has worked on, and for one it has not, shared by the suites
 * of the words (IncidentAlertAiInsightsData.test.ts) and of the pages that
 * render them (IncidentAlertAiInsightsPage.test.tsx).
 *
 * The story: one problem - a disk monitor on the database - was investigated
 * five times across four incidents; a fix for it was applied and did not
 * help; its latest TL;DR call failed, so its finding comes from the report.
 * A second, one-off problem has no finding. AI skipped six of the window's
 * twenty incidents because no LLM provider was set up, and two more were
 * below the severity floor. The database monitor was behind most of what AI
 * investigated, and the payments service was hit twice.
 */

export const SUBJECT_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
export const OTHER_SUBJECT_ID: string = "aaaaaaaa-0000-4000-8000-000000000002";
export const MONITOR_ID: string = "bbbbbbbb-0000-4000-8000-000000000001";
export const SERVICE_ID: string = "cccccccc-0000-4000-8000-000000000001";
export const RUN_ID: string = "dddddddd-0000-4000-8000-000000000001";

export const RECURRING_PROBLEM_KEY: string = "problem-00000001";
export const ONE_OFF_PROBLEM_KEY: string = "problem-00000002";

export const RECURRING_TITLE: string = "Disk full on db-1";
export const ONE_OFF_TITLE: string = "Checkout latency";
export const MONITOR_NAME: string = "Database disk";
export const SERVICE_NAME: string = "Payments";
export const REPORT_FINDING: string =
  "Application logs filled the data volume after the 02:00 rotation failed.";

export const WINDOW_START: string = "2026-09-06T00:00:00.000Z";
export const GENERATED_AT: string = "2026-10-05T10:00:00.000Z";

// The number each product's project writes in front of its numbers.
export const NUMBER_PREFIXES: Record<IncidentAlertAiSubjectKind, string> = {
  incident: "INC-",
  alert: "ALT-",
};

export function subjectOf(
  subjectKind: IncidentAlertAiSubjectKind,
  overrides: Partial<AiActivitySubject> = {},
): AiActivitySubject {
  return {
    kind: subjectKind,
    id: SUBJECT_ID,
    title: RECURRING_TITLE,
    number: 42,
    numberWithPrefix: `${NUMBER_PREFIXES[subjectKind]}42`,
    ...overrides,
  };
}

// Investigations on the last three days of the window, one of them failed.
export function makeTrend(): Array<AiActivityTrendDay> {
  const days: Array<AiActivityTrendDay> = [];

  for (let index: number = 0; index < 30; index++) {
    const date: Date = new Date(
      Date.parse(WINDOW_START) + index * 24 * 60 * 60 * 1000,
    );

    days.push({
      date: date.toISOString().slice(0, 10),
      investigations: index === 27 ? 1 : index === 28 ? 3 : 0,
      failedInvestigations: index === 28 ? 1 : 0,
      fixes: index === 28 ? 2 : 0,
    });
  }

  return days;
}

export function makeIncidentAlertInsights(
  subjectKind: IncidentAlertAiSubjectKind,
  overrides: Partial<IncidentAlertAiInsights> = {},
): IncidentAlertAiInsights {
  return {
    subjectKind,
    windowInDays: 30,
    windowStart: WINDOW_START,
    generatedAt: GENERATED_AT,
    totals: {
      investigations: 12,
      completedInvestigations: 10,
      failedInvestigations: 2,
      activeInvestigations: 0,
      problems: 4,
      recurringProblems: 2,
      fixes: 5,
      fixTasks: 2,
      commands: 30,
      failedCommands: 2,
      timedOutCommands: 1,
    },
    attention: [
      {
        kind: AiActivityAttentionKind.FixesFailed,
        severity: AiActivityAttentionSeverity.High,
        count: 1,
        total: 3,
        subject: subjectOf(subjectKind),
      },
      {
        kind: AiActivityAttentionKind.InvestigationsNotStarted,
        severity: AiActivityAttentionSeverity.High,
        count: 6,
        total: 20,
        reason: "provider_missing",
      },
      {
        kind: AiActivityAttentionKind.RecurringProblem,
        severity: AiActivityAttentionSeverity.High,
        count: 5,
        recentCount: 3,
        problemKey: RECURRING_PROBLEM_KEY,
        title: RECURRING_TITLE,
        subject: subjectOf(subjectKind),
      },
      {
        kind: AiActivityAttentionKind.CommandsTimedOut,
        severity: AiActivityAttentionSeverity.Medium,
        count: 1,
        total: 30,
      },
      {
        kind: AiActivityAttentionKind.MonitorHotspot,
        severity: AiActivityAttentionSeverity.Low,
        count: 7,
        total: 12,
        monitor: { id: MONITOR_ID, name: MONITOR_NAME },
      },
    ],
    problems: [
      {
        key: RECURRING_PROBLEM_KEY,
        title: RECURRING_TITLE,
        investigationCount: 5,
        subjectCount: 4,
        isRecurring: true,
        firstSeenAt: "2026-09-20T00:00:00.000Z",
        lastSeenAt: "2026-10-04T00:00:00.000Z",
        latestSubject: subjectOf(subjectKind),
        objects: [{ name: "Host", value: "db-1", count: 3 }],
        monitors: [{ id: MONITOR_ID, name: MONITOR_NAME }],
        latestFinding: {
          aiRunId: RUN_ID,
          text: REPORT_FINDING,
          source: "report",
          at: "2026-10-04T00:05:00.000Z",
        },
        verdicts: {
          confirmed: 1,
          rejected: 0,
          matched: 2,
          partlyMatched: 0,
          mismatched: 0,
        },
        fixes: {
          proposed: 2,
          applied: 1,
          verified: 0,
          failed: 1,
          awaitingApproval: 1,
        },
      },
      {
        key: ONE_OFF_PROBLEM_KEY,
        title: ONE_OFF_TITLE,
        investigationCount: 1,
        subjectCount: 1,
        isRecurring: false,
        lastSeenAt: "2026-10-03T00:00:00.000Z",
        latestSubject: subjectOf(subjectKind, {
          id: OTHER_SUBJECT_ID,
          title: ONE_OFF_TITLE,
          number: 41,
          numberWithPrefix: `${NUMBER_PREFIXES[subjectKind]}41`,
        }),
        objects: [],
        monitors: [],
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
    hotspots: [],
    fixOutcomes: {
      total: 5,
      planning: 0,
      awaitingApproval: 1,
      appliedAutomatically: 2,
      appliedAfterApproval: 1,
      dismissed: 1,
      noFixFound: 0,
      verified: 2,
      failed: 1,
      verifying: 0,
    },
    trend: makeTrend(),
    preventiveInsights: [],
    isPartial: false,
    coverage: {
      subjects: 20,
      investigatedSubjects: 12,
      notInvestigated: [
        { code: "provider_missing", count: 6 },
        { code: "severity_below_threshold", count: 2 },
      ],
    },
    monitors: [
      {
        id: MONITOR_ID,
        name: MONITOR_NAME,
        subjectCount: 4,
        investigationCount: 7,
        problemCount: 1,
        lastSeenAt: "2026-10-04T00:00:00.000Z",
      },
    ],
    services: [
      {
        id: SERVICE_ID,
        name: SERVICE_NAME,
        subjectCount: 2,
        investigationCount: 2,
        problemCount: 2,
        lastSeenAt: "2026-10-03T00:00:00.000Z",
      },
    ],
    fixTaskOutcomes: {
      total: 2,
      pullRequestsOpened: 1,
      noFixFound: 1,
      inProgress: 0,
      failed: 0,
      cancelled: 0,
    },
    fixesHidden: false,
    ...overrides,
  };
}

/*
 * A window in which AI did nothing at all: AI skipped every incident,
 * because no LLM provider is set up.
 */
export function makeQuietIncidentAlertInsights(
  subjectKind: IncidentAlertAiSubjectKind,
): IncidentAlertAiInsights {
  return makeIncidentAlertInsights(subjectKind, {
    totals: {
      investigations: 0,
      completedInvestigations: 0,
      failedInvestigations: 0,
      activeInvestigations: 0,
      problems: 0,
      recurringProblems: 0,
      fixes: 0,
      fixTasks: 0,
      commands: 0,
      failedCommands: 0,
      timedOutCommands: 0,
    },
    attention: [
      {
        kind: AiActivityAttentionKind.InvestigationsNotStarted,
        severity: AiActivityAttentionSeverity.High,
        count: 7,
        total: 7,
        reason: "provider_missing",
      },
    ],
    problems: [],
    monitors: [],
    services: [],
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
    fixTaskOutcomes: {
      total: 0,
      pullRequestsOpened: 0,
      noFixFound: 0,
      inProgress: 0,
      failed: 0,
      cancelled: 0,
    },
    coverage: {
      subjects: 7,
      investigatedSubjects: 0,
      notInvestigated: [{ code: "provider_missing", count: 7 }],
    },
    trend: makeTrend().map((day: AiActivityTrendDay): AiActivityTrendDay => {
      return { ...day, investigations: 0, failedInvestigations: 0, fixes: 0 };
    }),
  });
}

// The insights as they cross the wire: plain JSON.
export function toBody(insights: IncidentAlertAiInsights): JSONObject {
  return JSON.parse(JSON.stringify(insights)) as JSONObject;
}
