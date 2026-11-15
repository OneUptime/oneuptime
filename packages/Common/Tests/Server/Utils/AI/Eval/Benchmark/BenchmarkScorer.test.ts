import BenchmarkScorer, {
  BenchmarkScore,
} from "../../../../../../Server/Utils/AI/Eval/Benchmark/BenchmarkScorer";
import {
  BenchmarkFaultKind,
  BenchmarkScenario,
} from "../../../../../../Server/Utils/AI/Eval/Benchmark/BenchmarkScenario";
import { AIChatCitation } from "../../../../../../Types/AI/AIChatTypes";
import AIRunAutoGrade from "../../../../../../Types/AI/AIRunAutoGrade";
import { JSONObject } from "../../../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW A BENCHMARK ANSWER IS SCORED (issue #6800).
 *
 * BenchmarkScorer decides, from the answer alone, whether a scenario
 * passed: its "Most likely root cause" holds a word of every group the
 * scenario names (or a judge said MATCH), and it cites a result the
 * scenario marks as the planted fault's own evidence. Under test, with a
 * small made-up scenario: how words are matched, which part of the answer
 * is read, which citations count, how a judge's grade outranks the words,
 * and that passing takes both the cause and the evidence.
 */

const POOL_LOGS_ARGUMENTS: JSONObject = { bodySearchText: "pool exhausted" };
const DISK_LOGS_ARGUMENTS: JSONObject = { bodySearchText: "disk" };

const SCENARIO: BenchmarkScenario = {
  id: "scorer-test",
  title: "Orders time out",
  faultKind: BenchmarkFaultKind.Capacity,
  plantedFault: "A report job holds the connection pool.",
  declaredAt: "2026-04-14T02:10:00.000Z",
  minutesSinceDeclared: 5,
  contextText: "# Incident\nTitle: Orders time out",
  responses: [
    {
      toolName: "search_logs",
      whenArguments: { bodySearchText: "pool" },
      citationLabel: "Logs matching pool",
      isKeyEvidence: true,
      rows: [{ body: "timeout acquiring a connection from the pool" }],
    },
    {
      toolName: "search_logs",
      citationLabel: "Logs",
      rows: [{ body: "disk latency 4 ms" }],
    },
  ],
  expectation: {
    rootCause:
      "The nightly-sales-report job held 16 of the 20 connections in the pool.",
    mustMention: [
      ["connection pool", "pool exhausted"],
      ["nightly-sales-report", "report job"],
    ],
    distractors: [
      {
        name: "storefront deploy",
        terms: ["v5.9.0", "storefront-web deploy"],
      },
      { name: "slow disk", terms: ["disk latency"] },
    ],
  },
};

const RIGHT_CAUSE: string =
  "The nightly-sales-report job held the connection pool.";

function citation(id: string, queryArguments: JSONObject): AIChatCitation {
  return {
    id,
    toolName: "search_logs",
    label: "Logs",
    queryArguments,
    rowCount: 1,
  };
}

// C1 is a result of the key response, C2 of the catch-all that is not.
const CITATIONS: Array<AIChatCitation> = [
  citation("C1", POOL_LOGS_ARGUMENTS),
  citation("C2", DISK_LOGS_ARGUMENTS),
];

function report(rootCause: string, evidence: string = "- Logs [C1]"): string {
  return [
    "## Summary",
    "Orders time out.",
    "",
    "## Most likely root cause",
    rootCause,
    "",
    "## Evidence",
    evidence,
  ].join("\n");
}

function score(
  analysisMarkdown: string,
  options: {
    citations?: Array<AIChatCitation> | undefined;
    judgeGrade?: AIRunAutoGrade | null | undefined;
    scenario?: BenchmarkScenario | undefined;
  } = {},
): BenchmarkScore {
  return BenchmarkScorer.score({
    scenario: options.scenario || SCENARIO,
    analysisMarkdown,
    citations: options.citations || CITATIONS,
    ...("judgeGrade" in options ? { judgeGrade: options.judgeGrade } : {}),
  });
}

describe("a word is found ignoring case and spacing", () => {
  test("case does not matter", () => {
    expect(
      BenchmarkScorer.holdsAny("The CONNECTION Pool ran dry", [
        "connection pool",
      ]),
    ).toBe(true);
    expect(
      BenchmarkScorer.holdsAny("the connection pool", ["CONNECTION POOL"]),
    ).toBe(true);
  });

  test("spaces, underscores and dashes are one space, however many there are", () => {
    for (const text of [
      "pool_exhausted",
      "pool-exhausted",
      "pool \n\t exhausted",
      "pool -_ exhausted",
    ]) {
      expect(BenchmarkScorer.holdsAny(text, ["pool exhausted"])).toBe(true);
    }

    expect(
      BenchmarkScorer.holdsAny("the nightly sales report", [
        "nightly-sales-report",
      ]),
    ).toBe(true);
    expect(
      BenchmarkScorer.holdsAny("NIGHTLY_SALES_REPORT", [
        "nightly-sales-report",
      ]),
    ).toBe(true);
  });

  test("any one word of the list is enough, and a word must be there whole", () => {
    expect(
      BenchmarkScorer.holdsAny("the report job ran", [
        "nightly-sales-report",
        "report job",
      ]),
    ).toBe(true);
    expect(
      BenchmarkScorer.holdsAny("the pool ran dry", [
        "connection pool",
        "pool exhausted",
      ]),
    ).toBe(false);
  });

  test("an empty word holds nothing", () => {
    expect(BenchmarkScorer.holdsAny("anything at all", ["", "  ", "-_"])).toBe(
      false,
    );
  });
});

describe("the cause is named by a word of every group", () => {
  test("a root cause that holds every group names the cause", () => {
    const result: BenchmarkScore = score(report(`${RIGHT_CAUSE} [C1]`));

    expect(result.namesCause).toBe(true);
    expect(result.missingTerms).toEqual([]);
  });

  test("each group the root cause misses is reported by its first word", () => {
    expect(
      score(report("The connection pool ran dry. [C1]")).missingTerms,
    ).toEqual(["nightly-sales-report"]);
    expect(score(report("The report job was slow. [C1]")).missingTerms).toEqual(
      ["connection pool"],
    );
    expect(score(report("Something was slow. [C1]")).missingTerms).toEqual([
      "connection pool",
      "nightly-sales-report",
    ]);
    expect(score(report("The connection pool ran dry. [C1]")).namesCause).toBe(
      false,
    );
  });

  test("an empty answer never names the cause, even of a scenario with no words to hold", () => {
    const noWords: BenchmarkScenario = {
      ...SCENARIO,
      expectation: { ...SCENARIO.expectation, mustMention: [] },
    };

    expect(score("", { scenario: noWords }).namesCause).toBe(false);
    expect(score("   \n", { scenario: noWords }).namesCause).toBe(false);
    expect(score("An answer.", { scenario: noWords }).namesCause).toBe(true);
  });
});

describe("the words are read from the root cause, else from the whole answer", () => {
  test("only the Most likely root cause section is read for the cause and the distractors", () => {
    const analysis: string = [
      "## Summary",
      `${RIGHT_CAUSE} Not the storefront-web deploy.`,
      "",
      "## Most likely root cause",
      "The storefront-web deploy v5.9.0 broke checkout. [C1]",
      "",
      "## Evidence",
      "- Logs [C1]",
    ].join("\n");
    const result: BenchmarkScore = score(analysis);

    expect(result.hasRootCauseSection).toBe(true);
    expect(result.rootCauseText).toBe(
      "The storefront-web deploy v5.9.0 broke checkout. [C1]",
    );
    expect(result.namesCause).toBe(false);
    expect(result.namedDistractors).toEqual(["storefront deploy"]);
  });

  test("a distractor named outside the root cause is not counted", () => {
    const analysis: string = [
      "## Summary",
      "Not the storefront-web deploy, and no disk latency.",
      "",
      "## Most likely root cause",
      `${RIGHT_CAUSE} [C1]`,
    ].join("\n");

    expect(score(analysis).namedDistractors).toEqual([]);
  });

  test("an answer with no root cause section is read whole", () => {
    const analysis: string = `  ${RIGHT_CAUSE} Disk latency was normal. [C1]\n`;
    const result: BenchmarkScore = score(analysis);

    expect(result.hasRootCauseSection).toBe(false);
    expect(result.rootCauseText).toBe(analysis.trim());
    expect(result.namesCause).toBe(true);
    expect(result.namedDistractors).toEqual(["slow disk"]);
  });

  test("every distractor the root cause names is reported, in the scenario's order", () => {
    const result: BenchmarkScore = score(
      report("Disk latency after the storefront-web deploy. [C1]"),
    );

    expect(result.namedDistractors).toEqual(["storefront deploy", "slow disk"]);
  });
});

describe("only a cited result of the fault's own evidence counts", () => {
  test("an answer that cites a key result cites key evidence", () => {
    expect(score(report(`${RIGHT_CAUSE} [C1]`)).citesKeyEvidence).toBe(true);
  });

  test("an answer that cites only a result that is not key evidence does not", () => {
    expect(
      score(report(`${RIGHT_CAUSE} [C2]`, "- Logs [C2]")).citesKeyEvidence,
    ).toBe(false);
  });

  test("an answer that cites nothing does not, though a key result was read", () => {
    expect(score(report(RIGHT_CAUSE, "- Logs")).citesKeyEvidence).toBe(false);
  });

  test("a marker no citation was minted for does not", () => {
    expect(
      score(report(`${RIGHT_CAUSE} [C9]`, "- Logs [C7]")).citesKeyEvidence,
    ).toBe(false);
    expect(
      score(report(`${RIGHT_CAUSE} [C1]`), { citations: [] }).citesKeyEvidence,
    ).toBe(false);
  });

  test("a key result cited anywhere in the answer counts, not only in the root cause", () => {
    expect(
      score(report(RIGHT_CAUSE, "- The pool logs [C1]")).citesKeyEvidence,
    ).toBe(true);
  });

  test("whether a citation is key is decided by the arguments it was read with", () => {
    const pool: Array<AIChatCitation> = [
      citation("C1", { bodySearchText: "POOL EXHAUSTED at 01:45" }),
    ];
    const elsewhere: Array<AIChatCitation> = [
      citation("C1", { bodySearchText: "checkout" }),
    ];
    const otherTool: Array<AIChatCitation> = [
      { ...citation("C1", POOL_LOGS_ARGUMENTS), toolName: "log_histogram" },
    ];

    expect(
      score(report(`${RIGHT_CAUSE} [C1]`), { citations: pool })
        .citesKeyEvidence,
    ).toBe(true);
    expect(
      score(report(`${RIGHT_CAUSE} [C1]`), { citations: elsewhere })
        .citesKeyEvidence,
    ).toBe(false);
    expect(
      score(report(`${RIGHT_CAUSE} [C1]`), { citations: otherTool })
        .citesKeyEvidence,
    ).toBe(false);
  });

  test("citesKeyEvidence alone says the same as the score", () => {
    expect(
      BenchmarkScorer.citesKeyEvidence({
        scenario: SCENARIO,
        analysisMarkdown: "The pool [C2] and the logs [C1].",
        citations: CITATIONS,
      }),
    ).toBe(true);
    expect(
      BenchmarkScorer.citesKeyEvidence({
        scenario: SCENARIO,
        analysisMarkdown: "The logs [C2].",
        citations: CITATIONS,
      }),
    ).toBe(false);
  });
});

describe("a judge's grade outranks the words", () => {
  test("with no judge, the cause is found by its words and no grade is reported", () => {
    const result: BenchmarkScore = score(report(`${RIGHT_CAUSE} [C1]`));

    expect("judgeGrade" in result).toBe(false);
    expect(result.passed).toBe(true);
  });

  test("a judge's MATCH finds the cause even in other words", () => {
    const result: BenchmarkScore = score(
      report("A batch job kept every connection busy. [C1]"),
      { judgeGrade: AIRunAutoGrade.Match },
    );

    expect(result.namesCause).toBe(false);
    expect(result.judgeGrade).toBe(AIRunAutoGrade.Match);
    expect(result.passed).toBe(true);
  });

  test("a judge's MISMATCH fails the answer even when its words are right", () => {
    const result: BenchmarkScore = score(report(`${RIGHT_CAUSE} [C1]`), {
      judgeGrade: AIRunAutoGrade.Mismatch,
    });

    expect(result.namesCause).toBe(true);
    expect(result.judgeGrade).toBe(AIRunAutoGrade.Mismatch);
    expect(result.passed).toBe(false);
  });

  test("a judge's PARTIAL is not the cause found", () => {
    expect(
      score(report(`${RIGHT_CAUSE} [C1]`), {
        judgeGrade: AIRunAutoGrade.Partial,
      }).passed,
    ).toBe(false);
  });

  test("a judge whose grade could not be read fails the answer, and says it judged", () => {
    const result: BenchmarkScore = score(report(`${RIGHT_CAUSE} [C1]`), {
      judgeGrade: null,
    });

    expect("judgeGrade" in result).toBe(true);
    expect(result.judgeGrade).toBeNull();
    expect(result.namesCause).toBe(true);
    expect(result.passed).toBe(false);
  });
});

describe("an answer passes with both the cause and its evidence", () => {
  test.each([
    ["names the cause and cites key evidence", RIGHT_CAUSE, "[C1]", true],
    ["names the cause, cites other evidence", RIGHT_CAUSE, "[C2]", false],
    ["cites key evidence, names another cause", "Disk latency.", "[C1]", false],
    ["neither", "Disk latency.", "[C2]", false],
  ])(
    "an answer that %s",
    (_name: string, rootCause: string, marker: string, passed: boolean) => {
      const result: BenchmarkScore = score(
        report(`${rootCause} ${marker}`, `- Logs ${marker}`),
      );

      expect(result.passed).toBe(passed);
      expect(result.passed).toBe(result.namesCause && result.citesKeyEvidence);
    },
  );
});
