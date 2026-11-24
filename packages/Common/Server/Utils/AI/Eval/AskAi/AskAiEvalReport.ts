import { BenchmarkFailUnder } from "../Benchmark/BenchmarkCommandLine";
import {
  AskAiGrade,
  describeOfferedPage,
  getCitedDocsPages,
  getOfferedPages,
} from "./AskAiEvalGrades";
import {
  AskAiEvalCall,
  AskAiEvalRefusal,
  AskAiEvalTurn,
} from "./AskAiEvalTurn";

/*
 * THE REPORT OF AN ASK AI EVAL (#7246, #7066): one line for each setup
 * request and how-do-I question, passed or failed, with what the model
 * proposed or cited and why it failed; the pass counts of each list; and
 * the same as Markdown for a CI job's summary or an issue. Shared by both
 * lists, as the runner is (App's scripts/ask-ai-eval.ts).
 */

export enum AskAiEvalSuite {
  Setup = "setup",
  HowDoI = "how-do-i",
}

export const ASK_AI_EVAL_SUITE_TITLES: Record<AskAiEvalSuite, string> = {
  [AskAiEvalSuite.Setup]: "Setup requests",
  [AskAiEvalSuite.HowDoI]: "How-do-I questions",
};

// One run of one case, as the report keeps it.
export interface AskAiEvalRun {
  run: number;
  passed: boolean;
  reasons: Array<string>;
  // What the person would have seen.
  proposed: Array<string>;
  refusedBeforeCard: Array<string>;
  citedDocs: Array<string>;
  offeredPages: Array<string>;
  answer: string;
  llmCallCount: number;
  totalTokens: number;
  durationMs: number;
}

export interface AskAiEvalCaseResult {
  suite: AskAiEvalSuite;
  id: string;
  // The request or question, as the person typed it.
  asked: string;
  // The project it was asked in, or the language.
  context: string;
  runs: Array<AskAiEvalRun>;
  passedRuns: number;
  // More than half its runs passed.
  passed: boolean;
}

export interface AskAiEvalSummary {
  caseCount: number;
  passedCount: number;
  bySuite: Array<{
    suite: AskAiEvalSuite;
    caseCount: number;
    passedCount: number;
  }>;
  llmCallCount: number;
  totalTokens: number;
}

export interface AskAiEvalReportInput {
  model: string;
  repeat: number;
  results: Array<AskAiEvalCaseResult>;
  summary: AskAiEvalSummary;
  failUnder?: BenchmarkFailUnder | undefined;
  outputPath: string;
}

// An answer as the report shows it: one line, and not all of a long one.
const ANSWER_CHARACTERS: number = 300;

function oneLine(text: string, limit: number): string {
  const line: string = text.replace(/\s+/g, " ").trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

function describeCall(call: AskAiEvalCall): string {
  return `${call.name}(${JSON.stringify(call.arguments)})`;
}

// A pipe, a backslash before one, or a line break would end a table's cell.
function cell(text: string): string {
  return text
    .replace(/[\\|]/g, (character: string): string => {
      return `\\${character}`;
    })
    .replace(/\s*\n\s*/g, " ");
}

export default class AskAiEvalReport {
  public static toRun(data: {
    run: number;
    grade: AskAiGrade;
    turn: AskAiEvalTurn;
  }): AskAiEvalRun {
    return {
      run: data.run,
      passed: data.grade.passed,
      reasons: data.grade.reasons,
      proposed: data.turn.proposed.map(describeCall),
      refusedBeforeCard: data.turn.refusedBeforeCard.map(
        (refusal: AskAiEvalRefusal): string => {
          return `${refusal.name}: ${refusal.reason}`;
        },
      ),
      citedDocs: getCitedDocsPages(data.turn),
      // A record's page with the record's name: "Custom Domains (Acme Status)".
      offeredPages: getOfferedPages(data.turn).map(describeOfferedPage),
      answer: oneLine(data.turn.answer, ANSWER_CHARACTERS),
      llmCallCount: data.turn.llmCallCount,
      totalTokens: data.turn.totalTokens,
      durationMs: data.turn.durationMs,
    };
  }

  public static toCaseResult(data: {
    suite: AskAiEvalSuite;
    id: string;
    asked: string;
    context: string;
    runs: Array<AskAiEvalRun>;
  }): AskAiEvalCaseResult {
    const passedRuns: number = data.runs.filter((run: AskAiEvalRun) => {
      return run.passed;
    }).length;

    return {
      ...data,
      passedRuns,
      passed: passedRuns * 2 > data.runs.length,
    };
  }

  public static summarize(
    results: ReadonlyArray<AskAiEvalCaseResult>,
  ): AskAiEvalSummary {
    const runs: Array<AskAiEvalRun> = results.flatMap(
      (result: AskAiEvalCaseResult): Array<AskAiEvalRun> => {
        return result.runs;
      },
    );

    return {
      caseCount: results.length,
      passedCount: results.filter((result: AskAiEvalCaseResult) => {
        return result.passed;
      }).length,
      bySuite: Object.values(AskAiEvalSuite)
        .map((suite: AskAiEvalSuite) => {
          const ofSuite: Array<AskAiEvalCaseResult> = results.filter(
            (result: AskAiEvalCaseResult): boolean => {
              return result.suite === suite;
            },
          );

          return {
            suite,
            caseCount: ofSuite.length,
            passedCount: ofSuite.filter((result: AskAiEvalCaseResult) => {
              return result.passed;
            }).length,
          };
        })
        .filter((row: { caseCount: number }): boolean => {
          return row.caseCount > 0;
        }),
      llmCallCount: runs.reduce((sum: number, run: AskAiEvalRun) => {
        return sum + run.llmCallCount;
      }, 0),
      totalTokens: runs.reduce((sum: number, run: AskAiEvalRun) => {
        return sum + run.totalTokens;
      }, 0),
    };
  }

  // "Passed 14 of 20 (70%)".
  public static describePassed(passed: number, total: number): string {
    const percent: number =
      total === 0 ? 0 : Math.round((passed * 100) / total);
    return `Passed ${passed} of ${total} (${percent}%)`;
  }

  // What one case's runs showed, for its line of the report.
  public static describeCase(result: AskAiEvalCaseResult): string {
    const runs: Array<AskAiEvalRun> = result.runs;
    const failed: AskAiEvalRun | undefined = runs.find((run: AskAiEvalRun) => {
      return !run.passed;
    });
    const shown: AskAiEvalRun = failed || runs[0]!;
    const what: string =
      result.suite === AskAiEvalSuite.Setup
        ? shown.proposed.length > 0
          ? `proposed ${shown.proposed.join(", ")}`
          : "proposed nothing"
        : `cited ${shown.citedDocs.join(", ") || "no docs page"}${
            shown.offeredPages.length > 0
              ? `; Go to ${shown.offeredPages.join(", ")}`
              : ""
          }`;
    const rate: string =
      runs.length > 1 ? ` (${result.passedRuns} of ${runs.length} runs)` : "";

    return failed
      ? `FAIL${rate}: ${failed.reasons.join(" ")} [${what}]`
      : `pass${rate} [${what}]`;
  }

  public static buildTextReport(input: AskAiEvalReportInput): Array<string> {
    const lines: Array<string> = [
      "",
      `Ask AI eval with ${input.model}${
        input.repeat > 1 ? `, ${input.repeat} runs a case` : ""
      }`,
    ];

    for (const row of input.summary.bySuite) {
      lines.push(
        "",
        `${ASK_AI_EVAL_SUITE_TITLES[row.suite]}: ${this.describePassed(
          row.passedCount,
          row.caseCount,
        )}`,
      );

      for (const result of input.results) {
        if (result.suite === row.suite) {
          lines.push(
            `  ${result.id.padEnd(12)} ${oneLine(result.asked, 70)} (${result.context}): ${this.describeCase(result)}`,
          );
        }
      }
    }

    lines.push(
      "",
      `${this.describePassed(input.summary.passedCount, input.summary.caseCount)}, in ${input.summary.llmCallCount} model calls and ${input.summary.totalTokens} tokens.`,
    );

    if (input.failUnder) {
      lines.push(
        `--fail-under=${input.failUnder.given} asks for ${input.failUnder.requiredPassedCount}.`,
      );
    }

    lines.push(`Every answer and grade: ${input.outputPath}`);

    return lines;
  }

  public static buildMarkdownReport(input: AskAiEvalReportInput): string {
    const lines: Array<string> = [
      `## Ask AI eval: ${this.describePassed(
        input.summary.passedCount,
        input.summary.caseCount,
      )}`,
      "",
      `Model: ${input.model}${
        input.repeat > 1
          ? `, ${input.repeat} runs a case (a case passes when more than half its runs pass)`
          : ""
      }. ${input.summary.llmCallCount} model calls, ${input.summary.totalTokens} tokens.${
        input.failUnder
          ? ` --fail-under=${input.failUnder.given} asks for ${input.failUnder.requiredPassedCount}.`
          : ""
      }`,
    ];

    for (const row of input.summary.bySuite) {
      lines.push(
        "",
        `### ${ASK_AI_EVAL_SUITE_TITLES[row.suite]}: ${this.describePassed(
          row.passedCount,
          row.caseCount,
        )}`,
        "",
        "| Case | Asked | In | Result |",
        "| --- | --- | --- | --- |",
      );

      for (const result of input.results) {
        if (result.suite === row.suite) {
          lines.push(
            `| ${result.id} | ${cell(oneLine(result.asked, 90))} | ${cell(result.context)} | ${cell(this.describeCase(result))} |`,
          );
        }
      }
    }

    return `${lines.join("\n")}\n\n`;
  }

  // What the report says when no model could be called.
  public static buildSkippedMarkdown(reason: string): string {
    return `## Ask AI eval: skipped\n\nNothing was run and no model was called: ${reason}\n\n`;
  }
}
