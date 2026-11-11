import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import fs from "fs";
import path from "path";
import {
  BUDGET_FILE,
  JourneyBudgetFile,
  JourneyRun,
  reportTable,
} from "./JourneyBudget";

/*
 * Writes the journeys' table once every journey has run, whichever passed:
 * each journey attaches its run (JOURNEY_RUN_ATTACHMENT), and this reporter,
 * in Playwright's own process, gathers them - a worker that a failed journey
 * replaced cannot lose the ones before it.
 *
 *   output/playwright/journeys-ui/journey-report.md   the table a pull
 *                                                     request can paste
 *   output/playwright/journeys-ui/journey-runs.json   every count and what
 *                                                     it counted
 */
export const JOURNEY_RUN_ATTACHMENT: string = "journey-run.json";

export interface AttachedRun {
  id: string;
  run: JourneyRun;
  writes: Array<unknown>;
}

const REPOSITORY: string = path.resolve(__dirname, "..", "..", "..");
const OUTPUT: string = path.join(REPOSITORY, "output/playwright/journeys-ui");

export default class JourneyReport implements Reporter {
  private readonly runs: Record<string, AttachedRun> = {};

  public onTestEnd(_test: TestCase, result: TestResult): void {
    for (const attachment of result.attachments) {
      if (attachment.name === JOURNEY_RUN_ATTACHMENT && attachment.body) {
        const attached: AttachedRun = JSON.parse(
          attachment.body.toString("utf8"),
        ) as AttachedRun;
        this.runs[attached.id] = attached;
      }
    }
  }

  public onEnd(_result: FullResult): void {
    if (Object.keys(this.runs).length === 0) {
      return;
    }
    const budgets: JourneyBudgetFile = JSON.parse(
      fs.readFileSync(path.join(REPOSITORY, BUDGET_FILE), "utf8"),
    ) as JourneyBudgetFile;
    const counts: Record<string, JourneyRun> = {};
    for (const [id, attached] of Object.entries(this.runs)) {
      counts[id] = attached.run;
    }
    const table: string = reportTable(budgets, counts);

    fs.mkdirSync(OUTPUT, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT, "journey-report.md"), `${table}\n`);
    fs.writeFileSync(
      path.join(OUTPUT, "journey-runs.json"),
      `${JSON.stringify(this.runs, null, 2)}\n`,
    );
    process.stdout.write(`\nJourney budgets\n\n${table}\n\n`);
  }

  public printsToStdio(): boolean {
    return false;
  }
}
