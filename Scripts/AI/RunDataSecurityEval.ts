import { DataSecurityAiFeature } from "Common/Types/DataSecurity/DataSecurityAiFeatures";
import BenchmarkCommandLine from "Common/Server/Utils/AI/Eval/Benchmark/BenchmarkCommandLine";
import DataSecurityEval, {
  DataSecurityEvalResult,
  DataSecurityEvalSummary,
} from "Common/Server/Utils/AI/Eval/DataSecurity/DataSecurityEval";
import { DataSecurityEvalCase } from "Common/Server/Utils/AI/Eval/DataSecurity/DataSecurityEvalCase";
import DATA_SECURITY_EVAL_CASES from "Common/Server/Utils/AI/Eval/DataSecurity/DataSecurityEvalCases";
import DataSecurityEvalCommandLine from "Common/Server/Utils/AI/Eval/DataSecurity/DataSecurityEvalCommandLine";
import DataSecurityEvalReport, {
  DataSecurityEvalReportInput,
} from "Common/Server/Utils/AI/Eval/DataSecurity/DataSecurityEvalReport";
import {
  describeModelOptions,
  EvalUsageError,
  hasFlag,
  readModelOptions,
} from "Common/Server/Utils/AI/Eval/EvalCommandLine";
import PinnedModel, {
  PinnedModelCall,
  PinnedModelOptions,
} from "Common/Server/Utils/AI/Eval/PinnedModel";
import fs from "fs";

/*
 * Data Security AI eval - `npm run ai-data-security-eval` (#10365).
 *
 * Runs every OneUptime AI feature of Data Security on fixed, made-up cases
 * (Eval/DataSecurity/DataSecurityEvalCases), each case's input built by the
 * feature's own builder, with the model named on the command line, and
 * scores each answer by words a check reads: Explain with AI says what the
 * issue needs and nothing a planted instruction asked; the field
 * suggestions give each field its type; Fix with AI's request leads to the
 * change the check needs; Ask AI answers from the rows its tools read. No
 * database, no project: the model is called with your key
 * (AI_EVAL_LLM_API_KEY), and no project is billed.
 *
 * Writes every answer and score, and the score of each feature, to
 * ./ai-data-security-eval-results.json (gitignored) and prints the report.
 * The Data Security AI Eval workflow runs it nightly, by hand, and on a
 * pull request that changes a feature's prompt - that feature's cases only
 * (--changed-files) - and the release checklist reads each feature's score
 * against its threshold.
 *
 * Args (and the model options of EvalCommandLine: --llm-type, --model,
 * --base-url):
 *   --feature=<id>[,<id>]   only these features' cases
 *   --case=<id>[,<id>]      only these cases
 *   --changed-files=<path>  only the features the listed files change
 *   --repeat=<k>            run each case k times; it passes when more than
 *                           half its runs pass
 *   --enforce-thresholds    exit 1 when a feature scores under its threshold
 *   --report-markdown=<path> add the report, in Markdown, to a file's end
 *   --list                  list the cases and stop
 *
 *   npm run ai-data-security-eval -- --llm-type=Anthropic --model=claude-opus-5-5
 */

const OUTPUT_PATH: string = "./ai-data-security-eval-results.json";

const ARGV: ReadonlyArray<string> = process.argv.slice(2);

function print(lines: Array<string>): void {
  // A CLI report — stdout is the interface, matching the script idiom.
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
}

// The features to run: those --changed-files' paths change, else --feature's.
function readFeatures(): Array<DataSecurityAiFeature> {
  const changedFilesPath: string | undefined =
    DataSecurityEvalCommandLine.readChangedFilesPath(ARGV);
  const asked: Array<DataSecurityAiFeature> =
    DataSecurityEvalCommandLine.readFeatures(ARGV);

  if (!changedFilesPath) {
    return asked;
  }

  const changed: Array<DataSecurityAiFeature> =
    DataSecurityEvalCommandLine.featuresForChangedFiles(
      fs.readFileSync(changedFilesPath, "utf8").split("\n"),
    );

  return asked.filter((feature: DataSecurityAiFeature): boolean => {
    return changed.includes(feature);
  });
}

async function main(): Promise<number> {
  if (hasFlag(ARGV, "list")) {
    print(
      DATA_SECURITY_EVAL_CASES.map((testCase: DataSecurityEvalCase): string => {
        return `${testCase.id.padEnd(44)} ${testCase.feature.padEnd(18)} ${testCase.title}`;
      }),
    );
    return 0;
  }

  const model: PinnedModelOptions = readModelOptions(ARGV, process.env);
  const features: Array<DataSecurityAiFeature> = readFeatures();
  const cases: Array<DataSecurityEvalCase> =
    DataSecurityEvalCommandLine.pickCases({
      argv: ARGV,
      cases: DATA_SECURITY_EVAL_CASES,
      features,
    });
  const repeat: number = BenchmarkCommandLine.readRepeat(ARGV);
  const reportMarkdownPath: string | undefined =
    BenchmarkCommandLine.readReportMarkdownPath(ARGV);
  const areThresholdsEnforced: boolean = hasFlag(ARGV, "enforce-thresholds");

  if (cases.length === 0) {
    print(["", "No Data Security AI feature is changed: nothing to run."]);

    if (reportMarkdownPath) {
      fs.appendFileSync(
        reportMarkdownPath,
        "## Data Security AI eval\n\nNo Data Security AI feature is changed, so no case ran and no model was called.\n",
        "utf8",
      );
    }

    return 0;
  }

  const callModel: PinnedModelCall = PinnedModel.create(model);
  const runCount: number = cases.length * repeat;
  const results: Array<DataSecurityEvalResult> = [];

  print([
    "",
    `Running ${cases.length} case(s)${repeat > 1 ? `, ${repeat} times each` : ""}, with ${describeModelOptions(model)}...`,
  ]);

  for (const testCase of cases) {
    for (let run: number = 1; run <= repeat; run++) {
      const result: DataSecurityEvalResult = await DataSecurityEval.runCase({
        testCase,
        callModel,
        run,
      });

      results.push(result);
      print([
        `  [${results.length}/${runCount}] ${testCase.id}${repeat > 1 ? ` (run ${run})` : ""}: ${DataSecurityEvalReport.describeResult(result)}`,
      ]);
    }
  }

  const summary: DataSecurityEvalSummary = DataSecurityEval.summarize(results);
  const report: DataSecurityEvalReportInput = {
    model: describeModelOptions(model),
    repeat,
    results,
    summary,
    areThresholdsEnforced,
    outputPath: OUTPUT_PATH,
  };

  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify({ model: report.model, repeat, summary, results }, null, 2),
    "utf8",
  );

  print(DataSecurityEvalReport.buildTextReport(report));

  if (reportMarkdownPath) {
    fs.appendFileSync(
      reportMarkdownPath,
      DataSecurityEvalReport.buildMarkdownReport(report),
      "utf8",
    );
  }

  return areThresholdsEnforced &&
    DataSecurityEvalReport.isUnderAThreshold(summary)
    ? 1
    : 0;
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
      console.error("Data Security AI eval failed:");
      // eslint-disable-next-line no-console
      console.error(error);
    }
    process.exit(1);
  });
