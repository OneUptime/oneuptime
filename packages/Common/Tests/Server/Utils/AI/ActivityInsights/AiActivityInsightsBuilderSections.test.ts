import AiActivityInsightsBuilder, {
  AiActivityFixInput,
  AiActivityInsightsInput,
  AiActivityInvestigationInput,
  AiActivitySubjectInput,
} from "../../../../../Server/Utils/AI/ActivityInsights/AiActivityInsightsBuilder";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import {
  AI_ACTIVITY_INSIGHTS_MAX_ATTENTION_ITEMS,
  AiActivityAttentionItem,
  AiActivityAttentionKind,
  AiActivityAttentionSeverity,
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
 * parts of its own asks for no hotspots, and attention items only the
 * reader's rows can say are ranked with the builder's own. A cluster's and
 * a resource's insights, which pass none of it, are pinned unchanged by
 * AiActivityInsightsBuilder.test.ts.
 */

const NOW: Date = new Date("2026-09-22T10:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

const MONITOR_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";

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
  kind: AiActivityAttentionKind,
  severity: AiActivityAttentionSeverity,
  count: number = 1,
): AiActivityAttentionItem {
  return { kind, severity, count };
}

function kindsOf(insights: AiActivityInsights): Array<AiActivityAttentionKind> {
  return insights.attention.map(
    (attention: AiActivityAttentionItem): AiActivityAttentionKind => {
      return attention.kind;
    },
  );
}

// Labels that name the same deployment, so it shows up as a hotspot.
const DEPLOYMENT_LABELS: JSONObject = {
  "resource.k8s.namespace.name": "shop",
  "resource.k8s.deployment.name": "checkout",
};

describe("a subject's prefixed number", () => {
  test("travels with the subject to its problem and to an attention item", () => {
    const subject: AiActivitySubjectInput = incident("inc-1", {
      numberWithPrefix: "INC-7",
      monitorIds: [MONITOR_ID],
    });

    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({
        investigations: [
          run(hoursAgo(1), subject),
          run(hoursAgo(2), subject),
          run(hoursAgo(3), subject),
        ],
      }),
    );

    expect(insights.problems[0]!.latestSubject).toEqual({
      kind: "incident",
      id: "inc-1",
      title: "Incident inc-1",
      number: 7,
      numberWithPrefix: "INC-7",
    });

    const recurring: AiActivityAttentionItem | undefined =
      insights.attention.find((attention: AiActivityAttentionItem) => {
        return attention.kind === AiActivityAttentionKind.RecurringProblem;
      });

    expect(recurring?.subject?.numberWithPrefix).toBe("INC-7");
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

  test("let a failed fix link the incident it was for", () => {
    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({
        fixes: [failedFix(hoursAgo(2), { incidentId: "inc-fix" })],
        subjects: new Map<string, AiActivitySubjectInput>([
          ["inc-fix", fixOnly],
        ]),
      }),
    );

    const failed: AiActivityAttentionItem = insights.attention[0]!;

    expect(failed.kind).toBe(AiActivityAttentionKind.FixesFailed);
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

    expect(insights.attention[0]!.kind).toBe(
      AiActivityAttentionKind.FixesFailed,
    );
    expect(insights.attention[0]!.subject).toBeUndefined();
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

    expect(insights.attention[0]!.subject).toBeUndefined();
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

    // The newest failed fix links the incident as the map has it.
    expect(insights.attention[0]!.kind).toBe(
      AiActivityAttentionKind.FixesFailed,
    );
    expect(insights.attention[0]!.subject?.title).toBe("Map title");
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

    expect(insights.attention[0]!.subject?.id).toBe("inc-2");
  });
});

describe("a scope with no parts of its own", () => {
  // Four investigations of one deployment: a hotspot, and in most of them.
  const subjects: Array<AiActivitySubjectInput> = [1, 2, 3, 4].map(
    (index: number): AiActivitySubjectInput => {
      return incident(`inc-${index}`, {
        monitorIds: [MONITOR_ID],
        seriesLabels: DEPLOYMENT_LABELS,
      });
    },
  );
  const investigations: Array<AiActivityInvestigationInput> = subjects.map(
    (subject: AiActivitySubjectInput, index: number) => {
      return run(hoursAgo(index + 1), subject);
    },
  );

  test("by default, a cluster's or a resource's hotspots are found", () => {
    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({ investigations }),
    );

    expect(insights.hotspots.length).toBeGreaterThan(0);
    expect(kindsOf(insights)).toContain(AiActivityAttentionKind.Hotspot);
  });

  test("includeHotspots: true is the default spelled out", () => {
    expect(
      AiActivityInsightsBuilder.build(
        input({ investigations, includeHotspots: true }),
      ),
    ).toEqual(AiActivityInsightsBuilder.build(input({ investigations })));
  });

  test("asks for none: no hotspots, and no hotspot to pay attention to", () => {
    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({ investigations, includeHotspots: false }),
    );

    expect(insights.hotspots).toEqual([]);
    expect(kindsOf(insights)).not.toContain(AiActivityAttentionKind.Hotspot);
  });

  test("still names the parts a problem fired for", () => {
    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({ investigations, includeHotspots: false }),
    );

    expect(insights.problems[0]!.objects.length).toBeGreaterThan(0);
    expect(insights.problems[0]!.objects[0]!.count).toBe(4);
  });
});

describe("attention items a reader worked out itself", () => {
  test("nothing extra changes nothing", () => {
    const base: AiActivityInsightsInput = input({
      investigations: [
        run(hoursAgo(1), incident("inc-1"), { status: AIRunStatus.Error }),
      ],
    });

    expect(
      AiActivityInsightsBuilder.build({ ...base, extraAttention: [] }),
    ).toEqual(AiActivityInsightsBuilder.build(base));
  });

  test("are ranked with the builder's own: severity first, then kind", () => {
    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({
        fixes: [failedFix(hoursAgo(2), { incidentId: "inc-1" })],
        investigations: [
          run(hoursAgo(1), incident("inc-1"), { status: AIRunStatus.Error }),
        ],
        extraAttention: [
          item(
            AiActivityAttentionKind.MonitorHotspot,
            AiActivityAttentionSeverity.Low,
            4,
          ),
          item(
            AiActivityAttentionKind.InvestigationsNotStarted,
            AiActivityAttentionSeverity.High,
            9,
          ),
        ],
      }),
    );

    expect(kindsOf(insights)).toEqual([
      // High: a failed fix before a skip.
      AiActivityAttentionKind.FixesFailed,
      AiActivityAttentionKind.InvestigationsNotStarted,
      // Medium: one failed investigation of one.
      AiActivityAttentionKind.InvestigationsFailed,
      // Low.
      AiActivityAttentionKind.MonitorHotspot,
    ]);
  });

  test("keep what they say", () => {
    const extra: AiActivityAttentionItem = {
      kind: AiActivityAttentionKind.InvestigationsNotStarted,
      severity: AiActivityAttentionSeverity.Medium,
      count: 3,
      total: 10,
      reason: "ai_disabled",
    };

    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({ extraAttention: [extra] }),
    );

    expect(insights.attention).toEqual([extra]);
  });

  test("of one kind and severity, the larger count comes first", () => {
    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({
        extraAttention: [
          item(
            AiActivityAttentionKind.MonitorHotspot,
            AiActivityAttentionSeverity.Low,
            3,
          ),
          item(
            AiActivityAttentionKind.MonitorHotspot,
            AiActivityAttentionSeverity.Low,
            8,
          ),
        ],
      }),
    );

    expect(
      insights.attention.map((attention: AiActivityAttentionItem): number => {
        return attention.count;
      }),
    ).toEqual([8, 3]);
  });

  test("count towards the page's few items: the least important are dropped", () => {
    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({
        extraAttention: [
          ...Array.from({
            length: AI_ACTIVITY_INSIGHTS_MAX_ATTENTION_ITEMS,
          }).map((): AiActivityAttentionItem => {
            return item(
              AiActivityAttentionKind.MonitorHotspot,
              AiActivityAttentionSeverity.Low,
            );
          }),
          item(
            AiActivityAttentionKind.InvestigationsNotStarted,
            AiActivityAttentionSeverity.High,
          ),
        ],
      }),
    );

    expect(insights.attention).toHaveLength(
      AI_ACTIVITY_INSIGHTS_MAX_ATTENTION_ITEMS,
    );
    expect(insights.attention[0]!.kind).toBe(
      AiActivityAttentionKind.InvestigationsNotStarted,
    );
  });

  test("every kind has its place, at one severity", () => {
    const order: Array<AiActivityAttentionKind> = [
      AiActivityAttentionKind.FixesFailed,
      AiActivityAttentionKind.InvestigationsNotStarted,
      AiActivityAttentionKind.RecurringProblem,
      AiActivityAttentionKind.PreventiveInsight,
      AiActivityAttentionKind.FixesAwaitingApproval,
      AiActivityAttentionKind.InvestigationsFailed,
      AiActivityAttentionKind.CommandsTimedOut,
      AiActivityAttentionKind.FindingsRejected,
      AiActivityAttentionKind.Hotspot,
      AiActivityAttentionKind.MonitorHotspot,
    ];

    expect([...order].sort()).toEqual(
      Object.values(AiActivityAttentionKind).sort(),
    );

    // Two pages' worth, each handed in last-first: the order is the builder's.
    for (const kinds of [order.slice(0, 5), order.slice(5)]) {
      const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
        input({
          extraAttention: [...kinds]
            .reverse()
            .map((kind: AiActivityAttentionKind): AiActivityAttentionItem => {
              return item(kind, AiActivityAttentionSeverity.Medium);
            }),
        }),
      );

      expect(kindsOf(insights)).toEqual(kinds);
    }
  });

  test("leave the window, the totals and the problems alone", () => {
    const base: AiActivityInsightsInput = input({
      investigations: [run(hoursAgo(1), incident("inc-1"))],
    });
    const plain: AiActivityInsights = AiActivityInsightsBuilder.build(base);
    const extra: AiActivityInsights = AiActivityInsightsBuilder.build({
      ...base,
      extraAttention: [
        item(
          AiActivityAttentionKind.InvestigationsNotStarted,
          AiActivityAttentionSeverity.High,
          5,
        ),
      ],
    });

    expect({ ...extra, attention: [] }).toEqual({ ...plain, attention: [] });
  });

  test("stand on their own: kept with nothing of the window to show", () => {
    // The only run is older than the window; the reader's item still counts.
    const insights: AiActivityInsights = AiActivityInsightsBuilder.build(
      input({
        investigations: [
          run(new Date(NOW.getTime() - 40 * DAY), incident("inc-old")),
        ],
        extraAttention: [
          item(
            AiActivityAttentionKind.MonitorHotspot,
            AiActivityAttentionSeverity.Low,
          ),
        ],
      }),
    );

    expect(insights.totals.investigations).toBe(0);
    expect(kindsOf(insights)).toEqual([AiActivityAttentionKind.MonitorHotspot]);
  });
});
