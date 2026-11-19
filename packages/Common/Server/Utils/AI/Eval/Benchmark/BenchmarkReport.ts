import { BenchmarkFailUnder } from "./BenchmarkCommandLine";
import {
  BenchmarkExpectationKind,
  BenchmarkSubjectKind,
} from "./BenchmarkScenario";
import { BenchmarkScore } from "./BenchmarkScorer";
import {
  BenchmarkScenarioResult,
  BenchmarkScenarioSummary,
  BenchmarkSummary,
} from "./InvestigationBenchmark";

/*
 * What a benchmark run reports (npm run ai-benchmark): the lines it prints,
 * and the same in Markdown for a CI job's summary (--report-markdown, the
 * AI Benchmark workflow, #7764). Pure: built from the run's results and
 * their summary, so a test reads exactly what a person reads.
 */

export interface BenchmarkReportInput {
  // The model under test, as describeModelOptions names it: never its key.
  model: string;
  // The judge, named the same way; null when the answers were scored by their words.
  judge: string | null;
  personaFile?: string | undefined;
  // How many times each scenario ran.
  repeat: number;
  results: Array<BenchmarkScenarioResult>;
  summary: BenchmarkSummary;
  failUnder?: BenchmarkFailUnder | undefined;
  // Where every answer and score was written.
  outputPath: string;
}

const NO_JUDGE: string =
  "none - an answer finds the cause when its root cause names it (pass --judge-llm-type for a judge)";

export default class BenchmarkReport {
  // One run's verdict and why, in a line: "PASS names the cause; cites the key evidence".
  public static describeResult(result: BenchmarkScenarioResult): string {
    if (!result.score) {
      return `ERROR ${result.error || "unknown error"}`;
    }

    const score: BenchmarkScore = result.score;
    const notes: Array<string> = [];
    const isInconclusive: boolean =
      result.expectationKind === BenchmarkExpectationKind.Inconclusive;

    if (score.judgeGrade !== undefined) {
      notes.push(`judge ${score.judgeGrade || "unreadable"}`);
    }

    if (score.judgeClassification !== undefined) {
      notes.push(
        `judge read it as ${score.judgeClassification || "unreadable"}`,
      );
    }

    if (!score.namesCause && score.missingTerms.length === 0) {
      // Every word was there to find, but there was no answer to find it in.
      notes.push("gave no answer");
    } else if (isInconclusive) {
      notes.push(
        score.namesCause
          ? "says it could not tell"
          : "does not say it could not tell",
      );
    } else {
      notes.push(
        score.namesCause
          ? "names the cause"
          : `missing: ${score.missingTerms.join(", ")}`,
      );
    }

    notes.push(
      score.citesKeyEvidence
        ? "cites the key evidence"
        : "cites none of the key evidence",
    );

    if (score.namedDistractors.length > 0) {
      notes.push(`named a wrong cause: ${score.namedDistractors.join(", ")}`);
    }

    if (result.stopReason) {
      notes.push(`stopped: ${result.stopReason}`);
    }

    if (result.error) {
      notes.push(result.error);
    }

    return `${score.passed ? "PASS" : "FAIL"} ${notes.join("; ")}`;
  }

  // "9 of 13 scenarios (31 of 39 runs, 79%)", or "9 of 13" when each ran once.
  public static describePassed(summary: BenchmarkSummary): string {
    const scenarios: string = `${summary.passedCount} of ${summary.scenarioCount} ${
      summary.scenarioCount === 1 ? "scenario" : "scenarios"
    }`;

    if (summary.runCount === summary.scenarioCount) {
      return scenarios;
    }

    return `${scenarios} (${summary.passedRunCount} of ${summary.runCount} runs, ${this.formatRate(summary.passRate)})`;
  }

  /*
   * What --fail-under asked, and whether the run met it: "at least 60% of
   * the scenarios (8 of 13): met". Undefined without it.
   */
  public static describeThreshold(
    summary: BenchmarkSummary,
    failUnder: BenchmarkFailUnder | undefined,
  ): string | undefined {
    if (!failUnder) {
      return undefined;
    }

    const asked: string =
      failUnder.percentage !== undefined
        ? `at least ${failUnder.given} of the scenarios (${failUnder.requiredPassedCount} of ${summary.scenarioCount})`
        : `at least ${failUnder.requiredPassedCount} of ${summary.scenarioCount} scenarios`;

    return `${asked}: ${
      summary.passedCount < failUnder.requiredPassedCount ? "not met" : "met"
    }`;
  }

  public static formatRate(rate: number): string {
    return `${Math.round(rate * 100)}%`;
  }

  public static buildTextReport(input: BenchmarkReportInput): Array<string> {
    const { summary } = input;
    const threshold: string | undefined = this.describeThreshold(
      summary,
      input.failUnder,
    );
    const lines: Array<string> = [
      "",
      "AI investigation benchmark — planted faults with known causes",
      "================================================================================",
      `Model under test: ${input.model}${
        input.personaFile ? `   persona: ${input.personaFile}` : ""
      }`,
      `Judge:            ${input.judge || NO_JUDGE}`,
      ...(input.repeat > 1
        ? [
            `Runs:             each scenario ${input.repeat} times; a scenario passes when more than half its runs pass`,
          ]
        : []),
      "",
      `  Passed:                      ${this.describePassed(summary)}`,
      ...(threshold ? [`  Threshold (--fail-under):    ${threshold}`] : []),
      `  Found the cause:             ${summary.foundCauseCount}`,
      `  Cited the key evidence:      ${summary.citedKeyEvidenceCount}`,
      `  Named a planted red herring: ${summary.namedDistractorCount}`,
      `  Errors:                      ${summary.erroredCount}`,
      `  Tool calls: ${summary.toolCallCount}   tokens: ${summary.totalTokens}   (results written to ${input.outputPath})`,
      "",
    ];

    for (const scenario of summary.scenarios) {
      const runs: Array<BenchmarkScenarioResult> = this.runsOf(
        input.results,
        scenario,
      );

      if (input.repeat > 1) {
        lines.push(
          `  ${scenario.scenarioId.padEnd(44)} ${scenario.faultKind.padEnd(15)} ${
            scenario.passed ? "PASS" : "FAIL"
          } ${scenario.passedRunCount} of ${scenario.runCount} runs passed`,
        );

        for (const run of runs) {
          lines.push(`      run ${run.run}: ${this.describeResult(run)}`);
        }

        continue;
      }

      for (const run of runs) {
        lines.push(
          `  ${scenario.scenarioId.padEnd(44)} ${scenario.faultKind.padEnd(15)} ${this.describeResult(run)}`,
        );
      }
    }

    lines.push(
      "",
      "A scenario passes when its root cause finds the planted fault (the judge says MATCH,",
      "or, with no judge, it names the fault) and cites at least one piece of key evidence.",
      "Where the evidence names no cause, it passes when it says it could not tell, names",
      "none of the planted wrong causes, and cites what it checked.",
      "",
    );

    return lines;
  }

  /*
   * The report in GitHub-flavoured Markdown, for a CI job's summary: the
   * verdict first, then a row per scenario, then each run folded away.
   */
  public static buildMarkdownReport(input: BenchmarkReportInput): string {
    const { summary } = input;
    const threshold: string | undefined = this.describeThreshold(
      summary,
      input.failUnder,
    );
    const lines: Array<string> = [
      "## AI investigation benchmark",
      "",
      `**Passed: ${this.describePassed(summary)}**, with ${this.cell(input.model)}.${
        threshold ? ` Threshold: ${threshold}.` : ""
      }`,
      "",
      `Judge: ${this.cell(input.judge || NO_JUDGE)}.${
        input.personaFile ? ` Persona: ${this.cell(input.personaFile)}.` : ""
      }${
        input.repeat > 1
          ? ` Each scenario ran ${input.repeat} times, and passes when more than half its runs pass.`
          : ""
      }`,
      "",
      "| Scenario | Subject | A right answer | Runs passed | Result |",
      "| --- | --- | --- | --- | --- |",
    ];

    for (const scenario of summary.scenarios) {
      lines.push(
        `| ${this.cell(scenario.title)} (\`${scenario.scenarioId}\`) | ${this.describeSubject(
          scenario.subjectKind,
        )} | ${this.describeExpectation(scenario.expectationKind)} | ${
          scenario.passedRunCount
        } of ${scenario.runCount} | ${scenario.passed ? "Passed" : "Failed"} |`,
      );
    }

    lines.push(
      "",
      "<details><summary>Each run</summary>",
      "",
      "| Scenario | Run | Result |",
      "| --- | --- | --- |",
    );

    for (const scenario of summary.scenarios) {
      for (const run of this.runsOf(input.results, scenario)) {
        lines.push(
          `| \`${scenario.scenarioId}\` | ${run.run} | ${this.cell(this.describeResult(run))} |`,
        );
      }
    }

    lines.push(
      "",
      "</details>",
      "",
      `Found the cause: ${summary.foundCauseCount}. Cited the key evidence: ${summary.citedKeyEvidenceCount}. Named a planted red herring: ${summary.namedDistractorCount}. Errors: ${summary.erroredCount}. Tool calls: ${summary.toolCallCount}. Tokens: ${summary.totalTokens}.`,
      "",
      `Every answer and score is in \`${input.outputPath}\`.`,
      "",
    );

    return lines.join("\n");
  }

  public static describeSubject(subjectKind: BenchmarkSubjectKind): string {
    return subjectKind === BenchmarkSubjectKind.Alert ? "Alert" : "Incident";
  }

  public static describeExpectation(kind: BenchmarkExpectationKind): string {
    return kind === BenchmarkExpectationKind.Inconclusive
      ? "Says the evidence names no cause"
      : "Names the planted cause";
  }

  // A scenario's runs, in the order they ran.
  private static runsOf(
    results: Array<BenchmarkScenarioResult>,
    scenario: BenchmarkScenarioSummary,
  ): Array<BenchmarkScenarioResult> {
    return results.filter((result: BenchmarkScenarioResult): boolean => {
      return result.scenarioId === scenario.scenarioId;
    });
  }

  /*
   * Text for a table cell: one line, its pipes escaped so the row keeps its
   * columns, and its backslashes too, so one before a pipe cannot undo that.
   */
  private static cell(text: string): string {
    return text.replace(/\s+/g, " ").trim().replace(/[\\|]/g, "\\$&");
  }
}
