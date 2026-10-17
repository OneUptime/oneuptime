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
 * CREATE MONITOR, IN A REAL BROWSER.
 *
 * The maintainer: "When I create a new monitor, this UI is extremely
 * confusing to use. Can you please improve it and make it more user friendly
 * and simpler to use." The form asked for a name before what to monitor,
 * then showed a full-width grid of eight large type cards under "32 to choose
 * from" and eight category headings with counts; its criteria step opened
 * every default criteria across about six thousand pixels, with a red
 * "Monitor Destination is required." before anything was typed.
 *
 * The production Create page (Pages/Monitor/Create), the production Tailwind
 * build and Theme.css, against the offline fixture (Fixture/Fixture.js).
 * jsdom applies no CSS and lays nothing out, so what only a browser can show
 * is checked here: what fits on screen, what sits beside what, what the
 * keyboard reaches, what a folded criteria hides, and dark mode.
 *
 * The same guards as MonitorOverview.spec.ts: a network fence, no uncaught
 * page errors, and no request the fixture does not model.
 */

// The fixture server's port: MONITOR_OVERVIEW_FIXTURE_PORT, as the config and server.js read it.
const PORT: string = process.env["MONITOR_OVERVIEW_FIXTURE_PORT"] || "4223";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const CREATE_PATH: string = `/dashboard/${PROJECT_ID}/monitors/create`;
// Fixture.js answers the create with this id; its page is a stub.
const CREATED_MONITOR_ID: string = "70000000-0000-4000-8000-000000000100";
// The fixture's first probe, "Frankfurt (eu-central-1)".
const FRANKFURT_PROBE_ID: string = "73000000-0000-4000-8000-000000000001";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/monitor-overview-ui",
);

const COMMON_TYPES: Array<string> = [
  "Website",
  "API",
  "Ping",
  "Port",
  "SSL Certificate",
  "Incoming Request",
];

const WHITE_RGB: string = "rgb(255, 255, 255)";

interface RecordedCreate {
  modelName: string;
  data: Record<string, unknown>;
  miscDataProps: Record<string, unknown> | null;
}

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

  // Nothing may leave the fixture server.
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

  const unhandled: Array<unknown> = await page
    .evaluate((): Array<unknown> => {
      const state: { unhandled?: Array<unknown> } | undefined = (
        window as unknown as {
          __monitorOverviewFixture?: { unhandled?: Array<unknown> };
        }
      ).__monitorOverviewFixture;
      return JSON.parse(
        JSON.stringify(state?.unhandled || []),
      ) as Array<unknown>;
    })
    .catch((): Array<unknown> => {
      return [];
    });
  expect(unhandled, "requests the fixture does not model").toEqual([]);
});

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function openCreate(page: Page, query: string = ""): Promise<Locator> {
  await page.clock.setFixedTime(NOW);
  await page.goto(`${CREATE_PATH}${query}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });

  const form: Locator = page.locator("#create-monitor-form");
  await expect(form).toBeVisible({ timeout: 60000 });

  // The picker: its common rows, or the summary of a type a link chose.
  await expect(
    page
      .locator(
        "[data-testid='card-select-common'], [data-testid='card-select-summary']",
      )
      .first(),
  ).toBeVisible({ timeout: 30000 });

  return form;
}

async function shownTypes(page: Page): Promise<Array<string>> {
  return page
    .getByRole("radio")
    .evaluateAll((elements: Array<Element>): Array<string> => {
      return elements.map((element: Element): string => {
        return element.getAttribute("data-card-select-value") || "";
      });
    });
}

/*
 * How many types the picker offers: its radios once More monitor types is
 * open. The search summary counts against all of them, so a new monitor type
 * changes this number without changing this file.
 */
async function offeredTypeCount(page: Page): Promise<number> {
  await openCreate(page);
  await page.getByTestId("card-select-more").click();
  await expect(page.getByTestId("card-select-more")).toHaveCount(0);
  return (await shownTypes(page)).length;
}

function option(page: Page, value: string): Locator {
  return page.getByTestId(`card-select-option-${value}`);
}

function summary(page: Page): Locator {
  return page.getByTestId("card-select-summary");
}

function nameInput(form: Locator): Locator {
  return form.locator("input[placeholder='Monitor Name']");
}

async function createsRecorded(page: Page): Promise<Array<RecordedCreate>> {
  return page.evaluate((): Array<RecordedCreate> => {
    const state: { creates?: Array<RecordedCreate> } | undefined = (
      window as unknown as {
        __monitorOverviewFixture?: { creates?: Array<RecordedCreate> };
      }
    ).__monitorOverviewFixture;
    return JSON.parse(
      JSON.stringify(state?.creates || []),
    ) as Array<RecordedCreate>;
  });
}

async function boxOf(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box: { x: number; y: number; width: number; height: number } | null =
    await locator.boundingBox();

  expect(box, "the element is laid out").not.toBeNull();

  return box!;
}

test.describe("Create Monitor's first step", () => {
  test("opens on what to monitor: six common types, two to a line, no headings or counts", async ({
    page,
  }: {
    page: Page;
  }) => {
    const form: Locator = await openCreate(page);

    expect(await shownTypes(page)).toEqual(COMMON_TYPES);

    // Two compact rows to a line on a desktop.
    const website: { x: number; y: number } = await boxOf(
      option(page, "Website"),
    );
    const api: { x: number; y: number } = await boxOf(option(page, "API"));
    const ping: { x: number; y: number } = await boxOf(option(page, "Ping"));

    expect(Math.abs(website.y - api.y)).toBeLessThan(2);
    expect(api.x).toBeGreaterThan(website.x);
    expect(ping.y).toBeGreaterThan(website.y);
    expect(Math.abs(ping.x - website.x)).toBeLessThan(2);

    await expect(page.getByTestId("card-select-more")).toHaveText(
      "More monitor types",
    );
    await expect(form).not.toContainText("to choose from");
    await expect(form).not.toContainText("Basic Monitoring");
    await expect(form).not.toContainText("Infrastructure");

    // What to monitor first, then the name.
    const name: { y: number } = await boxOf(nameInput(form));
    expect(name.y).toBeGreaterThan(ping.y);

    // The description folds under More fields with the labels.
    const moreFields: Locator = form.getByRole("button", {
      name: "More fields",
      exact: true,
    });
    await expect(moreFields).toHaveAttribute("aria-expanded", "false");
    await expect(
      form.getByPlaceholder("Description", { exact: true }),
    ).toBeHidden();

    await screenshot(page, "create-monitor-first-step");
  });

  test("the whole first step, Next included, is on screen without scrolling", async ({
    page,
  }: {
    page: Page;
  }) => {
    const form: Locator = await openCreate(page);

    await expect(
      form.getByRole("button", { name: "Next", exact: true }),
    ).toBeInViewport();
  });

  test("fits a phone: one row a line, nothing wider than the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCreate(page);

    const website: { x: number; y: number } = await boxOf(
      option(page, "Website"),
    );
    const api: { x: number; y: number } = await boxOf(option(page, "API"));

    expect(Math.abs(api.x - website.x)).toBeLessThan(2);
    expect(api.y).toBeGreaterThan(website.y);

    const overflow: number = await page.evaluate((): number => {
      return (
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
      );
    });
    expect(overflow).toBeLessThanOrEqual(0);

    await screenshot(page, "create-monitor-phone");
  });

  test("More monitor types shows every other type under a plain heading, focus on the first new one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page);

    await page.getByTestId("card-select-more").click();

    await expect(page.getByTestId("card-select-more")).toHaveCount(0);
    await expect(option(page, "IP")).toBeFocused();

    const moreOptions: Locator = page.getByTestId("card-select-more-options");
    for (const heading of ["Infrastructure", "Telemetry", "Other"]) {
      await expect(
        moreOptions.getByText(heading, { exact: true }),
      ).toBeVisible();
    }

    // Every type the picker offers, each once.
    const shown: Array<string> = await shownTypes(page);
    expect(new Set(shown).size).toBe(shown.length);
    expect(shown).toContain("Kubernetes");
    expect(shown).toContain("Manual");
    expect(shown.slice(0, COMMON_TYPES.length)).toEqual(COMMON_TYPES);

    await screenshot(page, "create-monitor-more-types");
  });

  test("by keyboard: search, Enter, then Change and Escape keep the choice", async ({
    page,
  }: {
    page: Page;
  }) => {
    const total: number = await offeredTypeCount(page);
    await openCreate(page);

    await page.getByTestId("card-select-search").click();
    await page.keyboard.type("k8s");
    await expect(page.getByTestId("card-select-search-summary")).toHaveText(
      `Showing 1 of ${total}`,
    );
    await page.keyboard.press("Enter");

    await expect(summary(page)).toHaveAttribute(
      "data-card-select-value",
      "Kubernetes",
    );
    await expect(page.getByTestId("card-select-change")).toBeFocused();

    // Change from the keyboard: the search box takes focus.
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("card-select-search")).toBeFocused();
    await expect(option(page, "Kubernetes")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // Escape: the choice made stays.
    await page.keyboard.press("Escape");
    await expect(summary(page)).toHaveAttribute(
      "data-card-select-value",
      "Kubernetes",
    );
    await expect(page.getByTestId("card-select-change")).toBeFocused();
  });

  test("the rows are one tab stop, arrows walk them, Space picks, and Tab goes on to the name", async ({
    page,
  }: {
    page: Page;
  }) => {
    const form: Locator = await openCreate(page);

    await page.getByTestId("card-select-search").focus();
    await page.keyboard.press("Tab");
    await expect(option(page, "Website")).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(option(page, "API")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(option(page, "Ping")).toBeFocused();

    await page.keyboard.press(" ");
    await expect(summary(page)).toHaveAttribute(
      "data-card-select-value",
      "Ping",
    );
    await expect(page.getByTestId("card-select-change")).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(nameInput(form)).toBeFocused();
  });

  test("a picked type shrinks to one line, and the name moves up to meet it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const form: Locator = await openCreate(page);

    const before: number = (await boxOf(nameInput(form))).y;

    await option(page, "Website").click();

    await expect(summary(page)).toBeVisible();
    await expect(summary(page)).toContainText("Website");
    await expect(page.getByTestId("card-select-change")).toHaveText("Change");

    const after: number = (await boxOf(nameInput(form))).y;
    expect(before - after).toBeGreaterThan(100);

    await screenshot(page, "create-monitor-picked");
  });

  test("a link that names a type opens on it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page, "?monitorType=Ping");

    await expect(summary(page)).toHaveAttribute(
      "data-card-select-value",
      "Ping",
    );
    expect(await shownTypes(page)).toEqual([]);
  });

  test("dark mode: the rows and the summary sit on dark surfaces", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page, "?theme=dark");

    const rowBackground: string = await option(page, "Website").evaluate(
      (element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      },
    );
    expect(rowBackground).not.toBe(WHITE_RGB);

    await option(page, "API").click();

    const summaryColors: { background: string; title: string } = await summary(
      page,
    ).evaluate((element: Element): { background: string; title: string } => {
      const title: Element | null = element.querySelector(
        "[data-testid='card-select-summary-title']",
      );
      return {
        background: getComputedStyle(element).backgroundColor,
        title: title ? getComputedStyle(title).color : "",
      };
    });
    expect(summaryColors.background).not.toBe(WHITE_RGB);
    expect(summaryColors.title).not.toBe("rgb(17, 24, 39)");

    await screenshot(page, "create-monitor-dark");
  });
});

test.describe("Create Monitor, start to finish", () => {
  test("a website monitor: folded default criteria, no early error, then Create Monitor", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);

    const form: Locator = await openCreate(page);

    await option(page, "Website").click();
    await nameInput(form).fill("Storefront checkout");
    await form.getByRole("button", { name: "Next", exact: true }).click();

    // The criteria step: what to check first, the criteria folded below.
    await expect(
      form.getByText("Monitor Criteria", { exact: true }).first(),
    ).toBeVisible({ timeout: 60000 });
    const headers: Locator = page.getByTestId("monitor-criteria-header");
    await expect(headers).toHaveCount(2, { timeout: 30000 });

    for (const toggle of await headers.locator("button[aria-expanded]").all()) {
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
    }

    // Folded criteria are out of sight - and out of the keyboard's reach.
    const bodies: Locator = page.getByTestId("monitor-criteria-body");
    for (const body of await bodies.all()) {
      await expect(body).toBeHidden();
    }
    const focusable: boolean = await page
      .getByTestId("monitor-criteria-body")
      .first()
      .evaluate((body: Element): boolean => {
        const field: HTMLElement | null = body.querySelector("input");
        field?.focus();
        return Boolean(field) && document.activeElement === field;
      });
    expect(focusable).toBe(false);

    // ...and they do not stretch the page with blank space below the form.
    const blankBelow: number = await page.evaluate((): number => {
      const formElement: HTMLElement | null = document.getElementById(
        "create-monitor-form",
      );
      const bottom: number = formElement
        ? formElement.getBoundingClientRect().bottom + window.scrollY
        : 0;
      return document.documentElement.scrollHeight - bottom;
    });
    expect(blankBelow).toBeLessThan(300);

    // No error before anything is typed.
    await expect(
      form.getByText("Monitor Destination is required."),
    ).toHaveCount(0);

    // The address field says what to type, with an example in the box.
    const url: Locator = form.getByPlaceholder("https://example.com", {
      exact: true,
    });
    await expect(url).toBeVisible();
    await expect(
      form.getByText("The page to check, like https://example.com."),
    ).toBeVisible();

    await screenshot(page, "create-monitor-criteria");

    // Next with no address: now the step says what is missing, by Next.
    await form.getByRole("button", { name: "Next", exact: true }).click();
    const missing: Locator = form.getByText("Monitor Destination is required.");
    await expect(missing).toBeVisible();
    await expect(missing).toBeInViewport();

    await url.fill("https://storefront.acme-commerce.example");
    await form.getByRole("button", { name: "Next", exact: true }).click();

    // Probes & Interval: the default interval, and one probe picked.
    await expect(
      form.getByText("Every 5 Minutes", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      form.getByText(
        "How often to check. Every 5 minutes suits most monitors.",
      ),
    ).toBeVisible();
    await page.getByRole("combobox", { name: /^Probes/ }).click();
    await page
      .getByRole("option", { name: "Frankfurt (eu-central-1)", exact: true })
      .click();
    await page.keyboard.press("Escape");

    await page.getByTestId("Create Monitor").click();

    await expect(page).toHaveURL(
      `/dashboard/${PROJECT_ID}/monitors/${CREATED_MONITOR_ID}`,
      { timeout: 30000 },
    );
    await expect(page.getByTestId("stub-page")).toHaveAttribute(
      "data-page",
      "created-monitor",
    );

    const creates: Array<RecordedCreate> = await createsRecorded(page);
    expect(creates).toHaveLength(1);
    expect(creates[0]!.modelName).toBe("Monitor");
    expect(creates[0]!.data["monitorType"]).toBe("Website");
    expect(creates[0]!.data["name"]).toBe("Storefront checkout");
    expect(creates[0]!.data["monitoringInterval"]).toBe("*/5 * * * *");
    expect(JSON.stringify(creates[0]!.data["monitorSteps"])).toContain(
      "storefront.acme-commerce.example",
    );
    expect(creates[0]!.miscDataProps?.["probes"]).toEqual([FRANKFURT_PROBE_ID]);
  });

  test("a manual monitor: one step, Create Monitor right there, no interval", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(120000);

    const form: Locator = await openCreate(page);

    await page.getByTestId("card-select-more").click();
    await option(page, "Manual").click();
    await nameInput(form).fill("Payment provider status");

    await expect(
      form.getByRole("button", { name: "Next", exact: true }),
    ).toHaveCount(0);

    await page.getByTestId("Create Monitor").click();

    await expect(page).toHaveURL(
      `/dashboard/${PROJECT_ID}/monitors/${CREATED_MONITOR_ID}`,
      { timeout: 30000 },
    );

    const creates: Array<RecordedCreate> = await createsRecorded(page);
    expect(creates).toHaveLength(1);
    expect(creates[0]!.data["monitorType"]).toBe("Manual");
    expect(creates[0]!.data["name"]).toBe("Payment provider status");
    expect(creates[0]!.data["monitoringInterval"]).toBeUndefined();
  });
});

/*
 * PLAINER FIELDS ON THE CRITERIA STEP.
 *
 * The maintainer, on a switch whose help explained two modes: "Shouldnt this
 * be two buttons ... to make it easier for people to understand whats going
 * on", with the simpler mode the default, and shorter descriptions
 * everywhere. On Create Monitor:
 *
 *   - SQL Server's sign-in is an Authentication choice of two, Username and
 *     password first, each saying in one line what it means; Windows
 *     Integrated Authentication takes the username and password away (it was
 *     a switch, "Use Windows Integrated Authentication", whose help said the
 *     fields it left on screen were ignored);
 *   - a Synthetic monitor starts on Chromium at Desktop, and asks for at
 *     least one browser before it goes on (an empty list ran nothing, and
 *     never failed);
 *   - Retries on Failure says what it is in one line; its full rule, which
 *     ran to five lines under the field, waits in the (i) by its title.
 */
test.describe("Create Monitor's plainer fields", () => {
  async function goToProbesAndCreate(page: Page, form: Locator): Promise<void> {
    await form.getByRole("button", { name: "Next", exact: true }).click();

    const probes: Locator = page.getByRole("combobox", { name: /^Probes/ });
    await expect(probes).toBeVisible({ timeout: 30000 });
    await probes.click();
    await page
      .getByRole("option", { name: "Frankfurt (eu-central-1)", exact: true })
      .click();
    await page.keyboard.press("Escape");

    await page.getByTestId("Create Monitor").click();

    await expect(page).toHaveURL(
      `/dashboard/${PROJECT_ID}/monitors/${CREATED_MONITOR_ID}`,
      { timeout: 30000 },
    );
  }

  /*
   * The step list beside the form is as wide as its titles. Only a step not
   * reached yet kept its title on one line, so on the last step "Probes &
   * Interval" and "Monitor Info" wrapped and the form beside them moved, and
   * a two-step form wrapped "Monitor Info" from the start.
   */
  async function stepList(page: Page): Promise<{
    width: number;
    titleHeights: Array<number>;
  }> {
    const list: Locator = page.getByRole("navigation", { name: "Progress" });
    await expect(list).toBeVisible({ timeout: 30000 });

    const titleHeights: Array<number> = [];
    for (const step of await list.getByRole("listitem").all()) {
      titleHeights.push((await boxOf(step)).height);
    }

    return { width: (await boxOf(list)).width, titleHeights: titleHeights };
  }

  test("the step list keeps every title on one line, and its width, on every step", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);

    const form: Locator = await openCreate(page, "?monitorType=Website");
    await nameInput(form).fill("Storefront");
    await form.getByRole("button", { name: "Next", exact: true }).click();
    await expect(
      form.getByPlaceholder("https://example.com", { exact: true }),
    ).toBeVisible({ timeout: 60000 });

    const onCriteria: { width: number; titleHeights: Array<number> } =
      await stepList(page);
    expect(onCriteria.titleHeights).toHaveLength(3);

    await form
      .getByPlaceholder("https://example.com", { exact: true })
      .fill("https://storefront.acme-commerce.example");
    await form.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("combobox", { name: /^Probes/ })).toBeVisible({
      timeout: 30000,
    });

    const onLastStep: { width: number; titleHeights: Array<number> } =
      await stepList(page);

    // One line each (a two-line title is about 40px tall).
    for (const height of [
      ...onCriteria.titleHeights,
      ...onLastStep.titleHeights,
    ]) {
      expect(height).toBeLessThan(28);
    }
    // The list, and so the form beside it, did not move.
    expect(Math.abs(onLastStep.width - onCriteria.width)).toBeLessThan(1);
  });

  test("a two-step form keeps Monitor Info on one line", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(120000);

    const form: Locator = await openCreate(
      page,
      "?monitorType=Incoming%20Request",
    );
    await nameInput(form).fill("Nightly billing export");
    await form.getByRole("button", { name: "Next", exact: true }).click();

    const list: { width: number; titleHeights: Array<number> } =
      await stepList(page);
    expect(list.titleHeights).toHaveLength(2);
    for (const height of list.titleHeights) {
      expect(height).toBeLessThan(28);
    }
  });

  test("SQL Server asks how to sign in: two plain choices, and Windows Integrated Authentication drops the username and password", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);

    const form: Locator = await openCreate(page, "?monitorType=SQL%20Query");

    await nameInput(form).fill("Orders database");
    await form.getByRole("button", { name: "Next", exact: true }).click();

    const authentication: Locator = page.getByRole("radiogroup", {
      name: /^Authentication/,
    });

    // PostgreSQL first: nothing to choose, a username and a password.
    await expect(form.getByText("Database Type", { exact: true })).toBeVisible({
      timeout: 60000,
    });
    await expect(authentication).toHaveCount(0);

    /*
     * Host and Port share a line, their boxes level: neither has a line of
     * help (one under Host alone pushed its box below Port's), and the port
     * takes a quarter of the line.
     */
    const hostBox: { x: number; y: number; width: number; height: number } =
      await boxOf(form.getByPlaceholder("db.internal", { exact: true }));
    const portBox: { x: number; y: number; width: number; height: number } =
      await boxOf(form.getByPlaceholder("5432", { exact: true }));
    expect(Math.abs(hostBox.y - portBox.y)).toBeLessThan(1);
    expect(portBox.x).toBeGreaterThan(hostBox.x + hostBox.width);
    expect(portBox.width).toBeLessThan(hostBox.width / 2);

    const databaseType: Locator = form
      .locator("div")
      .filter({ has: page.getByText("Database Type", { exact: true }) })
      .filter({ has: page.getByRole("combobox") })
      .last();
    await databaseType.getByRole("combobox").click();
    await page
      .getByRole("option", { name: "Microsoft SQL Server", exact: true })
      .click();

    await expect(authentication).toBeVisible();

    const usernameAndPassword: Locator = authentication.getByRole("radio", {
      name: "Username and password",
      exact: true,
    });
    const windows: Locator = authentication.getByRole("radio", {
      name: "Windows Integrated Authentication",
      exact: true,
    });
    await expect(usernameAndPassword).toBeChecked();
    await expect(windows).not.toBeChecked();
    await expect(usernameAndPassword).toHaveAccessibleDescription(
      "Sign in with a SQL Server login.",
    );
    await expect(windows).toHaveAccessibleDescription(
      "Sign in as the account the probe runs as. No password needed.",
    );

    // Each option's line sits under its label, and its radio on the label's line.
    const label: { x: number; y: number; width: number; height: number } =
      await boxOf(
        authentication.getByText("Windows Integrated Authentication", {
          exact: true,
        }),
      );
    const line: { x: number; y: number } = await boxOf(
      authentication.getByText(
        "Sign in as the account the probe runs as. No password needed.",
        { exact: true },
      ),
    );
    const radio: { x: number; y: number; width: number; height: number } =
      await boxOf(windows);
    expect(line.y).toBeGreaterThan(label.y);
    expect(Math.abs(line.x - label.x)).toBeLessThan(2);
    expect(
      Math.abs(radio.y + radio.height / 2 - (label.y + label.height / 2)),
    ).toBeLessThan(4);
    expect(radio.x + radio.width).toBeLessThan(label.x);

    const username: Locator = form.getByPlaceholder("readonly_user", {
      exact: true,
    });
    const password: Locator = form.getByPlaceholder(
      "{{monitorSecrets.dbPassword}}",
      { exact: true },
    );
    await expect(username).toBeVisible();
    await expect(password).toBeVisible();

    await windows.check();

    await expect(windows).toBeChecked();
    await expect(usernameAndPassword).not.toBeChecked();
    await expect(username).toHaveCount(0);
    await expect(password).toHaveCount(0);

    await screenshot(page, "create-monitor-sql-server-authentication");

    await form
      .getByPlaceholder("db.internal", { exact: true })
      .fill("sql.acme-commerce.internal");
    await form.getByPlaceholder("orders", { exact: true }).fill("orders");
    await form
      .getByPlaceholder(
        "SELECT COUNT(*) FROM orders WHERE status = 'CANCELLED'",
        { exact: true },
      )
      .fill("SELECT COUNT(*) FROM orders");

    await goToProbesAndCreate(page, form);

    const creates: Array<RecordedCreate> = await createsRecorded(page);
    expect(creates).toHaveLength(1);
    expect(creates[0]!.data["monitorType"]).toBe("SQL Query");
    const steps: string = JSON.stringify(creates[0]!.data["monitorSteps"]);
    expect(steps).toContain('"databaseType":"Microsoft SQL Server"');
    expect(steps).toContain('"useWindowsIntegratedAuthentication":true');
  });

  test("a synthetic monitor starts on Chromium at Desktop, and asks for a browser before it goes on", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);

    const form: Locator = await openCreate(
      page,
      "?monitorType=Synthetic%20Monitor",
    );

    await nameInput(form).fill("Checkout journey");
    await form.getByRole("button", { name: "Next", exact: true }).click();

    const chromium: Locator = form.getByRole("checkbox", {
      name: "Chromium",
      exact: true,
    });
    await expect(chromium).toBeVisible({ timeout: 60000 });
    await expect(chromium).toBeChecked();
    await expect(
      form.getByRole("checkbox", { name: "Firefox", exact: true }),
    ).not.toBeChecked();
    await expect(
      form.getByRole("checkbox", { name: "Desktop", exact: true }),
    ).toBeChecked();
    for (const size of ["Mobile", "Tablet"]) {
      await expect(
        form.getByRole("checkbox", { name: size, exact: true }),
      ).not.toBeChecked();
    }
    await expect(
      form.getByText("The browsers to run the script in.", { exact: true }),
    ).toBeVisible();

    await screenshot(page, "create-monitor-synthetic-defaults");

    await form
      .getByTestId("code-editor-input")
      .fill(
        "await page.goto('https://storefront.acme-commerce.example');\nreturn { data: {} };",
      );

    // No browser: the step says so, by Next, and goes nowhere.
    await chromium.uncheck();
    await form.getByRole("button", { name: "Next", exact: true }).click();
    const noBrowser: Locator = form.getByText(
      "Pick at least one browser to run the script in.",
    );
    await expect(noBrowser).toBeVisible();
    await expect(noBrowser).toBeInViewport();
    await expect(page.getByRole("combobox", { name: /^Probes/ })).toHaveCount(
      0,
    );

    await chromium.check();
    await goToProbesAndCreate(page, form);

    const creates: Array<RecordedCreate> = await createsRecorded(page);
    expect(creates).toHaveLength(1);
    const steps: string = JSON.stringify(creates[0]!.data["monitorSteps"]);
    expect(steps).toContain('"browserTypes":["Chromium"]');
    expect(steps).toContain('"screenSizeTypes":["Desktop"]');
  });

  test("Retries on Failure says what it is in one line, and its rule waits in the (i), inside the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(120000);

    const form: Locator = await openCreate(page, "?monitorType=Website");

    await nameInput(form).fill("Storefront");
    await form.getByRole("button", { name: "Next", exact: true }).click();

    const moreFields: Locator = page.getByTestId("monitor-step-more-fields");
    await expect(moreFields).toBeVisible({ timeout: 60000 });
    await moreFields.getByTestId("folded-section-header").click();

    await expect(
      moreFields.getByText(
        "How many times to try again before the check fails. Up to 3.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      moreFields.getByText(
        "How long to wait for each attempt, up to 60 seconds.",
        { exact: true },
      ),
    ).toBeVisible();
    // The rule is not under the field any more.
    await expect(moreFields.getByText(/0 means one attempt/)).toHaveCount(0);

    const about: Locator = moreFields.getByRole("button", {
      name: "About Retries on Failure",
      exact: true,
    });
    await about.focus();

    const tooltip: Locator = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(
      "How many times to retry after a failed attempt: 0 means one attempt, 2 means up to 3.",
    );
    await expect(tooltip).toContainText(
      "Invalid or blocked targets, oversized responses, and too many redirects are not retried.",
    );

    // The long rule wraps inside the window instead of running off it.
    const box: { x: number; width: number } = await boxOf(tooltip);
    const viewport: { width: number; height: number } | null =
      page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport!.width);
    expect(box.width).toBeLessThan(600);

    await screenshot(page, "create-monitor-retries-tooltip");
  });
});

/*
 * THE PLAN'S LIMIT ON ACTIVE MONITORS, ON CREATE MONITOR.
 *
 * The support report: a project bought from a reseller with a plan of 500
 * active monitors had 2,881. The server now refuses every new active
 * monitor at the limit (Common/Server/Utils/Billing/ActiveMonitorLimit);
 * the page says so above the form before anything is filled in
 * (Components/Monitor/ActiveMonitorLimitNotice), from
 * GET /monitor/active-monitor-limit (?monitorLimit= in the fixture), on a
 * billed install (?billing=true): a self-hosted one has no plans and asks
 * nothing. The form stays: a Manual monitor never counts, and one can still
 * be made from it. On the Free plan (?plan=free) the notice comes first,
 * above the pricing card, which fills a phone's screen.
 */
test.describe("Create Monitor at the plan's monitor limit", () => {
  function notice(page: Page): Locator {
    return page.getByTestId("active-monitor-limit-notice");
  }

  async function limitRequests(page: Page): Promise<number> {
    return page.evaluate((): number => {
      const state:
        | { apiRequests?: Array<{ method: string; url: string }> }
        | undefined = (
        window as unknown as {
          __monitorOverviewFixture?: {
            apiRequests?: Array<{ method: string; url: string }>;
          };
        }
      ).__monitorOverviewFixture;

      return (state?.apiRequests || []).filter(
        (request: { method: string; url: string }): boolean => {
          return (
            request.method === "GET" &&
            new URL(request.url).pathname ===
              "/api/monitor/active-monitor-limit"
          );
        },
      ).length;
    });
  }

  test("a project with no limit sees nothing above the form, and asks once", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page, "?billing=true");

    await expect
      .poll(() => {
        return limitRequests(page);
      })
      .toBe(1);
    await expect(notice(page)).toHaveCount(0);
  });

  test("a self-hosted install has no plans: nothing is asked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page, "?monitorLimit=over");

    await expect(option(page, "Website")).toBeVisible();
    expect(await limitRequests(page)).toBe(0);
    await expect(notice(page)).toHaveCount(0);
  });

  test("under the limit, nothing", async ({ page }: { page: Page }) => {
    await openCreate(page, "?billing=true&monitorLimit=under");

    await expect
      .poll(() => {
        return limitRequests(page);
      })
      .toBe(1);
    await expect(notice(page)).toHaveCount(0);
  });

  test("at a plan's own limit: above the form, which limit, how many, what to do and what counts, with the plan a click away", async ({
    page,
  }: {
    page: Page;
  }) => {
    const form: Locator = await openCreate(
      page,
      "?billing=true&monitorLimit=at",
    );

    await expect(notice(page)).toBeVisible();
    await expect(notice(page)).toContainText(
      "You've reached your plan's monitor limit",
    );
    await expect(notice(page)).toContainText(
      "Your plan includes 500 active monitors, and this project has 500.",
    );
    await expect(notice(page)).toContainText(
      "To add more, delete monitors you no longer need or change your plan.",
    );
    await expect(notice(page)).toContainText(
      "Manual monitors don't count towards the limit, so you can still add them. Monitors that are turned off or archived do count.",
    );
    await expect(notice(page)).not.toContainText("keep running");

    const viewPlan: Locator = notice(page).getByRole("link", {
      name: "View plan",
    });
    await expect(viewPlan).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/settings/billing`,
    );

    // Above the form, which stays: a Manual monitor never counts.
    const noticeBox: { y: number; height: number } = await boxOf(notice(page));
    const formBox: { y: number } = await boxOf(form);
    expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(formBox.y);
    await expect(option(page, "Website")).toBeVisible();

    await screenshot(page, "create-monitor-limit-at");
  });

  // The support report's project: 2,881 active monitors on a plan of 500.
  test("past a plan's own limit: its monitors keep running, and when it can add again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page, "?billing=true&monitorLimit=over");

    await expect(notice(page)).toContainText(
      "You're over your plan's monitor limit",
    );
    await expect(notice(page)).toContainText(
      "Your plan includes 500 active monitors, and this project has 2,881.",
    );
    await expect(notice(page)).toContainText(
      "All of them keep running, but no more can be added until the project has fewer than 500.",
    );

    await screenshot(page, "create-monitor-limit-over");
  });

  test("at the Free plan's limit: first on the page, above the pricing card, and upgrade", async ({
    page,
  }: {
    page: Page;
  }) => {
    const form: Locator = await openCreate(
      page,
      "?billing=true&plan=free&monitorLimit=free-at",
    );

    await expect(notice(page)).toContainText(
      "You've reached the Free plan's monitor limit",
    );
    // Each active monitor on the Free plan is paid as you go: it allows them.
    await expect(notice(page)).toContainText(
      "The Free plan allows up to 10 active monitors, and this project has 10.",
    );
    await expect(notice(page)).toContainText("Upgrade your plan to add more.");
    await expect(
      notice(page).getByRole("link", { name: "View plans" }),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/settings/billing`);

    // The notice, then the Free plan's pricing card, then the form.
    const pricing: Locator = page.getByTestId("monitor-pay-as-you-go-card");
    await expect(pricing).toBeVisible();
    const noticeBox: { y: number; height: number } = await boxOf(notice(page));
    const pricingBox: { y: number; height: number } = await boxOf(pricing);
    const formBox: { y: number } = await boxOf(form);
    expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(pricingBox.y);
    expect(pricingBox.y + pricingBox.height).toBeLessThanOrEqual(formBox.y);

    await screenshot(page, "create-monitor-limit-free");
  });

  test("on a phone, on the Free plan, the notice is on the first screen, not under the prices", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCreate(page, "?billing=true&plan=free&monitorLimit=free-at");

    await expect(notice(page)).toBeVisible();
    await expect(page.getByTestId("monitor-pay-as-you-go-card")).toBeVisible();

    await page.evaluate((): void => {
      window.scrollTo(0, 0);
    });

    const box: { y: number; height: number } = await boxOf(notice(page));
    expect(box.y + box.height).toBeLessThanOrEqual(844);
  });

  test("at the limit, a Manual monitor - which never counts - is still made from the same form", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(120000);

    const form: Locator = await openCreate(
      page,
      "?billing=true&monitorLimit=at",
    );

    await expect(notice(page)).toContainText("so you can still add them");

    await page.getByTestId("card-select-more").click();
    await option(page, "Manual").click();
    await nameInput(form).fill("Payment provider status");
    await page.getByTestId("Create Monitor").click();

    await expect(page).toHaveURL(
      `/dashboard/${PROJECT_ID}/monitors/${CREATED_MONITOR_ID}`,
      { timeout: 30000 },
    );

    const creates: Array<RecordedCreate> = await createsRecorded(page);
    expect(creates).toHaveLength(1);
    expect(creates[0]!.data["monitorType"]).toBe("Manual");
  });

  test("a limit that cannot be read draws nothing, and the form works", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page, "?billing=true&monitorLimit=fail");

    await expect
      .poll(() => {
        return limitRequests(page);
      })
      .toBe(1);
    await expect(notice(page)).toHaveCount(0);
    await expect(option(page, "Website")).toBeVisible();
  });

  test("fits a phone: the notice wraps inside the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCreate(page, "?billing=true&monitorLimit=over");

    await expect(notice(page)).toBeVisible();

    const overflow: number = await page.evaluate((): number => {
      return (
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
      );
    });
    expect(overflow).toBeLessThanOrEqual(0);

    const box: { x: number; width: number } = await boxOf(notice(page));
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);

    await screenshot(page, "create-monitor-limit-phone");
  });

  test("dark mode: the notice sits on a dark surface", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page, "?theme=dark&billing=true&monitorLimit=over");

    await expect(notice(page)).toBeVisible();

    const background: string = await notice(page).evaluate(
      (element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      },
    );
    expect(background).not.toBe(WHITE_RGB);

    await screenshot(page, "create-monitor-limit-dark");
  });
});
