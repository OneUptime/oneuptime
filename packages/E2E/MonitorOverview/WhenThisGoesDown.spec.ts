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
 * "WHEN THIS GOES DOWN" ON THE REAL MONITOR OVERVIEW (#6810).
 *
 * The side card says what happens when the monitor fails and who is told,
 * names each break in the chain with a link to the page that fixes it, and
 * opens the chain link by link. The fixture answers GET /who-is-told/
 * monitor/:id as the resolver does (?whoIsTold=pages|nobody|hidden), its
 * breaks worked out by the same pure helper. Checked at 1440 and 390, in
 * the dark theme, and in German and Persian; screenshots go to
 * output/playwright/monitor-overview-ui.
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
    whoIsTold?: "nobody" | "hidden";
    theme?: "dark";
    lang?: "de" | "fa";
    width?: number;
  } = {},
): Promise<Locator> {
  const width: number = options.width || 1440;
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await page.clock.setFixedTime(NOW);
  const query: URLSearchParams = new URLSearchParams({ type: "api" });
  if (options.whoIsTold) {
    query.set("whoIsTold", options.whoIsTold);
  }
  if (options.theme) {
    query.set("theme", options.theme);
  }
  if (options.lang) {
    query.set("lang", options.lang);
  }
  await page.goto(`${DASHBOARD}/monitors/${MONITOR_ID}?${query}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  const card: Locator = page.getByTestId("monitor-who-is-told-card");
  await expect(card).toBeVisible({ timeout: 30000 });
  await expect(card.getByTestId("who-is-told-loading")).toHaveCount(0, {
    timeout: 30000,
  });
  return card;
}

async function shoot(locator: Locator, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await locator.scrollIntoViewIfNeeded();
  await locator.screenshot({
    path: path.join(SCREENSHOTS, `when-this-goes-down-${name}.png`),
  });
}

test.describe("When this goes down", () => {
  test("says what happens and who is paged, and opens the chain link by link", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await open(page);

    await expect(card.getByTestId("who-is-told-summary")).toHaveText(
      "OneUptime marks it Offline and opens a Critical incident. It emails the project's owners (Ana Lopez). It pages Ana Lopez and Ben Ito through Primary On-Call.",
    );
    await expect(card.getByTestId("who-is-told-no-breaks")).toBeVisible();
    await shoot(card, "1440");

    const toggle: Locator = card.getByTestId("who-is-told-chain-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const chain: Locator = card.getByTestId("who-is-told-chain");
    await expect(chain.getByTestId("who-is-told-criteria")).toHaveCount(2);
    await expect(chain).toContainText("When Offline matches");
    await expect(chain).toContainText("Every incident");
    await expect(chain).toContainText("Public Status");
    await expect(chain.getByTestId("who-is-told-person")).toHaveCount(2);
    await expect(
      chain.getByRole("link", { name: "Primary On-Call" }),
    ).toHaveAttribute(
      "href",
      new RegExp(
        `/on-call-duty/policies/5f000000-0000-4000-8000-0000000000a1$`,
      ),
    );
    await shoot(card, "1440-chain");
  });

  test("names the break when nobody is paged, with Set Up Paging", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await open(page, { whoIsTold: "nobody" });

    await expect(card.getByTestId("who-is-told-summary")).toContainText(
      "Nobody is paged.",
    );

    const brk: Locator = card.getByTestId("who-is-told-break");
    await expect(brk).toHaveCount(1);
    await expect(brk).toContainText(
      "Nobody is paged: no on-call rule matches incidents from this monitor.",
    );
    await expect(
      brk.getByRole("link", { name: "Set Up Paging" }),
    ).toHaveAttribute("href", /\/incidents\/settings\/on-call-rules/);
    await shoot(card, "nobody-1440");
  });

  test("a reader who may not see the policy learns paging is set up, and nothing of who", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await open(page, { whoIsTold: "hidden" });

    await expect(card.getByTestId("who-is-told-summary")).toContainText(
      "It pages the people on call through an on-call policy you can't see.",
    );
    await card.getByTestId("who-is-told-chain-toggle").click();
    await expect(card.getByTestId("who-is-told-hidden-policy")).toBeVisible();
    await expect(card.getByTestId("who-is-told-person")).toHaveCount(0);
    await expect(card).not.toContainText("Ana Lopez and Ben Ito");
  });

  test("fits a phone, with the chain open, without sideways scroll", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await open(page, { whoIsTold: "nobody", width: 390 });

    await card.getByTestId("who-is-told-chain-toggle").click();
    await expect(card.getByTestId("who-is-told-chain")).toBeVisible();
    await expectNoSidewaysScroll(page, { message: "390 wide, chain open" });
    await shoot(card, "nobody-390-chain");
  });

  test("reads in the dark theme, in German and in Persian", async ({
    page,
  }: {
    page: Page;
  }) => {
    let card: Locator = await open(page, {
      whoIsTold: "nobody",
      theme: "dark",
    });
    await shoot(card, "nobody-dark");

    card = await open(page, { whoIsTold: "nobody", lang: "de" });
    await expect(card.getByTestId("who-is-told-summary")).toContainText(
      "OneUptime setzt den Status auf Offline und öffnet einen Vorfall mit Schweregrad Critical.",
    );
    await expect(card.getByTestId("who-is-told-break")).toContainText(
      "Niemand wird alarmiert: Keine Bereitschaftsregel passt zu Vorfällen dieser Überwachung.",
    );
    await shoot(card, "nobody-de");

    card = await open(page, { whoIsTold: "nobody", lang: "fa", width: 390 });
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(card.getByTestId("who-is-told-break")).toContainText(
      "کسی فراخوانده نمی‌شود",
    );
    await expectNoSidewaysScroll(page, { message: "Persian, 390 wide" });
    await shoot(card, "nobody-fa-390");
  });
});
