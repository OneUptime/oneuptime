import {
  AI_INSIGHTS_EMPTY_DESCRIPTIONS,
  AI_INSIGHTS_EMPTY_TITLE,
  AI_INSIGHTS_FIXES_HIDDEN_NOTE,
  AI_INSIGHTS_PAGE_SUBTITLES,
  AI_INSIGHTS_PAGE_TITLE,
  AI_INSIGHTS_PARTIAL_NOTE,
  AiInsights,
  AiInsightsAttentionItem,
  AiInsightsAttentionWords,
  COMMANDS_TIMED_OUT_DETAIL,
  NOT_INVESTIGATED_REASONS,
  SEVERITY_LABELS,
  UNTITLED_PROBLEM,
  describeAttentionItem,
  describeNotInvestigatedReason,
  getAppliedFixes,
  getBarHeightPercent,
  getSeverityDotClass,
  getTrendScale,
  hasAiActivity,
  parseAiInsights,
} from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentAlertAi/IncidentAlertAiInsights";
import {
  IncidentAlertAiAttentionKind,
  IncidentAlertAiAttentionSeverity,
} from "../../../Types/AI/IncidentAlertAiInsights";
import {
  INCIDENT_ALERT_AI_SUBJECT_KINDS,
  IncidentAlertAiSubjectKind,
} from "../../../Types/AI/IncidentAlertAiLogs";
import { InvestigationNotStartedCode } from "../../../Types/AI/InvestigationNotStartedReason";
import { JSONObject } from "../../../Types/JSON";
import { PluralTemplate } from "../../../UI/Utils/TranslateTemplate";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The pure half of the Incidents and Alerts AI Insights page: how it reads
 * the insights route's body, and the words for what it shows. The server
 * sends numbers and names; every sentence is the page's own, whole, with a
 * plural form where a count changes it - and in every Dashboard locale.
 */

const INCIDENT_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";

const ALL_REASON_CODES: Array<InvestigationNotStartedCode> = [
  "ai_disabled",
  "automatic_investigation_disabled",
  "provider_missing",
  "insufficient_ai_balance",
  "severity_below_threshold",
  "monitor_cooldown",
  "daily_budget_exhausted",
  "budget_check_failed",
  "enqueue_failed",
  "eligibility_check_failed",
  "no_run_recorded",
];

function body(overrides: JSONObject = {}): JSONObject {
  return {
    subjectKind: "incident",
    windowInDays: 30,
    windowStart: "2026-09-06T00:00:00.000Z",
    generatedAt: "2026-10-05T10:00:00.000Z",
    totals: {
      investigations: 12,
      completedInvestigations: 10,
      failedInvestigations: 2,
      activeInvestigations: 0,
      problems: 4,
      recurringProblems: 2,
      fixes: 5,
      fixTasks: 1,
      commands: 30,
      failedCommands: 2,
      timedOutCommands: 1,
    },
    coverage: {
      subjects: 20,
      investigatedSubjects: 12,
      notInvestigated: [
        { code: "daily_budget_exhausted", count: 6 },
        { code: "severity_below_threshold", count: 2 },
      ],
    },
    attention: [
      {
        kind: IncidentAlertAiAttentionKind.RecurringProblem,
        severity: IncidentAlertAiAttentionSeverity.High,
        count: 5,
        recentCount: 3,
        problemKey: "problem-00000001",
        title: "Disk full",
        subject: { kind: "incident", id: INCIDENT_ID, title: "Disk full" },
      },
    ],
    problems: [
      {
        key: "problem-00000001",
        title: "Disk full",
        investigationCount: 5,
        subjectCount: 4,
        isRecurring: true,
        firstSeenAt: "2026-09-20T00:00:00.000Z",
        lastSeenAt: "2026-10-04T00:00:00.000Z",
        latestSubject: {
          kind: "incident",
          id: INCIDENT_ID,
          title: "Disk full",
          number: 42,
          numberWithPrefix: "INC-42",
        },
        monitors: [{ id: "m1", name: "Database disk" }],
        latestFinding: {
          aiRunId: "run-1",
          text: "Logs filled the disk.",
          at: "2026-10-04T00:01:00.000Z",
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
          verified: 1,
          failed: 0,
          awaitingApproval: 1,
        },
      },
    ],
    monitors: [
      {
        id: "m1",
        name: "Database disk",
        subjectCount: 4,
        investigationCount: 5,
        problemCount: 1,
        lastSeenAt: "2026-10-04T00:00:00.000Z",
      },
    ],
    services: [],
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
    fixTaskOutcomes: {
      total: 1,
      pullRequestsOpened: 1,
      noFixFound: 0,
      inProgress: 0,
      failed: 0,
      cancelled: 0,
    },
    verdicts: {
      confirmed: 1,
      rejected: 0,
      matched: 2,
      partlyMatched: 0,
      mismatched: 0,
    },
    trend: [
      {
        date: "2026-10-04",
        investigations: 3,
        failedInvestigations: 1,
        fixes: 2,
      },
    ],
    isPartial: false,
    ...overrides,
  };
}

function item(
  overrides: Partial<AiInsightsAttentionItem> = {},
): AiInsightsAttentionItem {
  return {
    kind: IncidentAlertAiAttentionKind.FixesFailed,
    severity: IncidentAlertAiAttentionSeverity.High,
    count: 2,
    total: null,
    recentCount: null,
    problemKey: null,
    title: null,
    reason: null,
    monitor: null,
    subject: null,
    ...overrides,
  };
}

function templateOf(words: AiInsightsAttentionWords): PluralTemplate {
  return words.headline.template;
}

describe("parseAiInsights", () => {
  test("reads the shape the route returns", () => {
    const parsed: AiInsights | null = parseAiInsights(body(), "incident");

    expect(parsed?.totals).toEqual({
      investigations: 12,
      completedInvestigations: 10,
      failedInvestigations: 2,
      activeInvestigations: 0,
      problems: 4,
      recurringProblems: 2,
      fixes: 5,
      fixTasks: 1,
      commands: 30,
      failedCommands: 2,
      timedOutCommands: 1,
    });
    expect(parsed?.coverage.notInvestigated).toEqual([
      { code: "daily_budget_exhausted", count: 6 },
      { code: "severity_below_threshold", count: 2 },
    ]);
    expect(parsed?.attention).toEqual([
      {
        kind: IncidentAlertAiAttentionKind.RecurringProblem,
        severity: IncidentAlertAiAttentionSeverity.High,
        count: 5,
        total: null,
        recentCount: 3,
        problemKey: "problem-00000001",
        title: "Disk full",
        reason: null,
        monitor: null,
        subject: {
          kind: "incident",
          id: INCIDENT_ID,
          title: "Disk full",
          number: null,
          numberWithPrefix: null,
        },
      },
    ]);
    expect(parsed?.problems[0]).toMatchObject({
      key: "problem-00000001",
      title: "Disk full",
      isRecurring: true,
      latestFinding: { text: "Logs filled the disk." },
      monitors: [{ id: "m1", name: "Database disk" }],
    });
    expect(parsed?.monitors).toHaveLength(1);
    expect(parsed?.fixOutcomes?.appliedAutomatically).toBe(2);
    expect(parsed?.fixTaskOutcomes.pullRequestsOpened).toBe(1);
    expect(parsed?.trend).toEqual([
      {
        date: "2026-10-04",
        investigations: 3,
        failedInvestigations: 1,
        fixes: 2,
      },
    ]);
    expect(parsed?.isPartial).toBe(false);
  });

  test("is null for a body that is not insights at all", () => {
    expect(parseAiInsights(null, "incident")).toBeNull();
    expect(parseAiInsights([], "incident")).toBeNull();
    expect(parseAiInsights({ entries: [] }, "incident")).toBeNull();
  });

  test("hidden fixes stay hidden: no numbers, not zeros", () => {
    const parsed: AiInsights | null = parseAiInsights(
      body({
        totals: { ...(body()["totals"] as JSONObject), fixes: null },
        fixOutcomes: null,
      }),
      "incident",
    );

    expect(parsed?.totals.fixes).toBeNull();
    expect(parsed?.fixOutcomes).toBeNull();
  });

  test("a number that is missing, negative or not a number counts as none", () => {
    const parsed: AiInsights | null = parseAiInsights(
      { totals: { investigations: -3, problems: "4", recurringProblems: 2.7 } },
      "incident",
    );

    expect(parsed?.totals.investigations).toBe(0);
    expect(parsed?.totals.problems).toBe(0);
    expect(parsed?.totals.recurringProblems).toBe(2);
    expect(parsed?.coverage).toEqual({
      subjects: 0,
      investigatedSubjects: 0,
      notInvestigated: [],
    });
    expect(parsed?.windowInDays).toBe(30);
  });

  test("drops what it cannot show: an unknown attention kind, a problem without a subject, a nameless hotspot, a dateless day", () => {
    const parsed: AiInsights | null = parseAiInsights(
      body({
        attention: [
          { kind: "Postmortems", severity: "High", count: 1 },
          {
            kind: IncidentAlertAiAttentionKind.FixesFailed,
            severity: "Urgent",
          },
          {
            kind: IncidentAlertAiAttentionKind.FixesFailed,
            severity: IncidentAlertAiAttentionSeverity.High,
            count: 1,
          },
        ],
        problems: [{ key: "p", title: "No subject" }],
        monitors: [{ id: "m2" }],
        trend: [{ investigations: 3 }],
        coverage: {
          notInvestigated: [
            { code: "provider_missing", count: 0 },
            { count: 2 },
          ],
        },
      }),
      "incident",
    );

    expect(parsed?.attention).toHaveLength(1);
    expect(parsed?.problems).toEqual([]);
    expect(parsed?.monitors).toEqual([]);
    expect(parsed?.trend).toEqual([]);
    expect(parsed?.coverage.notInvestigated).toEqual([]);
  });

  test("a subject of the other product is no subject", () => {
    const parsed: AiInsights | null = parseAiInsights(body(), "alert");

    expect(parsed?.problems).toEqual([]);
    expect(parsed?.attention[0]?.subject).toBeNull();
  });
});

describe("hasAiActivity", () => {
  test("is true once AI investigated, fixed or opened a pull request", () => {
    const parsed: AiInsights = parseAiInsights(body(), "incident")!;

    expect(hasAiActivity(parsed)).toBe(true);

    const quiet: AiInsights = {
      ...parsed,
      totals: {
        ...parsed.totals,
        investigations: 0,
        fixes: 0,
        fixTasks: 0,
      },
    };

    expect(hasAiActivity(quiet)).toBe(false);
    expect(
      hasAiActivity({ ...quiet, totals: { ...quiet.totals, fixes: null } }),
    ).toBe(false);
    expect(
      hasAiActivity({ ...quiet, totals: { ...quiet.totals, fixTasks: 1 } }),
    ).toBe(true);
    expect(
      hasAiActivity({ ...quiet, totals: { ...quiet.totals, fixes: 1 } }),
    ).toBe(true);
  });
});

describe("describeAttentionItem", () => {
  test.each(INCIDENT_ALERT_AI_SUBJECT_KINDS)(
    "every kind has a headline with a one and an other form, for %ss",
    (subjectKind: IncidentAlertAiSubjectKind) => {
      for (const kind of Object.values(IncidentAlertAiAttentionKind)) {
        const words: AiInsightsAttentionWords = describeAttentionItem(
          item({ kind, total: 3, recentCount: 2, reason: "provider_missing" }),
          subjectKind,
        );

        expect(templateOf(words).one).toContain("{{count}}");
        expect(templateOf(words).other).toContain("{{count}}");
        expect(templateOf(words).one).not.toBe(templateOf(words).other);
      }
    },
  );

  test("fixes that did not work say out of how many were applied", () => {
    const words: AiInsightsAttentionWords = describeAttentionItem(
      item({ count: 1, total: 4 }),
      "incident",
    );

    expect(words.headline).toEqual({
      template: {
        one: "{{count}} fix OneUptime AI applied did not fix the problem",
        other: "{{count}} fixes OneUptime AI applied did not fix the problem",
      },
      count: 1,
      values: {},
    });
    expect(words.detail).toEqual({
      template: {
        one: "Out of {{count}} fix applied in the last 30 days.",
        other: "Out of {{count}} fixes applied in the last 30 days.",
      },
      count: 4,
      values: {},
    });
    expect(describeAttentionItem(item(), "incident").detail).toBeNull();
  });

  test("skipped investigations name the product and the reason", () => {
    const incidentWords: AiInsightsAttentionWords = describeAttentionItem(
      item({
        kind: IncidentAlertAiAttentionKind.InvestigationsNotStarted,
        reason: "daily_budget_exhausted",
      }),
      "incident",
    );
    const alertWords: AiInsightsAttentionWords = describeAttentionItem(
      item({
        kind: IncidentAlertAiAttentionKind.InvestigationsNotStarted,
        reason: "automatic_investigation_disabled",
      }),
      "alert",
    );

    expect(incidentWords.headline.template.other).toBe(
      "{{count}} incidents were not investigated",
    );
    expect(incidentWords.detail).toEqual({
      text: "The daily AI token limit was reached.",
    });
    expect(alertWords.headline.template.other).toBe(
      "{{count}} alerts were not investigated",
    );
    expect(alertWords.detail).toEqual({
      text: "Automatic investigation of new alerts is turned off.",
    });
  });

  test("a recurring problem is named, with how many times recently", () => {
    const words: AiInsightsAttentionWords = describeAttentionItem(
      item({
        kind: IncidentAlertAiAttentionKind.RecurringProblem,
        count: 5,
        recentCount: 3,
        title: "Disk full",
      }),
      "incident",
    );

    expect(words.headline.values).toEqual({ title: "Disk full" });
    expect(words.headline.count).toBe(5);
    expect(words.detail).toMatchObject({ count: 3 });

    const untitled: AiInsightsAttentionWords = describeAttentionItem(
      item({
        kind: IncidentAlertAiAttentionKind.RecurringProblem,
        recentCount: 0,
      }),
      "incident",
    );

    // Untranslated here; the page draws it in the reader's language.
    expect(untitled.headline.values["title"]).toEqual({
      translatableTerm: UNTITLED_PROBLEM,
      inSentence: true,
    });
    expect(UNTITLED_PROBLEM).toBe("this problem");
    expect(untitled.detail).toBeNull();
  });

  test("timed-out commands say what to check", () => {
    expect(
      describeAttentionItem(
        item({ kind: IncidentAlertAiAttentionKind.CommandsTimedOut }),
        "alert",
      ).detail,
    ).toEqual({ text: COMMANDS_TIMED_OUT_DETAIL });
  });

  test("a monitor hotspot names the monitor and how many investigations it was behind", () => {
    const words: AiInsightsAttentionWords = describeAttentionItem(
      item({
        kind: IncidentAlertAiAttentionKind.MonitorHotspot,
        count: 6,
        total: 10,
        monitor: { id: "m1", name: "API latency" },
      }),
      "incident",
    );

    expect(words.headline.values).toEqual({ name: "API latency" });
    expect(words.detail).toMatchObject({ count: 10 });
  });

  test("failed investigations and rejected findings", () => {
    expect(
      describeAttentionItem(
        item({
          kind: IncidentAlertAiAttentionKind.InvestigationsFailed,
          total: 9,
        }),
        "incident",
      ).detail,
    ).toMatchObject({ count: 9 });
    expect(
      describeAttentionItem(
        item({ kind: IncidentAlertAiAttentionKind.FindingsRejected }),
        "incident",
      ).detail,
    ).toBeNull();
    expect(
      describeAttentionItem(
        item({ kind: IncidentAlertAiAttentionKind.FixesAwaitingApproval }),
        "incident",
      ).headline.template.other,
    ).toBe("{{count}} fixes are waiting for approval");
  });
});

describe("why incidents were not investigated", () => {
  test.each(INCIDENT_ALERT_AI_SUBJECT_KINDS)(
    "every reason has a sentence of its own, for %ss",
    (subjectKind: IncidentAlertAiSubjectKind) => {
      expect(Object.keys(NOT_INVESTIGATED_REASONS[subjectKind]).sort()).toEqual(
        [...ALL_REASON_CODES].sort(),
      );

      for (const code of ALL_REASON_CODES) {
        expect(describeNotInvestigatedReason(subjectKind, code)).toMatch(/\.$/);
      }
    },
  );

  test("a reason a newer server added is still a sentence", () => {
    expect(describeNotInvestigatedReason("incident", "new_reason")).toBe(
      "For a reason this page does not know yet.",
    );
    expect(describeNotInvestigatedReason("alert", null)).toBe(
      "For a reason this page does not know yet.",
    );
  });

  test("the product shows where it matters", () => {
    expect(
      describeNotInvestigatedReason(
        "incident",
        "automatic_investigation_disabled",
      ),
    ).toContain("incidents");
    expect(
      describeNotInvestigatedReason(
        "alert",
        "automatic_investigation_disabled",
      ),
    ).toContain("alerts");
  });
});

describe("the trend and the dots", () => {
  test("bars are scaled to the busiest day, and a quiet window stays flat", () => {
    expect(getTrendScale([])).toBe(1);
    expect(
      getTrendScale([
        { date: "a", investigations: 3, failedInvestigations: 0, fixes: 1 },
        { date: "b", investigations: 1, failedInvestigations: 0, fixes: 7 },
      ]),
    ).toBe(7);
    expect(getBarHeightPercent(0, 10)).toBe(0);
    expect(getBarHeightPercent(10, 10)).toBe(100);
    expect(getBarHeightPercent(5, 10)).toBe(50);
    // A day with anything at all stays visible.
    expect(getBarHeightPercent(1, 1000)).toBe(4);
    expect(getBarHeightPercent(3, 0)).toBe(0);
  });

  test("each severity has a colour and a name", () => {
    expect(getSeverityDotClass(IncidentAlertAiAttentionSeverity.High)).toBe(
      "bg-rose-500",
    );
    expect(getSeverityDotClass(IncidentAlertAiAttentionSeverity.Medium)).toBe(
      "bg-amber-500",
    );
    expect(getSeverityDotClass(IncidentAlertAiAttentionSeverity.Low)).toBe(
      "bg-gray-400",
    );
    expect(Object.keys(SEVERITY_LABELS).sort()).toEqual(
      Object.values(IncidentAlertAiAttentionSeverity).sort(),
    );
  });

  test("applied fixes are the automatic ones and the approved ones", () => {
    expect(
      getAppliedFixes(parseAiInsights(body(), "incident")!.fixOutcomes!),
    ).toBe(3);
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

  const PLURALS: Array<PluralTemplate> =
    INCIDENT_ALERT_AI_SUBJECT_KINDS.flatMap(
      (subjectKind: IncidentAlertAiSubjectKind): Array<PluralTemplate> => {
        return Object.values(IncidentAlertAiAttentionKind).flatMap(
          (kind: IncidentAlertAiAttentionKind): Array<PluralTemplate> => {
            const words: AiInsightsAttentionWords = describeAttentionItem(
              item({ kind, total: 2, recentCount: 2 }),
              subjectKind,
            );

            return [
              words.headline.template,
              ...(words.detail && "template" in words.detail
                ? [words.detail.template]
                : []),
            ];
          },
        );
      },
    );

  const WORDS: Array<string> = [
    AI_INSIGHTS_PAGE_TITLE,
    AI_INSIGHTS_EMPTY_TITLE,
    AI_INSIGHTS_PARTIAL_NOTE,
    AI_INSIGHTS_FIXES_HIDDEN_NOTE,
    COMMANDS_TIMED_OUT_DETAIL,
    UNTITLED_PROBLEM,
    describeNotInvestigatedReason("incident", "a_reason_from_later"),
    ...Object.values(AI_INSIGHTS_PAGE_SUBTITLES),
    ...Object.values(AI_INSIGHTS_EMPTY_DESCRIPTIONS),
    ...Object.values(SEVERITY_LABELS),
    ...INCIDENT_ALERT_AI_SUBJECT_KINDS.flatMap(
      (subjectKind: IncidentAlertAiSubjectKind): Array<string> => {
        return Object.values(NOT_INVESTIGATED_REASONS[subjectKind]);
      },
    ),
    ...PLURALS.map((template: PluralTemplate): string => {
      return template.other;
    }),
    ...PLURALS.map((template: PluralTemplate): string => {
      return `${template.other}_one`;
    }),
  ];

  test.each(CODES)("%s has every one", (code: string) => {
    const locale: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
    ) as Record<string, unknown>;

    expect(
      WORDS.filter((word: string): boolean => {
        return typeof locale[word] !== "string";
      }),
    ).toEqual([]);
  });

  test("English holds each plural's one form under its other form", () => {
    const english: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
    ) as Record<string, unknown>;

    for (const template of PLURALS) {
      expect(english[`${template.other}_one`]).toBe(template.one);
    }
  });
});
