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
 * A security case's response targets, tasks and evidence on the Security
 * Operations fixture's synthetic month (Fixture/CaseWorkFixture.js lays
 * them out): a case's Tasks and Evidence pages, Security Events > Settings >
 * Response Targets, and the due times on a case's header, its Overview and
 * the case lists. What the unit tests cannot see: that the pages are
 * reached from the menus, that what they send is what the fixture
 * records, that the menu's count and Close Case follow the checklist, and
 * that each page fits a laptop's width and a phone's, in both themes.
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
const caseIdOf: (number: number) => string = (number: number): string => {
  return `20000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
};
const SPRAY_CASE_PATH: string = `${PRODUCT}/cases/${caseIdOf(142)}`;
const TASKS_PATH: string = `${SPRAY_CASE_PATH}/tasks`;
const EVIDENCE_PATH: string = `${SPRAY_CASE_PATH}/evidence`;
const RESPONSE_TARGETS_PATH: string = `${PRODUCT}/settings/response-targets`;
const OPEN_CASES_PATH: string = `${PRODUCT}/cases`;

// The SHA-256 the fixture's Okta export was kept with (CaseWorkFixture.js).
const OKTA_EXPORT_SHA256: string =
  "9f2c1a7e4b8d3f60c5e1a2b7d9083e4f6a1c5b2d8e7f9a0b3c4d5e6f7a8b9c0d";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/security-operations-ui",
);

interface FixtureState {
  listRequests: Array<{
    modelName: string;
    query: Record<string, unknown>;
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
  role?: "viewer";
  targets?: "on";
  lang?: "de" | "fa";
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
    width: options.width || 1280,
    height: options.height || 1000,
  });
  await page.clock.setFixedTime(NOW);
  const url: URL = new URL(target, `http://127.0.0.1:${PORT}`);
  if (options.theme === "dark") {
    url.searchParams.set("theme", "dark");
  }
  if (options.role) {
    url.searchParams.set("role", options.role);
  }
  if (options.targets) {
    url.searchParams.set("targets", options.targets);
  }
  if (options.lang) {
    url.searchParams.set("lang", options.lang);
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

async function screenshot(
  page: Page,
  name: string,
  options: { fullPage?: boolean } = {},
): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: options.fullPage !== false,
    animations: "disabled",
  });
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

function menuEntry(page: Page, title: string): Locator {
  return sideMenu(page).getByRole("link", { name: title, exact: true });
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

// The number drawn beside a menu entry, or "" when there is none.
async function menuCount(page: Page, title: string): Promise<string> {
  const badge: Locator = menuEntry(page, title).locator("span.rounded-full");

  if ((await badge.count()) === 0) {
    return "";
  }

  return ((await badge.first().textContent()) || "").trim();
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

function taskRows(page: Page): Locator {
  return page.getByTestId("security-case-task");
}

function taskRow(page: Page, title: string): Locator {
  return taskRows(page).filter({
    has: page.getByTestId("security-case-task-title").getByText(title, {
      exact: true,
    }),
  });
}

async function taskTitles(page: Page): Promise<Array<string>> {
  return (
    await page.getByTestId("security-case-task-title").allInnerTexts()
  ).map((title: string): string => {
    return title.trim();
  });
}

function progress(page: Page): Locator {
  return page.getByTestId("security-case-tasks-progress");
}

async function openTaskMenu(page: Page, title: string): Promise<Locator> {
  await taskRow(page, title).getByTestId("security-case-task-more").click();
  const menu: Locator = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

function chip(page: Page): Locator {
  return page.getByTestId("security-case-target-chip");
}

// An id as a create sends it: the model's JSON form of an ObjectID.
function objectId(value: string): { _type: string; value: string } {
  return { _type: "ObjectID", value };
}

/*
 * ---------------------------------------------------------------------------
 * Tasks
 * ---------------------------------------------------------------------------
 */

test.describe("a case's tasks", () => {
  test("the spray case's checklist: each task a line, how many are done beside the title, the open ones counted in the menu", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE_PATH);
    await expect(menuEntry(page, "Tasks")).toBeVisible({ timeout: 30000 });
    await expect
      .poll(async (): Promise<string> => {
        return menuCount(page, "Tasks");
      })
      .toBe("2");

    await menuEntry(page, "Tasks").click();
    await expect(taskRows(page)).toHaveCount(3, { timeout: 30000 });
    expect(await litEntries(page)).toEqual(["Tasks"]);
    expect(await breadcrumbs(page)).toEqual([
      "Project",
      "Security Events",
      "Security Cases",
      "CASE-142",
      "Tasks",
    ]);

    // The oldest first.
    expect(await taskTitles(page)).toEqual([
      "Block 203.0.113.47 at the edge",
      "Reset the sprayed accounts' passwords",
      "Ask the help desk who called in",
    ]);

    const done: Locator = taskRow(page, "Block 203.0.113.47 at the edge");
    await expect(done).toHaveAttribute("data-done", "true");
    await expect(done.getByTestId("security-case-task-done")).toBeChecked();
    await expect(done.getByTestId("security-case-task-done-line")).toHaveText(
      "Done by Diego Alvarez 40 minutes ago",
    );

    const unassigned: Locator = taskRow(
      page,
      "Ask the help desk who called in",
    );
    await expect(
      unassigned.getByTestId("security-case-task-assignee"),
    ).toContainText("Unassigned");
    await expect(
      taskRow(page, "Reset the sprayed accounts' passwords").getByTestId(
        "security-case-task-assignee",
      ),
    ).toContainText("Maya Chen");

    await expect(progress(page)).toHaveText("1 of 3 done");
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "case-tasks-1280-light");
  });

  test("a task is added with Enter, ticked off and on, handed to the reader and deleted after asking; the menu's count follows", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, TASKS_PATH);
    await expect(taskRows(page)).toHaveCount(3, { timeout: 30000 });

    // Added, trimmed, at the end of the list.
    const input: Locator = page.getByTestId("security-case-task-add-input");
    await input.fill("  Rotate the Okta API token  ");
    await input.press("Enter");
    await expect(taskRows(page)).toHaveCount(4);
    expect((await taskTitles(page)).slice(-1)).toEqual([
      "Rotate the Okta API token",
    ]);
    await expect(input).toHaveValue("");
    expect(
      (await fixture(page)).creates.filter(
        (create: { modelName: string }): boolean => {
          return create.modelName === "SecurityCaseTask";
        },
      ),
    ).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Rotate the Okta API token",
          securityCaseId: objectId(caseIdOf(142)),
          projectId: objectId(PROJECT_ID),
        }),
      }),
    ]);
    await expect(progress(page)).toHaveText("1 of 4 done");
    await expect
      .poll(async (): Promise<string> => {
        return menuCount(page, "Tasks");
      })
      .toBe("3");

    // Ticked off: who and when, and one fewer open.
    const added: Locator = taskRow(page, "Rotate the Okta API token");
    await added.getByTestId("security-case-task-done").click();
    await expect(added).toHaveAttribute("data-done", "true");
    await expect(
      added.getByTestId("security-case-task-done-line"),
    ).toContainText("Done by Maya Chen");
    await expect(progress(page)).toHaveText("2 of 4 done");
    await expect
      .poll(async (): Promise<string> => {
        return menuCount(page, "Tasks");
      })
      .toBe("2");

    // And on again.
    await added.getByTestId("security-case-task-done").click();
    await expect(added).toHaveAttribute("data-done", "false");
    await expect(progress(page)).toHaveText("1 of 4 done");

    // Handed to the reader from its ⋯.
    let menu: Locator = await openTaskMenu(
      page,
      "Ask the help desk who called in",
    );
    await menu.getByRole("menuitem", { name: "Assign to Me" }).click();
    await expect(
      taskRow(page, "Ask the help desk who called in").getByTestId(
        "security-case-task-assignee",
      ),
    ).toContainText("Maya Chen");

    // Deleted, after saying the timeline keeps a record.
    menu = await openTaskMenu(page, "Rotate the Okta API token");
    await menu.getByRole("menuitem", { name: "Delete Task" }).click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toContainText(
      "Delete Rotate the Okta API token? The case's timeline keeps a record that it was deleted.",
    );
    await dialog.getByRole("button", { name: "Delete Task" }).click();
    await expect(taskRows(page)).toHaveCount(3);

    const state: FixtureState = await fixture(page);
    expect(
      state.updates
        .filter((update: { modelName: string }): boolean => {
          return update.modelName === "SecurityCaseTask";
        })
        .map((update: { data: Record<string, unknown> }) => {
          return update.data;
        }),
    ).toEqual([
      { isDone: true },
      { isDone: false },
      { assignedToUserId: "80000000-0000-4000-8000-000000000001" },
    ]);
    expect(
      state.deletes.filter((item: { modelName: string }): boolean => {
        return item.modelName === "SecurityCaseTask";
      }),
    ).toHaveLength(1);
  });

  test("Close Case says how many tasks are still open", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE_PATH);
    await expect(page.getByTestId("security-case-close")).toBeVisible({
      timeout: 30000,
    });
    await page.getByTestId("security-case-close").click();

    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toContainText("2 tasks on this case are still open.");
    await screenshot(page, "case-close-open-tasks-1280-light", {
      fullPage: false,
    });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  });

  test("a Security Viewer reads the checklist, its boxes locked, and no line to add one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, TASKS_PATH, { role: "viewer" });
    await expect(taskRows(page)).toHaveCount(3, { timeout: 30000 });

    for (const box of await page.getByTestId("security-case-task-done").all()) {
      await expect(box).toBeDisabled();
    }
    await expect(page.getByTestId("security-case-task-add-input")).toHaveCount(
      0,
    );
  });

  test("at 390, 768 and 1024 and in the dark theme, the checklist fits", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [width, theme] of [
      [390, undefined],
      [390, "dark"],
      [768, undefined],
      [1024, undefined],
      [1280, "dark"],
    ] as Array<[number, "dark" | undefined]>) {
      await open(page, TASKS_PATH, {
        width,
        height: width === 390 ? 844 : 1000,
        theme,
      });
      await expect(taskRows(page)).toHaveCount(3, { timeout: 30000 });
      expect(
        await pageOverflow(page),
        `tasks at ${width} ${theme || "light"}`,
      ).toBeLessThanOrEqual(1);
      await screenshot(page, `case-tasks-${width}-${theme || "light"}`);
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * Evidence
 * ---------------------------------------------------------------------------
 */

test.describe("a case's evidence", () => {
  function names(page: Page): Locator {
    return page.getByTestId("security-case-evidence-name");
  }

  // Who added each piece of evidence and when, the line under it.
  async function addedLines(page: Page): Promise<Array<string>> {
    return (
      await page.getByTestId("security-case-evidence-added").allInnerTexts()
    ).map((line: string): string => {
      return line.trim();
    });
  }

  /*
   * How far the evidence table runs past the box it is drawn in: 0 when
   * its rows never scroll sideways.
   */
  async function tableOverflow(page: Page): Promise<number> {
    return page
      .locator("#security-case-evidence-table-body")
      .evaluate((body: Element): number => {
        const table: Element | null = body.closest("table");
        const box: Element | null | undefined = table?.parentElement;

        if (!table || !box) {
          return 0;
        }

        return Math.max(
          0,
          Math.floor(table.getBoundingClientRect().width) -
            Math.ceil(box.getBoundingClientRect().width),
        );
      });
  }

  // The Evidence card: the one around the evidence table.
  function evidenceCard(page: Page): Locator {
    return page
      .getByTestId("card")
      .filter({ has: page.locator("#security-case-evidence-table-body") });
  }

  /*
   * A table card shows one main button - Add File - and keeps the rest in
   * its ⋯, Add Link with them.
   */
  async function openCardMenu(page: Page): Promise<Locator> {
    await evidenceCard(page)
      .getByRole("button", { name: "More options", exact: true })
      .click();
    const menu: Locator = page.getByRole("menu");
    await expect(menu).toBeVisible();
    return menu;
  }

  test("the files and links kept on the case, the latest first: a file with its name, size and SHA-256, a link with its address", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE_PATH);
    await expect(menuEntry(page, "Evidence")).toBeVisible({ timeout: 30000 });
    await menuEntry(page, "Evidence").click();

    await expect(names(page)).toHaveCount(2, { timeout: 30000 });
    expect(await litEntries(page)).toEqual(["Evidence"]);
    expect(await breadcrumbs(page)).toEqual([
      "Project",
      "Security Events",
      "Security Cases",
      "CASE-142",
      "Evidence",
    ]);
    expect(
      (await names(page).allInnerTexts()).map((name: string): string => {
        return name.trim();
      }),
    ).toEqual([
      "Okta admin console: the sprayed accounts",
      "Okta System Log export",
    ]);

    const metas: Array<string> = (
      await page.getByTestId("security-case-evidence-meta").allInnerTexts()
    ).map((meta: string): string => {
      return meta.trim();
    });
    expect(metas).toEqual([
      "https://acme-commerce.okta.example/admin/users?filter=sprayed",
      "okta-system-log-2026-10-14.json · 470.8 KB",
    ]);
    await expect(page.getByTestId("security-case-evidence-sha256")).toHaveText(
      "9f2c1a7e…9c0d",
    );
    await expect(
      page.getByTestId("security-case-evidence-sha256"),
    ).toHaveAttribute("title", OKTA_EXPORT_SHA256);

    /*
     * Who added each and when, a line under it - the table's one column,
     * so no name is cut short and the rows never scroll sideways.
     */
    expect(await addedLines(page)).toEqual([
      "Added by Diego Alvarez an hour ago",
      "Added by Maya Chen 3 hours ago",
    ]);
    // The table's header names one column: Evidence.
    const header: Locator = page
      .locator("#security-case-evidence-table-body")
      .locator("xpath=preceding-sibling::thead");
    await expect(header).toContainText("Evidence");
    await expect(header).not.toContainText("Added");
    expect(await tableOverflow(page)).toBe(0);
    await expect(
      page.getByRole("button", { name: "Download", exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Open Link", exact: true }),
    ).toHaveCount(1);

    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "case-evidence-1280-light");
  });

  test("Add Link files a link on the case", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, EVIDENCE_PATH);
    await expect(names(page)).toHaveCount(2, { timeout: 30000 });

    await expect(
      evidenceCard(page).getByRole("button", { name: "Add File", exact: true }),
    ).toBeEnabled();
    const menu: Locator = await openCardMenu(page);
    await menu.getByRole("menuitem", { name: "Add Link", exact: true }).click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toContainText("Add a Link as Evidence");
    await screenshot(page, "case-evidence-add-link-1280-light", {
      fullPage: false,
    });

    await dialog
      .getByPlaceholder("https://")
      .fill("https://intranet.acme-commerce.example/tickets/4521");
    await dialog.getByPlaceholder("The link itself").fill("Ticket 4521");
    await dialog.getByRole("button", { name: "Add Link", exact: true }).click();

    await expect(dialog).toHaveCount(0);
    await expect(names(page)).toHaveCount(3);
    // The latest first.
    await expect(names(page).first()).toHaveText("Ticket 4521");

    const creates: Array<{ modelName: string; data: Record<string, unknown> }> =
      (await fixture(page)).creates.filter(
        (create: { modelName: string }): boolean => {
          return create.modelName === "SecurityCaseEvidence";
        },
      );
    expect(creates).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "Link",
          name: "Ticket 4521",
          securityCaseId: objectId(caseIdOf(142)),
        }),
      }),
    ]);
    expect(JSON.stringify(creates[0]!.data)).toContain(
      "https://intranet.acme-commerce.example/tickets/4521",
    );
  });

  test("a Security Viewer cannot add evidence: Add File and Add Link are locked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, EVIDENCE_PATH, { role: "viewer" });
    await expect(names(page)).toHaveCount(2, { timeout: 30000 });

    await expect(
      evidenceCard(page).getByRole("button", { name: "Add File", exact: true }),
    ).toBeDisabled();
    const menu: Locator = await openCardMenu(page);
    await expect(
      menu.getByRole("menuitem", { name: "Add Link", exact: true }),
    ).toHaveAttribute("aria-disabled", "true");
    await menu
      .getByRole("menuitem", { name: "Add Link", exact: true })
      .click({ force: true });
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("at 390, 768, 1024 and 1100 and in the dark theme, the page fits and the rows never scroll sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [width, theme] of [
      [390, undefined],
      [390, "dark"],
      [768, undefined],
      [1024, undefined],
      [1100, undefined],
      [1280, "dark"],
    ] as Array<[number, "dark" | undefined]>) {
      await open(page, EVIDENCE_PATH, {
        width,
        height: width === 390 ? 844 : 1000,
        theme,
      });
      await expect(names(page).first()).toBeVisible({ timeout: 30000 });
      expect(
        await pageOverflow(page),
        `evidence at ${width} ${theme || "light"}`,
      ).toBeLessThanOrEqual(1);

      // Each piece of evidence says who added it and when, at every width.
      expect(await addedLines(page), `added lines at ${width}`).toEqual([
        "Added by Diego Alvarez an hour ago",
        "Added by Maya Chen 3 hours ago",
      ]);

      /*
       * From md up a table: beside the side menu its card is 620 to 760px
       * wide from 1024 to 1100px, and the rows still fit it.
       */
      if (width >= 768) {
        expect(await tableOverflow(page), `evidence table at ${width}`).toBe(0);
      }

      await screenshot(page, `case-evidence-${width}-${theme || "light"}`);
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * Response targets
 * ---------------------------------------------------------------------------
 */

test.describe("response targets", () => {
  // The table's rows: its body carries the table's id.
  function targetRows(page: Page): Locator {
    return page.locator("#security-response-targets-table-body > tr");
  }

  async function rowTexts(page: Page): Promise<Array<string>> {
    return (await targetRows(page).allInnerTexts()).map(
      (row: string): string => {
        return row.replace(/\s+/g, " ").trim();
      },
    );
  }

  test("Settings > Response Targets lists each priority's two targets, beside Case Priorities", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RESPONSE_TARGETS_PATH, { targets: "on" });
    await expect(targetRows(page)).toHaveCount(5, { timeout: 30000 });
    expect(await litEntries(page)).toEqual(["Response Targets"]);

    const settings: Array<string> = (
      await sideMenu(page).getByRole("link").allInnerTexts()
    ).map((title: string): string => {
      return title.trim();
    });
    expect(
      settings.slice(
        settings.indexOf("Case Priorities"),
        settings.indexOf("Case Statuses") + 1,
      ),
    ).toEqual(["Case Priorities", "Response Targets", "Case Statuses"]);

    const rows: Array<string> = await rowTexts(page);
    expect(rows[0]).toContain("Critical");
    expect(rows[0]).toContain("15 min");
    expect(rows[0]).toContain("4 h");
    expect(rows[1]).toContain("1 h");
    expect(rows[1]).toContain("1 d");
    expect(rows[2]).toContain("12 h");
    expect(rows[2]).toContain("3 d");
    expect(rows[3]).toContain("7 d");
    expect(rows[4]).toContain("No target");

    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "response-targets-1280-light");
  });

  test("a project from before response targets reads No target on every priority", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RESPONSE_TARGETS_PATH);
    await expect(targetRows(page)).toHaveCount(5, { timeout: 30000 });

    for (const row of await rowTexts(page)) {
      expect(row).toContain("No target");
    }
  });

  test("Edit sets a target in its unit, and refuses what it cannot keep", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RESPONSE_TARGETS_PATH, { targets: "on" });
    await expect(targetRows(page)).toHaveCount(5, { timeout: 30000 });

    await targetRows(page)
      .first()
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const amounts: Locator = dialog.getByTestId(
      "response-target-duration-amount",
    );
    await expect(amounts.first()).toHaveValue("15");
    await expect(amounts.nth(1)).toHaveValue("4");

    /*
     * Each target on one line: the amount and its unit level with each
     * other, the unit named in full, and nothing to clear it to - an empty
     * amount is what says no target.
     */
    const fields: Locator = dialog.getByTestId("response-target-duration");
    await expect(fields).toHaveCount(2);
    for (const field of await fields.all()) {
      const amount: { y: number; height: number } | null = await field
        .getByTestId("response-target-duration-amount")
        .boundingBox();
      const unit: { y: number; height: number } | null = await field
        .locator(".ou-select__control")
        .boundingBox();
      expect(Math.abs(amount!.y - unit!.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(amount!.height - unit!.height)).toBeLessThanOrEqual(2);
      expect(
        await field
          .getByTestId("dropdown-value-label")
          .evaluate((label: Element): boolean => {
            return label.scrollWidth <= label.clientWidth;
          }),
      ).toBe(true);
    }
    expect(
      (await fields.getByTestId("dropdown-value-label").allInnerTexts()).map(
        (label: string): string => {
          return label.trim();
        },
      ),
    ).toEqual(["Minutes", "Hours"]);
    await expect(dialog.locator(".ou-select__clear-indicator")).toHaveCount(0);

    await screenshot(page, "response-targets-edit-1280-light", {
      fullPage: false,
    });

    // Nothing that is not a whole number from 1 is kept.
    await amounts.first().fill("0");
    await dialog
      .getByRole("button", { name: "Save Changes", exact: true })
      .click();
    await expect(dialog).toContainText(
      "Enter a whole number from 1 up, or leave it empty.",
    );

    await amounts.first().fill("30");
    await dialog
      .getByRole("button", { name: "Save Changes", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(targetRows(page).first()).toContainText("30 min");
    expect(
      (await fixture(page)).updates.filter(
        (update: { modelName: string }): boolean => {
          return update.modelName === "SecurityCasePriority";
        },
      ),
    ).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ acknowledgeWithinInMinutes: 30 }),
      }),
    ]);
  });

  test("at 390, 768 and 1024 and in the dark theme, Response Targets and its Edit fit", async ({
    page,
  }: {
    page: Page;
  }) => {
    // A phone draws the table's rows as a list, under the same body.
    const body: Locator = page.locator("#security-response-targets-table-body");

    for (const [width, theme] of [
      [390, undefined],
      [390, "dark"],
      [768, undefined],
      [1024, undefined],
      [1280, "dark"],
    ] as Array<[number, "dark" | undefined]>) {
      await open(page, RESPONSE_TARGETS_PATH, {
        targets: "on",
        width,
        height: width === 390 ? 844 : 1000,
        theme,
      });
      await expect(
        body.getByText("Informational", { exact: true }),
      ).toBeVisible({ timeout: 30000 });
      await expect(body.getByText("No target", { exact: true })).toHaveCount(2);
      expect(
        await pageOverflow(page),
        `response targets at ${width} ${theme || "light"}`,
      ).toBeLessThanOrEqual(1);
      await screenshot(page, `response-targets-${width}-${theme || "light"}`);
    }

    // Edit on a phone: each amount and its unit still side by side, inside.
    await open(page, RESPONSE_TARGETS_PATH, {
      targets: "on",
      width: 390,
      height: 844,
    });
    await body
      .getByRole("button", { name: "Edit", exact: true })
      .first()
      .click({ timeout: 30000 });
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const dialogBox: { x: number; width: number } | null =
      await dialog.boundingBox();
    for (const field of await dialog
      .getByTestId("response-target-duration")
      .all()) {
      const box: { x: number; width: number } | null =
        await field.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(dialogBox!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(
        dialogBox!.x + dialogBox!.width + 1,
      );
    }
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "response-targets-edit-390-light", {
      fullPage: false,
    });
  });

  test("a case's header says the target it works against now: grey with time, amber in its last fifth, red once missed, nothing once met", async ({
    page,
  }: {
    page: Page;
  }) => {
    const expected: Array<[number, string | null, string | null]> = [
      [141, "AtRisk", "Acknowledge in 12 min"],
      [142, "AtRisk", "Contain in 48 min"],
      [139, "OnTrack", "Contain in 2 d 17 h"],
      [138, "Missed", "Acknowledge overdue by 1 h"],
      [140, null, null],
    ];

    for (const [number, state, text] of expected) {
      await open(page, `${PRODUCT}/cases/${caseIdOf(number)}`, {
        targets: "on",
      });
      await expect(page.getByTestId("security-case-header")).toBeVisible({
        timeout: 30000,
      });

      if (state === null) {
        await expect(
          page.getByTestId("security-case-status-steps"),
        ).toBeVisible();
        await expect(chip(page)).toHaveCount(0);
        continue;
      }

      await expect(chip(page)).toHaveAttribute("data-state", state);
      await expect(chip(page)).toHaveText(text!);
    }

    await open(page, `${PRODUCT}/cases/${caseIdOf(138)}`, { targets: "on" });
    await expect(chip(page)).toBeVisible({ timeout: 30000 });
    await screenshot(page, "case-header-target-missed-1280-light", {
      fullPage: false,
    });

    // Without targets, no chip.
    await open(page, `${PRODUCT}/cases/${caseIdOf(141)}`);
    await expect(page.getByTestId("security-case-header")).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByTestId("security-case-status-steps")).toBeVisible();
    await expect(chip(page)).toHaveCount(0);
  });

  test("a case's Overview says where it stands against each target, under Time to Acknowledge and Time to Contain", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${PRODUCT}/cases/${caseIdOf(140)}`, { targets: "on" });
    const notes: Locator = page.getByTestId("security-case-target-note");
    await expect(notes).toHaveCount(2, { timeout: 30000 });
    expect(
      (await notes.allInnerTexts()).map((note: string): string => {
        return note.trim();
      }),
    ).toEqual(["5 min over its 15 min target", "Within its 4 h target"]);

    await open(page, SPRAY_CASE_PATH, { targets: "on" });
    await expect(notes).toHaveCount(2, { timeout: 30000 });
    expect(
      (await notes.allInnerTexts()).map((note: string): string => {
        return note.trim();
      }),
    ).toEqual(["Within its 15 min target", "Due in 48 min"]);
    await screenshot(page, "case-overview-targets-1280-light");
  });

  test("the open cases say under each priority when its next target is due; nothing without targets", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OPEN_CASES_PATH, { targets: "on" });
    const lines: Locator = page.getByTestId("security-case-row-due-line");
    await expect(lines.first()).toBeVisible({ timeout: 30000 });

    const texts: Array<string> = (await lines.allInnerTexts()).map(
      (line: string): string => {
        return line.trim();
      },
    );
    expect(texts).toEqual(
      expect.arrayContaining([
        "Contain in 48 min",
        "Acknowledge in 12 min",
        "Acknowledge overdue by 1 h",
      ]),
    );
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "cases-due-lines-1280-light");

    await open(page, OPEN_CASES_PATH, {
      targets: "on",
      width: 390,
      height: 844,
    });
    await expect(lines.first()).toBeVisible({ timeout: 30000 });
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "cases-due-lines-390-light");

    await open(page, OPEN_CASES_PATH);
    await expect(
      page.getByText("Password spray against Okta from 203.0.113.47"),
    ).toBeVisible({ timeout: 30000 });
    await expect(lines).toHaveCount(0);
  });
});

/*
 * ---------------------------------------------------------------------------
 * In German and Persian
 * ---------------------------------------------------------------------------
 */

test.describe("in German and Persian", () => {
  const PAGES: Array<{
    target: string;
    slug: string;
    words: { de: string; fa: string };
    ready: (page: Page) => Locator;
  }> = [
    {
      target: TASKS_PATH,
      slug: "case-tasks",
      // "1 of 3 done"
      words: { de: "erledigt", fa: "انجام شد" },
      ready: (page: Page): Locator => {
        return taskRows(page).first();
      },
    },
    {
      target: EVIDENCE_PATH,
      slug: "case-evidence",
      // Add File
      words: { de: "Datei hinzufügen", fa: "افزودن فایل" },
      ready: (page: Page): Locator => {
        return page.getByTestId("security-case-evidence-name").first();
      },
    },
    {
      target: RESPONSE_TARGETS_PATH,
      slug: "response-targets",
      // No target, on Informational
      words: { de: "Kein Ziel", fa: "بدون هدف" },
      // The priorities' names are in the reader's language too.
      ready: (page: Page): Locator => {
        return page.locator("#security-response-targets-table-body");
      },
    },
  ];

  test("Tasks, Evidence and Response Targets read in the reader's language, and fit at 1280 and 390", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(240000);

    for (const lang of ["de", "fa"] as Array<"de" | "fa">) {
      for (const width of [1280, 390]) {
        for (const entry of PAGES) {
          await open(page, entry.target, {
            width,
            height: width === 390 ? 844 : 1000,
            lang,
            targets: "on",
          });
          await expect(entry.ready(page)).toBeVisible({ timeout: 30000 });
          await expect(
            page.getByText(entry.words[lang]).filter({ visible: true }).first(),
          ).toBeVisible({ timeout: 30000 });
          expect(
            await pageOverflow(page),
            `${entry.slug} at ${width} in ${lang}`,
          ).toBeLessThanOrEqual(1);
          await screenshot(page, `${entry.slug}-${width}-${lang}`);
        }
      }
    }
  });
});
