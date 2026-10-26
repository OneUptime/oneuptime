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
 * EVERY MONITOR TYPE'S SUMMARY, LAID OUT BY ITS OWN WIDTH, IN A REAL BROWSER.
 *
 * The Monitor Summary card sits in the overview's two-thirds column. Its
 * per-type views (SummaryView/*) drew their facts as a flex row of quarter-
 * and fifth-width cards: at 1280 every value was squeezed into a column a
 * word or two wide, and at 390 the row was wider than the phone, so the
 * card scrolled sideways under the reader's thumb (an Incoming Request
 * monitor's three half-width cards, #5101). They share SummaryFacts now -
 * rows that follow the summary's own width (#5207's container query): one
 * fact a row on a phone, two to a row in the overview's card, four in
 * Monitoring Logs' wide View Summary dialog, at one screen width - and a
 * row the facts leave short is shared by the facts on it.
 *
 * What only a browser can tell is measured here: nothing in the card scrolls
 * sideways or runs past its card, how many facts share a row, that no row
 * ends in a hole, and the same at 390. The production overview
 * (Pages/Monitor/View) against the offline fixture (Fixture/Fixture.js),
 * with its network fence and its record of requests it does not model.
 */

const PORT: string = process.env["MONITOR_OVERVIEW_FIXTURE_PORT"] || "4223";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");

type MonitorTypeKey =
  | "api"
  | "website"
  | "ssl"
  | "incoming-request"
  | "incoming-email"
  | "server";

const MONITOR_NUMBER: Record<MonitorTypeKey, number> = {
  api: 1,
  website: 2,
  ssl: 3,
  "incoming-request": 4,
  "incoming-email": 5,
  server: 6,
};

const TYPES: Array<MonitorTypeKey> = [
  "api",
  "website",
  "ssl",
  "incoming-request",
  "incoming-email",
  "server",
];

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/monitor-overview-ui",
);

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function monitorPath(type: MonitorTypeKey): string {
  return `/dashboard/${PROJECT_ID}/monitors/70000000-0000-4000-8000-${String(
    MONITOR_NUMBER[type],
  ).padStart(12, "0")}`;
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

// The Monitor Summary card's body, once a monitor type's view is drawn in it.
async function openSummary(
  page: Page,
  type: MonitorTypeKey,
  query: string = "",
): Promise<Locator> {
  await page.clock.setFixedTime(NOW);
  await page.goto(
    `${monitorPath(type)}?type=${type}${query ? `&${query}` : ""}`,
  );
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });

  const body: Locator = page.getByTestId("monitor-summary-body");
  await expect(body).toBeVisible({ timeout: 60000 });
  await expect(body.getByTestId("monitor-summary-fact").first()).toBeVisible({
    timeout: 60000,
  });
  return body;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();

  expect(box, "the element is laid out").not.toBeNull();

  return box!;
}

// How many of a summary's fact cards share a row, at most.
async function mostFactsInARow(scope: Locator): Promise<number> {
  const tops: Array<number> = await scope
    .getByTestId("monitor-summary-fact")
    .evaluateAll((cards: Array<Element>): Array<number> => {
      return cards.map((card: Element): number => {
        return Math.round(card.getBoundingClientRect().y);
      });
    });
  const perRow: Map<number, number> = new Map<number, number>();

  for (const top of tops) {
    perRow.set(top, (perRow.get(top) || 0) + 1);
  }

  return Math.max(0, ...Array.from(perRow.values()));
}

/*
 * Nothing in the summary scrolls sideways or runs past the card it is in:
 * the body, every fact card, and whatever each card holds.
 */
async function expectEverythingFits(body: Locator): Promise<void> {
  const bodyOverflow: number = await body.evaluate(
    (element: Element): number => {
      return element.scrollWidth - element.clientWidth;
    },
  );
  expect(bodyOverflow, "the summary scrolls sideways").toBeLessThanOrEqual(1);

  const bodyBox: Box = await boxOf(body);
  const cards: Array<{ text: string; box: Box; overflow: number }> = await body
    .getByTestId("monitor-summary-fact")
    .evaluateAll(
      (
        elements: Array<Element>,
      ): Array<{ text: string; box: Box; overflow: number }> => {
        return elements.map(
          (element: Element): { text: string; box: Box; overflow: number } => {
            const rect: DOMRect = element.getBoundingClientRect();
            return {
              text: (element.textContent || "").trim(),
              box: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              },
              overflow: element.scrollWidth - element.clientWidth,
            };
          },
        );
      },
    );

  expect(cards.length).toBeGreaterThan(0);

  for (const card of cards) {
    expect(
      {
        card: card.text,
        insideTheSummary:
          card.box.x >= bodyBox.x - 1 &&
          card.box.x + card.box.width <= bodyBox.x + bodyBox.width + 1,
        overflow: card.overflow <= 1,
      },
      "a fact runs past the summary or its own card",
    ).toEqual({ card: card.text, insideTheSummary: true, overflow: true });
  }
}

/*
 * Every row of every group of facts ends at the group's right edge: a row
 * the facts leave short - the third of three, two to a row - is shared by
 * the facts on it, never a row that ends in a hole.
 */
async function expectNoRowEndsInAHole(scope: Locator): Promise<void> {
  const holes: Array<string> = await scope
    .getByTestId("monitor-summary-fact")
    .evaluateAll((cards: Array<Element>): Array<string> => {
      const groups: Array<Element> = Array.from(
        new Set(
          cards.map((card: Element): Element => {
            return card.parentElement as Element;
          }),
        ),
      );
      const found: Array<string> = [];

      for (const group of groups) {
        const groupBox: DOMRect = group.getBoundingClientRect();
        const rowEnds: Map<number, number> = new Map<number, number>();

        for (const card of Array.from(group.children)) {
          const box: DOMRect = card.getBoundingClientRect();
          const top: number = Math.round(box.y);

          rowEnds.set(top, Math.max(rowEnds.get(top) || 0, box.right));
        }

        for (const [top, right] of Array.from(rowEnds.entries())) {
          if (groupBox.right - right > 1) {
            found.push(
              `${group.getAttribute("data-testid")} row at ${top}: ${Math.round(
                groupBox.right - right,
              )}px empty`,
            );
          }
        }
      }

      return found;
    });

  expect(holes, "rows of facts that end in a hole").toEqual([]);
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const overflow: number = await page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
  expect(overflow, "the page does not scroll sideways").toBeLessThanOrEqual(0);
}

test.describe("the Monitor Summary card, for every monitor type the overview shows", () => {
  for (const type of TYPES) {
    test(`${type}: two facts to a row at 1280, nothing past the card`, async ({
      page,
    }: {
      page: Page;
    }) => {
      test.setTimeout(180000);
      await page.setViewportSize({ width: 1280, height: 900 });

      const body: Locator = await openSummary(page, type);

      await expectEverythingFits(body);
      await expectNoRowEndsInAHole(body);
      expect(await mostFactsInARow(body)).toBe(2);

      await screenshot(page, `monitor-summary-facts-${type}-1280`);
    });

    /*
     * Two to a row on a phone left each value about 100px, and broke
     * hostnames, dates and error codes mid-word: a phone gets one fact a
     * row, the whole of every value on it.
     */
    test(`${type}: fits a phone at 390, one fact a row`, async ({
      page,
    }: {
      page: Page;
    }) => {
      test.setTimeout(180000);
      await page.setViewportSize({ width: 390, height: 844 });

      const body: Locator = await openSummary(page, type);

      await noSidewaysScroll(page);
      await expectEverythingFits(body);
      await expectNoRowEndsInAHole(body);
      expect(await mostFactsInARow(body)).toBe(1);

      await screenshot(page, `monitor-summary-facts-${type}-390`);
    });
  }

  /*
   * Beside a tablet's side menu the Summary card is narrow (its summary
   * 366px wide at 768), yet wide enough for two facts to a row.
   */
  test("api at 768, beside the side menu: two facts to a row", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 768, height: 900 });

    const body: Locator = await openSummary(page, "api");

    await noSidewaysScroll(page);
    await expectEverythingFits(body);
    await expectNoRowEndsInAHole(body);
    expect(await mostFactsInARow(body)).toBe(2);
  });

  /*
   * The report behind #5101's note: an Incoming Request monitor's three
   * cards - when the last request came, its method, and the last check -
   * were each half the row wide, so the row ran a card past the card. On a
   * phone they go one under another.
   */
  test("incoming-request at 390: its three facts go one under another inside the card", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 390, height: 844 });

    const body: Locator = await openSummary(page, "incoming-request");
    const facts: Locator = body.getByTestId("monitor-summary-fact");

    await expect(facts).toHaveCount(3);

    const first: Box = await boxOf(facts.nth(0));
    const second: Box = await boxOf(facts.nth(1));
    const third: Box = await boxOf(facts.nth(2));

    expect(second.y).toBeGreaterThan(first.y + first.height - 1);
    expect(third.y).toBeGreaterThan(second.y + second.height - 1);
    expect(Math.abs(first.width - third.width)).toBeLessThan(1);
    await expectEverythingFits(body);
  });

  /*
   * Two to a row in the overview's card: the third of three takes the row
   * the first two leave, rather than half of it beside a hole.
   */
  test("incoming-request at 1280: its third fact takes the row the first two leave", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 1280, height: 900 });

    const body: Locator = await openSummary(page, "incoming-request");
    const facts: Locator = body.getByTestId("monitor-summary-fact");

    await expect(facts).toHaveCount(3);

    const first: Box = await boxOf(facts.nth(0));
    const second: Box = await boxOf(facts.nth(1));
    const third: Box = await boxOf(facts.nth(2));

    expect(Math.abs(first.y - second.y)).toBeLessThan(1);
    expect(third.y).toBeGreaterThan(first.y + first.height);
    expect(third.x).toBeLessThan(first.x + 1);
    expect(third.x + third.width).toBeGreaterThan(second.x + second.width - 1);
    await expectNoRowEndsInAHole(body);
  });

  test("api, offline: why the check failed comes right after what it found", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 1280, height: 900 });

    const body: Locator = await openSummary(page, "api", "state=offline");
    const errorFacts: Locator = body.getByTestId("monitor-summary-error-facts");

    await expect(errorFacts).toBeVisible();
    await expectEverythingFits(body);

    const facts: Box = await boxOf(
      body.getByTestId("monitor-summary-facts").first(),
    );
    const error: Box = await boxOf(errorFacts);
    expect(error.y).toBeGreaterThan(facts.y + facts.height - 1);

    // The error takes the whole row.
    const errorCard: Box = await boxOf(
      errorFacts.getByTestId("monitor-summary-fact").first(),
    );
    expect(errorCard.width).toBeGreaterThan(error.width - 2);

    await screenshot(page, "monitor-summary-facts-api-offline-1280");
  });

  test("server: its CPU, memory and disks open and fit at 390, a disk's facts one under another", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 390, height: 844 });

    const body: Locator = await openSummary(page, "server");
    await body.getByRole("button", { name: "Show More Details" }).click();
    await expect(body.getByText("CPU Cores")).toBeVisible();

    await noSidewaysScroll(page);
    await expectEverythingFits(body);

    await screenshot(page, "monitor-summary-facts-server-details-390");
  });

  test("dark mode keeps the facts on dark cards", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 390, height: 844 });

    const body: Locator = await openSummary(page, "website", "theme=dark");
    const card: Locator = body.getByTestId("monitor-summary-fact").first();
    const background: string = await card.evaluate(
      (element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      },
    );

    expect(background).not.toBe("rgb(255, 255, 255)");
    await expectEverythingFits(body);

    await screenshot(page, "monitor-summary-facts-website-dark-390");
  });

  /*
   * The same shared grid in Monitoring Logs' View Summary dialog: at the
   * same 1280px screen it is wide enough for four facts to a row. The
   * fixture's External Status Page monitor is the one whose logs carry what
   * each check found.
   */
  test("View Summary in Monitoring Logs puts four facts to a row in its wide dialog", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.clock.setFixedTime(NOW);
    await page.goto(
      `/dashboard/${PROJECT_ID}/monitors/70000000-0000-4000-8000-000000000011/logs?type=external-status-page`,
    );
    await expect(page.getByTestId("synthetic-banner")).toBeVisible({
      timeout: 60000,
    });

    await page
      .getByRole("button", { name: "View Summary" })
      .first()
      .click({ timeout: 60000 });
    const dialog: Locator = page.getByRole("dialog");
    await expect(
      dialog.getByTestId("monitor-summary-fact").first(),
    ).toBeVisible();

    expect(await mostFactsInARow(dialog)).toBe(4);
    await expectNoRowEndsInAHole(dialog);

    await screenshot(page, "monitor-summary-facts-view-summary-1280");
  });
});
