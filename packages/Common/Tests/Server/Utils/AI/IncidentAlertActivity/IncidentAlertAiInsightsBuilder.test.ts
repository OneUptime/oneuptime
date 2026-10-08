import AiActivityInsightsBuilder, {
  AiActivityInsightsInput,
  AiActivityInvestigationInput,
  toPublicProblemKey,
} from "../../../../../Server/Utils/AI/ActivityInsights/AiActivityInsightsBuilder";
import IncidentAlertAiInsightsBuilder, {
  IncidentAlertAiFixInput,
  IncidentAlertAiFixTaskInput,
  IncidentAlertAiInsightsInput,
  IncidentAlertAiInvestigationInput,
  IncidentAlertAiSubjectInput,
  NOT_STARTED_TONES,
} from "../../../../../Server/Utils/AI/IncidentAlertActivity/IncidentAlertAiInsightsBuilder";
import AIRunAutoGrade from "../../../../../Types/AI/AIRunAutoGrade";
import AIRunHumanVerdict from "../../../../../Types/AI/AIRunHumanVerdict";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import {
  AI_ACTIVITY_INSIGHTS_MAX_HOTSPOTS,
  AI_ACTIVITY_INSIGHTS_MAX_INSIGHTS,
  AI_ACTIVITY_INSIGHTS_MAX_PROBLEMS,
  AiActivityInsight,
  AiActivityInsightKind,
  AiActivityInsightTone,
  AiActivityProblem,
} from "../../../../../Types/AI/AiActivityInsights";
import { IncidentAlertAiInsights } from "../../../../../Types/AI/IncidentAlertAiInsights";
import { IncidentAlertAiSubjectKind } from "../../../../../Types/AI/IncidentAlertAiLogs";
import { InvestigationNotStartedCode } from "../../../../../Types/AI/InvestigationNotStartedReason";
import AutoRemediationSuggestionStatus from "../../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationVerificationStatus from "../../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import { describe, expect, test } from "@jest/globals";

/*
 * The pure half of the Incidents and Alerts AI Insights: what is worth
 * knowing about the window's incidents (or alerts), from rows the reader
 * already filtered to what the caller may read. The same input always gives
 * the same insights.
 *
 * Most of it is the shared AI Insights builder's (AiActivityInsightsBuilder,
 * pinned by its own suites): these pin what this builder hands it - every
 * row with its incident or alert, everything that came up, the fixes only
 * for a caller who may read them, no part hotspots - and what it adds: the
 * monitors and services that keep failing, each problem's monitors (on its
 * row and its insight), coverage, the fix pull requests and the two
 * insights only these rows can say.
 */

// 2026-10-05 15:00 UTC: the window runs from 2026-09-06 00:00 UTC.
const NOW: Date = new Date("2026-10-05T15:00:00.000Z");
const WINDOW_START: string = "2026-09-06T00:00:00.000Z";
const DAY: number = 24 * 60 * 60 * 1000;

const DIGITS_REGEX: RegExp = /\D/g;

function daysAgo(days: number, hours: number = 0): Date {
  return new Date(NOW.getTime() - days * DAY - hours * 60 * 60 * 1000);
}

function subject(
  id: string,
  overrides: Partial<IncidentAlertAiSubjectInput> = {},
): IncidentAlertAiSubjectInput {
  return {
    id,
    createdAt: daysAgo(3),
    title: `Incident ${id}`,
    number: Number(id.replace(DIGITS_REGEX, "")) || undefined,
    numberWithPrefix: `INC-${id}`,
    monitorIds: [],
    serviceIds: [],
    ...overrides,
  };
}

let runCounter: number = 0;

function run(
  subjectId: string,
  createdAt: Date,
  overrides: Partial<IncidentAlertAiInvestigationInput> = {},
): IncidentAlertAiInvestigationInput {
  runCounter++;
  return {
    aiRunId: `run-${runCounter}`,
    status: AIRunStatus.Completed,
    createdAt,
    completedAt: new Date(createdAt.getTime() + 60 * 1000),
    tldr: `Finding ${runCounter}`,
    subjectId,
    ...overrides,
  };
}

let fixCounter: number = 0;

function fix(
  subjectId: string,
  createdAt: Date,
  overrides: Partial<IncidentAlertAiFixInput> = {},
): IncidentAlertAiFixInput {
  fixCounter++;
  return {
    id: `fix-${fixCounter}`,
    status: AutoRemediationSuggestionStatus.Suggested,
    createdAt,
    subjectId,
    ...overrides,
  };
}

function task(
  subjectId: string,
  status: AIRunStatus,
  createdAt: Date = daysAgo(1),
): IncidentAlertAiFixTaskInput {
  fixCounter++;
  return { id: `task-${fixCounter}`, status, createdAt, subjectId };
}

function input(
  overrides: Partial<IncidentAlertAiInsightsInput> = {},
): IncidentAlertAiInsightsInput {
  return {
    subjectKind: "incident",
    now: NOW,
    windowInDays: 30,
    investigations: [],
    fixes: [],
    fixTasks: [],
    subjects: new Map<string, IncidentAlertAiSubjectInput>(),
    monitorNames: new Map<string, string>(),
    serviceNames: new Map<string, string>(),
    commands: { total: 0, failed: 0, timedOut: 0 },
    subjectsInWindow: 0,
    notInvestigatedReasons: new Map<string, InvestigationNotStartedCode>(),
    isPartial: false,
    ...overrides,
  };
}

function subjects(
  ...list: Array<IncidentAlertAiSubjectInput>
): Map<string, IncidentAlertAiSubjectInput> {
  return new Map<string, IncidentAlertAiSubjectInput>(
    list.map((item: IncidentAlertAiSubjectInput) => {
      return [item.id, item];
    }),
  );
}

function kindsOf(
  insights: IncidentAlertAiInsights,
): Array<AiActivityInsightKind> {
  return insights.insights.map((item: AiActivityInsight) => {
    return item.kind;
  });
}

function insightOf(
  insights: IncidentAlertAiInsights,
  kind: AiActivityInsightKind,
): AiActivityInsight | undefined {
  return insights.insights.find((item: AiActivityInsight) => {
    return item.kind === kind;
  });
}

describe("toActivityInput: the rows as the shared builder takes them", () => {
  test.each(["incident", "alert"] as Array<IncidentAlertAiSubjectKind>)(
    "every %s run carries its subject, as the reader read it",
    (subjectKind: IncidentAlertAiSubjectKind) => {
      const activity: AiActivityInsightsInput =
        IncidentAlertAiInsightsBuilder.toActivityInput(
          input({
            subjectKind,
            subjects: subjects(
              subject("i1", {
                monitorIds: ["m1"],
                serviceIds: ["s1"],
                seriesLabels: { "host.name": "db-1" },
              }),
            ),
            investigations: [
              run("i1", daysAgo(1), {
                tldr: "It ran out of disk.",
                reportSummary: "The disk filled up.",
                nextStep: "Turn on log rotation.",
                humanVerdict: AIRunHumanVerdict.Confirmed,
                autoGrade: AIRunAutoGrade.Match,
              }),
            ],
          }),
        );

      const investigation: AiActivityInvestigationInput =
        activity.investigations[0]!;

      expect(activity.investigations).toHaveLength(1);
      expect(investigation).toEqual({
        aiRunId: expect.any(String),
        status: AIRunStatus.Completed,
        createdAt: daysAgo(1),
        completedAt: new Date(daysAgo(1).getTime() + 60 * 1000),
        tldr: "It ran out of disk.",
        reportSummary: "The disk filled up.",
        nextStep: "Turn on log rotation.",
        humanVerdict: AIRunHumanVerdict.Confirmed,
        autoGrade: AIRunAutoGrade.Match,
        subject: {
          kind: subjectKind,
          id: "i1",
          title: "Incident i1",
          number: 1,
          numberWithPrefix: "INC-i1",
          monitorIds: ["m1"],
          serviceIds: ["s1"],
          seriesLabels: { "host.name": "db-1" },
          createdAt: daysAgo(3),
        },
      });
      // The same subject is the builder's to link insights to.
      expect(activity.subjects?.get("i1")).toEqual(investigation.subject);
    },
  );

  test("a row about an incident the caller may not read is left out", () => {
    const activity: AiActivityInsightsInput =
      IncidentAlertAiInsightsBuilder.toActivityInput(
        input({
          subjects: subjects(subject("i1")),
          investigations: [run("i1", daysAgo(1)), run("hidden", daysAgo(1))],
          fixes: [fix("i1", daysAgo(1)), fix("hidden", daysAgo(1))],
        }),
      );

    expect(activity.investigations).toHaveLength(1);
    expect(activity.fixes).toHaveLength(1);
    expect(Array.from(activity.subjects!.keys())).toEqual(["i1"]);
  });

  test("everything that came up is the window's incidents the reader listed, as the caller may read them", () => {
    const activity: AiActivityInsightsInput =
      IncidentAlertAiInsightsBuilder.toActivityInput(
        input({
          subjects: subjects(subject("i1"), subject("i2")),
          occurrenceIds: ["i2", "unread", "i1"],
        }),
      );

    expect(
      activity.occurrences!.map((occurrence: { id: string }): string => {
        return occurrence.id;
      }),
    ).toEqual(["i2", "i1"]);
  });

  test("without the reader's list, nothing more than the investigated incidents came up", () => {
    expect(
      IncidentAlertAiInsightsBuilder.toActivityInput(
        input({ subjects: subjects(subject("i1")) }),
      ).occurrences,
    ).toEqual([]);
  });

  test.each([
    ["incident", { incidentId: "i1" }],
    ["alert", { alertId: "i1" }],
  ] as Array<[IncidentAlertAiSubjectKind, Record<string, string>]>)(
    "the %s fix names its subject in its own column, and when it was approved",
    (
      subjectKind: IncidentAlertAiSubjectKind,
      column: Record<string, string>,
    ) => {
      const activity: AiActivityInsightsInput =
        IncidentAlertAiInsightsBuilder.toActivityInput(
          input({
            subjectKind,
            subjects: subjects(subject("i1")),
            fixes: [
              fix("i1", daysAgo(1), {
                status: AutoRemediationSuggestionStatus.Approved,
                verificationStatus: AutoRemediationVerificationStatus.Failed,
                approvedAt: daysAgo(0, 20),
              }),
            ],
          }),
        );

      expect(activity.fixes).toEqual([
        {
          id: expect.any(String),
          status: AutoRemediationSuggestionStatus.Approved,
          verificationStatus: AutoRemediationVerificationStatus.Failed,
          createdAt: daysAgo(1),
          approvedAt: daysAgo(0, 20),
          ...column,
        },
      ]);
    },
  );

  test("a caller who may not read fixes hands over none", () => {
    expect(
      IncidentAlertAiInsightsBuilder.toActivityInput(
        input({ fixes: null, subjects: subjects(subject("i1")) }),
      ).fixes,
    ).toEqual([]);
  });

  test("a project has no parts, preventive findings or scope labels of its own", () => {
    const activity: AiActivityInsightsInput =
      IncidentAlertAiInsightsBuilder.toActivityInput(
        input({
          commands: { total: 4, failed: 1, timedOut: 1 },
          isPartial: true,
        }),
      );

    expect(activity).toMatchObject({
      now: NOW,
      windowInDays: 30,
      commands: { total: 4, failed: 1, timedOut: 1 },
      preventiveInsights: [],
      scopeLabelKeys: [],
      scopeNames: [],
      isPartial: true,
      includeHotspots: false,
    });
  });

  test("the window is the shared builder's: 30 UTC days ending today", () => {
    expect(
      AiActivityInsightsBuilder.getWindowStart(NOW, 30).toISOString(),
    ).toBe(WINDOW_START);
    expect(IncidentAlertAiInsightsBuilder.build(input()).windowStart).toBe(
      WINDOW_START,
    );
  });
});

describe("build: problems are grouped the shared builder's way", () => {
  test("by the monitors that raised them, under a key that hides their ids", () => {
    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(
            subject("i1", { monitorIds: ["m2", "m1"] }),
            subject("i2", { monitorIds: ["m1", "m2"] }),
          ),
          investigations: [run("i1", daysAgo(2)), run("i2", daysAgo(1))],
        }),
      );

    expect(insights.problems).toHaveLength(1);
    expect(insights.problems[0]!.key).toBe(toPublicProblemKey("monitor:m1,m2"));
    expect(insights.problems[0]!.key).not.toContain("m1");
  });

  test("without a monitor, by the title without the series identity alerts append", () => {
    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjectKind: "alert",
          subjects: subjects(
            subject("a1", {
              title: "Pod CPU high - Pod: web-1",
              seriesLabels: { "k8s.pod.name": "web-1" },
            }),
            subject("a2", {
              title: "Pod CPU high - Pod: web-2",
              seriesLabels: { "k8s.pod.name": "web-2" },
            }),
          ),
          investigations: [run("a1", daysAgo(2)), run("a2", daysAgo(1))],
        }),
      );

    expect(insights.problems).toHaveLength(1);
    expect(insights.problems[0]!.title).toBe("Pod CPU high");
    expect(insights.problems[0]!.subjectCount).toBe(2);
    expect(insights.problems[0]!.latestSubject).toMatchObject({
      kind: "alert",
      id: "a2",
    });
  });

  test("without a monitor or a title, an incident is a problem of its own", () => {
    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(
            subject("i1", { title: undefined }),
            subject("i2", { title: undefined }),
          ),
          investigations: [run("i1", daysAgo(2)), run("i2", daysAgo(1))],
        }),
      );

    expect(insights.problems).toHaveLength(2);
  });

  test("every incident of the window the same monitor raised counts, investigated or not", () => {
    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(
            subject("i1", { monitorIds: ["m1"], createdAt: daysAgo(1) }),
            subject("i2", { monitorIds: ["m1"], createdAt: daysAgo(2) }),
            subject("i3", { monitorIds: ["m1"], createdAt: daysAgo(9) }),
          ),
          occurrenceIds: ["i1", "i2", "i3"],
          investigations: [run("i1", daysAgo(1))],
        }),
      );

    expect(insights.problems[0]).toMatchObject({
      occurrenceCount: 3,
      recentOccurrenceCount: 2,
      previousOccurrenceCount: 1,
      investigationCount: 1,
      subjectCount: 1,
    });
    expect(insights.totals.occurrences).toBe(3);
  });
});

describe("build: an empty window", () => {
  test("says nothing happened, day by day", () => {
    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(input({ subjectsInWindow: 12 }));

    expect(insights.subjectKind).toBe("incident");
    expect(insights.windowInDays).toBe(30);
    expect(insights.windowStart).toBe(WINDOW_START);
    expect(insights.generatedAt).toBe(NOW.toISOString());
    expect(insights.totals).toEqual({
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
      fixTasks: 0,
      commands: 0,
      failedCommands: 0,
      timedOutCommands: 0,
    });
    expect(insights.coverage).toEqual({
      subjects: 12,
      investigatedSubjects: 0,
      notInvestigated: [],
    });
    expect(insights.insights).toEqual([]);
    expect(insights.problems).toEqual([]);
    expect(insights.monitors).toEqual([]);
    expect(insights.services).toEqual([]);
    // A project has no parts, and no preventive findings of its own.
    expect(insights.hotspots).toEqual([]);
    expect(insights.preventiveInsights).toEqual([]);
    expect(insights.fixesHidden).toBe(false);
    expect(insights.fixOutcomes).toEqual({
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
    });
    expect(insights.fixTaskOutcomes).toEqual({
      total: 0,
      pullRequestsOpened: 0,
      noFixFound: 0,
      inProgress: 0,
      failed: 0,
      cancelled: 0,
    });
    expect(insights.trend).toHaveLength(30);
    expect(insights.trend[0]).toEqual({
      date: "2026-09-06",
      investigations: 0,
      failedInvestigations: 0,
      fixes: 0,
    });
    expect(insights.trend[29]!.date).toBe("2026-10-05");
    expect(insights.isPartial).toBe(false);
  });

  test("an alert window is the alert page's", () => {
    expect(
      IncidentAlertAiInsightsBuilder.build(input({ subjectKind: "alert" }))
        .subjectKind,
    ).toBe("alert");
  });
});

describe("build: what is counted", () => {
  test("only the window's rows, about incidents the caller may read", () => {
    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(subject("i1")),
          investigations: [
            run("i1", daysAgo(1)),
            // Before the window.
            run("i1", daysAgo(31)),
            // About an incident the caller may not read.
            run("i2", daysAgo(1)),
          ],
          fixes: [fix("i1", daysAgo(1)), fix("i2", daysAgo(1))],
          fixTasks: [
            task("i1", AIRunStatus.Completed),
            task("i2", AIRunStatus.Completed),
          ],
        }),
      );

    expect(insights.totals.investigations).toBe(1);
    expect(insights.totals.fixes).toBe(1);
    expect(insights.totals.fixTasks).toBe(1);
  });

  test("counts investigations by how they ended, and what was made of their findings", () => {
    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(subject("i1")),
          investigations: [
            run("i1", daysAgo(1), {
              humanVerdict: AIRunHumanVerdict.Confirmed,
            }),
            run("i1", daysAgo(1), { status: AIRunStatus.Error }),
            run("i1", daysAgo(1), { status: AIRunStatus.Stale }),
            run("i1", daysAgo(1), { status: AIRunStatus.Queued }),
            run("i1", daysAgo(1), { status: AIRunStatus.Running }),
            run("i1", daysAgo(1), {
              status: AIRunStatus.WaitingForApproval,
              autoGrade: AIRunAutoGrade.Mismatch,
            }),
            run("i1", daysAgo(1), { status: AIRunStatus.Cancelled }),
          ],
        }),
      );

    expect(insights.totals).toMatchObject({
      investigations: 7,
      completedInvestigations: 1,
      failedInvestigations: 2,
      activeInvestigations: 3,
      confirmedFindings: 1,
      rejectedFindings: 1,
    });
  });

  test("passes the command counts on, never below zero", () => {
    expect(
      IncidentAlertAiInsightsBuilder.build(
        input({ commands: { total: 40, failed: 3, timedOut: 2 } }),
      ).totals,
    ).toMatchObject({ commands: 40, failedCommands: 3, timedOutCommands: 2 });
    expect(
      IncidentAlertAiInsightsBuilder.build(
        input({ commands: { total: -1, failed: -1, timedOut: -1 } }),
      ).totals,
    ).toMatchObject({ commands: 0, failedCommands: 0, timedOutCommands: 0 });
  });

  test("a caller who may not read fixes gets none, and the insights say they are hidden", () => {
    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({
          fixes: null,
          subjects: subjects(subject("i1")),
          investigations: [run("i1", daysAgo(1))],
        }),
      );

    expect(insights.fixesHidden).toBe(true);
    expect(insights.totals.fixes).toBe(0);
    expect(insights.fixOutcomes.total).toBe(0);
    expect(insights.problems[0]!.fixes.proposed).toBe(0);
    expect(
      insights.trend.every((day: { fixes: number }): boolean => {
        return day.fixes === 0;
      }),
    ).toBe(true);
  });

  test("a caller who may read fixes, with none in the window, sees zeros", () => {
    expect(
      IncidentAlertAiInsightsBuilder.build(
        input({ fixes: [], subjects: subjects(subject("i1")) }),
      ).fixesHidden,
    ).toBe(false);
  });

  test("says when the reader could not read the whole window", () => {
    expect(
      IncidentAlertAiInsightsBuilder.build(input({ isPartial: true }))
        .isPartial,
    ).toBe(true);
  });
});

describe("build: problems", () => {
  const SHARED_MONITOR: Array<string> = ["m-db"];

  function recurringInput(): IncidentAlertAiInsightsInput {
    return input({
      subjects: subjects(
        subject("i1", {
          monitorIds: SHARED_MONITOR,
          title: "Disk full - Host: db-1",
          seriesLabels: { "host.name": "db-1" },
          createdAt: daysAgo(10),
        }),
        subject("i2", {
          monitorIds: SHARED_MONITOR,
          title: "Disk full - Host: db-2",
          seriesLabels: { "host.name": "db-2" },
          createdAt: daysAgo(2),
        }),
        subject("i3", { title: "Login page down", createdAt: daysAgo(5) }),
      ),
      monitorNames: new Map<string, string>([["m-db", "Database disk"]]),
      investigations: [
        run("i1", daysAgo(10), {
          tldr: "The old finding.",
          humanVerdict: AIRunHumanVerdict.Confirmed,
          autoGrade: AIRunAutoGrade.Match,
        }),
        run("i2", daysAgo(2), {
          tldr: "The disk on db-2 filled with logs.",
          nextStep: "Turn on log rotation on db-2.",
          autoGrade: AIRunAutoGrade.Partial,
        }),
        // The newest has no finding yet: the previous one stands.
        run("i2", daysAgo(1), { status: AIRunStatus.Running, tldr: undefined }),
        run("i3", daysAgo(5), {
          humanVerdict: AIRunHumanVerdict.Rejected,
          autoGrade: AIRunAutoGrade.Mismatch,
        }),
      ],
      fixes: [
        fix("i1", daysAgo(9), {
          status: AutoRemediationSuggestionStatus.AutoExecuted,
          verificationStatus: AutoRemediationVerificationStatus.Verified,
        }),
        fix("i2", daysAgo(2), {
          status: AutoRemediationSuggestionStatus.Approved,
          verificationStatus: AutoRemediationVerificationStatus.Failed,
        }),
        fix("i2", daysAgo(1)),
      ],
    });
  }

  test("groups incidents by the monitor that raised them, the most frequent first", () => {
    const problems: Array<AiActivityProblem> =
      IncidentAlertAiInsightsBuilder.build(recurringInput()).problems;

    expect(
      problems.map((problem: AiActivityProblem) => {
        return [
          problem.title,
          problem.occurrenceCount,
          problem.investigationCount,
          problem.subjectCount,
        ];
      }),
    ).toEqual([
      ["Disk full", 2, 3, 2],
      ["Login page down", 1, 1, 1],
    ]);
  });

  test("a problem says when it came up, whether it recurs, and the latest incident", () => {
    const problem: AiActivityProblem =
      IncidentAlertAiInsightsBuilder.build(recurringInput()).problems[0]!;

    expect(problem.isRecurring).toBe(true);
    expect(problem.firstSeenAt).toBe(daysAgo(10).toISOString());
    expect(problem.lastSeenAt).toBe(daysAgo(2).toISOString());
    expect(problem.latestSubject).toEqual({
      kind: "incident",
      id: "i2",
      title: "Disk full - Host: db-2",
      number: 2,
      numberWithPrefix: "INC-i2",
    });
    expect(problem.key).toBe(toPublicProblemKey("monitor:m-db"));
  });

  test("its finding is the newest completed investigation's TL;DR, with the step its report suggests", () => {
    const problem: AiActivityProblem =
      IncidentAlertAiInsightsBuilder.build(recurringInput()).problems[0]!;

    expect(problem.latestFinding).toEqual({
      aiRunId: expect.any(String),
      text: "The disk on db-2 filled with logs.",
      source: "tldr",
      at: new Date(daysAgo(2).getTime() + 60 * 1000).toISOString(),
    });
    expect(problem.latestNextStep).toBe("Turn on log rotation on db-2.");
  });

  test("without a TL;DR, its finding is the Summary its report opens with", () => {
    const newest: IncidentAlertAiInvestigationInput = run("i1", daysAgo(1), {
      tldr: undefined,
      reportSummary: "The certificate expired at midnight.",
    });

    const problem: AiActivityProblem = IncidentAlertAiInsightsBuilder.build(
      input({
        subjects: subjects(subject("i1")),
        investigations: [
          run("i1", daysAgo(3), { tldr: "An older finding." }),
          newest,
        ],
      }),
    ).problems[0]!;

    expect(problem.latestFinding).toEqual({
      aiRunId: newest.aiRunId,
      text: "The certificate expired at midnight.",
      source: "report",
      at: new Date(daysAgo(1).getTime() + 60 * 1000).toISOString(),
    });
  });

  test("names the report runs a reader should read: each problem's newest completed run, readable ones only", () => {
    const newestI1: IncidentAlertAiInvestigationInput = run("i1", daysAgo(1), {
      tldr: undefined,
    });
    const newestI2: IncidentAlertAiInvestigationInput = run("i2", daysAgo(1));

    const builderInput: IncidentAlertAiInsightsInput = input({
      subjects: subjects(subject("i1"), subject("i2"), subject("i3")),
      investigations: [
        newestI1,
        run("i1", daysAgo(2)),
        // The other problem's newest has a TL;DR: read for its step.
        newestI2,
        // A run whose finding and step are both known is not read again.
        run("i3", daysAgo(1), { nextStep: "Do it." }),
        // Not readable: never named.
        run("hidden", daysAgo(1), { tldr: undefined }),
      ],
    });

    expect(
      AiActivityInsightsBuilder.getRunsNeedingReport(
        IncidentAlertAiInsightsBuilder.toActivityInput(builderInput),
      ).sort(),
    ).toEqual([newestI1.aiRunId, newestI2.aiRunId].sort());
  });

  test("a problem no investigation concluded anything about has no finding", () => {
    const problem: AiActivityProblem = IncidentAlertAiInsightsBuilder.build(
      input({
        subjects: subjects(subject("i1")),
        investigations: [
          run("i1", daysAgo(1), { status: AIRunStatus.Error }),
          run("i1", daysAgo(2), { tldr: "   " }),
        ],
      }),
    ).problems[0]!;

    expect(problem.latestFinding).toBeUndefined();
  });

  test("names the monitors the caller may read, and what people, the grader and the fixes said", () => {
    const problem: AiActivityProblem =
      IncidentAlertAiInsightsBuilder.build(recurringInput()).problems[0]!;

    expect(problem.monitors).toEqual([{ id: "m-db", name: "Database disk" }]);
    // The hosts it fired for, as alerts name them, the latest first.
    expect(problem.objects).toEqual([
      { name: "Host", value: "db-1", key: "host.name", count: 1 },
      { name: "Host", value: "db-2", key: "host.name", count: 1 },
    ]);
    expect(problem.verdicts).toEqual({
      confirmed: 1,
      rejected: 0,
      matched: 1,
      partlyMatched: 1,
      mismatched: 0,
    });
    expect(problem.fixes).toEqual({
      proposed: 3,
      applied: 2,
      verified: 1,
      failed: 1,
      awaitingApproval: 1,
    });
  });

  test("never names a monitor the caller may not read, nor more than three", () => {
    const problem: AiActivityProblem = IncidentAlertAiInsightsBuilder.build(
      input({
        subjects: subjects(
          subject("i1", { monitorIds: ["a", "b", "c", "d", "hidden"] }),
        ),
        monitorNames: new Map<string, string>([
          ["a", "Delta"],
          ["b", "Alpha"],
          ["c", "Charlie"],
          ["d", "Bravo"],
        ]),
        investigations: [run("i1", daysAgo(1))],
      }),
    ).problems[0]!;

    expect(problem.monitors).toEqual([
      { id: "b", name: "Alpha" },
      { id: "d", name: "Bravo" },
      { id: "c", name: "Charlie" },
    ]);
  });

  test("lists at most the page's number of problems", () => {
    const many: Array<IncidentAlertAiSubjectInput> = [];
    const runs: Array<IncidentAlertAiInvestigationInput> = [];

    for (let index: number = 0; index < 15; index++) {
      many.push(subject(`i${index}`, { title: `Problem ${index}` }));
      runs.push(run(`i${index}`, daysAgo(1)));
    }

    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({ subjects: subjects(...many), investigations: runs }),
      );

    expect(insights.problems).toHaveLength(AI_ACTIVITY_INSIGHTS_MAX_PROBLEMS);
    expect(insights.totals.problems).toBe(15);
  });
});

describe("build: monitors and services that keep failing", () => {
  test("count each incident once, investigated or not, and only come up from two on", () => {
    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(
            subject("i1", {
              monitorIds: ["m1", "m1"],
              serviceIds: ["s1"],
              createdAt: daysAgo(3),
            }),
            subject("i2", {
              monitorIds: ["m1"],
              serviceIds: ["s1", "s2"],
              createdAt: daysAgo(2),
            }),
            subject("i3", {
              monitorIds: ["m2"],
              serviceIds: ["s2"],
              createdAt: daysAgo(1),
            }),
            // Never investigated: it still came up, on m1 and s1.
            subject("i4", {
              monitorIds: ["m1"],
              serviceIds: ["s1"],
              createdAt: daysAgo(4),
            }),
          ),
          occurrenceIds: ["i1", "i2", "i3", "i4"],
          monitorNames: new Map<string, string>([
            ["m1", "API latency"],
            ["m2", "Disk"],
          ]),
          serviceNames: new Map<string, string>([
            ["s1", "checkout"],
            ["s2", "payments"],
          ]),
          investigations: [
            run("i1", daysAgo(3)),
            run("i1", daysAgo(2)),
            run("i2", daysAgo(1)),
            run("i3", daysAgo(1)),
          ],
        }),
      );

    expect(insights.monitors).toEqual([
      {
        id: "m1",
        name: "API latency",
        occurrenceCount: 3,
        subjectCount: 2,
        investigationCount: 3,
        problemCount: 1,
        lastSeenAt: daysAgo(2).toISOString(),
      },
    ]);
    expect(insights.services).toEqual([
      {
        id: "s1",
        name: "checkout",
        occurrenceCount: 3,
        subjectCount: 2,
        investigationCount: 3,
        problemCount: 1,
        lastSeenAt: daysAgo(2).toISOString(),
      },
      {
        id: "s2",
        name: "payments",
        occurrenceCount: 2,
        subjectCount: 2,
        investigationCount: 2,
        problemCount: 2,
        lastSeenAt: daysAgo(1).toISOString(),
      },
    ]);
  });

  test("stand in for a cluster's part hotspots, which a project does not have", () => {
    const labels: Record<string, string> = {
      "resource.k8s.namespace.name": "shop",
      "resource.k8s.deployment.name": "checkout",
    };
    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(
            subject("i1", { seriesLabels: labels, monitorIds: ["m1"] }),
            subject("i2", { seriesLabels: labels, monitorIds: ["m1"] }),
            subject("i3", { seriesLabels: labels, monitorIds: ["m1"] }),
          ),
          monitorNames: new Map<string, string>([["m1", "Checkout pods"]]),
          investigations: [
            run("i1", daysAgo(1)),
            run("i2", daysAgo(2)),
            run("i3", daysAgo(3)),
          ],
        }),
      );

    expect(insights.hotspots).toEqual([]);
    expect(
      insights.monitors.map((monitor: { name: string }) => {
        return monitor.name;
      }),
    ).toEqual(["Checkout pods"]);
    // One monitor behind one problem is that problem: no insight of its own.
    expect(kindsOf(insights)).not.toContain(AiActivityInsightKind.Hotspot);
  });

  test("never list a monitor or service the caller may not read", () => {
    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(
            subject("i1", { monitorIds: ["secret"], serviceIds: ["secret"] }),
            subject("i2", { monitorIds: ["secret"], serviceIds: ["secret"] }),
          ),
          investigations: [run("i1", daysAgo(2)), run("i2", daysAgo(1))],
        }),
      );

    expect(insights.monitors).toEqual([]);
    expect(insights.services).toEqual([]);
  });

  test("list at most the page's number", () => {
    const many: Array<IncidentAlertAiSubjectInput> = [];
    const runs: Array<IncidentAlertAiInvestigationInput> = [];
    const names: Map<string, string> = new Map<string, string>();

    for (let index: number = 0; index < 12; index++) {
      for (const copy of ["a", "b"]) {
        many.push(subject(`i${index}${copy}`, { monitorIds: [`m${index}`] }));
        runs.push(run(`i${index}${copy}`, daysAgo(1)));
      }
      names.set(`m${index}`, `Monitor ${String(index).padStart(2, "0")}`);
    }

    expect(
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(...many),
          investigations: runs,
          monitorNames: names,
        }),
      ).monitors,
    ).toHaveLength(AI_ACTIVITY_INSIGHTS_MAX_HOTSPOTS);
  });
});

describe("build: coverage", () => {
  test("of the window's incidents, how many were investigated and why the rest were not", () => {
    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(
            subject("i1"),
            // From before the window: in the totals, not the coverage.
            subject("old", { createdAt: daysAgo(40) }),
            // Skipped at creation, then investigated on request.
            subject("asked"),
          ),
          investigations: [
            run("i1", daysAgo(1)),
            run("old", daysAgo(1)),
            run("asked", daysAgo(1)),
          ],
          subjectsInWindow: 10,
          notInvestigatedReasons: new Map<string, InvestigationNotStartedCode>([
            ["asked", "daily_budget_exhausted"],
            ["s1", "daily_budget_exhausted"],
            ["s2", "daily_budget_exhausted"],
            ["s3", "severity_below_threshold"],
            ["s4", "provider_missing"],
          ]),
        }),
      );

    expect(insights.coverage).toEqual({
      subjects: 10,
      investigatedSubjects: 2,
      notInvestigated: [
        { code: "daily_budget_exhausted", count: 2 },
        { code: "provider_missing", count: 1 },
        { code: "severity_below_threshold", count: 1 },
      ],
    });
    expect(insights.totals.investigations).toBe(3);
  });

  test("never says more were investigated than there were", () => {
    expect(
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(subject("i1"), subject("i2")),
          investigations: [run("i1", daysAgo(1)), run("i2", daysAgo(1))],
          subjectsInWindow: 1,
        }),
      ).coverage,
    ).toMatchObject({ subjects: 2, investigatedSubjects: 2 });
  });
});

describe("build: fixes, fix pull requests and verdicts", () => {
  test("fixes by where they ended up and how verification went", () => {
    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(subject("i1")),
          fixes: [
            fix("i1", daysAgo(1), {
              status: AutoRemediationSuggestionStatus.Planning,
            }),
            fix("i1", daysAgo(1)),
            fix("i1", daysAgo(1), {
              status: AutoRemediationSuggestionStatus.AutoExecuted,
              verificationStatus: AutoRemediationVerificationStatus.Verified,
            }),
            fix("i1", daysAgo(1), {
              status: AutoRemediationSuggestionStatus.Approved,
              verificationStatus: AutoRemediationVerificationStatus.Failed,
            }),
            fix("i1", daysAgo(1), {
              status: AutoRemediationSuggestionStatus.Approved,
              verificationStatus: AutoRemediationVerificationStatus.Pending,
            }),
            fix("i1", daysAgo(1), {
              status: AutoRemediationSuggestionStatus.Dismissed,
            }),
            fix("i1", daysAgo(1), {
              status: AutoRemediationSuggestionStatus.NoneApplicable,
              verificationStatus: AutoRemediationVerificationStatus.Skipped,
            }),
          ],
        }),
      );

    expect(insights.fixOutcomes).toEqual({
      total: 7,
      planning: 1,
      awaitingApproval: 1,
      appliedAutomatically: 1,
      appliedAfterApproval: 2,
      dismissed: 1,
      noFixFound: 1,
      verified: 1,
      failed: 1,
      verifying: 1,
    });
  });

  test("fix pull requests by where they ended up", () => {
    expect(
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(subject("i1")),
          fixTasks: [
            task("i1", AIRunStatus.Completed),
            task("i1", AIRunStatus.Completed),
            task("i1", AIRunStatus.NoFixFound),
            task("i1", AIRunStatus.Queued),
            task("i1", AIRunStatus.Running),
            task("i1", AIRunStatus.Error),
            task("i1", AIRunStatus.Stale),
            task("i1", AIRunStatus.Cancelled),
          ],
        }),
      ).fixTaskOutcomes,
    ).toEqual({
      total: 8,
      pullRequestsOpened: 2,
      noFixFound: 1,
      inProgress: 2,
      failed: 2,
      cancelled: 1,
    });
  });

  test("verdicts are each problem's own investigations'", () => {
    const problems: Array<AiActivityProblem> =
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(
            subject("i1", { monitorIds: ["m1"] }),
            subject("i2", { monitorIds: ["m2"] }),
          ),
          investigations: [
            run("i1", daysAgo(1), {
              humanVerdict: AIRunHumanVerdict.Confirmed,
              autoGrade: AIRunAutoGrade.Match,
            }),
            run("i1", daysAgo(2), { autoGrade: AIRunAutoGrade.Partial }),
            run("i2", daysAgo(1), {
              humanVerdict: AIRunHumanVerdict.Rejected,
              autoGrade: AIRunAutoGrade.Mismatch,
            }),
            run("i2", daysAgo(3)),
            run("i2", daysAgo(4)),
          ],
        }),
      ).problems;

    expect(
      problems.map(
        (
          problem: AiActivityProblem,
        ): [number, AiActivityProblem["verdicts"]] => {
          return [problem.investigationCount, problem.verdicts];
        },
      ),
    ).toEqual([
      [
        3,
        {
          confirmed: 0,
          rejected: 1,
          matched: 0,
          partlyMatched: 0,
          mismatched: 1,
        },
      ],
      [
        2,
        {
          confirmed: 1,
          rejected: 0,
          matched: 1,
          partlyMatched: 1,
          mismatched: 0,
        },
      ],
    ]);
  });

  test("an alert's fixes are counted on the alert's problem", () => {
    const problem: AiActivityProblem = IncidentAlertAiInsightsBuilder.build(
      input({
        subjectKind: "alert",
        subjects: subjects(subject("a1", { monitorIds: ["m1"] })),
        investigations: [run("a1", daysAgo(1))],
        fixes: [
          fix("a1", daysAgo(1), {
            status: AutoRemediationSuggestionStatus.AutoExecuted,
            verificationStatus: AutoRemediationVerificationStatus.Verified,
          }),
        ],
      }),
    ).problems[0]!;

    expect(problem.fixes).toEqual({
      proposed: 1,
      applied: 1,
      verified: 1,
      failed: 0,
      awaitingApproval: 0,
    });
    expect(problem.latestSubject.kind).toBe("alert");
  });
});

describe("build: the trend", () => {
  test("counts investigations, failed ones and fixes on their UTC day", () => {
    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(subject("i1")),
          investigations: [
            // 2026-10-05 13:00 and 2026-10-04 23:00 UTC.
            run("i1", daysAgo(0, 2)),
            run("i1", daysAgo(0, 16), { status: AIRunStatus.Error }),
            run("i1", daysAgo(29, 0)),
          ],
          fixes: [fix("i1", daysAgo(0, 1)), fix("i1", daysAgo(0, 1))],
        }),
      );

    const byDate: Record<string, unknown> = {};

    for (const day of insights.trend) {
      if (day.investigations || day.fixes) {
        byDate[day.date] = day;
      }
    }

    expect(byDate).toEqual({
      "2026-09-06": {
        date: "2026-09-06",
        investigations: 1,
        failedInvestigations: 0,
        fixes: 0,
      },
      "2026-10-04": {
        date: "2026-10-04",
        investigations: 1,
        failedInvestigations: 1,
        fixes: 0,
      },
      "2026-10-05": {
        date: "2026-10-05",
        investigations: 1,
        failedInvestigations: 0,
        fixes: 2,
      },
    });
  });
});

describe("build: the insights", () => {
  test("no warning when nothing went wrong: only the good news", () => {
    expect(
      kindsOf(
        IncidentAlertAiInsightsBuilder.build(
          input({
            subjects: subjects(subject("i1")),
            investigations: [run("i1", daysAgo(1))],
            fixes: [
              fix("i1", daysAgo(1), {
                status: AutoRemediationSuggestionStatus.AutoExecuted,
                verificationStatus: AutoRemediationVerificationStatus.Verified,
              }),
            ],
          }),
        ),
      ),
    ).toEqual([AiActivityInsightKind.FixedAutomatically]);
  });

  test("fixes that did not work, out of the ones applied, with the incident", () => {
    const item: AiActivityInsight | undefined = insightOf(
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(subject("i1"), subject("i2")),
          fixes: [
            fix("i2", daysAgo(1), {
              status: AutoRemediationSuggestionStatus.AutoExecuted,
              verificationStatus: AutoRemediationVerificationStatus.Failed,
            }),
            fix("i1", daysAgo(2), {
              status: AutoRemediationSuggestionStatus.Approved,
              verificationStatus: AutoRemediationVerificationStatus.Verified,
            }),
          ],
        }),
      ),
      AiActivityInsightKind.FixesDidNotHelp,
    );

    expect(item).toEqual({
      kind: AiActivityInsightKind.FixesDidNotHelp,
      tone: AiActivityInsightTone.Critical,
      count: 1,
      total: 2,
      subject: expect.objectContaining({ id: "i2" }),
      evidence: [expect.objectContaining({ id: "i2" })],
      evidenceCount: 1,
    });
  });

  test("a fix that did not help links its incident even when AI did not investigate it in the window", () => {
    const item: AiActivityInsight | undefined = insightOf(
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(subject("fixed-only")),
          fixes: [
            fix("fixed-only", daysAgo(1), {
              status: AutoRemediationSuggestionStatus.AutoExecuted,
              verificationStatus: AutoRemediationVerificationStatus.Failed,
            }),
          ],
        }),
      ),
      AiActivityInsightKind.FixesDidNotHelp,
    );

    expect(item?.subject).toEqual({
      kind: "incident",
      id: "fixed-only",
      title: "Incident fixed-only",
      numberWithPrefix: "INC-fixed-only",
    });
  });

  test.each([
    ["provider_missing", AiActivityInsightTone.Critical],
    ["insufficient_ai_balance", AiActivityInsightTone.Critical],
    ["project_daily_limit_reached", AiActivityInsightTone.Critical],
    ["daily_budget_exhausted", AiActivityInsightTone.Critical],
    ["ai_disabled", AiActivityInsightTone.Warning],
    ["enqueue_failed", AiActivityInsightTone.Warning],
    ["budget_check_failed", AiActivityInsightTone.Warning],
    ["eligibility_check_failed", AiActivityInsightTone.Warning],
    ["automatic_investigation_disabled", AiActivityInsightTone.Pattern],
  ])(
    "incidents skipped because %s are worth saying, as %s",
    (code: string, tone: AiActivityInsightTone) => {
      const item: AiActivityInsight | undefined = insightOf(
        IncidentAlertAiInsightsBuilder.build(
          input({
            subjectsInWindow: 9,
            notInvestigatedReasons: new Map<
              string,
              InvestigationNotStartedCode
            >([
              ["s1", code as InvestigationNotStartedCode],
              ["s2", code as InvestigationNotStartedCode],
            ]),
          }),
        ),
        AiActivityInsightKind.NotInvestigated,
      );

      expect(item).toEqual({
        kind: AiActivityInsightKind.NotInvestigated,
        tone,
        count: 2,
        total: 9,
        reason: code,
      });
      expect(NOT_STARTED_TONES[code as InvestigationNotStartedCode]).toBe(tone);
    },
  );

  test.each([
    "severity_below_threshold",
    "monitor_cooldown",
    "no_run_recorded",
    "no_investigation_rule_matched",
    "created_resolved",
  ])(
    "a skip by the settings' own design (%s) is no insight, but still counted where the skipped ones are listed",
    (code: string) => {
      const insights: IncidentAlertAiInsights =
        IncidentAlertAiInsightsBuilder.build(
          input({
            subjectsInWindow: 9,
            notInvestigatedReasons: new Map<
              string,
              InvestigationNotStartedCode
            >([
              ["s1", code as InvestigationNotStartedCode],
              ["s2", code as InvestigationNotStartedCode],
            ]),
          }),
        );

      expect(
        insightOf(insights, AiActivityInsightKind.NotInvestigated),
      ).toBeUndefined();
      expect(insights.coverage.notInvestigated).toEqual([
        { code, count: 2 },
      ]);
    },
  );

  test("the most common reason worth saying is the one named", () => {
    const item: AiActivityInsight | undefined = insightOf(
      IncidentAlertAiInsightsBuilder.build(
        input({
          notInvestigatedReasons: new Map<string, InvestigationNotStartedCode>([
            ["s1", "severity_below_threshold"],
            ["s2", "severity_below_threshold"],
            ["s3", "severity_below_threshold"],
            ["s4", "provider_missing"],
          ]),
        }),
      ),
      AiActivityInsightKind.NotInvestigated,
    );

    expect(item).toMatchObject({ reason: "provider_missing", count: 1 });
    // No window total read: none said.
    expect(item!.total).toBeUndefined();
  });

  test("a problem that keeps coming back names the monitors that raise it", () => {
    const list: Array<IncidentAlertAiSubjectInput> = [1, 2, 3, 4].map(
      (days: number): IncidentAlertAiSubjectInput => {
        return subject(`c${days}`, {
          monitorIds: ["mc", "hidden"],
          title: "Checkout API is returning 5xx",
          createdAt: daysAgo(days),
        });
      },
    );

    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(...list),
          occurrenceIds: list.map((item: IncidentAlertAiSubjectInput) => {
            return item.id;
          }),
          monitorNames: new Map<string, string>([["mc", "Checkout API"]]),
          investigations: [
            run("c1", daysAgo(1), {
              tldr: "The pool runs out of connections at 13:00.",
              nextStep: "Raise the pool to 50 connections.",
            }),
          ],
        }),
      );

    const recurring: AiActivityInsight = insightOf(
      insights,
      AiActivityInsightKind.RecurringProblem,
    )!;

    expect(recurring).toMatchObject({
      tone: AiActivityInsightTone.Critical,
      count: 4,
      total: 4,
      recentCount: 4,
      title: "Checkout API is returning 5xx",
      nextStep: "Raise the pool to 50 connections.",
      monitors: [{ id: "mc", name: "Checkout API" }],
      evidenceCount: 4,
    });
    expect(recurring.problemKey).toBe(insights.problems[0]!.key);
    // Never the monitor the caller may not read.
    expect(JSON.stringify(recurring)).not.toContain("hidden");
  });

  test("a problem whose monitors the caller may not read names none", () => {
    const list: Array<IncidentAlertAiSubjectInput> = [1, 2, 3].map(
      (days: number): IncidentAlertAiSubjectInput => {
        return subject(`c${days}`, {
          monitorIds: ["hidden"],
          createdAt: daysAgo(days),
        });
      },
    );

    const recurring: AiActivityInsight = insightOf(
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(...list),
          occurrenceIds: ["c1", "c2", "c3"],
          investigations: [run("c1", daysAgo(1))],
        }),
      ),
      AiActivityInsightKind.RecurringProblem,
    )!;

    expect(recurring.monitors).toBeUndefined();
  });

  test("fixes waiting for approval, with the newest one's incident", () => {
    const item: AiActivityInsight | undefined = insightOf(
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(subject("i1"), subject("i2")),
          fixes: [fix("i1", daysAgo(3)), fix("i2", daysAgo(1))],
        }),
      ),
      AiActivityInsightKind.FixesAwaitingApproval,
    );

    expect(item).toMatchObject({
      kind: AiActivityInsightKind.FixesAwaitingApproval,
      tone: AiActivityInsightTone.Warning,
      count: 2,
      subject: expect.objectContaining({ id: "i2" }),
      evidenceCount: 2,
    });
  });

  describe("one service, or one monitor, behind the trouble", () => {
    function project(): IncidentAlertAiInsightsInput {
      const list: Array<IncidentAlertAiSubjectInput> = [
        subject("a1", {
          monitorIds: ["ma"],
          serviceIds: ["checkout"],
          createdAt: daysAgo(1),
        }),
        subject("a2", {
          monitorIds: ["ma"],
          serviceIds: ["checkout"],
          createdAt: daysAgo(2),
        }),
        subject("b1", {
          monitorIds: ["mb"],
          serviceIds: ["checkout", "payments"],
          createdAt: daysAgo(3),
        }),
        subject("c1", {
          monitorIds: ["mc"],
          serviceIds: ["search"],
          createdAt: daysAgo(4),
        }),
      ];

      return input({
        subjects: subjects(...list),
        occurrenceIds: list.map((item: IncidentAlertAiSubjectInput) => {
          return item.id;
        }),
        monitorNames: new Map<string, string>([
          ["ma", "Checkout API"],
          ["mb", "Orders DB"],
          ["mc", "Search"],
        ]),
        serviceNames: new Map<string, string>([
          ["checkout", "checkout"],
          ["payments", "payments"],
          ["search", "search"],
        ]),
        investigations: [run("a1", daysAgo(1)), run("b1", daysAgo(3))],
      });
    }

    test("a service behind several problems and most of what came up, with its incidents", () => {
      const hotspot: AiActivityInsight = insightOf(
        IncidentAlertAiInsightsBuilder.build(project()),
        AiActivityInsightKind.Hotspot,
      )!;

      expect(hotspot).toEqual({
        kind: AiActivityInsightKind.Hotspot,
        tone: AiActivityInsightTone.Pattern,
        count: 3,
        total: 4,
        problemCount: 2,
        service: { id: "checkout", name: "checkout" },
        lastSeenAt: daysAgo(1).toISOString(),
        subject: expect.objectContaining({ id: "a1" }),
        evidence: [
          expect.objectContaining({ id: "a1" }),
          expect.objectContaining({ id: "a2" }),
          expect.objectContaining({ id: "b1" }),
        ],
        evidenceCount: 3,
      });
    });

    test("a service the caller may not read is never the one", () => {
      const builderInput: IncidentAlertAiInsightsInput = project();
      builderInput.serviceNames = new Map<string, string>([
        ["payments", "payments"],
      ]);

      expect(
        insightOf(
          IncidentAlertAiInsightsBuilder.build(builderInput),
          AiActivityInsightKind.Hotspot,
        ),
      ).toBeUndefined();
    });

    test("with no service behind the trouble, a monitor behind several problems", () => {
      // Incidents raised by two monitors at once: one monitor in two problems.
      const list: Array<IncidentAlertAiSubjectInput> = [
        subject("x1", { monitorIds: ["shared"], createdAt: daysAgo(1) }),
        subject("x2", {
          monitorIds: ["shared", "other"],
          createdAt: daysAgo(2),
        }),
        subject("x3", { monitorIds: ["shared"], createdAt: daysAgo(3) }),
        subject("y1", { monitorIds: ["elsewhere"], createdAt: daysAgo(4) }),
      ];

      const hotspot: AiActivityInsight = insightOf(
        IncidentAlertAiInsightsBuilder.build(
          input({
            subjects: subjects(...list),
            occurrenceIds: list.map((item: IncidentAlertAiSubjectInput) => {
              return item.id;
            }),
            monitorNames: new Map<string, string>([
              ["shared", "Shared database"],
              ["other", "Other"],
              ["elsewhere", "Elsewhere"],
            ]),
            investigations: [run("x1", daysAgo(1))],
          }),
        ),
        AiActivityInsightKind.Hotspot,
      )!;

      expect(hotspot.monitor).toEqual({ id: "shared", name: "Shared database" });
      expect(hotspot.service).toBeUndefined();
      expect([hotspot.count, hotspot.total, hotspot.problemCount]).toEqual([
        3, 4, 2,
      ]);
    });

    test("not one behind every incident there is", () => {
      const builderInput: IncidentAlertAiInsightsInput = project();
      for (const item of builderInput.subjects.values()) {
        item.serviceIds = ["checkout"];
      }

      expect(
        insightOf(
          IncidentAlertAiInsightsBuilder.build(builderInput),
          AiActivityInsightKind.Hotspot,
        ),
      ).toBeUndefined();
    });
  });

  test("your team approved every fix: on the incidents' page too", () => {
    const item: AiActivityInsight | undefined = insightOf(
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(subject("i1"), subject("i2"), subject("i3")),
          fixes: ["i1", "i2", "i3"].map((id: string, index: number) => {
            return fix(id, daysAgo(index + 1), {
              status: AutoRemediationSuggestionStatus.Approved,
              approvedAt: daysAgo(index + 1),
              verificationStatus: AutoRemediationVerificationStatus.Verified,
            });
          }),
        }),
      ),
      AiActivityInsightKind.ReadyForAutomaticFixes,
    );

    expect(item).toMatchObject({
      tone: AiActivityInsightTone.Positive,
      count: 3,
      verifiedCount: 3,
      evidenceCount: 3,
    });
  });

  test("are ordered by tone, then by kind, and hold at most the page's number", () => {
    const list: Array<IncidentAlertAiSubjectInput> = [1, 2, 3].map(
      (days: number): IncidentAlertAiSubjectInput => {
        return subject(`i${days}`, {
          monitorIds: ["m1"],
          serviceIds: ["s1"],
          createdAt: daysAgo(days),
        });
      },
    );

    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(...list),
          occurrenceIds: ["i1", "i2", "i3"],
          monitorNames: new Map<string, string>([["m1", "API"]]),
          investigations: [run("i1", daysAgo(1))],
          fixes: [
            fix("i1", daysAgo(1), {
              status: AutoRemediationSuggestionStatus.AutoExecuted,
              verificationStatus: AutoRemediationVerificationStatus.Failed,
            }),
            fix("i2", daysAgo(1)),
            fix("i3", daysAgo(1), {
              status: AutoRemediationSuggestionStatus.AutoExecuted,
              verificationStatus: AutoRemediationVerificationStatus.Verified,
            }),
          ],
          subjectsInWindow: 3,
          notInvestigatedReasons: new Map<string, InvestigationNotStartedCode>([
            ["s9", "provider_missing"],
          ]),
        }),
      );

    expect(insights.insights.length).toBeLessThanOrEqual(
      AI_ACTIVITY_INSIGHTS_MAX_INSIGHTS,
    );
    expect(kindsOf(insights)).toEqual([
      AiActivityInsightKind.RecurringProblem,
      AiActivityInsightKind.FixesDidNotHelp,
      AiActivityInsightKind.NotInvestigated,
      AiActivityInsightKind.FixesAwaitingApproval,
      AiActivityInsightKind.FixedAutomatically,
    ]);
  });

  test("a caller who may not read fixes gets no insight about fixes", () => {
    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({ fixes: null, subjects: subjects(subject("i1")) }),
      );

    for (const kind of [
      AiActivityInsightKind.FixesDidNotHelp,
      AiActivityInsightKind.FixesAwaitingApproval,
      AiActivityInsightKind.FixedAutomatically,
      AiActivityInsightKind.ReadyForAutomaticFixes,
      AiActivityInsightKind.ProblemStopped,
    ]) {
      expect(kindsOf(insights)).not.toContain(kind);
    }
  });
});

describe("build is deterministic", () => {
  test("the same input gives the same insights, whatever order the rows came in", () => {
    const list: Array<IncidentAlertAiSubjectInput> = [
      subject("a", { monitorIds: ["m1"], serviceIds: ["s1"] }),
      subject("b", { monitorIds: ["m2"], serviceIds: ["s1"] }),
      subject("c", {
        monitorIds: ["m1"],
        serviceIds: ["s2"],
        createdAt: daysAgo(2),
      }),
    ];
    const runs: Array<IncidentAlertAiInvestigationInput> = [
      run("a", daysAgo(1)),
      run("b", daysAgo(2)),
      run("a", daysAgo(3)),
    ];
    const names: Map<string, string> = new Map<string, string>([
      ["m1", "One"],
      ["m2", "Two"],
    ]);
    const first: IncidentAlertAiInsights = IncidentAlertAiInsightsBuilder.build(
      input({
        subjects: subjects(...list),
        occurrenceIds: ["a", "b", "c"],
        monitorNames: names,
        investigations: runs,
      }),
    );
    const second: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(...[...list].reverse()),
          occurrenceIds: ["c", "b", "a"],
          monitorNames: names,
          investigations: [...runs].reverse(),
        }),
      );

    expect(second).toEqual(first);
  });
});
