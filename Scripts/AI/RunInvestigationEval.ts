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
import ObjectID from "Common/Types/ObjectID";
import fs from "fs";

/*
 * Sentinel investigation eval runner (G3 bootstrap) — `npm run ai-eval`.
 *
 * Exports the golden corpus (completed, LABELED investigation runs — a human
 * verdict or an auto-grade — with their recorded AIRunEvent trails), computes
 * the four G3 scores from the recordings (NO LLM is re-run), prints a report
 * and writes the corpus to ./eval-corpus.json (gitignored).
 *
 * Invocation mirrors generate-postgres-migration: config.env is sourced by
 * the npm script, which also points DATABASE_HOST/PORT at the host-exposed
 * dev Postgres (localhost:5400 — config.env's `postgres` hostname only
 * resolves inside compose) and sets RUN_DATABASE_MIGRATIONS_ON_BOOT=false so
 * a read-only eval can never run schema migrations.
 *
 * Args:
 *   --project=<objectId>   limit the corpus to one project
 *   --limit=<n>            max labeled runs to export (default 200)
 */

const OUTPUT_PATH: string = "./eval-corpus.json";

function parseArg(name: string): string | undefined {
  const prefix: string = `--${name}=`;

  const match: string | undefined = process.argv.find((arg: string) => {
    return arg.startsWith(prefix);
  });

  return match ? match.substring(prefix.length) : undefined;
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
    "Sentinel investigation eval — scored from recorded, labeled runs (no LLM re-run)",
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

  // A CLI report — stdout is the interface, matching the script idiom.
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
}

async function main(): Promise<void> {
  const projectArg: string | undefined = parseArg("project");
  const limitArg: string | undefined = parseArg("limit");

  const limit: number = limitArg
    ? parseInt(limitArg, 10)
    : DEFAULT_CORPUS_LIMIT;

  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`--limit must be a positive integer, got "${limitArg}".`);
  }

  await PostgresAppInstance.connect();

  try {
    const cases: Array<GoldenCase> = await EvalCorpus.exportCorpus({
      projectId: projectArg ? new ObjectID(projectArg) : undefined,
      limit,
    });

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(cases, null, 2), "utf8");

    const report: EvalScoreReport = EvalScores.computeScores(cases);

    printReport(report);
  } finally {
    await PostgresAppInstance.disconnect();
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error: Error) => {
    // eslint-disable-next-line no-console
    console.error("Investigation eval failed:");
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
