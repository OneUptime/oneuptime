import {
  AiActivityInsight,
  AiActivityInsightKind,
  AiActivityInsightTone,
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
 * The story, the way the page should tell it:
 *
 *   - "Disk full on db-1" keeps coming back: 12 of the 20 incidents this
 *     month, 4 of them in the last 7 days (up from 1), nearly always in the
 *     small hours. Its monitor is Database disk. Its investigation's TL;DR
 *     call failed, so what AI found comes from the report, with the step it
 *     suggests. A fix for it was applied and did not help.
 *   - OneUptime AI did not look into 8 of the 20, mostly because there is no
 *     LLM provider it can use.
 *   - The Payments service was part of 7 of the 20, across two problems.
 *   - The team approved every fix AI proposed: AI could apply fixes like
 *     these on its own, if it were allowed to.
 *   - A one-off "Checkout latency" has no finding yet.
 */

export const SUBJECT_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
export const OTHER_SUBJECT_ID: string = "aaaaaaaa-0000-4000-8000-000000000002";
export const THIRD_SUBJECT_ID: string = "aaaaaaaa-0000-4000-8000-000000000003";
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
export const NEXT_STEP: string =
  "Fix the log rotation job on db-1, then free the data volume.";

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

// The one-off problem's incident (or alert): number 41.
export function oneOffSubjectOf(
  subjectKind: IncidentAlertAiSubjectKind,
): AiActivitySubject {
  return subjectOf(subjectKind, {
    id: OTHER_SUBJECT_ID,
    title: ONE_OFF_TITLE,
    number: 41,
    numberWithPrefix: `${NUMBER_PREFIXES[subjectKind]}41`,
  });
}

// An older one of the recurring problem: number 39.
export function olderSubjectOf(
  subjectKind: IncidentAlertAiSubjectKind,
): AiActivitySubject {
  return subjectOf(subjectKind, {
    id: THIRD_SUBJECT_ID,
    number: 39,
    numberWithPrefix: `${NUMBER_PREFIXES[subjectKind]}39`,
  });
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

// The insights the page leads with, in the server's order.
export function makeIncidentAlertInsightList(
  subjectKind: IncidentAlertAiSubjectKind,
): Array<AiActivityInsight> {
  return [
    {
      kind: AiActivityInsightKind.RecurringProblem,
      tone: AiActivityInsightTone.Critical,
      count: 12,
      total: 20,
      recentCount: 4,
      previousCount: 1,
      problemKey: RECURRING_PROBLEM_KEY,
      title: RECURRING_TITLE,
      firstSeenAt: "2026-09-20T02:10:00.000Z",
      lastSeenAt: "2026-10-04T02:40:00.000Z",
      finding: {
        aiRunId: RUN_ID,
        text: REPORT_FINDING,
        source: "report",
        at: "2026-10-04T02:52:00.000Z",
      },
      nextStep: NEXT_STEP,
      timeOfDay: {
        startHourUtc: 2,
        hours: 3,
        count: 10,
        total: 12,
        days: 6,
        totalDays: 7,
      },
      monitors: [{ id: MONITOR_ID, name: MONITOR_NAME }],
      subject: subjectOf(subjectKind),
      evidence: [subjectOf(subjectKind), olderSubjectOf(subjectKind)],
      evidenceCount: 12,
    },
    {
      kind: AiActivityInsightKind.FixesDidNotHelp,
      tone: AiActivityInsightTone.Critical,
      count: 1,
      total: 3,
      subject: subjectOf(subjectKind),
      evidence: [subjectOf(subjectKind)],
      evidenceCount: 1,
    },
    {
      kind: AiActivityInsightKind.NotInvestigated,
      tone: AiActivityInsightTone.Pattern,
      count: 8,
      total: 20,
      reason: "provider_missing",
    },
    {
      kind: AiActivityInsightKind.Hotspot,
      tone: AiActivityInsightTone.Pattern,
      count: 7,
      total: 20,
      problemCount: 2,
      service: { id: SERVICE_ID, name: SERVICE_NAME },
      lastSeenAt: "2026-10-04T02:40:00.000Z",
      subject: oneOffSubjectOf(subjectKind),
      evidence: [oneOffSubjectOf(subjectKind), subjectOf(subjectKind)],
      evidenceCount: 7,
    },
    {
      kind: AiActivityInsightKind.ReadyForAutomaticFixes,
      tone: AiActivityInsightTone.Positive,
      count: 4,
      verifiedCount: 3,
      subject: subjectOf(subjectKind),
      evidence: [subjectOf(subjectKind)],
      evidenceCount: 4,
    },
  ];
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
      occurrences: 20,
      investigations: 12,
      completedInvestigations: 10,
      failedInvestigations: 2,
      activeInvestigations: 0,
      confirmedFindings: 3,
      rejectedFindings: 0,
      problems: 4,
      recurringProblems: 2,
      fixes: 5,
      fixTasks: 2,
      commands: 30,
      failedCommands: 2,
      timedOutCommands: 1,
    },
    insights: makeIncidentAlertInsightList(subjectKind),
    problems: [
      {
        key: RECURRING_PROBLEM_KEY,
        title: RECURRING_TITLE,
        occurrenceCount: 12,
        recentOccurrenceCount: 4,
        previousOccurrenceCount: 1,
        investigationCount: 5,
        subjectCount: 4,
        isRecurring: true,
        firstSeenAt: "2026-09-20T02:10:00.000Z",
        lastSeenAt: "2026-10-04T02:40:00.000Z",
        latestSubject: subjectOf(subjectKind),
        objects: [{ name: "Host", value: "db-1", count: 3 }],
        monitors: [{ id: MONITOR_ID, name: MONITOR_NAME }],
        latestFinding: {
          aiRunId: RUN_ID,
          text: REPORT_FINDING,
          source: "report",
          at: "2026-10-04T02:52:00.000Z",
        },
        latestNextStep: NEXT_STEP,
        timeOfDay: {
          startHourUtc: 2,
          hours: 3,
          count: 10,
          total: 12,
          days: 6,
          totalDays: 7,
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
        occurrenceCount: 1,
        recentOccurrenceCount: 1,
        previousOccurrenceCount: 0,
        investigationCount: 1,
        subjectCount: 1,
        isRecurring: false,
        firstSeenAt: "2026-10-03T00:00:00.000Z",
        lastSeenAt: "2026-10-03T00:00:00.000Z",
        latestSubject: oneOffSubjectOf(subjectKind),
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
        occurrenceCount: 12,
        subjectCount: 4,
        investigationCount: 7,
        problemCount: 1,
        lastSeenAt: "2026-10-04T02:40:00.000Z",
      },
    ],
    services: [
      {
        id: SERVICE_ID,
        name: SERVICE_NAME,
        occurrenceCount: 7,
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
      occurrences: 7,
      investigations: 0,
      completedInvestigations: 0,
      failedInvestigations: 0,
      activeInvestigations: 0,
      confirmedFindings: 0,
      rejectedFindings: 0,
      problems: 0,
      recurringProblems: 0,
      fixes: 0,
      fixTasks: 0,
      commands: 0,
      failedCommands: 0,
      timedOutCommands: 0,
    },
    insights: [
      {
        kind: AiActivityInsightKind.NotInvestigated,
        tone: AiActivityInsightTone.Pattern,
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
