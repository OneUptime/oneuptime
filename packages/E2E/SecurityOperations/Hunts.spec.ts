import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Hunts on the Security Operations fixture's synthetic month
 * (Fixture/HuntsFixture.js lays out four hunts over the month's security
 * events and keeps one of them on CASE-138): Security Events > Events >
 * Hunts, the Events toolbar's Hunts list and Save as Hunt, a hunt's page
 * with its header over the Events explorer, Add to Case from a hunt, and
 * the events kept on a case's Evidence page. What the unit tests cannot
 * see: that the pages are reached from the side menu, the toolbar and the
 * rows, that the dialogs send what they say, that each answer reads on the
 * page, and that each page fits a laptop's width and a phone's.
 *
 * Every test pins the clock and fences the network, as
 * SecurityOperations.spec.ts does: afterEach fails a test on an uncaught
 * page error, on any request that left the fixture server and on anything
 * the fixture does not model.
 */

const PORT: string = process.env["SECURITY_OPERATIONS_FIXTURE_PORT"] || "4234";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-14T12:00:00.000Z");

const PRODUCT: string = `/dashboard/${PROJECT_ID}/security-events`;
const HUNTS_PATH: string = `${PRODUCT}/hunts`;

// The fixture's hunts (HuntsFixture.js).
const ENCODED_POWERSHELL_ID: string = "3b000000-0000-4000-8000-000000000001";
const SUDO_ID: string = "3b000000-0000-4000-8000-000000000004";
const HUNT_PATH: string = `${HUNTS_PATH}/${ENCODED_POWERSHELL_ID}`;
const FAILING_HUNT_PATH: string = `${HUNTS_PATH}/${SUDO_ID}`;
const CASE_138_ID: string = "20000000-0000-4000-8000-000000000138";
const CASE_138_EVIDENCE_PATH: string = `${PRODUCT}/cases/${CASE_138_ID}/evidence`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/security-operations-ui",
);

interface FixtureState {
  apiRequests: Array<{
    method: string;
    url: string;
    body: Record<string, unknown> | null;
  }>;
  creates: Array<{ modelName: string; data: Record<string, unknown> }>;
  updates: Array<{
    modelName: string;
    id: string;
    data: Record<string, unknown>;
  }>;
  deletes: Array<{ modelName: string; id: string }>;
  unhandled: Array<unknown>;
}

interface OpenOptions {
  width?: number;
  height?: number;
  theme?: "dark" | undefined;
  lang?: "de" | "fa";
  hunts?: "empty";
}

test.use({ deviceScaleFactor: 2, actionTimeout: 15000 });

const pageErrors: Map<Page, Array<string>> = new Map();
const abortedRequests: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const aborted: Array<string> = [];
  pageErrors.set(page, errors);
  abortedRequests.set(page, aborted);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing the page asks for may leave the fixture server.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    aborted.push(route.request().url());
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    abortedRequests.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);

  const hasFixture: boolean = await page
    .evaluate((): boolean => {
      return Boolean(
        (window as unknown as { __securityOperationsFixture?: unknown })
          .__securityOperationsFixture,
      );
    })
    .catch((): boolean => {
      return false;
    });
  if (hasFixture) {
    expect(
      (await fixture(page)).unhandled,
      "requests the fixture does not model",
    ).toEqual([]);
  }
});

/*
 * ---------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------
 */

async function open(
  page: Page,
  target: string,
  options: OpenOptions = {},
): Promise<void> {
  await page.setViewportSize({
    width: options.width || 1440,
    height: options.height || 1000,
  });
  await page.clock.setFixedTime(NOW);
  const url: URL = new URL(target, `http://127.0.0.1:${PORT}`);
  if (options.theme === "dark") {
    url.searchParams.set("theme", "dark");
  }
  if (options.lang) {
    url.searchParams.set("lang", options.lang);
  }
  if (options.hunts) {
    url.searchParams.set("hunts", options.hunts);
  }
  await page.goto(`${url.pathname}${url.search}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.load("600 14px Inter");
    await document.fonts.ready;
  });
}

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (
          window as unknown as {
            __securityOperationsFixture: FixtureState;
          }
        ).__securityOperationsFixture,
      ),
    ) as FixtureState;
  });
}

/*
 * The page as a person sees it. A dialog or an open list is taken in the
 * window alone: a whole-page picture would draw the page below the window
 * without the dialog's backdrop over it.
 */
async function screenshot(
  page: Page,
  name: string,
  options: { window?: boolean } = {},
): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: !options.window,
    animations: "disabled",
  });
}

/*
 * Where the page is, by its path: the Events explorer writes what it
 * searches into the address (search, range), which is the page's own.
 */
async function expectPath(page: Page, pathname: string): Promise<void> {
  await expect
    .poll((): string => {
      return new URL(page.url()).pathname;
    })
    .toBe(pathname);
}

// How far the page scrolls sideways.
async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
}

function sideMenu(page: Page): Locator {
  return page.locator('aside[role="navigation"]');
}

// The entries of the menu marked as the page you are on.
async function litEntries(page: Page): Promise<Array<string>> {
  return sideMenu(page)
    .locator("a.bg-indigo-50")
    .evaluateAll((anchors: Array<Element>): Array<string> => {
      return anchors.map((anchor: Element): string => {
        return (
          anchor.querySelector('[data-testid="side-menu-item-title"]')
            ?.textContent ||
          anchor.textContent ||
          ""
        ).trim();
      });
    });
}

async function breadcrumbs(page: Page): Promise<Array<string>> {
  return (
    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("listitem")
      .allInnerTexts()
  ).map((crumb: string): string => {
    return crumb.trim();
  });
}

function dialog(page: Page): Locator {
  return page.getByRole("dialog");
}

// A table row by a text it holds (a hunt's name).
function rowWith(page: Page, text: string): Locator {
  return page.locator("table tbody tr").filter({
    has: page.getByText(text, { exact: true }),
  });
}

function huntsMenu(page: Page): Locator {
  return page.getByTestId("security-events-hunts-menu");
}

async function openHuntsMenu(page: Page): Promise<Locator> {
  await huntsMenu(page).getByRole("button").first().click();
  const panel: Locator = huntsMenu(page).getByRole("dialog", { name: "Hunts" });
  await expect(panel).toBeVisible();
  return panel;
}

// A dialog's dropdown, opened and an option picked by its name.
async function chooseOption(page: Page, name: string): Promise<void> {
  await dialog(page).locator(".ou-select__control").first().click();
  await page.locator(".ou-select__option", { hasText: name }).first().click();
}

async function requestsTo(
  page: Page,
  pathEnd: string,
): Promise<Array<Record<string, unknown>>> {
  return (await fixture(page)).apiRequests
    .filter((request: { method: string; url: string }): boolean => {
      return (
        request.method === "POST" &&
        new URL(request.url).pathname.endsWith(pathEnd)
      );
    })
    .map((request: { body: Record<string, unknown> | null }) => {
      return request.body || {};
    });
}

// The rows of the Events explorer the hunt's page draws.
function eventRows(page: Page): Locator {
  return page.getByTestId("telemetry-viewer-select-row");
}

/*
 * ---------------------------------------------------------------------------
 * The list
 * ---------------------------------------------------------------------------
 */

test.describe("Security Events > Events > Hunts", () => {
  test("is reached from the side menu, under Events, and lists the team's hunts with their schedules and what they found", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PRODUCT);
    await sideMenu(page).getByRole("link", { name: "Hunts" }).click();
    await expectPath(page, HUNTS_PATH);

    expect(await litEntries(page)).toEqual(["Hunts"]);
    expect(await breadcrumbs(page)).toEqual([
      "Project",
      "Security Events",
      "Events",
      "Hunts",
    ]);

    const failing: Locator = rowWith(page, "Sudo by service accounts");

    await expect(rowWith(page, "Encoded PowerShell")).toContainText(
      "Every Day",
    );
    await expect(rowWith(page, "Encoded PowerShell")).toContainText(
      "Tells Maya Chen, SOC Tier 2",
    );
    await expect(rowWith(page, "Encoded PowerShell")).toContainText("3 events");
    await expect(
      rowWith(page, "Admin sign-ins outside the office"),
    ).toContainText("Nothing found yet");
    await expect(rowWith(page, "Threat intel matches")).toContainText(
      "Not Scheduled",
    );
    await expect(
      failing.getByTestId("security-hunt-last-found"),
    ).toHaveAttribute("data-state", "failed");
    await expect(failing.getByText("Couldn't run")).toBeVisible();

    expect(await pageOverflow(page)).toBe(0);
    await screenshot(page, "hunts-list-1440");
  });

  test("on a phone, says each hunt's schedule and last find under its name - in red when its run failed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, HUNTS_PATH, { width: 390, height: 900 });

    const facts: Locator = page.getByTestId("security-hunt-name-facts");

    await expect(facts).toHaveCount(4);
    await expect(facts.filter({ hasText: "Couldn't run" })).toHaveAttribute(
      "data-state",
      "failed",
    );
    await expect(facts.filter({ hasText: "3 events" })).toContainText(
      "Every Day",
    );
    expect(await pageOverflow(page)).toBe(0);
    await screenshot(page, "hunts-list-390");
  });

  test("with no hunts yet, sends the team to Events, where they are saved from", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, HUNTS_PATH, { hunts: "empty" });

    await expect(page.getByText("No hunts yet", { exact: true })).toBeVisible();
    await page.getByTestId("security-hunts-search-events").click();
    await expectPath(page, PRODUCT);
    await expect(huntsMenu(page)).toBeVisible();
  });
});

/*
 * ---------------------------------------------------------------------------
 * The Events toolbar's Hunts list, and Save as Hunt
 * ---------------------------------------------------------------------------
 */

test.describe("the Events toolbar's Hunts list", () => {
  test("opens a hunt on its page, where it is ticked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PRODUCT);

    const panel: Locator = await openHuntsMenu(page);

    await expect(
      panel.getByRole("button", { name: "Encoded PowerShell" }),
    ).toContainText("Every Day");
    await screenshot(page, "hunts-menu-1440", { window: true });
    await panel.getByRole("button", { name: "Encoded PowerShell" }).click();

    await expectPath(page, HUNT_PATH);
    await expect(page.getByTestId("security-hunt-title")).toHaveText(
      "Encoded PowerShell",
    );
    expect(await litEntries(page)).toEqual(["Hunts"]);

    const onHunt: Locator = await openHuntsMenu(page);

    await expect(
      onHunt.getByRole("button", { name: "Encoded PowerShell" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("locks Save as Hunt with nothing on screen to save, saying why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PRODUCT);

    const panel: Locator = await openHuntsMenu(page);

    await expect(
      panel.getByRole("button", { name: "+ Save as Hunt" }),
    ).toBeDisabled();
    await expect(
      panel.getByText(
        "Type a search or pick a filter first: a hunt saves the search on screen.",
      ),
    ).toBeVisible();
  });

  test("saves the search on screen as a hunt on a schedule, telling the person saving it, and opens it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(
      page,
      `${PRODUCT}?search=${encodeURIComponent("user:svc-backup")}`,
    );

    await (await openHuntsMenu(page))
      .getByRole("button", { name: "+ Save as Hunt" })
      .click();

    await expect(dialog(page)).toContainText("Save as Hunt");
    await expect(page.getByTestId("security-hunt-save-summary")).toContainText(
      "user:svc-backup",
    );
    await dialog(page).getByTestId("hunt-name").fill("Backups run as root");
    await chooseOption(page, "Every Day");
    // Scheduled: who it tells, starting with the person saving it.
    await expect(
      dialog(page).getByText("Notify", { exact: true }),
    ).toBeVisible();
    await screenshot(page, "hunts-save-as-hunt-1440", { window: true });
    await dialog(page).getByRole("button", { name: "Save Hunt" }).click();

    await expect(page.getByTestId("security-hunt-title")).toHaveText(
      "Backups run as root",
    );

    const [created] = (await fixture(page)).creates.filter(
      (write: { modelName: string }): boolean => {
        return write.modelName === "SecurityHunt";
      },
    );

    expect(created!.data).toMatchObject({
      name: "Backups run as root",
      searchQuery: "user:svc-backup",
      schedule: "Every Day",
    });
    expect(String(created!.data["timeRange"])).toBe("Past 1 Day");
  });
});

/*
 * ---------------------------------------------------------------------------
 * A hunt's page
 * ---------------------------------------------------------------------------
 */

test.describe("a hunt's page", () => {
  test("is the hunt over its search: what it is, who it tells, what it last found, and Show them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, HUNT_PATH);

    const header: Locator = page.getByTestId("security-hunt-header");

    await expect(header).toContainText("Every Day");
    await expect(header).toContainText("Tells Maya Chen, SOC Tier 2");
    await expect(
      header.getByTestId("security-hunt-last-found-line"),
    ).toContainText("Last found 3 events");
    expect(await breadcrumbs(page)).toEqual([
      "Project",
      "Security Events",
      "Events",
      "Hunts",
      "Encoded PowerShell",
    ]);
    // The explorer searches what the hunt keeps.
    await expect(eventRows(page)).toHaveCount(4);
    await screenshot(page, "hunts-hunt-1440");

    await header.getByTestId("security-hunt-show-them").click();
    await expect(page).toHaveURL(/range=Custom/);
    await expect(eventRows(page)).toHaveCount(3);
  });

  test("a changed search is saved from the header, and starts the hunt's schedule again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(
      page,
      `${HUNT_PATH}?search=${encodeURIComponent("processname:powershell.exe")}`,
    );

    await expect(page.getByTestId("security-hunt-changed")).toContainText(
      "You changed this hunt's search.",
    );
    await screenshot(page, "hunts-hunt-changed-1440");
    await page.getByTestId("security-hunt-save-changes").click();
    await expect(page.getByTestId("security-hunt-changed")).toHaveCount(0);

    const [update] = (await fixture(page)).updates.filter(
      (write: { modelName: string }): boolean => {
        return write.modelName === "SecurityHunt";
      },
    );

    expect(update!.id).toBe(ENCODED_POWERSHELL_ID);
    expect(update!.data).toMatchObject({
      searchQuery: "processname:powershell.exe",
    });
  });

  test("Discard Changes opens the hunt's own search again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${HUNT_PATH}?search=${encodeURIComponent("user:root")}`);

    await expect(eventRows(page)).toHaveCount(0);
    await page.getByTestId("security-hunt-discard-changes").click();

    await expect(page.getByTestId("security-hunt-changed")).toHaveCount(0);
    await expect(eventRows(page)).toHaveCount(4);
    expect((await fixture(page)).updates).toEqual([]);
  });

  test("a hunt whose last run failed says why, and Delete Hunt goes back to the list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, FAILING_HUNT_PATH);

    await expect(
      page.getByTestId("security-hunt-last-found-line"),
    ).toContainText(
      "Its last run could not be made: The person it runs as can no longer read security events in this project.",
    );

    await page.getByTestId("security-hunt-more").click();
    await page.getByTestId("security-hunt-delete").click();
    await expect(dialog(page)).toContainText(
      "Delete the hunt Sudo by service accounts?",
    );
    await dialog(page).getByRole("button", { name: "Delete Hunt" }).click();

    await expectPath(page, HUNTS_PATH);
    expect(
      (await fixture(page)).deletes.filter((write: { modelName: string }) => {
        return write.modelName === "SecurityHunt";
      }),
    ).toEqual([{ modelName: "SecurityHunt", id: SUDO_ID }]);
    await expect(rowWith(page, "Sudo by service accounts")).toHaveCount(0);
  });

  test("fits a phone, and reads in Persian, right to left", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, HUNT_PATH, { width: 390, height: 900 });
    expect(await pageOverflow(page)).toBe(0);
    await screenshot(page, "hunts-hunt-390");

    await open(page, HUNT_PATH, { lang: "fa" });
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("security-hunt-header")).toContainText(
      "شکار",
    );
    expect(await pageOverflow(page)).toBe(0);
    await screenshot(page, "hunts-hunt-fa-1440");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Add to Case, and the events kept on a case
 * ---------------------------------------------------------------------------
 */

test.describe("Add to Case from a hunt", () => {
  test("keeps the ticked events on the case picked, naming the hunt, and the case's Evidence page lists them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, HUNT_PATH);

    await expect(eventRows(page)).toHaveCount(4);
    await eventRows(page).nth(0).check();
    await eventRows(page).nth(1).check();
    await page.getByText("Bulk Actions", { exact: true }).click();
    await page.getByRole("menuitem", { name: "Add to Case" }).click();

    await expect(dialog(page)).toContainText("Add to a Case");
    await dialog(page)
      .getByTestId("security-add-to-case-row")
      .filter({ hasText: "CASE-138" })
      .click();
    await screenshot(page, "hunts-add-to-case-1440", { window: true });
    await dialog(page).getByRole("button", { name: "Add 2 Events" }).click();

    // One request for both, naming the hunt; one kept already.
    await expect(dialog(page)).toContainText("1 Event added to the case");
    await expect(dialog(page)).toContainText("Already kept on this case.");

    const [request] = await requestsTo(
      page,
      "/security-case-evidence/add-events",
    );

    expect(request).toMatchObject({
      securityCaseId: CASE_138_ID,
      securityHuntId: ENCODED_POWERSHELL_ID,
    });
    expect(
      (request!["events"] as Array<{ eventUid: string }>).map(
        (event: { eventUid: string }): string => {
          return event.eventUid;
        },
      ),
    ).toEqual(["evt-0001", "evt-0002"]);

    await dialog(page)
      .getByRole("link", { name: /Open CASE-138/ })
      .click();
    await expectPath(page, CASE_138_EVIDENCE_PATH);

    const hunted: Locator = page.getByTestId(
      "security-case-evidence-event-hunt",
    );

    await expect(hunted).toHaveCount(2);
    await expect(hunted.first()).toContainText(
      "Found by the hunt Encoded PowerShell",
    );
    await screenshot(page, "hunts-case-evidence-1440");
  });

  test("a kept event opens as it was kept, and links back to the hunt", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASE_138_EVIDENCE_PATH);

    await page.getByRole("button", { name: "View Event" }).first().click();
    await expect(
      page.getByText("Encoded PowerShell downloaded a script on web-03").last(),
    ).toBeVisible();
    await expect(
      page.getByText(/Kept on this case as OneUptime read it/),
    ).toBeVisible();
    await screenshot(page, "hunts-view-event-1440", { window: true });

    await page.keyboard.press("Escape");
    await page
      .getByTestId("security-case-evidence-event-hunt")
      .getByRole("link", { name: "Encoded PowerShell" })
      .click();
    await expectPath(page, HUNT_PATH);
  });
});
