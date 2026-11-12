import { expect, Page, Route, test } from "@playwright/test";

/*
 * THE WEBSITE-DOWN GUIDED SETUP'S RUN, KEPT AND LOST (#7059), in the real
 * Dashboard over the journeys' fixture (Fixture/, Journeys/README.md): the
 * run this browser keeps takes a reload back to the step it was on, and a
 * run it lost - a private window, another device, storage cleared - makes
 * no second monitor for the same address: the setup goes on with the one
 * this person already has, and says so. What the fixture's server kept is
 * the proof, as it is for a journey.
 *
 * Not a journey: nothing is counted or budgeted (Tests/Ops/JourneyBudgets.json).
 */

const PORT: string = process.env["JOURNEYS_FIXTURE_PORT"] || "4831";
const ORIGIN: string = `http://127.0.0.1:${PORT}`;
const PROJECT: string = "10000000-0000-4000-8000-000000006831";
const SETUP: string = `/dashboard/${PROJECT}/monitors/setup`;
const NOW: Date = new Date("2026-11-11T10:00:00.000Z");
// Every run this browser keeps (GuidedSetupProgress.ts, GUIDED_SETUP_RUN_KEY_PREFIX).
const RUN_KEY_PREFIX: string = "guided-setup-run:";

// A write the fixture's server kept (Fixture/Store.js).
interface FixtureWrite {
  kind: "create" | "update" | "delete";
  table: string;
  data: Record<string, unknown>;
}

const pageErrors: Array<string> = [];
const leftTheMachine: Array<string> = [];

test.beforeEach(async ({ page }: { page: Page }) => {
  pageErrors.length = 0;
  leftTheMachine.length = 0;
  page.on("pageerror", (error: Error) => {
    pageErrors.push(error.message);
  });
  await page.route(
    (url: URL) => {
      return url.origin !== ORIGIN;
    },
    async (route: Route) => {
      leftTheMachine.push(route.request().url());
      await route.abort();
    },
  );
  await page.clock.setFixedTime(NOW);
});

test.afterEach(() => {
  expect(pageErrors, "the product threw").toEqual([]);
  expect(leftTheMachine, "a request left this machine").toEqual([]);
});

async function creates(page: Page, table: string): Promise<number> {
  const writes: Array<FixtureWrite> = await page.evaluate(() => {
    return (
      window as unknown as { __journeyFixture: { writes: Array<FixtureWrite> } }
    ).__journeyFixture.writes;
  });

  return writes.filter((write: FixtureWrite) => {
    return write.table === table && write.kind === "create";
  }).length;
}

async function stepState(page: Page, key: string): Promise<string | null> {
  return await page
    .getByTestId(`guided-setup-step-${key}`)
    .getAttribute("data-state");
}

// The first step, for acme-commerce.example however it is typed: its monitor, made or found.
async function checkAddress(page: Page, address: string): Promise<void> {
  await page.getByLabel("Website or API address").fill(address);
  await page.getByRole("button", { name: "Start checking" }).click();
  await expect(page.getByTestId("guided-setup-first-check")).toContainText(
    "acme-commerce.example answered 200 in 312 ms from 2 locations.",
  );
}

async function openSetup(page: Page): Promise<void> {
  await page.goto(`${ORIGIN}${SETUP}`);
  await expect(page.getByTestId("guided-setup")).toBeVisible();
}

/*
 * The browser forgets the run, as a private window, another device or
 * cleared site data would; the fixture's server keeps the monitor (its
 * writes live in the tab's sessionStorage). Then the page opens again.
 */
async function loseTheRunAndReload(page: Page): Promise<void> {
  await page.evaluate((prefix: string) => {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(prefix)) {
        window.localStorage.removeItem(key);
      }
    }
  }, RUN_KEY_PREFIX);
  await page.reload();
  await expect(page.getByTestId("guided-setup")).toBeVisible();
  await expect
    .poll(async () => {
      return await stepState(page, "check");
    })
    .toBe("open");
}

test("a reload goes back to the step the run was on, and makes nothing twice", async ({
  page,
}: {
  page: Page;
}) => {
  await openSetup(page);
  await checkAddress(page, "https://acme-commerce.example");
  expect(await creates(page, "Monitor")).toBe(1);

  await page.reload();
  await expect(page.getByTestId("guided-setup")).toBeVisible();

  await expect
    .poll(async () => {
      return await stepState(page, "who_is_told");
    })
    .toBe("open");
  expect(await stepState(page, "check")).toBe("done");
  await expect(
    page.getByTestId("guided-setup-step-check-done-line"),
  ).toContainText("acme-commerce.example answered 200");
  expect(await creates(page, "Monitor")).toBe(1);
});

test("a run this browser lost: the same address goes on with the monitor already made, and says so; another address gets its own", async ({
  page,
}: {
  page: Page;
}) => {
  await openSetup(page);
  await checkAddress(page, "https://acme-commerce.example");
  expect(await creates(page, "Monitor")).toBe(1);

  await loseTheRunAndReload(page);

  // The same address, typed another way.
  await checkAddress(page, "ACME-commerce.example/");
  await expect(page.getByTestId("guided-setup-existing-monitor")).toHaveText(
    'Your monitor "acme-commerce.example" already checks this address, so no new monitor was made.',
  );
  expect(await creates(page, "Monitor")).toBe(1);

  // And the run goes on with it, to the summary.
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect
    .poll(async () => {
      return await stepState(page, "test");
    })
    .toBe("open");
  expect(await creates(page, "OnCallDutyPolicy")).toBe(1);
  await page.getByRole("button", { name: "Skip the test" }).click();
  await expect(page.getByTestId("guided-setup-summary")).toContainText(
    "acme-commerce.example is set up",
  );

  // Another address is another check: its own monitor, and no note.
  await page.getByRole("button", { name: "Check another address" }).click();
  await page
    .getByLabel("Website or API address")
    .fill("status.acme-commerce.example");
  await page.getByRole("button", { name: "Start checking" }).click();
  await expect(page.getByTestId("guided-setup-first-check")).toContainText(
    "status.acme-commerce.example answered 200",
  );
  await expect(page.getByTestId("guided-setup-existing-monitor")).toHaveCount(
    0,
  );
  expect(await creates(page, "Monitor")).toBe(2);
  expect(await creates(page, "OnCallDutyPolicy")).toBe(1);
});
