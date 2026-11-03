import LighthousePages, { FormFactor, FormFactors } from "./Pages";
import { Baseline } from "./Results";
import fs from "fs";
import path from "path";

/*
 * Baseline.json, and the files a run writes to its reports folder: each
 * page's Lighthouse report, a line of scores per page for the run's summary
 * (GlobalTeardown.ts), and the Baseline.json the run would record. In CI
 * that copy is recorded in the Playwright image: copying it over this
 * folder's accepts the run's results without recording them on a laptop.
 */
export const BaselineFile: string = path.join(__dirname, "Baseline.json");

export const ReportsFolder: string = path.resolve(
  __dirname,
  "../../../output/playwright/lighthouse/reports",
);

export const RecordedBaselineFile: string = path.join(
  ReportsFolder,
  "Baseline.json",
);

const ScoresFile: string = path.join(ReportsFolder, "scores.jsonl");

export interface ScoreLine {
  path: string;
  template: string;
  formFactor: FormFactor;
  // A category's id: its score out of 100, or "-".
  scores: Record<string, string>;
  failing: Array<string>;
  report: string;
}

export function readBaseline(file: string = BaselineFile): Baseline {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Baseline;
}

/*
 * Records the audits that fail on one page in one form factor. The pages
 * stay in Pages.ts's order, and a page Pages.ts no longer lists goes. When
 * another Lighthouse recorded the file, everything it recorded goes: its
 * results are not this one's, and the suite asks for the rest again.
 */
export function recordInBaseline(
  data: {
    lighthouse: string;
    path: string;
    formFactor: FormFactor;
    failing: Array<string>;
  },
  file: string = BaselineFile,
): void {
  const recorded: Baseline | null = fs.existsSync(file)
    ? readBaseline(file)
    : null;
  const kept: Baseline["pages"] =
    recorded && recorded.lighthouse === data.lighthouse ? recorded.pages : {};

  kept[data.path] = { ...kept[data.path], [data.formFactor]: data.failing };

  const pages: Baseline["pages"] = {};

  for (const page of LighthousePages) {
    const results: Partial<Record<FormFactor, Array<string>>> | undefined =
      kept[page.path];

    if (!results) {
      continue;
    }

    pages[page.path] = {};

    for (const formFactor of FormFactors) {
      const failing: Array<string> | undefined = results[formFactor];

      if (failing) {
        pages[page.path]![formFactor] = failing;
      }
    }
  }

  const baseline: Baseline = { lighthouse: data.lighthouse, pages: pages };

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`);
}

export function writeScoreLine(line: ScoreLine): void {
  fs.mkdirSync(ReportsFolder, { recursive: true });
  fs.appendFileSync(ScoresFile, `${JSON.stringify(line)}\n`);
}

export function readScoreLines(): Array<ScoreLine> {
  if (!fs.existsSync(ScoresFile)) {
    return [];
  }

  return fs
    .readFileSync(ScoresFile, "utf8")
    .split("\n")
    .filter((line: string): boolean => {
      return line.trim() !== "";
    })
    .map((line: string): ScoreLine => {
      return JSON.parse(line) as ScoreLine;
    });
}

export function clearReports(): void {
  fs.rmSync(ReportsFolder, { recursive: true, force: true });
  fs.mkdirSync(ReportsFolder, { recursive: true });
}
