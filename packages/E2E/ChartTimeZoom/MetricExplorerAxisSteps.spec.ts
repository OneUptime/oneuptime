import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
  TestInfo,
} from "@playwright/test";
import { NO_BREAK_SPACE, withSpacesShown } from "../SuiteHelpers/NoBreakSpaces";

/*
 * ISSUES #10117 AND #10118: EVERY VALUE AXIS STEPS EVENLY, IN ROUND STEPS OF
 * THE UNIT IT IS WRITTEN IN; A DURATION AXIS IN NATURAL UNITS OF TIME.
 *
 * The production metrics explorer (Pages/Metrics/View) on the offline
 * fixture (Fixture/Fixture.js), in a real browser at 1280px and 390px:
 *
 *   - #10117: the nodes' memory, overlaid on CPU utilization, read "7.57
 *     GB", "7.65 GB", "7.74 GB" on its right axis, recharts' 85 MB steps
 *     written to three figures. Each axis now steps evenly in a round step
 *     of the unit its ticks are written in, with the fewest figures that
 *     step needs, and the line still fills its plot.
 *   - #10118: the gateway's nightly batch job, an hour and a half give or
 *     take two seconds, read "1.5000 hours", "1.5003 hours". Its axis is a
 *     clock now, a second a tick; on the right of a percent chart too. The
 *     host's uptime of twelve days reads "12 d 05:00", ten minutes a tick.
 *
 * Every tick is inside the card, left of the plot (or right of it, for the
 * right axis). The blank space above each line is measured and kept under
 * half the plot. Screenshots (synthetic data) land in
 * output/playwright/chart-time-zoom-ui.
 */

const PORT: string = process.env["CHART_TIME_ZOOM_FIXTURE_PORT"] || "4233";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");

const EXPLORER_PATH: string = `/dashboard/${PROJECT_ID}/metrics/view`;
const SCREENSHOT_DIRECTORY: string =
  "../../output/playwright/chart-time-zoom-ui";

const CARD_TEST_ID: string = "chart-group-card";

const PERCENT_METRIC: string = "system.cpu.utilization";
const BYTES_METRIC: string = "k8s.node.memory.usage";
// An hour and a half, give or take two seconds (#10118).
const JOB_METRIC: string = "batch.job.duration";
// Twelve days and five hours at the window's start, counting up.
const UPTIME_METRIC: string = "system.uptime";

interface SpecWindow {
  __chartTimeZoomFixture: {
    unhandled: Array<Record<string, unknown>>;
  };
}

interface AxisReading {
  ticks: Array<string>;
  // Where each tick is drawn, down the chart.
  tickCenters: Array<number>;
  left: number;
  right: number;
}

interface ChartReading {
  axes: Array<AxisReading>;
  cardLeft: number;
  cardRight: number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  // The top of the highest drawn line.
  highestLineTop: number;
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

async function readChart(card: Locator): Promise<ChartReading> {
  return card.evaluate((element: Element): ChartReading => {
    const plotBox: DOMRect | undefined = element
      .querySelector(".recharts-cartesian-grid")
      ?.getBoundingClientRect();
    const curves: Array<DOMRect> = Array.from(
      element.querySelectorAll(
        '.recharts-line-curve:not([stroke="transparent"]), .recharts-area-curve',
      ),
    ).map((curve: Element): DOMRect => {
      return curve.getBoundingClientRect();
    });

    return {
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
          // Where recharts puts each tick: its text's own y, as the axis drew it.
          tickCenters: ticks.map((tick: Element): number => {
            return Number(tick.getAttribute("y") || 0);
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
      cardLeft: element.getBoundingClientRect().left,
      cardRight: element.getBoundingClientRect().right,
      plotLeft: plotBox?.left || 0,
      plotRight: plotBox?.right || 0,
      plotTop: plotBox?.top || 0,
      plotBottom: plotBox?.bottom || 0,
      highestLineTop: Math.min(
        ...curves.map((box: DOMRect): number => {
          return box.top;
        }),
      ),
    };
  });
}

// The axes a chart draws, left first.
function axesLeftFirst(chart: ChartReading): Array<AxisReading> {
  return [...chart.axes].sort((a: AxisReading, b: AxisReading): number => {
    return a.left - b.left;
  });
}

// What one of a byte tick's figures stands for.
const BYTE_UNITS: Record<string, number> = {
  B: 1,
  KB: 1e3,
  MB: 1e6,
  GB: 1e9,
  TB: 1e12,
};

interface ReadFigure {
  // The value, in the axis's unit.
  value: number;
  // The figures after the point it is written with.
  decimals: number;
  // What one of the figures of the unit it is written in stands for.
  unitScale: number;
}

// "7.6 GB" is 7.6e9 bytes; "25%" is 25.
function readFigure(tick: string): ReadFigure {
  const match: RegExpExecArray | null = new RegExp(
    `^(-?\\d+)(?:\\.(\\d+))?(?:${NO_BREAK_SPACE}(B|KB|MB|GB|TB)|(%))$`,
  ).exec(tick);

  if (!match) {
    throw new Error(
      `Not a tick of a byte or percent axis: ${withSpacesShown(tick)}`,
    );
  }

  const fraction: string = match[2] || "";
  const unitScale: number = match[4]
    ? 1
    : (BYTE_UNITS[match[3] || "B"] as number);

  return {
    value: Number(`${match[1]}${fraction ? `.${fraction}` : ""}`) * unitScale,
    decimals: fraction.length,
    unitScale: unitScale,
  };
}

// "1:30:02" and "12 d 05:30" in seconds.
function readClock(tick: string): number {
  const match: RegExpExecArray | null = new RegExp(
    `^(?:(\\d+)${NO_BREAK_SPACE}d${NO_BREAK_SPACE})?(\\d+):(\\d{2})(?::(\\d{2}))?$`,
  ).exec(tick);

  if (!match) {
    throw new Error(`Not a clock: ${withSpacesShown(tick)}`);
  }

  return (
    Number(match[1] || 0) * 86400 +
    Number(match[2]) * 3600 +
    Number(match[3]) * 60 +
    Number(match[4] || 0)
  );
}

// A step's first figures: 2.5 for 0.025.
function mantissaOf(step: number): number {
  return Number(
    (step / Math.pow(10, Math.floor(Math.log10(step)))).toPrecision(6),
  );
}

// The figures after the point a round step needs: 1 for 0.5, 2 for 0.25.
function decimalsOf(step: number): number {
  const written: string = String(Number(step.toPrecision(6)));

  return (written.split(".")[1] || "").length;
}

// The ticks read apart, each a step from the one below it, drawn evenly.
function expectEvenSteps(
  axis: AxisReading,
  values: Array<number>,
  name: string,
): number {
  expect(axis.ticks.length, `${name}'s ticks`).toBeGreaterThanOrEqual(3);
  expect(axis.ticks.length, `${name}'s ticks`).toBeLessThanOrEqual(6);

  // Drawn bottom up: read them in the order of their values.
  const order: Array<number> = values
    .map((_value: number, index: number): number => {
      return index;
    })
    .sort((a: number, b: number): number => {
      return values[a]! - values[b]!;
    });
  const sorted: Array<number> = order.map((index: number): number => {
    return values[index]!;
  });
  const step: number = sorted[1]! - sorted[0]!;

  for (let index: number = 1; index < sorted.length; index++) {
    expect(
      Math.abs(sorted[index]! - sorted[index - 1]! - step),
      `${name}: ${axis.ticks.join(" | ")} step evenly`,
    ).toBeLessThanOrEqual(Math.abs(step) * 1e-6);
  }

  /*
   * Drawn evenly too: as far apart on the chart as in value. Recharts moves
   * the label of a tick at the plot's very edge a few pixels in, so it is
   * not cut: the ticks between keep to the spacing exactly, those at the
   * ends within half a label.
   */
  const centers: Array<number> = order.map((index: number): number => {
    return axis.tickCenters[index]!;
  });
  const spacing: number = centers[1]! - centers[2]!;
  for (let index: number = 1; index < centers.length; index++) {
    const isEdge: boolean = index === 1 || index === centers.length - 1;

    expect(
      Math.abs(centers[index - 1]! - centers[index]! - spacing),
      `${name}'s ticks are drawn evenly: ${axis.ticks.join(" | ")} at ${axis.tickCenters.join(", ")}`,
    ).toBeLessThanOrEqual(isEdge ? 5 : 0.5);
  }

  return step;
}

// Every tick inside the card, on its side of the plot.
function expectTicksInside(
  chart: ChartReading,
  axis: AxisReading,
  side: "left" | "right",
): void {
  expect(axis.left).toBeGreaterThanOrEqual(chart.cardLeft);
  expect(axis.right).toBeLessThanOrEqual(chart.cardRight);
  if (side === "left") {
    expect(axis.right).toBeLessThanOrEqual(chart.plotLeft + 1);
  } else {
    expect(axis.left).toBeGreaterThanOrEqual(chart.plotRight - 1);
  }
}

/*
 * The blank space above the highest line, as a share of the plot: what a
 * round step's top tick costs (#10117). Recorded on the test, and kept
 * under half the plot.
 */
function expectLittleBlankAbove(
  chart: ChartReading,
  testInfo: TestInfo,
  name: string,
): void {
  const plotHeight: number = chart.plotBottom - chart.plotTop;
  const blank: number = (chart.highestLineTop - chart.plotTop) / plotHeight;

  testInfo.annotations.push({
    type: "blank space above the line",
    description: `${name}: ${(blank * 100).toFixed(1)}% of a ${plotHeight.toFixed(0)}px plot`,
  });
  expect(blank, `${name}: the blank space above the line`).toBeLessThan(0.5);
  expect(blank).toBeGreaterThanOrEqual(-0.02);
}

async function openChart(
  page: Page,
  path: string,
  axes: number,
): Promise<Locator> {
  await page.goto(path);

  const cards: Locator = page.getByTestId(CARD_TEST_ID);
  await expect(cards).toHaveCount(1, { timeout: 60000 });
  const card: Locator = cards.first();
  await expect(card.locator(".recharts-yAxis-tick-labels")).toHaveCount(axes, {
    timeout: 30000,
  });
  await expect(
    card.locator(
      ".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value",
    ),
  ).not.toHaveCount(0, { timeout: 30000 });
  // Recharts draws a line in: read the chart once it has stopped.
  await page.waitForTimeout(800);

  return card;
}

async function expectCardFits(card: Locator): Promise<void> {
  const fit: { overflow: number; right: number; viewport: number } =
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

  expect(fit.overflow).toBeLessThanOrEqual(0);
  expect(fit.right).toBeLessThanOrEqual(fit.viewport);
}

test.describe("metrics explorer: every value axis steps evenly in round steps (#10117)", () => {
  for (const width of [1280, 390]) {
    test(`the nodes' memory beside CPU utilization: a round step of each axis's unit, at ${width}px`, async ({
      page,
    }: {
      page: Page;
    }, testInfo: TestInfo) => {
      test.setTimeout(180000);
      await page.setViewportSize({ width: width, height: 1000 });

      const card: Locator = await openChart(
        page,
        explorerPath([PERCENT_METRIC, BYTES_METRIC]),
        2,
      );
      const chart: ChartReading = await readChart(card);
      const [left, right] = axesLeftFirst(chart);

      // The left axis, in percent: a round step, the fewest figures.
      const percents: Array<ReadFigure> = left!.ticks.map(readFigure);
      const percentStep: number = expectEvenSteps(
        left!,
        percents.map((figure: ReadFigure): number => {
          return figure.value;
        }),
        "the percent axis",
      );
      expect([1, 2, 2.5, 5]).toContain(mantissaOf(percentStep));
      for (const figure of percents) {
        expect(figure.decimals).toBe(decimalsOf(percentStep));
      }

      // The right axis, in bytes: a round step of the unit each tick is written in.
      const memory: Array<ReadFigure> = right!.ticks.map(readFigure);
      const memoryStep: number = expectEvenSteps(
        right!,
        memory.map((figure: ReadFigure): number => {
          return figure.value;
        }),
        "the memory axis",
      );
      for (const figure of memory) {
        expect([1, 2, 2.5, 5]).toContain(
          mantissaOf(memoryStep / figure.unitScale),
        );
        // "7.6 GB", never "7.65 GB" on a tenth of a gigabyte's step.
        expect(figure.decimals).toBe(
          figure.value === 0 ? 0 : decimalsOf(memoryStep / figure.unitScale),
        );
      }

      expectTicksInside(chart, left!, "left");
      expectTicksInside(chart, right!, "right");
      expectLittleBlankAbove(chart, testInfo, `memory and CPU at ${width}px`);
      await expectCardFits(card);

      await card.scrollIntoViewIfNeeded();
      await card.screenshot({
        path: `${SCREENSHOT_DIRECTORY}/metric-explorer-round-steps-${width}-synthetic.png`,
      });
    });
  }
});

test.describe("metrics explorer: a duration axis steps in natural units of time (#10118)", () => {
  for (const width of [1280, 390]) {
    test(`the issue's batch job: a clock a second a tick, never decimal hours, at ${width}px`, async ({
      page,
    }: {
      page: Page;
    }, testInfo: TestInfo) => {
      test.setTimeout(180000);
      await page.setViewportSize({ width: width, height: 1000 });

      const card: Locator = await openChart(
        page,
        explorerPath([JOB_METRIC]),
        1,
      );
      const chart: ChartReading = await readChart(card);
      const [axis] = axesLeftFirst(chart);

      for (const tick of axis!.ticks) {
        expect(tick, "a batch job tick").toMatch(/^1:(29|30):\d{2}$/);
        expect(tick).not.toMatch(/hour/);
      }
      expect(
        expectEvenSteps(axis!, axis!.ticks.map(readClock), "the job's axis"),
      ).toBe(1);

      expectTicksInside(chart, axis!, "left");
      expectLittleBlankAbove(chart, testInfo, `the batch job at ${width}px`);
      await expectCardFits(card);

      await card.scrollIntoViewIfNeeded();
      await card.screenshot({
        path: `${SCREENSHOT_DIRECTORY}/metric-explorer-duration-axis-${width}-synthetic.png`,
      });
    });

    test(`the batch job on the right of a percent chart: its axis a clock too, at ${width}px`, async ({
      page,
    }: {
      page: Page;
    }) => {
      test.setTimeout(180000);
      await page.setViewportSize({ width: width, height: 1000 });

      const card: Locator = await openChart(
        page,
        explorerPath([PERCENT_METRIC, JOB_METRIC]),
        2,
      );
      const chart: ChartReading = await readChart(card);
      const [left, right] = axesLeftFirst(chart);

      for (const tick of left!.ticks) {
        expect(tick, "a left tick").toMatch(/%$/);
      }
      for (const tick of right!.ticks) {
        expect(tick, "a right tick").toMatch(/^1:(29|30):\d{2}$/);
      }
      expect(
        expectEvenSteps(right!, right!.ticks.map(readClock), "the right axis"),
      ).toBe(1);
      expectTicksInside(chart, left!, "left");
      expectTicksInside(chart, right!, "right");
      await expectCardFits(card);
    });

    test(`the host's uptime of twelve days: days and a clock, ten minutes a tick, at ${width}px`, async ({
      page,
    }: {
      page: Page;
    }) => {
      test.setTimeout(180000);
      await page.setViewportSize({ width: width, height: 1000 });

      const card: Locator = await openChart(
        page,
        explorerPath([UPTIME_METRIC]),
        1,
      );
      const chart: ChartReading = await readChart(card);
      const [axis] = axesLeftFirst(chart);

      for (const tick of axis!.ticks) {
        expect(withSpacesShown(tick), "an uptime tick").toMatch(
          /^12⍽d⍽05:[0-5]\d$/,
        );
      }
      expect(
        expectEvenSteps(axis!, axis!.ticks.map(readClock), "the uptime axis"),
      ).toBe(600);
      expectTicksInside(chart, axis!, "left");
      await expectCardFits(card);

      await card.scrollIntoViewIfNeeded();
      await card.screenshot({
        path: `${SCREENSHOT_DIRECTORY}/metric-explorer-uptime-axis-${width}-synthetic.png`,
      });
    });
  }
});
