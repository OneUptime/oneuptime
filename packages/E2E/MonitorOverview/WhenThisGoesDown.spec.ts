import {
  BrowserContext,
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import { readFileSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * "WHEN THIS GOES DOWN" ON THE REAL MONITOR OVERVIEW (#6810).
 *
 * The side card says what happens when the monitor fails and who is told,
 * names each break in the chain with a link to the page that fixes it, and
 * opens the chain link by link. The fixture answers GET /who-is-told/
 * monitor/:id as the resolver does
 * (?whoIsTold=pages|nobody|hidden|rules|gaps), its breaks worked out by the
 * same pure helper. Checked at 1440 and 390, in the dark theme, and in
 * German and Persian; screenshots go to output/playwright/monitor-overview-ui.
 *
 * Why the policy pages somebody, and which of its targets reach nobody,
 * come as codes worded in the reader's language (#7217, #7261); each
 * target that reaches nobody is a row of the policy's list with its
 * warning where the people's icons are.
 *
 * The chain says the title the incident opens with and the owner rules
 * that add the owners it emails (#7076), and every status page that shows
 * the monitor, one that shows it through a monitor group among them
 * (#7077). An owner rule or status page the reader may not see keeps its
 * place without its name.
 *
 * The chain is laid out by the card's own width: in the side column (from
 * 1280) and on a phone each row's name is over its value, across the page
 * beside it. A failed read says so, with Try again; the On-call policy
 * row's name is a defined term, in capitals as every name is, and its
 * definition reads in its own type.
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

/*
 * #7307: the words of a failed read, and the Dashboard's German and Persian
 * for them, as the fixture draws them.
 */
const WHO_IS_TOLD_ERROR: string = "Couldn't work out who is told. {{error}}";
const SERVER_DOWN_MESSAGE: string =
  "Error connecting to server. Please try again in few minutes.";
const SERVER_DOWN_WHY: string = "The OneUptime server did not answer.";
const SERVER_DOWN_NEXT: string =
  "It may be starting or restarting. Try again in a few minutes.";
const SERVER_WHY: string =
  "The server ran into a problem it could not explain.";
const SERVER_NEXT_WITH_REFERENCE: string =
  "Try again. If it keeps failing, give this reference to whoever runs your OneUptime server:";

function localeOf(language: "de" | "fa"): Record<string, string> {
  return JSON.parse(
    readFileSync(
      path.resolve(
        __dirname,
        `../../App/FeatureSet/Dashboard/src/Locales/${language}.json`,
      ),
      "utf8",
    ),
  ) as Record<string, string>;
}

// Unicode's isolate marks, which set a sentence's values apart.
const ISOLATE_MARKS: RegExp = new RegExp(
  `[${String.fromCharCode(0x2066)}-${String.fromCharCode(0x2069)}]`,
  "g",
);

// What a reader reads: the text without its isolate marks, spaces as one.
async function readText(locator: Locator): Promise<string> {
  return ((await locator.textContent()) || "")
    .replace(ISOLATE_MARKS, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function open(
  page: Page,
  options: {
    whoIsTold?: "nobody" | "hidden" | "rules" | "gaps";
    theme?: "dark";
    lang?: "de" | "fa";
    width?: number;
    fail?: "who-is-told" | "who-is-told-reference";
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
  if (options.fail) {
    query.set("fail", options.fail);
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

/*
 * Every row of the open chain draws its name inside its own column, clear
 * of the row's value: a name wider than the column (German's
 * "Eigentümerregeln", "Bereitschaftsrichtlinie") gives way rather than run
 * over what the row says. Returns the names that do not, with how.
 */
async function getRowNamesOverValues(card: Locator): Promise<Array<string>> {
  return await card.evaluate((element: Element): Array<string> => {
    const problems: Array<string> = [];
    const rows: Array<Element> = Array.from(
      element.querySelectorAll('[data-testid="who-is-told-event"] > div'),
    );

    for (const row of rows) {
      const label: Element | undefined = row.children[0];
      const value: Element | undefined = row.children[1];

      if (!label || !value) {
        continue;
      }

      const labelBox: DOMRect = label.getBoundingClientRect();
      const valueBox: DOMRect = value.getBoundingClientRect();
      const range: Range = document.createRange();
      range.selectNodeContents(label);

      for (const text of Array.from(range.getClientRects())) {
        if (text.width === 0) {
          continue;
        }

        const name: string = (label.textContent || "").trim();

        if (text.left < labelBox.left - 1 || text.right > labelBox.right + 1) {
          problems.push(`${name}: wider than its column`);
          break;
        }

        if (
          text.left < valueBox.right &&
          text.right > valueBox.left &&
          text.top < valueBox.bottom &&
          text.bottom > valueBox.top
        ) {
          problems.push(`${name}: over the row's value`);
          break;
        }
      }
    }

    return problems;
  });
}

/*
 * How each row of the open chain is laid out - its name "over" its value or
 * "beside" it - and the rows whose value runs out of its criteria's box;
 * and each line of a policy's list - a person, or a target that reaches
 * nobody - whose icon is not beside its words, or not at the line's start
 * (the right on a right-to-left page).
 */
async function getChainLayout(card: Locator): Promise<{
  rows: Array<string>;
  outOfTheirBox: Array<string>;
  iconsNotBesideTheName: Array<string>;
  iconsNotAtTheStart: Array<string>;
}> {
  return await card.evaluate(
    (
      element: Element,
    ): {
      rows: Array<string>;
      outOfTheirBox: Array<string>;
      iconsNotBesideTheName: Array<string>;
      iconsNotAtTheStart: Array<string>;
    } => {
      const rows: Array<string> = [];
      const outOfTheirBox: Array<string> = [];
      const iconsNotBesideTheName: Array<string> = [];
      const iconsNotAtTheStart: Array<string> = [];

      for (const row of Array.from(
        element.querySelectorAll(
          '[data-testid="who-is-told-criteria"] > div:not([data-testid]), [data-testid="who-is-told-event"] > div',
        ),
      )) {
        const label: Element | undefined = row.children[0];
        const value: Element | undefined = row.children[1];
        const criteria: Element | null = row.closest(
          '[data-testid="who-is-told-criteria"]',
        );

        if (!label || !value || !criteria) {
          continue;
        }

        const name: string = (label.textContent || "").trim();
        const labelBox: DOMRect = label.getBoundingClientRect();
        const valueBox: DOMRect = value.getBoundingClientRect();
        const criteriaBox: DOMRect = criteria.getBoundingClientRect();

        if (labelBox.bottom <= valueBox.top + 1) {
          rows.push("over");
        } else if (
          Math.abs(labelBox.top - valueBox.top) <= 2 &&
          (labelBox.right <= valueBox.left + 1 ||
            labelBox.left >= valueBox.right - 1)
        ) {
          rows.push("beside");
        } else {
          rows.push(`${name}: neither over nor beside its value`);
        }

        if (
          valueBox.left < criteriaBox.left - 1 ||
          valueBox.right > criteriaBox.right + 1 ||
          value.scrollWidth > value.clientWidth + 1
        ) {
          outOfTheirBox.push(name);
        }
      }

      for (const line of Array.from(
        element.querySelectorAll(
          '[data-testid="who-is-told-person"], [data-testid="who-is-told-not-paged-row"]',
        ),
      )) {
        const icon: Element | undefined = line.children[0];
        const words: Element | undefined = line.children[1];

        if (!icon || !words) {
          iconsNotBesideTheName.push(`${line.textContent}: no icon column`);
          continue;
        }

        const iconBox: DOMRect = icon.getBoundingClientRect();
        const wordsBox: DOMRect = words.getBoundingClientRect();
        const isBeside: boolean =
          iconBox.right <= wordsBox.left + 1 ||
          iconBox.left >= wordsBox.right - 1;

        // Beside the words, on their first line.
        if (!isBeside || Math.abs(iconBox.top - wordsBox.top) > 6) {
          iconsNotBesideTheName.push(line.textContent || "");
        }

        // Where the line starts: the left, or the right read from the right.
        const isAtTheStart: boolean =
          getComputedStyle(line).direction === "rtl"
            ? iconBox.left >= wordsBox.right - 1
            : iconBox.right <= wordsBox.left + 1;

        if (!isAtTheStart) {
          iconsNotAtTheStart.push(line.textContent || "");
        }
      }

      return { rows, outOfTheirBox, iconsNotBesideTheName, iconsNotAtTheStart };
    },
  );
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
    // The title the incident opens with, under what opens.
    await expect(chain.getByTestId("who-is-told-title")).toHaveText(
      "Checkout API is offline",
    );
    await expect(chain.getByTestId("who-is-told-status-pages")).toContainText(
      "Public Status",
    );
    // No owner rule adds anyone: the row is not drawn.
    await expect(chain.getByTestId("who-is-told-owner-rules")).toHaveCount(0);
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

  test("names the owners an owner rule adds, the title it opens with, and a page that shows it through a group", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await open(page, { whoIsTold: "rules" });

    await expect(card.getByTestId("who-is-told-summary")).toHaveText(
      "OneUptime marks it Offline and opens a Critical incident. It emails the owners added by owner rules (Ben Ito and Checkout SRE). It pages Ana Lopez and Ben Ito through Primary On-Call.",
    );
    await card.getByTestId("who-is-told-chain-toggle").click();

    const chain: Locator = card.getByTestId("who-is-told-chain");
    await expect(chain.getByTestId("who-is-told-title")).toHaveText(
      "Checkout API is offline",
    );
    const ownerRules: Locator = chain.getByTestId("who-is-told-owner-rules");
    await expect(ownerRules).toContainText("Owner Rules");
    await expect(ownerRules).toContainText("Checkout monitors");
    await expect(chain).toContainText("Ben Ito, Checkout SRE");
    // The page that lists the monitor, and the one that lists its group.
    await expect(chain.getByTestId("who-is-told-status-pages")).toContainText(
      "Public Status, Payments Status",
    );
    expect(await getRowNamesOverValues(card)).toEqual([]);
    await shoot(card, "rules-1440-chain");
  });

  test("an owner rule or a status page the reader may not see keeps its place, without its name", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await open(page, { whoIsTold: "hidden" });

    // Who it emails is what the incident will say, whoever reads it.
    await expect(card.getByTestId("who-is-told-summary")).toContainText(
      "It emails the owners added by owner rules (Ben Ito and Checkout SRE).",
    );
    await card.getByTestId("who-is-told-chain-toggle").click();

    const chain: Locator = card.getByTestId("who-is-told-chain");
    await expect(chain.getByTestId("who-is-told-owner-rules")).toContainText(
      "A rule you can't see",
    );
    await expect(chain.getByTestId("who-is-told-status-pages")).toContainText(
      "Public Status, A status page you can't see",
    );
    await expect(card).not.toContainText("Checkout monitors");
    await expect(card).not.toContainText("Payments Status");
    await shoot(card, "hidden-1440-chain");
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

  test("says the owner rules and the status pages in German and in Persian", async ({
    page,
  }: {
    page: Page;
  }) => {
    let card: Locator = await open(page, { whoIsTold: "rules", lang: "de" });
    await expect(card.getByTestId("who-is-told-summary")).toContainText(
      "Die von den Eigentümerregeln hinzugefügten Eigentümer werden per E-Mail benachrichtigt (Ben Ito und Checkout SRE).",
    );
    // One person or several, the verb agrees: OneUptime is what alerts them.
    await expect(card.getByTestId("who-is-told-summary")).toContainText(
      "OneUptime alarmiert Ana Lopez und Ben Ito über Primary On-Call.",
    );
    await card.getByTestId("who-is-told-chain-toggle").click();
    await expect(card.getByTestId("who-is-told-owner-rules")).toContainText(
      "Eigentümerregeln",
    );
    await expect(card.getByTestId("who-is-told-status-pages")).toContainText(
      "Public Status, Payments Status",
    );
    // "Eigentümerregeln" and "Bereitschaftsrichtlinie" give way in their column.
    expect(await getRowNamesOverValues(card)).toEqual([]);
    await shoot(card, "rules-de-chain");

    // Right to left, each name in its column and its value beside it.
    card = await open(page, { whoIsTold: "rules", lang: "fa" });
    await card.getByTestId("who-is-told-chain-toggle").click();
    await expect(card.getByTestId("who-is-told-owner-rules")).toContainText(
      "Checkout monitors",
    );
    expect(await getRowNamesOverValues(card)).toEqual([]);

    card = await open(page, { whoIsTold: "hidden", lang: "fa", width: 390 });
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(card.getByTestId("who-is-told-summary")).toContainText(
      "به مالکانی که قواعد مالکیت اضافه می‌کنند ایمیل می‌زند",
    );
    await card.getByTestId("who-is-told-chain-toggle").click();
    await expect(card.getByTestId("who-is-told-owner-rules")).toContainText(
      "قاعده‌ای که نمی‌توانید ببینید",
    );
    await expect(card.getByTestId("who-is-told-status-pages")).toContainText(
      "صفحه وضعیتی که نمی‌توانید ببینید",
    );
    // An English title keeps its own direction in a Persian page.
    const title: Locator = card.getByTestId("who-is-told-title");
    await expect(title).toHaveText("Checkout API is offline");
    await expect(title).toHaveAttribute("dir", "ltr");
    await expectNoSidewaysScroll(page, {
      message: "Persian, 390 wide, chain open",
    });
    await shoot(card, "hidden-fa-390-chain");
  });

  test("lays the chain out by the card's own width: over in the side column and on a phone, beside across the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    // From 1280 the card is in the side column, a third of the page.
    let card: Locator = await open(page, { whoIsTold: "rules" });
    await card.getByTestId("who-is-told-chain-toggle").click();

    let layout: Awaited<ReturnType<typeof getChainLayout>> =
      await getChainLayout(card);
    expect(layout.rows.length).toBeGreaterThan(6);
    expect(
      layout.rows.filter((row: string): boolean => {
        return row !== "over";
      }),
    ).toEqual([]);
    expect(layout.outOfTheirBox).toEqual([]);
    expect(layout.iconsNotBesideTheName).toEqual([]);
    await expectNoSidewaysScroll(page, { message: "1440 wide, chain open" });

    // Below 1280 the card is as wide as the page.
    card = await open(page, { whoIsTold: "rules", width: 1024 });
    await card.getByTestId("who-is-told-chain-toggle").click();

    layout = await getChainLayout(card);
    expect(
      layout.rows.filter((row: string): boolean => {
        return row !== "beside";
      }),
    ).toEqual([]);
    expect(layout.outOfTheirBox).toEqual([]);
    expect(layout.iconsNotBesideTheName).toEqual([]);
    expect(await getRowNamesOverValues(card)).toEqual([]);
    await shoot(card, "rules-1024-chain");

    card = await open(page, { whoIsTold: "rules", width: 390 });
    await card.getByTestId("who-is-told-chain-toggle").click();

    layout = await getChainLayout(card);
    expect(
      layout.rows.filter((row: string): boolean => {
        return row !== "over";
      }),
    ).toEqual([]);
    expect(layout.outOfTheirBox).toEqual([]);
    expect(layout.iconsNotBesideTheName).toEqual([]);
    await expectNoSidewaysScroll(page, { message: "390 wide, chain open" });
    await shoot(card, "rules-390-chain");
  });

  /*
   * Why a policy pages somebody and which of its targets reach nobody
   * (#7217, #7261) come as codes, worded in the reader's language; each
   * target that reaches nobody is a row of the policy's list, its warning
   * where the people's icons are - on a Persian page at the right, where
   * the line starts.
   */
  test("says why each is paged and who is not in the reader's words, each target that reaches nobody beside its warning", async ({
    page,
  }: {
    page: Page;
  }) => {
    let card: Locator = await open(page, { whoIsTold: "gaps" });
    await card.getByTestId("who-is-told-chain-toggle").click();
    await expect(card.getByTestId("who-is-told-reached-through")).toHaveText([
      "Schedule Weekly Rotation (next in rotation)",
    ]);
    await expect(card.getByTestId("who-is-told-not-paged")).toHaveText([
      "Team Night Shift has no members.",
      "Nobody is on call in schedule Holiday Cover now.",
    ]);
    // Rows of the policy's list, after its people.
    await expect(
      card.locator(
        '[data-testid="who-is-told-policy"] ul > li[data-testid="who-is-told-not-paged-row"]',
      ),
    ).toHaveCount(2);
    await expect(
      card.locator('[data-testid="who-is-told-policy"] ul > li').last(),
    ).toHaveAttribute("data-testid", "who-is-told-not-paged-row");

    let layout: Awaited<ReturnType<typeof getChainLayout>> =
      await getChainLayout(card);
    expect(layout.iconsNotBesideTheName).toEqual([]);
    expect(layout.iconsNotAtTheStart).toEqual([]);
    await shoot(card, "gaps-1440-chain");

    card = await open(page, { whoIsTold: "gaps", lang: "de" });
    await card.getByTestId("who-is-told-chain-toggle").click();
    await expect(card.getByTestId("who-is-told-reached-through")).toHaveText([
      "Dienstplan Weekly Rotation (nächste in der Rotation)",
    ]);
    await expect(card.getByTestId("who-is-told-not-paged")).toHaveText([
      "Team Night Shift hat keine Mitglieder.",
      "Im Dienstplan Holiday Cover hat gerade niemand Bereitschaft.",
    ]);
    await shoot(card, "gaps-de-chain");

    card = await open(page, { whoIsTold: "gaps", lang: "fa", width: 390 });
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await card.getByTestId("who-is-told-chain-toggle").click();

    const notPaged: Locator = card.getByTestId("who-is-told-not-paged");
    await expect(notPaged).toHaveCount(2);
    await expect(card.getByTestId("who-is-told-not-paged-row")).toHaveCount(2);
    await expect(notPaged.nth(0)).toContainText("Night Shift");
    await expect(notPaged.nth(0)).toContainText("عضوی ندارد");
    await expect(notPaged.nth(1)).toContainText("Holiday Cover");
    await expect(notPaged.nth(1)).toContainText("آنکال نیست");

    // Persian sentences, read the page's way: no direction of their own.
    for (const line of await notPaged.all()) {
      await expect(line).not.toHaveAttribute("dir");
    }

    await expect(card).not.toContainText("has no members");
    await expect(card).not.toContainText("next in rotation");

    layout = await getChainLayout(card);
    expect(layout.iconsNotBesideTheName).toEqual([]);
    expect(layout.iconsNotAtTheStart).toEqual([]);
    expect(layout.outOfTheirBox).toEqual([]);
    await expectNoSidewaysScroll(page, {
      message: "Persian, 390 wide, chain open with its gaps",
    });
    await shoot(card, "gaps-fa-390-chain");
  });

  /*
   * A gateway's 502 is API.getFriendlyMessage's SERVER_DOWN_MESSAGE, which
   * the card said as it came: in English on every page, German and Persian
   * too (#7307). It says why and what to do next now, in the card's own
   * sentence and the reader's language.
   */
  test("a failed read says so, and Try again reads it again", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await open(page, { fail: "who-is-told" });

    await expect(card.getByTestId("who-is-told-error")).toHaveText(
      "Couldn't work out who is told. The OneUptime server did not answer. It may be starting or restarting. Try again in a few minutes.",
    );
    expect(await readText(card.getByTestId("who-is-told-error"))).not.toContain(
      SERVER_DOWN_MESSAGE,
    );
    await shoot(card, "error-1440");

    await card.getByRole("button", { name: "Try again" }).click();

    await expect(card.getByTestId("who-is-told-summary")).toContainText(
      "OneUptime marks it Offline and opens a Critical incident.",
    );
    await expect(card.getByTestId("who-is-told-error")).toHaveCount(0);
    await expect(card.getByTestId("who-is-told-try-again")).toHaveCount(0);
  });

  test("a failed read reads wholly in German and in Persian, and Try again reads it again", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const language of ["de", "fa"] as const) {
      const words: Record<string, string> = localeOf(language);
      const card: Locator = await open(page, {
        fail: "who-is-told",
        lang: language,
        width: language === "fa" ? 390 : 1440,
      });
      const error: Locator = card.getByTestId("who-is-told-error");

      await expect(error).toBeVisible();

      const text: string = await readText(error);

      expect(text).toBe(
        words[WHO_IS_TOLD_ERROR]!.replace(
          "{{error}}",
          `${words[SERVER_DOWN_WHY]} ${words[SERVER_DOWN_NEXT]}`,
        ),
      );
      // None of it in English, the words it came as least of all.
      for (const english of [
        SERVER_DOWN_MESSAGE,
        "Couldn't work out who is told.",
        SERVER_DOWN_WHY,
        SERVER_DOWN_NEXT,
      ]) {
        expect(text).not.toContain(english);
      }

      if (language === "de") {
        expect(text).toContain("Der OneUptime-Server hat nicht geantwortet.");
      } else {
        // Persian's own script: the only Latin letters are OneUptime's name.
        await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
        expect(text.replace(/OneUptime/g, "").match(/[A-Za-z]+/g)).toBeNull();
        await expectNoSidewaysScroll(page, { message: "Persian, 390 wide" });
      }

      await shoot(card, `error-${language}`);

      await card.getByRole("button", { name: words["Try again"]! }).click();

      await expect(card.getByTestId("who-is-told-summary")).toBeVisible();
      await expect(card.getByTestId("who-is-told-error")).toHaveCount(0);
    }
  });

  /*
   * A failure the server could not explain names a reference to its log
   * lines: the card said it as English text, with no way to copy it. It is
   * code now, beside a copy button that copies it, in every language.
   */
  test("a server failure names its reference in code, with a copy button that copies it", async ({
    page,
    context,
  }: {
    page: Page;
    context: BrowserContext;
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    let card: Locator = await open(page, { fail: "who-is-told-reference" });
    let error: Locator = card.getByTestId("who-is-told-error");

    await expect(error).toHaveText(
      "Couldn't work out who is told. The server ran into a problem it could not explain. Try again. If it keeps failing, give this reference to whoever runs your OneUptime server: 1f0c9a2b.",
    );

    let reference: Locator = error.getByTestId("error-reference");
    await expect(reference.locator("code")).toHaveText("1f0c9a2b");
    await expect(reference.locator("code")).toHaveAttribute("dir", "ltr");

    // The reference and its button keep to one line.
    const copy: Locator = reference.getByRole("button");
    await expect(copy).toHaveAccessibleName("Copy");
    const [codeBox, copyBox] = await Promise.all([
      reference.locator("code").boundingBox(),
      copy.boundingBox(),
    ]);
    expect(codeBox).not.toBeNull();
    expect(copyBox).not.toBeNull();
    expect(
      Math.abs(
        codeBox!.y + codeBox!.height / 2 - (copyBox!.y + copyBox!.height / 2),
      ),
    ).toBeLessThan(6);
    expect(copyBox!.x).toBeGreaterThan(codeBox!.x);

    await copy.click();
    await expect(copy).toHaveAttribute("data-copy-state", "copied");
    expect(
      await page.evaluate(async (): Promise<string> => {
        return await navigator.clipboard.readText();
      }),
    ).toBe("1f0c9a2b");
    await shoot(card, "error-reference-1440");

    await card.getByRole("button", { name: "Try again" }).click();
    await expect(card.getByTestId("who-is-told-summary")).toContainText(
      "OneUptime marks it Offline and opens a Critical incident.",
    );

    // In Persian on a phone: the sentence in its words, the reference in code.
    const words: Record<string, string> = localeOf("fa");
    card = await open(page, {
      fail: "who-is-told-reference",
      lang: "fa",
      width: 390,
    });
    error = card.getByTestId("who-is-told-error");
    await expect(error).toBeVisible();

    const text: string = await readText(error);
    expect(
      text.startsWith(words[WHO_IS_TOLD_ERROR]!.split("{{error}}")[0]!),
    ).toBe(true);
    expect(text).toContain(
      `${words[SERVER_WHY]} ${words[SERVER_NEXT_WITH_REFERENCE]} 1f0c9a2b.`,
    );
    expect(text).not.toContain("The server ran into a problem");
    expect(text).not.toContain("give this reference");

    reference = error.getByTestId("error-reference");
    await expect(reference.locator("code")).toHaveText("1f0c9a2b");
    await expect(reference.locator("code")).toHaveAttribute("dir", "ltr");
    await expect(reference.getByRole("button")).toHaveAccessibleName(
      words["Copy"]!,
    );
    await expectNoSidewaysScroll(page, { message: "Persian reference, 390" });
    await shoot(card, "error-reference-fa-390");
  });
});

/*
 * The chain's row names are drawn in small capitals, "On-call policy" too,
 * which is a defined term - a button, whose text a browser draws as written.
 * Its definition opens inside the name, and reads in its own type: not in
 * capitals, nor spaced or weighted as the name is.
 */
test.describe("When this goes down's On-call policy definition", () => {
  /*
   * The product reads the glossary from its own host (DOCS_URL); the
   * fixture is served from another, and its page allows reads from itself
   * alone (connect-src 'self'): the browser sets that aside here, and the
   * route below answers the read.
   */
  test.use({ bypassCSP: true });

  test("the name is in capitals as every row's is; its definition is not", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.route(
      /\/docs\/glossary\/en\.json$/,
      async (route: PlaywrightRoute) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({
            lang: "en",
            entries: [
              {
                id: "on-call-policy",
                term: "On-call policy",
                definition:
                  "Who is paged when an incident or alert needs a person, in what order, and how long each level has to answer.",
              },
            ],
          }),
        });
      },
    );

    const card: Locator = await open(page, { width: 1024 });
    await card.getByTestId("who-is-told-chain-toggle").click();

    const term: Locator = card.getByTestId("defined-term");
    await expect(term).toHaveText("On-call policy");
    expect(
      await term.evaluate((element: Element): string => {
        return getComputedStyle(element).textTransform;
      }),
    ).toBe("uppercase");

    // The criteria the term is in, in view: its picture is taken below.
    const criteria: Locator = card.getByTestId("who-is-told-criteria").nth(1);
    await criteria.scrollIntoViewIfNeeded();
    await term.hover();

    const definition: Locator = page.getByTestId("defined-term-definition");
    await expect(definition).toHaveText(
      "Who is paged when an incident or alert needs a person, in what order, and how long each level has to answer.",
    );

    const type: {
      textTransform: string;
      letterSpacing: string;
      weight: string;
    } = await page
      .getByTestId("defined-term-popover")
      .evaluate(
        (
          element: Element,
        ): { textTransform: string; letterSpacing: string; weight: string } => {
          const style: CSSStyleDeclaration = getComputedStyle(element);
          return {
            textTransform: style.textTransform,
            letterSpacing: style.letterSpacing,
            weight: style.fontWeight,
          };
        },
      );

    expect(type.textTransform).toBe("none");
    expect(["normal", "0px"]).toContain(type.letterSpacing);
    expect(type.weight).toBe("400");

    // The criteria with the definition over it, which reaches past the card.
    const boxes: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }> = [];
    for (const box of [
      await criteria.boundingBox(),
      await page.getByTestId("defined-term-popover").boundingBox(),
    ]) {
      expect(box).not.toBeNull();
      boxes.push(box!);
    }
    const left: number = Math.max(
      0,
      Math.min(
        ...boxes.map((box: { x: number }): number => {
          return box.x;
        }),
      ) - 8,
    );
    const top: number = Math.max(
      0,
      Math.min(
        ...boxes.map((box: { y: number }): number => {
          return box.y;
        }),
      ) - 8,
    );
    const right: number = Math.max(
      ...boxes.map((box: { x: number; width: number }): number => {
        return box.x + box.width + 8;
      }),
    );
    const bottom: number = Math.max(
      ...boxes.map((box: { y: number; height: number }): number => {
        return box.y + box.height + 8;
      }),
    );
    await fs.mkdir(SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: path.join(
        SCREENSHOTS,
        "when-this-goes-down-on-call-policy-definition.png",
      ),
      clip: { x: left, y: top, width: right - left, height: bottom - top },
    });
  });
});
