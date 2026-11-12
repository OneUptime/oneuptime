import { expect, Page, Route, test } from "@playwright/test";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * THE WEBSITE-DOWN GUIDED SETUP'S RUN, KEPT AND LOST (#7059), in the real
 * Dashboard over the journeys' fixture (Fixture/, Journeys/README.md): the
 * run this browser keeps takes a reload back to the step it was on, and a
 * run it lost - a private window, another device, storage cleared - makes
 * no second monitor for the same address: the setup goes on with the one
 * this person already has, and says so, in a line that wraps inside the
 * step on a phone however long the address. The status page setup does the
 * same for a page's name (#7252). What the fixture's server kept is the
 * proof, as it is for a journey.
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

// The first step, for an address on `host` however it is typed: its monitor, made or found.
async function checkAddress(
  page: Page,
  address: string,
  host: string = "acme-commerce.example",
): Promise<void> {
  await page.getByLabel("Website or API address").fill(address);
  await page.getByRole("button", { name: "Start checking" }).click();
  await expect(page.getByTestId("guided-setup-first-check")).toContainText(
    `${host} answered 200 in 312 ms from 2 locations.`,
  );
}

/*
 * How many pixels each element's own text runs past its box, read in one
 * frame: 0 when the text wraps inside it. An element's own scrollWidth, not
 * the page's (Tests/Ops/E2EPageFitReads).
 */
async function textOverflowOf(
  page: Page,
  testIds: Array<string>,
): Promise<Record<string, number>> {
  return await page.evaluate((ids: Array<string>) => {
    const overflow: Record<string, number> = {};

    for (const id of ids) {
      const element: HTMLElement | null = document.querySelector(
        `[data-testid="${id}"]`,
      );

      if (!element) {
        throw new Error(`Nothing on the page has data-testid="${id}".`);
      }

      overflow[id] = element.scrollWidth - element.clientWidth;
    }

    return overflow;
  }, testIds);
}

async function openSetup(page: Page): Promise<void> {
  await page.goto(`${ORIGIN}${SETUP}`);
  await expect(page.getByTestId("guided-setup")).toBeVisible();
}

/*
 * The browser forgets the run, as a private window, another device or
 * cleared site data would; the fixture's server keeps what the run made
 * (its writes live in the tab's sessionStorage). Then the page opens
 * again, on the setup's first step.
 */
async function loseTheRunAndReload(
  page: Page,
  firstStep: string = "check",
): Promise<void> {
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
      return await stepState(page, firstStep);
    })
    .toBe("open");
}

/*
 * THE STATUS PAGE SETUP (#7252), over the website monitor the first journey
 * leaves (?seed=monitor): step 1 names the page and picks what it shows,
 * and the page is made with them.
 */
const STATUS_PAGE_SETUP: string = `/dashboard/${PROJECT}/status-pages/setup?seed=monitor`;
// The seeded monitor's name (Fixture/NewProject.js).
const SEEDED_MONITOR: string = "Acme website";

async function openStatusPageSetup(page: Page): Promise<void> {
  await page.goto(`${ORIGIN}${STATUS_PAGE_SETUP}`);
  await expect(page.getByTestId("guided-setup")).toBeVisible();
  await expect
    .poll(async () => {
      return await stepState(page, "pick");
    })
    .toBe("open");
}

// Step 1, as a person does it: a name (left as it starts when none is given), the monitor, Create.
async function nameAndPublish(page: Page, name?: string): Promise<void> {
  if (name !== undefined) {
    await page.getByLabel("Status page name").fill(name);
  }

  await page.getByLabel(SEEDED_MONITOR).check();
  await page.getByRole("button", { name: "Create the status page" }).click();
  await expect
    .poll(async () => {
      return await stepState(page, "review");
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

/*
 * A long host is one word to the browser, and a monitor's name carries the
 * host and the path: on a phone both lines of the first step - the note
 * that this person's monitor already checks the address, then what the
 * check found - wrap inside the step instead of running past it. The host's
 * first label is 59 letters (a label may have 63), so a line that does not
 * wrap runs well past the step in any font.
 */
test("a long address on a phone: the note comes first, and both lines of the step wrap inside it", async ({
  page,
}: {
  page: Page;
}) => {
  const host: string =
    "storefrontcheckoutandpaymentsreadinessprobeforeuropeandasia.acme-commerce.example";

  await page.setViewportSize({ width: 390, height: 844 });
  await openSetup(page);
  await checkAddress(page, `https://${host}/healthz`, host);
  expect(await creates(page, "Monitor")).toBe(1);

  await loseTheRunAndReload(page);

  // The same address, its host in capitals and a slash at the end.
  await checkAddress(page, `${host.toUpperCase()}/healthz/`, host);
  await expect(page.getByTestId("guided-setup-existing-monitor")).toHaveText(
    `Your monitor "${host}/healthz" already checks this address, so no new monitor was made.`,
  );
  expect(await creates(page, "Monitor")).toBe(1);

  // The note first, then what the check found.
  await expect(
    page.getByTestId("guided-setup-step-check-content").locator("p"),
  ).toHaveText([
    /^Your monitor "/,
    `${host} answered 200 in 312 ms from 2 locations.`,
  ]);

  expect(
    await textOverflowOf(page, [
      "guided-setup-existing-monitor",
      "guided-setup-first-check",
      "guided-setup-step-check",
    ]),
  ).toEqual({
    "guided-setup-existing-monitor": 0,
    "guided-setup-first-check": 0,
    "guided-setup-step-check": 0,
  });
  await expectNoSidewaysScroll(page, {
    message: "the first step, a long address, 390 pixels wide",
  });
});

/*
 * A STATUS PAGE RUN THE BROWSER LOST (#7252): the status page setup keeps
 * its run in the browser too, and a lost run - a private window, another
 * device, storage cleared, another tab - made a second page with the same
 * name. Now the name typed, however it is typed, goes on with this
 * person's own page of that name, adds the monitors picked to it, and step
 * 2 says so; the fixture's server kept one status page and one monitor on
 * it. Setting up another page after it starts with no name, so the next
 * page is a page of its own.
 */
test("a status page run this browser lost: the same name goes on with the page already made, and says so; another name gets its own", async ({
  page,
}: {
  page: Page;
}) => {
  await openStatusPageSetup(page);
  // The name the setup starts with: the project's.
  await expect(page.getByLabel("Status page name")).toHaveValue(
    "Acme Commerce Status",
  );
  await nameAndPublish(page);
  expect(await creates(page, "StatusPage")).toBe(1);
  expect(await creates(page, "StatusPageResource")).toBe(1);
  await expect(
    page.getByTestId("guided-setup-existing-status-page"),
  ).toHaveCount(0);

  await loseTheRunAndReload(page, "pick");

  // The same name, typed another way.
  await nameAndPublish(page, "  acme commerce   STATUS ");
  await expect(
    page.getByTestId("guided-setup-existing-status-page"),
  ).toHaveText(
    'You already have a status page named "Acme Commerce Status", so no new one was made.',
  );
  // The monitor is on the page already: nothing is added twice.
  expect(await creates(page, "StatusPage")).toBe(1);
  expect(await creates(page, "StatusPageResource")).toBe(1);

  // And the run goes on with it, to the summary.
  await page.getByRole("button", { name: "Looks good" }).click();
  await expect(page.getByTestId("guided-setup-summary")).toContainText(
    '"Acme Commerce Status" is live',
  );

  // Another page starts with no name, and a name of its own is its own page.
  await page
    .getByRole("button", { name: "Set up another status page" })
    .click();
  await expect
    .poll(async () => {
      return await stepState(page, "pick");
    })
    .toBe("open");
  await expect(page.getByLabel("Status page name")).toHaveValue("");
  await nameAndPublish(page, "Acme Commerce Internal Status");
  await expect(
    page.getByTestId("guided-setup-existing-status-page"),
  ).toHaveCount(0);
  expect(await creates(page, "StatusPage")).toBe(2);
  expect(await creates(page, "StatusPageResource")).toBe(2);
});

/*
 * A long name is one word to the browser: on a phone the note naming the
 * page, the preview's name and the summary's title wrap inside the step
 * and the summary instead of running past them.
 */
test("a long status page name on a phone: the note comes first in step 2, and every line naming the page wraps", async ({
  page,
}: {
  page: Page;
}) => {
  const name: string =
    "Storefrontcheckoutandpaymentsreadinessforeuropeandasiacustomers";

  await page.setViewportSize({ width: 390, height: 844 });
  await openStatusPageSetup(page);
  await nameAndPublish(page, name);
  expect(await creates(page, "StatusPage")).toBe(1);

  await loseTheRunAndReload(page, "pick");

  await nameAndPublish(page, name.toUpperCase());
  await expect(
    page.getByTestId("guided-setup-existing-status-page"),
  ).toHaveText(
    `You already have a status page named "${name}", so no new one was made.`,
  );
  expect(await creates(page, "StatusPage")).toBe(1);

  // The note first in the step.
  await expect(
    page.getByTestId("guided-setup-step-review-content").locator("p").first(),
  ).toHaveAttribute("data-testid", "guided-setup-existing-status-page");

  expect(
    await textOverflowOf(page, [
      "guided-setup-existing-status-page",
      "guided-setup-preview-name",
      "guided-setup-preview",
      "guided-setup-step-review",
    ]),
  ).toEqual({
    "guided-setup-existing-status-page": 0,
    "guided-setup-preview-name": 0,
    "guided-setup-preview": 0,
    "guided-setup-step-review": 0,
  });
  await expectNoSidewaysScroll(page, {
    message: "step 2, a long status page name, 390 pixels wide",
  });

  await page.getByRole("button", { name: "Looks good" }).click();
  await expect(page.getByTestId("guided-setup-summary-title")).toHaveText(
    `"${name}" is live`,
  );
  expect(
    await textOverflowOf(page, [
      "guided-setup-summary-title",
      "guided-setup-summary",
    ]),
  ).toEqual({
    "guided-setup-summary-title": 0,
    "guided-setup-summary": 0,
  });
  await expectNoSidewaysScroll(page, {
    message: "the summary, a long status page name, 390 pixels wide",
  });
});
