import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  AI_INSIGHTS_EMPTY_TITLE,
  AI_INSIGHTS_PAGE_TITLE,
  AiInsightsFixSegment,
  AiInsightsLook,
  describeAttentionItem,
  describeFixVerification,
  describeHotspot,
  describeLastSeen,
  describeObject,
  describePreventiveInsight,
  describeProblemCount,
  describeProblemFixes,
  describeProblemVerdicts,
  describeSubject,
  describeTrendDay,
  describeTrendWeeks,
  getAiInsightsEmptyDescription,
  getAiInsightsPageSubtitle,
  getAttentionLook,
  getFixSegments,
  getPreventiveSeverityColor,
  getProblemTitle,
  getTrendWeeks,
  hasAiActivity,
  parseAiActivityInsights,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsData";
import {
  AiActivityAttentionItem,
  AiActivityAttentionKind,
  AiActivityAttentionSeverity,
  AiActivityFixOutcomes,
  AiActivityInsights,
  AiActivityInsightsTotals,
  AiActivityProblem,
  AiActivitySubject,
  AiActivityTrendDay,
} from "../../../Types/AI/AiActivityInsights";
import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import { Gray500, Red500, Yellow500 } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import { getResourceSentenceName } from "../../../Types/AI/ResourceAiAccessPermissions";
import {
  ALERT_ID,
  INCIDENT_ID,
  INSIGHT_ID,
  ONE_OFF_PROBLEM_KEY,
  PREVENTIVE_INSIGHT_TITLE,
  RECURRING_PROBLEM_KEY,
  RECURRING_PROBLEM_TITLE,
  REPORT_FINDING,
  RUN_ID,
  TLDR_FINDING,
  makeEmptyInsights,
  makeInsights,
  makeTrend,
  toBody,
} from "./AiActivityInsightsFixtures";

/*
 * The pure half of every AI Insights page: how the dashboard reads what the
 * insights route answers (AiActivityInsights) and every sentence it says
 * about it. The server sends numbers and keys, never prose, so these words
 * are the whole of what a reader sees — and a body from an older or newer
 * server, or a broken one, must never turn into a crash or a sentence about
 * nothing.
 */

// "Now" for the relative times: the fixture's window ends today at noon.
const NOW: Date = new Date("2026-09-30T12:00:00.000Z");

beforeAll(() => {
  jest.useFakeTimers({ now: NOW });
});

afterAll(() => {
  jest.useRealTimers();
});

function recurringProblem(): AiActivityProblem {
  return makeInsights().problems[0]!;
}

function oneOffProblem(): AiActivityProblem {
  return makeInsights().problems[1]!;
}

function attention(
  kind: AiActivityAttentionKind,
  overrides: Partial<AiActivityAttentionItem> = {},
): AiActivityAttentionItem {
  return {
    kind,
    severity: AiActivityAttentionSeverity.Medium,
    count: 1,
    ...overrides,
  };
}

function say(item: AiActivityAttentionItem, windowInDays: number = 30): string {
  return describeAttentionItem(item, { windowInDays });
}

describe("parseAiActivityInsights", () => {
  test("reads everything the insights route returns, unchanged", () => {
    expect(parseAiActivityInsights(toBody(makeInsights()))).toEqual(
      makeInsights(),
    );
  });

  test("reads a quiet window as one with nothing to show", () => {
    const parsed: AiActivityInsights | null = parseAiActivityInsights(
      toBody(makeEmptyInsights()),
    );

    expect(parsed).toEqual(makeEmptyInsights());
    expect(hasAiActivity(parsed!)).toBe(false);
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "insights"],
    ["a number", 42],
    ["an array", [toBody(makeInsights())]],
    ["an object without totals", { problems: [] }],
    ["totals that are not an object", { totals: [1, 2, 3] }],
    ["the AI Logs body", { investigations: [], fixes: [] }],
  ])("refuses %s", (_label: string, value: unknown) => {
    expect(parseAiActivityInsights(value)).toBeNull();
  });

  test("fills what an older server left out with zeros and empty lists", () => {
    expect(parseAiActivityInsights({ totals: {} })).toEqual({
      windowInDays: 30,
      windowStart: "",
      generatedAt: "",
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
      trend: [],
      preventiveInsights: [],
      isPartial: false,
    });
  });

  test("every count is a whole, non-negative number", () => {
    const parsed: AiActivityInsights = parseAiActivityInsights({
      windowInDays: -14,
      totals: {
        investigations: 7.9,
        completedInvestigations: -3,
        failedInvestigations: "4",
        activeInvestigations: Number.NaN,
        problems: Number.POSITIVE_INFINITY,
        recurringProblems: null,
        fixes: 2,
        commands: true,
      },
      fixOutcomes: { total: "lots", verified: 1.5 },
    })!;

    expect(parsed.windowInDays).toBe(30);
    expect(parsed.totals.investigations).toBe(7);
    expect(parsed.totals.completedInvestigations).toBe(0);
    expect(parsed.totals.failedInvestigations).toBe(0);
    expect(parsed.totals.activeInvestigations).toBe(0);
    expect(parsed.totals.problems).toBe(0);
    expect(parsed.totals.recurringProblems).toBe(0);
    expect(parsed.totals.fixes).toBe(2);
    expect(parsed.totals.commands).toBe(0);
    expect(parsed.fixOutcomes.total).toBe(0);
    expect(parsed.fixOutcomes.verified).toBe(1);
  });

  test("a window of another length is kept for the sentences that name it", () => {
    expect(
      parseAiActivityInsights({ totals: {}, windowInDays: 14 })!.windowInDays,
    ).toBe(14);
  });

  test("only a literal true says the numbers are partial", () => {
    for (const value of ["true", 1, "yes", null]) {
      expect(
        parseAiActivityInsights({ totals: {}, isPartial: value })!.isPartial,
      ).toBe(false);
    }
    expect(
      parseAiActivityInsights({ totals: {}, isPartial: true })!.isPartial,
    ).toBe(true);
  });

  test("lists that are not lists read as empty", () => {
    const parsed: AiActivityInsights = parseAiActivityInsights({
      totals: {},
      attention: "everything",
      problems: { key: RECURRING_PROBLEM_KEY },
      hotspots: 3,
      trend: null,
      preventiveInsights: true,
    })!;

    expect(parsed.attention).toEqual([]);
    expect(parsed.problems).toEqual([]);
    expect(parsed.hotspots).toEqual([]);
    expect(parsed.trend).toEqual([]);
    expect(parsed.preventiveInsights).toEqual([]);
  });

  describe("problems", () => {
    test("drop a row without a key or an incident or alert to link to", () => {
      const subject: unknown = {
        kind: "incident",
        id: INCIDENT_ID,
        title: "x",
      };
      const parsed: AiActivityInsights = parseAiActivityInsights({
        totals: {},
        problems: [
          "not a row",
          null,
          { latestSubject: subject },
          { key: "  ", latestSubject: subject },
          { key: "problem-1" },
          { key: "problem-2", latestSubject: { kind: "service", id: "x" } },
          { key: "problem-3", latestSubject: { kind: "alert" } },
          { key: "problem-4", latestSubject: { kind: "alert", id: ALERT_ID } },
        ],
      })!;

      expect(
        parsed.problems.map((problem: AiActivityProblem): string => {
          return problem.key;
        }),
      ).toEqual(["problem-4"]);
    });

    test("a bare row reads with no title, no finding, and zero counts", () => {
      expect(
        parseAiActivityInsights({
          totals: {},
          problems: [
            {
              key: "problem-4",
              latestSubject: { kind: "alert", id: ALERT_ID },
            },
          ],
        })!.problems[0],
      ).toEqual({
        key: "problem-4",
        title: "",
        investigationCount: 0,
        subjectCount: 0,
        isRecurring: false,
        latestSubject: { kind: "alert", id: ALERT_ID },
        objects: [],
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
      });
    });

    test("a finding needs its run and its text; anything but a report is a TL;DR", () => {
      const read: (finding: unknown) => AiActivityProblem = (
        finding: unknown,
      ): AiActivityProblem => {
        return parseAiActivityInsights({
          totals: {},
          problems: [
            {
              key: "problem-4",
              latestSubject: { kind: "alert", id: ALERT_ID },
              latestFinding: finding,
            },
          ],
        })!.problems[0]!;
      };

      expect(read({ aiRunId: RUN_ID, text: "  " }).latestFinding).toBe(
        undefined,
      );
      expect(read({ text: TLDR_FINDING }).latestFinding).toBe(undefined);
      expect(read("a finding").latestFinding).toBe(undefined);
      expect(
        read({ aiRunId: RUN_ID, text: REPORT_FINDING, source: "report" })
          .latestFinding,
      ).toEqual({ aiRunId: RUN_ID, text: REPORT_FINDING, source: "report" });
      expect(
        read({ aiRunId: RUN_ID, text: TLDR_FINDING, source: "llm" })
          .latestFinding,
      ).toEqual({ aiRunId: RUN_ID, text: TLDR_FINDING, source: "tldr" });
    });

    test("objects need a name and a value, and count at least once", () => {
      expect(
        parseAiActivityInsights({
          totals: {},
          problems: [
            {
              key: "problem-4",
              latestSubject: { kind: "alert", id: ALERT_ID },
              objects: [
                { name: "Pod", value: "web-1", count: 0 },
                { name: "Pod" },
                { value: "web-2" },
                { name: "Node", value: "node-3", count: 4 },
                "Pod: web-3",
              ],
            },
          ],
        })!.problems[0]!.objects,
      ).toEqual([
        { name: "Pod", value: "web-1", count: 1 },
        { name: "Node", value: "node-3", count: 4 },
      ]);
    });

    test("a subject's number is a whole number or left out, its blank title left out", () => {
      const subjectOf: (subject: unknown) => unknown = (
        subject: unknown,
      ): unknown => {
        return parseAiActivityInsights({
          totals: {},
          problems: [{ key: "problem-4", latestSubject: subject }],
        })!.problems[0]!.latestSubject;
      };

      expect(
        subjectOf({ kind: "incident", id: INCIDENT_ID, number: 0, title: " " }),
      ).toEqual({ kind: "incident", id: INCIDENT_ID, number: 0 });
      expect(
        subjectOf({ kind: "incident", id: INCIDENT_ID, number: -1 }),
      ).toEqual({ kind: "incident", id: INCIDENT_ID });
      expect(
        subjectOf({ kind: "incident", id: INCIDENT_ID, number: "42" }),
      ).toEqual({ kind: "incident", id: INCIDENT_ID });
    });
  });

  test("hotspots, trend days and preventive insights drop rows they cannot name", () => {
    const parsed: AiActivityInsights = parseAiActivityInsights({
      totals: {},
      hotspots: [
        { name: "Node", investigationCount: 3 },
        { name: "Node", value: "node-3", investigationCount: 3 },
      ],
      trend: [{ investigations: 4 }, { date: "2026-09-30", investigations: 2 }],
      preventiveInsights: [
        { id: INSIGHT_ID },
        { title: PREVENTIVE_INSIGHT_TITLE },
        { id: INSIGHT_ID, title: PREVENTIVE_INSIGHT_TITLE, occurrenceCount: 0 },
        { id: "insight-2", title: "Latency regressed", occurrenceCount: -2 },
      ],
    })!;

    expect(parsed.hotspots).toEqual([
      { name: "Node", value: "node-3", investigationCount: 3, problemCount: 0 },
    ]);
    expect(parsed.trend).toEqual([
      {
        date: "2026-09-30",
        investigations: 2,
        failedInvestigations: 0,
        fixes: 0,
      },
    ]);
    expect(parsed.preventiveInsights).toEqual([
      {
        id: INSIGHT_ID,
        title: PREVENTIVE_INSIGHT_TITLE,
        insightType: "",
        severity: "",
        status: "",
        occurrenceCount: 0,
      },
      {
        id: "insight-2",
        title: "Latency regressed",
        insightType: "",
        severity: "",
        status: "",
      },
    ]);
  });

  test("an attention item of a kind or severity this page cannot word is skipped", () => {
    const parsed: AiActivityInsights = parseAiActivityInsights({
      totals: {},
      attention: [
        { kind: "SomethingNewer", severity: "High", count: 1 },
        { kind: "FixesFailed", severity: "Critical", count: 1 },
        { kind: "FixesFailed", count: 1 },
        {
          kind: "FixesFailed",
          severity: "High",
          count: 2,
          subject: { kind: "service", id: "x" },
          object: { name: "Pod" },
        },
      ],
    })!;

    expect(parsed.attention).toEqual([
      {
        kind: AiActivityAttentionKind.FixesFailed,
        severity: AiActivityAttentionSeverity.High,
        count: 2,
      },
    ]);
  });
});

describe("hasAiActivity", () => {
  test("is false for a window with nothing in it", () => {
    expect(hasAiActivity(makeEmptyInsights())).toBe(false);
  });

  test.each([
    ["an investigation", { investigations: 1 }],
    ["a fix", { fixes: 1 }],
    ["a command", { commands: 1 }],
  ] as Array<[string, Partial<AiActivityInsightsTotals>]>)(
    "is true with %s",
    (_label: string, totals: Partial<AiActivityInsightsTotals>) => {
      const empty: AiActivityInsights = makeEmptyInsights();
      expect(
        hasAiActivity({ ...empty, totals: { ...empty.totals, ...totals } }),
      ).toBe(true);
    },
  );

  test("is true with only an open preventive insight", () => {
    expect(
      hasAiActivity({
        ...makeEmptyInsights(),
        preventiveInsights: makeInsights().preventiveInsights,
      }),
    ).toBe(true);
  });
});

describe("the page's words", () => {
  test("the title and the empty state's title", () => {
    expect(AI_INSIGHTS_PAGE_TITLE).toBe("AI Insights");
    expect(AI_INSIGHTS_EMPTY_TITLE).toBe("No AI activity in the last 30 days");
  });

  test("the subtitle and the empty state name the scope", () => {
    expect(getAiInsightsPageSubtitle("cluster")).toBe(
      "What OneUptime AI has learned about this cluster in the last 30 days, and what deserves your attention.",
    );
    expect(getAiInsightsEmptyDescription("Ceph cluster")).toBe(
      "When OneUptime AI investigates incidents and alerts on this Ceph cluster, what it learns shows up here: the problems that keep coming back, the parts of the Ceph cluster they hit, what the investigations found and how fixes turned out.",
    );
  });

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: the subtitle says what the resource is, in sentence case",
    (type: AiResourceType) => {
      const noun: string = getResourceSentenceName(type);
      expect(getAiInsightsPageSubtitle(noun)).toContain(`about this ${noun} `);
      expect(getAiInsightsEmptyDescription(noun)).toContain(`on this ${noun},`);
    },
  );
});

describe("looks", () => {
  test("each attention severity has its own colour, icon and words", () => {
    expect(getAttentionLook(AiActivityAttentionSeverity.High)).toEqual({
      color: Red500,
      icon: IconProp.ExclaimationCircle,
      label: "Needs attention now",
    });
    expect(getAttentionLook(AiActivityAttentionSeverity.Medium)).toEqual({
      color: Yellow500,
      icon: IconProp.Alert,
      label: "Worth a look",
    });
    expect(getAttentionLook(AiActivityAttentionSeverity.Low)).toEqual({
      color: Gray500,
      icon: IconProp.Info,
      label: "Good to know",
    });
  });

  test("a severity it does not know looks like Low", () => {
    const look: AiInsightsLook = getAttentionLook(
      "Critical" as AiActivityAttentionSeverity,
    );
    expect(look).toEqual(getAttentionLook(AiActivityAttentionSeverity.Low));
  });

  test("preventive insights are coloured by their own severity", () => {
    expect(getPreventiveSeverityColor(AIInsightSeverity.High)).toBe(Red500);
    expect(getPreventiveSeverityColor(AIInsightSeverity.Medium)).toBe(
      Yellow500,
    );
    expect(getPreventiveSeverityColor(AIInsightSeverity.Low)).toBe(Gray500);
    expect(getPreventiveSeverityColor("")).toBe(Gray500);
    expect(getPreventiveSeverityColor("Severe")).toBe(Gray500);
  });
});

describe("naming incidents, alerts and parts of the scope", () => {
  test.each([
    [
      { kind: "incident", id: INCIDENT_ID, number: 42, title: "Checkout down" },
      "Incident #42: Checkout down",
    ],
    [{ kind: "incident", id: INCIDENT_ID, number: 42 }, "Incident #42"],
    [
      { kind: "incident", id: INCIDENT_ID, title: "Checkout down" },
      "Incident: Checkout down",
    ],
    [{ kind: "incident", id: INCIDENT_ID }, "Incident"],
    [
      { kind: "alert", id: ALERT_ID, number: 7, title: "Disk full" },
      "Alert #7: Disk full",
    ],
    [{ kind: "alert", id: ALERT_ID, number: 7 }, "Alert #7"],
    [{ kind: "alert", id: ALERT_ID, title: "Disk full" }, "Alert: Disk full"],
    [{ kind: "alert", id: ALERT_ID }, "Alert"],
  ] as Array<[AiActivitySubject, string]>)(
    "%j is %s",
    (subject: AiActivitySubject, expected: string) => {
      expect(describeSubject(subject)).toBe(expected);
    },
  );

  test("a problem is headed by its title, else by its latest incident or alert", () => {
    expect(getProblemTitle(recurringProblem())).toBe(RECURRING_PROBLEM_TITLE);
    expect(getProblemTitle({ ...oneOffProblem(), title: "" })).toBe(
      "Alert: Disk almost full on node-3",
    );
  });

  test("a part of the scope is named the way alert titles name it", () => {
    expect(describeObject({ name: "Namespace", value: "checkout" })).toBe(
      "Namespace: checkout",
    );
    expect(describeObject({ name: "Virtual Machine", value: "db-01" })).toBe(
      "Virtual Machine: db-01",
    );
  });

  test("server text goes into a sentence as it is", () => {
    expect(
      describeSubject({
        kind: "incident",
        id: INCIDENT_ID,
        number: 1,
        title: "<script>{{count}}</script>",
      }),
    ).toBe("Incident #1: <script>{{count}}</script>");
  });
});

describe("when something was last seen", () => {
  test("is relative to now", () => {
    expect(describeLastSeen("2026-09-30T07:00:00.000Z")).toBe(
      "last seen 5 hours ago",
    );
    expect(describeLastSeen("2026-09-26T10:00:00.000Z")).toBe(
      "last seen 4 days ago",
    );
  });

  test("is left out without a readable date", () => {
    expect(describeLastSeen(undefined)).toBeNull();
    expect(describeLastSeen("")).toBeNull();
    expect(describeLastSeen("not a date")).toBeNull();
  });
});

describe("a problem's lines", () => {
  test("how often, across how many incidents and alerts, and when last", () => {
    expect(describeProblemCount(recurringProblem())).toBe(
      "Investigated 5 times · 4 incidents and alerts · last seen 5 hours ago",
    );
    expect(describeProblemCount(oneOffProblem())).toBe(
      "Investigated 1 time · last seen 4 days ago",
    );
    expect(
      describeProblemCount({ ...oneOffProblem(), lastSeenAt: undefined }),
    ).toBe("Investigated 1 time");
  });

  test("what happened to its fixes, saying only what is not zero", () => {
    expect(describeProblemFixes(recurringProblem())).toBe(
      "3 fixes proposed · 2 applied · 1 verified · 1 did not help · 1 waiting for approval",
    );
    expect(
      describeProblemFixes({
        ...oneOffProblem(),
        fixes: {
          proposed: 1,
          applied: 0,
          verified: 0,
          failed: 0,
          awaitingApproval: 1,
        },
      }),
    ).toBe("1 fix proposed · 1 waiting for approval");
    expect(describeProblemFixes(oneOffProblem())).toBeNull();
  });

  test("what people and the grader said of its findings", () => {
    expect(describeProblemVerdicts(recurringProblem())).toBe(
      "your team confirmed 2 findings · your team rejected 1 finding · 2 findings matched the root cause recorded later",
    );
    expect(
      describeProblemVerdicts({
        ...oneOffProblem(),
        verdicts: {
          confirmed: 1,
          rejected: 0,
          matched: 0,
          partlyMatched: 1,
          mismatched: 1,
        },
      }),
    ).toBe(
      "your team confirmed 1 finding · 1 finding matched the root cause recorded later · 1 finding did not match the root cause recorded later",
    );
    expect(
      describeProblemVerdicts({
        ...oneOffProblem(),
        verdicts: {
          confirmed: 0,
          rejected: 0,
          matched: 0,
          partlyMatched: 0,
          mismatched: 2,
        },
      }),
    ).toBe("2 findings did not match the root cause recorded later");
    expect(describeProblemVerdicts(oneOffProblem())).toBeNull();
  });
});

describe("hotspots and preventive insights", () => {
  test("a hotspot says how many investigations and problems, and when last", () => {
    const insights: AiActivityInsights = makeInsights();

    expect(describeHotspot(insights.hotspots[0]!)).toBe(
      "5 investigations · 1 problem · last seen 5 hours ago",
    );
    expect(describeHotspot(insights.hotspots[1]!)).toBe(
      "2 investigations · 2 problems · last seen 4 days ago",
    );
    expect(
      describeHotspot({
        name: "Pod",
        value: "web-1",
        investigationCount: 1,
        problemCount: 1,
      }),
    ).toBe("1 investigation · 1 problem");
  });

  test("a preventive insight says how often it was seen, and when last", () => {
    const insight: AiActivityInsights["preventiveInsights"][0] =
      makeInsights().preventiveInsights[0]!;

    expect(describePreventiveInsight(insight)).toBe(
      "seen 3 times · last seen 6 hours ago",
    );
    expect(
      describePreventiveInsight({
        ...insight,
        occurrenceCount: 1,
        lastSeenAt: undefined,
      }),
    ).toBe("seen 1 time");
    expect(
      describePreventiveInsight({
        ...insight,
        occurrenceCount: undefined,
        lastSeenAt: undefined,
      }),
    ).toBe("");
  });
});

describe("attention items", () => {
  test("fixes that did not help", () => {
    expect(say(attention(AiActivityAttentionKind.FixesFailed))).toBe(
      "1 fix OneUptime AI applied did not resolve the problem it was for.",
    );
    expect(
      say(attention(AiActivityAttentionKind.FixesFailed, { count: 2 })),
    ).toBe(
      "2 fixes OneUptime AI applied did not resolve the problems they were for.",
    );
  });

  test("a recurring problem, and how much of it was recent", () => {
    const item: AiActivityAttentionItem = makeInsights().attention[1]!;

    expect(item.kind).toBe(AiActivityAttentionKind.RecurringProblem);
    expect(say(item)).toBe(
      "KubePodCrashLooping keeps coming back: OneUptime AI investigated it 5 times in the last 30 days. 3 of those were in the last 7 days.",
    );
    expect(say({ ...item, recentCount: 1 })).toBe(
      "KubePodCrashLooping keeps coming back: OneUptime AI investigated it 5 times in the last 30 days. 1 of those was in the last 7 days.",
    );
    expect(say({ ...item, recentCount: 0 })).toBe(
      "KubePodCrashLooping keeps coming back: OneUptime AI investigated it 5 times in the last 30 days.",
    );
    expect(say({ ...item, recentCount: undefined, title: undefined }, 14)).toBe(
      "A problem keeps coming back: OneUptime AI investigated it 5 times in the last 14 days.",
    );
  });

  test("an open preventive insight", () => {
    expect(say(makeInsights().attention[2]!)).toBe(
      `An open preventive insight: ${PREVENTIVE_INSIGHT_TITLE}`,
    );
  });

  test("fixes waiting for approval", () => {
    expect(say(attention(AiActivityAttentionKind.FixesAwaitingApproval))).toBe(
      "1 fix OneUptime AI proposed is waiting for approval.",
    );
    expect(
      say(
        attention(AiActivityAttentionKind.FixesAwaitingApproval, { count: 3 }),
      ),
    ).toBe("3 fixes OneUptime AI proposed are waiting for approval.");
  });

  test("investigations that failed, over the window the server used", () => {
    expect(say(attention(AiActivityAttentionKind.InvestigationsFailed))).toBe(
      "1 investigation failed or timed out in the last 30 days.",
    );
    expect(
      say(
        attention(AiActivityAttentionKind.InvestigationsFailed, { count: 4 }),
        14,
      ),
    ).toBe("4 investigations failed or timed out in the last 14 days.");
  });

  test("commands the agent never picked up", () => {
    expect(say(attention(AiActivityAttentionKind.CommandsTimedOut))).toBe(
      "1 command OneUptime AI sent was never picked up by the agent.",
    );
    expect(
      say(attention(AiActivityAttentionKind.CommandsTimedOut, { count: 3 })),
    ).toBe("3 commands OneUptime AI sent were never picked up by the agent.");
  });

  test("findings people rejected or the grader found wrong", () => {
    expect(say(attention(AiActivityAttentionKind.FindingsRejected))).toBe(
      "1 finding was rejected by your team or did not match the root cause recorded later.",
    );
    expect(
      say(attention(AiActivityAttentionKind.FindingsRejected, { count: 2 })),
    ).toBe(
      "2 findings were rejected by your team or did not match the root cause recorded later.",
    );
  });

  test("a hotspot, out of all the investigations", () => {
    expect(say(makeInsights().attention[5]!)).toBe(
      "Namespace: checkout shows up in 5 of the 8 investigations here.",
    );
  });

  test("every kind says something, and never leaves a placeholder unfilled", () => {
    for (const kind of Object.values(AiActivityAttentionKind)) {
      const sentence: string = say(
        attention(kind, {
          count: 2,
          total: 5,
          recentCount: 1,
          title: "Checkout down",
          object: { name: "Pod", value: "web-1" },
        }),
      );
      expect(sentence.length).toBeGreaterThan(0);
      expect(sentence).not.toMatch(/\{\{|\}\}/);
    }
  });

  test("a kind this page does not know says nothing", () => {
    expect(say(attention("SomethingNewer" as AiActivityAttentionKind))).toBe(
      "",
    );
  });
});

describe("the trend", () => {
  test("sums the last seven days and the seven before them", () => {
    expect(getTrendWeeks(makeTrend())).toEqual({ thisWeek: 5, lastWeek: 2 });
    expect(describeTrendWeeks(makeTrend())).toBe(
      "5 investigations in the last 7 days (2 the 7 days before).",
    );
  });

  test("works for a trend shorter than two weeks", () => {
    // 2026-09-28 to 2026-09-30: one investigation, then two.
    const days: Array<AiActivityTrendDay> = makeTrend().slice(-3);

    expect(getTrendWeeks(days)).toEqual({ thisWeek: 3, lastWeek: 0 });
    expect(describeTrendWeeks(days)).toBe(
      "3 investigations in the last 7 days (0 the 7 days before).",
    );
    expect(getTrendWeeks([])).toEqual({ thisWeek: 0, lastWeek: 0 });
  });

  test("one investigation reads in the singular", () => {
    const days: Array<AiActivityTrendDay> = makeTrend().map(
      (day: AiActivityTrendDay, index: number): AiActivityTrendDay => {
        return { ...day, investigations: index === 29 ? 1 : 0 };
      },
    );

    expect(describeTrendWeeks(days)).toBe(
      "1 investigation in the last 7 days (0 the 7 days before).",
    );
  });

  test("each day says what happened on it", () => {
    expect(describeTrendDay(makeTrend()[29]!)).toBe(
      "2026-09-30: 2 investigations, 1 failed, 1 fixes",
    );
  });
});

describe("fixes", () => {
  test("the bar shows where fixes ended up, applied first, and nothing that is zero", () => {
    expect(getFixSegments(makeInsights().fixOutcomes)).toEqual([
      { label: "Applied automatically", value: 1, color: "bg-green-500" },
      { label: "Applied after approval", value: 1, color: "bg-emerald-400" },
      { label: "Waiting for approval", value: 1, color: "bg-amber-400" },
      { label: "Dismissed", value: 1, color: "bg-gray-300" },
    ]);
  });

  test("every outcome has a segment", () => {
    const outcomes: AiActivityFixOutcomes = {
      total: 21,
      planning: 4,
      awaitingApproval: 3,
      appliedAutomatically: 1,
      appliedAfterApproval: 2,
      dismissed: 5,
      noFixFound: 6,
      verified: 0,
      failed: 0,
      verifying: 0,
    };

    expect(
      getFixSegments(outcomes).map((segment: AiInsightsFixSegment): string => {
        return `${segment.label}=${segment.value}`;
      }),
    ).toEqual([
      "Applied automatically=1",
      "Applied after approval=2",
      "Waiting for approval=3",
      "Planning=4",
      "Dismissed=5",
      "No fix found=6",
    ]);
    expect(getFixSegments(makeEmptyInsights().fixOutcomes)).toEqual([]);
  });

  test("verification is said only once something was verified", () => {
    expect(describeFixVerification(makeInsights().fixOutcomes)).toBe(
      "Verification: 1 resolved the problem, 1 did not, 0 still being checked.",
    );
    expect(
      describeFixVerification({
        ...makeEmptyInsights().fixOutcomes,
        verifying: 2,
      }),
    ).toBe(
      "Verification: 0 resolved the problem, 0 did not, 2 still being checked.",
    );
    expect(describeFixVerification(makeEmptyInsights().fixOutcomes)).toBeNull();
  });
});

describe("the fixture", () => {
  // Guards the story the page suites rely on.
  test("is about the problems and insight the page suites look for", () => {
    const insights: AiActivityInsights = makeInsights();

    expect(
      insights.problems.map((problem: AiActivityProblem): string => {
        return problem.key;
      }),
    ).toEqual([RECURRING_PROBLEM_KEY, ONE_OFF_PROBLEM_KEY]);
    expect(insights.problems[0]!.latestFinding?.text).toBe(TLDR_FINDING);
    expect(insights.problems[1]!.latestFinding?.source).toBe("report");
    expect(insights.preventiveInsights[0]!.id).toBe(INSIGHT_ID);
    expect(insights.trend).toHaveLength(30);
    expect(hasAiActivity(insights)).toBe(true);
  });
});
