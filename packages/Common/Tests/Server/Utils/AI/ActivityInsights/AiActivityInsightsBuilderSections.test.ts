import AiActivityInsightsBuilder, {
  AiActivityFixInput,
  AiActivityInsightsInput,
  AiActivityInvestigationInput,
  AiActivitySubjectInput,
} from "../../../../../Server/Utils/AI/ActivityInsights/AiActivityInsightsBuilder";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import {
  AI_ACTIVITY_INSIGHTS_MAX_INSIGHTS,
  AiActivityInsight,
  AiActivityInsightKind,
  AiActivityInsightTone,
  AiActivityInsights,
} from "../../../../../Types/AI/AiActivityInsights";
import AutoRemediationSuggestionStatus from "../../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationVerificationStatus from "../../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import { JSONObject } from "../../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * What the shared AI Insights builder does for the pages that reuse it
 * beyond a cluster and a resource - a project's incidents and its alerts
 * (IncidentAlertAiInsightsBuilder): a subject's prefixed number travels with
 * it, a subject the reader read for a fix can be linked, a scope with no
 * parts of its own asks for no hotspots, and insights only the reader's rows
 * can say are ranked with the builder's own. A cluster's and a resource's
 * insights, which pass none of it, are pinned by
 * AiActivityInsightsBuilder.test.ts.
 */

const NOW: Date = new Date("2026-09-22T10:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

const MONITOR_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_MONITOR_ID: string = "aaaaaaaa-0000-4000-8000-000000000002";

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR);
}

function incident(
  id: string,
  overrides: Partial<AiActivitySubjectInput> = {},
): AiActivitySubjectInput {
  return {
    kind: "incident",
    id,
    title: `Incident ${id}`,
    number: 7,
    monitorIds: [],
    ...overrides,
  };
}

let sequence: number = 0;

function run(
  createdAt: Date,
  subject: AiActivitySubjectInput | undefined,
  overrides: Partial<AiActivityInvestigationInput> = {},
): AiActivityInvestigationInput {
  sequence++;
  return {
    aiRunId: `run-${sequence}`,
    status: AIRunStatus.Completed,
    createdAt,
    completedAt: new Date(createdAt.getTime() + 60 * 1000),
    tldr: `Finding ${sequence}`,
    subject,
    ...overrides,
  };
}

function failedFix(
  createdAt: Date,
  overrides: Partial<AiActivityFixInput> = {},
): AiActivityFixInput {
  sequence++;
  return {
    id: `fix-${sequence}`,
    status: AutoRemediationSuggestionStatus.AutoExecuted,
    verificationStatus: AutoRemediationVerificationStatus.Failed,
    createdAt,
    ...overrides,
  };
}

function input(
  overrides: Partial<AiActivityInsightsInput> = {},
): AiActivityInsightsInput {
  return {
    now: NOW,
    windowInDays: 30,
    investigations: [],
    fixes: [],
    commands: { total: 0, failed: 0, timedOut: 0 },
    preventiveInsights: [],
    scopeLabelKeys: [],
    scopeNames: [],
    isPartial: false,
    ...overrides,
  };
}

function item(
  kind: AiActivityInsightKind,
  tone: AiActivityInsightTone,
  count: number = 1,
): AiActivityInsight {
  return { kind, tone, count };
}

function kindsOf(insights: AiActivityInsights): Array<AiActivityInsightKind> {
  return insights.insights.map(
    (insight: AiActivityInsight): AiActivityInsightKind => {
      return insight.kind;
    },
  );
}

function insightOf(
  insights: AiActivityInsights,
  kind: AiActivityInsightKind,
): AiActivityInsight | undefined {
  return insights.insights.find((insight: AiActivityInsight): boolean => {
    return insight.kind === kind;
  });
}

// Labels that name one deployment: where several problems happen.
const DEPLOYMENT_LABELS: JSONObject = {
  "resource.k8s.namespace.name": "shop",
  "resource.k8s.deployment.name": "checkout",
};

describe("a subject's prefixed number", () => {
  test("travels with the subject to its problem and to the insight about it", () => {
    const subjects: Array<AiActivitySubjectInput> = [7, 8, 9].map(
      (number: number, index: number): AiActivitySubjectInput => {
        return incident(`inc-${number}`, {
          number,
          numberWithPrefix: `INC-${number}`,
          monitorIds: [MONITOR_ID],
          createdAt: hoursAgo(index + 1),
        });
      },
    );

    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({
        occurrences: subjects,
        investigations: [run(hoursAgo(1), subjects[0])],
      }),
    );

    expect(insights.problems[0]!.latestSubject).toEqual({
      kind: "incident",
      id: "inc-7",
      title: "Incident inc-7",
      number: 7,
      numberWithPrefix: "INC-7",
    });

    const recurring: AiActivityInsight = insightOf(
      insights,
      AiActivityInsightKind.RecurringProblem,
    )!;

    expect(recurring.subject?.numberWithPrefix).toBe("INC-7");
    expect(
      recurring.evidence!.map(
        (subject: { numberWithPrefix?: string | undefined }) => {
          return subject.numberWithPrefix;
        },
      ),
    ).toEqual(["INC-7", "INC-8", "INC-9"]);
  });

  test("is left out, not empty, for a subject without one", () => {
    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({ investigations: [run(hoursAgo(1), incident("inc-1"))] }),
    );

    expect(insights.problems[0]!.latestSubject).toEqual({
      kind: "incident",
      id: "inc-1",
      title: "Incident inc-1",
      number: 7,
    });
    expect("numberWithPrefix" in insights.problems[0]!.latestSubject).toBe(
      false,
    );
  });
});

describe("the subjects a reader read for its fixes", () => {
  // A fix applied on an incident AI did not investigate in the window.
  const fixOnly: AiActivitySubjectInput = incident("inc-fix", {
    numberWithPrefix: "INC-9",
  });

  test("let a fix that did not help link the incident it was for", () => {
    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({
        fixes: [failedFix(hoursAgo(2), { incidentId: "inc-fix" })],
        subjects: new Map<string, AiActivitySubjectInput>([
          ["inc-fix", fixOnly],
        ]),
      }),
    );

    const failed: AiActivityInsight = insights.insights[0]!;

    expect(failed.kind).toBe(AiActivityInsightKind.FixesDidNotHelp);
    expect(failed.subject).toEqual({
      kind: "incident",
      id: "inc-fix",
      title: "Incident inc-fix",
      number: 7,
      numberWithPrefix: "INC-9",
    });
  });

  test("without them, only an investigated incident is ever linked", () => {
    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({ fixes: [failedFix(hoursAgo(2), { incidentId: "inc-fix" })] }),
    );

    expect(insights.insights[0]!.kind).toBe(
      AiActivityInsightKind.FixesDidNotHelp,
    );
    expect(insights.insights[0]!.subject).toBeUndefined();
  });

  test("never link a fix whose incident the reader did not hand over", () => {
    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({
        fixes: [failedFix(hoursAgo(2), { incidentId: "inc-unread" })],
        subjects: new Map<string, AiActivitySubjectInput>([
          ["inc-fix", fixOnly],
        ]),
      }),
    );

    expect(insights.insights[0]!.subject).toBeUndefined();
    expect(insights.insights[0]!.evidence).toBeUndefined();
  });

  test("do not make a problem of an incident nobody investigated", () => {
    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({
        fixes: [failedFix(hoursAgo(2), { incidentId: "inc-fix" })],
        subjects: new Map<string, AiActivitySubjectInput>([
          ["inc-fix", fixOnly],
        ]),
      }),
    );

    expect(insights.problems).toEqual([]);
    expect(insights.totals.problems).toBe(0);
    expect(insights.totals.investigations).toBe(0);
  });

  test("are the reader's own reading: a run only adds the ones they lack", () => {
    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({
        investigations: [
          run(hoursAgo(1), incident("inc-1", { title: "Run title" })),
          run(hoursAgo(3), incident("inc-2", { title: "Second" })),
        ],
        fixes: [
          failedFix(hoursAgo(2), { incidentId: "inc-1" }),
          failedFix(hoursAgo(4), { incidentId: "inc-2" }),
        ],
        subjects: new Map<string, AiActivitySubjectInput>([
          ["inc-1", incident("inc-1", { title: "Map title" })],
        ]),
      }),
    );

    // The newest fix that did not help links the incident as the map has it.
    expect(insights.insights[0]!.kind).toBe(
      AiActivityInsightKind.FixesDidNotHelp,
    );
    expect(insights.insights[0]!.subject?.title).toBe("Map title");
    // A problem is always its runs' own.
    expect(
      insights.problems.map((problem: { title: string }): string => {
        return problem.title;
      }),
    ).toEqual(["Run title", "Second"]);
  });

  test("an incident only a run names is linked from the run", () => {
    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({
        investigations: [run(hoursAgo(1), incident("inc-2"))],
        fixes: [failedFix(hoursAgo(2), { incidentId: "inc-2" })],
        subjects: new Map<string, AiActivitySubjectInput>([
          ["inc-fix", fixOnly],
        ]),
      }),
    );

    expect(insights.insights[0]!.subject?.id).toBe("inc-2");
  });
});

describe("a scope with no parts of its own", () => {
  /*
   * Four incidents of one deployment from two monitors, and one more
   * elsewhere: the deployment is behind two problems and most of it.
   */
  const subjects: Array<AiActivitySubjectInput> = [
    ...[1, 2, 3].map((index: number): AiActivitySubjectInput => {
      return incident(`inc-${index}`, {
        monitorIds: [MONITOR_ID],
        seriesLabels: DEPLOYMENT_LABELS,
        createdAt: hoursAgo(index),
      });
    }),
    incident("inc-4", {
      monitorIds: [OTHER_MONITOR_ID],
      seriesLabels: DEPLOYMENT_LABELS,
      createdAt: hoursAgo(4),
    }),
    incident("inc-5", {
      title: "Somewhere else",
      createdAt: hoursAgo(5),
    }),
  ];
  const investigations: Array<AiActivityInvestigationInput> = subjects.map(
    (subject: AiActivitySubjectInput, index: number) => {
      return run(hoursAgo(index + 1), subject);
    },
  );

  test("by default, a cluster's or a resource's hotspots are found", () => {
    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({ occurrences: subjects, investigations }),
    );

    expect(insights.hotspots.length).toBeGreaterThan(0);
    expect(kindsOf(insights)).toContain(AiActivityInsightKind.Hotspot);
  });

  test("includeHotspots: true is the default spelled out", () => {
    expect(
      AiActivityInsightsBuilder.build(
        input({ occurrences: subjects, investigations, includeHotspots: true }),
      ),
    ).toEqual(
      AiActivityInsightsBuilder.build(
        input({ occurrences: subjects, investigations }),
      ),
    );
  });

  test("asks for none: no hotspots, and no part behind the trouble", () => {
    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({ occurrences: subjects, investigations, includeHotspots: false }),
    );

    expect(insights.hotspots).toEqual([]);
    expect(kindsOf(insights)).not.toContain(AiActivityInsightKind.Hotspot);
  });

  test("still names the parts a problem fired for", () => {
    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({ occurrences: subjects, investigations, includeHotspots: false }),
    );

    expect(insights.problems[0]!.objects.length).toBeGreaterThan(0);
    expect(insights.problems[0]!.objects[0]!.count).toBe(3);
  });
});

describe("insights a reader worked out itself", () => {
  test("nothing extra changes nothing", () => {
    const base: AiActivityInsightsInput = input({
      investigations: [
        run(hoursAgo(1), incident("inc-1"), { status: AIRunStatus.Error }),
      ],
    });

    expect(
      AiActivityInsightsBuilder.build({ ...base, extraInsights: [] }),
    ).toEqual(AiActivityInsightsBuilder.build(base));
  });

  test("are ranked with the builder's own: tone first, then kind", () => {
    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({
        fixes: [failedFix(hoursAgo(2), { incidentId: "inc-1" })],
        investigations: [run(hoursAgo(1), incident("inc-1"))],
        extraInsights: [
          item(AiActivityInsightKind.Hotspot, AiActivityInsightTone.Pattern, 4),
          item(
            AiActivityInsightKind.NotInvestigated,
            AiActivityInsightTone.Critical,
            9,
          ),
        ],
      }),
    );

    expect(kindsOf(insights)).toEqual([
      // Critical: a fix that did not help before a skip.
      AiActivityInsightKind.FixesDidNotHelp,
      AiActivityInsightKind.NotInvestigated,
      // A pattern.
      AiActivityInsightKind.Hotspot,
    ]);
  });

  test("keep what they say", () => {
    const extra: AiActivityInsight = {
      kind: AiActivityInsightKind.NotInvestigated,
      tone: AiActivityInsightTone.Warning,
      count: 3,
      total: 10,
      reason: "ai_disabled",
    };

    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({ extraInsights: [extra] }),
    );

    expect(insights.insights).toEqual([extra]);
  });

  test("of one kind and tone, the larger count comes first", () => {
    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({
        extraInsights: [
          item(AiActivityInsightKind.Hotspot, AiActivityInsightTone.Pattern, 3),
          item(AiActivityInsightKind.Hotspot, AiActivityInsightTone.Pattern, 8),
        ],
      }),
    );

    expect(
      insights.insights.map((insight: AiActivityInsight): number => {
        return insight.count;
      }),
    ).toEqual([8, 3]);
  });

  test("count towards the page's few insights: the least important are dropped", () => {
    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({
        extraInsights: [
          ...Array.from({
            length: AI_ACTIVITY_INSIGHTS_MAX_INSIGHTS,
          }).map((): AiActivityInsight => {
            return item(
              AiActivityInsightKind.RiskSpotted,
              AiActivityInsightTone.Warning,
            );
          }),
          item(
            AiActivityInsightKind.NotInvestigated,
            AiActivityInsightTone.Critical,
          ),
        ],
      }),
    );

    expect(insights.insights).toHaveLength(AI_ACTIVITY_INSIGHTS_MAX_INSIGHTS);
    expect(insights.insights[0]!.kind).toBe(
      AiActivityInsightKind.NotInvestigated,
    );
  });

  test("every kind has its place, at one tone", () => {
    const order: Array<AiActivityInsightKind> = [
      AiActivityInsightKind.RecurringProblem,
      AiActivityInsightKind.FixesDidNotHelp,
      AiActivityInsightKind.NotInvestigated,
      AiActivityInsightKind.RiskSpotted,
      AiActivityInsightKind.FixesAwaitingApproval,
      AiActivityInsightKind.Hotspot,
      AiActivityInsightKind.ProblemStopped,
      AiActivityInsightKind.FixedAutomatically,
      AiActivityInsightKind.ReadyForAutomaticFixes,
    ];

    expect([...order].sort()).toEqual(
      Object.values(AiActivityInsightKind).sort(),
    );

    // Two pages' worth, each handed in last-first: the order is the builder's.
    for (const kinds of [order.slice(0, 5), order.slice(5)]) {
      const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
        input({
          extraInsights: [...kinds]
            .reverse()
            .map((kind: AiActivityInsightKind): AiActivityInsight => {
              return item(kind, AiActivityInsightTone.Warning);
            }),
        }),
      );

      expect(kindsOf(insights)).toEqual(kinds);
    }
  });

  test("every tone has its place: the most urgent first", () => {
    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({
        extraInsights: [
          AiActivityInsightTone.Positive,
          AiActivityInsightTone.Pattern,
          AiActivityInsightTone.Warning,
          AiActivityInsightTone.Critical,
        ].map((tone: AiActivityInsightTone): AiActivityInsight => {
          return item(AiActivityInsightKind.RiskSpotted, tone);
        }),
      }),
    );

    expect(
      insights.insights.map((insight: AiActivityInsight): string => {
        return insight.tone;
      }),
    ).toEqual([
      AiActivityInsightTone.Critical,
      AiActivityInsightTone.Warning,
      AiActivityInsightTone.Pattern,
      AiActivityInsightTone.Positive,
    ]);
  });

  test("leave the window, the totals and the problems alone", () => {
    const base: AiActivityInsightsInput = input({
      investigations: [run(hoursAgo(1), incident("inc-1"))],
    });
    const plain: AiActivityInsights = AiActivityInsightsBuilder.build(base);
    const extra: AiActivityInsights = AiActivityInsightsBuilder.build({
      ...base,
      extraInsights: [
        item(
          AiActivityInsightKind.NotInvestigated,
          AiActivityInsightTone.Critical,
          5,
        ),
      ],
    });

    expect({ ...extra, insights: [] }).toEqual({ ...plain, insights: [] });
  });

  test("stand on their own: kept with nothing of the window to show", () => {
    // The only run is older than the window; the reader's insight still counts.
    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({
        investigations: [
          run(new Date(NOW.getTime() - 40 * DAY), incident("inc-old")),
        ],
        extraInsights: [
          item(AiActivityInsightKind.Hotspot, AiActivityInsightTone.Pattern),
        ],
      }),
    );

    expect(insights.totals.investigations).toBe(0);
    expect(kindsOf(insights)).toEqual([AiActivityInsightKind.Hotspot]);
  });
});
