import { describe, expect, test } from "@jest/globals";
import {
  AiResultsCard,
  AiResultsCardKind,
  AiResultsFact,
  AiResultsSegment,
  VERDICT_FACT_LABELS,
  VERDICT_OUTCOME_LABELS,
  VERDICTS_HOW_DECIDED,
  getAiResultsCards,
  parseAiOutcomes,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Results/AiResultsData";
import {
  AiOutcomes,
  AiOutcomesPart,
  AiOutcomesWeek,
} from "../../../Types/AI/AiOutcomes";
import { JSONObject } from "../../../Types/JSON";
import {
  makeDataSecurity,
  makeIssueVerdicts,
  makeOutcomes,
  makeWeeks,
  toBody,
} from "./AiResultsFixtures";

/*
 * VERDICTS AGREED ON AI RESULTS (#10369): of the Data Security issues
 * OneUptime AI analyzed that people then decided - fixed, accepted or set
 * aside as not an issue - how many went as its verdict said. Read from the
 * server's numbers as the page reads them; each number opens the issues it
 * counts, as every number on the page does (#7768).
 */

function verdictsCard(outcomes: AiOutcomes): AiResultsCard | undefined {
  return getAiResultsCards(outcomes).find((card: AiResultsCard): boolean => {
    return card.kind === AiResultsCardKind.VerdictsAgreed;
  });
}

describe("the Verdicts Agreed card", () => {
  test("comes after Data Security's, for a reader of the issues OneUptime AI analyzed", () => {
    expect(
      getAiResultsCards(
        makeOutcomes({
          dataSecurity: makeDataSecurity(),
          issueVerdicts: makeIssueVerdicts(),
        }),
      ).map((card: AiResultsCard): AiResultsCardKind => {
        return card.kind;
      }),
    ).toEqual([
      AiResultsCardKind.PagesAvoided,
      AiResultsCardKind.FixesVerified,
      AiResultsCardKind.RootCausesConfirmed,
      AiResultsCardKind.DataSecurity,
      AiResultsCardKind.VerdictsAgreed,
    ]);
  });

  test.each([
    ["a reader who may not read the issues (null)", null],
    ["a server of the release before (not sent)", undefined],
  ])("is not drawn for %s", (_name: string, verdicts: null | undefined) => {
    expect(
      verdictsCard(makeOutcomes({ issueVerdicts: verdicts })),
    ).toBeUndefined();
  });

  test("is the decided issues that went as the verdict said, of every decided one, each part opening its issues", () => {
    const card: AiResultsCard = verdictsCard(
      makeOutcomes({ issueVerdicts: makeIssueVerdicts() }),
    )!;

    expect({ value: card.value, total: card.total }).toEqual({
      value: 5,
      total: 7,
    });
    expect(card.startNotes).toEqual([]);
    expect(
      card.breakdowns[0]!.segments.map((segment: AiResultsSegment) => {
        return {
          label: segment.label,
          value: segment.value,
          records: segment.records,
        };
      }),
    ).toEqual([
      {
        label: VERDICT_OUTCOME_LABELS.agreed,
        value: 5,
        records: { part: AiOutcomesPart.IssueVerdicts, outcome: "agreed" },
      },
      {
        label: VERDICT_OUTCOME_LABELS.disagreed,
        value: 2,
        records: { part: AiOutcomesPart.IssueVerdicts, outcome: "disagreed" },
      },
    ]);
    // Beside the bar: each verdict it gave, and what it leaves out.
    expect(
      card.facts.map((fact: AiResultsFact) => {
        return [fact.label, fact.value, fact.records?.outcome || null];
      }),
    ).toEqual([
      [VERDICT_FACT_LABELS.real, 6, null],
      [VERDICT_FACT_LABELS.likelyByDesign, 3, null],
      [VERDICT_FACT_LABELS.likelyWrongFinding, 1, null],
      [VERDICT_FACT_LABELS.cannotTell, 1, "cannotTell"],
      [VERDICT_FACT_LABELS.waiting, 3, "waiting"],
    ]);
    // Never counted by model or by kind: a verdict is the analysis's.
    expect(card.byModel).toBeNull();
    expect(card.byKind).toBeNull();
  });

  test("with issues analyzed and none decided yet, says how many, and how one comes to count", () => {
    const card: AiResultsCard = verdictsCard(
      makeOutcomes({
        issueVerdicts: makeIssueVerdicts({
          agreed: 0,
          disagreed: 0,
          waiting: 4,
          cannotTell: 0,
          real: 3,
          likelyByDesign: 1,
          likelyWrongFinding: 0,
        }),
      }),
    )!;

    expect(card.total).toBe(0);
    expect(card.breakdowns).toEqual([]);
    expect(card.startNotes).toEqual([
      "OneUptime AI analyzed 4 Data Security issues, and none has been decided yet.",
      VERDICTS_HOW_DECIDED,
    ]);
  });

  test("with one issue analyzed, says it in the singular", () => {
    const card: AiResultsCard = verdictsCard(
      makeOutcomes({
        issueVerdicts: makeIssueVerdicts({
          agreed: 0,
          disagreed: 0,
          waiting: 1,
          cannotTell: 0,
          real: 1,
          likelyByDesign: 0,
          likelyWrongFinding: 0,
        }),
      }),
    )!;

    expect(card.startNotes[0]).toBe(
      "OneUptime AI analyzed 1 Data Security issue, and nobody has decided on it yet.",
    );
  });

  test("with nothing analyzed, says so, and draws no fact", () => {
    const card: AiResultsCard = verdictsCard(
      makeOutcomes({
        issueVerdicts: makeIssueVerdicts({
          agreed: 0,
          disagreed: 0,
          waiting: 0,
          cannotTell: 0,
          real: 0,
          likelyByDesign: 0,
          likelyWrongFinding: 0,
        }),
      }),
    )!;

    expect(card.startNotes).toEqual([
      "No analyzed Data Security issues yet.",
      VERDICTS_HOW_DECIDED,
    ]);
    expect(card.facts).toEqual([]);
  });

  test("each week's bar is that week's decided issues, and the ones that went as its verdict said", () => {
    const decided: Array<number> = [0, 0, 1, 0, 2, 0, 0, 3, 0, 1, 0, 2];
    const agreed: Array<number> = [0, 0, 1, 0, 1, 0, 0, 2, 0, 1, 0, 2];
    const card: AiResultsCard = verdictsCard(
      makeOutcomes({
        issueVerdicts: makeIssueVerdicts(),
        weeks: makeWeeks({ verdictsDecided: decided, verdictsAgreed: agreed }),
      }),
    )!;

    expect(
      card.weeks.map((week: { value: number; total: number }) => {
        return [week.value, week.total];
      }),
    ).toEqual(
      decided.map((total: number, index: number): [number, number] => {
        return [agreed[index]!, total];
      }),
    );
    expect(card.weeks[7]!.description).toMatch(
      /: 2 of 3 decided issues went as their verdicts said$/,
    );
    expect(card.weeks[0]!.description).toMatch(/: no decided issues$/);
  });
});

describe("the verdicts, as the page reads them from the server", () => {
  function body(overrides: JSONObject = {}): JSONObject {
    return {
      ...toBody(makeOutcomes({ issueVerdicts: makeIssueVerdicts() })),
      ...overrides,
    };
  }

  test("are read with each week's verdict counts", () => {
    const read: AiOutcomes = parseAiOutcomes(
      body({
        weeks: makeWeeks({
          verdictsDecided: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7],
          verdictsAgreed: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5],
        }) as unknown as JSONObject,
      }),
    )!;

    expect(read.issueVerdicts).toEqual(makeIssueVerdicts());
    expect(read.weeks[11]!.verdictsDecided).toBe(7);
    expect(read.weeks[11]!.verdictsAgreed).toBe(5);
  });

  test("from a server of the release before, are none - and its weeks still read, counting none", () => {
    const weeks: Array<JSONObject> = makeWeeks().map(
      (week: AiOutcomesWeek): JSONObject => {
        const sent: JSONObject = { ...week } as unknown as JSONObject;

        delete sent["verdictsAgreed"];
        delete sent["verdictsDecided"];

        return sent;
      },
    );
    const sent: JSONObject = body({ weeks: weeks as unknown as JSONObject });

    delete sent["issueVerdicts"];

    const read: AiOutcomes = parseAiOutcomes(sent)!;

    expect(read).not.toBeNull();
    expect(read.issueVerdicts).toBeUndefined();
    expect(read.weeks[0]!.verdictsAgreed).toBe(0);
    expect(read.weeks[0]!.verdictsDecided).toBe(0);
    expect(verdictsCard(read)).toBeUndefined();
  });

  test("for a reader who may not read the issues, are null", () => {
    expect(
      parseAiOutcomes(body({ issueVerdicts: null }))!.issueVerdicts,
    ).toBeNull();
  });

  test("a count that is no count makes the whole answer unreadable, as any other part's does", () => {
    expect(
      parseAiOutcomes(
        body({
          issueVerdicts: {
            ...(makeIssueVerdicts() as unknown as JSONObject),
            agreed: -1,
          },
        }),
      ),
    ).toBeNull();
  });
});
