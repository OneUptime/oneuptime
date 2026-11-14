import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * "USED BY" ON THE REAL MONITOR OVERVIEW (#6813).
 *
 * The side card under "When this goes down" lists what refers to the
 * monitor - its status pages, monitor groups, SLOs, maintenance coming up,
 * workflows - each with how many the reader may see, the first three as
 * links, how many they may not see (never named), and See all for the rest
 * a page at a time. Nothing referring to it, the card says what to do next.
 * The fixture answers GET /used-by/monitor/:id as UsedByService does
 * (?usedBy=none|used). Checked at 1440 and 390, in the dark theme, and in
 * German and Persian; screenshots go to output/playwright/monitor-overview-ui.
 */

const PORT: string = process.env["MONITOR_OVERVIEW_FIXTURE_PORT"] || "4223";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const MONITOR_ID: string = "70000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const DASHBOARD: string = `/dashboard/${PROJECT_ID}`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/monitor-overview-ui",
);

const pageErrors: Map<Page, Array<string>> = new Map();
const abortedRequests: Map<Page, Array<string>> = new Map();

test.use({ deviceScaleFactor: 2 });

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

async function open(
  page: Page,
  options: {
    usedBy?: "used";
    theme?: "dark";
    lang?: "de" | "fa";
    width?: number;
    fail?: "used-by";
  } = {},
): Promise<Locator> {
  const width: number = options.width || 1440;
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await page.clock.setFixedTime(NOW);
  const query: URLSearchParams = new URLSearchParams({ type: "api" });
  if (options.usedBy) {
    query.set("usedBy", options.usedBy);
  }
  if (options.theme) {
    query.set("theme", options.theme);
  }
  if (options.lang) {
    query.set("lang", options.lang);
  }
  if (options.fail) {
    query.set("fail", options.fail);
  }
  await page.goto(`${DASHBOARD}/monitors/${MONITOR_ID}?${query}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  const card: Locator = page.getByTestId("used-by-card");
  await expect(card).toBeVisible({ timeout: 30000 });
  await expect(card.getByTestId("used-by-loading")).toHaveCount(0, {
    timeout: 30000,
  });
  return card;
}

// The card's frame: the Card around the card's body.
function frame(card: Locator): Locator {
  return card.locator("xpath=ancestor::*[@data-testid='card'][1]");
}

async function shoot(locator: Locator, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await locator.scrollIntoViewIfNeeded();
  await locator.screenshot({
    path: path.join(SCREENSHOTS, `used-by-${name}.png`),
  });
}

test.describe("Used by on the monitor overview", () => {
  test("a monitor nothing refers to: the card says so, and what to do next", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await open(page);
    const empty: Locator = card.getByTestId("used-by-empty");

    await expect(empty).toContainText("Nothing uses this monitor yet");
    await expect(empty).toContainText(
      "Add it to a status page so visitors see when it is down.",
    );
    await expect(card.getByTestId("used-by-empty-action")).toHaveAttribute(
      "href",
      `${DASHBOARD}/status-pages`,
    );
    await shoot(frame(card), "empty-1440");
  });

  test("lists what refers to it, the first three of each as links, and what the reader may not see", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await open(page, { usedBy: "used" });
    const groups: Locator = card.getByTestId("used-by-group");

    await expect(groups).toHaveCount(5);
    expect(
      await groups.evaluateAll((elements: Array<Element>): Array<string> => {
        return elements.map((element: Element): string => {
          return element.getAttribute("data-relation") || "";
        });
      }),
    ).toEqual([
      "MonitorStatusPages",
      "MonitorGroups",
      "MonitorSlos",
      "MonitorScheduledMaintenance",
      "MonitorWorkflows",
    ]);

    const pages: Locator = groups.nth(0);
    await expect(pages.getByTestId("used-by-count")).toHaveText("5");
    await expect(pages.getByTestId("used-by-row")).toHaveCount(3);
    await expect(pages.getByTestId("used-by-hidden")).toHaveText(
      "and 1 you can't see",
    );
    await expect(
      pages.getByRole("link", { name: "Acme public status" }),
    ).toHaveAttribute(
      "href",
      `${DASHBOARD}/status-pages/71300000-0000-4000-8000-000000000100`,
    );

    // A numbered record keeps its number.
    await expect(groups.nth(3)).toContainText("SM-12 Load balancer patching");

    // Only hidden: counted, never named.
    await expect(groups.nth(4).getByTestId("used-by-count")).toHaveText("0");
    await expect(groups.nth(4).getByTestId("used-by-hidden")).toHaveText(
      "2 you can't see",
    );
    await expect(groups.nth(4).getByTestId("used-by-row")).toHaveCount(0);

    await shoot(frame(card), "used-1440");
  });

  test("See all opens the whole list, and Close returns to the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await open(page, { usedBy: "used" });

    await card.getByTestId("used-by-see-all").click();

    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("used-by-dialog-impact")).toHaveText(
      "6 status pages show this monitor.",
    );
    await expect(dialog.getByTestId("used-by-row")).toHaveCount(5);
    await expect(dialog.getByTestId("used-by-hidden")).toHaveText(
      "and 1 you can't see",
    );
    await expect(dialog.getByTestId("used-by-show-more")).toHaveCount(0);
    await page.waitForTimeout(300);
    await shoot(dialog, "see-all-1440");

    await dialog.getByRole("button", { name: "Close" }).last().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("a failed read says why, and Try again reads it again", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await open(page, { usedBy: "used", fail: "used-by" });

    /*
     * The fixture fails it as a gateway's 502: said in the reader's words,
     * never the fixed English it came as (#7307).
     */
    await expect(card.getByTestId("used-by-error")).toContainText(
      "Couldn't load what uses this. The OneUptime server did not answer. It may be starting or restarting. Try again in a few minutes.",
    );
    await expect(card.getByTestId("used-by-error")).not.toContainText(
      "Error connecting to server",
    );
    await card.getByTestId("used-by-try-again").click();
    await expect(card.getByTestId("used-by-group")).toHaveCount(5);
  });

  test("fits a phone, in the dark theme, with no sideways scroll", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await open(page, {
      usedBy: "used",
      width: 390,
      theme: "dark",
    });

    await expect(card.getByTestId("used-by-group")).toHaveCount(5);
    await expectNoSidewaysScroll(page);
    await shoot(frame(card), "used-390-dark");

    await card.getByTestId("used-by-see-all").click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog.getByTestId("used-by-row")).toHaveCount(5);
    await expectNoSidewaysScroll(page);
    await page.waitForTimeout(300);
    await shoot(dialog, "see-all-390-dark");
  });

  test("reads in German and Persian", async ({ page }: { page: Page }) => {
    const german: Locator = await open(page, { usedBy: "used", lang: "de" });

    await expect(frame(german)).toContainText("Verwendet von");
    await expect(german.getByTestId("used-by-group").nth(0)).toContainText(
      "Statusseiten",
    );
    await expect(
      german.getByTestId("used-by-group").nth(0).getByTestId("used-by-hidden"),
    ).toHaveText("und 1 für Sie nicht sichtbar");
    await expect(german.getByTestId("used-by-see-all").first()).toHaveText(
      "Alle anzeigen",
    );
    await shoot(frame(german), "used-de-1440");

    const persian: Locator = await open(page, {
      usedBy: "used",
      lang: "fa",
      width: 390,
    });

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(frame(persian)).toContainText("استفاده‌شده توسط");
    await expectNoSidewaysScroll(page);
    await shoot(frame(persian), "used-fa-390");
  });
});
