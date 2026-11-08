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
 * EVALUATION DETAILS: WHY THE MONITOR OPENED THIS INCIDENT OR ALERT.
 *
 * The last section of the What happened card, under the root cause: the
 * check the monitor made, then - one click away - the request, how the
 * criteria matched, each filter with what it found and where, a JavaScript
 * expression's values and a redacted excerpt of the response with the
 * match marked (Components/EventView/EventEvaluationDetails, issue #5774).
 *
 * On the Event Overview fixture's incident #1042 and alert #311
 * (Fixture/Fixture.js, ?evaluation=), with the clock pinned and the network
 * fenced; afterEach fails a test on an uncaught page error, or on anything
 * the fixture does not model. Each test saves a screenshot of the section
 * to output/playwright/event-overview-ui.
 */

const PORT: string = process.env["EVENT_OVERVIEW_FIXTURE_PORT"] || "4222";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-14T18:20:00.000Z");
const DASHBOARD: string = `/dashboard/${PROJECT_ID}`;
const INCIDENT_PATH: string = `${DASHBOARD}/incidents/20000000-0000-4000-8000-000000001042`;
const ALERT_PATH: string = `${DASHBOARD}/alerts/30000000-0000-4000-8000-000000000311`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/event-overview-ui",
);

const pageErrors: Map<Page, Array<string>> = new Map();

test.use({ deviceScaleFactor: 2 });

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
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
    await route.abort();
  });

  await page.clock.setFixedTime(NOW);
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);

  const unhandled: Array<unknown> = await page
    .evaluate((): Array<unknown> => {
      const state: { unhandled?: Array<unknown> } | undefined = (
        window as unknown as {
          __eventOverviewFixture?: { unhandled?: Array<unknown> };
        }
      ).__eventOverviewFixture;
      return JSON.parse(JSON.stringify(state?.unhandled || []));
    })
    .catch((): Array<unknown> => {
      return [];
    });
  expect(unhandled, "requests the fixture does not model").toEqual([]);
});

async function open(
  page: Page,
  options: {
    pagePath?: string;
    width?: number;
    evaluation?: "many" | "long" | "off" | "none";
    theme?: "dark";
    lang?: "de" | "fa";
  } = {},
): Promise<void> {
  const width: number = options.width || 1280;
  await page.setViewportSize({ width, height: width <= 390 ? 844 : 1000 });

  const query: URLSearchParams = new URLSearchParams();

  if (options.evaluation) {
    query.set("evaluation", options.evaluation);
  }

  if (options.theme) {
    query.set("theme", options.theme);
  }

  if (options.lang) {
    query.set("lang", options.lang);
    // The page takes its language's reading direction, as production does.
    query.set("dir", "auto");
  }

  await page.goto(
    `${options.pagePath || INCIDENT_PATH}${query.toString() ? `?${query.toString()}` : ""}`,
  );
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByTestId("what-happened")).toBeVisible({
    timeout: 30000,
  });
}

function section(page: Page): Locator {
  return page.getByTestId("what-happened-evaluation");
}

async function openDetails(page: Page): Promise<void> {
  const toggle: Locator = section(page).getByTestId(
    "evaluation-details-toggle",
  );
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    section(page).getByTestId("evaluation-details-body"),
  ).toBeVisible();
}

async function screenshotSection(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  const card: Locator = page.getByTestId("what-happened");
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({
    path: path.join(SCREENSHOTS, `evaluation-details-${name}-synthetic.png`),
    animations: "disabled",
  });
}

// Parts of the section drawn outside the What happened card, by their text.
async function partsOutsideTheCard(page: Page): Promise<Array<string>> {
  return page.getByTestId("what-happened").evaluate((content: Element) => {
    // The card itself: its padding is room a quiet button may reach into.
    const root: Element = content.closest("[data-testid='card']") || content;
    const box: DOMRect = root.getBoundingClientRect();
    const outside: Array<string> = [];

    root.querySelectorAll("*").forEach((element: Element): void => {
      const part: DOMRect = element.getBoundingClientRect();

      if (part.width === 0 || part.height === 0) {
        return;
      }

      if (part.left < box.left - 1 || part.right > box.right + 1) {
        outside.push(
          `${element.tagName.toLowerCase()} "${(element.textContent || "").trim().slice(0, 40)}"`,
        );
      }
    });

    return outside;
  });
}

test.describe("an incident a monitor opened", () => {
  test("says how the monitor decided, under the root cause, folded to the check it made", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    await expect(section(page)).toBeVisible();

    // Last in the card, after the root cause.
    const order: Array<string | null> = await page
      .getByTestId("what-happened")
      .locator("section")
      .evaluateAll((sections: Array<Element>) => {
        return sections.map((element: Element) => {
          return element.getAttribute("data-testid");
        });
      });
    expect(order).toEqual([
      "what-happened-root-cause",
      "what-happened-evaluation",
    ]);

    await expect(
      section(page).getByRole("heading", { name: "Evaluation details" }),
    ).toBeVisible();

    const facts: Locator = section(page).getByTestId("evaluation-facts");
    await expect(facts).toContainText("Checked");
    await expect(facts).toContainText("eu-west-1 probe");
    await expect(facts).toContainText("Status code200");
    await expect(facts).toContainText("Response time2,412 ms");

    await expect(
      section(page).getByTestId("evaluation-details-toggle"),
    ).toHaveText("Show details");
    await expect(
      section(page).getByTestId("evaluation-details-body"),
    ).toHaveCount(0);

    await screenshotSection(page, "folded-1280");
  });

  test("opened: the request, the criteria, each filter with where it matched and the excerpt", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);
    await openDetails(page);

    await expect(section(page).getByTestId("evaluation-request")).toHaveText(
      "POST https://api.acme-commerce.example/api/checkout/health?region=eu&api_key=[REDACTED]",
    );
    await expect(section(page).getByTestId("evaluation-criteria")).toHaveText(
      "“Checkout is slow” matched when all of its filters did.",
    );

    const filters: Locator = section(page).getByTestId("evaluation-filter");
    await expect(filters).toHaveCount(2);

    const slow: Locator = filters.nth(0);
    await expect(slow.getByTestId("evaluation-filter-title")).toContainText(
      "Response Time (in ms) Greater Than 2000",
    );
    await expect(slow.getByTestId("evaluation-filter-actual")).toContainText(
      "Latest check2,412 ms",
    );
    await expect(slow.getByTestId("evaluation-filter-window")).toContainText(
      "The last 5 minutes, All Values",
    );

    const body: Locator = filters.nth(1);
    await expect(body.getByTestId("evaluation-filter-field")).toContainText(
      "Found atdependencies[0].status",
    );
    await expect(body.getByTestId("evaluation-excerpt-match")).toHaveText(
      "degraded",
    );
    await expect(body.getByTestId("evaluation-filter-excerpt")).toContainText(
      '"name":"orders-db","status":"degraded","pool":{"inUse":10,"max":10,"waiting":37}}',
    );
    await expect(body.getByTestId("evaluation-filter-excerpt")).toContainText(
      '"owner":"[REDACTED]"',
    );

    await expect(
      section(page).getByTestId("evaluation-note-masked"),
    ).toHaveText("Secrets and personal data in the response are masked.");

    // The match is marked: a background of its own, not only bold text.
    const markBackground: string = await body
      .getByTestId("evaluation-excerpt-match")
      .evaluate((element: Element) => {
        return getComputedStyle(element).backgroundColor;
      });
    expect(markBackground).not.toBe("rgba(0, 0, 0, 0)");

    // The excerpt keeps the monospace font, the mark inside it too.
    const fonts: Array<string> = await body
      .getByTestId("evaluation-filter-excerpt")
      .locator("pre, pre mark")
      .evaluateAll((elements: Array<Element>) => {
        return elements.map((element: Element) => {
          return getComputedStyle(element).fontFamily;
        });
      });
    expect(fonts).toHaveLength(2);
    expect(fonts[0]).toBe(fonts[1]);
    expect(fonts[0]).not.toContain("Inter");

    await screenshotSection(page, "open-1280");

    await section(page).getByTestId("evaluation-details-toggle").click();
    await expect(
      section(page).getByTestId("evaluation-details-body"),
    ).toHaveCount(0);
  });

  test("a criteria of Any: the filters that matched first, the one that did not said so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { evaluation: "many" });
    await openDetails(page);

    await expect(section(page).getByTestId("evaluation-criteria")).toHaveText(
      "“Checkout is degraded” matched when one of its filters did.",
    );

    const filters: Locator = section(page).getByTestId("evaluation-filter");
    await expect(filters).toHaveCount(4);
    await expect(filters.nth(3)).toHaveAttribute("data-matched", "false");
    await expect(
      filters.nth(3).getByTestId("evaluation-filter-not-matched"),
    ).toHaveText("Did not match");

    const values: Locator = section(page).getByTestId(
      "evaluation-filter-values",
    );
    await expect(values).toContainText(
      "responseBody.dependencies[0].pool.inUse = 10",
    );
    await expect(values).toContainText(
      "responseHeaders.set-cookie = [REDACTED]",
    );
    await expect(values).toContainText(
      "responseBody.dependencies[0].pool.queue = not found",
    );

    await expect(
      filters.nth(2).getByTestId("evaluation-filter-field"),
    ).toContainText("x-cache");

    await screenshotSection(page, "many-1280");
  });

  test("a monitor that keeps no response content says so, with no excerpt", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { evaluation: "off" });
    await openDetails(page);

    await expect(
      section(page).getByTestId("evaluation-note-not-kept"),
    ).toHaveText(
      "The monitor keeps no response content on its incidents and alerts.",
    );
    await expect(
      section(page).getByTestId("evaluation-note-masked"),
    ).toHaveCount(0);
    await expect(
      section(page).getByTestId("evaluation-filter-excerpt"),
    ).toHaveCount(0);

    await screenshotSection(page, "off-1280");
  });

  test("an incident from before the details were kept has no section, and the card is as it was", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { evaluation: "none" });

    await expect(page.getByTestId("what-happened-root-cause")).toBeVisible();
    await expect(section(page)).toHaveCount(0);
  });
});

test.describe("long values on every width", () => {
  for (const width of [390, 768, 1024, 1280]) {
    test(`at ${width}px nothing leaves the card and the page does not scroll sideways (?evaluation=long)`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, { evaluation: "long", width });
      await openDetails(page);

      await expect(
        section(page).getByTestId("evaluation-request-facts-step"),
      ).toContainText("2 of 3");
      await expect(
        section(page).getByTestId("evaluation-request-facts-failure"),
      ).toContainText("orders-db waited for a free connection");

      await expectNoSidewaysScroll(page, { message: `${width}px` });
      expect(await partsOutsideTheCard(page)).toEqual([]);

      await screenshotSection(page, `long-${width}`);
    });
  }
});

test.describe("an alert a monitor opened", () => {
  test("says how the monitor decided too", async ({ page }: { page: Page }) => {
    await open(page, { pagePath: ALERT_PATH });
    await expect(section(page)).toBeVisible();
    await openDetails(page);

    await expect(section(page).getByTestId("evaluation-criteria")).toHaveText(
      "“Webhook returns server errors” matched when all of its filters did.",
    );
    await expect(
      section(page).getByTestId("evaluation-excerpt-match"),
    ).toHaveText("ledger-api");

    await screenshotSection(page, "alert-1280");
  });
});

test.describe("in both themes and in other languages", () => {
  test("dark: the section reads on the dark card, its excerpt and mark included", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { theme: "dark" });
    await openDetails(page);

    const colors: { card: string; excerpt: string; text: string } = await page
      .getByTestId("what-happened")
      .evaluate((root: Element) => {
        const pre: Element | null = root.querySelector(
          "[data-testid='evaluation-filter-excerpt'] pre",
        );
        const heading: Element | null = root.querySelector(
          "[data-testid='what-happened-evaluation'] h3",
        );
        return {
          card: getComputedStyle(root.closest("[data-testid='card']") || root)
            .backgroundColor,
          excerpt: pre ? getComputedStyle(pre).backgroundColor : "",
          text: heading ? getComputedStyle(heading).color : "",
        };
      });

    // No white box on the dark card, and no dark heading on it.
    expect(colors.excerpt).not.toBe("rgb(249, 250, 251)");
    expect(colors.text).not.toBe("rgb(17, 24, 39)");

    await screenshotSection(page, "dark-1280");
    await open(page, { theme: "dark", width: 390 });
    await openDetails(page);
    await screenshotSection(page, "dark-390");
  });

  test("German, where labels run long, at 1280 and 390", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [1280, 390]) {
      await open(page, { lang: "de", width });
      await expect(
        section(page).getByRole("heading", { name: "Auswertungsdetails" }),
      ).toBeVisible({ timeout: 30000 });
      await openDetails(page);
      await expect(
        section(page).getByTestId("evaluation-details-toggle"),
      ).toHaveText("Details ausblenden");
      await expectNoSidewaysScroll(page, { message: `de ${width}px` });
      await screenshotSection(page, `de-${width}`);
    }
  });

  test("Persian, read from the right, the response still from the left", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [1280, 390]) {
      await open(page, { lang: "fa", width });
      await expect(
        section(page).getByRole("heading", { name: "جزئیات ارزیابی" }),
      ).toBeVisible({ timeout: 30000 });
      await openDetails(page);

      await expect(
        section(page).getByTestId("evaluation-filter-excerpt").locator("pre"),
      ).toHaveAttribute("dir", "ltr");
      await expect(
        section(page).getByTestId("evaluation-request"),
      ).toHaveAttribute("dir", "ltr");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expectNoSidewaysScroll(page, { message: `fa ${width}px` });
      await screenshotSection(page, `fa-${width}`);
    }
  });
});
