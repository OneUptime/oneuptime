import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import EvalCorpus, {
  GoldenCase,
  DEFAULT_CORPUS_LIMIT,
} from "Common/Server/Utils/AI/Eval/EvalCorpus";
import EvalScores, {
  EvalScore,
  EvalScoreReport,
  MINIMUM_TRUSTWORTHY_CORPUS_SIZE,
} from "Common/Server/Utils/AI/Eval/EvalScores";
import {
  describeModelOptions,
  EvalUsageError,
  getArgValue,
  hasFlag,
  PersonaFileOption,
  readJudgeOptions,
  readModelOptions,
  readPersonaFile,
  readPositiveInteger,
} from "Common/Server/Utils/AI/Eval/EvalCommandLine";
import PinnedModel, {
  PinnedModelCall,
  PinnedModelOptions,
} from "Common/Server/Utils/AI/Eval/PinnedModel";
import ReplayCorpus, {
  DEFAULT_REPLAY_LIMIT,
  ReplayCase,
} from "Common/Server/Utils/AI/Eval/ReplayCorpus";
import ReplayRunner, {
  ReplayCaseResult,
  ReplaySummary,
} from "Common/Server/Utils/AI/Eval/ReplayRunner";
import ObjectID from "Common/Types/ObjectID";
import fs from "fs";

/*
 * AI investigation eval runner — `npm run ai-eval`.
 *
 * Two modes.
 *
 * SCORE (the default; G3 bootstrap): exports the golden corpus (completed,
 * LABELED investigation runs — a human verdict or an auto-grade — with their
 * recorded AIRunEvent trails), computes the four G3 scores from the
 * recordings (NO LLM is re-run), prints a report and writes the corpus to
 * ./eval-corpus.json (gitignored).
 *
 * REPLAY (--replay; issue #6800): runs recent recorded investigations again
 * - today's prompt and the model named on the command line, on the evidence
 * the original run saw (AIRunRecording) - and grades the original analysis
 * and the replay's with one judge against the root cause people wrote. Run
 * it before and after a prompt or model change. Writes every case to
 * ./eval-replays.json (gitignored) and prints the comparison. It calls the
 * model you name with your key (AI_EVAL_LLM_API_KEY): no project is billed,
 * and nothing is written to the database.
 *
 * Invocation mirrors generate-postgres-migration: config.env is sourced by
 * the npm script, which also points DATABASE_HOST/PORT at the host-exposed
 * dev Postgres (localhost at DATABASE_PUBLISHED_PORT, 5400 unless config.env
 * moves it — config.env's `postgres` hostname only resolves inside compose)
 * and sets RUN_DATABASE_MIGRATIONS_ON_BOOT=false so
 * a read-only eval can never run schema migrations, and
 * DATABASE_MIGRATION_WAIT_TIMEOUT_MS=0 so it does not wait for them either on
 * a dev database that is behind the code (it logs which ones are missing).
 *
 * Args:
 *   --project=<objectId>   limit the corpus (or the replays) to one project
 *   --limit=<n>            max runs (default 200; 20 with --replay)
 *   --replay               replay mode; it also takes the model options of
 *                          EvalCommandLine (--llm-type, --model, --base-url,
 *                          --judge-llm-type, --judge-model, --judge-base-url)
 *   --persona-file=<path>  with --replay: a draft persona to try in place of
 *                          the one in the code
 *
 *   npm run ai-eval -- --replay --llm-type=Anthropic --model=claude-opus-5-5
 */

const OUTPUT_PATH: string = "./eval-corpus.json";
const REPLAY_OUTPUT_PATH: string = "./eval-replays.json";

const ARGV: ReadonlyArray<string> = process.argv.slice(2);

function print(lines: Array<string>): void {
  // A CLI report — stdout is the interface, matching the script idiom.
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
}

function formatScore(score: EvalScore): string {
  if (score.value === null) {
    return `not measurable (0 cases in denominator)`;
  }

  const percent: string = (score.value * 100).toFixed(1).padStart(5);

  return `${percent}%  (${score.numerator}/${score.denominator})`;
}

function printReport(report: EvalScoreReport): void {
  const lines: Array<string> = [
    "",
    "AI investigation eval — scored from recorded, labeled runs (no LLM re-run)",
    "================================================================================",
    `Labeled cases: ${report.caseCount}   (corpus written to ${OUTPUT_PATH})`,
    "",
    `  Top-hypothesis precision   ${formatScore(report.topHypothesisPrecision)}   autoGrade Match / graded (Match+Partial+Mismatch)`,
    `  Human confirmed rate       ${formatScore(report.humanConfirmedRate)}   humanVerdict Confirmed / (Confirmed+Rejected) — reported separately, never blended`,
    `  Citation grounding rate    ${formatScore(report.citationGroundingRate)}   posted analyses backed by >=1 server-minted citation`,
    `  Tool selection accuracy    ${formatScore(report.toolSelectionAccuracy)}   data-bearing tool calls / finished tool calls, aggregated across the corpus`,
    `  Inconclusive recall        ${formatScore(report.inconclusiveRecall)}   human-Rejected cases the deterministic evidence floor would have flagged`,
    "",
  ];

  if (report.sampleTooSmall) {
    lines.push(
      "********************************************************************************",
      `*  WARNING: only ${report.caseCount} labeled case(s) — fewer than ${MINIMUM_TRUSTWORTHY_CORPUS_SIZE}.`,
      "*  These numbers are noise, not measurement. Do NOT use them for any",
      "*  autonomy-graduation (G3) decision, threshold, or public claim.",
      "*  Accumulate more labeled runs (panel verdicts + resolved-incident",
      "*  auto-grades) and re-run.",
      "********************************************************************************",
      "",
    );
  }

  print(lines);
}

async function score(
  projectId: ObjectID | undefined,
  limit: number,
): Promise<void> {
  const cases: Array<GoldenCase> = await EvalCorpus.exportCorpus({
    projectId,
    limit,
  });

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(cases, null, 2), "utf8");

  printReport(EvalScores.computeScores(cases));
}

function describeGrade(grade: string | null | undefined): string {
  return (grade || "-").padEnd(9);
}

function printReplayReport(data: {
  model: PinnedModelOptions;
  judge: PinnedModelOptions | null;
  personaFile: string | undefined;
  results: Array<ReplayCaseResult>;
  summary: ReplaySummary;
}): void {
  const { summary } = data;
  const lines: Array<string> = [
    "",
    "AI investigation replay — recorded runs, run again on the evidence they saw",
    "================================================================================",
    `Model under test: ${describeModelOptions(data.model)}${
      data.personaFile ? `   persona: ${data.personaFile}` : ""
    }`,
    `Judge:            ${
      data.judge
        ? describeModelOptions(data.judge)
        : "the model under test (pass --judge-llm-type for another)"
    }`,
    `Cases: ${summary.caseCount}   replayed: ${summary.replayedCount}   skipped: ${summary.skippedCount}   with errors: ${summary.erroredCount}   (written to ${REPLAY_OUTPUT_PATH})`,
    "",
    `Graded against the root cause people wrote, both by the same judge (${summary.comparedCount} case(s) with both grades):`,
    "                    MATCH  PARTIAL  MISMATCH",
    `  Original run   ${String(summary.original.match).padStart(6)} ${String(
      summary.original.partial,
    ).padStart(8)} ${String(summary.original.mismatch).padStart(9)}`,
    `  Replay         ${String(summary.replay.match).padStart(6)} ${String(
      summary.replay.partial,
    ).padStart(8)} ${String(summary.replay.mismatch).padStart(9)}`,
    "",
    `  Better: ${summary.improvedCount}   Same: ${summary.unchangedCount}   Worse: ${summary.worsenedCount}`,
    `  Tool calls answered from the recording: ${summary.answers.exact} exactly, ${summary.answers.nearbyTime} at a nearby time, ${summary.answers.notRecorded} not recorded`,
    `  Tokens: original ${summary.originalTokens}, replay ${summary.replayTokens}`,
    "",
    "Per case (original grade -> replay grade):",
  ];

  for (const result of data.results) {
    const head: string = `  ${result.runId}  ${result.subjectType.padEnd(8)} ${result.subjectId}`;

    if (result.skipped) {
      lines.push(`${head}  skipped: ${result.skipped}`);
      continue;
    }

    if (!result.replay) {
      lines.push(`${head}  failed: ${result.error || "unknown error"}`);
      continue;
    }

    lines.push(
      `${head}  ${describeGrade(result.original.judgeGrade)} -> ${describeGrade(
        result.replay.judgeGrade,
      )} tools ${result.replay.toolCallCount} (${
        result.replay.answers.notRecorded
      } not recorded)${result.error ? `  note: ${result.error}` : ""}`,
    );
  }

  if (summary.answers.notRecorded > 0) {
    lines.push(
      "",
      "A tool call 'not recorded' is one the original run never made: the replay was told",
      "no data is available. The more of those a case has, the less its grade says.",
    );
  }

  lines.push("");
  print(lines);
}

interface ReplayOptions extends PersonaFileOption {
  model: PinnedModelOptions;
  judge: PinnedModelOptions | null;
}

function readReplayOptions(): ReplayOptions {
  const model: PinnedModelOptions = readModelOptions(ARGV, process.env);
  const judge: PinnedModelOptions | null = readJudgeOptions(ARGV, process.env);

  return { model, judge, ...readPersonaFile(ARGV) };
}

async function replay(
  projectId: ObjectID | undefined,
  limit: number,
  options: ReplayOptions,
): Promise<void> {
  const { model, judge, personaFile, persona } = options;

  const callModel: PinnedModelCall = PinnedModel.create(model);
  const judgeModel: PinnedModelCall | undefined = judge
    ? PinnedModel.create(judge)
    : undefined;

  const cases: Array<ReplayCase> = await ReplayCorpus.listCases({
    projectId,
    limit,
  });

  print([
    "",
    `Replaying ${cases.length} recorded investigation(s) with ${describeModelOptions(model)}...`,
  ]);

  const results: Array<ReplayCaseResult> = await ReplayRunner.run({
    cases,
    source: ReplayCorpus,
    callModel,
    judge: judgeModel,
    persona,
    onCase: (result: ReplayCaseResult, index: number, count: number) => {
      print([
        `  [${index + 1}/${count}] ${result.runId} ${
          result.skipped
            ? `skipped: ${result.skipped}`
            : result.replay
              ? `replayed (${describeGrade(result.replay.judgeGrade).trim()})`
              : `failed: ${result.error || "unknown error"}`
        }`,
      ]);
    },
  });

  fs.writeFileSync(
    REPLAY_OUTPUT_PATH,
    JSON.stringify(results, null, 2),
    "utf8",
  );

  printReplayReport({
    model,
    judge,
    personaFile,
    results,
    summary: ReplayRunner.summarize(results),
  });
}

async function main(): Promise<void> {
  const projectArg: string | undefined = getArgValue(ARGV, "project")?.trim();

  if (projectArg !== undefined && !ObjectID.isValidUUID(projectArg)) {
    throw new EvalUsageError(
      `--project must be a project's ID (a UUID), got "${projectArg}".`,
    );
  }

  const projectId: ObjectID | undefined = projectArg
    ? new ObjectID(projectArg)
    : undefined;
  const isReplay: boolean = hasFlag(ARGV, "replay");

  // Every option is read before connecting: a mistyped one fails at once.
  const replayOptions: ReplayOptions | null = isReplay
    ? readReplayOptions()
    : null;
  const limit: number = readPositiveInteger(
    ARGV,
    "limit",
    isReplay ? DEFAULT_REPLAY_LIMIT : DEFAULT_CORPUS_LIMIT,
  );

  await PostgresAppInstance.connect();

  try {
    if (replayOptions) {
      await replay(projectId, limit, replayOptions);
    } else {
      await score(projectId, limit);
    }
  } finally {
    await PostgresAppInstance.disconnect();
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    if (error instanceof EvalUsageError) {
      // A usage hint: its message is the whole of it.
      // eslint-disable-next-line no-console
      console.error(error.message);
    } else {
      // eslint-disable-next-line no-console
      console.error("Investigation eval failed:");
      // eslint-disable-next-line no-console
      console.error(error);
    }
    process.exit(1);
  });
