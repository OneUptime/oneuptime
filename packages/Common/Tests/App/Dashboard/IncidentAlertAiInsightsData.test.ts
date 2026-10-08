import {
  AI_INSIGHTS_FIXES_HIDDEN_NOTE,
  AiInsightWordingContext,
  NOT_INVESTIGATED_REASONS,
  describeCoverage,
  describeInsightFacts,
  describeInsightHeadline,
  describeNotInvestigatedReason,
  describeProblemCount,
  describeResourceHotspot,
  describeSubject,
  describeSubjectShort,
  describeTrendDay,
  getFixTaskSegments,
  hasAiActivity,
  parseAiActivityInsights,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsData";
import {
  AI_INSIGHTS_EMPTY_DESCRIPTIONS,
  AI_INSIGHTS_PAGE_SUBTITLES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentAlertAi/IncidentAlertAiInsightsPage";
import {
  AiActivityInsight,
  AiActivityInsightKind,
  AiActivityInsights,
  AiActivityProblem,
} from "../../../Types/AI/AiActivityInsights";
import {
  INCIDENT_ALERT_AI_SUBJECT_KINDS,
  IncidentAlertAiSubjectKind,
} from "../../../Types/AI/IncidentAlertAiLogs";
import { InvestigationNotStartedCode } from "../../../Types/AI/InvestigationNotStartedReason";
import { JSONObject } from "../../../Types/JSON";
import {
  makeInsights as makeClusterInsights,
  toBody as toClusterBody,
} from "./AiActivityInsightsFixtures";
import {
  GENERATED_AT,
  MONITOR_ID,
  MONITOR_NAME,
  NEXT_STEP,
  OTHER_SUBJECT_ID,
  RECURRING_TITLE,
  SERVICE_ID,
  SERVICE_NAME,
  SUBJECT_ID,
  makeIncidentAlertInsightList,
  makeIncidentAlertInsights,
  makeQuietIncidentAlertInsights,
  subjectOf,
  toBody,
} from "./IncidentAlertAiInsightsFixtures";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The words of the Incidents' and Alerts' AI Insights pages. They are every
 * scope's AI Insights words (AiActivityInsightsData, pinned for a cluster
 * and a resource by AiActivityInsightsData.test.ts) plus what only a whole
 * product has: how it reads the sections only these pages' bodies carry,
 * the subject's prefixed number, the insights in the product's own noun
 * ("OneUptime AI did not look into 8 incidents", "The Payments service is
 * behind 2 different problems"), why incidents were skipped, the monitors
 * and services, the fix pull requests and the trend for a reader who may
 * not see fixes - in every Dashboard locale.
 */

const ALL_REASON_CODES: Array<InvestigationNotStartedCode> = [
  "ai_disabled",
  "automatic_investigation_disabled",
  "provider_missing",
  "insufficient_ai_balance",
  "project_daily_limit_reached",
  "no_investigation_rule_matched",
  "severity_below_threshold",
  "monitor_cooldown",
  "created_resolved",
  "daily_budget_exhausted",
  "budget_check_failed",
  "enqueue_failed",
  "eligibility_check_failed",
  "no_run_recorded",
];

// A sentence a reason has to read as: capitalised, one full stop at the end.
const ONE_SENTENCE: RegExp = /^[A-Z].*\.$/;

function parse(body: JSONObject): AiActivityInsights {
  const insights: AiActivityInsights | null = parseAiActivityInsights(body);

  expect(insights).not.toBeNull();

  return insights!;
}

function contextOf(
  subjectKind: IncidentAlertAiSubjectKind,
): AiInsightWordingContext {
  return {
    windowInDays: 30,
    subjectKind,
    noun: subjectKind,
    generatedAt: GENERATED_AT,
  };
}

function insightOf(
  subjectKind: IncidentAlertAiSubjectKind,
  kind: AiActivityInsightKind,
): AiActivityInsight {
  return makeIncidentAlertInsightList(subjectKind).find(
    (item: AiActivityInsight): boolean => {
      return item.kind === kind;
    },
  )!;
}

describe.each(
  INCIDENT_ALERT_AI_SUBJECT_KINDS.map(
    (subjectKind: IncidentAlertAiSubjectKind) => {
      return [subjectKind];
    },
  ),
)("reading the %s insights route's body", (subjectKind: unknown) => {
  const kind: IncidentAlertAiSubjectKind =
    subjectKind as IncidentAlertAiSubjectKind;

  test("reads every section, as the route sends it", () => {
    expect(parse(toBody(makeIncidentAlertInsights(kind)))).toEqual(
      makeIncidentAlertInsights(kind),
    );
  });

  test("a window AI did nothing in reads as nothing to show, with why", () => {
    const insights: AiActivityInsights = parse(
      toBody(makeQuietIncidentAlertInsights(kind)),
    );

    expect(hasAiActivity(insights)).toBe(false);
    expect(insights.coverage).toEqual({
      subjects: 7,
      investigatedSubjects: 0,
      notInvestigated: [{ code: "provider_missing", count: 7 }],
    });
  });

  test("hidden fixes stay hidden", () => {
    const insights: AiActivityInsights = parse(
      toBody(makeIncidentAlertInsights(kind, { fixesHidden: true })),
    );

    expect(insights.fixesHidden).toBe(true);
  });

  test("the subject keeps its prefixed number, in a problem, an insight and its evidence", () => {
    const insights: AiActivityInsights = parse(
      toBody(makeIncidentAlertInsights(kind)),
    );
    const prefixed: string = kind === "incident" ? "INC-42" : "ALT-42";

    expect(insights.problems[0]!.latestSubject.numberWithPrefix).toBe(prefixed);
    expect(insights.insights[0]!.subject?.numberWithPrefix).toBe(prefixed);
    expect(insights.insights[0]!.evidence![0]!.numberWithPrefix).toBe(prefixed);
  });

  test("an insight's monitors, service and reason are read", () => {
    const insights: AiActivityInsights = parse(
      toBody(makeIncidentAlertInsights(kind)),
    );

    expect(insights.insights[0]!.monitors).toEqual([
      { id: MONITOR_ID, name: MONITOR_NAME },
    ]);
    expect(insights.insights[2]!.reason).toBe("provider_missing");
    expect(insights.insights[3]!.service).toEqual({
      id: SERVICE_ID,
      name: SERVICE_NAME,
    });
  });
});

describe("the sections are read defensively", () => {
  function withBody(changes: JSONObject): AiActivityInsights {
    return parse({
      ...toBody(makeIncidentAlertInsights("incident")),
      ...changes,
    });
  }

  test("a section that is not its shape is left out, not invented", () => {
    const insights: AiActivityInsights = withBody({
      subjectKind: "monitor",
      coverage: [],
      monitors: {},
      services: "none",
      fixTaskOutcomes: 3,
      fixesHidden: "true",
    });

    for (const key of [
      "subjectKind",
      "coverage",
      "monitors",
      "services",
      "fixTaskOutcomes",
      "fixesHidden",
    ]) {
      expect(key in insights).toBe(false);
    }
  });

  test("a monitor or service without an id or a name is dropped; counts are never negative", () => {
    const insights: AiActivityInsights = withBody({
      monitors: [
        { id: MONITOR_ID, name: "   " },
        { name: "No id" },
        {
          id: MONITOR_ID,
          name: MONITOR_NAME,
          occurrenceCount: 9.7,
          subjectCount: -2,
          investigationCount: "7",
          problemCount: 1.9,
        },
      ],
      services: [
        {
          id: SERVICE_ID,
          name: SERVICE_NAME,
          subjectCount: 2,
          lastSeenAt: "",
        },
      ],
    });

    expect(insights.monitors).toEqual([
      {
        id: MONITOR_ID,
        name: MONITOR_NAME,
        occurrenceCount: 9,
        subjectCount: 0,
        investigationCount: 0,
        problemCount: 1,
      },
    ]);
    // A body from before occurrences were counted: its investigated ones.
    expect(insights.services).toEqual([
      {
        id: SERVICE_ID,
        name: SERVICE_NAME,
        occurrenceCount: 2,
        subjectCount: 2,
        investigationCount: 0,
        problemCount: 0,
      },
    ]);
  });

  test("a reason without a code or a count is dropped", () => {
    const insights: AiActivityInsights = withBody({
      coverage: {
        subjects: 10,
        investigatedSubjects: -1,
        notInvestigated: [
          { code: "provider_missing", count: 0 },
          { count: 3 },
          { code: "ai_disabled", count: 2 },
          "ai_disabled",
        ],
      },
    });

    expect(insights.coverage).toEqual({
      subjects: 10,
      investigatedSubjects: 0,
      notInvestigated: [{ code: "ai_disabled", count: 2 }],
    });
  });

  test("a problem's monitors are read when sent, and a nameless one dropped", () => {
    const body: JSONObject = toBody(makeIncidentAlertInsights("incident"));
    const problems: Array<JSONObject> = body["problems"] as Array<JSONObject>;
    problems[0]!["monitors"] = [
      { id: MONITOR_ID, name: MONITOR_NAME },
      { id: "x" },
    ];
    delete problems[1]!["monitors"];

    const insights: AiActivityInsights = parse(body);

    expect(insights.problems[0]!.monitors).toEqual([
      { id: MONITOR_ID, name: MONITOR_NAME },
    ]);
    expect("monitors" in insights.problems[1]!).toBe(false);
  });

  test("an insight's blank reason, and a service or monitor it cannot name, are left out", () => {
    const insights: AiActivityInsights = withBody({
      insights: [
        {
          kind: AiActivityInsightKind.NotInvestigated,
          tone: "Pattern",
          count: 2,
          reason: "  ",
        },
        {
          kind: AiActivityInsightKind.Hotspot,
          tone: "Pattern",
          count: 4,
          monitor: { id: MONITOR_ID },
          service: { name: SERVICE_NAME },
        },
      ],
    });

    expect(insights.insights).toEqual([
      {
        kind: AiActivityInsightKind.NotInvestigated,
        tone: "Pattern",
        count: 2,
      },
      { kind: AiActivityInsightKind.Hotspot, tone: "Pattern", count: 4 },
    ]);
  });

  test("the fix pull requests and their total are numbers", () => {
    const insights: AiActivityInsights = withBody({
      fixTaskOutcomes: { total: 3, pullRequestsOpened: "1", failed: -4 },
      totals: {
        ...(toBody(makeIncidentAlertInsights("incident"))[
          "totals"
        ] as JSONObject),
        fixTasks: -1,
      },
    });

    expect(insights.fixTaskOutcomes).toEqual({
      total: 3,
      pullRequestsOpened: 0,
      noFixFound: 0,
      inProgress: 0,
      failed: 0,
      cancelled: 0,
    });
    expect(insights.totals.fixTasks).toBe(0);
  });

  test("a cluster's or a resource's body reads exactly as before", () => {
    const insights: AiActivityInsights = parse(
      toClusterBody(makeClusterInsights()),
    );

    expect(insights).toEqual(makeClusterInsights());

    for (const key of [
      "subjectKind",
      "coverage",
      "monitors",
      "services",
      "fixTaskOutcomes",
      "fixesHidden",
    ]) {
      expect(key in insights).toBe(false);
    }

    expect("fixTasks" in insights.totals).toBe(false);
  });
});

describe("hasAiActivity", () => {
  test("a fix pull request alone is something AI did", () => {
    const quiet: AiActivityInsights =
      makeQuietIncidentAlertInsights("incident");

    expect(hasAiActivity(quiet)).toBe(false);
    expect(
      hasAiActivity({ ...quiet, totals: { ...quiet.totals, fixTasks: 1 } }),
    ).toBe(true);
  });

  test("hidden fixes with nothing else is still nothing to show", () => {
    const quiet: AiActivityInsights = makeQuietIncidentAlertInsights("alert");

    expect(hasAiActivity({ ...quiet, fixesHidden: true })).toBe(false);
  });
});

describe("naming an incident or alert", () => {
  test.each([
    ["incident", "INC-42", "Disk full", "Incident INC-42: Disk full"],
    ["incident", "INC-42", undefined, "Incident INC-42"],
    ["alert", "ALT-7", "Disk full", "Alert ALT-7: Disk full"],
    ["alert", "ALT-7", undefined, "Alert ALT-7"],
  ] as Array<[IncidentAlertAiSubjectKind, string, string | undefined, string]>)(
    "the %s with the prefixed number %s and the title %s reads as %s",
    (
      kind: IncidentAlertAiSubjectKind,
      numberWithPrefix: string,
      title: string | undefined,
      expected: string,
    ) => {
      expect(
        describeSubject({
          kind,
          id: SUBJECT_ID,
          number: 42,
          numberWithPrefix,
          ...(title ? { title } : {}),
        }),
      ).toBe(expected);
    },
  );

  test("without a prefixed number, the plain one, as a cluster's page says it", () => {
    expect(
      describeSubject({
        kind: "incident",
        id: SUBJECT_ID,
        number: 42,
        title: "Disk full",
      }),
    ).toBe("Incident #42: Disk full");
    expect(
      describeSubject({ kind: "alert", id: SUBJECT_ID, title: "Disk full" }),
    ).toBe("Alert: Disk full");
  });

  test("the links under an insight name it by its prefixed number alone", () => {
    expect(describeSubjectShort(subjectOf("incident"))).toBe("Incident INC-42");
    expect(describeSubjectShort(subjectOf("alert"))).toBe("Alert ALT-42");
  });
});

describe("a problem's line on these pages", () => {
  test("how often it came up, this week, how often investigated", () => {
    const problem: AiActivityProblem = {
      ...makeIncidentAlertInsights("incident").problems[0]!,
      lastSeenAt: undefined,
    };

    expect(describeProblemCount(problem)).toBe(
      "12 times · 4 in the last 7 days · investigated 5 times",
    );
  });
});

describe.each(
  INCIDENT_ALERT_AI_SUBJECT_KINDS.map(
    (subjectKind: IncidentAlertAiSubjectKind) => {
      return [subjectKind];
    },
  ),
)("the %s page's insights, in the product's own words", (subjectKind: unknown) => {
  const kind: IncidentAlertAiSubjectKind =
    subjectKind as IncidentAlertAiSubjectKind;
  const plural: string = kind === "incident" ? "incidents" : "alerts";

  test("the headlines, in the server's order", () => {
    expect(
      makeIncidentAlertInsightList(kind).map(
        (item: AiActivityInsight): string => {
          return describeInsightHeadline(item, contextOf(kind));
        },
      ),
    ).toEqual([
      `${RECURRING_TITLE} keeps coming back`,
      "A fix did not solve the problem it was for",
      `OneUptime AI did not look into 8 ${plural}`,
      `The ${SERVICE_NAME} service is behind 2 different problems`,
      "Your team approved every fix OneUptime AI proposed here",
    ]);
  });

  test("a problem that keeps coming back is a share of the product's own", () => {
    expect(
      describeInsightFacts(
        insightOf(kind, AiActivityInsightKind.RecurringProblem),
        contextOf(kind),
      ).join(" "),
    ).toBe(
      `It happened 12 times in the last 30 days. 4 of them were in the last 7 days, up from 1 the 7 days before. That is 12 of the 20 ${plural} created in the last 30 days.`,
    );
  });

  test("what AI did not look into says why, and out of how many", () => {
    expect(
      describeInsightFacts(
        insightOf(kind, AiActivityInsightKind.NotInvestigated),
        contextOf(kind),
      ).join(" "),
    ).toBe(
      `There is no LLM provider OneUptime AI can use. That is 8 of the 20 ${plural} created in the last 30 days.`,
    );
  });

  test("the service behind the trouble was part of how many of them", () => {
    expect(
      describeInsightFacts(
        insightOf(kind, AiActivityInsightKind.Hotspot),
        contextOf(kind),
      ).join(" "),
    ).toBe(
      `It was part of 7 of the 20 ${plural} created in the last 30 days. Problems that share one place often share one cause: look there first.`,
    );
  });

  test("a team that approved every fix is told what letting AI fix on its own would do", () => {
    expect(
      describeInsightFacts(
        insightOf(kind, AiActivityInsightKind.ReadyForAutomaticFixes),
        contextOf(kind),
      ).join(" "),
    ).toBe(
      "That is 4 fixes in the last 30 days, and none dismissed. 3 of them were checked afterwards and solved the problem. Let OneUptime AI apply fixes like these on its own, and they run the moment the problem starts.",
    );
  });

  test("the next step its investigation suggested is the investigation's own words", () => {
    expect(
      insightOf(kind, AiActivityInsightKind.RecurringProblem).nextStep,
    ).toBe(NEXT_STEP);
  });
});

describe("why incidents were not investigated", () => {
  test.each(
    INCIDENT_ALERT_AI_SUBJECT_KINDS.flatMap(
      (subjectKind: IncidentAlertAiSubjectKind) => {
        return ALL_REASON_CODES.map(
          (
            code: InvestigationNotStartedCode,
          ): [IncidentAlertAiSubjectKind, InvestigationNotStartedCode] => {
            return [subjectKind, code];
          },
        );
      },
    ),
  )(
    "a skipped %s's %s is one sentence of its own",
    (
      subjectKind: IncidentAlertAiSubjectKind,
      code: InvestigationNotStartedCode,
    ) => {
      const sentence: string = describeNotInvestigatedReason(subjectKind, code);

      expect(sentence).toBe(NOT_INVESTIGATED_REASONS[subjectKind][code]);
      expect(sentence).toMatch(ONE_SENTENCE);
    },
  );

  test("every reason the server records has a sentence, for both products", () => {
    for (const subjectKind of INCIDENT_ALERT_AI_SUBJECT_KINDS) {
      expect(Object.keys(NOT_INVESTIGATED_REASONS[subjectKind]).sort()).toEqual(
        [...ALL_REASON_CODES].sort(),
      );
    }
  });

  test("an incident or alert created already resolved says so", () => {
    expect(describeNotInvestigatedReason("incident", "created_resolved")).toBe(
      "They were created already resolved.",
    );
    expect(describeNotInvestigatedReason("alert", "created_resolved")).toBe(
      "They were created already resolved.",
    );
  });

  test("a project that reached its own daily AI limit says so", () => {
    expect(
      describeNotInvestigatedReason("incident", "project_daily_limit_reached"),
    ).toBe("The project had reached its own daily AI limit.");
    expect(
      describeNotInvestigatedReason("alert", "project_daily_limit_reached"),
    ).toBe("The project had reached its own daily AI limit.");
  });

  test("only the automatic switch names the product", () => {
    for (const code of ALL_REASON_CODES) {
      const same: boolean =
        NOT_INVESTIGATED_REASONS.incident[code] ===
        NOT_INVESTIGATED_REASONS.alert[code];

      expect(same).toBe(code !== "automatic_investigation_disabled");
    }
  });

  test("a reason a newer server added is still a sentence", () => {
    expect(describeNotInvestigatedReason("incident", "from_the_future")).toBe(
      "For a reason this page does not know yet.",
    );
    expect(describeNotInvestigatedReason("alert", undefined)).toBe(
      "For a reason this page does not know yet.",
    );
  });

  test("a code that names an object's own property is no reason either", () => {
    for (const code of [
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
    ]) {
      expect(describeNotInvestigatedReason("incident", code)).toBe(
        "For a reason this page does not know yet.",
      );
    }
  });
});

describe("the monitors, services, coverage and fix pull requests", () => {
  test.each([
    ["incident", 9, "9 incidents · 1 problem · last seen"],
    ["incident", 1, "1 incident · 1 problem · last seen"],
    ["alert", 9, "9 alerts · 1 problem · last seen"],
    ["alert", 1, "1 alert · 1 problem · last seen"],
  ] as Array<[IncidentAlertAiSubjectKind, number, string]>)(
    "on the %s page, a monitor that came up %s times",
    (
      subjectKind: IncidentAlertAiSubjectKind,
      count: number,
      prefix: string,
    ) => {
      expect(
        describeResourceHotspot(
          {
            id: MONITOR_ID,
            name: MONITOR_NAME,
            occurrenceCount: count,
            subjectCount: 1,
            investigationCount: 7,
            problemCount: 1,
            lastSeenAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          },
          subjectKind,
        ),
      ).toContain(prefix);
    },
  );

  test("a hotspot without a date says nothing about when", () => {
    expect(
      describeResourceHotspot(
        {
          id: SERVICE_ID,
          name: SERVICE_NAME,
          occurrenceCount: 7,
          subjectCount: 2,
          investigationCount: 2,
          problemCount: 2,
        },
        "incident",
      ),
    ).toBe("7 incidents · 2 problems");
  });

  test.each([
    [
      "incident",
      20,
      12,
      "OneUptime AI investigated 12 of the 20 incidents created in the last 30 days.",
    ],
    [
      "incident",
      1,
      0,
      "OneUptime AI investigated 0 of the 1 incident created in the last 30 days.",
    ],
    [
      "alert",
      20,
      12,
      "OneUptime AI investigated 12 of the 20 alerts created in the last 30 days.",
    ],
    [
      "alert",
      1,
      1,
      "OneUptime AI investigated 1 of the 1 alert created in the last 30 days.",
    ],
  ] as Array<[IncidentAlertAiSubjectKind, number, number, string]>)(
    "coverage of %s: %s created, %s investigated",
    (
      subjectKind: IncidentAlertAiSubjectKind,
      subjects: number,
      investigated: number,
      expected: string,
    ) => {
      expect(
        describeCoverage(
          {
            subjects,
            investigatedSubjects: investigated,
            notInvestigated: [],
          },
          subjectKind,
        ),
      ).toBe(expected);
    },
  );

  test("the fix pull requests' bar: opened first, the ones that went nowhere last, no empty segment", () => {
    expect(
      getFixTaskSegments({
        total: 9,
        pullRequestsOpened: 3,
        noFixFound: 2,
        inProgress: 1,
        failed: 2,
        cancelled: 1,
      }).map((segment: { label: string; value: number }) => {
        return [segment.label, segment.value];
      }),
    ).toEqual([
      ["Pull request opened", 3],
      ["In progress", 1],
      ["No fix found", 2],
      ["Failed", 2],
      ["Cancelled", 1],
    ]);
    expect(
      getFixTaskSegments({
        total: 1,
        pullRequestsOpened: 1,
        noFixFound: 0,
        inProgress: 0,
        failed: 0,
        cancelled: 0,
      }),
    ).toHaveLength(1);
  });

  test("a day of the trend leaves the fixes out for a reader who may not see them", () => {
    const day: {
      date: string;
      investigations: number;
      failedInvestigations: number;
      fixes: number;
    } = {
      date: "2026-10-04",
      investigations: 3,
      failedInvestigations: 1,
      fixes: 0,
    };

    expect(describeTrendDay(day)).toBe(
      "2026-10-04: 3 investigations, 1 failed, 0 fixes",
    );
    expect(describeTrendDay(day, { fixesHidden: true })).toBe(
      "2026-10-04: 3 investigations, 1 failed",
    );
  });

  test("hidden fixes say why", () => {
    expect(AI_INSIGHTS_FIXES_HIDDEN_NOTE).toBe(
      "Fix numbers are not shown: seeing them needs permission to read auto-remediation suggestions.",
    );
  });

  test("the other subject's id is not this one's", () => {
    // Guards the fixtures the page suite links by.
    expect(OTHER_SUBJECT_ID).not.toBe(SUBJECT_ID);
  });
});

describe("the pages' own lines", () => {
  test("the subtitles promise what is worth knowing about the product's own", () => {
    expect(AI_INSIGHTS_PAGE_SUBTITLES).toEqual({
      incident:
        "What OneUptime AI found out about your incidents in the last 30 days: what keeps going wrong and why, and what to do about it.",
      alert:
        "What OneUptime AI found out about your alerts in the last 30 days: what keeps going wrong and why, and what to do about it.",
    });
  });

  test("the empty states say what will show up", () => {
    expect(AI_INSIGHTS_EMPTY_DESCRIPTIONS.incident).toBe(
      "When an incident is created, OneUptime AI investigates it. This page then tells you which incidents keep coming back and why, which services are behind most of them, what AI fixed on its own, and what it would fix if you let it.",
    );
    expect(AI_INSIGHTS_EMPTY_DESCRIPTIONS.alert).toBe(
      "When an alert fires, OneUptime AI investigates it. This page then tells you which alerts keep coming back and why, which services are behind most of them, what AI fixed on its own, and what it would fix if you let it.",
    );
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

  // Every sentence above, as its key: a plural's general form and its _one.
  const WORDS: Array<string> = [
    AI_INSIGHTS_FIXES_HIDDEN_NOTE,
    "For a reason this page does not know yet.",
    "Incident {{number}}: {{title}}",
    "Incident {{number}}",
    "Alert {{number}}: {{title}}",
    "Alert {{number}}",
    "{{count}} incidents",
    "{{count}} incidents_one",
    "{{count}} alerts",
    "{{count}} alerts_one",
    "OneUptime AI did not look into {{count}} incidents",
    "OneUptime AI did not look into {{count}} incidents_one",
    "OneUptime AI did not look into {{count}} alerts",
    "OneUptime AI did not look into {{count}} alerts_one",
    "The {{name}} service is behind {{count}} different problems",
    "The {{name}} service is behind {{count}} different problems_one",
    "The {{name}} monitor is behind {{count}} different problems",
    "The {{name}} monitor is behind {{count}} different problems_one",
    "That is {{shown}} of the {{count}} incidents created in the last {{days}} days.",
    "That is {{shown}} of the {{count}} incidents created in the last {{days}} days._one",
    "That is {{shown}} of the {{count}} alerts created in the last {{days}} days.",
    "That is {{shown}} of the {{count}} alerts created in the last {{days}} days._one",
    "It was part of {{shown}} of the {{count}} incidents created in the last {{days}} days.",
    "It was part of {{shown}} of the {{count}} incidents created in the last {{days}} days._one",
    "It was part of {{shown}} of the {{count}} alerts created in the last {{days}} days.",
    "It was part of {{shown}} of the {{count}} alerts created in the last {{days}} days._one",
    "OneUptime AI investigated {{investigated}} of the {{count}} incidents created in the last 30 days.",
    "OneUptime AI investigated {{investigated}} of the {{count}} incidents created in the last 30 days._one",
    "OneUptime AI investigated {{investigated}} of the {{count}} alerts created in the last 30 days.",
    "OneUptime AI investigated {{investigated}} of the {{count}} alerts created in the last 30 days._one",
    "{{date}}: {{investigations}} investigations, {{failed}} failed",
    "Pull request opened",
    "In progress",
    "No fix found",
    "Failed",
    "Cancelled",
    "Monitors that keep failing",
    "Services that keep failing",
    "Choose what AI may fix on its own",
    ...Object.values(AI_INSIGHTS_PAGE_SUBTITLES),
    ...Object.values(AI_INSIGHTS_EMPTY_DESCRIPTIONS),
    ...INCIDENT_ALERT_AI_SUBJECT_KINDS.flatMap(
      (subjectKind: IncidentAlertAiSubjectKind): Array<string> => {
        return Object.values(NOT_INVESTIGATED_REASONS[subjectKind]);
      },
    ),
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

  test.each(
    CODES.filter((code: string): boolean => {
      return code !== "en";
    }),
  )("%s says the new sentences in its own words", (code: string) => {
    const locale: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
    ) as Record<string, unknown>;

    // The sentences these pages added: none is left in English.
    expect(
      [
        "OneUptime AI did not look into {{count}} incidents",
        "OneUptime AI did not look into {{count}} alerts",
        "The {{name}} service is behind {{count}} different problems",
        "That is {{shown}} of the {{count}} incidents created in the last {{days}} days.",
        "It was part of {{shown}} of the {{count}} alerts created in the last {{days}} days.",
        "Choose what AI may fix on its own",
        ...Object.values(AI_INSIGHTS_PAGE_SUBTITLES),
        ...Object.values(AI_INSIGHTS_EMPTY_DESCRIPTIONS),
      ].filter((word: string): boolean => {
        return locale[word] === word;
      }),
    ).toEqual([]);
  });

  test("English holds each new plural's one form under its other form", () => {
    const english: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(
      english["OneUptime AI did not look into {{count}} incidents_one"],
    ).toBe("OneUptime AI did not look into {{count}} incident");
    expect(
      english["The {{name}} service is behind {{count}} different problems_one"],
    ).toBe("The {{name}} service is behind {{count}} problem");
    expect(
      english[
        "That is {{shown}} of the {{count}} alerts created in the last {{days}} days._one"
      ],
    ).toBe(
      "That is {{shown}} of the {{count}} alert created in the last {{days}} days.",
    );
  });
});
