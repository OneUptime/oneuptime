import { describe, expect, test } from "@jest/globals";
import { describeTrendDate } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsData";
import {
  AiResultsBreakdown,
  AiResultsCard,
  AiResultsCardKind,
  AiResultsModelRow,
  AiResultsSegment,
  AiResultsWeekBar,
  FIXES_BY_MODEL_NOTE,
  MODEL_CHANGE_TEMPLATE,
  describeModelChanges,
  describeModelResult,
  getAiResultsCards,
  getByModel,
  parseAiOutcomes,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Results/AiResultsData";
import {
  AI_OUTCOMES_PART_OUTCOMES,
  AI_OUTCOMES_UNKNOWN_MODEL,
  AiOutcomes,
  AiOutcomesModels,
  AiOutcomesPart,
} from "../../../Types/AI/AiOutcomes";
import { JSONObject } from "../../../Types/JSON";
import { makeModels, makeOutcomes, toBody } from "./AiResultsFixtures";

/*
 * AI RESULTS BY MODEL, AND WHAT EACH NUMBER OPENS (issues #7762, #7768), in
 * the page's own words and numbers (AiResultsData): the server's models
 * read defensively; By model on Root Causes Confirmed and Fixes Verified,
 * shown once two models ran; the weeks investigations moved to another
 * model marked on every card; and every part of every breakdown naming the
 * records it opens. English here: no i18next is set up.
 */

function cardOf(outcomes: AiOutcomes, kind: AiResultsCardKind): AiResultsCard {
  const card: AiResultsCard | undefined = getAiResultsCards(outcomes).find(
    (candidate: AiResultsCard): boolean => {
      return candidate.kind === kind;
    },
  );

  if (!card) {
    throw new Error(`No ${kind} card.`);
  }

  return card;
}

function rowsOf(card: AiResultsCard): Array<[string | null, number, number]> {
  return (card.byModel?.rows || []).map(
    (row: AiResultsModelRow): [string | null, number, number] => {
      return [row.modelName, row.value, row.total];
    },
  );
}

function withModels(models: AiOutcomesModels | null): AiOutcomes {
  return makeOutcomes({ models });
}

describe("parseAiOutcomes: the models", () => {
  test("read as the server sent them", () => {
    const outcomes: AiOutcomes = withModels(makeModels());

    expect(parseAiOutcomes(toBody(outcomes))).toEqual(outcomes);
  });

  test("none sent, or null: no models, and the page still draws", () => {
    const body: JSONObject = toBody(makeOutcomes());
    delete body["models"];

    expect(parseAiOutcomes(body)!.models).toBeNull();
    expect(parseAiOutcomes(toBody(withModels(null)))!.models).toBeNull();
  });

  test.each([
    ["not an object", "chat-large"],
    ["no root causes", { fixes: [], changes: [] }],
    ["no fixes", { rootCauses: [], changes: [] }],
    ["no changes", { rootCauses: [], fixes: [] }],
    [
      "a result without a name",
      { rootCauses: [{ value: 1, total: 2 }], fixes: [], changes: [] },
    ],
    [
      "a result with more value than total",
      {
        rootCauses: [{ modelName: "chat-large", value: 3, total: 2 }],
        fixes: [],
        changes: [],
      },
    ],
    [
      "a negative count",
      {
        rootCauses: [],
        fixes: [{ modelName: "chat-large", value: -1, total: 2 }],
        changes: [],
      },
    ],
    [
      "a change on no week",
      {
        rootCauses: [],
        fixes: [],
        changes: [{ weekStart: "17 Oct", modelName: "chat-large" }],
      },
    ],
    [
      "a change to no model",
      {
        rootCauses: [],
        fixes: [],
        changes: [{ weekStart: "2026-10-17", modelName: "" }],
      },
    ],
  ])(
    "%s: no models, and the rest of the page as sent",
    (_name: string, models: unknown) => {
      const body: JSONObject = toBody(makeOutcomes());
      body["models"] = models as JSONObject;

      const parsed: AiOutcomes | null = parseAiOutcomes(body);

      expect(parsed).not.toBeNull();
      expect(parsed!.models).toBeNull();
      expect(parsed!.rootCauses).toEqual(makeOutcomes().rootCauses);
    },
  );

  test("work done before models were recorded keeps its empty name", () => {
    expect(
      parseAiOutcomes(toBody(withModels(makeModels())))!.models!.rootCauses[2],
    ).toEqual({ modelName: AI_OUTCOMES_UNKNOWN_MODEL, value: 1, total: 3 });
  });
});

describe("By model", () => {
  test("Root Causes Confirmed: each model's confirmed of judged, work with no model recorded as itself", () => {
    const card: AiResultsCard = cardOf(
      withModels(makeModels()),
      AiResultsCardKind.RootCausesConfirmed,
    );

    expect(rowsOf(card)).toEqual([
      ["chat-large", 6, 8],
      ["chat-medium", 4, 5],
      [null, 1, 3],
    ]);
    expect(card.byModel!.note).toBeUndefined();
  });

  test("Fixes Verified: the fixes that came from an investigation, by its model, and a line that says so", () => {
    const card: AiResultsCard = cardOf(
      withModels(makeModels()),
      AiResultsCardKind.FixesVerified,
    );

    expect(rowsOf(card)).toEqual([
      ["chat-large", 4, 5],
      ["chat-medium", 2, 4],
    ]);
    expect(card.byModel!.note).toBe(FIXES_BY_MODEL_NOTE);
  });

  test("Pages Avoided is not counted by model", () => {
    expect(
      cardOf(withModels(makeModels()), AiResultsCardKind.PagesAvoided).byModel,
    ).toBeNull();
  });

  test("a reader who may not see models: no By model anywhere", () => {
    for (const card of getAiResultsCards(withModels(null))) {
      expect({ kind: card.kind, byModel: card.byModel }).toEqual({
        kind: card.kind,
        byModel: null,
      });
    }
  });

  test("only once two models ran: one model alone, with or without work from before models were recorded, compares with nothing", () => {
    expect(
      getByModel([{ modelName: "chat-large", value: 3, total: 4 }]),
    ).toBeNull();
    expect(
      getByModel([
        { modelName: "chat-large", value: 3, total: 4 },
        { modelName: AI_OUTCOMES_UNKNOWN_MODEL, value: 9, total: 12 },
      ]),
    ).toBeNull();
    expect(getByModel([])).toBeNull();
    expect(getByModel(undefined)).toBeNull();
  });

  test("a model with nothing counted is not one that ran here", () => {
    expect(
      getByModel([
        { modelName: "chat-large", value: 3, total: 4 },
        { modelName: "chat-medium", value: 0, total: 0 },
      ]),
    ).toBeNull();
    expect(
      getByModel([
        { modelName: "chat-large", value: 3, total: 4 },
        { modelName: "chat-medium", value: 0, total: 1 },
        { modelName: "reasoning-small", value: 0, total: 0 },
      ])!.rows,
    ).toEqual([
      { modelName: "chat-large", value: 3, total: 4 },
      { modelName: "chat-medium", value: 0, total: 1 },
    ]);
  });

  test("a card with nothing counted yet shows no By model", () => {
    const outcomes: AiOutcomes = withModels(makeModels());
    outcomes.rootCauses = {
      confirmed: 0,
      partial: 0,
      wrong: 0,
      judgedByPeople: 0,
      completed: 4,
    };

    expect(
      cardOf(outcomes, AiResultsCardKind.RootCausesConfirmed).byModel,
    ).toBeNull();
  });

  test("a model's line is its count out of its total", () => {
    expect(
      describeModelResult({ modelName: "chat-large", value: 23, total: 27 }),
    ).toBe("23 of 27");
  });
});

describe("the weeks investigations moved to another model", () => {
  test("marked on every card's bar of that week, and said in words", () => {
    const outcomes: AiOutcomes = withModels(makeModels());
    const sentence: string = MODEL_CHANGE_TEMPLATE.replace(
      "{{date}}",
      describeTrendDate("2026-10-17"),
    ).replace("{{model}}", "chat-medium");

    for (const card of getAiResultsCards(outcomes)) {
      const marked: Array<AiResultsWeekBar> = card.weeks.filter(
        (week: AiResultsWeekBar): boolean => {
          return Boolean(week.modelChange);
        },
      );

      expect({
        kind: card.kind,
        weeks: marked.map((week: AiResultsWeekBar): string => {
          return week.weekStart;
        }),
      }).toEqual({ kind: card.kind, weeks: ["2026-10-17"] });
      expect(marked[0]!.modelChange).toBe(sentence);
      expect(card.modelChanges).toEqual([sentence]);
    }

    expect(sentence).toBe(
      `From the week of ${describeTrendDate("2026-10-17")}, most investigations ran on chat-medium.`,
    );
  });

  test("a week's own words stay whole beside the mark", () => {
    const marked: AiResultsWeekBar = cardOf(
      withModels(makeModels()),
      AiResultsCardKind.RootCausesConfirmed,
    ).weeks.find((week: AiResultsWeekBar): boolean => {
      return week.weekStart === "2026-10-17";
    })!;
    const unmarked: AiResultsWeekBar = cardOf(
      withModels(null),
      AiResultsCardKind.RootCausesConfirmed,
    ).weeks.find((week: AiResultsWeekBar): boolean => {
      return week.weekStart === "2026-10-17";
    })!;

    expect(marked.description).toBe(unmarked.description);
    expect(unmarked.modelChange).toBeUndefined();
  });

  test("no models, or no change: nothing marked, nothing said", () => {
    for (const models of [null, makeModels({ changes: [] })]) {
      for (const card of getAiResultsCards(withModels(models))) {
        expect(card.modelChanges).toEqual([]);
        expect(
          card.weeks.some((week: AiResultsWeekBar): boolean => {
            return Boolean(week.modelChange);
          }),
        ).toBe(false);
      }
    }
  });

  test("several changes, oldest first", () => {
    expect(
      describeModelChanges([
        { weekStart: "2026-09-05", modelName: "chat-medium" },
        { weekStart: "2026-10-31", modelName: "chat-large" },
      ]),
    ).toEqual([
      `From the week of ${describeTrendDate("2026-09-05")}, most investigations ran on chat-medium.`,
      `From the week of ${describeTrendDate("2026-10-31")}, most investigations ran on chat-large.`,
    ]);
  });

  test("a change on a week the page does not draw marks nothing, and says nothing", () => {
    const outcomes: AiOutcomes = withModels(
      makeModels({
        changes: [{ weekStart: "2025-01-04", modelName: "chat-medium" }],
      }),
    );

    for (const card of getAiResultsCards(outcomes)) {
      expect(
        card.weeks.some((week: AiResultsWeekBar): boolean => {
          return Boolean(week.modelChange);
        }),
      ).toBe(false);
      expect(card.modelChanges).toEqual([]);
    }
  });
});

describe("each part of a breakdown names the records it opens (#7768)", () => {
  test("every segment of every card, and each part's outcomes exactly once", () => {
    const opened: Record<string, Array<string>> = {};

    for (const card of getAiResultsCards(makeOutcomes())) {
      for (const breakdown of card.breakdowns as Array<AiResultsBreakdown>) {
        for (const segment of breakdown.segments as Array<AiResultsSegment>) {
          opened[segment.records.part] = [
            ...(opened[segment.records.part] || []),
            segment.records.outcome,
          ];
        }
      }
    }

    expect(opened).toEqual({
      [AiOutcomesPart.Pages]: AI_OUTCOMES_PART_OUTCOMES[
        AiOutcomesPart.Pages
      ].filter((outcome: string): boolean => {
        // Still held is a fact beside the bar, not a part of it.
        return outcome !== "holding";
      }),
      [AiOutcomesPart.RemediationFixes]: [
        ...AI_OUTCOMES_PART_OUTCOMES[AiOutcomesPart.RemediationFixes],
      ],
      [AiOutcomesPart.PullRequestFixes]: [
        ...AI_OUTCOMES_PART_OUTCOMES[AiOutcomesPart.PullRequestFixes],
      ],
      [AiOutcomesPart.RootCauses]: [
        ...AI_OUTCOMES_PART_OUTCOMES[AiOutcomesPart.RootCauses],
      ],
    });
  });

  test("a segment's number is the count of the outcome it opens", () => {
    const outcomes: AiOutcomes = makeOutcomes();
    const counts: Record<AiOutcomesPart, Record<string, number>> = {
      [AiOutcomesPart.Pages]: outcomes.pages as unknown as Record<
        string,
        number
      >,
      [AiOutcomesPart.RemediationFixes]:
        outcomes.remediationFixes as unknown as Record<string, number>,
      [AiOutcomesPart.PullRequestFixes]:
        outcomes.pullRequestFixes as unknown as Record<string, number>,
      [AiOutcomesPart.RootCauses]: outcomes.rootCauses as unknown as Record<
        string,
        number
      >,
    };

    for (const card of getAiResultsCards(outcomes)) {
      for (const breakdown of card.breakdowns) {
        for (const segment of breakdown.segments) {
          expect({
            label: segment.label,
            value: segment.value,
          }).toEqual({
            label: segment.label,
            value: counts[segment.records.part][segment.records.outcome],
          });
        }
      }
    }
  });
});
