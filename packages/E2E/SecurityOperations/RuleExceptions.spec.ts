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
 * Detection rule exceptions and Run on Past Events on the Security
 * Operations fixture's synthetic month (Fixture/RuleExceptionsFixture.js
 * lays the exceptions out and answers the runs): Security Events >
 * Detections > Rule Exceptions, a rule's Add Exception, View Exceptions and
 * Run on Past Events, the form's own Run on Past Events, and Add Exception
 * on a case's detection. What the unit tests cannot see: that the pages
 * are reached from the side menu and their rows, that the form walks and
 * sends what it says, that a run's answer reads in the dialog, and that
 * each page fits the screen at a laptop's width and a phone's.
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
const RULE_EXCEPTIONS_PATH: string = `${PRODUCT}/rule-exceptions`;
const DETECTION_RULES_PATH: string = `${PRODUCT}/detection-rules`;
const SPRAY_CASE_DETECTIONS_PATH: string = `${PRODUCT}/cases/20000000-0000-4000-8000-000000000142/detections`;

// The fixture's rules (the Rule Library's first four, and the team's sequence).
const BRUTE_FORCE: string = "Brute force from one IP address";
const BRUTE_FORCE_ID: string = "26000000-0000-4000-8000-000000000001";
const PASSWORD_SPRAYING: string = "Password spraying";
const SEQUENCE_RULE: string = "Spray, then a success";

const SPRAY_IP: string = "203.0.113.47";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/security-operations-ui",
);

interface FixtureState {
  listRequests: Array<{
    modelName: string;
    query: Record<string, unknown>;
  }>;
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
  unhandled: Array<unknown>;
}

interface OpenOptions {
  width?: number;
  height?: number;
  theme?: "dark" | undefined;
  role?: "viewer";
  retrohunt?: "quiet" | "noisy" | "fail";
  lang?: "fa" | "de" | "ru" | "fr";
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
  if (options.role) {
    url.searchParams.set("role", options.role);
  }
  if (options.retrohunt) {
    url.searchParams.set("retrohunt", options.retrohunt);
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

// The list's rows (a table row, or a phone's card).
function exceptionRows(page: Page): Locator {
  return page.getByTestId("rule-exception-skips");
}

// The nearest box around a row's text that holds its ⋯, opened.
async function openRowMenu(page: Page, text: string): Promise<Locator> {
  const row: Locator = page
    .getByText(text, { exact: true })
    .first()
    .locator(
      "xpath=ancestor::*[.//*[@data-testid='row-actions-more-button']][1]",
    );

  await row.getByTestId("row-actions-more-button").first().click();
  const menu: Locator = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

// The line under a row's status pill: how far off, the date under the pointer.
function statusLine(row: Locator): Locator {
  return row.getByTestId("rule-exception-status").locator("span[title]");
}

// The rows of the list that hold a text: the row's whole box.
function rowWith(page: Page, text: string): Locator {
  return page
    .getByText(text, { exact: true })
    .first()
    .locator(
      "xpath=ancestor::*[.//*[@data-testid='row-actions-more-button']][1]",
    );
}

// The end of a line a long name may break at: after a dot, a slash or a hyphen.
const LINE_ENDS_AT_A_SEPARATOR: RegExp = /[./-]$/;

// An element's text as the browser lays it out: one string per line.
async function renderedLines(element: Locator): Promise<Array<string>> {
  return await element.evaluate((box: Element): Array<string> => {
    const lines: Array<{ top: number; text: string }> = [];
    const walker: TreeWalker = document.createTreeWalker(
      box,
      NodeFilter.SHOW_TEXT,
    );
    for (
      let node: Node | null = walker.nextNode();
      node;
      node = walker.nextNode()
    ) {
      const text: string = node.textContent || "";
      for (let index: number = 0; index < text.length; index++) {
        const range: Range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const top: number = range.getBoundingClientRect().top;
        const last: { top: number; text: string } | undefined =
          lines[lines.length - 1];
        if (last && Math.abs(last.top - top) < 4) {
          last.text += text.charAt(index);
        } else {
          lines.push({ top, text: text.charAt(index) });
        }
      }
    }
    return lines.map((line: { top: number; text: string }): string => {
      return line.text;
    });
  });
}

async function retrohuntRequests(
  page: Page,
): Promise<Array<Record<string, unknown>>> {
  return (await fixture(page)).apiRequests
    .filter((request: { method: string; url: string }): boolean => {
      return (
        request.method === "POST" &&
        new URL(request.url).pathname.endsWith("/detection-rule/retrohunt")
      );
    })
    .map((request: { body: Record<string, unknown> | null }) => {
      return request.body || {};
    });
}

async function exceptionCreates(
  page: Page,
): Promise<Array<Record<string, unknown>>> {
  return (await fixture(page)).creates
    .filter((create: { modelName: string }): boolean => {
      return create.modelName === "DetectionRuleException";
    })
    .map((create: { data: Record<string, unknown> }) => {
      return create.data;
    });
}

/*
 * ---------------------------------------------------------------------------
 * Security Events > Detections > Rule Exceptions
 * ---------------------------------------------------------------------------
 */
test.describe("Rule Exceptions", () => {
  test("lists what every rule skips, where each stands and who added it, under Detections", async ({
    page,
  }: {
    page: Page;
  }) => {
    // The fixture is 64px narrower than production: 1344 here is a 1280 laptop.
    await open(page, RULE_EXCEPTIONS_PATH, { width: 1344 });
    await expect(exceptionRows(page)).toHaveCount(6, { timeout: 30000 });

    expect(await litEntries(page)).toEqual(["Rule Exceptions"]);
    expect(await breadcrumbs(page)).toEqual([
      "Project",
      "Security Events",
      "Detections",
      "Rule Exceptions",
    ]);
    await expect(
      page.getByRole("heading", { name: "Rule Exceptions", exact: true }),
    ).toBeVisible();

    // Beside the select-all box and the row actions: four columns.
    const headers: Array<string> = (
      await page.locator("table thead th").allTextContents()
    )
      .map((text: string): string => {
        return text.trim();
      })
      .filter((text: string): boolean => {
        return (
          Boolean(text) && text !== "Select all items" && text !== "Actions"
        );
      });
    expect(headers).toEqual(["Skips", "Rule", "Reason", "Status"]);

    // Every state a row can be in, and how far off.
    const scanner: Locator = rowWith(page, "10.20.0.0/16");
    await expect(scanner).toContainText("IP address range");
    await expect(scanner).toContainText(BRUTE_FORCE);
    await expect(scanner).toContainText("Our vulnerability scanners.");
    await expect(scanner).toContainText("Added by Maya Chen 20 days ago");
    await expect(scanner.getByTestId("rule-exception-status")).toContainText(
      "Active",
    );
    await expect(scanner.getByTestId("rule-exception-status")).toContainText(
      "No expiry",
    );

    // Under the pill, how far off; the date itself under the pointer.
    const backupJob: Locator = rowWith(page, "svc-backup");
    await expect(backupJob).toContainText("User");
    await expect(statusLine(backupJob)).toHaveText("Expires in a month");
    await expect(statusLine(backupJob)).toHaveAttribute("title", /Nov 13/);

    // Expired: how long ago, the pill already saying which way it went.
    const agent: Locator = rowWith(page, "backup.exe");
    await expect(agent).toContainText("Value of processName");
    await expect(agent).toContainText(PASSWORD_SPRAYING);
    await expect(agent.getByTestId("rule-exception-status")).toContainText(
      "Expired",
    );
    await expect(statusLine(agent)).toHaveText("2 days ago");

    const redTeam: Locator = rowWith(
      page,
      "The red team exercise. Scheduled with the CISO.",
    );
    await expect(redTeam).toContainText("Time window");
    await expect(redTeam.getByTestId("rule-exception-status")).toContainText(
      "Upcoming",
    );
    await expect(statusLine(redTeam)).toHaveText("Starts in 21 hours");
    await expect(redTeam).toContainText("Oct 15, 9:00 AM to Oct 15, 1:00 PM");
    await expect(
      statusLine(
        rowWith(page, "The yearly penetration test by an outside firm."),
      ),
    ).toHaveText("8 days ago");

    /*
     * A value someone wrote is in the mono type, on its own isolate: a
     * parent's font-mono never reached it through the page's * rule.
     */
    expect(
      await scanner
        .locator("bdi", { hasText: "10.20.0.0/16" })
        .evaluate((element: Element): string => {
          return getComputedStyle(element).fontFamily;
        }),
    ).toContain("monospace");

    const lab: Locator = rowWith(page, "*.lab.acme-commerce.example");
    await expect(lab).toContainText("Added through the API a month ago");

    /*
     * A host pattern longer than its column breaks after its own dots or a
     * hyphen, never at the letter that fills the line ("*.lab.acme-commerc"
     * / "e.example", as it broke before).
     */
    const labLines: Array<string> = await renderedLines(
      lab.locator("bdi", { hasText: "*.lab.acme-commerce.example" }),
    );
    expect(labLines.length).toBeGreaterThan(1);
    expect(labLines.join("")).toBe("*.lab.acme-commerce.example");
    for (const line of labLines.slice(0, -1)) {
      expect(line).toMatch(LINE_ENDS_AT_A_SEPARATOR);
    }

    await expect(
      page.getByRole("button", { name: "Add Rule Exception", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("table-scroll").first()).toHaveAttribute(
      "data-overflowing",
      "false",
    );
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "rule-exceptions-desktop");
  });

  test("fits a phone: one card per exception, every part of it there", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RULE_EXCEPTIONS_PATH, { width: 390 });
    await expect(exceptionRows(page)).toHaveCount(6, { timeout: 30000 });

    const card: Locator = rowWith(page, "svc-backup");
    for (const part of ["Skips", "Rule", "Reason", "Status"]) {
      await expect(card).toContainText(part);
    }
    await expect(card).toContainText("Added by Diego Alvarez 6 days ago");
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "rule-exceptions-mobile");
  });

  test("reads right to left in Persian, and fits", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RULE_EXCEPTIONS_PATH, { width: 1344, lang: "fa" });
    await expect(exceptionRows(page)).toHaveCount(6, { timeout: 30000 });

    await expect(
      page.getByRole("heading", { name: "استثناهای قاعده", exact: true }),
    ).toBeVisible();
    // A value someone wrote reads the way it is written.
    await expect(rowWith(page, "svc-backup")).toBeVisible();
    // Every status in Persian: the red team's window is پیش‌رو (Upcoming).
    await expect(
      rowWith(
        page,
        "The red team exercise. Scheduled with the CISO.",
      ).getByTestId("rule-exception-status"),
    ).toContainText("پیش‌رو");
    await expect(
      rowWith(page, "Lab hosts are wiped every night."),
    ).toContainText("افزوده‌شده از طریق API");

    // Persian's longer status lines wrap under their pills: nothing runs under the row's actions.
    await expect(page.getByTestId("table-scroll").first()).toHaveAttribute(
      "data-overflowing",
      "false",
    );
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "rule-exceptions-persian", { fullPage: false });
  });

  test("fits its card beside the side menu at 1280 in German, Russian and French", async ({
    page,
  }: {
    page: Page;
  }) => {
    // Their Edit buttons and status words are the widest of the languages.
    for (const lang of ["de", "ru", "fr"] as const) {
      await open(page, RULE_EXCEPTIONS_PATH, { width: 1344, lang });
      await expect(exceptionRows(page)).toHaveCount(6, { timeout: 30000 });
      await expect(page.getByTestId("table-scroll").first()).toHaveAttribute(
        "data-overflowing",
        "false",
      );
      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    }
  });

  test("an exception that expired can still have its reason fixed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RULE_EXCEPTIONS_PATH);
    await expect(exceptionRows(page)).toHaveCount(6, { timeout: 30000 });

    await rowWith(page, "backup.exe")
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await expect(dialog(page)).toContainText("Edit Rule Exception");
    await dialog(page)
      .getByRole("button", { name: "Next", exact: true })
      .click();

    const reason: Locator = dialog(page).getByTestId("rule-exception-reason");
    await reason.fill("The old backup agent, until the new one took over.");
    await dialog(page)
      .getByRole("button", { name: "Save Changes", exact: true })
      .click();

    /*
     * Saved: its expiry, past, is the row's own - not "An exception
     * expires in the future", which only a new expiry is held to.
     */
    await expect(dialog(page)).toHaveCount(0);
    const update: { data: Record<string, unknown> } | undefined = (
      await fixture(page)
    ).updates.find((candidate: { modelName: string }): boolean => {
      return candidate.modelName === "DetectionRuleException";
    });
    expect(update?.data["reason"]).toBe(
      "The old backup agent, until the new one took over.",
    );
  });

  test("Delete names the exception it removes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RULE_EXCEPTIONS_PATH);
    await expect(exceptionRows(page)).toHaveCount(6, { timeout: 30000 });

    const menu: Locator = await openRowMenu(page, "svc-backup");
    await menu.getByRole("menuitem", { name: "Delete" }).click();

    await expect(dialog(page)).toContainText(
      "Are you sure you want to delete svc-backup?",
    );
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toHaveCount(0);
  });

  test("a viewer reads every exception and adds none", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RULE_EXCEPTIONS_PATH, { role: "viewer" });
    await expect(exceptionRows(page)).toHaveCount(6, { timeout: 30000 });

    // Locked where an editor has it, as every list's create button is.
    await expect(
      page.getByRole("button", { name: "Add Rule Exception", exact: true }),
    ).toBeDisabled();

    await open(page, DETECTION_RULES_PATH, { role: "viewer" });
    await expect(page.getByText(BRUTE_FORCE, { exact: true })).toBeVisible({
      timeout: 30000,
    });
    const menu: Locator = await openRowMenu(page, BRUTE_FORCE);
    await expect(
      menu.getByRole("menuitem", { name: "Add Exception" }),
    ).toHaveAttribute("aria-disabled", "true");
    // Reading what a rule would have found takes no write.
    await expect(
      menu.getByRole("menuitem", { name: "Run on Past Events" }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });
});

/*
 * ---------------------------------------------------------------------------
 * A rule's row: Add Exception, View Exceptions and the count under its name
 * ---------------------------------------------------------------------------
 */
test.describe("tuning a rule from its row", () => {
  test("a rule's name says how many of its exceptions skip something now", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DETECTION_RULES_PATH);
    await expect(page.getByText(BRUTE_FORCE, { exact: true })).toBeVisible({
      timeout: 30000,
    });

    // The scanners' range and the backup job; the red team's window is not under way yet.
    await expect(
      rowWith(page, BRUTE_FORCE).getByTestId("detection-rule-exception-count"),
    ).toHaveText("2 active exceptions");
    // Its one exception expired: nothing skipped now, no line.
    await expect(
      rowWith(page, PASSWORD_SPRAYING).getByTestId(
        "detection-rule-exception-count",
      ),
    ).toHaveCount(0);
  });

  test("the row's menu has a run of tuning actions, before Create Monitor", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DETECTION_RULES_PATH);
    await expect(page.getByText(BRUTE_FORCE, { exact: true })).toBeVisible({
      timeout: 30000,
    });

    const menu: Locator = await openRowMenu(page, BRUTE_FORCE);
    const titles: Array<string> = (
      await menu.getByRole("menuitem").allInnerTexts()
    ).map((title: string): string => {
      return title.replace(/\s+/g, " ").trim();
    });
    const first: number = titles.indexOf("Run on Past Events");

    expect(first).toBeGreaterThanOrEqual(0);
    expect(titles.slice(first, first + 4)).toEqual([
      "Run on Past Events",
      "Add Exception",
      "View Exceptions",
      "Create Monitor",
    ]);
  });

  test("a rule's count of exceptions opens them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DETECTION_RULES_PATH);
    await expect(page.getByText(BRUTE_FORCE, { exact: true })).toBeVisible({
      timeout: 30000,
    });

    await rowWith(page, BRUTE_FORCE)
      .getByRole("link", { name: "2 active exceptions" })
      .click();

    await expect
      .poll(() => {
        return new URL(page.url()).pathname;
      })
      .toBe(RULE_EXCEPTIONS_PATH);
    // The rule's three: the scanners, the backup job and the red team's window.
    await expect(exceptionRows(page)).toHaveCount(3, { timeout: 30000 });
  });

  test("View Exceptions lands on Rule Exceptions filtered to the rule", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DETECTION_RULES_PATH);
    await expect(page.getByText(BRUTE_FORCE, { exact: true })).toBeVisible({
      timeout: 30000,
    });

    const menu: Locator = await openRowMenu(page, BRUTE_FORCE);
    await menu.getByRole("menuitem", { name: "View Exceptions" }).click();

    await expect
      .poll(() => {
        return new URL(page.url()).pathname;
      })
      .toBe(RULE_EXCEPTIONS_PATH);
    expect(new URL(page.url()).search).toContain(
      "rule-exceptions-table-filter",
    );
    // The rule's three: the scanners, the backup job and the red team's window.
    await expect(exceptionRows(page)).toHaveCount(3, { timeout: 30000 });
    await expect(page.getByText("backup.exe", { exact: true })).toHaveCount(0);

    const read: { query: Record<string, unknown> } | undefined = (
      await fixture(page)
    ).listRequests
      .filter((request: { modelName: string }): boolean => {
        return request.modelName === "DetectionRuleException";
      })
      .pop();
    expect(read?.query["detectionRuleId"]).toBe(BRUTE_FORCE_ID);
  });

  test("a rule with no exception yet: its list's Add starts with the rule", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DETECTION_RULES_PATH);
    await expect(
      page.getByText("Account locked out", { exact: true }),
    ).toBeVisible({ timeout: 30000 });

    const menu: Locator = await openRowMenu(page, "Account locked out");
    await menu.getByRole("menuitem", { name: "View Exceptions" }).click();
    await expect(
      page.getByText("No rule exceptions match your search or filters"),
    ).toBeVisible({ timeout: 30000 });

    // Its first exception is added where its list sends you to look.
    await page
      .getByRole("button", { name: "Add Rule Exception", exact: true })
      .first()
      .click();
    await expect(dialog(page)).toContainText("Add New Rule Exception");
    // The rule's name is in the dialog only as its Detection Rule's pick.
    await expect(dialog(page)).toContainText("Account locked out");
  });

  test("Add Exception starts with the rule: a user, with why and an expiry, saved as the kind keeps it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DETECTION_RULES_PATH);
    await expect(page.getByText(BRUTE_FORCE, { exact: true })).toBeVisible({
      timeout: 30000,
    });

    const menu: Locator = await openRowMenu(page, BRUTE_FORCE);
    await menu.getByRole("menuitem", { name: "Add Exception" }).click();

    await expect(dialog(page)).toContainText("Add Exception");
    await expect(dialog(page)).toContainText(BRUTE_FORCE);
    await expect(dialog(page).getByText("An entity")).toBeVisible();

    await dialog(page).getByTestId("rule-exception-value").fill("svc-scanner");
    await dialog(page)
      .getByRole("button", { name: "Next", exact: true })
      .click();
    await dialog(page)
      .getByTestId("rule-exception-reason")
      .fill("The nightly scanner's service account.");
    await dialog(page)
      .getByRole("button", { name: "Add Exception", exact: true })
      .click();
    await expect(dialog(page)).toHaveCount(0);

    const [created] = await exceptionCreates(page);
    expect(created).toMatchObject({
      kind: "Entity",
      entityType: "User",
      value: "svc-scanner",
      reason: "The nightly scanner's service account.",
    });
    expect(JSON.stringify(created!["detectionRule"])).toContain(BRUTE_FORCE_ID);
    // A window's times and a field are not the kind's: not sent as set.
    expect(created!["fieldName"] ?? null).toBeNull();

    // The count under the rule's name reads it at once.
    await expect(
      rowWith(page, BRUTE_FORCE).getByTestId("detection-rule-exception-count"),
    ).toHaveText("3 active exceptions");
  });

  test("a value of only * is refused under its field, in the form's words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DETECTION_RULES_PATH);
    await expect(page.getByText(BRUTE_FORCE, { exact: true })).toBeVisible({
      timeout: 30000,
    });

    const menu: Locator = await openRowMenu(page, BRUTE_FORCE);
    await menu.getByRole("menuitem", { name: "Add Exception" }).click();

    await dialog(page).getByTestId("rule-exception-value").fill("*");
    await dialog(page)
      .getByRole("button", { name: "Next", exact: true })
      .click();

    await expect(dialog(page)).toContainText(
      "A value of only * would skip everything. To stop the rule, turn it off.",
    );
    // Still on what to skip: nothing was sent.
    await expect(
      dialog(page).getByTestId("rule-exception-value"),
    ).toBeVisible();
    expect(await exceptionCreates(page)).toEqual([]);
  });

  test("a time window asks for its times and no value, and ends by itself", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DETECTION_RULES_PATH);
    await expect(page.getByText(BRUTE_FORCE, { exact: true })).toBeVisible({
      timeout: 30000,
    });

    const menu: Locator = await openRowMenu(page, BRUTE_FORCE);
    await menu.getByRole("menuitem", { name: "Add Exception" }).click();
    await dialog(page).getByText("A time window", { exact: true }).click();

    await expect(dialog(page).getByTestId("rule-exception-value")).toHaveCount(
      0,
    );
    await expect(dialog(page).getByText("Starts At")).toBeVisible();
    await expect(dialog(page).getByText("Ends At")).toBeVisible();

    await dialog(page)
      .getByRole("button", { name: "Next", exact: true })
      .click();
    await expect(dialog(page).getByText("Reason")).toBeVisible();
    // A window has no expiry: it ends by itself.
    await expect(dialog(page).getByText("Expires At")).toHaveCount(0);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Run on Past Events
 * ---------------------------------------------------------------------------
 */
test.describe("Run on Past Events", () => {
  async function runFromRow(page: Page, rule: string): Promise<void> {
    await expect(page.getByText(rule, { exact: true })).toBeVisible({
      timeout: 30000,
    });
    const menu: Locator = await openRowMenu(page, rule);
    await menu.getByRole("menuitem", { name: "Run on Past Events" }).click();
    await expect(dialog(page)).toBeVisible();
  }

  test("from a rule's row: how often it would have fired, for whom, and what its exceptions kept out", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DETECTION_RULES_PATH);
    await runFromRow(page, BRUTE_FORCE);

    await expect(dialog(page)).toContainText(BRUTE_FORCE);
    await expect(
      dialog(page).getByTestId("detection-rule-retrohunt-summary"),
    ).toHaveText("Would have fired 42 times");
    await expect(
      dialog(page).getByTestId("detection-rule-retrohunt-facts"),
    ).toHaveText("6 a day · for 3 addresses · 1,204 matching events");
    await expect(
      dialog(page).getByTestId("detection-rule-retrohunt-exceptions"),
    ).toHaveText(
      "Its exceptions skipped 310 matching events. Without them, it would have fired 12 more times.",
    );
    await expect(
      dialog(page).getByTestId("detection-rule-retrohunt-group"),
    ).toHaveCount(3);
    await expect(
      dialog(page).getByTestId("detection-rule-retrohunt-group").first(),
    ).toContainText(SPRAY_IP);

    expect(await retrohuntRequests(page)).toEqual([
      { periodInHours: 168, detectionRuleId: BRUTE_FORCE_ID },
    ]);

    /*
     * As wide as its answer needs (Medium, 48rem): a dialog as wide as the
     * page put a value and its count a screen's width apart.
     */
    const dialogBox: { width: number } | null =
      await dialog(page).boundingBox();
    expect(dialogBox?.width || 0).toBeLessThanOrEqual(768 + 1);

    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "rule-retrohunt-desktop", { fullPage: false });

    // Another period runs again over it.
    await dialog(page)
      .getByTestId("detection-rule-retrohunt-period-24")
      .click();
    await expect(
      dialog(page).getByTestId("detection-rule-retrohunt-summary"),
    ).toHaveText("Would have fired 6 times");
    expect((await retrohuntRequests(page)).pop()).toEqual({
      periodInHours: 24,
      detectionRuleId: BRUTE_FORCE_ID,
    });

    await dialog(page).getByTestId("modal-footer-close-button").click();
    await expect(dialog(page)).toHaveCount(0);
  });

  test("a rule that would fire more than a person can look at says how to make it quieter", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DETECTION_RULES_PATH, { retrohunt: "noisy" });
    await runFromRow(page, BRUTE_FORCE);

    await expect(
      dialog(page).getByTestId("detection-rule-retrohunt-noisy"),
    ).toContainText("That is more than 20 a day");
    await expect(
      dialog(page).getByTestId("detection-rule-retrohunt-group"),
    ).toHaveCount(10);
    await dialog(page).getByTestId("detection-rule-retrohunt-show-all").click();
    await expect(
      dialog(page).getByTestId("detection-rule-retrohunt-group"),
    ).toHaveCount(50);
    await expect(dialog(page)).toContainText(
      "Only the 50 that fired most are listed.",
    );
  });

  test("a rule that would not have fired says how close it came", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DETECTION_RULES_PATH, { retrohunt: "quiet" });
    await runFromRow(page, PASSWORD_SPRAYING);

    await expect(
      dialog(page).getByTestId("detection-rule-retrohunt-summary"),
    ).toHaveText("Would not have fired");
    await expect(
      dialog(page).getByTestId("detection-rule-retrohunt-facts"),
    ).toHaveText(
      "12 matching events, but no group reached the Match Count Threshold of 5 within one run.",
    );
    await expect(
      dialog(page).getByTestId("detection-rule-retrohunt-groups"),
    ).toHaveCount(0);
  });

  test("a run that cannot be made says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DETECTION_RULES_PATH, { retrohunt: "fail" });
    await runFromRow(page, BRUTE_FORCE);

    await expect(
      dialog(page).getByTestId("detection-rule-retrohunt-error"),
    ).toContainText(
      'Unsupported Sigma modifier "nosuch" on field "statusName".',
    );
  });

  test("a correlation says what happened for each group it would have matched", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DETECTION_RULES_PATH);
    await runFromRow(page, SEQUENCE_RULE);

    await expect(
      dialog(page).getByTestId("detection-rule-retrohunt-summary"),
    ).toHaveText("Would have fired 1 time");
    await expect(
      dialog(page).getByTestId("detection-rule-retrohunt-group"),
    ).toContainText("Ten failed sign-ins, then Successful sign-in");
  });

  test("under the YAML, it runs the rule as it stands, before it is saved", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DETECTION_RULES_PATH);
    await expect(page.getByText(BRUTE_FORCE, { exact: true })).toBeVisible({
      timeout: 30000,
    });

    await rowWith(page, BRUTE_FORCE)
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await expect(dialog(page)).toBeVisible();

    // Beside Draft with AI, on one line under the YAML.
    const draftBox: { y: number; height: number } | null = await dialog(page)
      .getByTestId("detection-rule-ai-draft-open")
      .boundingBox();
    const runBox: { y: number; height: number } | null = await dialog(page)
      .getByTestId("detection-rule-retrohunt-open")
      .boundingBox();
    expect(draftBox).not.toBeNull();
    expect(runBox).not.toBeNull();
    expect(
      Math.abs(
        draftBox!.y + draftBox!.height / 2 - (runBox!.y + runBox!.height / 2),
      ),
    ).toBeLessThanOrEqual(1);

    await dialog(page).getByTestId("detection-rule-retrohunt-open").click();
    await expect(
      dialog(page).getByTestId("detection-rule-retrohunt-summary"),
    ).toHaveText("Would have fired 42 times");

    const [request] = await retrohuntRequests(page);
    // The saved rule's id, so its exceptions apply, and the form's YAML.
    expect(request!["detectionRuleId"]).toBe(BRUTE_FORCE_ID);
    expect(String(request!["sigmaRuleYaml"])).toContain(
      "title: Brute force from one IP address",
    );
    expect(request!["periodInHours"]).toBe(168);

    // Changing the rule after the run says the answer is about the rule as it was.
    await dialog(page)
      .getByRole("textbox", { name: /^Sigma Rule \(YAML\)/ })
      .fill(
        "title: Changed\ndetection:\n  selection:\n    statusName: Failure\n  condition: selection\n",
      );
    await expect(
      dialog(page).getByTestId("detection-rule-retrohunt-changed"),
    ).toHaveText("The rule changed after this run.");

    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  });

  test("a new rule's empty form has nothing to run: only Draft with AI", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DETECTION_RULES_PATH);
    await expect(page.getByText(BRUTE_FORCE, { exact: true })).toBeVisible({
      timeout: 30000,
    });

    await page
      .getByRole("button", { name: "Create Detection Rule", exact: true })
      .click();
    await expect(
      dialog(page).getByTestId("detection-rule-ai-draft-open"),
    ).toBeVisible();
    await expect(
      dialog(page).getByTestId("detection-rule-retrohunt-open"),
    ).toHaveCount(0);

    // A rule written in: there is something to run.
    await dialog(page)
      .getByRole("textbox", { name: /^Sigma Rule \(YAML\)/ })
      .fill(
        "title: Failures\ndetection:\n  selection:\n    statusName: Failure\n  condition: selection\n",
      );
    await expect(
      dialog(page).getByTestId("detection-rule-retrohunt-open"),
    ).toBeVisible();
    expect(await retrohuntRequests(page)).toEqual([]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * A case's detection
 * ---------------------------------------------------------------------------
 */
test.describe("Add Exception on a case's detection", () => {
  test("starts with the detection's rule and the entity it is about", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE_DETECTIONS_PATH);
    await expect(
      page.getByText("Okta password spray", { exact: true }).first(),
    ).toBeVisible({ timeout: 30000 });

    const menu: Locator = await openRowMenu(page, "Okta password spray");
    await menu.getByRole("menuitem", { name: "Add Exception" }).click();

    await expect(dialog(page)).toContainText("Add Exception");
    await expect(dialog(page)).toContainText(
      "Stop this rule from firing on something you expect, such as a scanner, a backup job or a planned test.",
    );
    await expect(dialog(page)).toContainText(BRUTE_FORCE);
    // The address the rule grouped the detection by.
    await expect(dialog(page).getByTestId("rule-exception-value")).toHaveValue(
      SPRAY_IP,
    );
    await expect(dialog(page)).toContainText("IP Address");
    await screenshot(page, "rule-exception-from-detection", {
      fullPage: false,
    });
  });

  test("a detection no rule made has nothing to tune", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE_DETECTIONS_PATH);
    const threatIntel: string = `Known-bad address ${SPRAY_IP} (Tor exit node)`;
    await expect(page.getByText(threatIntel, { exact: true })).toBeVisible({
      timeout: 30000,
    });

    // Add Exception is a rule's: a threat intel match's row has no ⋯ at all.
    const threatIntelRow: Locator = page
      .locator("tbody tr")
      .filter({ hasText: threatIntel });
    await expect(threatIntelRow).toHaveCount(1);
    await expect(
      threatIntelRow.getByTestId("row-actions-more-button"),
    ).toHaveCount(0);
    // A rule's detection on the same case has one.
    await expect(
      page
        .locator("tbody tr")
        .filter({ hasText: "Okta sign-in success after a spray" })
        .getByTestId("row-actions-more-button"),
    ).toHaveCount(1);
  });
});
