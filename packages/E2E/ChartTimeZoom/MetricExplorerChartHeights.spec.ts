import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";

/*
 * ISSUE #10043: ON A WIDE SCREEN THE METRICS EXPLORER DREW TWO CHARTS SIDE
 * BY SIDE TWICE AS TALL AS ONE.
 *
 * The explorer's charts are cards, two to a row from Tailwind's `lg` (1024px)
 * up and one to a row below it (ChartGroup). MetricView kept a minimum height
 * of 20rem per chart for the box the cards are drawn in, counted as if every
 * chart had a row of its own. Two charts side by side asked for 40rem, the
 * one row they share stretched to 40rem, and each card's plot grew with it:
 * twice a chart's height. Three charts asked for 60rem over two rows.
 *
 * Here the production explorer (Pages/Metrics/View) runs on the offline
 * fixture (Fixture/Fixture.js) with one to four queries, each on a chart of
 * its own, and every card is measured as the browser lays it out at 1280px,
 * 1024px and 390px: a card is as tall with three others beside or under it
 * as it is alone, its plot keeps the card's own 20rem (min-h-80), and the
 * cards sit two to a row from 1024px and one to a row on a phone.
 */

const PORT: string = process.env["CHART_TIME_ZOOM_FIXTURE_PORT"] || "4233";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");

const EXPLORER_PATH: string = `/dashboard/${PROJECT_ID}/metrics/view`;

// ChartGroup's chart card and the box its plot is drawn in.
const CARD_TEST_ID: string = "chart-group-card";
const CARD_PLOT_TEST_ID: string = "chart-group-card-plot";

// A card's plot keeps min-h-80: 20rem, 320px at the page's 16px rem.
const CARD_PLOT_HEIGHT_PX: number = 320;

// Pixels a measure may be off by: sub-pixel rounding, never a layout.
const TOLERANCE_PX: number = 2;

// Each width the issue names: two to a row at the first two, one on a phone.
const WIDTHS: Array<{ width: number; perRow: number }> = [
  { width: 1280, perRow: 2 },
  { width: 1024, perRow: 2 },
  { width: 390, perRow: 1 },
];

// Modelled metrics (Fixture/Fixture.js SERIES and METRIC_UNITS), one a chart.
const METRICS: Array<string> = [
  "system.cpu.utilization",
  "system.memory.utilization",
  "process.cpu.utilization",
  "system.filesystem.usage",
];

const VARIABLES: Array<string> = ["a", "b", "c", "d"];

interface SpecWindow {
  __chartTimeZoomFixture: {
    unhandled: Array<Record<string, unknown>>;
  };
}

interface CardBox {
  top: number;
  left: number;
  height: number;
  plotHeight: number;
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

  // The fixture's moment, and a clock that keeps ticking from it.
  await page.clock.install({ time: NOW });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    abortedRequests.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);

  const unhandled: Array<Record<string, unknown>> = await page
    .evaluate((): Array<Record<string, unknown>> => {
      const state: SpecWindow["__chartTimeZoomFixture"] | undefined = (
        window as unknown as Partial<SpecWindow>
      ).__chartTimeZoomFixture;
      return state
        ? (JSON.parse(JSON.stringify(state.unhandled)) as Array<
            Record<string, unknown>
          >)
        : [];
    })
    .catch((): Array<Record<string, unknown>> => {
      return [];
    });
  expect(unhandled, "requests the fixture does not model").toEqual([]);
});

// The explorer with `count` queries, each on a chart of its own.
function explorerPath(count: number): string {
  const queries: Array<Record<string, unknown>> = METRICS.slice(0, count).map(
    (metricName: string, index: number): Record<string, unknown> => {
      return {
        metricName: metricName,
        variable: VARIABLES[index],
        aggregationType: "Avg",
      };
    },
  );

  const search: URLSearchParams = new URLSearchParams({
    metricQueries: JSON.stringify(queries),
    range: "Past 30 Mins",
  });

  return `${EXPLORER_PATH}?${search.toString()}`;
}

async function openExplorer(page: Page, count: number): Promise<Locator> {
  await page.goto(explorerPath(count));

  const cards: Locator = page.getByTestId(CARD_TEST_ID);
  /*
   * The first load parses a large bundle. Every chart's series is drawn: an
   * area, the explorer's chart type for a query that names none.
   */
  await expect(cards).toHaveCount(count, { timeout: 60000 });
  await expect(page.locator(".recharts-area-curve")).toHaveCount(count, {
    timeout: 30000,
  });

  return cards;
}

// Every card as the browser lays it out, in the page's order.
async function measureCards(
  page: Page,
  width: number,
): Promise<Array<CardBox>> {
  await page.setViewportSize({ width: width, height: 900 });

  // The grid lays the cards out again, and recharts measures its new box.
  await page.waitForTimeout(400);

  return page.evaluate(
    ({
      cardTestId,
      plotTestId,
    }: {
      cardTestId: string;
      plotTestId: string;
    }): Array<CardBox> => {
      return Array.from(
        document.querySelectorAll(`[data-testid="${cardTestId}"]`),
      ).map((card: Element): CardBox => {
        const box: DOMRect = card.getBoundingClientRect();
        const plot: Element | null = card.querySelector(
          `[data-testid="${plotTestId}"]`,
        );

        return {
          top: box.top + window.scrollY,
          left: box.left,
          height: box.height,
          plotHeight: plot ? plot.getBoundingClientRect().height : 0,
        };
      });
    },
    { cardTestId: CARD_TEST_ID, plotTestId: CARD_PLOT_TEST_ID },
  );
}

test.describe("metrics explorer: a chart is as tall beside other charts as alone (#10043)", () => {
  test("one to four charts at 1280px, 1024px and 390px", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(240000);

    // A chart alone, at each width: the height every chart must keep.
    await openExplorer(page, 1);
    const aloneByWidth: Map<number, CardBox> = new Map();

    for (const { width } of WIDTHS) {
      const [alone] = await measureCards(page, width);

      expect(alone, `one chart at ${width}px`).toBeDefined();
      expect(
        Math.abs(alone!.plotHeight - CARD_PLOT_HEIGHT_PX),
        `one chart's plot at ${width}px: ${alone!.plotHeight}px`,
      ).toBeLessThanOrEqual(TOLERANCE_PX);
      aloneByWidth.set(width, alone!);
    }

    for (const count of [2, 3, 4]) {
      await openExplorer(page, count);

      for (const { width, perRow } of WIDTHS) {
        const cards: Array<CardBox> = await measureCards(page, width);
        const alone: CardBox = aloneByWidth.get(width)!;

        expect(cards, `${count} charts at ${width}px`).toHaveLength(count);

        cards.forEach((card: CardBox, index: number): void => {
          const where: string = `chart ${index + 1} of ${count} at ${width}px`;

          // Never stretched past the card's own plot height.
          expect
            .soft(
              Math.abs(card.plotHeight - CARD_PLOT_HEIGHT_PX),
              `${where}: its plot is ${card.plotHeight}px`,
            )
            .toBeLessThanOrEqual(TOLERANCE_PX);

          // As tall as a chart drawn alone at the same width.
          expect
            .soft(
              Math.abs(card.height - alone.height),
              `${where}: ${card.height}px, alone ${alone.height}px`,
            )
            .toBeLessThanOrEqual(TOLERANCE_PX);

          // Laid out two to a row from lg, one to a row on a phone.
          const row: number = Math.floor(index / perRow);
          const rowLead: CardBox = cards[row * perRow]!;

          expect
            .soft(
              Math.abs(card.top - rowLead.top),
              `${where}: on row ${row + 1}`,
            )
            .toBeLessThanOrEqual(TOLERANCE_PX);

          if (index > 0 && index % perRow === 0) {
            expect
              .soft(card.top, `${where}: under the row before it`)
              .toBeGreaterThan(cards[index - 1]!.top + TOLERANCE_PX);
          }
        });
      }
    }
  });
});
