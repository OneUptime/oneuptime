import { ReportsFolder, ScoreLine, readScoreLines } from "./BaselineFile";
import fs from "fs";
import path from "path";

/*
 * The run's scores in one table: summary.md beside the reports, and the
 * job's summary on GitHub (GITHUB_STEP_SUMMARY), so a pull request's scores
 * are on its run's page without opening a report.
 */
export default async function globalTeardown(): Promise<void> {
  const lines: Array<ScoreLine> = readScoreLines();

  if (lines.length === 0) {
    return;
  }

  const rows: Array<string> = lines.map((line: ScoreLine): string => {
    const failing: string =
      line.failing.length > 0
        ? line.failing
            .map((id: string): string => {
              return `\`${id}\``;
            })
            .join(", ")
        : "none";

    return `| \`${line.path}\` | ${line.formFactor} | ${line.scores["accessibility"]} | ${line.scores["best-practices"]} | ${line.scores["seo"]} | ${failing} |`;
  });

  const summary: string = [
    "## Lighthouse: accessibility, best practices and SEO",
    "",
    "Every page's report is in the run's `lighthouse` artifact, with the Baseline.json this run would record (packages/E2E/Lighthouse/README.md). Failing audits are the ones that fail on the page now; packages/E2E/Lighthouse/Baseline.json says which of them were already failing.",
    "",
    "| Page | Form factor | Accessibility | Best practices | SEO | Failing audits |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");

  fs.writeFileSync(path.join(ReportsFolder, "summary.md"), summary);

  const stepSummary: string | undefined = process.env["GITHUB_STEP_SUMMARY"];

  if (stepSummary) {
    fs.appendFileSync(stepSummary, summary);
  }
}
