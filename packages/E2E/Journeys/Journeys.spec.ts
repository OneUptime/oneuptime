import { expect, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import Journey from "./Journey";
import {
  BUDGET_FILE,
  compareWithBudget,
  JourneyBudgetFile,
  JourneyRun,
  reportTable,
} from "./JourneyBudget";

const PORT: string = process.env["JOURNEYS_FIXTURE_PORT"] || "4831";
const ORIGIN: string = `http://127.0.0.1:${PORT}`;
const PROJECT: string = "10000000-0000-4000-8000-000000006831";
const DASHBOARD: string = `/dashboard/${PROJECT}`;
const NOW: Date = new Date("2026-11-11T10:00:00.000Z");
const REPOSITORY: string = path.resolve(__dirname, "..", "..", "..");
const OUTPUT: string = path.join(REPOSITORY, "output/playwright/journeys-ui");
const budgets: JourneyBudgetFile = JSON.parse(
  fs.readFileSync(path.join(REPOSITORY, BUDGET_FILE), "utf8"),
) as JourneyBudgetFile;
const runs: Record<string, JourneyRun> = {};

test.describe.configure({ mode: "serial" });

/*
 * Each journey runs in a page of its own, opened at its start: the clock
 * pinned, nothing allowed off this machine, and any error the product's
 * code throws failing the journey.
 */
function journey(
  id: string,
  doJob: (person: Journey, page: Page) => Promise<void>,
): void {
  test(`${id}: ${budgets.journeys[id]?.title || "(no budget yet)"}`, async ({
    page,
  }: {
    page: Page;
  }) => {
    const pageErrors: Array<string> = [];
    const leftTheMachine: Array<string> = [];
    page.on("pageerror", (error: Error) => {
      pageErrors.push(error.message);
    });
    await page.route(
      (url: URL) => {
        return url.origin !== ORIGIN;
      },
      async (route) => {
        leftTheMachine.push(route.request().url());
        await route.abort();
      },
    );
    await page.clock.setFixedTime(NOW);
    await Journey.prepare(page);

    const person: Journey = new Journey(page, id);
    await doJob(person, page);
    const run: JourneyRun = await person.finish();
    runs[id] = run;

    expect(pageErrors, "the product threw while the journey ran").toEqual([]);
    expect(leftTheMachine, "a request left this machine").toEqual([]);

    const problems: Array<string> = compareWithBudget(budgets, id, run);
    expect(problems, problems.join("\n\n")).toEqual([]);
  });
}

journey("website-monitor", async (person: Journey, page: Page) => {
  await person.begin(
    `${DASHBOARD}/home/`,
    page.getByRole("heading", { name: "Home" }),
  );
  await person.openProduct("Monitors");
  await person.press(/Create Monitor/);
  await person.choose(/^Website/);
  await person.type("Name", "Acme website");
  await person.submit("Next");
  await person.type("Website URL", "https://acme-commerce.example");
  await person.submit("Next");
  await person.submit("Create Monitor");
  await expect(page).toHaveURL(/\/monitors\/[0-9a-f-]{36}/);
});

test.afterAll(() => {
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUTPUT, "journey-runs.json"),
    `${JSON.stringify(runs, null, 2)}\n`,
  );
  const table: string = reportTable(budgets, runs);
  fs.writeFileSync(path.join(OUTPUT, "journey-report.md"), `${table}\n`);
  // eslint-disable-next-line no-console
  console.log(`\nJourney budgets\n\n${table}\n`);
});
