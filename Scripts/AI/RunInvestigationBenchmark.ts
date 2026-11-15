import { BenchmarkScenario } from "Common/Server/Utils/AI/Eval/Benchmark/BenchmarkScenario";
import BENCHMARK_SCENARIOS from "Common/Server/Utils/AI/Eval/Benchmark/BenchmarkScenarios";
import InvestigationBenchmark, {
  BenchmarkScenarioResult,
  BenchmarkSummary,
} from "Common/Server/Utils/AI/Eval/Benchmark/InvestigationBenchmark";
import {
  describeModelOptions,
  EvalUsageError,
  getArgValue,
  PersonaFileOption,
  readJudgeOptions,
  readModelOptions,
  readPersonaFile,
} from "Common/Server/Utils/AI/Eval/EvalCommandLine";
import PinnedModel, {
  PinnedModelCall,
  PinnedModelOptions,
} from "Common/Server/Utils/AI/Eval/PinnedModel";
import fs from "fs";

/*
 * AI investigation benchmark — `npm run ai-benchmark` (issue #6800).
 *
 * Runs the real investigation loop - today's persona and prompt, the
 * toolbox's tools, the loop's limits - over made-up incidents whose cause
 * was planted (Eval/Benchmark/Scenarios), with the model named on the
 * command line, and scores each answer: does its root cause name the
 * planted fault, and does it cite the evidence for it. Every tool call is
 * answered from the scenario: no database, no project, no telemetry. Run it
 * before and after a prompt or model change and compare the pass counts.
 *
 * Writes every scenario's answer and score to ./ai-benchmark-results.json
 * (gitignored) and prints the report. It calls the model you name with your
 * key (AI_EVAL_LLM_API_KEY); no project is billed.
 *
 * Args (and the model options of EvalCommandLine: --llm-type, --model,
 * --base-url, --judge-llm-type, --judge-model, --judge-base-url):
 *   --scenario=<id>[,<id>]   run only these scenarios
 *   --persona-file=<path>    a draft persona to try in place of the code's
 *   --fail-under=<n>         exit 1 when fewer than n scenarios pass (for CI)
 *   --list                   list the scenarios and stop
 *
 *   npm run ai-benchmark -- --llm-type=Anthropic --model=claude-opus-5-5
 */

const OUTPUT_PATH: string = "./ai-benchmark-results.json";

const ARGV: ReadonlyArray<string> = process.argv.slice(2);

function print(lines: Array<string>): void {
  // A CLI report — stdout is the interface, matching the script idiom.
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
}

function pickScenarios(): Array<BenchmarkScenario> {
  const wanted: string | undefined = getArgValue(ARGV, "scenario");

  if (!wanted) {
    return [...BENCHMARK_SCENARIOS];
  }

  const ids: Array<string> = wanted
    .split(",")
    .map((id: string): string => {
      return id.trim();
    })
    .filter(Boolean);

  const unknown: Array<string> = ids.filter((id: string): boolean => {
    return !BENCHMARK_SCENARIOS.some((scenario: BenchmarkScenario): boolean => {
      return scenario.id === id;
    });
  });

  if (unknown.length > 0) {
    throw new EvalUsageError(
      `Unknown scenario(s): ${unknown.join(", ")}. Run with --list to see them.`,
    );
  }

  return BENCHMARK_SCENARIOS.filter((scenario: BenchmarkScenario): boolean => {
    return ids.includes(scenario.id);
  });
}

function readFailUnder(scenarioCount: number): number | undefined {
  const value: string | undefined = getArgValue(ARGV, "fail-under");

  if (value === undefined) {
    return undefined;
  }

  const parsed: number = Number(value);

  if (
    value.trim() === "" ||
    !Number.isInteger(parsed) ||
    parsed < 0 ||
    parsed > scenarioCount
  ) {
    throw new EvalUsageError(
      `--fail-under must be a whole number from 0 to ${scenarioCount}, got "${value}".`,
    );
  }

  return parsed;
}

function describeResult(result: BenchmarkScenarioResult): string {
  if (!result.score) {
    return `ERROR ${result.error || "unknown error"}`;
  }

  const notes: Array<string> = [];

  if (result.score.judgeGrade !== undefined) {
    notes.push(`judge ${result.score.judgeGrade || "unreadable"}`);
  }

  notes.push(
    result.score.namesCause
      ? "names the cause"
      : `missing: ${result.score.missingTerms.join(", ")}`,
  );
  notes.push(
    result.score.citesKeyEvidence
      ? "cites the evidence"
      : "cites none of the key evidence",
  );

  if (result.score.namedDistractors.length > 0) {
    notes.push(
      `named a wrong cause: ${result.score.namedDistractors.join(", ")}`,
    );
  }

  if (result.stopReason) {
    notes.push(`stopped: ${result.stopReason}`);
  }

  return `${result.score.passed ? "PASS " : "FAIL "} ${notes.join("; ")}`;
}

function printReport(data: {
  model: PinnedModelOptions;
  judge: PinnedModelOptions | null;
  personaFile: string | undefined;
  results: Array<BenchmarkScenarioResult>;
  summary: BenchmarkSummary;
}): void {
  const { summary } = data;
  const lines: Array<string> = [
    "",
    "AI investigation benchmark — planted faults with known causes",
    "================================================================================",
    `Model under test: ${describeModelOptions(data.model)}${
      data.personaFile ? `   persona: ${data.personaFile}` : ""
    }`,
    `Judge:            ${
      data.judge
        ? describeModelOptions(data.judge)
        : "none - an answer finds the cause when its root cause names it (pass --judge-llm-type for a judge)"
    }`,
    "",
    `  Passed:                    ${summary.passedCount} of ${summary.scenarioCount}`,
    `  Found the cause:           ${summary.foundCauseCount}`,
    `  Cited the key evidence:    ${summary.citedKeyEvidenceCount}`,
    `  Named a planted red herring: ${summary.namedDistractorCount}`,
    `  Errors:                    ${summary.erroredCount}`,
    `  Tool calls: ${summary.toolCallCount}   tokens: ${summary.totalTokens}   (results written to ${OUTPUT_PATH})`,
    "",
  ];

  for (const result of data.results) {
    lines.push(
      `  ${result.scenarioId.padEnd(44)} ${result.faultKind.padEnd(15)} ${describeResult(result)}`,
    );
  }

  lines.push(
    "",
    "A scenario passes when its root cause finds the planted fault (the judge says MATCH,",
    "or, with no judge, it names the fault) and cites at least one piece of key evidence.",
    "",
  );

  print(lines);
}

async function main(): Promise<number> {
  if (ARGV.includes("--list")) {
    print(
      BENCHMARK_SCENARIOS.map((scenario: BenchmarkScenario): string => {
        return `${scenario.id.padEnd(44)} ${scenario.faultKind.padEnd(15)} ${scenario.title}`;
      }),
    );
    return 0;
  }

  const model: PinnedModelOptions = readModelOptions(ARGV, process.env);
  const judge: PinnedModelOptions | null = readJudgeOptions(ARGV, process.env);
  const scenarios: Array<BenchmarkScenario> = pickScenarios();
  const failUnder: number | undefined = readFailUnder(scenarios.length);
  const { personaFile, persona }: PersonaFileOption = readPersonaFile(ARGV);

  const callModel: PinnedModelCall = PinnedModel.create(model);
  const judgeModel: PinnedModelCall | undefined = judge
    ? PinnedModel.create(judge)
    : undefined;

  print([
    "",
    `Running ${scenarios.length} scenario(s) with ${describeModelOptions(model)}...`,
  ]);

  const results: Array<BenchmarkScenarioResult> = [];

  for (const scenario of scenarios) {
    const result: BenchmarkScenarioResult =
      await InvestigationBenchmark.runScenario({
        scenario,
        callModel,
        judge: judgeModel,
        persona,
      });

    results.push(result);
    print([
      `  [${results.length}/${scenarios.length}] ${scenario.id}: ${describeResult(result)}`,
    ]);
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2), "utf8");

  const summary: BenchmarkSummary = InvestigationBenchmark.summarize(results);

  printReport({ model, judge, personaFile, results, summary });

  if (failUnder !== undefined && summary.passedCount < failUnder) {
    print([
      `Fewer scenarios passed (${summary.passedCount}) than --fail-under=${failUnder}.`,
    ]);
    return 1;
  }

  return 0;
}

main()
  .then((exitCode: number) => {
    process.exit(exitCode);
  })
  .catch((error: unknown) => {
    if (error instanceof EvalUsageError) {
      // A usage hint: its message is the whole of it.
      // eslint-disable-next-line no-console
      console.error(error.message);
    } else {
      // eslint-disable-next-line no-console
      console.error("Investigation benchmark failed:");
      // eslint-disable-next-line no-console
      console.error(error);
    }
    process.exit(1);
  });
