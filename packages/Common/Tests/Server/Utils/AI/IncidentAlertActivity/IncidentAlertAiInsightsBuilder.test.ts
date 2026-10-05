import IncidentAlertAiInsightsBuilder, {
  IncidentAlertAiFixInput,
  IncidentAlertAiFixTaskInput,
  IncidentAlertAiInsightsInput,
  IncidentAlertAiInvestigationInput,
  IncidentAlertAiSubjectInput,
  toPublicProblemKey,
} from "../../../../../Server/Utils/AI/IncidentAlertActivity/IncidentAlertAiInsightsBuilder";
import AIRunAutoGrade from "../../../../../Types/AI/AIRunAutoGrade";
import AIRunHumanVerdict from "../../../../../Types/AI/AIRunHumanVerdict";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import {
  INCIDENT_ALERT_AI_INSIGHTS_MAX_ATTENTION_ITEMS,
  INCIDENT_ALERT_AI_INSIGHTS_MAX_HOTSPOTS,
  INCIDENT_ALERT_AI_INSIGHTS_MAX_PROBLEMS,
  IncidentAlertAiAttentionItem,
  IncidentAlertAiAttentionKind,
  IncidentAlertAiAttentionSeverity,
  IncidentAlertAiInsights,
  IncidentAlertAiProblem,
} from "../../../../../Types/AI/IncidentAlertAiInsights";
import { InvestigationNotStartedCode } from "../../../../../Types/AI/InvestigationNotStartedReason";
import AutoRemediationSuggestionStatus from "../../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationVerificationStatus from "../../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import { describe, expect, test } from "@jest/globals";

/*
 * The pure half of the Incidents and Alerts AI Insights: what OneUptime AI
 * learned across the window's incidents (or alerts) and what deserves
 * attention, from rows the reader already filtered to what the caller may
 * read. The same input always gives the same insights.
 */

// 2026-10-05 15:00 UTC: the window runs from 2026-09-06 00:00 UTC.
const NOW: Date = new Date("2026-10-05T15:00:00.000Z");
const WINDOW_START: string = "2026-09-06T00:00:00.000Z";
const DAY: number = 24 * 60 * 60 * 1000;

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
    number: Number(id.replace(/\D/g, "")) || undefined,
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

function attentionKinds(
  insights: IncidentAlertAiInsights,
): Array<IncidentAlertAiAttentionKind> {
  return insights.attention.map((item: IncidentAlertAiAttentionItem) => {
    return item.kind;
  });
}

function attentionOf(
  insights: IncidentAlertAiInsights,
  kind: IncidentAlertAiAttentionKind,
): IncidentAlertAiAttentionItem | undefined {
  return insights.attention.find((item: IncidentAlertAiAttentionItem) => {
    return item.kind === kind;
  });
}

describe("getWindowStart", () => {
  test("is the first UTC day of a window that ends today", () => {
    expect(
      IncidentAlertAiInsightsBuilder.getWindowStart(NOW, 30).toISOString(),
    ).toBe(WINDOW_START);
  });

  test("a one-day window starts today; less than a day is a day", () => {
    expect(
      IncidentAlertAiInsightsBuilder.getWindowStart(NOW, 1).toISOString(),
    ).toBe("2026-10-05T00:00:00.000Z");
    expect(
      IncidentAlertAiInsightsBuilder.getWindowStart(NOW, 0).toISOString(),
    ).toBe("2026-10-05T00:00:00.000Z");
  });
});

describe("stripSeriesIdentity", () => {
  const labels: Record<string, string> = {
    "k8s.pod.name": "web-7d9f-2xk",
    "k8s.namespace.name": "shop",
  };

  test("takes off the identity a monitor appended", () => {
    expect(
      IncidentAlertAiInsightsBuilder.stripSeriesIdentity(
        "Pod CPU high - Pod: web-7d9f-2xk | Namespace: shop",
        labels,
      ),
    ).toBe("Pod CPU high");
  });

  test("takes it off when values were shown by their end", () => {
    expect(
      IncidentAlertAiInsightsBuilder.stripSeriesIdentity(
        "Pod CPU high - Pod: ...7d9f-2xk",
        labels,
      ),
    ).toBe("Pod CPU high");
  });

  test("leaves a title whose dash is the user's own", () => {
    expect(
      IncidentAlertAiInsightsBuilder.stripSeriesIdentity(
        "Checkout - payments are slow",
        labels,
      ),
    ).toBe("Checkout - payments are slow");
    expect(
      IncidentAlertAiInsightsBuilder.stripSeriesIdentity(
        "Pod CPU high - Pod: some-other-pod",
        labels,
      ),
    ).toBe("Pod CPU high - Pod: some-other-pod");
  });

  test("leaves a title without series labels, and trims", () => {
    expect(
      IncidentAlertAiInsightsBuilder.stripSeriesIdentity(
        "  Pod CPU high - Pod: web  ",
        undefined,
      ),
    ).toBe("Pod CPU high - Pod: web");
    expect(IncidentAlertAiInsightsBuilder.stripSeriesIdentity("", labels)).toBe(
      "",
    );
  });
});

describe("getProblemKey", () => {
  test("groups by the monitors that raised it, in any order", () => {
    expect(
      IncidentAlertAiInsightsBuilder.getProblemKey(
        subject("i1", { monitorIds: ["m2", "m1", "m2", ""] }),
      ),
    ).toBe("monitor:m1,m2");
  });

  test("without a monitor, by the title without its series identity", () => {
    expect(
      IncidentAlertAiInsightsBuilder.getProblemKey(
        subject("i1", {
          title: "Pod  CPU High - Pod: web-1",
          seriesLabels: { "k8s.pod.name": "web-1" },
        }),
      ),
    ).toBe("title:pod cpu high");
  });

  test("without a monitor or a title, the subject is its own problem", () => {
    expect(
      IncidentAlertAiInsightsBuilder.getProblemKey(
        subject("i1", { title: undefined }),
      ),
    ).toBe("subject:i1");
  });

  test("a public key is opaque and stable", () => {
    const key: string = toPublicProblemKey("monitor:secret-monitor-id");

    expect(key).toMatch(/^problem-[0-9a-f]{8}$/);
    expect(key).not.toContain("secret");
    expect(toPublicProblemKey("monitor:secret-monitor-id")).toBe(key);
    expect(toPublicProblemKey("monitor:other")).not.toBe(key);
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
    });
    expect(insights.coverage).toEqual({
      subjects: 12,
      investigatedSubjects: 0,
      notInvestigated: [],
    });
    expect(insights.attention).toEqual([]);
    expect(insights.problems).toEqual([]);
    expect(insights.monitors).toEqual([]);
    expect(insights.services).toEqual([]);
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

  test("counts investigations by how they ended", () => {
    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(subject("i1")),
          investigations: [
            run("i1", daysAgo(1)),
            run("i1", daysAgo(1), { status: AIRunStatus.Error }),
            run("i1", daysAgo(1), { status: AIRunStatus.Stale }),
            run("i1", daysAgo(1), { status: AIRunStatus.Queued }),
            run("i1", daysAgo(1), { status: AIRunStatus.Running }),
            run("i1", daysAgo(1), {
              status: AIRunStatus.WaitingForApproval,
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

  test("a caller who may not read fixes gets no fix numbers, not zeros", () => {
    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({
          fixes: null,
          subjects: subjects(subject("i1")),
          investigations: [run("i1", daysAgo(1))],
        }),
      );

    expect(insights.totals.fixes).toBeNull();
    expect(insights.fixOutcomes).toBeNull();
    expect(insights.problems[0]!.fixes.proposed).toBe(0);
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
        }),
        subject("i2", {
          monitorIds: SHARED_MONITOR,
          title: "Disk full - Host: db-2",
          seriesLabels: { "host.name": "db-2" },
        }),
        subject("i3", { title: "Login page down" }),
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

  test("groups incidents by the monitor that raised them, the most investigated first", () => {
    const problems: Array<IncidentAlertAiProblem> =
      IncidentAlertAiInsightsBuilder.build(recurringInput()).problems;

    expect(
      problems.map((problem: IncidentAlertAiProblem) => {
        return [
          problem.title,
          problem.investigationCount,
          problem.subjectCount,
        ];
      }),
    ).toEqual([
      ["Disk full", 3, 2],
      ["Login page down", 1, 1],
    ]);
  });

  test("a problem says when it was seen, whether it recurs, and the latest incident", () => {
    const problem: IncidentAlertAiProblem =
      IncidentAlertAiInsightsBuilder.build(recurringInput()).problems[0]!;

    expect(problem.isRecurring).toBe(true);
    expect(problem.firstSeenAt).toBe(daysAgo(10).toISOString());
    expect(problem.lastSeenAt).toBe(daysAgo(1).toISOString());
    expect(problem.latestSubject).toEqual({
      kind: "incident",
      id: "i2",
      title: "Disk full - Host: db-2",
      number: 2,
      numberWithPrefix: "INC-i2",
    });
    expect(problem.key).toBe(toPublicProblemKey("monitor:m-db"));
  });

  test("its finding is the newest completed investigation's TL;DR", () => {
    const problem: IncidentAlertAiProblem =
      IncidentAlertAiInsightsBuilder.build(recurringInput()).problems[0]!;

    expect(problem.latestFinding).toEqual({
      aiRunId: expect.any(String),
      text: "The disk on db-2 filled with logs.",
      at: new Date(daysAgo(2).getTime() + 60 * 1000).toISOString(),
    });
  });

  test("a problem no investigation concluded anything about has no finding", () => {
    const problem: IncidentAlertAiProblem =
      IncidentAlertAiInsightsBuilder.build(
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
    const problem: IncidentAlertAiProblem =
      IncidentAlertAiInsightsBuilder.build(recurringInput()).problems[0]!;

    expect(problem.monitors).toEqual([{ id: "m-db", name: "Database disk" }]);
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
    const problem: IncidentAlertAiProblem =
      IncidentAlertAiInsightsBuilder.build(
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

    expect(insights.problems).toHaveLength(
      INCIDENT_ALERT_AI_INSIGHTS_MAX_PROBLEMS,
    );
    expect(insights.totals.problems).toBe(15);
  });
});

describe("build: monitors and services that keep failing", () => {
  test("count each incident once, and only come up from two investigations on", () => {
    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(
            subject("i1", { monitorIds: ["m1", "m1"], serviceIds: ["s1"] }),
            subject("i2", { monitorIds: ["m1"], serviceIds: ["s1", "s2"] }),
            subject("i3", { monitorIds: ["m2"], serviceIds: ["s2"] }),
          ),
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
        subjectCount: 2,
        investigationCount: 3,
        problemCount: 1,
        lastSeenAt: daysAgo(1).toISOString(),
      },
    ]);
    expect(insights.services).toEqual([
      {
        id: "s1",
        name: "checkout",
        subjectCount: 2,
        investigationCount: 3,
        problemCount: 1,
        lastSeenAt: daysAgo(1).toISOString(),
      },
      {
        id: "s2",
        name: "payments",
        subjectCount: 2,
        investigationCount: 2,
        problemCount: 2,
        lastSeenAt: daysAgo(1).toISOString(),
      },
    ]);
  });

  test("never list a monitor or service the caller may not read", () => {
    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(
            subject("i1", { monitorIds: ["secret"], serviceIds: ["secret"] }),
          ),
          investigations: [run("i1", daysAgo(2)), run("i1", daysAgo(1))],
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
      many.push(subject(`i${index}`, { monitorIds: [`m${index}`] }));
      runs.push(run(`i${index}`, daysAgo(1)), run(`i${index}`, daysAgo(2)));
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
    ).toHaveLength(INCIDENT_ALERT_AI_INSIGHTS_MAX_HOTSPOTS);
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

  test("verdicts across the window", () => {
    expect(
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(subject("i1")),
          investigations: [
            run("i1", daysAgo(1), {
              humanVerdict: AIRunHumanVerdict.Confirmed,
              autoGrade: AIRunAutoGrade.Match,
            }),
            run("i1", daysAgo(1), {
              humanVerdict: AIRunHumanVerdict.Rejected,
              autoGrade: AIRunAutoGrade.Mismatch,
            }),
            run("i1", daysAgo(1), { autoGrade: AIRunAutoGrade.Partial }),
            run("i1", daysAgo(1)),
          ],
        }),
      ).verdicts,
    ).toEqual({
      confirmed: 1,
      rejected: 1,
      matched: 1,
      partlyMatched: 1,
      mismatched: 1,
    });
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

describe("build: what needs attention", () => {
  test("nothing, when nothing went wrong", () => {
    expect(
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
      ).attention,
    ).toEqual([]);
  });

  test("fixes that did not work, out of the ones applied, with the incident", () => {
    const item: IncidentAlertAiAttentionItem | undefined = attentionOf(
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
      IncidentAlertAiAttentionKind.FixesFailed,
    );

    expect(item).toEqual({
      kind: IncidentAlertAiAttentionKind.FixesFailed,
      severity: IncidentAlertAiAttentionSeverity.High,
      count: 1,
      total: 2,
      subject: expect.objectContaining({ id: "i2" }),
    });
  });

  test.each([
    ["provider_missing", IncidentAlertAiAttentionSeverity.High],
    ["insufficient_ai_balance", IncidentAlertAiAttentionSeverity.High],
    ["daily_budget_exhausted", IncidentAlertAiAttentionSeverity.High],
    ["ai_disabled", IncidentAlertAiAttentionSeverity.Medium],
    ["enqueue_failed", IncidentAlertAiAttentionSeverity.Medium],
    ["automatic_investigation_disabled", IncidentAlertAiAttentionSeverity.Low],
  ])(
    "incidents skipped because %s, at %s",
    (code: string, severity: IncidentAlertAiAttentionSeverity) => {
      const item: IncidentAlertAiAttentionItem | undefined = attentionOf(
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
        IncidentAlertAiAttentionKind.InvestigationsNotStarted,
      );

      expect(item).toEqual({
        kind: IncidentAlertAiAttentionKind.InvestigationsNotStarted,
        severity,
        count: 2,
        total: 9,
        reason: code,
      });
    },
  );

  test("skips by the settings' own design are not a problem", () => {
    expect(
      attentionOf(
        IncidentAlertAiInsightsBuilder.build(
          input({
            subjectsInWindow: 9,
            notInvestigatedReasons: new Map<
              string,
              InvestigationNotStartedCode
            >([
              ["s1", "severity_below_threshold"],
              ["s2", "monitor_cooldown"],
              ["s3", "no_run_recorded"],
            ]),
          }),
        ),
        IncidentAlertAiAttentionKind.InvestigationsNotStarted,
      ),
    ).toBeUndefined();
  });

  test("the most common reason worth acting on is the one named", () => {
    const item: IncidentAlertAiAttentionItem | undefined = attentionOf(
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
      IncidentAlertAiAttentionKind.InvestigationsNotStarted,
    );

    expect(item).toMatchObject({ reason: "provider_missing", count: 1 });
  });

  test("a problem investigated three times or more, the two most investigated, High when recent or frequent", () => {
    const list: Array<IncidentAlertAiSubjectInput> = [
      subject("a", { monitorIds: ["ma"], title: "A" }),
      subject("b", { monitorIds: ["mb"], title: "B" }),
      subject("c", { monitorIds: ["mc"], title: "C" }),
    ];
    const runs: Array<IncidentAlertAiInvestigationInput> = [
      // A: five times, long ago (High: frequent).
      ...[20, 21, 22, 23, 24].map((days: number) => {
        return run("a", daysAgo(days));
      }),
      // B: four times, long ago (Medium).
      ...[20, 21, 22, 23].map((days: number) => {
        return run("b", daysAgo(days));
      }),
      // C: three times, but the third pick.
      ...[1, 2, 3].map((days: number) => {
        return run("c", daysAgo(days));
      }),
    ];

    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({ subjects: subjects(...list), investigations: runs }),
      );

    const recurring: Array<IncidentAlertAiAttentionItem> =
      insights.attention.filter((item: IncidentAlertAiAttentionItem) => {
        return item.kind === IncidentAlertAiAttentionKind.RecurringProblem;
      });

    expect(
      recurring.map((item: IncidentAlertAiAttentionItem) => {
        return [item.title, item.count, item.recentCount, item.severity];
      }),
    ).toEqual([
      ["A", 5, 0, IncidentAlertAiAttentionSeverity.High],
      ["B", 4, 0, IncidentAlertAiAttentionSeverity.Medium],
    ]);
    expect(recurring[0]!.problemKey).toBe(toPublicProblemKey("monitor:ma"));
    expect(recurring[0]!.subject).toMatchObject({ id: "a" });
  });

  test("three times in the last week is High however few in all", () => {
    const item: IncidentAlertAiAttentionItem | undefined = attentionOf(
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(subject("c", { monitorIds: ["mc"] })),
          investigations: [1, 2, 3].map((days: number) => {
            return run("c", daysAgo(days));
          }),
        }),
      ),
      IncidentAlertAiAttentionKind.RecurringProblem,
    );

    expect(item).toMatchObject({
      count: 3,
      recentCount: 3,
      severity: IncidentAlertAiAttentionSeverity.High,
    });
  });

  test("twice is a recurring problem, but not one that needs attention", () => {
    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(subject("c", { monitorIds: ["mc"] })),
          investigations: [run("c", daysAgo(1)), run("c", daysAgo(2))],
        }),
      );

    expect(insights.problems[0]!.isRecurring).toBe(true);
    expect(insights.totals.recurringProblems).toBe(1);
    expect(
      attentionOf(insights, IncidentAlertAiAttentionKind.RecurringProblem),
    ).toBeUndefined();
  });

  test("fixes waiting for approval, with the newest one's incident", () => {
    const item: IncidentAlertAiAttentionItem | undefined = attentionOf(
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(subject("i1"), subject("i2")),
          fixes: [fix("i1", daysAgo(3)), fix("i2", daysAgo(1))],
        }),
      ),
      IncidentAlertAiAttentionKind.FixesAwaitingApproval,
    );

    expect(item).toEqual({
      kind: IncidentAlertAiAttentionKind.FixesAwaitingApproval,
      severity: IncidentAlertAiAttentionSeverity.Medium,
      count: 2,
      subject: expect.objectContaining({ id: "i2" }),
    });
  });

  test("failed investigations, High when three or more and half of all", () => {
    const failing: (
      failed: number,
      completed: number,
    ) => IncidentAlertAiAttentionItem | undefined = (
      failed: number,
      completed: number,
    ) => {
      const runs: Array<IncidentAlertAiInvestigationInput> = [];

      for (let index: number = 0; index < failed; index++) {
        runs.push(run("i1", daysAgo(1), { status: AIRunStatus.Error }));
      }

      for (let index: number = 0; index < completed; index++) {
        runs.push(run("i1", daysAgo(1)));
      }

      return attentionOf(
        IncidentAlertAiInsightsBuilder.build(
          input({ subjects: subjects(subject("i1")), investigations: runs }),
        ),
        IncidentAlertAiAttentionKind.InvestigationsFailed,
      );
    };

    expect(failing(3, 3)).toMatchObject({
      severity: IncidentAlertAiAttentionSeverity.High,
      count: 3,
      total: 6,
    });
    expect(failing(3, 4)!.severity).toBe(
      IncidentAlertAiAttentionSeverity.Medium,
    );
    expect(failing(2, 0)!.severity).toBe(
      IncidentAlertAiAttentionSeverity.Medium,
    );
    expect(failing(0, 4)).toBeUndefined();
  });

  test("commands no agent picked up", () => {
    expect(
      attentionOf(
        IncidentAlertAiInsightsBuilder.build(
          input({ commands: { total: 20, failed: 1, timedOut: 4 } }),
        ),
        IncidentAlertAiAttentionKind.CommandsTimedOut,
      ),
    ).toEqual({
      kind: IncidentAlertAiAttentionKind.CommandsTimedOut,
      severity: IncidentAlertAiAttentionSeverity.Medium,
      count: 4,
      total: 20,
    });
  });

  test("findings people rejected or the grader found wrong, out of the completed", () => {
    expect(
      attentionOf(
        IncidentAlertAiInsightsBuilder.build(
          input({
            subjects: subjects(subject("i1")),
            investigations: [
              run("i1", daysAgo(1), {
                humanVerdict: AIRunHumanVerdict.Rejected,
              }),
              run("i1", daysAgo(2), { autoGrade: AIRunAutoGrade.Mismatch }),
              run("i1", daysAgo(3)),
            ],
          }),
        ),
        IncidentAlertAiAttentionKind.FindingsRejected,
      ),
    ).toEqual({
      kind: IncidentAlertAiAttentionKind.FindingsRejected,
      severity: IncidentAlertAiAttentionSeverity.Low,
      count: 2,
      total: 3,
      subject: expect.objectContaining({ id: "i1" }),
    });
  });

  test("one monitor behind most of the investigations", () => {
    const make: (
      onMonitor: number,
      elsewhere: number,
    ) => IncidentAlertAiAttentionItem | undefined = (
      onMonitor: number,
      elsewhere: number,
    ) => {
      const runs: Array<IncidentAlertAiInvestigationInput> = [];

      for (let index: number = 0; index < onMonitor; index++) {
        runs.push(run("on", daysAgo(1)));
      }

      for (let index: number = 0; index < elsewhere; index++) {
        runs.push(run("off", daysAgo(1)));
      }

      return attentionOf(
        IncidentAlertAiInsightsBuilder.build(
          input({
            subjects: subjects(
              subject("on", { monitorIds: ["m1"] }),
              subject("off", { title: "Other" }),
            ),
            monitorNames: new Map<string, string>([["m1", "API latency"]]),
            investigations: runs,
          }),
        ),
        IncidentAlertAiAttentionKind.MonitorHotspot,
      );
    };

    expect(make(3, 3)).toEqual({
      kind: IncidentAlertAiAttentionKind.MonitorHotspot,
      severity: IncidentAlertAiAttentionSeverity.Low,
      count: 3,
      total: 6,
      monitor: { id: "m1", name: "API latency" },
    });
    expect(make(3, 4)).toBeUndefined();
    expect(make(2, 0)).toBeUndefined();
  });

  test("is ordered by severity, then by kind, and holds at most six", () => {
    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(subject("i1", { monitorIds: ["m1"] })),
          monitorNames: new Map<string, string>([["m1", "API"]]),
          investigations: [
            run("i1", daysAgo(1), {
              status: AIRunStatus.Error,
            }),
            run("i1", daysAgo(1), {
              humanVerdict: AIRunHumanVerdict.Rejected,
            }),
            run("i1", daysAgo(2)),
            run("i1", daysAgo(3)),
          ],
          fixes: [
            fix("i1", daysAgo(1), {
              status: AutoRemediationSuggestionStatus.AutoExecuted,
              verificationStatus: AutoRemediationVerificationStatus.Failed,
            }),
            fix("i1", daysAgo(1)),
          ],
          commands: { total: 5, failed: 0, timedOut: 1 },
          subjectsInWindow: 3,
          notInvestigatedReasons: new Map<string, InvestigationNotStartedCode>([
            ["s1", "provider_missing"],
          ]),
        }),
      );

    expect(attentionKinds(insights)).toHaveLength(
      INCIDENT_ALERT_AI_INSIGHTS_MAX_ATTENTION_ITEMS,
    );
    expect(attentionKinds(insights)).toEqual([
      IncidentAlertAiAttentionKind.FixesFailed,
      IncidentAlertAiAttentionKind.InvestigationsNotStarted,
      IncidentAlertAiAttentionKind.RecurringProblem,
      IncidentAlertAiAttentionKind.FixesAwaitingApproval,
      IncidentAlertAiAttentionKind.InvestigationsFailed,
      IncidentAlertAiAttentionKind.CommandsTimedOut,
    ]);
  });

  test("a caller who may not read fixes gets no fix item", () => {
    const insights: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({ fixes: null, subjects: subjects(subject("i1")) }),
      );

    expect(attentionKinds(insights)).not.toContain(
      IncidentAlertAiAttentionKind.FixesFailed,
    );
    expect(attentionKinds(insights)).not.toContain(
      IncidentAlertAiAttentionKind.FixesAwaitingApproval,
    );
  });
});

describe("build is deterministic", () => {
  test("the same input gives the same insights, whatever order the rows came in", () => {
    const list: Array<IncidentAlertAiSubjectInput> = [
      subject("a", { monitorIds: ["m1"] }),
      subject("b", { monitorIds: ["m2"] }),
    ];
    const runs: Array<IncidentAlertAiInvestigationInput> = [
      run("a", daysAgo(1)),
      run("b", daysAgo(2)),
      run("a", daysAgo(3)),
    ];
    const first: IncidentAlertAiInsights = IncidentAlertAiInsightsBuilder.build(
      input({ subjects: subjects(...list), investigations: runs }),
    );
    const second: IncidentAlertAiInsights =
      IncidentAlertAiInsightsBuilder.build(
        input({
          subjects: subjects(...[...list].reverse()),
          investigations: [...runs].reverse(),
        }),
      );

    expect(second).toEqual(first);
  });
});
