import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";

/*
 * ISSUE #10042: AN OVERLAID QUERY IN ANOTHER KIND OF UNIT IS DRAWN AGAINST A
 * SECOND VALUE AXIS, ON THE CHART'S RIGHT.
 *
 * The production metrics explorer (Pages/Metrics/View) runs on the offline
 * fixture (Fixture/Fixture.js): CPU utilization, a 0-1 fraction the chart
 * draws in percent, with the nodes' memory usage in bytes overlaid on it.
 * Before, the bytes were drawn against the percent axis, far off its top,
 * under a warning that the units differ. Now, in a real browser at 1280px
 * and 390px:
 *
 *   - one chart with two value axes: percent on the left, bytes on the right,
 *     each tick written in its own unit, the right one past the plot's right
 *     edge;
 *   - the bytes line spans its axis rather than lying flat or off the plot;
 *   - the legend names each axis's unit and each series' axis, with no
 *     warning; and the card holds all of it, on a phone too.
 *
 * ISSUE #10079: every axis's neighbouring ticks read apart, the filesystem's
 * the issue saw read "17.2 GB" five times among them, and each axis is as
 * wide as its widest tick.
 *
 * ISSUE #10080: a third kind of unit (the host's processes, a count, on a
 * chart in percent and bytes) is drawn to a scale of its own: two axes, never
 * a third, the percent axis kept to percent, the processes' line spread over
 * the plot, its chip saying "Own scale", and the chart saying so.
 *
 * Screenshots (synthetic data) land in output/playwright/chart-time-zoom-ui.
 */

const PORT: string = process.env["CHART_TIME_ZOOM_FIXTURE_PORT"] || "4233";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");

const EXPLORER_PATH: string = `/dashboard/${PROJECT_ID}/metrics/view`;
const SCREENSHOT_DIRECTORY: string =
  "../../output/playwright/chart-time-zoom-ui";

const CARD_TEST_ID: string = "chart-group-card";
const AXIS_UNIT_TEST_ID: string = "metric-chart-axis-unit";
const SERIES_AXIS_TEST_ID: string = "metric-chart-series-axis";
const UNIT_MISMATCH_TEST_ID: string = "metric-chart-overlay-unit-mismatch";

const PERCENT_METRIC: string = "system.cpu.utilization";
const BYTES_METRIC: string = "k8s.node.memory.usage";
// About 70 processes on average: a count, a third kind of unit beside those.
const COUNT_METRIC: string = "system.processes.count";
// A filesystem at 17.2 GB on average, give or take a few bytes (#10079).
const FILESYSTEM_METRIC: string = "system.filesystem.usage";

interface SpecWindow {
  __chartTimeZoomFixture: {
    unhandled: Array<Record<string, unknown>>;
  };
}

interface AxisReading {
  ticks: Array<string>;
  left: number;
  right: number;
}

interface CurveReading {
  // Its colour, as the browser paints it.
  stroke: string;
  top: number;
  bottom: number;
}

interface ChartReading {
  axes: Array<AxisReading>;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  // Each series' drawn line, and each legend chip's colour by its series.
  curves: Array<CurveReading>;
  chipColorBySeries: Record<string, string>;
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

// The explorer drawing these metrics, each overlaid on the chart before it.
function explorerPath(metricNames: Array<string>): string {
  const search: URLSearchParams = new URLSearchParams({
    metricQueries: JSON.stringify(
      metricNames.map((metricName: string, index: number) => {
        return {
          metricName: metricName,
          variable: String.fromCharCode(97 + index),
          aggregationType: "Avg",
          ...(index > 0
            ? { chartType: "line", overlayWithPreviousQuery: true }
            : {}),
        };
      }),
    ),
    range: "Past 30 Mins",
  });

  return `${EXPLORER_PATH}?${search.toString()}`;
}

// CPU utilization, with the nodes' memory usage overlaid on its chart.
function overlaidPath(): string {
  return explorerPath([PERCENT_METRIC, BYTES_METRIC]);
}

// No two neighbouring ticks of an axis read alike (#10079).
function expectTicksApart(axis: AxisReading, name: string): void {
  expect(axis.ticks.length, `${name}'s ticks`).toBeGreaterThan(1);
  for (let index: number = 1; index < axis.ticks.length; index++) {
    expect(axis.ticks[index], `${name}'s tick ${index}`).not.toBe(
      axis.ticks[index - 1],
    );
  }
}

// The axes a chart draws, left first.
function axesLeftFirst(chart: ChartReading): Array<AxisReading> {
  return [...chart.axes].sort((a: AxisReading, b: AxisReading): number => {
    return a.left - b.left;
  });
}

// A series' line, found by its legend chip's colour.
function curveOfSeries(
  chart: ChartReading,
  seriesName: string,
): CurveReading | undefined {
  const color: string | undefined = chart.chipColorBySeries[seriesName];

  return color
    ? chart.curves.find((curve: CurveReading): boolean => {
        return curve.stroke === color;
      })
    : undefined;
}

// The card's content fits it, on a phone too.
async function expectCardFits(card: Locator): Promise<void> {
  const cardFit: { overflow: number; right: number; viewport: number } =
    await card.evaluate(
      (
        element: Element,
      ): { overflow: number; right: number; viewport: number } => {
        return {
          overflow: element.scrollWidth - element.clientWidth,
          right: element.getBoundingClientRect().right,
          viewport: document.documentElement.clientWidth,
        };
      },
    );

  expect(cardFit.overflow).toBeLessThanOrEqual(0);
  expect(cardFit.right).toBeLessThanOrEqual(cardFit.viewport);
}

async function readChart(card: Locator): Promise<ChartReading> {
  return card.evaluate((element: Element): ChartReading => {
    const plot: Element | null = element.querySelector(
      ".recharts-cartesian-grid",
    );
    const plotBox: DOMRect | undefined = plot?.getBoundingClientRect();

    return {
      // Each axis where its ticks are written, and what they say.
      axes: Array.from(
        element.querySelectorAll(".recharts-yAxis-tick-labels"),
      ).map((axis: Element): AxisReading => {
        const ticks: Array<Element> = Array.from(
          axis.querySelectorAll(".recharts-cartesian-axis-tick-value"),
        );
        const boxes: Array<DOMRect> = ticks.map((tick: Element): DOMRect => {
          return tick.getBoundingClientRect();
        });

        return {
          ticks: ticks.map((tick: Element): string => {
            return (tick.textContent || "").trim();
          }),
          left: Math.min(
            ...boxes.map((box: DOMRect): number => {
              return box.left;
            }),
          ),
          right: Math.max(
            ...boxes.map((box: DOMRect): number => {
              return box.right;
            }),
          ),
        };
      }),
      plotLeft: plotBox?.left || 0,
      plotRight: plotBox?.right || 0,
      plotTop: plotBox?.top || 0,
      plotBottom: plotBox?.bottom || 0,
      curves: Array.from(
        element.querySelectorAll(".recharts-area-curve, .recharts-line-curve"),
      ).map((curve: Element): CurveReading => {
        const box: DOMRect = curve.getBoundingClientRect();

        return {
          stroke: window.getComputedStyle(curve).stroke,
          top: box.top,
          bottom: box.bottom,
        };
      }),
      chipColorBySeries: Object.fromEntries(
        Array.from(element.querySelectorAll("button[title]"))
          .filter((chip: Element): boolean => {
            return (chip.getAttribute("title") || "").endsWith(
              " — click to hide",
            );
          })
          .map((chip: Element): [string, string] => {
            const dot: Element | null = chip.querySelector(
              "span[aria-hidden='true']",
            );

            return [
              (chip.getAttribute("title") || "").replace(
                " — click to hide",
                "",
              ),
              dot ? window.getComputedStyle(dot).backgroundColor : "",
            ];
          }),
      ),
    };
  });
}

test.describe("metrics explorer: bytes overlaid on percent get an axis of their own (#10042)", () => {
  for (const width of [1280, 390]) {
    test(`two value axes, each in its own unit, at ${width}px`, async ({
      page,
    }: {
      page: Page;
    }) => {
      test.setTimeout(180000);
      await page.setViewportSize({ width: width, height: 1000 });
      await page.goto(overlaidPath());

      const cards: Locator = page.getByTestId(CARD_TEST_ID);
      await expect(cards).toHaveCount(1, { timeout: 60000 });
      const card: Locator = cards.first();
      await expect(card.locator(".recharts-yAxis-tick-labels")).toHaveCount(2, {
        timeout: 30000,
      });
      await expect(
        card.locator(".recharts-area-curve, .recharts-line-curve"),
      ).toHaveCount(2, { timeout: 30000 });

      const chart: ChartReading = await readChart(card);
      const [left, right] = [...chart.axes].sort(
        (a: AxisReading, b: AxisReading): number => {
          return a.left - b.left;
        },
      );

      // Percent on the left of the plot, bytes past its right edge.
      expect(left!.right).toBeLessThanOrEqual(chart.plotLeft + 1);
      expect(right!.left).toBeGreaterThanOrEqual(chart.plotRight - 1);
      expect(left!.ticks.length).toBeGreaterThan(1);
      expect(right!.ticks.length).toBeGreaterThan(1);
      for (const tick of left!.ticks) {
        expect(tick, "a left tick").toMatch(/%$/);
      }
      for (const tick of right!.ticks) {
        expect(tick, "a right tick").toMatch(/(^0|B)$/);
      }
      // Each axis's neighbouring ticks read apart (#10079).
      expectTicksApart(left!, "the left axis");
      expectTicksApart(right!, "the right axis");

      /*
       * The bytes line, found by its legend chip's colour, is read on its
       * own axis: inside the plot, and spread over it rather than flat at
       * an edge, as it lay on the percent axis.
       */
      const bytesColor: string | undefined =
        chart.chipColorBySeries[BYTES_METRIC];
      const bytesCurve: CurveReading | undefined = chart.curves.find(
        (curve: CurveReading): boolean => {
          return curve.stroke === bytesColor;
        },
      );
      const plotHeight: number = chart.plotBottom - chart.plotTop;

      expect(bytesColor, "the bytes chip's colour").toBeTruthy();
      expect(bytesCurve, "the bytes line").toBeDefined();
      expect(bytesCurve!.top).toBeGreaterThanOrEqual(chart.plotTop - 2);
      expect(bytesCurve!.bottom).toBeLessThanOrEqual(chart.plotBottom + 2);
      expect(bytesCurve!.bottom - bytesCurve!.top).toBeGreaterThan(
        plotHeight * 0.25,
      );

      // The legend: each axis's unit, each series' axis, and no warning.
      await expect(card.getByTestId(AXIS_UNIT_TEST_ID)).toHaveText([
        "Left axis: Percent",
        "Right axis: Bytes",
      ]);
      await expect(
        card
          .getByRole("button", { name: new RegExp(BYTES_METRIC) })
          .getByTestId(SERIES_AXIS_TEST_ID),
      ).toHaveText("Right axis");
      await expect(
        card
          .getByRole("button", { name: new RegExp(PERCENT_METRIC) })
          .getByTestId(SERIES_AXIS_TEST_ID),
      ).toHaveText("Left axis");
      await expect(card.getByTestId(UNIT_MISMATCH_TEST_ID)).toHaveCount(0);

      /*
       * The chart, its two axes and its legend fit the card, on a phone
       * too: nothing in it runs past its edge. (The explorer's toolbar
       * above it is wider than a phone on main, #6089.)
       */
      const cardFit: { overflow: number; right: number; viewport: number } =
        await card.evaluate(
          (
            element: Element,
          ): { overflow: number; right: number; viewport: number } => {
            return {
              overflow: element.scrollWidth - element.clientWidth,
              right: element.getBoundingClientRect().right,
              viewport: document.documentElement.clientWidth,
            };
          },
        );
      expect(cardFit.overflow).toBeLessThanOrEqual(0);
      expect(cardFit.right).toBeLessThanOrEqual(cardFit.viewport);

      await card.scrollIntoViewIfNeeded();
      await card.screenshot({
        path: `${SCREENSHOT_DIRECTORY}/metric-explorer-second-axis-${width}-synthetic.png`,
      });
    });
  }
});

test.describe("metrics explorer: a value axis over a narrow range reads apart (#10079)", () => {
  for (const width of [1280, 390]) {
    test(`the issue's filesystem: no two neighbouring ticks alike, none cut, at ${width}px`, async ({
      page,
    }: {
      page: Page;
    }) => {
      test.setTimeout(180000);
      await page.setViewportSize({ width: width, height: 1000 });
      await page.goto(explorerPath([FILESYSTEM_METRIC]));

      const cards: Locator = page.getByTestId(CARD_TEST_ID);
      await expect(cards).toHaveCount(1, { timeout: 60000 });
      const card: Locator = cards.first();
      await expect(card.locator(".recharts-yAxis-tick-labels")).toHaveCount(1, {
        timeout: 30000,
      });
      await expect(
        card.locator(
          ".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value",
        ),
      ).not.toHaveCount(0, { timeout: 30000 });

      const chart: ChartReading = await readChart(card);
      const [axis] = axesLeftFirst(chart);

      // It read "17.2 GB" five times; now each tick is its own.
      expectTicksApart(axis!, "the filesystem's axis");
      for (const tick of axis!.ticks) {
        expect(tick, "a filesystem tick").toMatch(/^\d+\.\d+\s?GB$/);
      }

      /*
       * Its axis is as wide as its widest tick: every tick inside the card,
       * left of the plot, on a phone too.
       */
      const cardLeft: number = await card.evaluate(
        (element: Element): number => {
          return element.getBoundingClientRect().left;
        },
      );
      expect(axis!.left).toBeGreaterThanOrEqual(cardLeft);
      expect(axis!.right).toBeLessThanOrEqual(chart.plotLeft + 1);
      await expectCardFits(card);

      await card.scrollIntoViewIfNeeded();
      await card.screenshot({
        path: `${SCREENSHOT_DIRECTORY}/metric-explorer-narrow-axis-${width}-synthetic.png`,
      });
    });
  }
});

test.describe("metrics explorer: a third kind of unit is drawn to a scale of its own (#10080)", () => {
  for (const width of [1280, 390]) {
    test(`two axes, never a third, and the processes' line on its own scale, at ${width}px`, async ({
      page,
    }: {
      page: Page;
    }) => {
      test.setTimeout(180000);
      await page.setViewportSize({ width: width, height: 1000 });
      await page.goto(
        explorerPath([PERCENT_METRIC, BYTES_METRIC, COUNT_METRIC]),
      );

      const cards: Locator = page.getByTestId(CARD_TEST_ID);
      await expect(cards).toHaveCount(1, { timeout: 60000 });
      const card: Locator = cards.first();
      await expect(card.locator(".recharts-yAxis-tick-labels")).toHaveCount(2, {
        timeout: 30000,
      });
      await expect(
        card.locator(
          '.recharts-line-curve:not([stroke="transparent"]), .recharts-area-curve',
        ),
      ).toHaveCount(3, { timeout: 30000 });

      const chart: ChartReading = await readChart(card);
      const [left, right] = axesLeftFirst(chart);

      // Two axes, each in its own unit; no axis writes the processes' count.
      expect(chart.axes).toHaveLength(2);
      for (const tick of left!.ticks) {
        expect(tick, "a left tick").toMatch(/%$/);
        // The percent axis is never pulled up to thousands (it read 7,000%).
        expect(
          Number(tick.replace(/[^0-9.]/g, "")),
          "a left tick's percent",
        ).toBeLessThanOrEqual(100);
      }
      for (const tick of right!.ticks) {
        expect(tick, "a right tick").toMatch(/(^0|B)$/);
      }
      expectTicksApart(left!, "the left axis");
      expectTicksApart(right!, "the right axis");

      // The processes' line keeps its shape over the plot, on its own scale.
      const countCurve: CurveReading | undefined = curveOfSeries(
        chart,
        COUNT_METRIC,
      );
      const plotHeight: number = chart.plotBottom - chart.plotTop;

      expect(countCurve, "the processes' line").toBeDefined();
      expect(countCurve!.top).toBeGreaterThanOrEqual(chart.plotTop - 2);
      expect(countCurve!.bottom).toBeLessThanOrEqual(chart.plotBottom + 2);
      expect(countCurve!.bottom - countCurve!.top).toBeGreaterThan(
        plotHeight * 0.25,
      );

      // The legend and the chart say so.
      await expect(card.getByTestId(AXIS_UNIT_TEST_ID)).toHaveText([
        "Left axis: Percent",
        "Right axis: Bytes",
        /^Own scale: /,
      ]);
      await expect(
        card
          .getByRole("button", { name: new RegExp(COUNT_METRIC) })
          .getByTestId(SERIES_AXIS_TEST_ID),
      ).toHaveText("Own scale");
      await expect(card.getByTestId(UNIT_MISMATCH_TEST_ID)).toContainText(
        "is drawn to a scale of its own, with no axis",
      );
      await expectCardFits(card);

      await card.scrollIntoViewIfNeeded();
      await card.screenshot({
        path: `${SCREENSHOT_DIRECTORY}/metric-explorer-own-scale-${width}-synthetic.png`,
      });
    });
  }
});
