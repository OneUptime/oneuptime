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

const PORT: string = "4223";
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
    await openCreate(page);

    await page.getByTestId("card-select-search").click();
    await page.keyboard.type("k8s");
    await expect(page.getByTestId("card-select-search-summary")).toHaveText(
      "Showing 1 of 32",
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
