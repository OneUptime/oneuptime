import { expect, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import Journey from "./Journey";
import {
  BUDGET_FILE,
  compareWithBudget,
  JourneyBudgetFile,
  JourneyRun,
} from "./JourneyBudget";
import { AttachedRun, JOURNEY_RUN_ATTACHMENT } from "./JourneyReport";

const PORT: string = process.env["JOURNEYS_FIXTURE_PORT"] || "4831";
const ORIGIN: string = `http://127.0.0.1:${PORT}`;
const PROJECT: string = "10000000-0000-4000-8000-000000006831";
const DASHBOARD: string = `/dashboard/${PROJECT}`;
const MONITOR: string = "50000000-0000-4000-8000-000000000001";
// The code the fixture accepts in a Verify dialog (Fixture/NewProject.js).
const VERIFICATION_CODE: string = "123456";
const NOW: Date = new Date("2026-11-11T10:00:00.000Z");
const REPOSITORY: string = path.resolve(__dirname, "..", "..", "..");
const budgets: JourneyBudgetFile = JSON.parse(
  fs.readFileSync(path.join(REPOSITORY, BUDGET_FILE), "utf8"),
) as JourneyBudgetFile;

// A write the fixture's server kept (Fixture/Store.js).
interface FixtureWrite {
  kind: "create" | "update" | "delete";
  table: string;
  id?: string;
  data: Record<string, unknown>;
  misc?: Record<string, unknown>;
}

// The writes of one table a journey made, by kind.
function writesTo(
  writes: Array<FixtureWrite>,
  table: string,
  kind: FixtureWrite["kind"] = "create",
): Array<FixtureWrite> {
  return writes.filter((write: FixtureWrite) => {
    return write.table === table && write.kind === kind;
  });
}

/*
 * Each journey runs in a page of its own, opened at its start: the clock
 * pinned, nothing allowed off this machine, and any error the product's
 * code throws failing the journey. `isDone` checks, from what the fixture's
 * server kept, that the job was really done: a journey ends when the thing
 * works, not when a page says so.
 */
function journey(
  id: string,
  doJob: (person: Journey, page: Page) => Promise<void>,
  isDone: (writes: Array<FixtureWrite>) => void,
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
    const writes: Array<FixtureWrite> = await page.evaluate(() => {
      return (
        window as unknown as {
          __journeyFixture: { writes: Array<FixtureWrite> };
        }
      ).__journeyFixture.writes;
    });
    // For the table of every journey (JourneyReport.ts).
    const attached: AttachedRun = { id, run, writes };
    await test.info().attach(JOURNEY_RUN_ATTACHMENT, {
      body: JSON.stringify(attached),
      contentType: "application/json",
    });

    isDone(writes);
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
}, () => {});

journey("told-when-down", async (person: Journey, page: Page) => {
  await person.begin(
    `${DASHBOARD}/monitors/${MONITOR}?seed=monitor`,
    page.getByRole("heading", { name: "Acme website" }).first(),
  );
  await person.openProduct("On-Call Duty");
  await person.press(/Create On-Call Policy/);
  await person.type("Name", "Website on-call");
  await person.press("Add responder");
  await person.option(/^Ada Lovelace/);
  await person.submit("Create On-Call Policy");
  await expect(page).toHaveURL(/\/on-call-duty\/policies\/[0-9a-f-]{36}/);
}, () => {});

journey("paged-by-phone", async (person: Journey, page: Page) => {
  await person.begin(
    `${DASHBOARD}/home/?billing=on`,
    page.getByRole("heading", { name: "Home" }),
  );
  await person.openProduct("Project Settings");
  await person.sideMenu("Notification Settings", "Notifications");
  await person.toggle(/^Phone Calls/);
  await person.press("Recharge Balance");
  await person.type(/Amount/, "20");
  await person.submit("Recharge");
  await person.openFromBar("User Settings");
  await person.press("Add Phone Number for Calls");
  await person.type("Phone Number", "+15550100123");
  await person.submit("Add Phone Number for Calls");
  await person.type(/code/i, VERIFICATION_CODE);
  await person.submit("Verify");
  await person.openProduct("On-Call Duty");
  await person.press(/Create On-Call Policy/);
  await person.type("Name", "Website on-call");
  await person.press("Add responder");
  await person.option(/^Ada Lovelace/);
  await person.submit("Create On-Call Policy");
  await person.press(/Add Escalation Rule/);
  await person.press("Add responder");
  await person.option(/^Grace Hopper/);
  await person.submit("Create Rule");
}, () => {});

journey("status-page", async (person: Journey, page: Page) => {
  await person.begin(
    `${DASHBOARD}/home/?seed=monitor`,
    page.getByRole("heading", { name: "Home" }),
  );
  await person.openProduct("Status Pages");
  await person.press(/Create Status Page/);
  await person.type("Name", "Acme Status");
  await person.submit("Create Status Page");
  await person.press(/Add Monitors/);
  await person.press("Add Monitor");
  await person.pick(/^Monitor/, /Acme website/);
  await person.submit("Add Monitor");
}, () => {});

journey("first-telemetry", async (person: Journey, page: Page) => {
  await person.begin(
    `${DASHBOARD}/home/`,
    page.getByRole("heading", { name: "Home" }),
  );
  await person.openProduct("Logs");
  await person.press("Send your first logs");
  await person.press("Create Ingestion Key");
  await person.submit("Create Ingestion Key");
  await person.waitUntilShown(/View logs/, 25);
  await person.press("Done");
  await person.press("Create monitor");
  await person.type("Name", "Checkout errors");
  await person.submit("Next");
  await person.submit("Create Monitor");
  await expect(page).toHaveURL(/\/monitors\/[0-9a-f-]{36}/);
}, () => {});

journey("member-reachable", async (person: Journey, page: Page) => {
  await person.begin(
    `${DASHBOARD}/home/?as=member&seed=phones`,
    page.getByRole("heading", { name: "Home" }),
  );
  await person.openFromBar("User Settings");
  await person.press("Add Phone Number for SMS Notifications");
  await person.type("Phone Number", "+15550100456");
  await person.submit("Add Phone Number for SMS Notifications");
  await person.type(/code/i, VERIFICATION_CODE);
  await person.submit("Verify");
}, () => {});
