import { expect, Locator, Page, test, TestInfo } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Metrics' Insights tab: the services reporting metrics, a card each
 * (Components/Metrics/MetricsDashboard), against the offline fixture
 * (Fixture/Fixture.js and Fixture/MetricsInsights.js): the page is the
 * production component; only its reads are synthetic.
 *
 * #5256 made the cards of a row end on one line and was checked in code
 * only. Drawn at every width here - 1440, 1280, 1024 and 768 on the laptop
 * project, 390 on the phone - light and dark, with the names a small
 * project gives its services and metrics and the names a large estate does
 * (?insights=long: services named storefront-checkout-service-eu-west-1-
 * production, metric names of sixty characters with no space in them).
 *
 * What it found, and what changed: a long metric name ran past its card and
 * the page scrolled sideways (at 1024, 1,231px wide; on a phone, 594); a
 * long service name took three lines beside its System and App pills, so a
 * row's counts started on three lines; and each card was a link with
 * another link inside it (the service's name), which React warns about and
 * a screen reader reads as two.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-24T12:00:00.000Z");
const INSIGHTS: string = `/dashboard/${PROJECT_ID}/metrics/insights`;

const SERVICE_IDS: Record<string, string> = {
  checkout: "52310000-0000-4000-8000-0000000000a1",
  worker: "52310000-0000-4000-8000-0000000000a2",
  payments: "52310000-0000-4000-8000-0000000000a3",
  frontend: "52310000-0000-4000-8000-0000000000a4",
  inventory: "52310000-0000-4000-8000-0000000000a5",
  search: "52310000-0000-4000-8000-0000000000a6",
  notifications: "52310000-0000-4000-8000-0000000000a7",
};

// The busiest first, as the page orders them; the unattributed points last.
const SHORT_NAMES: Array<string> = [
  "checkout",
  "worker",
  "payments",
  "frontend-web",
  "inventory",
  "search",
  "notifications",
  "Unknown Service",
];

const LONG_PAYMENTS: string =
  "storefront-payments-gateway-eu-west-1-production";
const LONG_METRIC: string =
  "com.acme.storefront.checkout.payment_authorization.gateway_round_trip_milliseconds";

const LAPTOP_WIDTHS: Array<number> = [1440, 1280, 1024, 768];

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/metrics-ai-ui",
);

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface CardMeasure {
  // The service's whole name, from the name's title.
  name: string;
  // What the name shows: its text, every character of it.
  shownName: string;
  href: string;
  box: Box;
  // The tops of the card's three rows: the service, its figures, its names.
  rowTops: Array<number>;
  nameHeight: number;
  nameLineHeight: number;
  isNameClamped: boolean;
  // Whatever in the card reaches past its padding, by its words.
  overflowing: Array<string>;
  // Links inside the card's own link.
  nestedLinks: number;
  background: string;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });
  page.on("console", (message: { type: () => string; text: () => string }) => {
    // React's DOM nesting warnings - a link in a link - arrive as errors.
    if (
      message.type() === "error" &&
      message.text().includes("validateDOMNesting")
    ) {
      errors.push(message.text());
    }
  });
  await page.clock.setFixedTime(NOW);
});

test.afterEach(({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
});

function isPhone(testInfo: TestInfo): boolean {
  return testInfo.project.name === "phone";
}

// The widths a project draws the page at.
function widthsFor(testInfo: TestInfo): Array<number> {
  return isPhone(testInfo) ? [390] : LAPTOP_WIDTHS;
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
    await new Promise<void>((resolve: () => void) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  });
}

async function open(page: Page, query: string = ""): Promise<void> {
  await page.goto(`${INSIGHTS}${query ? `?${query}` : ""}`);
  await expect(page.getByTestId("metrics-service-card")).toHaveCount(
    SHORT_NAMES.length,
  );
  await settle(page);
}

async function atWidth(page: Page, width: number): Promise<void> {
  await page.setViewportSize({
    width: width,
    height: page.viewportSize()?.height || 900,
  });
  await settle(page);
}

// Every card, measured in one frame.
async function measureCards(page: Page): Promise<Array<CardMeasure>> {
  return page.evaluate((): Array<CardMeasure> => {
    const boxOf: (element: Element) => Box = (element: Element): Box => {
      const rect: DOMRect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    };

    return Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="metrics-service-card"]',
      ),
    ).map((card: HTMLElement): CardMeasure => {
      const style: CSSStyleDeclaration = getComputedStyle(card);
      const box: Box = boxOf(card);
      const inner: Box = {
        left: box.left + parseFloat(style.paddingLeft),
        right: box.right - parseFloat(style.paddingRight),
        top: box.top,
        bottom: box.bottom,
      };
      const name: HTMLElement = card.querySelector<HTMLElement>(
        '[data-testid="metrics-service-card-name"]',
      )!;
      const link: HTMLAnchorElement | null = card.closest("a");
      const overflowing: Array<string> = [];

      for (const element of Array.from(card.querySelectorAll("*"))) {
        const rect: DOMRect = element.getBoundingClientRect();

        if (rect.width === 0 && rect.height === 0) {
          continue;
        }

        if (rect.left < inner.left - 0.5 || rect.right > inner.right + 0.5) {
          overflowing.push((element.textContent || "").slice(0, 80));
        }
      }

      return {
        name: name.getAttribute("title") || "",
        shownName: name.textContent || "",
        href: link ? link.getAttribute("href") || "" : "",
        box: box,
        rowTops: Array.from(card.children).map((row: Element): number => {
          return row.getBoundingClientRect().top;
        }),
        nameHeight: name.getBoundingClientRect().height,
        nameLineHeight: parseFloat(getComputedStyle(name).lineHeight),
        isNameClamped: name.scrollHeight > name.clientHeight + 1,
        overflowing: overflowing,
        nestedLinks: link ? link.querySelectorAll("a").length : -1,
        background: style.backgroundColor,
      };
    });
  });
}

// The cards, a row of the grid at a time: those whose tops are level.
function rowsOf(cards: Array<CardMeasure>): Array<Array<CardMeasure>> {
  const rows: Array<Array<CardMeasure>> = [];

  for (const card of cards) {
    const row: Array<CardMeasure> | undefined = rows.find(
      (candidate: Array<CardMeasure>): boolean => {
        return Math.abs(candidate[0]!.box.top - card.box.top) <= 1;
      },
    );

    if (row) {
      row.push(card);
    } else {
      rows.push([card]);
    }
  }

  return rows;
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow: number = await page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
  expect(overflow).toBeLessThanOrEqual(0);
}

async function screenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(
      SCREENSHOTS,
      `insights-${name}-${testInfo.project.name}-synthetic.png`,
    ),
    fullPage: true,
    animations: "disabled",
  });
}

test.describe("Metrics > Insights: the services reporting metrics", () => {
  test("a card each, the busiest first, and the points no service sent last", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    const cards: Array<CardMeasure> = await measureCards(page);

    expect(
      cards.map((card: CardMeasure): string => {
        return card.name;
      }),
    ).toEqual(SHORT_NAMES);
    // Each name drawn whole.
    expect(
      cards.map((card: CardMeasure): string => {
        return card.shownName;
      }),
    ).toEqual(SHORT_NAMES);

    const checkout: Locator = page.getByTestId("metrics-service-card").first();

    await expect(checkout).toContainText("14");
    await expect(
      checkout.getByTestId("metrics-service-card-metric"),
    ).toHaveCount(6);
    await expect(checkout.getByTestId("metrics-service-card-more")).toHaveText(
      "+8 more",
    );
    await expect(checkout).toContainText("System");
    await expect(checkout).toContainText("App");
  });

  test("each card is one link: to the service's metrics, the unattributed points' to the viewer", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    const cards: Array<CardMeasure> = await measureCards(page);

    for (const card of cards) {
      // No link inside the card's own: the name is not one any more.
      expect({ name: card.name, nested: card.nestedLinks }).toEqual({
        name: card.name,
        nested: 0,
      });
    }

    expect(cards[0]!.href).toBe(
      `/dashboard/${PROJECT_ID}/service/${SERVICE_IDS["checkout"]}/metrics`,
    );
    expect(cards[cards.length - 1]!.href).toBe(
      `/dashboard/${PROJECT_ID}/metrics`,
    );
  });

  for (const scenario of ["busy", "long"]) {
    test(`${scenario} names: the cards of a row end on one line, and their counts and names start on one line, at every width`, async ({
      page,
    }: {
      page: Page;
    }, testInfo: TestInfo) => {
      await open(page, `insights=${scenario}`);

      for (const width of widthsFor(testInfo)) {
        await atWidth(page, width);

        const rows: Array<Array<CardMeasure>> = rowsOf(
          await measureCards(page),
        );

        // Three a row from 1024 (lg), two from 768 (md), one on a phone.
        const columns: number = width >= 1024 ? 3 : width >= 768 ? 2 : 1;

        expect({ width, firstRow: rows[0]!.length }).toEqual({
          width,
          firstRow: columns,
        });

        for (const row of rows) {
          const first: CardMeasure = row[0]!;

          for (const card of row) {
            expect({
              width,
              name: card.name,
              bottom: Math.round(card.box.bottom),
              rows: card.rowTops.map(Math.round),
            }).toEqual({
              width,
              name: card.name,
              bottom: Math.round(first.box.bottom),
              rows: first.rowTops.map(Math.round),
            });
          }
        }
      }
    });

    test(`${scenario} names: nothing in a card runs past it, and nothing scrolls sideways, at every width`, async ({
      page,
    }: {
      page: Page;
    }, testInfo: TestInfo) => {
      await open(page, `insights=${scenario}`);

      for (const width of widthsFor(testInfo)) {
        await atWidth(page, width);
        await expectNoSidewaysScroll(page);

        for (const card of await measureCards(page)) {
          expect({ width, name: card.name, past: card.overflowing }).toEqual({
            width,
            name: card.name,
            past: [],
          });
        }
      }
    });
  }

  test("a long service name takes two lines at most, its whole name under the pointer", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await open(page, "insights=long");

    for (const width of widthsFor(testInfo)) {
      await atWidth(page, width);

      for (const card of await measureCards(page)) {
        expect({
          width,
          name: card.name,
          lines: Math.round(card.nameHeight / card.nameLineHeight),
        }).toEqual({
          width,
          name: card.name,
          lines: Math.min(
            2,
            Math.max(1, Math.round(card.nameHeight / card.nameLineHeight)),
          ),
        });
      }
    }

    // Where two lines do not hold it, it ends in an ellipsis; its title is whole.
    await atWidth(page, isPhone(testInfo) ? 390 : 1024);

    const payments: CardMeasure | undefined = (await measureCards(page)).find(
      (card: CardMeasure): boolean => {
        return card.name === LONG_PAYMENTS;
      },
    );

    expect(payments).toBeDefined();
    expect(payments!.shownName).toBe(LONG_PAYMENTS);

    if (!isPhone(testInfo)) {
      expect(payments!.isNameClamped).toBe(true);
    }
  });

  test("a metric's name of sixty characters wraps inside its chip, after its own dots", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await open(page, "insights=long");
    await atWidth(page, isPhone(testInfo) ? 390 : 1024);

    const chip: Locator = page
      .getByTestId("metrics-service-card-metric")
      .filter({ hasText: LONG_METRIC });

    await expect(chip).toHaveCount(1);
    // Every character, as written: a break adds none.
    await expect(chip).toHaveText(LONG_METRIC);

    const lines: Array<string> = await chip.evaluate(
      (element: HTMLElement): Array<string> => {
        // The text of each line the chip draws, read off its line boxes.
        const range: Range = document.createRange();
        const tops: Map<number, string> = new Map();
        const walker: TreeWalker = document.createTreeWalker(
          element,
          NodeFilter.SHOW_TEXT,
        );
        let node: Node | null = walker.nextNode();

        while (node) {
          const text: string = node.textContent || "";

          for (let index: number = 0; index < text.length; index++) {
            range.setStart(node, index);
            range.setEnd(node, index + 1);
            const top: number = Math.round(range.getBoundingClientRect().top);
            tops.set(top, (tops.get(top) || "") + text.charAt(index));
          }

          node = walker.nextNode();
        }

        return Array.from(tops.entries())
          .sort((a: [number, string], b: [number, string]): number => {
            return a[0] - b[0];
          })
          .map((entry: [number, string]): string => {
            return entry[1];
          });
      },
    );

    expect(lines.length).toBeGreaterThan(1);
    // Each line but the last ends at one of the name's own dots.
    for (const line of lines.slice(0, -1)) {
      expect(line.endsWith(".")).toBe(true);
    }
    expect(lines.join("")).toBe(LONG_METRIC);
  });

  test("in the dark theme every card is a dark card, and the rows still end on one line", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await open(page, "theme=dark");

    const cards: Array<CardMeasure> = await measureCards(page);

    for (const card of cards) {
      expect({ name: card.name, background: card.background }).not.toEqual({
        name: card.name,
        background: "rgb(255, 255, 255)",
      });
    }

    for (const row of rowsOf(cards)) {
      for (const card of row) {
        expect(Math.round(card.box.bottom)).toBe(
          Math.round(row[0]!.box.bottom),
        );
      }
    }

    await screenshot(page, testInfo, "dark");
  });

  test("screenshots: a small project and a large estate", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await open(page);
    await atWidth(page, isPhone(testInfo) ? 390 : 1280);
    await screenshot(page, testInfo, "busy");

    await open(page, "insights=long");
    await atWidth(page, isPhone(testInfo) ? 390 : 1024);
    await screenshot(page, testInfo, "long");
  });

  test("no metrics in the range says so, and a read that fails says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${INSIGHTS}?insights=empty`);
    await expect(page.getByText("No metrics in the past 1 hour")).toBeVisible();
    await expect(page.getByTestId("metrics-service-card")).toHaveCount(0);

    await page.goto(`${INSIGHTS}?fail=metrics`);
    await expect(
      page.getByText("The metrics could not be read."),
    ).toBeVisible();
    await expect(page.getByTestId("metrics-service-card")).toHaveCount(0);
  });
});
