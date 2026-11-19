import BenchmarkReport, {
  BenchmarkReportInput,
} from "../../../../../../Server/Utils/AI/Eval/Benchmark/BenchmarkReport";
import { BenchmarkFailUnder } from "../../../../../../Server/Utils/AI/Eval/Benchmark/BenchmarkCommandLine";
import {
  BenchmarkExpectationKind,
  BenchmarkFaultKind,
  BenchmarkSubjectKind,
} from "../../../../../../Server/Utils/AI/Eval/Benchmark/BenchmarkScenario";
import { BenchmarkScore } from "../../../../../../Server/Utils/AI/Eval/Benchmark/BenchmarkScorer";
import InvestigationBenchmark, {
  BenchmarkScenarioResult,
} from "../../../../../../Server/Utils/AI/Eval/Benchmark/InvestigationBenchmark";
import { AIRunStopReason } from "../../../../../../Types/AI/AIAgentRunLimits";
import AIRunAutoGrade from "../../../../../../Types/AI/AIRunAutoGrade";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A BENCHMARK RUN REPORTS (issues #7764, #7766): each run's verdict and
 * why, the pass count - of scenarios, and of runs when each ran several
 * times - the threshold a CI job holds it to, and the same in Markdown for
 * the job's summary. Built from the results alone, so this is what a person
 * reads.
 */

function score(overrides: Partial<BenchmarkScore>): BenchmarkScore {
  return {
    rootCauseText: "",
    hasRootCauseSection: true,
    namesCause: false,
    missingTerms: [],
    namedDistractors: [],
    citesKeyEvidence: false,
    foundCause: false,
    passed: false,
    ...overrides,
  };
}

const PASSED: BenchmarkScore = score({
  namesCause: true,
  citesKeyEvidence: true,
  foundCause: true,
  passed: true,
});

function result(
  scenarioId: string,
  scenarioScore: BenchmarkScore | undefined,
  more: Partial<BenchmarkScenarioResult> = {},
): BenchmarkScenarioResult {
  return {
    scenarioId,
    title: `Checkout fails | ${scenarioId}`,
    faultKind: BenchmarkFaultKind.BadDeploy,
    subjectKind: BenchmarkSubjectKind.Incident,
    expectationKind: BenchmarkExpectationKind.Cause,
    plantedFault: "A planted fault.",
    run: 1,
    analysisMarkdown: "",
    citationCount: 1,
    llmCallCount: 2,
    toolCallCount: 3,
    totalTokens: 1000,
    durationMs: 1,
    ...(scenarioScore
      ? { score: scenarioScore }
      : { error: "The provider is down." }),
    ...more,
  };
}

function input(
  results: Array<BenchmarkScenarioResult>,
  more: Partial<BenchmarkReportInput> = {},
): BenchmarkReportInput {
  return {
    model: "Anthropic claude-opus-5-5",
    judge: null,
    repeat: 1,
    results,
    summary: InvestigationBenchmark.summarize(results),
    outputPath: "./ai-benchmark-results.json",
    ...more,
  };
}

describe("each run's verdict, and why, in a line", () => {
  test("a pass names the cause and cites the key evidence", () => {
    expect(BenchmarkReport.describeResult(result("a", PASSED))).toBe(
      "PASS names the cause; cites the key evidence",
    );
  });

  test("a fail says which words were missing, what it cited, which wrong cause it named and why it stopped", () => {
    expect(
      BenchmarkReport.describeResult(
        result(
          "a",
          score({
            missingTerms: ["v2.14.0", "percentOff"],
            namedDistractors: ["Redis latency"],
          }),
          { stopReason: AIRunStopReason.ModelCalls },
        ),
      ),
    ).toBe(
      `FAIL missing: v2.14.0, percentOff; cites none of the key evidence; named a wrong cause: Redis latency; stopped: ${AIRunStopReason.ModelCalls}`,
    );
  });

  test("a judge's grade comes first, and an unreadable one says so", () => {
    expect(
      BenchmarkReport.describeResult(
        result("a", score({ ...PASSED, judgeGrade: AIRunAutoGrade.Match })),
      ),
    ).toBe("PASS judge Match; names the cause; cites the key evidence");
    expect(
      BenchmarkReport.describeResult(
        result("a", score({ judgeGrade: null }), {
          error: "The judge could not grade the answer: 529 Overloaded",
        }),
      ),
    ).toBe(
      "FAIL judge unreadable; gave no answer; cites none of the key evidence; The judge could not grade the answer: 529 Overloaded",
    );
  });

  test("where the evidence names no cause, it says whether the answer said it could not tell, and the judge's reading", () => {
    const noCause: Partial<BenchmarkScenarioResult> = {
      expectationKind: BenchmarkExpectationKind.Inconclusive,
    };

    expect(
      BenchmarkReport.describeResult(
        result(
          "a",
          score({ ...PASSED, judgeClassification: "INCONCLUSIVE" }),
          noCause,
        ),
      ),
    ).toBe(
      "PASS judge read it as INCONCLUSIVE; says it could not tell; cites the key evidence",
    );
    expect(
      BenchmarkReport.describeResult(
        result("a", score({ missingTerms: ["inconclusive"] }), noCause),
      ),
    ).toBe(
      "FAIL does not say it could not tell; cites none of the key evidence",
    );
  });

  test("a run that ended with no score is an error, with its reason", () => {
    expect(BenchmarkReport.describeResult(result("a", undefined))).toBe(
      "ERROR The provider is down.",
    );
    expect(
      BenchmarkReport.describeResult(
        result("a", undefined, { error: undefined }),
      ),
    ).toBe("ERROR unknown error");
  });
});

describe("the pass count", () => {
  test("of scenarios, when each ran once", () => {
    expect(
      BenchmarkReport.describePassed(
        InvestigationBenchmark.summarize([
          result("a", PASSED),
          result("b", score({})),
        ]),
      ),
    ).toBe("1 of 2 scenarios");
    expect(
      BenchmarkReport.describePassed(
        InvestigationBenchmark.summarize([result("a", PASSED)]),
      ),
    ).toBe("1 of 1 scenario");
  });

  test("of scenarios and of runs, when each ran several times", () => {
    expect(
      BenchmarkReport.describePassed(
        InvestigationBenchmark.summarize([
          result("a", PASSED, { run: 1 }),
          result("a", PASSED, { run: 2 }),
          result("a", score({}), { run: 3 }),
          result("b", score({}), { run: 1 }),
          result("b", PASSED, { run: 2 }),
          result("b", score({}), { run: 3 }),
        ]),
      ),
    ).toBe("1 of 2 scenarios (3 of 6 runs, 50%)");
  });
});

describe("the threshold a CI job holds the run to", () => {
  const SUMMARY_8_OF_13: ReturnType<typeof InvestigationBenchmark.summarize> =
    InvestigationBenchmark.summarize(
      Array.from({ length: 13 }, (_unused: unknown, index: number) => {
        return result(`s${index}`, index < 8 ? PASSED : score({}));
      }),
    );

  test("none asked, none said", () => {
    expect(
      BenchmarkReport.describeThreshold(SUMMARY_8_OF_13, undefined),
    ).toBeUndefined();
  });

  test.each([
    [{ given: "8", requiredPassedCount: 8 }, "at least 8 of 13 scenarios: met"],
    [
      { given: "9", requiredPassedCount: 9 },
      "at least 9 of 13 scenarios: not met",
    ],
    [
      { given: "60%", percentage: 60, requiredPassedCount: 8 },
      "at least 60% of the scenarios (8 of 13): met",
    ],
    [
      { given: "70%", percentage: 70, requiredPassedCount: 10 },
      "at least 70% of the scenarios (10 of 13): not met",
    ],
  ])("%j: %s", (failUnder: BenchmarkFailUnder, said: string) => {
    expect(BenchmarkReport.describeThreshold(SUMMARY_8_OF_13, failUnder)).toBe(
      said,
    );
  });
});

describe("the printed report", () => {
  test("names the model and the judge, never a key, and adds the run up", () => {
    const lines: Array<string> = BenchmarkReport.buildTextReport(
      input([result("checkout", PASSED), result("orders", undefined)], {
        failUnder: { given: "1", requiredPassedCount: 1 },
        personaFile: "draft-persona.md",
      }),
    );
    const text: string = lines.join("\n");

    expect(text).toContain(
      "Model under test: Anthropic claude-opus-5-5   persona: draft-persona.md",
    );
    expect(text).toContain(
      "Judge:            none - an answer finds the cause when its root cause names it",
    );
    expect(text).toContain("  Passed:                      1 of 2 scenarios");
    expect(text).toContain(
      "  Threshold (--fail-under):    at least 1 of 2 scenarios: met",
    );
    expect(text).toContain("  Errors:                      1");
    expect(text).toContain(
      "  Tool calls: 6   tokens: 2000   (results written to ./ai-benchmark-results.json)",
    );
    expect(text).toContain(
      `  ${"checkout".padEnd(44)} ${"Bad deploy".padEnd(15)} PASS names the cause; cites the key evidence`,
    );
    expect(text).toContain(
      `  ${"orders".padEnd(44)} ${"Bad deploy".padEnd(15)} ERROR The provider is down.`,
    );
    expect(text).not.toContain("Runs:");
  });

  test("with repeated runs: how many times, each scenario's runs passed, and every run under it", () => {
    const text: string = BenchmarkReport.buildTextReport(
      input(
        [
          result("checkout", PASSED, { run: 1 }),
          result("checkout", score({}), { run: 2 }),
          result("checkout", PASSED, { run: 3 }),
        ],
        { repeat: 3, judge: "Anthropic claude-opus-5-5" },
      ),
    ).join("\n");

    expect(text).toContain(
      "Runs:             each scenario 3 times; a scenario passes when more than half its runs pass",
    );
    expect(text).toContain("Judge:            Anthropic claude-opus-5-5");
    expect(text).toContain(
      `  ${"checkout".padEnd(44)} ${"Bad deploy".padEnd(15)} PASS 2 of 3 runs passed`,
    );
    expect(text).toContain(
      "      run 2: FAIL gave no answer; cites none of the key evidence",
    );
  });
});

describe("the Markdown report, for a CI job's summary", () => {
  test("leads with the verdict, then a row per scenario, then each run folded away", () => {
    const markdown: string = BenchmarkReport.buildMarkdownReport(
      input(
        [
          result("checkout", PASSED, { run: 1 }),
          result("checkout", PASSED, { run: 2 }),
          result("quiet-alert", score({}), {
            run: 1,
            subjectKind: BenchmarkSubjectKind.Alert,
            expectationKind: BenchmarkExpectationKind.Inconclusive,
          }),
          result("quiet-alert", undefined, {
            run: 2,
            subjectKind: BenchmarkSubjectKind.Alert,
            expectationKind: BenchmarkExpectationKind.Inconclusive,
          }),
        ],
        {
          repeat: 2,
          failUnder: { given: "50%", percentage: 50, requiredPassedCount: 1 },
        },
      ),
    );
    const lines: Array<string> = markdown.split("\n");

    expect(lines[0]).toBe("## AI investigation benchmark");
    expect(markdown).toContain(
      "**Passed: 1 of 2 scenarios (2 of 4 runs, 50%)**, with Anthropic claude-opus-5-5. Threshold: at least 50% of the scenarios (1 of 2): met.",
    );
    expect(markdown).toContain(
      "Each scenario ran 2 times, and passes when more than half its runs pass.",
    );
    expect(markdown).toContain(
      "| Scenario | Subject | A right answer | Runs passed | Result |",
    );
    // A title's pipe is escaped, so the row keeps its columns.
    expect(markdown).toContain(
      "| Checkout fails \\| checkout (`checkout`) | Incident | Names the planted cause | 2 of 2 | Passed |",
    );
    expect(markdown).toContain(
      "| Checkout fails \\| quiet-alert (`quiet-alert`) | Alert | Says the evidence names no cause | 0 of 2 | Failed |",
    );
    expect(markdown).toContain("<details><summary>Each run</summary>");
    expect(markdown).toContain(
      "| `quiet-alert` | 2 | ERROR The provider is down. |",
    );
    expect(markdown).toContain(
      "Every answer and score is in `./ai-benchmark-results.json`.",
    );
    expect(markdown.endsWith("\n")).toBe(true);
  });

  test("every row of the scenarios' table has the header's five columns", () => {
    const markdown: string = BenchmarkReport.buildMarkdownReport(
      input([result("a", PASSED), result("b", undefined)]),
    );
    const lines: Array<string> = markdown.split("\n");
    const header: number = lines.indexOf(
      "| Scenario | Subject | A right answer | Runs passed | Result |",
    );
    const end: number = lines.indexOf("", header);
    const tableRows: Array<string> = lines.slice(header, end);

    expect(tableRows).toHaveLength(4);

    for (const row of tableRows) {
      expect(row.replace(/\\\|/g, "").split("|").length - 2).toBe(5);
    }
  });

  test("says the threshold was not met when it was not, and nothing of one when none was asked", () => {
    expect(
      BenchmarkReport.buildMarkdownReport(
        input([result("a", score({}))], {
          failUnder: { given: "1", requiredPassedCount: 1 },
        }),
      ),
    ).toContain("Threshold: at least 1 of 1 scenarios: not met.");
    expect(
      BenchmarkReport.buildMarkdownReport(input([result("a", PASSED)])),
    ).not.toContain("Threshold");
  });
});
