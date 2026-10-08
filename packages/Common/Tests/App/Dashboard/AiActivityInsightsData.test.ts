import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  AI_INSIGHTS_EMPTY_TITLE,
  AI_INSIGHTS_FINDING_LABEL,
  AI_INSIGHTS_FROM_REPORT_NOTE,
  AI_INSIGHTS_NEXT_STEP_LABEL,
  AI_INSIGHTS_PAGE_TITLE,
  AiActivityHealthKind,
  AiActivityHealthNote,
  AiInsightLook,
  AiInsightWordingContext,
  AiInsightsFixSegment,
  describeFindingsTrust,
  describeFixVerification,
  describeHotspot,
  describeInsightFacts,
  describeInsightHeadline,
  describeLastSeen,
  describeObject,
  describeObjectInSentence,
  describePreventiveInsight,
  describeProblemCount,
  describeProblemFixes,
  describeProblemVerdicts,
  describeSubject,
  describeSubjectShort,
  describeTimeOfDay,
  describeTrendDay,
  describeTrendWeeks,
  formatUtcHour,
  getActivityHealthNotes,
  getAiInsightsEmptyDescription,
  getAiInsightsPageSubtitle,
  getFixSegments,
  getInsightBadge,
  getInsightLook,
  getPreventiveSeverityColor,
  getProblemTitle,
  getRecurringBadge,
  getTrendWeeks,
  hasAiActivity,
  isGettingWorse,
  isNewProblem,
  parseAiActivityInsights,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsData";
import {
  AI_ACTIVITY_INSIGHTS_RECENT_WINDOW_IN_DAYS,
  AI_ACTIVITY_INSIGHTS_RECURRING_ATTENTION_MIN,
  AiActivityFixOutcomes,
  AiActivityInsight,
  AiActivityInsightKind,
  AiActivityInsightTone,
  AiActivityInsights,
  AiActivityInsightsTotals,
  AiActivityProblem,
  AiActivitySubject,
  AiActivityTimeOfDay,
  AiActivityTrendDay,
} from "../../../Types/AI/AiActivityInsights";
import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import { Gray500, Red500, Yellow500 } from "../../../Types/BrandColors";
import OneUptimeDate from "../../../Types/Date";
import IconProp from "../../../Types/Icon/IconProp";
import Timezone from "../../../Types/Timezone";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import { getResourceSentenceName } from "../../../Types/AI/ResourceAiAccessPermissions";
import {
  ALERT_ID,
  DISK_SUBJECT,
  GENERATED_AT,
  INCIDENT_ID,
  INSIGHT_ID,
  NEXT_STEP,
  ONE_OFF_PROBLEM_KEY,
  PREVENTIVE_INSIGHT_TITLE,
  RECURRING_PROBLEM_KEY,
  RECURRING_PROBLEM_TITLE,
  RECURRING_SUBJECT,
  REPORT_FINDING,
  RUN_ID,
  STOPPED_PROBLEM_KEY,
  STOPPED_PROBLEM_TITLE,
  TLDR_FINDING,
  insightOfKind,
  makeEmptyInsights,
  makeInsightList,
  makeInsights,
  makeQuietInsights,
  makeTrend,
  toBody,
} from "./AiActivityInsightsFixtures";

/*
 * The pure half of every AI Insights page: how the dashboard reads what the
 * insights route answers (AiActivityInsights) and every sentence it says
 * about it. The server sends numbers, keys and the system's own names,
 * never prose, so these words are the whole of what a reader sees — and
 * they have to say something worth knowing about the reader's system, not
 * what AI did: "KubePodCrashLooping keeps coming back", "Node node-3 is
 * behind 2 different problems", "OneUptime AI applied a fix on its own". A
 * body from an older or newer server, or a broken one, must never turn into
 * a crash or a sentence about nothing.
 */

// "Now" for the relative times: the fixture's window ends today at noon.
const NOW: Date = new Date("2026-09-30T12:00:00.000Z");

const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

// A pattern that finds a placeholder a sentence forgot to fill.
const UNFILLED_PLACEHOLDER: RegExp = /\{\{|\}\}/;

beforeAll(() => {
  jest.useFakeTimers({ now: NOW });
});

afterAll(() => {
  jest.useRealTimers();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const CLUSTER: AiInsightWordingContext = {
  windowInDays: 30,
  noun: "cluster",
  generatedAt: GENERATED_AT,
};

const INCIDENTS: AiInsightWordingContext = {
  windowInDays: 30,
  noun: "incident",
  subjectKind: "incident",
  generatedAt: GENERATED_AT,
};

const ALERTS: AiInsightWordingContext = {
  windowInDays: 30,
  noun: "alert",
  subjectKind: "alert",
  generatedAt: GENERATED_AT,
};

function insight(
  kind: AiActivityInsightKind,
  overrides: Partial<AiActivityInsight> = {},
): AiActivityInsight {
  return {
    kind,
    tone: AiActivityInsightTone.Pattern,
    count: 1,
    ...overrides,
  };
}

function facts(
  item: AiActivityInsight,
  context: AiInsightWordingContext = CLUSTER,
): string {
  return describeInsightFacts(item, context).join(" ");
}

function recurringProblem(): AiActivityProblem {
  return makeInsights().problems[0]!;
}

function oneOffProblem(): AiActivityProblem {
  return makeInsights().problems[2]!;
}

// The clock the reader reads times in.
function readTimesIn(timezone: string, use12HourFormat: boolean): void {
  jest
    .spyOn(OneUptimeDate, "getCurrentTimezone")
    .mockReturnValue(timezone as Timezone);
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(use12HourFormat);
}

const NIGHTLY: AiActivityTimeOfDay = {
  startHourUtc: 1,
  hours: 3,
  count: 11,
  total: 12,
  days: 9,
  totalDays: 10,
};

describe("parseAiActivityInsights", () => {
  test("reads everything the insights route returns, unchanged", () => {
    expect(parseAiActivityInsights(toBody(makeInsights()))).toEqual(
      makeInsights(),
    );
  });

  test("reads a window where nothing stands out, and one with nothing at all", () => {
    expect(parseAiActivityInsights(toBody(makeQuietInsights()))).toEqual(
      makeQuietInsights(),
    );

    const empty: AiActivityInsights | null = parseAiActivityInsights(
      toBody(makeEmptyInsights()),
    );

    expect(empty).toEqual(makeEmptyInsights());
    expect(hasAiActivity(empty!)).toBe(false);
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
      },
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
      trend: [],
      preventiveInsights: [],
      isPartial: false,
    });
  });

  test("an older server's attention list is not an insight: the page leads with nothing rather than a guess", () => {
    expect(
      parseAiActivityInsights({
        totals: { investigations: 3 },
        attention: [{ kind: "FixesFailed", severity: "High", count: 1 }],
      })!.insights,
    ).toEqual([]);
  });

  test("every count is a whole, non-negative number", () => {
    const parsed: AiActivityInsights = parseAiActivityInsights({
      windowInDays: -14,
      totals: {
        occurrences: 20.7,
        investigations: 7.9,
        completedInvestigations: -3,
        failedInvestigations: "4",
        activeInvestigations: Number.NaN,
        confirmedFindings: Number.POSITIVE_INFINITY,
        rejectedFindings: null,
        problems: Number.POSITIVE_INFINITY,
        recurringProblems: null,
        fixes: 2,
        commands: true,
      },
      fixOutcomes: { total: "lots", verified: 1.5 },
    })!;

    expect(parsed.windowInDays).toBe(30);
    expect(parsed.totals.occurrences).toBe(20);
    expect(parsed.totals.investigations).toBe(7);
    expect(parsed.totals.completedInvestigations).toBe(0);
    expect(parsed.totals.failedInvestigations).toBe(0);
    expect(parsed.totals.activeInvestigations).toBe(0);
    expect(parsed.totals.confirmedFindings).toBe(0);
    expect(parsed.totals.rejectedFindings).toBe(0);
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
      insights: "everything",
      problems: { key: RECURRING_PROBLEM_KEY },
      hotspots: 3,
      trend: null,
      preventiveInsights: true,
    })!;

    expect(parsed.insights).toEqual([]);
    expect(parsed.problems).toEqual([]);
    expect(parsed.hotspots).toEqual([]);
    expect(parsed.trend).toEqual([]);
    expect(parsed.preventiveInsights).toEqual([]);
  });

  describe("insights", () => {
    function readInsights(rows: Array<unknown>): Array<AiActivityInsight> {
      return parseAiActivityInsights({ totals: {}, insights: rows })!.insights;
    }

    test("an insight of a kind or tone this page cannot word is skipped, the rest kept in order", () => {
      expect(
        readInsights([
          { kind: "SomethingNewer", tone: "Critical", count: 1 },
          { kind: "Hotspot", tone: "Urgent", count: 1 },
          { kind: "Hotspot", count: 1 },
          { tone: "Pattern", count: 1 },
          "RecurringProblem",
          null,
          { kind: "FixesAwaitingApproval", tone: "Warning", count: 2 },
          { kind: "RiskSpotted", tone: "Critical", count: 3, title: "x" },
        ]),
      ).toEqual([
        {
          kind: AiActivityInsightKind.FixesAwaitingApproval,
          tone: AiActivityInsightTone.Warning,
          count: 2,
        },
        {
          kind: AiActivityInsightKind.RiskSpotted,
          tone: AiActivityInsightTone.Critical,
          count: 3,
          title: "x",
        },
      ]);
    });

    test("every kind and tone the server sends is one it can word", () => {
      const kinds: Array<AiActivityInsightKind> = Object.values(
        AiActivityInsightKind,
      );
      const tones: Array<AiActivityInsightTone> = Object.values(
        AiActivityInsightTone,
      );

      expect(
        readInsights(
          kinds.map((kind: AiActivityInsightKind, index: number) => {
            return { kind, tone: tones[index % tones.length], count: 1 };
          }),
        ).map((item: AiActivityInsight): string => {
          return item.kind;
        }),
      ).toEqual(kinds);
    });

    test("an insight's subject, evidence, parts and resources are read; rows it cannot name are dropped", () => {
      const [read] = readInsights([
        {
          kind: "Hotspot",
          tone: "Pattern",
          count: 4,
          total: 9,
          problemCount: 2,
          object: { name: "Node", value: "node-3", key: "k8s.node.name" },
          objects: [
            { name: "Pod", value: "web-1" },
            { name: "Pod" },
            "Pod: web-2",
          ],
          monitor: { id: "m1", name: "Disk" },
          service: { id: "s1" },
          monitors: [{ id: "m1", name: "Disk" }, { name: "No id" }],
          subject: { kind: "alert", id: ALERT_ID, number: 812 },
          evidence: [
            { kind: "alert", id: ALERT_ID, number: 812 },
            { kind: "service", id: "x" },
            { kind: "incident" },
            {
              kind: "incident",
              id: INCIDENT_ID,
              numberWithPrefix: "INC-42",
              title: "  ",
            },
          ],
          evidenceCount: 7,
          lastSeenAt: "2026-09-29T22:00:00.000Z",
        },
      ]);

      expect(read).toEqual({
        kind: AiActivityInsightKind.Hotspot,
        tone: AiActivityInsightTone.Pattern,
        count: 4,
        total: 9,
        problemCount: 2,
        lastSeenAt: "2026-09-29T22:00:00.000Z",
        object: { name: "Node", value: "node-3", key: "k8s.node.name" },
        objects: [{ name: "Pod", value: "web-1" }],
        monitor: { id: "m1", name: "Disk" },
        monitors: [{ id: "m1", name: "Disk" }],
        subject: { kind: "alert", id: ALERT_ID, number: 812 },
        evidence: [
          { kind: "alert", id: ALERT_ID, number: 812 },
          { kind: "incident", id: INCIDENT_ID, numberWithPrefix: "INC-42" },
        ],
        evidenceCount: 7,
      });
    });

    test("a recurring problem's finding, next step and time of day are read", () => {
      const [read] = readInsights([
        JSON.parse(
          JSON.stringify(insightOfKind(AiActivityInsightKind.RecurringProblem)),
        ),
      ]);

      expect(read).toEqual(insightOfKind(AiActivityInsightKind.RecurringProblem));
    });

    test("a finding needs its run and its text; a blank next step is no step", () => {
      const [read] = readInsights([
        {
          kind: "RecurringProblem",
          tone: "Critical",
          count: 3,
          finding: { text: TLDR_FINDING },
          nextStep: "   ",
        },
      ]);

      expect(read!.finding).toBeUndefined();
      expect(read!.nextStep).toBeUndefined();
    });

    test("a time of day outside the clock, or of no length, is left out; one longer than a day is a day", () => {
      const timeOfDayOf: (value: unknown) => AiActivityTimeOfDay | undefined = (
        value: unknown,
      ): AiActivityTimeOfDay | undefined => {
        return readInsights([
          {
            kind: "RecurringProblem",
            tone: "Critical",
            count: 3,
            timeOfDay: value,
          },
        ])[0]!.timeOfDay;
      };

      expect(timeOfDayOf({ ...NIGHTLY, startHourUtc: 24 })).toBeUndefined();
      expect(timeOfDayOf({ ...NIGHTLY, startHourUtc: -1 })).toBeUndefined();
      expect(timeOfDayOf({ ...NIGHTLY, startHourUtc: "1" })).toBeUndefined();
      expect(timeOfDayOf({ ...NIGHTLY, hours: 0 })).toBeUndefined();
      expect(timeOfDayOf("01:00")).toBeUndefined();
      expect(timeOfDayOf({ ...NIGHTLY, hours: 30 })!.hours).toBe(24);
      expect(timeOfDayOf({ ...NIGHTLY, startHourUtc: 0 })!.startHourUtc).toBe(
        0,
      );
      expect(timeOfDayOf(NIGHTLY)).toEqual(NIGHTLY);
    });

    test("a reason is read as the code it is; counts that are not numbers are left out", () => {
      const [read] = readInsights([
        {
          kind: "NotInvestigated",
          tone: "Pattern",
          count: 26,
          total: "40",
          verifiedCount: -1,
          reason: "provider_missing",
        },
      ]);

      expect(read).toEqual({
        kind: AiActivityInsightKind.NotInvestigated,
        tone: AiActivityInsightTone.Pattern,
        count: 26,
        reason: "provider_missing",
      });
    });
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

    test("a bare row came up once, with no title, no finding and zero counts", () => {
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
        occurrenceCount: 1,
        recentOccurrenceCount: 0,
        previousOccurrenceCount: 0,
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

    test("a body from before occurrences were counted says how often by its investigated incidents and alerts", () => {
      expect(
        parseAiActivityInsights({
          totals: {},
          problems: [
            {
              key: "problem-4",
              latestSubject: { kind: "alert", id: ALERT_ID },
              investigationCount: 5,
              subjectCount: 4,
            },
          ],
        })!.problems[0]!.occurrenceCount,
      ).toBe(4);
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

    test("objects need a name and a value, keep the label they were read from, and count at least once", () => {
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
                {
                  name: "Node",
                  value: "node-3",
                  key: "k8s.node.name",
                  count: 4,
                },
                { name: "Node", value: "node-4", key: " ", count: 1 },
                "Pod: web-3",
              ],
            },
          ],
        })!.problems[0]!.objects,
      ).toEqual([
        { name: "Pod", value: "web-1", count: 1 },
        { name: "Node", value: "node-3", key: "k8s.node.name", count: 4 },
        { name: "Node", value: "node-4", count: 1 },
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
        {
          name: "Pod",
          value: "web-1",
          key: "k8s.pod.name",
          occurrenceCount: 9,
          investigationCount: 2,
          problemCount: 1,
        },
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
      // A body from before occurrences were counted: its investigations.
      {
        name: "Node",
        value: "node-3",
        occurrenceCount: 3,
        investigationCount: 3,
        problemCount: 0,
      },
      {
        name: "Pod",
        value: "web-1",
        key: "k8s.pod.name",
        occurrenceCount: 9,
        investigationCount: 2,
        problemCount: 1,
      },
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
});

describe("hasAiActivity", () => {
  test("is false for a window with nothing in it", () => {
    expect(hasAiActivity(makeEmptyInsights())).toBe(false);
  });

  test.each([
    ["an investigation", { investigations: 1 }],
    ["a fix", { fixes: 1 }],
    ["a command", { commands: 1 }],
    ["a fix pull request", { fixTasks: 1 }],
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

  test("incidents and alerts that came up with nothing AI did are not activity: the empty state says why", () => {
    const empty: AiActivityInsights = makeEmptyInsights();

    expect(
      hasAiActivity({ ...empty, totals: { ...empty.totals, occurrences: 9 } }),
    ).toBe(false);
  });
});

describe("the page's words", () => {
  test("the title and the empty state's title", () => {
    expect(AI_INSIGHTS_PAGE_TITLE).toBe("AI Insights");
    expect(AI_INSIGHTS_EMPTY_TITLE).toBe("Nothing to show yet");
  });

  test("the subtitle promises what is worth knowing, not a record of AI's work", () => {
    expect(getAiInsightsPageSubtitle("cluster")).toBe(
      "What OneUptime AI found out about this cluster in the last 30 days: what keeps going wrong and why, and what to do about it.",
    );
    expect(getAiInsightsEmptyDescription("Ceph cluster")).toBe(
      "When an alert or incident fires on this Ceph cluster, OneUptime AI investigates it. This page then tells you what keeps coming back and why, what is behind most of the trouble, what AI fixed on its own, and the risks it spots before anything pages.",
    );
  });

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: the subtitle says what the resource is, in sentence case",
    (type: AiResourceType) => {
      const noun: string = getResourceSentenceName(type);
      expect(getAiInsightsPageSubtitle(noun)).toContain(`about this ${noun} `);
      expect(getAiInsightsEmptyDescription(noun)).toContain(
        `fires on this ${noun},`,
      );
    },
  );

  test("the labels over an investigation's own words say whose they are", () => {
    expect(AI_INSIGHTS_FINDING_LABEL).toBe("What OneUptime AI found");
    expect(AI_INSIGHTS_NEXT_STEP_LABEL).toBe("What it suggests");
    expect(AI_INSIGHTS_FROM_REPORT_NOTE).toBe(
      "(from the investigation's report)",
    );
  });
});

describe("how an insight looks", () => {
  test.each([
    [AiActivityInsightTone.Critical, "bg-red-50 text-red-600", "Needs attention now"],
    [AiActivityInsightTone.Warning, "bg-amber-50 text-amber-600", "Worth acting on"],
    [AiActivityInsightTone.Pattern, "bg-indigo-50 text-indigo-600", "Worth knowing"],
    [AiActivityInsightTone.Positive, "bg-green-50 text-green-600", "Good news"],
  ])(
    "a %s insight has its own colour, and says so to a screen reader",
    (tone: AiActivityInsightTone, badgeClassName: string, label: string) => {
      const look: AiInsightLook = getInsightLook(
        insight(AiActivityInsightKind.RecurringProblem, { tone }),
      );

      expect(look.badgeClassName).toBe(badgeClassName);
      expect(look.label).toBe(label);
    },
  );

  test.each([
    [AiActivityInsightKind.RecurringProblem, IconProp.ArrowPath],
    [AiActivityInsightKind.Hotspot, IconProp.MapPin],
    [AiActivityInsightKind.ProblemStopped, IconProp.CheckCircle],
    [AiActivityInsightKind.FixedAutomatically, IconProp.WrenchScrewdriver],
    [AiActivityInsightKind.FixesDidNotHelp, IconProp.ExclaimationCircle],
    [AiActivityInsightKind.FixesAwaitingApproval, IconProp.HandRaised],
    [AiActivityInsightKind.ReadyForAutomaticFixes, IconProp.Bolt],
    [AiActivityInsightKind.NotInvestigated, IconProp.EyeSlash],
    [AiActivityInsightKind.RiskSpotted, IconProp.Eye],
  ])("a %s insight has its own icon", (kind: AiActivityInsightKind, icon: IconProp) => {
    expect(getInsightLook(insight(kind)).icon).toBe(icon);
  });

  test("every kind has an icon of its own: no two kinds look alike", () => {
    const icons: Array<IconProp> = Object.values(AiActivityInsightKind).map(
      (kind: AiActivityInsightKind): IconProp => {
        return getInsightLook(insight(kind)).icon;
      },
    );

    expect(new Set(icons).size).toBe(icons.length);
  });

  test("a tone or kind it does not know looks like a pattern, with a light bulb", () => {
    const look: AiInsightLook = getInsightLook({
      kind: "SomethingNewer" as AiActivityInsightKind,
      tone: "Urgent" as AiActivityInsightTone,
      count: 1,
    });

    expect(look).toEqual({
      icon: IconProp.LightBulb,
      badgeClassName: "bg-indigo-50 text-indigo-600",
      label: "Worth knowing",
    });
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
      {
        kind: "incident",
        id: INCIDENT_ID,
        number: 42,
        numberWithPrefix: "INC-42",
        title: "Checkout down",
      },
      "Incident INC-42: Checkout down",
    ],
    [
      { kind: "alert", id: ALERT_ID, number: 7, title: "Disk full" },
      "Alert #7: Disk full",
    ],
    [{ kind: "alert", id: ALERT_ID, number: 7 }, "Alert #7"],
    [{ kind: "alert", id: ALERT_ID, title: "Disk full" }, "Alert: Disk full"],
    [{ kind: "alert", id: ALERT_ID }, "Alert"],
    [
      { kind: "alert", id: ALERT_ID, numberWithPrefix: "ALT-7" },
      "Alert ALT-7",
    ],
  ] as Array<[AiActivitySubject, string]>)(
    "%j is %s",
    (subject: AiActivitySubject, expected: string) => {
      expect(describeSubject(subject)).toBe(expected);
    },
  );

  test("the short links under an insight name a subject by its number, by its title only without one", () => {
    expect(describeSubjectShort(RECURRING_SUBJECT)).toBe("Incident #42");
    expect(describeSubjectShort(DISK_SUBJECT)).toBe("Alert #812");
    expect(
      describeSubjectShort({
        kind: "incident",
        id: INCIDENT_ID,
        number: 42,
        numberWithPrefix: "INC-42",
        title: "Checkout down",
      }),
    ).toBe("Incident INC-42");
    expect(
      describeSubjectShort({
        kind: "alert",
        id: ALERT_ID,
        title: "Disk full",
      }),
    ).toBe("Alert: Disk full");
  });

  test("a problem is headed by its title, else by its latest incident or alert", () => {
    expect(getProblemTitle(recurringProblem())).toBe(RECURRING_PROBLEM_TITLE);
    expect(getProblemTitle({ ...oneOffProblem(), title: "" })).toBe(
      "Alert #812: Disk almost full on node-3",
    );
  });

  test("a part of the scope is named the way alert titles name it, and the way a sentence does", () => {
    expect(describeObject({ name: "Namespace", value: "checkout" })).toBe(
      "Namespace: checkout",
    );
    expect(describeObject({ name: "Virtual Machine", value: "db-01" })).toBe(
      "Virtual Machine: db-01",
    );
    expect(describeObjectInSentence({ name: "Node", value: "node-3" })).toBe(
      "Node node-3",
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
    expect(
      describeInsightHeadline(
        insight(AiActivityInsightKind.RecurringProblem, {
          title: "<b>{{count}}</b>",
        }),
        CLUSTER,
      ),
    ).toBe("<b>{{count}}</b> keeps coming back");
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

describe("whether a problem is new, or getting worse", () => {
  test(`a problem that started in the last ${AI_ACTIVITY_INSIGHTS_RECENT_WINDOW_IN_DAYS} days is new`, () => {
    const at: (ago: number) => string = (ago: number): string => {
      return new Date(NOW.getTime() - ago).toISOString();
    };

    expect(isNewProblem(at(HOUR), GENERATED_AT)).toBe(true);
    expect(isNewProblem(at(7 * DAY - 1), GENERATED_AT)).toBe(true);
    expect(isNewProblem(at(7 * DAY), GENERATED_AT)).toBe(false);
    expect(isNewProblem(at(20 * DAY), GENERATED_AT)).toBe(false);
  });

  test("without both dates, or with one it cannot read, nothing is new", () => {
    expect(isNewProblem(undefined, GENERATED_AT)).toBe(false);
    expect(isNewProblem(GENERATED_AT, undefined)).toBe(false);
    expect(isNewProblem("yesterday", GENERATED_AT)).toBe(false);
    expect(isNewProblem(GENERATED_AT, "now")).toBe(false);
  });

  test(`a problem is getting worse once it came up ${AI_ACTIVITY_INSIGHTS_RECURRING_ATTENTION_MIN} times this week, more than the week before`, () => {
    expect(isGettingWorse(5, 2)).toBe(true);
    expect(isGettingWorse(3, 0)).toBe(true);
    expect(isGettingWorse(3, 3)).toBe(false);
    expect(isGettingWorse(2, 0)).toBe(false);
    expect(isGettingWorse(4, 9)).toBe(false);
  });

  test("the badge: new first, then getting worse, else none", () => {
    expect(
      getRecurringBadge({
        firstSeenAt: "2026-09-28T01:00:00.000Z",
        recentCount: 5,
        previousCount: 0,
        generatedAt: GENERATED_AT,
      }),
    ).toEqual({ label: "New this week", tone: AiActivityInsightTone.Warning });
    expect(
      getRecurringBadge({
        firstSeenAt: "2026-09-04T01:00:00.000Z",
        recentCount: 5,
        previousCount: 2,
        generatedAt: GENERATED_AT,
      }),
    ).toEqual({ label: "Getting worse", tone: AiActivityInsightTone.Critical });
    expect(
      getRecurringBadge({
        firstSeenAt: "2026-09-04T01:00:00.000Z",
        recentCount: 2,
        previousCount: 4,
        generatedAt: GENERATED_AT,
      }),
    ).toBeNull();
  });

  test("only a problem that keeps coming back wears the badge", () => {
    expect(
      getInsightBadge(
        insightOfKind(AiActivityInsightKind.RecurringProblem),
        CLUSTER,
      ),
    ).toEqual({ label: "Getting worse", tone: AiActivityInsightTone.Critical });

    for (const item of makeInsightList()) {
      if (item.kind !== AiActivityInsightKind.RecurringProblem) {
        expect(
          getInsightBadge(
            { ...item, recentCount: 9, previousCount: 0 },
            CLUSTER,
          ),
        ).toBeNull();
      }
    }
  });
});

describe("each insight's headline: one thing worth knowing, in one line", () => {
  test("the fixture's insights, in the server's order", () => {
    expect(
      makeInsightList().map((item: AiActivityInsight): string => {
        return describeInsightHeadline(item, CLUSTER);
      }),
    ).toEqual([
      `${RECURRING_PROBLEM_TITLE} keeps coming back`,
      "A fix did not solve the problem it was for",
      `Spotted before anything paged: ${PREVENTIVE_INSIGHT_TITLE}`,
      "A fix is waiting for your approval",
      "Node node-3 is behind 2 different problems",
      "OneUptime AI applied a fix on its own",
      `${STOPPED_PROBLEM_TITLE} has stopped`,
    ]);
  });

  test("a problem without a title is still a problem that keeps coming back, or that stopped", () => {
    expect(
      describeInsightHeadline(
        insight(AiActivityInsightKind.RecurringProblem),
        CLUSTER,
      ),
    ).toBe("A problem keeps coming back");
    expect(
      describeInsightHeadline(
        insight(AiActivityInsightKind.ProblemStopped),
        CLUSTER,
      ),
    ).toBe("A problem that kept coming back has stopped");
  });

  test("a hotspot names the service, the monitor or the part behind the trouble", () => {
    expect(
      describeInsightHeadline(
        insight(AiActivityInsightKind.Hotspot, {
          service: { id: "s1", name: "payments" },
          problemCount: 3,
        }),
        INCIDENTS,
      ),
    ).toBe("The payments service is behind 3 different problems");
    expect(
      describeInsightHeadline(
        insight(AiActivityInsightKind.Hotspot, {
          monitor: { id: "m1", name: "Orders DB" },
          problemCount: 2,
        }),
        ALERTS,
      ),
    ).toBe("The Orders DB monitor is behind 2 different problems");
    expect(
      describeInsightHeadline(
        insight(AiActivityInsightKind.Hotspot, {
          object: { name: "Virtual Machine", value: "db-01" },
          problemCount: 1,
        }),
        CLUSTER,
      ),
    ).toBe("Virtual Machine db-01 is behind 1 problem");
    expect(
      describeInsightHeadline(
        insight(AiActivityInsightKind.Hotspot, { problemCount: 2 }),
        CLUSTER,
      ),
    ).toBe("One part is behind 2 different problems");
  });

  test("a service is named before a monitor, a monitor before a part", () => {
    expect(
      describeInsightHeadline(
        insight(AiActivityInsightKind.Hotspot, {
          service: { id: "s1", name: "payments" },
          monitor: { id: "m1", name: "Orders DB" },
          object: { name: "Node", value: "node-3" },
          problemCount: 2,
        }),
        INCIDENTS,
      ),
    ).toBe("The payments service is behind 2 different problems");
  });

  test("fixes are counted in the singular and the plural", () => {
    const say: (kind: AiActivityInsightKind, count: number) => string = (
      kind: AiActivityInsightKind,
      count: number,
    ): string => {
      return describeInsightHeadline(insight(kind, { count }), CLUSTER);
    };

    expect(say(AiActivityInsightKind.FixedAutomatically, 3)).toBe(
      "OneUptime AI applied 3 fixes on its own",
    );
    expect(say(AiActivityInsightKind.FixesDidNotHelp, 2)).toBe(
      "2 fixes did not solve the problems they were for",
    );
    expect(say(AiActivityInsightKind.FixesAwaitingApproval, 4)).toBe(
      "4 fixes are waiting for your approval",
    );
    expect(say(AiActivityInsightKind.ReadyForAutomaticFixes, 4)).toBe(
      "Your team approved every fix OneUptime AI proposed here",
    );
  });

  test("what AI did not look into is said in the product's own noun", () => {
    expect(
      describeInsightHeadline(
        insight(AiActivityInsightKind.NotInvestigated, { count: 26 }),
        INCIDENTS,
      ),
    ).toBe("OneUptime AI did not look into 26 incidents");
    expect(
      describeInsightHeadline(
        insight(AiActivityInsightKind.NotInvestigated, { count: 1 }),
        ALERTS,
      ),
    ).toBe("OneUptime AI did not look into 1 alert");
  });

  test("a kind this page does not know says nothing", () => {
    expect(
      describeInsightHeadline(
        insight("SomethingNewer" as AiActivityInsightKind),
        CLUSTER,
      ),
    ).toBe("");
    expect(
      describeInsightFacts(
        insight("SomethingNewer" as AiActivityInsightKind),
        CLUSTER,
      ),
    ).toEqual([]);
  });
});

describe("the facts under each insight: the numbers behind it, as whole sentences", () => {
  describe("a problem that keeps coming back", () => {
    test("how often, how much of it this week against last, and how much of everything it is", () => {
      expect(
        facts(insightOfKind(AiActivityInsightKind.RecurringProblem)),
      ).toBe(
        "It happened 12 times in the last 30 days. 5 of them were in the last 7 days, up from 2 the 7 days before. That is 12 of the 20 incidents and alerts on this cluster in the last 30 days.",
      );
    });

    test("a problem that started this week says when it started", () => {
      expect(
        facts(
          insight(AiActivityInsightKind.RecurringProblem, {
            count: 4,
            recentCount: 4,
            previousCount: 0,
            firstSeenAt: "2026-09-27T12:00:00.000Z",
          }),
        ),
      ).toBe("It happened 4 times in the last 30 days. It started 3 days ago.");
    });

    test("a problem that is calming down says so", () => {
      expect(
        facts(
          insight(AiActivityInsightKind.RecurringProblem, {
            count: 9,
            recentCount: 1,
            previousCount: 6,
          }),
        ),
      ).toBe(
        "It happened 9 times in the last 30 days. 1 of them was in the last 7 days, down from 6 the 7 days before.",
      );
    });

    test("a steady problem says how much of it was this week; a quiet week says nothing of it", () => {
      expect(
        facts(
          insight(AiActivityInsightKind.RecurringProblem, {
            count: 8,
            recentCount: 3,
            previousCount: 3,
          }),
        ),
      ).toBe(
        "It happened 8 times in the last 30 days. 3 of them were in the last 7 days.",
      );
      expect(
        facts(
          insight(AiActivityInsightKind.RecurringProblem, {
            count: 8,
            recentCount: 0,
            previousCount: 3,
          }),
        ),
      ).toBe("It happened 8 times in the last 30 days.");
    });

    test("its share of everything is said only when it is half or more", () => {
      const share: (count: number, total: number) => string = (
        count: number,
        total: number,
      ): string => {
        return facts(
          insight(AiActivityInsightKind.RecurringProblem, { count, total }),
        );
      };

      expect(share(5, 10)).toContain(
        "That is 5 of the 10 incidents and alerts on this cluster",
      );
      expect(share(4, 10)).not.toContain("That is");
      // All of it: nothing to compare.
      expect(share(10, 10)).not.toContain("That is");
    });

    test("on the incidents' and alerts' pages, the share is of the product's own", () => {
      const item: AiActivityInsight = insight(
        AiActivityInsightKind.RecurringProblem,
        { count: 9, total: 12 },
      );

      expect(facts(item, INCIDENTS)).toContain(
        "That is 9 of the 12 incidents created in the last 30 days.",
      );
      expect(facts(item, ALERTS)).toContain(
        "That is 9 of the 12 alerts created in the last 30 days.",
      );
    });

    test("a window of another length is named by its own length", () => {
      expect(
        facts(insight(AiActivityInsightKind.RecurringProblem, { count: 3 }), {
          ...CLUSTER,
          windowInDays: 14,
        }),
      ).toBe("It happened 3 times in the last 14 days.");
    });
  });

  test("a hotspot: how much of everything it was part of, and where to look first", () => {
    expect(facts(insightOfKind(AiActivityInsightKind.Hotspot))).toBe(
      "It was part of 14 of the 20 incidents and alerts on this cluster in the last 30 days. Problems that share one place often share one cause: look there first.",
    );
    expect(
      facts(
        insight(AiActivityInsightKind.Hotspot, { count: 17, total: 40 }),
        INCIDENTS,
      ),
    ).toBe(
      "It was part of 17 of the 40 incidents created in the last 30 days. Problems that share one place often share one cause: look there first.",
    );
    expect(
      facts(
        insight(AiActivityInsightKind.Hotspot, { count: 1, total: 1 }),
        ALERTS,
      ),
    ).toBe(
      "It was part of 1 of the 1 alert created in the last 30 days. Problems that share one place often share one cause: look there first.",
    );
    expect(facts(insight(AiActivityInsightKind.Hotspot))).toBe(
      "Problems that share one place often share one cause: look there first.",
    );
  });

  test("a problem that stopped: how often it happened, and since when it has not", () => {
    readTimesIn("UTC", false);

    expect(facts(insightOfKind(AiActivityInsightKind.ProblemStopped))).toBe(
      "It happened 6 times, and not once since the fix on 12 Sep. OneUptime AI checked the fix afterwards: the problem was gone.",
    );
    expect(
      facts(insight(AiActivityInsightKind.ProblemStopped, { count: 1 })),
    ).toBe(
      "It happened 1 time, and not once since its fix. OneUptime AI checked the fix afterwards: the problem was gone.",
    );
  });

  test("fixes applied on their own: whether they held, and that nobody had to approve them", () => {
    expect(
      facts(insightOfKind(AiActivityInsightKind.FixedAutomatically)),
    ).toBe(
      "It checked afterwards: the problem was gone. Nobody had to approve it first.",
    );
    expect(
      facts(
        insight(AiActivityInsightKind.FixedAutomatically, {
          count: 3,
          verifiedCount: 3,
        }),
      ),
    ).toBe(
      "It checked each one afterwards: the problem was gone every time. Nobody had to approve them first.",
    );
    expect(
      facts(
        insight(AiActivityInsightKind.FixedAutomatically, {
          count: 3,
          verifiedCount: 2,
        }),
      ),
    ).toBe(
      "2 of them were checked afterwards and solved the problem. Nobody had to approve them first.",
    );
    expect(
      facts(insight(AiActivityInsightKind.FixedAutomatically, { count: 2 })),
    ).toBe("Nobody had to approve them first.");
  });

  test("fixes that did not help: what the check found, out of how many", () => {
    expect(facts(insightOfKind(AiActivityInsightKind.FixesDidNotHelp))).toBe(
      "OneUptime AI checked after it was applied: the problem was still there. That is 1 of the 4 fixes applied in the last 30 days.",
    );
    expect(
      facts(
        insight(AiActivityInsightKind.FixesDidNotHelp, { count: 2, total: 2 }),
      ),
    ).toBe(
      "OneUptime AI checked after they were applied: the problems were still there.",
    );
  });

  test("fixes waiting: they run as soon as someone approves them", () => {
    expect(
      facts(insightOfKind(AiActivityInsightKind.FixesAwaitingApproval)),
    ).toBe("OneUptime AI has it ready: it runs as soon as someone approves it.");
    expect(
      facts(insight(AiActivityInsightKind.FixesAwaitingApproval, { count: 2 })),
    ).toBe(
      "OneUptime AI has them ready: each runs as soon as someone approves it.",
    );
  });

  test("a team that approved every fix: how many, how many held, and what letting AI fix on its own would do", () => {
    expect(
      facts(
        insight(AiActivityInsightKind.ReadyForAutomaticFixes, {
          count: 4,
          verifiedCount: 3,
        }),
      ),
    ).toBe(
      "That is 4 fixes in the last 30 days, and none dismissed. 3 of them were checked afterwards and solved the problem. Let OneUptime AI apply fixes like these on its own, and they run the moment the problem starts.",
    );
    expect(
      facts(
        insight(AiActivityInsightKind.ReadyForAutomaticFixes, { count: 3 }),
      ),
    ).toBe(
      "That is 3 fixes in the last 30 days, and none dismissed. Let OneUptime AI apply fixes like these on its own, and they run the moment the problem starts.",
    );
  });

  test("what AI did not look into: why, in the product's own words, and out of how many", () => {
    expect(
      facts(
        insight(AiActivityInsightKind.NotInvestigated, {
          count: 26,
          total: 40,
          reason: "provider_missing",
        }),
        INCIDENTS,
      ),
    ).toBe(
      "There is no LLM provider OneUptime AI can use. That is 26 of the 40 incidents created in the last 30 days.",
    );
    expect(
      facts(
        insight(AiActivityInsightKind.NotInvestigated, {
          count: 3,
          reason: "automatic_investigation_disabled",
        }),
        ALERTS,
      ),
    ).toBe("Automatic investigation of new alerts is turned off.");
    expect(
      facts(
        insight(AiActivityInsightKind.NotInvestigated, { count: 3 }),
        INCIDENTS,
      ),
    ).toBe("For a reason this page does not know yet.");
  });

  test("a risk spotted before anything paged: how often, how recently, and that nothing paged yet", () => {
    expect(facts(insightOfKind(AiActivityInsightKind.RiskSpotted))).toBe(
      "Seen 3 times so far, last 6 hours ago. OneUptime AI's watch on the telemetry found it; nothing has paged anyone for it yet.",
    );
    expect(
      facts(insight(AiActivityInsightKind.RiskSpotted, { count: 1 })),
    ).toBe(
      "Seen 1 time so far. OneUptime AI's watch on the telemetry found it; nothing has paged anyone for it yet.",
    );
  });

  test.each([
    ["a cluster", CLUSTER],
    ["the incidents", INCIDENTS],
    ["the alerts", ALERTS],
  ] as Array<[string, AiInsightWordingContext]>)(
    "on %s' page, every kind says something, and never leaves a placeholder unfilled",
    (_label: string, context: AiInsightWordingContext) => {
      const counts: Array<number> = [1, 2, 7];

      for (const kind of Object.values(AiActivityInsightKind)) {
        for (const count of counts) {
          const item: AiActivityInsight = insight(kind, {
            count,
            total: count * 2,
            recentCount: count,
            previousCount: 0,
            problemCount: count,
            verifiedCount: count,
            firstSeenAt: "2026-09-27T12:00:00.000Z",
            lastSeenAt: "2026-09-30T06:00:00.000Z",
            fixedAt: "2026-09-12T09:00:00.000Z",
            title: "Disk full",
            object: { name: "Node", value: "node-3" },
            reason: "provider_missing",
          });
          const headline: string = describeInsightHeadline(item, context);
          const said: Array<string> = describeInsightFacts(item, context);

          expect(headline.trim()).not.toBe("");
          expect(headline).not.toMatch(UNFILLED_PLACEHOLDER);
          expect(said.length).toBeGreaterThan(0);

          for (const sentence of said) {
            expect(sentence).not.toMatch(UNFILLED_PLACEHOLDER);
            expect(sentence.endsWith(".")).toBe(true);
          }
        }
      }
    },
  );
});

describe("when a problem tends to happen, in the reader's own time", () => {
  test("in UTC, on a 24-hour clock: most days", () => {
    readTimesIn("UTC", false);

    expect(describeTimeOfDay(NIGHTLY, GENERATED_AT)).toBe(
      "It usually starts between 01:00 and 04:00 (UTC): on 9 of the 10 days it happened.",
    );
  });

  test("every day it happened", () => {
    readTimesIn("UTC", false);

    expect(
      describeTimeOfDay({ ...NIGHTLY, days: 10, totalDays: 10 }, GENERATED_AT),
    ).toBe(
      "It starts between 01:00 and 04:00 (UTC) on every one of the 10 days it happened.",
    );
    expect(
      describeTimeOfDay({ ...NIGHTLY, days: 1, totalDays: 1 }, GENERATED_AT),
    ).toBe("It starts between 01:00 and 04:00 (UTC) on the 1 day it happened.");
  });

  test("in New York, on a 12-hour clock: the evening before, in its own zone", () => {
    readTimesIn("America/New_York", true);

    expect(describeTimeOfDay(NIGHTLY, GENERATED_AT)).toBe(
      "It usually starts between 9:00 PM and 12:00 AM (EDT): on 9 of the 10 days it happened.",
    );
  });

  test("a stretch past midnight ends the next morning", () => {
    readTimesIn("UTC", false);

    expect(
      describeTimeOfDay({ ...NIGHTLY, startHourUtc: 23 }, GENERATED_AT),
    ).toBe(
      "It usually starts between 23:00 and 02:00 (UTC): on 9 of the 10 days it happened.",
    );
  });

  test("the zone is the one in force on the day the insights were made", () => {
    readTimesIn("America/New_York", false);

    // January: standard time.
    expect(
      describeTimeOfDay(NIGHTLY, "2026-01-15T12:00:00.000Z"),
    ).toBe(
      "It usually starts between 20:00 and 23:00 (EST): on 9 of the 10 days it happened.",
    );
  });

  test("an hour of the UTC day as the reader's clock reads it", () => {
    readTimesIn("Asia/Kolkata", false);
    const reference: Date = new Date(GENERATED_AT);

    expect(formatUtcHour(1, reference)).toBe("06:30");
    expect(formatUtcHour(25, reference)).toBe("06:30");
    expect(formatUtcHour(-23, reference)).toBe("06:30");
  });

  test("without a readable date, today's zone is used", () => {
    readTimesIn("UTC", false);

    expect(describeTimeOfDay(NIGHTLY, "not a date")).toBe(
      describeTimeOfDay(NIGHTLY, NOW.toISOString()),
    );
    expect(describeTimeOfDay(NIGHTLY)).toBe(
      describeTimeOfDay(NIGHTLY, NOW.toISOString()),
    );
  });
});

describe("a problem's lines", () => {
  test("how often, how much of it this week, how often investigated, and when last", () => {
    expect(describeProblemCount(recurringProblem())).toBe(
      "12 times · 5 in the last 7 days · investigated 5 times · last seen 10 hours ago",
    );
    expect(describeProblemCount(oneOffProblem())).toBe(
      "1 time · investigated 1 time · last seen 4 days ago",
    );
  });

  test("a problem nobody investigated says only how often, and when", () => {
    expect(
      describeProblemCount({
        ...oneOffProblem(),
        occurrenceCount: 3,
        recentOccurrenceCount: 3,
        investigationCount: 0,
        lastSeenAt: undefined,
      }),
    ).toBe("3 times");
  });

  test("what happened to its fixes, saying only what is not zero", () => {
    expect(describeProblemFixes(recurringProblem())).toBe(
      "3 fixes proposed · 2 applied · 1 verified · 1 did not help · 1 waiting for approval",
    );
    expect(describeProblemFixes(oneOffProblem())).toBeNull();
    expect(
      describeProblemFixes({
        ...oneOffProblem(),
        fixes: {
          proposed: 1,
          applied: 0,
          verified: 0,
          failed: 0,
          awaitingApproval: 0,
        },
      }),
    ).toBe("1 fix proposed");
  });

  test("what people and the grader said of its findings", () => {
    expect(describeProblemVerdicts(recurringProblem())).toBe(
      "your team confirmed 2 findings · your team rejected 1 finding · 2 findings matched the root cause recorded later",
    );
    expect(describeProblemVerdicts(oneOffProblem())).toBeNull();
    expect(
      describeProblemVerdicts({
        ...oneOffProblem(),
        verdicts: {
          confirmed: 1,
          rejected: 0,
          matched: 0,
          partlyMatched: 0,
          mismatched: 3,
        },
      }),
    ).toBe(
      "your team confirmed 1 finding · 3 findings did not match the root cause recorded later",
    );
  });
});

describe("parts and preventive findings", () => {
  test("a part says how many times it came up, in how many problems, and when last", () => {
    expect(describeHotspot(makeInsights().hotspots[0]!)).toBe(
      "14 times · 2 problems · last seen 14 hours ago",
    );
    expect(
      describeHotspot({
        name: "Pod",
        value: "web-1",
        occurrenceCount: 1,
        investigationCount: 1,
        problemCount: 1,
      }),
    ).toBe("1 time · 1 problem");
  });

  test("a preventive finding says how often it was seen, and when last", () => {
    expect(describePreventiveInsight(makeInsights().preventiveInsights[0]!)).toBe(
      "seen 3 times · last seen 6 hours ago",
    );
    expect(
      describePreventiveInsight({
        id: INSIGHT_ID,
        title: PREVENTIVE_INSIGHT_TITLE,
        insightType: "",
        severity: "",
        status: "",
        occurrenceCount: 1,
      }),
    ).toBe("seen 1 time");
    expect(
      describePreventiveInsight({
        id: INSIGHT_ID,
        title: PREVENTIVE_INSIGHT_TITLE,
        insightType: "",
        severity: "",
        status: "",
      }),
    ).toBe("");
  });
});

describe("what went wrong with AI's own work: a footnote, never the headline", () => {
  test("failed investigations, commands no agent ran, and findings people rejected", () => {
    const notes: Array<AiActivityHealthNote> = getActivityHealthNotes(
      makeInsights().totals,
      { windowInDays: 30 },
    );

    expect(notes).toEqual([
      {
        kind: AiActivityHealthKind.InvestigationsFailed,
        sentence: "1 investigation failed or timed out in the last 30 days.",
      },
      {
        kind: AiActivityHealthKind.CommandsTimedOut,
        sentence:
          "1 command OneUptime AI sent was never picked up by the agent.",
      },
      {
        kind: AiActivityHealthKind.FindingsRejected,
        sentence:
          "1 finding was rejected by your team or did not match the root cause recorded later.",
      },
    ]);
  });

  test("in the plural, over the window the server used", () => {
    expect(
      getActivityHealthNotes(
        {
          ...makeInsights().totals,
          failedInvestigations: 4,
          timedOutCommands: 2,
          rejectedFindings: 3,
        },
        { windowInDays: 14 },
      ).map((note: AiActivityHealthNote): string => {
        return note.sentence;
      }),
    ).toEqual([
      "4 investigations failed or timed out in the last 14 days.",
      "2 commands OneUptime AI sent were never picked up by the agent.",
      "3 findings were rejected by your team or did not match the root cause recorded later.",
    ]);
  });

  test("nothing wrong, nothing said", () => {
    expect(
      getActivityHealthNotes(makeQuietInsights().totals, { windowInDays: 30 }),
    ).toEqual([]);
  });

  test("what people confirmed is said once something was confirmed", () => {
    expect(describeFindingsTrust(makeInsights().totals)).toBe(
      "3 findings were confirmed by your team or matched the root cause recorded later.",
    );
    expect(
      describeFindingsTrust({ ...makeInsights().totals, confirmedFindings: 1 }),
    ).toBe(
      "1 finding was confirmed by your team or matched the root cause recorded later.",
    );
    expect(describeFindingsTrust(makeQuietInsights().totals)).toBeNull();
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
    const short: Array<AiActivityTrendDay> = makeTrend().slice(-9);

    expect(getTrendWeeks(short)).toEqual({ thisWeek: 5, lastWeek: 0 });
    expect(getTrendWeeks([])).toEqual({ thisWeek: 0, lastWeek: 0 });
  });

  test("one investigation reads in the singular", () => {
    expect(
      describeTrendWeeks([
        {
          date: "2026-09-30",
          investigations: 1,
          failedInvestigations: 0,
          fixes: 0,
        },
      ]),
    ).toBe("1 investigation in the last 7 days (0 the 7 days before).");
  });

  test("each day says what happened on it, without the fixes for a reader who may not see them", () => {
    const day: AiActivityTrendDay = makeTrend()[29]!;

    expect(describeTrendDay(day)).toBe(
      "2026-09-30: 2 investigations, 1 failed, 1 fixes",
    );
    expect(describeTrendDay(day, { fixesHidden: true })).toBe(
      "2026-09-30: 2 investigations, 1 failed",
    );
  });
});

describe("fixes", () => {
  test("the bar shows where fixes ended up, applied first, and nothing that is zero", () => {
    expect(
      getFixSegments(makeInsights().fixOutcomes).map(
        (segment: AiInsightsFixSegment): string => {
          return `${segment.label}=${segment.value}`;
        },
      ),
    ).toEqual([
      "Applied automatically=1",
      "Applied after approval=1",
      "Waiting for approval=1",
      "Dismissed=1",
    ]);
  });

  test("every outcome has a segment", () => {
    const outcomes: AiActivityFixOutcomes = {
      total: 21,
      planning: 1,
      awaitingApproval: 2,
      appliedAutomatically: 3,
      appliedAfterApproval: 4,
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
      "Applied automatically=3",
      "Applied after approval=4",
      "Waiting for approval=2",
      "Planning=1",
      "Dismissed=5",
      "No fix found=6",
    ]);
  });

  test("verification is said only once something was verified", () => {
    expect(describeFixVerification(makeInsights().fixOutcomes)).toBe(
      "Verification: 1 resolved the problem, 1 did not, 0 still being checked.",
    );
    expect(
      describeFixVerification(makeEmptyInsights().fixOutcomes),
    ).toBeNull();
  });
});

describe("the words are in every Dashboard locale", () => {
  const LOCALES_DIR: string = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
    "Locales",
  );
  const CODES: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    })
    .map((file: string): string => {
      return file.replace(/\.json$/, "");
    });
  // Languages whose "one" form is never shown (see src/Locales/README.md).
  const WITHOUT_ONE: Array<string> = ["ja", "ko", "zh-CN", "zh-TW"];

  function readLocale(code: string): Record<string, unknown> {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
    ) as Record<string, unknown>;
  }

  // The page's own sentences, as their keys: a plural's general form first.
  const SENTENCES: Array<string> = [
    AI_INSIGHTS_EMPTY_TITLE,
    "What OneUptime AI found out about this {{noun}} in the last 30 days: what keeps going wrong and why, and what to do about it.",
    "When an alert or incident fires on this {{noun}}, OneUptime AI investigates it. This page then tells you what keeps coming back and why, what is behind most of the trouble, what AI fixed on its own, and the risks it spots before anything pages.",
    "What OneUptime AI found",
    "The most important first, each with what is behind it and what to do next.",
    "Nothing stands out right now",
    "No problem came back three times or more, no fix needs you, and no risk is waiting. What OneUptime AI looked into is below.",
    "{{title}} keeps coming back",
    "A problem keeps coming back",
    "{{title}} has stopped",
    "{{name}} is behind {{count}} different problems",
    "The {{name}} service is behind {{count}} different problems",
    "The {{name}} monitor is behind {{count}} different problems",
    "OneUptime AI applied {{count}} fixes on its own",
    "{{count}} fixes did not solve the problems they were for",
    "{{count}} fixes are waiting for your approval",
    "Your team approved every fix OneUptime AI proposed here",
    "Spotted before anything paged: {{title}}",
    "It happened {{count}} times in the last {{days}} days.",
    "{{count}} of them were in the last 7 days, up from {{previous}} the 7 days before.",
    "That is {{shown}} of the {{count}} incidents and alerts on this {{noun}} in the last {{days}} days.",
    "It usually starts between {{start}} and {{end}} ({{zone}}): on {{days}} of the {{count}} days it happened.",
    "Problems that share one place often share one cause: look there first.",
    "Let OneUptime AI apply fixes like these on its own, and they run the moment the problem starts.",
    "OneUptime AI's watch on the telemetry found it; nothing has paged anyone for it yet.",
    "Getting worse",
    "New this week",
    "Needs attention now",
    "Worth acting on",
    "Worth knowing",
    "Good news",
    "Behind it:",
    "Review the fix",
    "Choose what AI may fix on its own",
    "Other problems",
    "Where problems happen",
    "Spotted before anything paged",
    "Also spotted before anything paged",
    "What OneUptime AI did here",
    "The last 30 days at a glance. Everything it did, one step at a time, is in AI Logs.",
    "There was more here than these insights read: they cover the newest of it.",
    AI_INSIGHTS_FINDING_LABEL,
    AI_INSIGHTS_NEXT_STEP_LABEL,
    "OneUptime AI is off for this project, so nothing new is investigated or fixed, and nothing new shows up on this page.",
    "Until it has one, nothing new is investigated, so nothing new shows up on this page.",
  ];

  // The plurals among them, whose one form a language may have to say.
  const PLURALS: Array<string> = [
    "{{name}} is behind {{count}} different problems",
    "The {{name}} service is behind {{count}} different problems",
    "OneUptime AI applied {{count}} fixes on its own",
    "{{count}} fixes did not solve the problems they were for",
    "{{count}} fixes are waiting for your approval",
    "It happened {{count}} times in the last {{days}} days.",
    "That is {{shown}} of the {{count}} incidents and alerts on this {{noun}} in the last {{days}} days.",
    "{{count}} times",
    "and {{count}} more",
  ];

  test.each(CODES)("%s has every one, and every plural's one form", (code: string) => {
    const locale: Record<string, unknown> = readLocale(code);

    expect(
      [
        ...SENTENCES,
        ...PLURALS,
        ...PLURALS.map((key: string): string => {
          return `${key}_one`;
        }),
      ].filter((word: string): boolean => {
        return typeof locale[word] !== "string";
      }),
    ).toEqual([]);
  });

  test.each(
    CODES.filter((code: string): boolean => {
      return code !== "en";
    }),
  )("%s says the page's new sentences in its own words", (code: string) => {
    const locale: Record<string, unknown> = readLocale(code);
    const english: Record<string, unknown> = readLocale("en");
    // Translated before this page: some locales still read them in English.
    const OLDER: Array<string> = ["Needs attention now"];

    expect(
      [
        ...SENTENCES.filter((word: string): boolean => {
          return !OLDER.includes(word);
        }),
        ...(WITHOUT_ONE.includes(code)
          ? []
          : PLURALS.map((key: string): string => {
              return `${key}_one`;
            })),
      ].filter((word: string): boolean => {
        return locale[word] === english[word];
      }),
    ).toEqual([]);
  });

  test("English holds each plural's one form under its other form", () => {
    const english: Record<string, unknown> = readLocale("en");

    expect(english["{{name}} is behind {{count}} different problems_one"]).toBe(
      "{{name}} is behind {{count}} problem",
    );
    expect(english["OneUptime AI applied {{count}} fixes on its own_one"]).toBe(
      "OneUptime AI applied a fix on its own",
    );
    expect(
      english["It happened {{count}} times in the last {{days}} days._one"],
    ).toBe("It happened {{count}} time in the last {{days}} days.");
  });

  test("every placeholder of a sentence survives in every locale", () => {
    const PLACEHOLDER: RegExp = /\{\{\s*([^}\s]+)\s*\}\}/g;
    const placeholdersOf: (text: unknown) => string = (
      text: unknown,
    ): string => {
      return [...String(text).matchAll(PLACEHOLDER)]
        .map((match: RegExpMatchArray): string => {
          return match[1]!;
        })
        .sort()
        .join(",");
    };
    const english: Record<string, unknown> = readLocale("en");
    const broken: Array<string> = [];

    for (const code of CODES) {
      const locale: Record<string, unknown> = readLocale(code);

      for (const key of [
        ...SENTENCES,
        ...PLURALS,
        ...PLURALS.map((plural: string): string => {
          return `${plural}_one`;
        }),
      ]) {
        if (placeholdersOf(locale[key]) !== placeholdersOf(english[key])) {
          broken.push(`${code}: ${key}`);
        }
      }
    }

    expect(broken).toEqual([]);
  });
});

describe("the fixture", () => {
  test("tells the story the page suites look for", () => {
    const insights: AiActivityInsights = makeInsights();

    expect(
      insights.insights.map((item: AiActivityInsight): string => {
        return item.kind;
      }),
    ).toEqual([
      AiActivityInsightKind.RecurringProblem,
      AiActivityInsightKind.FixesDidNotHelp,
      AiActivityInsightKind.RiskSpotted,
      AiActivityInsightKind.FixesAwaitingApproval,
      AiActivityInsightKind.Hotspot,
      AiActivityInsightKind.FixedAutomatically,
      AiActivityInsightKind.ProblemStopped,
    ]);
    expect(
      insights.problems.map((problem: AiActivityProblem): string => {
        return problem.key;
      }),
    ).toEqual([RECURRING_PROBLEM_KEY, STOPPED_PROBLEM_KEY, ONE_OFF_PROBLEM_KEY]);
    expect(insights.insights[0]!.nextStep).toBe(NEXT_STEP);
    expect(insights.insights[2]!.insightId).toBe(INSIGHT_ID);
  });
});
