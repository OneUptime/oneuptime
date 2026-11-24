import DocsAIReader from "../FeatureSet/Docs/Utils/AIDocsReader";
import * as DocsConfig from "../FeatureSet/Docs/Utils/Config";
import { AskAiEvalCase, getAskAiEvalCases } from "./ask-ai-eval-cases";
import AIDocsLibrary from "Common/Server/Utils/AI/Docs/AIDocsLibrary";
import {
  AskAiGrade,
  gradeHowDoITurn,
  gradeSetupTurn,
} from "Common/Server/Utils/AI/Eval/AskAi/AskAiEvalGrades";
import {
  AskAiEvalProject,
  AskAiEvalProjectKind,
  getAskAiEvalProject,
} from "Common/Server/Utils/AI/Eval/AskAi/AskAiEvalProject";
import AskAiEvalReport, {
  AskAiEvalCaseResult,
  AskAiEvalReportInput,
  AskAiEvalRun,
  AskAiEvalSuite,
} from "Common/Server/Utils/AI/Eval/AskAi/AskAiEvalReport";
import AskAiEvalTurnRunner, {
  AskAiEvalTurn,
} from "Common/Server/Utils/AI/Eval/AskAi/AskAiEvalTurn";
import BenchmarkCommandLine, {
  BenchmarkFailUnder,
} from "Common/Server/Utils/AI/Eval/Benchmark/BenchmarkCommandLine";
import {
  describeModelOptions,
  EvalUsageError,
  getArgValue,
  MODEL_API_KEY_ENV,
  readModelOptions,
} from "Common/Server/Utils/AI/Eval/EvalCommandLine";
import PinnedModel, {
  PinnedModelCall,
  PinnedModelOptions,
} from "Common/Server/Utils/AI/Eval/PinnedModel";
import LlmType from "Common/Types/LLM/LlmType";
import fs from "fs";
import path from "path";

/*
 * Ask AI eval - `npm run ask-ai-eval` (#7246, #7066).
 *
 * Asks a live model what people ask Ask AI, through Ask AI's own chat turn
 * (ChatAgentRunner, in Ask to act: today's prompt, tools and limits), and
 * grades each answer:
 *
 *   - setup: each request of Common's Tests/Server/Utils/AI/
 *     AskAiSetupRequests.ts, in the project it names (AskAiEvalProject),
 *     passes when the plan proposed for one approval card is the request's
 *     (AskAiEvalGrades.gradeSetupTurn);
 *   - how-do-i: each question of Tests/FeatureSet/Docs/
 *     AskAiHowDoIQuestions.ts passes when the answer cites the docs page
 *     that answers it and ends with the Go to button for its page, or says
 *     the docs do not cover it (AskAiEvalGrades.gradeHowDoITurn). The docs
 *     are this repository's, read as the Docs feature set reads them.
 *
 * Nothing is read from a database and no action runs: a plan stops at its
 * card (AskAiEvalTurn). The model is called with your key
 * (AI_EVAL_LLM_API_KEY); no project is billed. Without the key it says so
 * and exits 0, having called nothing. Writes every answer and grade to
 * ./ask-ai-eval-results.json (gitignored) and prints the report.
 *
 * Args (and the model options of EvalCommandLine: --llm-type, --model,
 * --base-url):
 *   --suite=setup|how-do-i    ask one list only; both without it
 *   --case=<id>[,<id>]        ask only these (setup-3, how-do-i-12)
 *   --repeat=<k>              ask each case k times; it passes when more
 *                             than half its runs pass
 *   --fail-under=<n>|<p>%     exit 1 when fewer than n cases pass, or
 *                             fewer than p% of them
 *   --report-markdown=<path>  add the report, in Markdown, to the end of a
 *                             file (a CI job's summary, or an issue's text)
 *   --list                    list the cases and stop
 *
 *   npm run ask-ai-eval -- --llm-type=Anthropic --model=claude-opus-5-5
 */

const OUTPUT_FILE: string = "ask-ai-eval-results.json";

// Providers that answer without a key: a model of your own.
const KEYLESS_PROVIDERS: ReadonlyArray<LlmType> = [
  LlmType.Ollama,
  LlmType.OpenAICompatible,
];

const ARGV: ReadonlyArray<string> = process.argv.slice(2);

function print(lines: Array<string>): void {
  // A CLI report: stdout is the interface, as the other evals print theirs.
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
}

/*
 * The docs as this checkout has them. The Docs feature set reads them where
 * the App's image keeps them (/usr/src/app/FeatureSet/Docs), which a
 * checkout is not; it reads each path when it reads a page, so pointing
 * the paths here is enough.
 */
export function readDocsFromThisCheckout(): void {
  const root: string = path.resolve(__dirname, "../FeatureSet/Docs");

  Object.assign(DocsConfig as unknown as Record<string, string>, {
    ContentPath: path.join(root, "Content"),
    StaticPath: path.join(root, "Static"),
    ViewsPath: path.join(root, "Views"),
  });
}

// --suite: one list, or both.
export function readSuites(argv: ReadonlyArray<string>): Array<AskAiEvalSuite> {
  const value: string | undefined = getArgValue(argv, "suite")?.trim();

  if (!value) {
    return [AskAiEvalSuite.Setup, AskAiEvalSuite.HowDoI];
  }

  const suite: AskAiEvalSuite | undefined = Object.values(AskAiEvalSuite).find(
    (candidate: AskAiEvalSuite): boolean => {
      return candidate === value;
    },
  );

  if (!suite) {
    throw new EvalUsageError(
      `--suite must be ${Object.values(AskAiEvalSuite).join(" or ")}, got "${value}".`,
    );
  }

  return [suite];
}

// --case: the cases it names, in their lists' order; all without it.
export function pickCases(
  argv: ReadonlyArray<string>,
  cases: ReadonlyArray<AskAiEvalCase>,
): Array<AskAiEvalCase> {
  const ids: Array<string> = (getArgValue(argv, "case") || "")
    .split(",")
    .map((id: string): string => {
      return id.trim();
    })
    .filter(Boolean);

  if (ids.length === 0) {
    return [...cases];
  }

  const unknown: Array<string> = ids.filter((id: string): boolean => {
    return !cases.some((evalCase: AskAiEvalCase): boolean => {
      return evalCase.id === id;
    });
  });

  if (unknown.length > 0) {
    throw new EvalUsageError(
      `Unknown case(s): ${unknown.join(", ")}. Run with --list to see them.`,
    );
  }

  return cases.filter((evalCase: AskAiEvalCase): boolean => {
    return ids.includes(evalCase.id);
  });
}

async function askOnce(data: {
  evalCase: AskAiEvalCase;
  callModel: PinnedModelCall;
  run: number;
}): Promise<AskAiEvalRun> {
  const { evalCase } = data;
  const project: AskAiEvalProject = getAskAiEvalProject(
    evalCase.setup?.projectKind ||
      evalCase.howDoI?.projectKind ||
      AskAiEvalProjectKind.PagesNobody,
  );
  const turn: AskAiEvalTurn = await AskAiEvalTurnRunner.ask({
    question: evalCase.asked,
    project,
    callModel: data.callModel,
    language: evalCase.setup?.language || evalCase.howDoI?.language || "en",
    // A question asked on a page, with the context that page sends (#7062).
    pageContext: evalCase.howDoI?.pageContext,
  });
  const grade: AskAiGrade = evalCase.setup
    ? gradeSetupTurn(evalCase.setup, project, turn)
    : gradeHowDoITurn(evalCase.howDoI!, turn);

  return AskAiEvalReport.toRun({ run: data.run, grade, turn });
}

async function main(): Promise<number> {
  const cases: Array<AskAiEvalCase> = pickCases(
    ARGV,
    getAskAiEvalCases(readSuites(ARGV)),
  );

  if (ARGV.includes("--list")) {
    print(
      cases.map((evalCase: AskAiEvalCase): string => {
        return `${evalCase.id.padEnd(12)} ${evalCase.context.padEnd(24)} ${evalCase.asked}`;
      }),
    );
    return 0;
  }

  const model: PinnedModelOptions = readModelOptions(ARGV, process.env);
  const repeat: number = BenchmarkCommandLine.readRepeat(ARGV);
  const failUnder: BenchmarkFailUnder | undefined =
    BenchmarkCommandLine.readFailUnder(ARGV, cases.length);
  const reportMarkdownPath: string | undefined =
    BenchmarkCommandLine.readReportMarkdownPath(ARGV);

  if (!model.apiKey && !KEYLESS_PROVIDERS.includes(model.llmType)) {
    const reason: string = `${MODEL_API_KEY_ENV} is not set. Set it to a key for ${describeModelOptions(model)} to run the eval (Docs/ai/evals.md).`;

    print([
      `Ask AI eval skipped: nothing was run and no model was called. ${reason}`,
    ]);

    if (reportMarkdownPath) {
      fs.appendFileSync(
        reportMarkdownPath,
        AskAiEvalReport.buildSkippedMarkdown(reason),
        "utf8",
      );
    }

    return 0;
  }

  // The docs this repository serves, read as the Docs feature set reads them.
  readDocsFromThisCheckout();
  AIDocsLibrary.setReader(new DocsAIReader());

  const callModel: PinnedModelCall = PinnedModel.create(model);
  const outputPath: string = path.resolve(
    process.env["INIT_CWD"] || process.cwd(),
    OUTPUT_FILE,
  );

  print([
    "",
    `Asking ${cases.length} case(s)${
      repeat > 1 ? `, ${repeat} times each` : ""
    }, with ${describeModelOptions(model)}...`,
  ]);

  const results: Array<AskAiEvalCaseResult> = [];
  let asked: number = 0;

  for (const evalCase of cases) {
    const runs: Array<AskAiEvalRun> = [];

    for (let run: number = 1; run <= repeat; run++) {
      runs.push(await askOnce({ evalCase, callModel, run }));
      asked++;
    }

    const result: AskAiEvalCaseResult = AskAiEvalReport.toCaseResult({
      suite: evalCase.suite,
      id: evalCase.id,
      asked: evalCase.asked,
      context: evalCase.context,
      runs,
    });

    results.push(result);
    print([
      `  [${asked}/${cases.length * repeat}] ${result.id}: ${AskAiEvalReport.describeCase(result)}`,
    ]);
  }

  const report: AskAiEvalReportInput = {
    model: describeModelOptions(model),
    repeat,
    results,
    summary: AskAiEvalReport.summarize(results),
    failUnder,
    outputPath,
  };

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        model: report.model,
        repeat,
        failUnder: failUnder || null,
        summary: report.summary,
        results,
      },
      null,
      2,
    ),
    "utf8",
  );

  print(AskAiEvalReport.buildTextReport(report));

  if (reportMarkdownPath) {
    fs.appendFileSync(
      reportMarkdownPath,
      AskAiEvalReport.buildMarkdownReport(report),
      "utf8",
    );
  }

  if (
    BenchmarkCommandLine.isUnderThreshold(report.summary.passedCount, failUnder)
  ) {
    print([
      `Fewer cases passed (${report.summary.passedCount}) than --fail-under=${failUnder!.given} asks (${failUnder!.requiredPassedCount}).`,
    ]);
    return 1;
  }

  return 0;
}

if (require.main === module) {
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
        console.error("Ask AI eval failed:");
        // eslint-disable-next-line no-console
        console.error(error);
      }
      process.exit(1);
    });
}
