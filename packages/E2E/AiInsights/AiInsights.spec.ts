import {
  ConsoleMessage,
  expect,
  Locator,
  Page,
  Route,
  test,
} from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";
import { sideMenuAtRest } from "../SuiteHelpers/SideMenuAtRest";

/*
 * AI Insights (Incidents and Alerts → AI → Insights), in a browser, against
 * the offline fixture (AiInsights/Fixture): what OneUptime AI found out about
 * the project's incidents (or alerts) in the last 30 days, and - in the
 * footnote's Fixes section - where its fixes ended up, how their
 * verification went and where people approved them: on the AI card, in
 * Slack or in Microsoft Teams (#5715's follow-up).
 *
 * The page is the production one, inside the real Incidents and Alerts
 * route groups (their side menus and trails), and its insights are worked
 * out by the server's own builder from the rows the fixture keeps. Read the
 * way a person reads it: at a laptop's width and a phone's, light and dark,
 * in German and in Persian (right to left, its counts in Persian digits),
 * with a month of AI work, a month with nothing investigated, a reader who
 * may not read fixes, Enable AI off, and a read that fails. The fixture
 * records every read, so each test also checks nothing it does not model
 * was asked for.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const DASHBOARD: string = `/dashboard/${PROJECT_ID}`;
const INCIDENTS_INSIGHTS: string = `${DASHBOARD}/incidents/ai/insights`;
const ALERTS_INSIGHTS: string = `${DASHBOARD}/alerts/ai/insights`;

const LAPTOP: { width: number; height: number } = { width: 1280, height: 900 };
const PHONE: { width: number; height: number } = { width: 390, height: 844 };

/*
 * Every test runs at one moment, so the month the page reads and the days
 * its chart names are the same on every run.
 */
const SUITE_CLOCK: Date = new Date("2026-11-06T12:00:00.000Z");

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/ai-insights-ui",
);

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        `../../App/FeatureSet/Dashboard/src/Locales/${language}.json`,
      ),
      "utf8",
    ),
  ) as Record<string, string>;
}

// The Dashboard's own words, as the fixture draws them with ?lang=de|fa.
const GERMAN: Record<string, string> = readLocale("de");
const PERSIAN: Record<string, string> = readLocale("fa");

function german(english: string): string {
  const word: string | undefined = GERMAN[english];
  expect(word, `German for "${english}"`).toBeTruthy();
  return word!;
}

function persian(english: string): string {
  const word: string | undefined = PERSIAN[english];
  expect(word, `Persian for "${english}"`).toBeTruthy();
  return word!;
}

// The isolates a sentence sets its values apart with (FSI, PDI and kin).
const ISOLATE_MARKS: RegExp = /[\u2066-\u2069]/g;

function withoutIsolateMarks(text: string): string {
  return text.replace(ISOLATE_MARKS, "");
}

// A sentence of the locale with its values put in, as the page writes it.
function filled(sentence: string, values: Record<string, string>): string {
  let text: string = sentence;

  for (const name of Object.keys(values)) {
    text = text.split(`{{${name}}}`).join(values[name]!);
  }

  return text;
}

const LATIN_DIGIT: RegExp = /[0-9]/;
const PERSIAN_DIGIT: RegExp = /[\u06F0-\u06F9]/;
/*
 * A middle dot beside a Persian digit: Persian writes zero as a dot, so
 * "۴ · ۲" reads "۴۰ ۲". Facts are joined with the Persian comma instead.
 */
const DOT_BESIDE_PERSIAN_DIGIT: RegExp =
  /[\u06F0-\u06F9]\s*\u00B7|\u00B7\s*[\u06F0-\u06F9]/;
// Two words of Latin letters in a row: English, on a Persian page.
const LATIN_WORDS: RegExp = /[A-Za-z]{2,}[\s'’-]+[A-Za-z]{2,}/;
// Words every language here borrows from English as they are.
const BORROWED_WORDS: RegExp =
  /pull request|OneUptime AI|OneUptime|Microsoft Teams|Slack/gi;

interface Recorded {
  listRequests: Array<{ modelName: string }>;
  countRequests: Array<{ modelName: string }>;
  apiRequests: Array<{ method: string; url: string }>;
  insightsAnswers: number;
  unhandled: Array<Record<string, unknown>>;
  systemWords: Array<string>;
}

const pageErrors: Map<Page, Array<string>> = new Map();
const outsideRequests: Map<Page, Array<string>> = new Map();
// What React says of markup HTML does not allow (a div in a paragraph).
const nestingWarnings: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const outside: Array<string> = [];
  const nesting: Array<string> = [];
  pageErrors.set(page, errors);
  outsideRequests.set(page, outside);
  nestingWarnings.set(page, nesting);

  await page.clock.setFixedTime(SUITE_CLOCK);

  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
  page.on("console", (message: ConsoleMessage) => {
    if (
      message.type() === "error" &&
      message.text().includes("validateDOMNesting")
    ) {
      nesting.push(message.text().slice(0, 300));
    }
  });

  // Nothing may leave the fixture: no CDN, no telemetry, no real API.
  await page.route("**/*", async (route: Route) => {
    const url: URL = new URL(route.request().url());

    if (url.hostname === "127.0.0.1") {
      await route.continue();
      return;
    }

    outside.push(url.toString());
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  // A page that threw while drawing is a bug even when the test passed.
  expect(pageErrors.get(page) || []).toEqual([]);
  expect(outsideRequests.get(page) || []).toEqual([]);
  expect(nestingWarnings.get(page) || [], "markup HTML does not allow").toEqual(
    [],
  );

  if (!page.isClosed()) {
    // Every read the page made is one the fixture answers as the server does.
    expect((await recorded(page)).unhandled, "reads not modelled").toEqual([]);
  }
});

async function recorded(page: Page): Promise<Recorded> {
  return await page.evaluate((): Recorded => {
    return (window as unknown as { __aiInsightsFixture: Recorded })
      .__aiInsightsFixture;
  });
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fsPromises.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

// One part of the page, shot on its own for the pull request.
async function screenshotOf(locator: Locator, name: string): Promise<void> {
  await fsPromises.mkdir(SCREENSHOTS, { recursive: true });
  await locator.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    animations: "disabled",
  });
}

function withQuery(address: string, query: string): string {
  return query ? `${address}?${query}` : address;
}

/*
 * An AI Insights page, once its heading is drawn in the Dashboard's font,
 * what it read is drawn (the insights, an empty state or the failure) and
 * its side menu is at rest.
 */
async function open(
  page: Page,
  address: string,
  query: string = "",
  viewport: { width: number; height: number } = LAPTOP,
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto(withQuery(address, query));
  await expect(page.getByTestId("ai-insights-page-heading")).toBeVisible({
    timeout: 60000,
  });
  await expect(
    page
      .getByTestId("ai-insights-activity")
      .or(page.getByTestId("ai-insights-empty"))
      .or(page.getByTestId("ai-insights-error")),
  ).toBeVisible();
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await sideMenuAtRest(page);
}

function fixes(page: Page): Locator {
  return page.getByTestId("ai-insights-fixes");
}

// The texts of a list of elements, their isolates' marks taken out.
async function textsOf(locator: Locator): Promise<Array<string>> {
  return (await locator.allTextContents()).map((text: string): string => {
    return withoutIsolateMarks(text).trim();
  });
}

// "In Slack" and its count: each place's row, as it reads.
async function approvalPlaces(
  page: Page,
): Promise<Array<{ place: string; count: string }>> {
  return await fixes(page)
    .getByTestId("ai-insights-fix-approval-place")
    .evaluateAll(
      (rows: Array<Element>): Array<{ place: string; count: string }> => {
        return rows.map((row: Element): { place: string; count: string } => {
          const parts: Array<Element> = Array.from(row.children);
          return {
            place: (parts[0]?.textContent || "").trim(),
            count: (parts[1]?.textContent || "").trim(),
          };
        });
      },
    );
}

/*
 * Every text of the AI Insights page itself - its heading, the notices over
 * it and what it read, inside the Incidents or Alerts layout - each text
 * node, and each title and aria-label a pointer or a screen reader reads.
 */
async function everyTextOf(page: Page): Promise<Array<string>> {
  const texts: Array<string> = await page.evaluate((): Array<string> => {
    const root: HTMLElement = document.querySelector(
      "[data-testid='ai-insights-page-heading']",
    )!.parentElement!;
    const banner: Element | null = root.querySelector(
      "[data-testid='fixture-header']",
    );
    const found: Array<string> = [];
    const walker: TreeWalker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
    );
    let node: Node | null = walker.nextNode();

    while (node) {
      if (!banner || !banner.contains(node)) {
        const text: string = (node.textContent || "").trim();

        if (text) {
          found.push(text);
        }
      }

      node = walker.nextNode();
    }

    root
      .querySelectorAll("[title], [aria-label]")
      .forEach((element: Element) => {
        if (banner && banner.contains(element)) {
          return;
        }

        for (const attribute of ["title", "aria-label"]) {
          const value: string | null = element.getAttribute(attribute);

          if (value && value.trim()) {
            found.push(value.trim());
          }
        }
      });

    return found;
  });

  return texts.map(withoutIsolateMarks);
}

// What on a page in another script is English: two Latin words in a row.
async function englishLeftOn(page: Page): Promise<Array<string>> {
  const systemWords: Array<string> = [...(await recorded(page)).systemWords]
    .concat(["GMT", "UTC"])
    .sort((a: string, b: string): number => {
      return b.length - a.length;
    });

  return (await everyTextOf(page)).filter((text: string): boolean => {
    let left: string = text.replace(BORROWED_WORDS, " ");

    for (const words of systemWords) {
      left = left.split(words).join(" ");
    }

    return LATIN_WORDS.test(left);
  });
}

test.describe("the Fixes section", () => {
  test("at a laptop's width: where every fix ended up, how verification went, and where fixes were approved", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS_INSIGHTS);

    const section: Locator = fixes(page);
    await expect(section).toBeVisible();

    // The bar's legend: each outcome and how many, applied first.
    expect(
      await textsOf(
        section
          .getByRole("progressbar")
          .first()
          .locator("xpath=..")
          .locator("[data-testid='stacked-progress-bar-count']"),
      ),
    ).toEqual(["(1)", "(4)", "(1)", "(1)", "(1)"]);
    await expect(section).toContainText("Applied automatically (1)");
    await expect(section).toContainText("Applied after approval (4)");
    await expect(section).toContainText("Waiting for approval (1)");

    // How verification went, right under the bar.
    await expect(
      section.getByTestId("ai-insights-fix-verification"),
    ).toHaveText(
      "Verification: 3 resolved the problem, 1 did not, 1 still being checked.",
    );

    // Where the approved fixes were approved, the most first.
    await expect(
      section.getByTestId("ai-insights-fix-approval-places"),
    ).toContainText("Where fixes were approved");
    expect(await approvalPlaces(page)).toEqual([
      { place: "In Slack", count: "2" },
      { place: "In OneUptime", count: "1" },
      { place: "In Microsoft Teams", count: "1" },
    ]);

    // The fix pull requests, under their own label.
    await expect(section.getByTestId("ai-insights-fix-tasks")).toContainText(
      "Pull request opened (2)",
    );

    // Each segment of the bar says what it is and how many on hover.
    const segments: Array<string | null> = await section
      .getByRole("progressbar")
      .first()
      .locator(":scope > div")
      .evaluateAll((nodes: Array<Element>): Array<string | null> => {
        return nodes.map((node: Element): string | null => {
          return node.getAttribute("title");
        });
      });
    expect(segments).toEqual([
      "Applied automatically: 1",
      "Applied after approval: 4",
      "Waiting for approval: 1",
      "Dismissed: 1",
      "No fix found: 1",
    ]);

    await expectNoSidewaysScroll(page);
    await screenshotOf(
      page.getByTestId("ai-insights-activity"),
      "ai-insights-fixes-1280",
    );
    await screenshot(page, "ai-insights-incidents-1280");
  });

  test("on a phone, light and dark: it fits, its legend wraps, and each place's count sits at its row's end", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const theme of ["light", "dark"]) {
      await open(
        page,
        INCIDENTS_INSIGHTS,
        theme === "dark" ? "theme=dark" : "",
        PHONE,
      );

      await expect(page.locator("html")).toHaveClass(
        theme === "dark" ? /dark/ : /^(?!.*\bdark\b).*$/,
      );
      await expectNoSidewaysScroll(page, { message: theme });

      const section: Locator = fixes(page);
      await section.scrollIntoViewIfNeeded();

      // Each place's count at its row's end, the row inside the card.
      const rows: Locator = section.getByTestId(
        "ai-insights-fix-approval-place",
      );
      await expect(rows).toHaveCount(3);
      for (let index: number = 0; index < 3; index++) {
        const [row, count]: Array<FrameBox> = await boxesInOneFrame([
          rows.nth(index),
          rows.nth(index).locator("span").last(),
        ]);
        expect(row!.x + row!.width).toBeLessThanOrEqual(PHONE.width);
        expect(
          Math.abs(count!.x + count!.width - (row!.x + row!.width)),
          `${theme}: a place's count ends where its row does`,
        ).toBeLessThan(1);
      }

      // The legend wraps inside the card: every entry within the screen.
      const legend: Locator = section.locator(
        "[data-testid='stacked-progress-bar-count']",
      );
      const boxes: Array<FrameBox> = await boxesInOneFrame(await legend.all());
      for (const box of boxes) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
      }

      await screenshotOf(
        page.getByTestId("ai-insights-activity"),
        `ai-insights-fixes-390-${theme}`,
      );
    }
  });

  test("in Persian on a phone, dark: right to left, and every count in Persian digits", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS_INSIGHTS, "lang=fa&theme=dark", PHONE);

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expectNoSidewaysScroll(page);

    const section: Locator = fixes(page);

    // The legend's counts: (۴), never (4).
    const counts: Array<string> = await textsOf(
      section.locator("[data-testid='stacked-progress-bar-count']"),
    );
    expect(counts).toHaveLength(7);
    for (const count of counts) {
      expect(count).toMatch(PERSIAN_DIGIT);
      expect(count).not.toMatch(LATIN_DIGIT);
    }
    expect(counts.slice(0, 5)).toEqual(["(۱)", "(۴)", "(۱)", "(۱)", "(۱)"]);

    // The legend's words are Persian.
    await expect(section).toContainText(persian("Applied after approval"));

    // The verification line: Persian, its counts in Persian digits.
    await expect(
      section.getByTestId("ai-insights-fix-verification"),
    ).toHaveText(
      filled(
        persian(
          "Verification: {{verified}} resolved the problem, {{failed}} did not, {{verifying}} still being checked.",
        ),
        { verified: "۳", failed: "۱", verifying: "۱" },
      ),
    );

    // The places: Persian words, Persian digits.
    expect(await approvalPlaces(page)).toEqual([
      { place: persian("In Slack"), count: "۲" },
      { place: persian("In OneUptime"), count: "۱" },
      { place: persian("In Microsoft Teams"), count: "۱" },
    ]);

    /*
     * Each line of facts - a problem's fixes, what people said of its
     * findings, how often it came up, a monitor's and a service's - joined
     * with the Persian comma: no middle dot beside a count, where it read
     * as a zero.
     */
    const factLines: Array<string> = await textsOf(
      page.locator(
        [
          "ai-insights-insight-fixes",
          "ai-insights-insight-verdicts",
          "ai-insights-problem-count",
          "ai-insights-monitors-item",
          "ai-insights-services-item",
        ]
          .map((testId: string): string => {
            return `[data-testid='${testId}']`;
          })
          .join(", "),
      ),
    );
    expect(factLines.length).toBeGreaterThan(3);
    for (const line of factLines) {
      expect({ line, dot: DOT_BESIDE_PERSIAN_DIGIT.test(line) }).toEqual({
        line,
        dot: false,
      });
    }
    expect(factLines.join(" ")).toContain("\u060C ");

    // The numbers at a glance and the trend: no Latin digit left.
    for (const testId of [
      "ai-insights-stat-investigations",
      "ai-insights-stat-coverage",
      "ai-insights-stat-fixes",
      "ai-insights-stat-commands",
      "ai-insights-trend-weeks",
      "ai-insights-trend-ends",
    ]) {
      const text: string = withoutIsolateMarks(
        (await page.getByTestId(testId).textContent()) || "",
      );
      expect({ testId, latin: LATIN_DIGIT.test(text) }).toEqual({
        testId,
        latin: false,
      });
    }

    await screenshotOf(
      page.getByTestId("ai-insights-activity"),
      "ai-insights-fixes-390-fa-dark",
    );
    await screenshot(page, "ai-insights-incidents-390-fa-dark");
  });

  test("in Persian at a laptop's width: no sentence of the page is left in English", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const address of [INCIDENTS_INSIGHTS, ALERTS_INSIGHTS]) {
      await open(page, address, "lang=fa");

      expect(await englishLeftOn(page), address).toEqual([]);
    }

    await screenshot(page, "ai-insights-alerts-1280-fa");
  });

  test("in German: the page's subtitle and the Fixes section's every sentence", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS_INSIGHTS, "lang=de");

    await expect(
      page.getByTestId("ai-insights-page-heading").locator("p"),
    ).toHaveText(
      german(
        "What OneUptime AI found out about your incidents in the last 30 days: what keeps going wrong and why, and what to do about it.",
      ),
    );
    await expect(page.getByTestId("ai-insights-logs-link")).toHaveText(
      german("See everything AI did in AI Logs"),
    );

    const section: Locator = fixes(page);
    await expect(section).toContainText(
      `${german("Applied after approval")} (4)`,
    );
    await expect(
      section.getByTestId("ai-insights-fix-verification"),
    ).toHaveText(
      filled(
        german(
          "Verification: {{verified}} resolved the problem, {{failed}} did not, {{verifying}} still being checked.",
        ),
        { verified: "3", failed: "1", verifying: "1" },
      ),
    );
    expect(await approvalPlaces(page)).toEqual([
      { place: german("In Slack"), count: "2" },
      { place: german("In OneUptime"), count: "1" },
      { place: german("In Microsoft Teams"), count: "1" },
    ]);
    await expect(page.getByTestId("ai-insights-trend")).toContainText(
      german("Investigations per day"),
    );

    // The insights' own lines, worded in German too.
    await expect(
      page.getByTestId("ai-insights-insight-fixes").first(),
    ).toContainText(filled(german("{{count}} fixes proposed"), { count: "6" }));

    await screenshotOf(
      page.getByTestId("ai-insights-activity"),
      "ai-insights-fixes-1280-de",
    );
  });

  test("on the alerts' page too", async ({ page }: { page: Page }) => {
    await open(page, ALERTS_INSIGHTS);

    await expect(
      page.getByTestId("ai-insights-page-heading").locator("p"),
    ).toHaveText(
      "What OneUptime AI found out about your alerts in the last 30 days: what keeps going wrong and why, and what to do about it.",
    );
    expect(await approvalPlaces(page)).toEqual([
      { place: "In Slack", count: "2" },
      { place: "In OneUptime", count: "1" },
      { place: "In Microsoft Teams", count: "1" },
    ]);
    await expect(page.getByTestId("ai-insights-stat-coverage")).toContainText(
      "Alerts investigated",
    );
  });

  /*
   * The AI card says a waiting fix "Needs approval" - never "Needs your
   * approval" - to someone the server would refuse (RemediationFixActGate),
   * and so does AI Insights: a Project Member whose team blocks runbook
   * runs reads fixes and may not approve them.
   */
  test("a member whose team blocks runbook runs reads that a fix is waiting for approval, never theirs (?role=runbook-blocked)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS_INSIGHTS, "role=runbook-blocked");

    const waiting: Locator = page.locator(
      "[data-testid='ai-insights-insight'][data-kind='FixesAwaitingApproval']",
    );
    await expect(
      waiting.getByTestId("ai-insights-insight-headline"),
    ).toHaveText("A fix is waiting for approval");
    await expect(page.getByTestId("ai-insights-insights")).not.toContainText(
      "your approval",
    );
    // Its way to the fix is the same: the fix can still be looked at.
    await expect(waiting.getByTestId("ai-insights-next-step-link")).toHaveText(
      "Review the fix",
    );
  });

  test("a reader who may not read fixes sees no fix numbers, and why (?fixes=hidden)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS_INSIGHTS, "fixes=hidden");

    const section: Locator = fixes(page);
    await expect(section.getByTestId("ai-insights-fixes-hidden")).toHaveText(
      "Fix numbers are not shown: seeing them needs permission to read auto-remediation suggestions.",
    );
    await expect(section.getByRole("progressbar")).toHaveCount(1);
    await expect(
      section.getByTestId("ai-insights-fix-approval-places"),
    ).toHaveCount(0);
    await expect(page.getByTestId("ai-insights-stat-fixes")).toContainText(
      "Not shown to your role",
    );
  });
});

test.describe("the page", () => {
  test("its heading and the way to AI Logs: on a German phone the link's words wrap instead of running off the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS_INSIGHTS, "lang=de", PHONE);

    await expectNoSidewaysScroll(page);

    const [heading, link]: Array<FrameBox> = await boxesInOneFrame([
      page.getByTestId("ai-insights-page-heading"),
      page.getByTestId("ai-insights-logs-link"),
    ]);
    expect(link!.x).toBeGreaterThanOrEqual(heading!.x - 0.5);
    expect(link!.x + link!.width).toBeLessThanOrEqual(
      heading!.x + heading!.width + 0.5,
    );
    // Two lines, rather than one past the screen's edge.
    expect(link!.height).toBeGreaterThan(30);

    await screenshotOf(
      page.getByTestId("ai-insights-page-heading"),
      "ai-insights-heading-390-de",
    );
  });

  test("the trend's first and last day in the reader's calendar, each bar's day and counts in its hover", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS_INSIGHTS);

    // 30 days ending today: 8 Oct to 6 Nov.
    await expect(page.getByTestId("ai-insights-trend-ends")).toHaveText(
      "08 Oct06 Nov",
    );
    const days: Locator = page.getByTestId("ai-insights-trend-day");
    await expect(days).toHaveCount(30);
    await expect(days.last()).toHaveAttribute("data-date", "2026-11-06");
    await expect(days.last()).toHaveAttribute(
      "title",
      /^06 Nov: \d+ investigations, \d+ failed, \d+ fixes$/,
    );

    await open(page, INCIDENTS_INSIGHTS, "lang=fa");
    const ends: string = withoutIsolateMarks(
      (await page.getByTestId("ai-insights-trend-ends").textContent()) || "",
    );
    expect(ends).toMatch(PERSIAN_DIGIT);
    expect(ends).not.toMatch(LATIN_DIGIT);
    const hover: string = withoutIsolateMarks(
      (await page
        .getByTestId("ai-insights-trend-day")
        .last()
        .getAttribute("title")) || "",
    );
    expect(hover).toMatch(PERSIAN_DIGIT);
    expect(hover).not.toMatch(LATIN_DIGIT);
  });

  test("nothing investigated: the empty state says what will show up, and the coverage says why (?state=empty)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS_INSIGHTS, "state=empty");

    await expect(page.getByTestId("ai-insights-empty")).toContainText(
      "Nothing to show yet",
    );
    const coverage: Locator = page.getByTestId("ai-insights-coverage");
    await expect(coverage).toBeVisible();
    await expect(
      coverage.getByTestId("ai-insights-not-investigated").locator("li"),
    ).not.toHaveCount(0);
    await expect(page.getByTestId("ai-insights-fixes")).toHaveCount(0);

    await open(page, INCIDENTS_INSIGHTS, "state=empty&lang=fa", PHONE);
    await expectNoSidewaysScroll(page);
    expect(await englishLeftOn(page)).toEqual([]);
    await screenshot(page, "ai-insights-empty-390-fa");
  });

  test("a read that fails says so, and Try again answers (?fail=insights)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS_INSIGHTS, "fail=insights");

    const error: Locator = page.getByTestId("ai-insights-error");
    await expect(error).toContainText(
      "The server took too long to answer. Try again.",
    );
    expect((await recorded(page)).insightsAnswers).toBe(0);

    await error.getByRole("button").first().click();

    await expect(fixes(page)).toBeVisible();
    expect((await recorded(page)).insightsAnswers).toBe(1);
  });

  test("Enable AI off: the notice over the page, with the switch for an owner and who can for a member (?ai=off)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS_INSIGHTS, "ai=off");

    const notice: Locator = page.getByTestId("project-ai-off-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(
      "OneUptime AI is off for this project, so nothing new is investigated or fixed, and nothing new shows up on this page.",
    );
    await expect(notice.getByRole("switch")).toBeVisible();

    await open(page, INCIDENTS_INSIGHTS, "ai=off&role=member&lang=de");
    const sentence: Locator = page.getByTestId("project-ai-off-sentence");
    await expect(sentence).toContainText(
      german(
        "OneUptime AI is off for this project, so nothing new is investigated or fixed, and nothing new shows up on this page.",
      ),
    );
    await expect(
      page.getByTestId("project-ai-off-notice").getByRole("switch"),
    ).toHaveCount(0);
  });

  test("the side menu lights Insights, and the trail reads Project, Incidents, AI, Insights", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS_INSIGHTS);

    await expect(
      page.locator("aside[role='navigation'] [aria-current='page']"),
    ).toHaveText("Insights");
    const trail: Array<string> = await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .locator("ol > li")
      .evaluateAll((items: Array<Element>): Array<string> => {
        return items
          .map((item: Element): string => {
            return (item.textContent || "").trim();
          })
          .filter((text: string): boolean => {
            return text.length > 0;
          });
      });
    expect(trail).toEqual(["Project", "Incidents", "AI", "Insights"]);

    // AI Logs, one press away, is the incidents' own.
    await expect(
      page.getByTestId("ai-insights-logs-link").locator("xpath=.."),
    ).toHaveAttribute("href", `${DASHBOARD}/incidents/ai/logs`);
  });
});
