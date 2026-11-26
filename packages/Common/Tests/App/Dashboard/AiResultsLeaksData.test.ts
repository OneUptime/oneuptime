import { describe, expect, test } from "@jest/globals";
import {
  AiResultsCard,
  AiResultsCardKind,
  AiResultsSegment,
  getAiResultsCards,
  hasAiResults,
  LEAK_OUTCOME_LABELS,
  LEAKS_CAUGHT_TITLE,
  LEAKS_HOW_CAUGHT,
  parseAiOutcomes,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Results/AiResultsData";
import {
  AI_RESULTS_RECORDS_CLICK_HINTS,
  describeRecordsCount,
  getRecordFacts,
  parseAiOutcomesRecords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Results/AiResultsRecordsData";
import {
  AiOutcomes,
  AiOutcomesLeaks,
  AiOutcomesPart,
  AiOutcomesRecords,
} from "../../../Types/AI/AiOutcomes";
import { JSONObject } from "../../../Types/JSON";
import {
  makeIssueVerdicts,
  makeOutcomes,
  makeWeeks,
  toBody,
} from "./AiResultsFixtures";

/*
 * LEAKS CAUGHT BEFORE MERGE ON AI RESULTS (#10376): the leaks production
 * reviews caught in pull requests - fixed there, or still in them -
 * against the issues Data Security's scans opened after code shipped, on
 * the same checks. Read from the server's numbers as the page reads them;
 * each part opens the pull requests or issues it counts (#7768).
 */

function leaks(overrides: Partial<AiOutcomesLeaks> = {}): AiOutcomesLeaks {
  return { fixed: 6, open: 2, foundAfter: 4, ...overrides };
}

function leaksCard(outcomes: AiOutcomes): AiResultsCard | undefined {
  return getAiResultsCards(outcomes).find((card: AiResultsCard): boolean => {
    return card.kind === AiResultsCardKind.LeaksCaught;
  });
}

describe("the Leaks Caught Before Merge card", () => {
  test("comes last, after the verdicts, for a reader of the reviews and the issues", () => {
    expect(
      getAiResultsCards(
        makeOutcomes({ issueVerdicts: makeIssueVerdicts(), leaks: leaks() }),
      ).map((card: AiResultsCard): AiResultsCardKind => {
        return card.kind;
      }),
    ).toEqual([
      AiResultsCardKind.PagesAvoided,
      AiResultsCardKind.FixesVerified,
      AiResultsCardKind.RootCausesConfirmed,
      AiResultsCardKind.VerdictsAgreed,
      AiResultsCardKind.LeaksCaught,
    ]);
  });

  test.each([
    ["a reader who may not read them (null)", null],
    ["a server of the release before (not sent)", undefined],
  ])("is not drawn for %s", (_name: string, value: null | undefined) => {
    expect(leaksCard(makeOutcomes({ leaks: value }))).toBeUndefined();
  });

  test("is the leaks caught before they merged, of every leak counted, each part opening what it counts", () => {
    const card: AiResultsCard = leaksCard(makeOutcomes({ leaks: leaks() }))!;

    expect(card.title).toBe(LEAKS_CAUGHT_TITLE);
    expect({ value: card.value, total: card.total }).toEqual({
      value: 8,
      total: 12,
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
        label: LEAK_OUTCOME_LABELS.fixed,
        value: 6,
        records: { part: AiOutcomesPart.Leaks, outcome: "fixed" },
      },
      {
        label: LEAK_OUTCOME_LABELS.open,
        value: 2,
        records: { part: AiOutcomesPart.Leaks, outcome: "open" },
      },
      {
        label: LEAK_OUTCOME_LABELS.foundAfter,
        value: 4,
        records: { part: AiOutcomesPart.Leaks, outcome: "foundAfter" },
      },
    ]);
    expect(card.byModel).toBeNull();
    expect(card.byKind).toBeNull();
  });

  test("with nothing caught or found yet, says so, and how a leak comes to count", () => {
    const card: AiResultsCard = leaksCard(
      makeOutcomes({ leaks: leaks({ fixed: 0, open: 0, foundAfter: 0 }) }),
    )!;

    expect(card.total).toBe(0);
    expect(card.breakdowns).toEqual([]);
    expect(card.startNotes).toEqual([
      "No leaks caught or found yet.",
      LEAKS_HOW_CAUGHT,
    ]);
  });

  test("each week's bar is that week's leaks, and those caught before they merged", () => {
    const counted: Array<number> = [0, 1, 0, 2, 0, 0, 3, 0, 1, 0, 2, 3];
    const caught: Array<number> = [0, 1, 0, 1, 0, 0, 3, 0, 0, 0, 2, 0];
    const card: AiResultsCard = leaksCard(
      makeOutcomes({
        leaks: leaks(),
        weeks: makeWeeks({ leaksCounted: counted, leaksCaught: caught }),
      }),
    )!;

    expect(
      card.weeks.map((week: { value: number; total: number }) => {
        return [week.value, week.total];
      }),
    ).toEqual(
      counted.map((total: number, index: number): [number, number] => {
        return [caught[index]!, total];
      }),
    );
    expect(card.weeks[1]!.description).toContain("1 of 1 leak caught");
    expect(card.weeks[0]!.description).toContain("no leaks");
  });
});

describe("the server's numbers, as the page reads them", () => {
  test("its leaks, and each week's", () => {
    const outcomes: AiOutcomes = makeOutcomes({
      leaks: leaks(),
      weeks: makeWeeks({
        leaksCounted: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        leaksCaught: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      }),
    });
    const parsed: AiOutcomes | null = parseAiOutcomes(toBody(outcomes));

    expect(parsed!.leaks).toEqual(leaks());
    expect(parsed!.weeks[0]!.leaksCaught).toBe(1);
    expect(parsed!.weeks[0]!.leaksCounted).toBe(1);
  });

  test("a server of the release before counts no leaks: none drawn, and weeks of none", () => {
    const body: JSONObject = toBody(makeOutcomes());

    delete body["leaks"];

    for (const week of body["weeks"] as Array<JSONObject>) {
      delete week["leaksCaught"];
      delete week["leaksCounted"];
    }

    const parsed: AiOutcomes | null = parseAiOutcomes(body);

    expect(parsed).not.toBeNull();
    expect(parsed!.leaks).toBeUndefined();
    expect(parsed!.weeks[0]!.leaksCaught).toBe(0);
  });

  test("counts it cannot read are no page at all", () => {
    const body: JSONObject = toBody(makeOutcomes({ leaks: leaks() }));

    (body["leaks"] as JSONObject)["fixed"] = -1;

    expect(parseAiOutcomes(body)).toBeNull();
  });

  test("a project with only leaks counted has results", () => {
    expect(
      hasAiResults(
        makeOutcomes({
          pages: null,
          remediationFixes: null,
          pullRequestFixes: null,
          rootCauses: null,
          leaks: leaks({ fixed: 0, open: 1, foundAfter: 0 }),
        }),
      ),
    ).toBe(true);
  });
});

describe("what a leak number opens", () => {
  test("its pull requests and issues, counted in words", () => {
    expect(AI_RESULTS_RECORDS_CLICK_HINTS[AiOutcomesPart.Leaks]).toBe(
      "Show the pull requests and issues",
    );
    // "12 weeks" kept on one line, as every count of the page keeps it.
    expect(describeRecordsCount(AiOutcomesPart.Leaks, 3)).toBe(
      "3 leaks over the last 12 weeks, newest first.",
    );
    expect(describeRecordsCount(AiOutcomesPart.Leaks, 1)).toBe(
      "1 leak over the last 12 weeks.",
    );
  });

  test("a caught leak: its pull request and the check it fails; a found one: its issue", () => {
    const records: AiOutcomesRecords | null = parseAiOutcomesRecords({
      part: AiOutcomesPart.Leaks,
      outcome: "fixed",
      total: 2,
      records: [
        {
          id: "run-1:key-1",
          at: "2026-11-10T10:00:00.000Z",
          checkId: "secrets-in-telemetry",
          pullRequestNumber: 42,
          pullRequestTitle: "Log failed logins",
          pullRequestUrl: "https://github.com/acme/checkout/pull/42",
        },
        {
          id: "5d1c2b3a-0000-4000-8000-0000000000a1",
          at: "2026-11-09T10:00:00.000Z",
          checkId: "public-read",
          dataSecurityIssue: {
            id: "5d1c2b3a-0000-4000-8000-0000000000a1",
            title: "Anyone on the internet can read it",
          },
        },
      ],
      nextSkip: null,
    });

    expect(records!.records[0]).toMatchObject({
      checkId: "secrets-in-telemetry",
      pullRequestNumber: 42,
      pullRequestTitle: "Log failed logins",
      pullRequestUrl: "https://github.com/acme/checkout/pull/42",
    });
    expect(
      getRecordFacts(AiOutcomesPart.Leaks, records!.records[0]!).length,
    ).toBe(1);
    expect(records!.records[1]!.dataSecurityIssue!.title).toBe(
      "Anyone on the internet can read it",
    );
    // A check the catalog does not know says nothing.
    expect(
      getRecordFacts(AiOutcomesPart.Leaks, {
        id: "x",
        at: "2026-11-09T10:00:00.000Z",
        checkId: "no-such-check",
      }),
    ).toEqual([]);
  });
});
