import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * EVALUATION DETAILS: WHY THE MONITOR OPENED THIS INCIDENT OR ALERT.
 *
 * The last section of the What happened card, under the root cause
 * (Components/EventView/EventEvaluationDetails, issue #5774). Folded, it
 * says why: the criteria that matched, each filter that matched with what
 * the check found and where, and how the check failed when it did. Show
 * details, beside the heading, adds the excerpt with the match marked, a
 * JavaScript expression's values, the filters that did not match, the
 * request and what came back, and what was masked.
 *
 * On the Event Overview fixture's incident #1042 and alert #311
 * (Fixture/Fixture.js, ?evaluation= and ?what=), with the clock pinned and
 * the network fenced; afterEach fails a test on an uncaught page error, or
 * on anything the fixture does not model. Each test saves a screenshot of
 * the card to output/playwright/event-overview-ui.
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
    evaluation?: "many" | "long" | "off" | "offline" | "logs" | "none";
    what?: "monitor";
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

  if (options.what) {
    query.set("what", options.what);
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

function toggleOf(page: Page): Locator {
  return section(page).getByTestId("evaluation-details-toggle");
}

async function openDetails(page: Page): Promise<void> {
  await toggleOf(page).click();
  await expect(toggleOf(page)).toHaveAttribute("aria-expanded", "true");
  await expect(section(page).getByTestId("evaluation-check")).toBeVisible();
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

// Where each value of the section starts, by the fact it belongs to.
async function valueStarts(page: Page): Promise<Record<string, number>> {
  return section(page).evaluate((root: Element): Record<string, number> => {
    const starts: Record<string, number> = {};

    root.querySelectorAll("dl > div[data-testid]").forEach((fact: Element) => {
      const value: Element | null = fact.querySelector("dd");

      if (value) {
        starts[fact.getAttribute("data-testid") || ""] = Math.round(
          value.getBoundingClientRect().left,
        );
      }
    });

    return starts;
  });
}

test.describe("an incident a monitor opened", () => {
  test("folded, it says why under the root cause: the criteria, each filter that matched and what it found", async ({
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
    await expect(section(page).getByTestId("evaluation-criteria")).toHaveText(
      "“Checkout is slow” matched when all of its filters did.",
    );

    const filters: Locator = section(page).getByTestId("evaluation-filter");
    await expect(filters).toHaveCount(2);
    await expect(
      filters.nth(0).getByTestId("evaluation-filter-title"),
    ).toContainText("Response Time (in ms) Greater Than 2000");
    await expect(
      filters.nth(0).getByTestId("evaluation-filter-actual"),
    ).toContainText("Latest check2,412 ms");
    await expect(
      filters.nth(0).getByTestId("evaluation-filter-window"),
    ).toContainText("The last 5 minutes, All Values");
    await expect(
      filters.nth(1).getByTestId("evaluation-filter-field"),
    ).toContainText("Found atdependencies[0].status");

    // What takes room, and what the stat bar already says, waits.
    await expect(
      section(page).getByTestId("evaluation-filter-excerpt"),
    ).toHaveCount(0);
    await expect(section(page).getByTestId("evaluation-check")).toHaveCount(0);
    await expect(section(page)).not.toContainText("eu-west-1 probe");
    // A sentence that only repeats its filter is not there at all.
    await expect(
      section(page).getByTestId("evaluation-filter-message"),
    ).toHaveCount(0);

    await expect(toggleOf(page)).toHaveText("Show details");
    await expect(toggleOf(page)).toHaveAttribute("aria-expanded", "false");

    await screenshotSection(page, "folded-1280");
  });

  test("Show details sits on the heading's line, at its end, and stays there as the section opens", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    const heading: Locator = section(page).getByRole("heading", {
      name: "Evaluation details",
    });
    const [headingBox, toggleBox, sectionBox]: Array<FrameBox> =
      await boxesInOneFrame([heading, toggleOf(page), section(page)]);

    // On the heading's line...
    expect(
      Math.abs(
        headingBox!.y +
          headingBox!.height / 2 -
          (toggleBox!.y + toggleBox!.height / 2),
      ),
    ).toBeLessThanOrEqual(3);
    // ...at its end: its words flush with the section's edge.
    expect(
      Math.abs(
        sectionBox!.x + sectionBox!.width - (toggleBox!.x + toggleBox!.width),
      ),
    ).toBeLessThanOrEqual(8);

    await openDetails(page);

    const opened: FrameBox | null = await toggleOf(page).boundingBox();
    expect(Math.abs(opened!.y - toggleBox!.y)).toBeLessThanOrEqual(1);
    await expect(toggleOf(page)).toHaveText("Hide details");
  });

  test("opened: the excerpt with the match marked, what the window held, then the request and what came back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);
    await openDetails(page);

    const filters: Locator = section(page).getByTestId("evaluation-filter");

    // What the window held: the only sentence that says more than its filter.
    await expect(
      section(page).getByTestId("evaluation-filter-message"),
    ).toHaveCount(1);
    await expect(
      filters.nth(0).getByTestId("evaluation-filter-message"),
    ).toContainText("ranged from 2,180 ms to 2,412 ms across all 3 readings");

    const body: Locator = filters.nth(1);
    await expect(body.getByTestId("evaluation-excerpt-match")).toHaveText(
      "degraded",
    );
    await expect(body.getByTestId("evaluation-filter-excerpt")).toContainText(
      '"name":"orders-db","status":"degraded","pool":{"inUse":10,"max":10,"waiting":37}}',
    );
    await expect(body.getByTestId("evaluation-filter-excerpt")).toContainText(
      '"owner":"[REDACTED]"',
    );

    await expect(section(page).getByTestId("evaluation-request")).toHaveText(
      "POST https://api.acme-commerce.example/api/checkout/health?region=eu&api_key=[REDACTED]",
    );
    const terms: Array<string> = await section(page)
      .getByTestId("evaluation-facts")
      .locator("dt")
      .allTextContents();
    expect(terms).toEqual([
      "Request",
      "Checked",
      "Probe",
      "Status code",
      "Response time",
    ]);
    await expect(
      section(page).getByTestId("evaluation-facts-response-time"),
    ).toContainText("2,412 ms");

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

    await toggleOf(page).click();
    await expect(section(page).getByTestId("evaluation-check")).toHaveCount(0);
    await expect(
      section(page).getByTestId("evaluation-filter-excerpt"),
    ).toHaveCount(0);
  });

  test("every value of the section starts on one line, the check's facts and the filters' alike", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);
    await openDetails(page);

    const starts: Record<string, number> = await valueStarts(page);

    expect(Object.keys(starts)).toEqual(
      expect.arrayContaining([
        "evaluation-filter-actual",
        "evaluation-filter-field",
        "evaluation-facts-request",
        "evaluation-facts-checked",
      ]),
    );
    expect(new Set(Object.values(starts)).size).toBe(1);
  });

  test("a criteria of Any: the filters that matched folded, the one that did not opened, said so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { evaluation: "many" });

    await expect(section(page).getByTestId("evaluation-criteria")).toHaveText(
      "“Checkout is degraded” matched when one of its filters did.",
    );

    const filters: Locator = section(page).getByTestId("evaluation-filter");
    await expect(filters).toHaveCount(3);

    // The expression is code under its title, and says no "True".
    const expression: Locator = filters.nth(1);
    await expect(expression.getByTestId("evaluation-filter-value")).toHaveText(
      "{{responseBody.dependencies[0].pool.inUse}} >= {{responseBody.dependencies[0].pool.max}} && '{{responseHeaders.set-cookie}}' !== ''",
    );
    await expect(
      expression
        .getByTestId("evaluation-filter-title")
        .getByTestId("evaluation-filter-value"),
    ).toHaveCount(0);
    await expect(
      expression.getByTestId("evaluation-filter-actual"),
    ).toHaveCount(0);

    await screenshotSection(page, "many-folded-1280");

    await openDetails(page);

    await expect(filters).toHaveCount(4);
    await expect(filters.nth(3)).toHaveAttribute("data-matched", "false");
    await expect(
      filters.nth(3).getByTestId("evaluation-filter-not-matched"),
    ).toHaveText("Did not match");
    await expect(
      filters.nth(3).getByTestId("evaluation-filter-message"),
    ).toHaveText(
      "Response Status Code was 200 (expected to be greater than 499).",
    );

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
    // The expression's sentence would say it all a third time.
    await expect(
      expression.getByTestId("evaluation-filter-message"),
    ).toHaveCount(0);

    await expect(
      filters.nth(2).getByTestId("evaluation-filter-field"),
    ).toContainText("x-cache");
    await expect(
      filters.nth(2).getByTestId("evaluation-filter-actual"),
    ).toContainText("MISS");

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

  test("a check that could not connect says how it failed, folded", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { evaluation: "offline" });

    const filters: Locator = section(page).getByTestId("evaluation-filter");
    await expect(filters).toHaveCount(1);
    await expect(filters.getByTestId("evaluation-filter-title")).toContainText(
      "Is Online False",
    );
    // No "Actual False" under "Is Online False": its sentence instead.
    await expect(filters.getByTestId("evaluation-filter-actual")).toHaveCount(
      0,
    );
    await expect(
      filters.getByTestId("evaluation-filter-message"),
    ).toContainText("Monitor reported offline status");
    await expect(
      section(page).getByTestId("evaluation-facts-failure"),
    ).toContainText(
      "Request timed out after 10 seconds: no response from shop.acme-commerce.example:443.",
    );

    await screenshotSection(page, "offline-1280");

    await openDetails(page);

    // The failure stays first; the rest of the check opens under it.
    const terms: Array<string> = await section(page)
      .getByTestId("evaluation-facts")
      .locator("dt")
      .allTextContents();
    expect(terms).toEqual([
      "Failure",
      "Request",
      "Checked",
      "Probe",
      "Response time",
    ]);
    await expect(filters).toHaveCount(2);
  });

  test("a check of nothing the section reads: the filter's sentence, and no Show details", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { evaluation: "logs" });

    await expect(section(page).getByTestId("evaluation-criteria")).toHaveText(
      "“Checkout logs errors” matched.",
    );
    await expect(
      section(page).getByTestId("evaluation-filter-message"),
    ).toHaveText(
      "Log Count was 412 in the last 5 minutes, above the 100 threshold.",
    );
    await expect(toggleOf(page)).toHaveCount(0);

    await screenshotSection(page, "logs-1280");
  });

  test("beside the root cause the monitor wrote, it says the same why as facts", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { what: "monitor" });

    await expect(
      page.getByTestId("what-happened-root-cause-value"),
    ).toContainText("Created because the following criteria was met");
    await expect(section(page).getByTestId("evaluation-filter")).toHaveCount(2);

    await screenshotSection(page, "beside-monitor-root-cause-1280");
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

      // How the check failed shows folded.
      await expect(
        section(page).getByTestId("evaluation-facts-failure"),
      ).toContainText("orders-db waited for a free connection");

      await openDetails(page);

      await expect(
        section(page).getByTestId("evaluation-facts-step"),
      ).toContainText("2 of 3");

      await expectNoSidewaysScroll(page, { message: `${width}px` });
      expect(await partsOutsideTheCard(page)).toEqual([]);

      await screenshotSection(page, `long-${width}`);
    });
  }

  test("on a phone the check's short facts sit two to a line, the request on its own", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { width: 390 });
    await openDetails(page);

    const [request, checked, probe, statusCode]: Array<FrameBox> =
      await boxesInOneFrame([
        section(page).getByTestId("evaluation-facts-request"),
        section(page).getByTestId("evaluation-facts-checked"),
        section(page).getByTestId("evaluation-facts-probe"),
        section(page).getByTestId("evaluation-facts-status-code"),
      ]);

    // Checked and Probe on one line, under the request.
    expect(Math.abs(checked!.y - probe!.y)).toBeLessThanOrEqual(1);
    expect(probe!.x).toBeGreaterThan(checked!.x + checked!.width);
    expect(checked!.y).toBeGreaterThanOrEqual(request!.y + request!.height);
    expect(statusCode!.y).toBeGreaterThan(checked!.y);

    await screenshotSection(page, "open-390");
  });
});

test.describe("an alert a monitor opened", () => {
  test("says why too", async ({ page }: { page: Page }) => {
    await open(page, { pagePath: ALERT_PATH });
    await expect(section(page)).toBeVisible();

    await expect(section(page).getByTestId("evaluation-criteria")).toHaveText(
      "“Webhook returns server errors” matched when all of its filters did.",
    );
    await expect(
      section(page)
        .getByTestId("evaluation-filter")
        .nth(0)
        .getByTestId("evaluation-filter-actual"),
    ).toContainText("Actual502");

    await openDetails(page);

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
    await open(page, { theme: "dark", width: 390, evaluation: "many" });
    await openDetails(page);
    await screenshotSection(page, "dark-390");
  });

  test("German, where labels run long, at 1280 and 390", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [1280, 390]) {
      await open(page, { lang: "de", width, evaluation: "many" });
      await expect(
        section(page).getByRole("heading", { name: "Auswertungsdetails" }),
      ).toBeVisible({ timeout: 30000 });
      await expect(toggleOf(page)).toHaveText("Details anzeigen");
      await openDetails(page);
      await expect(toggleOf(page)).toHaveText("Details ausblenden");
      await expectNoSidewaysScroll(page, { message: `de ${width}px` });
      expect(await partsOutsideTheCard(page)).toEqual([]);
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

      // The toggle at the heading line's end: its left, read from the right.
      const [headingBox, toggleBox]: Array<FrameBox> = await boxesInOneFrame([
        section(page).getByRole("heading", { name: "جزئیات ارزیابی" }),
        toggleOf(page),
      ]);
      expect(toggleBox!.x + toggleBox!.width).toBeLessThan(headingBox!.x);

      await expectNoSidewaysScroll(page, { message: `fa ${width}px` });
      await screenshotSection(page, `fa-${width}`);
    }
  });
});
