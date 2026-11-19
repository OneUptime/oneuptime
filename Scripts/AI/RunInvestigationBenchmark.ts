import { BenchmarkScenario } from "Common/Server/Utils/AI/Eval/Benchmark/BenchmarkScenario";
import BENCHMARK_SCENARIOS from "Common/Server/Utils/AI/Eval/Benchmark/BenchmarkScenarios";
import BenchmarkCommandLine, {
  BenchmarkFailUnder,
} from "Common/Server/Utils/AI/Eval/Benchmark/BenchmarkCommandLine";
import BenchmarkReport, {
  BenchmarkReportInput,
} from "Common/Server/Utils/AI/Eval/Benchmark/BenchmarkReport";
import InvestigationBenchmark, {
  BenchmarkScenarioResult,
  BenchmarkSummary,
} from "Common/Server/Utils/AI/Eval/Benchmark/InvestigationBenchmark";
import {
  describeModelOptions,
  EvalUsageError,
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
 * AI investigation benchmark — `npm run ai-benchmark` (issues #6800, #7766).
 *
 * Runs the real investigation loop - today's persona and prompt, the
 * toolbox's tools, the loop's limits - over made-up incidents and alerts
 * whose cause was planted (Eval/Benchmark/Scenarios), with the model named on
 * the command line, and scores each answer: does its root cause name the
 * planted fault, and does it cite the evidence for it (or, where the
 * evidence names no cause, does it say so). Every tool call is answered from
 * the scenario: no database, no project, no telemetry. Run it before and
 * after a prompt or model change and compare the pass counts.
 *
 * Writes every run's answer and score, and the summary, to
 * ./ai-benchmark-results.json (gitignored) and prints the report. It calls
 * the model you name with your key (AI_EVAL_LLM_API_KEY); no project is
 * billed. The AI Benchmark workflow runs it in CI (#7764).
 *
 * Args (and the model options of EvalCommandLine: --llm-type, --model,
 * --base-url, --judge-llm-type, --judge-model, --judge-base-url):
 *   --scenario=<id>[,<id>]    run only these scenarios
 *   --repeat=<k>              run each scenario k times; it passes when more
 *                             than half its runs pass
 *   --persona-file=<path>     a draft persona to try in place of the code's
 *   --fail-under=<n>|<p>%     exit 1 when fewer than n scenarios pass, or
 *                             fewer than p% of them (for CI)
 *   --report-markdown=<path>  add the report, in Markdown, to the end of a
 *                             file (a CI job's summary)
 *   --list                    list the scenarios and stop
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
  const scenarios: Array<BenchmarkScenario> =
    BenchmarkCommandLine.pickScenarios(ARGV, BENCHMARK_SCENARIOS);
  const repeat: number = BenchmarkCommandLine.readRepeat(ARGV);
  const failUnder: BenchmarkFailUnder | undefined =
    BenchmarkCommandLine.readFailUnder(ARGV, scenarios.length);
  const reportMarkdownPath: string | undefined =
    BenchmarkCommandLine.readReportMarkdownPath(ARGV);
  const { personaFile, persona }: PersonaFileOption = readPersonaFile(ARGV);

  const callModel: PinnedModelCall = PinnedModel.create(model);
  const judgeModel: PinnedModelCall | undefined = judge
    ? PinnedModel.create(judge)
    : undefined;

  const runCount: number = scenarios.length * repeat;

  print([
    "",
    `Running ${scenarios.length} scenario(s)${
      repeat > 1 ? `, ${repeat} times each` : ""
    }, with ${describeModelOptions(model)}...`,
  ]);

  const results: Array<BenchmarkScenarioResult> = [];

  for (const scenario of scenarios) {
    for (let run: number = 1; run <= repeat; run++) {
      const result: BenchmarkScenarioResult =
        await InvestigationBenchmark.runScenario({
          scenario,
          callModel,
          judge: judgeModel,
          persona,
          run,
        });

      results.push(result);
      print([
        `  [${results.length}/${runCount}] ${scenario.id}${
          repeat > 1 ? ` (run ${run})` : ""
        }: ${BenchmarkReport.describeResult(result)}`,
      ]);
    }
  }

  const summary: BenchmarkSummary = InvestigationBenchmark.summarize(results);
  const report: BenchmarkReportInput = {
    model: describeModelOptions(model),
    judge: judge ? describeModelOptions(judge) : null,
    personaFile,
    repeat,
    results,
    summary,
    failUnder,
    outputPath: OUTPUT_PATH,
  };

  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        model: report.model,
        judge: report.judge,
        personaFile: personaFile || null,
        repeat,
        failUnder: failUnder || null,
        summary,
        results,
      },
      null,
      2,
    ),
    "utf8",
  );

  print(BenchmarkReport.buildTextReport(report));

  if (reportMarkdownPath) {
    fs.appendFileSync(
      reportMarkdownPath,
      BenchmarkReport.buildMarkdownReport(report),
      "utf8",
    );
  }

  if (BenchmarkCommandLine.isUnderThreshold(summary.passedCount, failUnder)) {
    print([
      `Fewer scenarios passed (${summary.passedCount}) than --fail-under=${failUnder!.given} asks (${failUnder!.requiredPassedCount}).`,
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
