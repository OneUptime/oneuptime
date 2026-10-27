import { expect, Locator, Page, Route, test, TestInfo } from "@playwright/test";
import AggregationIntervalUtil from "Common/Types/BaseDatabase/AggregationIntervalUtil";
import {
  fillValueWidgetSeriesGaps,
  getMeanOfValues,
  getValueWidgetSeries,
  getValueWidgetTrend,
  ValueWidgetPoint,
  ValueWidgetReduce,
  ValueWidgetTrend,
} from "Common/Utils/Dashboard/ValueWidgetSeries";

/*
 * The dashboard Value widget's sparkline and trend arrow, in a real browser,
 * on both of a dashboard's surfaces: the dashboard inside OneUptime (its real
 * view layout and Dashboard page) and the public dashboard (its own
 * index.ejs and app), with only the data boundary answered from fixture data
 * (DashboardValueWidget/Fixture). See README.md.
 *
 * The report this answers: the sparkline was drawn newest point first and
 * the arrow pointed the opposite way to a line chart of the same metric,
 * by the wrong percentage, because OneUptime's metrics API answers an
 * aggregate newest bucket first. The fixture answers every metric read that
 * way too, so every test here reads the widget the way a customer's
 * dashboard reads it:
 *
 *   - each line runs from its oldest bucket on the left to its newest on
 *     the right, a grouped query's groups combined into one point a bucket;
 *   - hovering a line's two ends reads its oldest and newest buckets, and
 *     labels the line's ends while the pointer is on it;
 *   - each arrow points the way its data went, by the percentage its two
 *     halves give, coloured by whether that is good news, and its tooltip
 *     names both halves and their numbers;
 *   - a flat series, a single bucket and an empty window each have a state
 *     of their own;
 *   - all of it in the dark theme, in German and in Persian (right to left),
 *     and at a phone's width.
 *
 * Screenshots are saved for review under output/playwright/dashboard-value-widget-ui.
 */

interface RecordedPoint {
  time: string;
  value: number;
}

interface RecordedRead {
  start: number;
  end: number;
  metricName?: string | undefined;
  points: Array<RecordedPoint>;
}

interface FixtureRecord {
  aggregates?: Array<RecordedRead> | undefined;
  dataSource?: Array<RecordedRead> | undefined;
  unexpected: Array<string>;
}

declare global {
  interface Window {
    __dashboardValueWidgetFixture?: FixtureRecord | undefined;
  }
}

const PORT: string = "4427";

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000f7";
const DASHBOARD_ID: string = "db000000-0000-4000-8000-0000000000f7";

const APP_PATH: string = `/dashboard/${PROJECT_ID}/dashboards/${DASHBOARD_ID}`;
const PUBLIC_PATH: string = `/public-dashboard/${DASHBOARD_ID}`;

const SCREENSHOTS: string = "../../output/playwright/dashboard-value-widget-ui";

type Reduction = "sum" | "mean";

interface WidgetUnderTest {
  title: string;
  // Where its points come from: a metric read, or the Data Source widget's rows.
  metricName: string | null;
  reduction: Reduction;
  direction: "Up" | "Down" | "Flat";
  tone: "good" | "bad" | "neutral";
}

// The fixture's widgets that draw a line and an arrow (Fixture/Boards.js).
const LINES: Array<WidgetUnderTest> = [
  {
    title: "Log errors",
    metricName: "log.errors.count",
    reduction: "sum",
    direction: "Up",
    // An error count going up is bad news.
    tone: "bad",
  },
  {
    title: "Checkout latency",
    metricName: "checkout.latency",
    reduction: "mean",
    direction: "Down",
    // A latency going down is good news.
    tone: "good",
  },
  {
    title: "Queue depth",
    metricName: "queue.depth",
    reduction: "mean",
    direction: "Flat",
    tone: "neutral",
  },
  {
    title: "Requests",
    metricName: "http.requests",
    reduction: "sum",
    direction: "Up",
    tone: "good",
  },
  {
    title: "Deploys",
    metricName: "deploys.count",
    reduction: "sum",
    direction: "Up",
    tone: "good",
  },
  {
    title: "Error rate",
    metricName: "error.rate",
    reduction: "mean",
    direction: "Up",
    tone: "bad",
  },
];

const EXTERNAL: WidgetUnderTest = {
  title: "Orders (warehouse)",
  metricName: null,
  reduction: "sum",
  direction: "Up",
  // External data has no metric name to read: a rise is good news.
  tone: "good",
};

const ARROWS: Record<string, string> = { Up: "↑", Down: "↓", Flat: "→" };

// The wash a tile past its critical threshold is drawn with.
const CRITICAL_TINT: RegExp = /bg-red-50\/50/;
// The class that turns the dark theme on.
const DARK_THEME: RegExp = /dark/;
// The numbers in a computed colour.
const COLOUR_CHANNELS: RegExp = /[\d.]+/g;

const sum: ValueWidgetReduce = (values: Array<number>): number | null => {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((total: number, value: number): number => {
    return total + value;
  }, 0);
};

const reduceOf: (reduction: Reduction) => ValueWidgetReduce = (
  reduction: Reduction,
): ValueWidgetReduce => {
  return reduction === "sum" ? sum : getMeanOfValues;
};

const record: (page: Page) => Promise<FixtureRecord> = async (
  page: Page,
): Promise<FixtureRecord> => {
  return page.evaluate((): FixtureRecord => {
    return window.__dashboardValueWidgetFixture || { unexpected: [] };
  });
};

// The last read the widget's line was drawn from.
const readOf: (
  page: Page,
  widget: WidgetUnderTest,
) => Promise<RecordedRead> = async (
  page: Page,
  widget: WidgetUnderTest,
): Promise<RecordedRead> => {
  const fixture: FixtureRecord = await record(page);
  const reads: Array<RecordedRead> =
    widget.metricName === null
      ? fixture.dataSource || []
      : (fixture.aggregates || []).filter((read: RecordedRead): boolean => {
          return read.metricName === widget.metricName;
        });
  const read: RecordedRead | undefined = reads[reads.length - 1];

  expect(read, `a read for ${widget.title}`).toBeTruthy();

  return read as RecordedRead;
};

// The series the widget should draw: the read's points, oldest first, one a bucket.
const seriesOf: (
  read: RecordedRead,
  widget: WidgetUnderTest,
) => Array<ValueWidgetPoint> = (
  read: RecordedRead,
  widget: WidgetUnderTest,
): Array<ValueWidgetPoint> => {
  return getValueWidgetSeries(
    read.points.map(
      (point: RecordedPoint): { timestamp: string; value: number } => {
        return { timestamp: point.time, value: point.value };
      },
    ),
    reduceOf(widget.reduction),
  );
};

// The interval the server buckets a metric read's window at.
const bucketWidthOf: (read: RecordedRead) => number = (
  read: RecordedRead,
): number => {
  return AggregationIntervalUtil.getAggregationIntervalMs(
    AggregationIntervalUtil.getAggregationIntervalForWindow({
      startDate: new Date(read.start),
      endDate: new Date(read.end),
    }),
  );
};

/*
 * The line the widget should draw: its series, and for a metric's sum or
 * count the empty buckets between its readings at 0 (the Deploys tile's
 * sparse count) - a line through the readings alone read flat while its
 * arrow said the count rose. A Data Source widget's rows are drawn as they
 * are.
 */
const drawnSeriesOf: (
  read: RecordedRead,
  widget: WidgetUnderTest,
) => Array<ValueWidgetPoint> = (
  read: RecordedRead,
  widget: WidgetUnderTest,
): Array<ValueWidgetPoint> => {
  const series: Array<ValueWidgetPoint> = seriesOf(read, widget);

  if (widget.metricName === null || widget.reduction !== "sum") {
    return series;
  }

  return fillValueWidgetSeriesGaps({
    series: series,
    bucketWidthMs: bucketWidthOf(read),
  });
};

// The trend the widget should show for the read it drew.
const trendOf: (
  read: RecordedRead,
  widget: WidgetUnderTest,
) => ValueWidgetTrend | null = (
  read: RecordedRead,
  widget: WidgetUnderTest,
): ValueWidgetTrend | null => {
  return getValueWidgetTrend({
    points: seriesOf(read, widget),
    reduce: reduceOf(widget.reduction),
    isAdditive: widget.reduction === "sum",
    windowStart: new Date(read.start),
    windowEnd: new Date(read.end),
    // A metric read is bucketed at the server's interval for its window.
    ...(widget.metricName === null
      ? {}
      : {
          bucketWidthMs: bucketWidthOf(read),
        }),
  });
};

const pad: (value: number) => string = (value: number): string => {
  return String(value).padStart(2, "0");
};

/*
 * A day of a week's range, as a chart axis labels it: "15 Oct". The month
 * is named the way the page's browser names it (its Intl, as
 * OneUptimeDate's short month names are), so the check holds in a month a
 * locale spells its own way ("Sept" in en-GB).
 */
const dayLabel: (page: Page, date: Date) => Promise<string> = async (
  page: Page,
  date: Date,
): Promise<string> => {
  const month: string = await page.evaluate((iso: string): string => {
    return new Date(iso).toLocaleString("default", {
      month: "short",
      timeZone: "UTC",
    });
  }, date.toISOString());

  return `${pad(date.getUTCDate())} ${month}`;
};

/*
 * The hovered point of a week's line, an hour's bucket, named as a line
 * chart's tooltip names it and in the order of the line's end labels: day
 * first, "15 Oct, 09:00" (Utils/DashboardDateTime getDashboardBucketLabel),
 * in UTC, the suite's timezone.
 */
const hourLabel: (page: Page, date: Date) => Promise<string> = async (
  page: Page,
  date: Date,
): Promise<string> => {
  return `${await dayLabel(page, date)}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
};

/*
 * Whether `first` starts left of where `second` starts inside one element's
 * text, as the eye reads it: a right-to-left page reordered a run that
 * starts with a digit ("15 Oct – 18 Oct" read "Oct – 18 Oct 15"). Each part
 * is placed by its first character alone: a reordered part's own pieces
 * can land on both sides of the other part.
 */
const drawnInOrder: (
  element: Locator,
  first: string,
  second: string,
) => Promise<boolean> = async (
  element: Locator,
  first: string,
  second: string,
): Promise<boolean> => {
  return element.evaluate(
    (node: Element, parts: { first: string; second: string }): boolean => {
      const text: string = node.textContent || "";
      const walker: TreeWalker = document.createTreeWalker(
        node,
        NodeFilter.SHOW_TEXT,
      );
      const textNode: Node | null = walker.nextNode();

      if (!textNode) {
        return false;
      }

      const leftOf: (offset: number) => number = (offset: number): number => {
        const range: Range = document.createRange();
        range.setStart(textNode, offset);
        range.setEnd(textNode, offset + 1);
        return range.getBoundingClientRect().left;
      };

      const firstAt: number = text.indexOf(parts.first);
      const secondAt: number = text.indexOf(parts.second, firstAt + 1);

      if (firstAt < 0 || secondAt < 0) {
        return false;
      }

      return leftOf(firstAt) < leftOf(secondAt);
    },
    { first, second },
  );
};

const shoot: (
  page: Page,
  testInfo: TestInfo,
  name: string,
  target?: Locator,
) => Promise<void> = async (
  page: Page,
  testInfo: TestInfo,
  name: string,
  target?: Locator,
): Promise<void> => {
  const path: string = `${SCREENSHOTS}/${testInfo.project.name}-${name}.png`;

  if (target) {
    await target.screenshot({ path });
    return;
  }

  await page.screenshot({ path, fullPage: true });
};

/*
 * The page as the viewer sees it while a tooltip is open. A full-page
 * screenshot resizes the window to the page's height, and the tooltip,
 * placed for the window it opened in, is drawn away from its arrow.
 */
const shootViewport: (
  page: Page,
  testInfo: TestInfo,
  name: string,
) => Promise<void> = async (
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> => {
  await page.screenshot({
    path: `${SCREENSHOTS}/${testInfo.project.name}-${name}.png`,
  });
};

/*
 * The trend's tooltip, once it has faded all the way in: a screenshot taken
 * as it opens shows the tile through it.
 */
const trendTooltipSettled: (page: Page) => Promise<Locator> = async (
  page: Page,
): Promise<Locator> => {
  const details: Locator = page.getByTestId("value-widget-trend-details");

  await expect(details).toBeVisible();
  await expect
    .poll(async (): Promise<string> => {
      return details.evaluate((element: Element): string => {
        const box: Element | null = element.closest(".tippy-box");
        return box ? getComputedStyle(box).opacity : "";
      });
    })
    .toBe("1");

  return details;
};

const atDesktopOnly: () => void = (): void => {
  test.skip(
    Boolean(test.info().project.use.isMobile),
    "The same at any width: covered at 1280.",
  );
};

// A Value widget on the board, by its title.
const widgetTitled: (page: Page, title: string) => Locator = (
  page: Page,
  title: string,
): Locator => {
  return page.getByTestId("value-widget").filter({ hasText: title });
};

const sparklineOf: (widget: Locator) => Locator = (
  widget: Locator,
): Locator => {
  return widget.getByTestId("value-widget-sparkline");
};

const trendChipOf: (widget: Locator) => Locator = (
  widget: Locator,
): Locator => {
  return widget.getByTestId("value-widget-trend");
};

// The line's points, left to right, as the page draws them.
const linePointsOf: (
  widget: Locator,
) => Promise<Array<[number, number]>> = async (
  widget: Locator,
): Promise<Array<[number, number]>> => {
  const points: string =
    (await sparklineOf(widget).locator("polyline").getAttribute("points")) ||
    "";

  return points
    .trim()
    .split(" ")
    .map((pair: string): [number, number] => {
      const [x, y] = pair.split(",");
      return [Number(x), Number(y)];
    });
};

/*
 * Every widget that has an answer has drawn it: no widget is still in its
 * first load, and the eight metric reads (and, inside OneUptime, the Data
 * Source read) have been made.
 */
const boardDrawn: (page: Page, metricReads: number) => Promise<void> = async (
  page: Page,
  metricReads: number,
): Promise<void> => {
  await expect(widgetTitled(page, "Log errors")).toHaveAttribute(
    "data-state",
    "value",
    { timeout: 60000 },
  );
  await expect(
    page.locator('[data-testid="value-widget"][data-state="loading"]'),
  ).toHaveCount(0);
  await expect
    .poll(async (): Promise<number> => {
      return ((await record(page)).aggregates || []).length;
    })
    .toBeGreaterThanOrEqual(metricReads);
};

const openApp: (page: Page, search?: string) => Promise<void> = async (
  page: Page,
  search?: string,
): Promise<void> => {
  await page.goto(`${APP_PATH}${search || ""}`);
  await boardDrawn(page, 8);
  await expect(widgetTitled(page, EXTERNAL.title)).toHaveAttribute(
    "data-state",
    "value",
  );
};

const openPublic: (page: Page, search?: string) => Promise<void> = async (
  page: Page,
  search?: string,
): Promise<void> => {
  await page.goto(`${PUBLIC_PATH}${search || ""}`);
  await boardDrawn(page, 8);
};

// Move the pointer over a point of a widget's line: 0 its left end, 1 its right.
const hoverLineAt: (
  page: Page,
  widget: Locator,
  fraction: number,
) => Promise<void> = async (
  page: Page,
  widget: Locator,
  fraction: number,
): Promise<void> => {
  const svg: Locator = sparklineOf(widget);

  await svg.scrollIntoViewIfNeeded();

  const box: { x: number; y: number; width: number; height: number } | null =
    await svg.boundingBox();

  expect(box).not.toBeNull();

  // The line is inset 4px inside its box.
  const x: number = box!.x + 4 + fraction * (box!.width - 8);

  await page.mouse.move(x, box!.y + box!.height / 2);
};

/*
 * Contrast of every visible text inside `scope` against what is behind it:
 * at least 4.5:1 (3:1 for large text), as WCAG asks of text.
 */
const lowContrastTextsIn: (scope: Locator) => Promise<Array<string>> = async (
  scope: Locator,
): Promise<Array<string>> => {
  return scope.evaluateAll((roots: Array<Element>): Array<string> => {
    const RGB: RegExp =
      /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/;
    const parse: (value: string) => Array<number> | null = (
      value: string,
    ): Array<number> | null => {
      const match: RegExpExecArray | null = RGB.exec(value);

      if (!match) {
        return null;
      }

      return [
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
        match[4] === undefined ? 1 : Number(match[4]),
      ];
    };
    const luminance: (rgb: Array<number>) => number = (
      rgb: Array<number>,
    ): number => {
      const linear: (channel: number) => number = (channel: number): number => {
        const value: number = channel / 255;
        return value <= 0.03928
          ? value / 12.92
          : Math.pow((value + 0.055) / 1.055, 2.4);
      };

      return (
        0.2126 * linear(rgb[0]!) +
        0.7152 * linear(rgb[1]!) +
        0.0722 * linear(rgb[2]!)
      );
    };
    /*
     * What is behind an element, as the eye sees it: every see-through
     * background between it and the first solid one (or the page), laid
     * over one another - a 50% red wash over a white card is pale pink.
     */
    const groundOf: (element: Element) => Array<number> | null = (
      element: Element,
    ): Array<number> | null => {
      const washes: Array<Array<number>> = [];
      let solid: Array<number> | null = null;
      let ancestor: Element | null = element;

      while (ancestor && !solid) {
        const ground: Array<number> | null = parse(
          getComputedStyle(ancestor).backgroundColor,
        );

        if (ground && ground[3]! >= 0.999) {
          solid = ground;
        } else if (ground && ground[3]! > 0) {
          washes.push(ground);
        }

        ancestor = ancestor.parentElement;
      }

      let seen: Array<number> | null =
        solid ||
        parse(getComputedStyle(document.body).backgroundColor) ||
        parse(getComputedStyle(document.documentElement).backgroundColor);

      if (!seen || seen[3]! < 0.999) {
        seen = [255, 255, 255, 1];
      }

      // From the wash nearest the solid ground up to the one under the text.
      for (let index: number = washes.length - 1; index >= 0; index--) {
        const wash: Array<number> = washes[index]!;
        const alpha: number = wash[3]!;

        seen = [
          wash[0]! * alpha + seen[0]! * (1 - alpha),
          wash[1]! * alpha + seen[1]! * (1 - alpha),
          wash[2]! * alpha + seen[2]! * (1 - alpha),
          1,
        ];
      }

      return seen;
    };

    const found: Array<string> = [];

    for (const root of roots) {
      for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
        if (element.closest("svg")) {
          continue;
        }

        const hasText: boolean = Array.from(element.childNodes).some(
          (node: ChildNode): boolean => {
            return (
              node.nodeType === Node.TEXT_NODE &&
              (node.textContent || "").trim().length > 0
            );
          },
        );

        if (!hasText) {
          continue;
        }

        const style: CSSStyleDeclaration = getComputedStyle(element);
        const box: DOMRect = element.getBoundingClientRect();

        if (
          style.visibility === "hidden" ||
          style.display === "none" ||
          box.width < 1 ||
          box.height < 1
        ) {
          continue;
        }

        const text: Array<number> | null = parse(style.color);
        const ground: Array<number> | null = groundOf(element);

        if (!text || !ground) {
          continue;
        }

        const lighter: number = Math.max(luminance(text), luminance(ground));
        const darker: number = Math.min(luminance(text), luminance(ground));
        const ratio: number = (lighter + 0.05) / (darker + 0.05);
        const size: number = parseFloat(style.fontSize);
        const isLarge: boolean =
          size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);

        if (ratio < (isLarge ? 3 : 4.5)) {
          found.push(
            `${ratio.toFixed(2)} "${(element.textContent || "").trim().slice(0, 40)}" ${style.color} on rgb(${ground.slice(0, 3).join(", ")})`,
          );
        }
      }
    }

    return found;
  });
};

// Nothing the pages ask for leaves the fixture.
test.beforeEach(async ({ page }: { page: Page }) => {
  await page.route("**/*", async (route: Route) => {
    const url: URL = new URL(route.request().url());

    if (url.hostname === "127.0.0.1" && url.port === PORT) {
      await route.continue();
      return;
    }

    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  const unexpected: Array<string> = await record(page)
    .then((fixture: FixtureRecord): Array<string> => {
      return fixture.unexpected;
    })
    .catch((): Array<string> => {
      return [];
    });

  // Every request the pages made is one the fixture models.
  expect(unexpected).toEqual([]);
});

/*
 * The checks every surface shares: the order each line is drawn in, and
 * where each arrow points and by how much.
 */
const expectLinesOldestFirst: (
  page: Page,
  widgets: Array<WidgetUnderTest>,
) => Promise<void> = async (
  page: Page,
  widgets: Array<WidgetUnderTest>,
): Promise<void> => {
  for (const widgetUnderTest of widgets) {
    const widget: Locator = widgetTitled(page, widgetUnderTest.title);
    const expected: Array<ValueWidgetPoint> = drawnSeriesOf(
      await readOf(page, widgetUnderTest),
      widgetUnderTest,
    );
    const points: Array<[number, number]> = await linePointsOf(widget);
    const height: number = Number(
      await sparklineOf(widget).getAttribute("height"),
    );
    const values: Array<number> = expected.map(
      (point: ValueWidgetPoint): number => {
        return point.value;
      },
    );
    const lowest: number = Math.min(...values);
    const highest: number = Math.max(...values);

    // One point a bucket, left to right.
    expect(points.length, widgetUnderTest.title).toBe(expected.length);

    points.forEach((point: [number, number], index: number): void => {
      if (index > 0) {
        expect(point[0]).toBeGreaterThan(points[index - 1]![0]);
      }

      // Oldest on the left: the index-th point is the index-th bucket in time.
      const y: number =
        highest === lowest
          ? height / 2
          : height -
            4 -
            ((values[index]! - lowest) / (highest - lowest)) * (height - 8);

      expect(
        Math.abs(point[1] - y),
        `${widgetUnderTest.title}, point ${index}`,
      ).toBeLessThan(0.01);
    });
  }
};

const expectArrows: (
  page: Page,
  widgets: Array<WidgetUnderTest>,
) => Promise<void> = async (
  page: Page,
  widgets: Array<WidgetUnderTest>,
): Promise<void> => {
  for (const widgetUnderTest of widgets) {
    const chip: Locator = trendChipOf(
      widgetTitled(page, widgetUnderTest.title),
    );
    const trend: ValueWidgetTrend | null = trendOf(
      await readOf(page, widgetUnderTest),
      widgetUnderTest,
    );

    expect(trend, widgetUnderTest.title).not.toBeNull();
    expect(trend!.direction, widgetUnderTest.title).toBe(
      widgetUnderTest.direction,
    );

    await expect(chip).toHaveAttribute(
      "data-direction",
      widgetUnderTest.direction,
    );
    await expect(chip).toHaveAttribute("data-tone", widgetUnderTest.tone);
    await expect(chip).toHaveText(
      `${ARROWS[widgetUnderTest.direction]}${Math.abs(trend!.percent!)}%`,
    );
  }
};

test.describe("the Value widgets on the dashboard inside OneUptime", () => {
  test("draw every line from its oldest bucket on the left to its newest on the right", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openApp(page);

    await expectLinesOldestFirst(page, [...LINES, EXTERNAL]);

    // Every metric read was answered newest first, as the metrics API answers.
    const reads: Array<RecordedRead> = (await record(page)).aggregates || [];
    expect(reads.length).toBeGreaterThanOrEqual(8);

    await shoot(page, testInfo, "board");
  });

  test("point every arrow the way its data went, by the percentage its two halves give", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openApp(page);

    await expectArrows(page, [...LINES, EXTERNAL]);
  });

  test("draw a sparse count's empty hours between its readings at 0, so its rise reads as one", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openApp(page);

    const deploys: WidgetUnderTest = LINES.find(
      (widget: WidgetUnderTest): boolean => {
        return widget.title === "Deploys";
      },
    )!;
    const read: RecordedRead = await readOf(page, deploys);
    const readings: Array<ValueWidgetPoint> = seriesOf(read, deploys);
    const drawn: Array<ValueWidgetPoint> = drawnSeriesOf(read, deploys);
    const points: Array<[number, number]> = await linePointsOf(
      widgetTitled(page, deploys.title),
    );

    // Most hours had no deploy: far more points drawn than readings.
    expect(readings.length).toBeGreaterThan(1);
    expect(drawn.length).toBeGreaterThan(readings.length);
    expect(points.length).toBe(drawn.length);

    // The line starts and ends on a reading, never on a 0 not yet landed.
    expect(drawn[0]).toEqual(readings[0]);
    expect(drawn[drawn.length - 1]).toEqual(readings[readings.length - 1]);

    // Every empty hour sits on the line's lowest level.
    const lowest: number = Math.max(
      ...points.map((point: [number, number]): number => {
        return point[1];
      }),
    );
    drawn.forEach((point: ValueWidgetPoint, index: number): void => {
      if (point.value === 0) {
        expect(points[index]![1]).toBeCloseTo(lowest, 2);
      }
    });

    await shoot(page, testInfo, "sparse-count", widgetTitled(page, "Deploys"));
  });

  test("read the oldest bucket at a line's left end and the newest at its right, the ends labelled", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await openApp(page);

    const widget: Locator = widgetTitled(page, "Log errors");
    const series: Array<ValueWidgetPoint> = seriesOf(
      await readOf(page, LINES[0]!),
      LINES[0]!,
    );
    const oldest: ValueWidgetPoint = series[0]!;
    const newest: ValueWidgetPoint = series[series.length - 1]!;
    const bigNumber: Locator = widget.locator("div.font-bold.tabular-nums");

    await hoverLineAt(page, widget, 0);

    // Day first, like the end labels below it: "15 Oct, 10:00" over "15 Oct".
    await expect(widget.getByTestId("value-widget-hovered-time")).toHaveText(
      await hourLabel(page, oldest.timestamp),
    );
    await expect(bigNumber).toHaveText(String(oldest.value));
    await expect(widget.getByTestId("value-widget-sparkline-start")).toHaveText(
      await dayLabel(page, oldest.timestamp),
    );
    await expect(widget.getByTestId("value-widget-sparkline-end")).toHaveText(
      await dayLabel(page, newest.timestamp),
    );

    // The labels sit outside the line: the oldest to its left, the newest to its right.
    const line: { x: number; width: number } | null =
      await sparklineOf(widget).boundingBox();
    const start: { x: number; width: number } | null = await widget
      .getByTestId("value-widget-sparkline-start")
      .boundingBox();
    const end: { x: number; width: number } | null = await widget
      .getByTestId("value-widget-sparkline-end")
      .boundingBox();

    expect(start!.x + start!.width).toBeLessThanOrEqual(line!.x);
    expect(end!.x).toBeGreaterThanOrEqual(line!.x + line!.width);

    // ... and inside the tile.
    const tile: { x: number; width: number } | null =
      await widget.boundingBox();
    expect(start!.x).toBeGreaterThanOrEqual(tile!.x);
    expect(end!.x + end!.width).toBeLessThanOrEqual(tile!.x + tile!.width);

    await shoot(page, testInfo, "hover-oldest", widget);

    await hoverLineAt(page, widget, 1);

    await expect(widget.getByTestId("value-widget-hovered-time")).toHaveText(
      await hourLabel(page, newest.timestamp),
    );
    await expect(bigNumber).toHaveText(String(newest.value));

    await shoot(page, testInfo, "hover-newest", widget);

    // Off the line, the arrow is back and the ends go unlabelled.
    await page.mouse.move(5, 5);
    await expect(trendChipOf(widget)).toBeVisible();
    await expect(
      widget.getByTestId("value-widget-sparkline-start"),
    ).toHaveCount(0);
  });

  test("say in the arrow's tooltip what it compares: both halves of the range and what each came to", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await openApp(page);

    const widget: Locator = widgetTitled(page, "Log errors");
    const chip: Locator = trendChipOf(widget);
    const trend: ValueWidgetTrend = trendOf(
      await readOf(page, LINES[0]!),
      LINES[0]!,
    )!;
    const sentence: string = `Up ${trend.percent}% from the first half of the time range`;

    await expect(chip).toHaveAttribute("aria-label", sentence);

    await chip.hover();

    const details: Locator = await trendTooltipSettled(page);

    await expect(details).toContainText(sentence);
    await expect(details.locator('[data-half="first"]')).toContainText(
      "First half",
    );
    await expect(details.locator('[data-half="second"]')).toContainText(
      "Second half",
    );
    await expect(details.locator('[data-half="first"]')).toContainText(
      `${await dayLabel(page, trend.firstHalfStart)} – ${await dayLabel(page, trend.midpoint)}`,
    );
    await expect(details.locator('[data-half="second"]')).toContainText(
      `${await dayLabel(page, trend.midpoint)} – ${await dayLabel(page, trend.secondHalfEnd)}`,
    );

    // The tooltip opens on the page, not clipped inside the tile.
    const tileBox: { y: number } | null = await widget.boundingBox();
    const detailsBox: { y: number } | null = await details.boundingBox();
    expect(detailsBox!.y).toBeLessThan(tileBox!.y + 200);

    await shootViewport(page, testInfo, "trend-tooltip");
  });

  test("let the keyboard reach each arrow, its tooltip opening on focus", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await openApp(page);

    const chip: Locator = trendChipOf(widgetTitled(page, "Log errors"));
    const isFocused: (target: Locator) => Promise<boolean> = (
      target: Locator,
    ): Promise<boolean> => {
      return target.evaluate((element: Element): boolean => {
        return element === document.activeElement;
      });
    };

    // From the top of the page, Tab by Tab, as a keyboard reaches it.
    for (let press: number = 0; press < 60; press++) {
      if (await isFocused(chip)) {
        break;
      }

      await page.keyboard.press("Tab");
    }

    expect(await isFocused(chip)).toBe(true);

    const details: Locator = await trendTooltipSettled(page);
    const trend: ValueWidgetTrend = trendOf(
      await readOf(page, LINES[0]!),
      LINES[0]!,
    )!;

    await expect(details).toContainText(
      `Up ${trend.percent}% from the first half of the time range`,
    );
    await expect(details.locator('[data-half="first"]')).toContainText(
      "First half",
    );

    // A ring shows where the focus is.
    const ring: string = await chip.evaluate((element: Element): string => {
      return getComputedStyle(element).boxShadow;
    });

    expect(ring).not.toBe("none");

    await shootViewport(page, testInfo, "keyboard-trend-tooltip");

    // The next Tab moves on to the next arrow.
    await page.keyboard.press("Tab");

    expect(
      await isFocused(trendChipOf(widgetTitled(page, "Checkout latency"))),
    ).toBe(true);
  });

  test("tell an unconfigured widget on the shipped 3x1 tile what to do, in full, viewing and editing", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await openApp(page);

    const setup: Locator = page.locator(
      '[data-testid="value-widget"][data-state="setup"]',
    );

    // Every line of the prompt inside the tile, none cut through.
    const linesOutside: () => Promise<Array<string>> = async (): Promise<
      Array<string>
    > => {
      return setup.evaluate((tile: Element): Array<string> => {
        const box: DOMRect = tile.getBoundingClientRect();

        return Array.from(tile.querySelectorAll("p"))
          .filter((line: HTMLParagraphElement): boolean => {
            const lineBox: DOMRect = line.getBoundingClientRect();
            return (
              lineBox.top < box.top - 0.5 ||
              lineBox.bottom > box.bottom + 0.5 ||
              line.scrollHeight > line.clientHeight + 1
            );
          })
          .map((line: HTMLParagraphElement): string => {
            return line.textContent || "";
          });
      });
    };

    await expect(setup).toHaveCount(1);
    await expect(setup).toContainText("Click to configure metric");
    expect(await linesOutside()).toEqual([]);

    await page.getByRole("button", { name: "More dashboard options" }).click();
    await page.getByText("Edit Dashboard").click();

    // Editing, the drag handle takes 16px more off a tile one unit tall.
    await expect(page.getByText("Save Changes")).toBeVisible();
    await expect(setup).toContainText("Click to configure metric");
    // The widget's generic name gives way to what to do.
    await expect(setup).not.toContainText("Value Widget");
    expect(await linesOutside()).toEqual([]);

    await shoot(page, testInfo, "setup-3x1-editing", setup);
  });

  test("draw a series that never moves across the middle, with '→ 0%' in grey", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await openApp(page);

    const widget: Locator = widgetTitled(page, "Queue depth");
    const height: number = Number(
      await sparklineOf(widget).getAttribute("height"),
    );

    for (const [, y] of await linePointsOf(widget)) {
      expect(y).toBe(height / 2);
    }

    await expect(trendChipOf(widget)).toHaveText("→0%");
    await expect(trendChipOf(widget)).toHaveAttribute(
      "aria-label",
      "About the same as in the first half of the time range",
    );
  });

  test("show a single bucket as a number with no line and no arrow, and an empty window as no data", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await openApp(page);

    const firstRead: Locator = widgetTitled(page, "First reading");

    await expect(firstRead).toHaveAttribute("data-state", "value");
    await expect(firstRead.locator("div.font-bold.tabular-nums")).toHaveText(
      "7",
    );
    await expect(sparklineOf(firstRead)).toHaveCount(0);
    await expect(trendChipOf(firstRead)).toHaveCount(0);

    const silent: Locator = widgetTitled(page, "Disk alerts");

    await expect(silent).toHaveAttribute("data-state", "no-data");
    await expect(silent).toContainText("No data for the selected time range");
  });

  test("past its critical threshold, the tile is washed red in both themes, its words still legible", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();

    for (const theme of ["light", "dark"]) {
      await openApp(page, theme === "dark" ? "?theme=dark" : "");

      const widget: Locator = widgetTitled(page, "Error rate");

      await expect(widget).toHaveClass(CRITICAL_TINT);
      expect(await lowContrastTextsIn(widget)).toEqual([]);

      const tint: string = await widget.evaluate((element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      });

      // A red wash: more red than green, in either theme.
      const [red, green] = tint.match(COLOUR_CHANNELS)!.map(Number);
      expect(red!).toBeGreaterThan(green!);

      await shoot(page, testInfo, `threshold-${theme}`, widget);
    }
  });

  test("in the dark theme, every word on every Value widget is legible", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openApp(page, "?theme=dark");

    expect(await lowContrastTextsIn(page.getByTestId("value-widget"))).toEqual(
      [],
    );

    if (!test.info().project.use.isMobile) {
      const widget: Locator = widgetTitled(page, "Log errors");

      await hoverLineAt(page, widget, 0.3);
      expect(await lowContrastTextsIn(widget)).toEqual([]);

      await shoot(page, testInfo, "dark-hover", widget);

      await page.mouse.move(5, 5);
      await trendChipOf(widget).hover();
      expect(await lowContrastTextsIn(await trendTooltipSettled(page))).toEqual(
        [],
      );

      await shootViewport(page, testInfo, "dark-trend-tooltip");
    }

    await shoot(page, testInfo, "board-dark");
  });

  test("in the light theme, every word on every Value widget is legible", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await openApp(page);

    expect(await lowContrastTextsIn(page.getByTestId("value-widget"))).toEqual(
      [],
    );
  });

  test("say it in German", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    atDesktopOnly();
    await openApp(page, "?lang=de");

    const trend: ValueWidgetTrend = trendOf(
      await readOf(page, LINES[0]!),
      LINES[0]!,
    )!;
    const chip: Locator = trendChipOf(widgetTitled(page, "Log errors"));

    await expect(chip).toHaveAttribute(
      "aria-label",
      `${trend.percent}% mehr als in der ersten Hälfte des Zeitraums`,
    );

    await chip.hover();

    const details: Locator = await trendTooltipSettled(page);

    await expect(details).toContainText("Erste Hälfte");
    await expect(details).toContainText("Zweite Hälfte");
    await expect(widgetTitled(page, "Disk alerts")).toContainText(
      "Keine Daten für den ausgewählten Zeitraum",
    );

    await shootViewport(page, testInfo, "german-trend-tooltip");
  });

  test("keep time running left to right on a right-to-left page", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await openApp(page, "?lang=fa");

    await expectLinesOldestFirst(page, [LINES[0]!]);

    const widget: Locator = widgetTitled(page, "Log errors");
    const series: Array<ValueWidgetPoint> = seriesOf(
      await readOf(page, LINES[0]!),
      LINES[0]!,
    );

    await hoverLineAt(page, widget, 0);

    const line: { x: number; width: number } | null =
      await sparklineOf(widget).boundingBox();
    const start: Locator = widget.getByTestId("value-widget-sparkline-start");
    const end: Locator = widget.getByTestId("value-widget-sparkline-end");

    await expect(start).toHaveText(await dayLabel(page, series[0]!.timestamp));
    await expect(end).toHaveText(
      await dayLabel(page, series[series.length - 1]!.timestamp),
    );

    // The oldest end is labelled on the left, on a right-to-left page too.
    const startBox: { x: number; width: number } | null =
      await start.boundingBox();
    const endBox: { x: number; width: number } | null = await end.boundingBox();

    expect(startBox!.x + startBox!.width).toBeLessThanOrEqual(line!.x);
    expect(endBox!.x).toBeGreaterThanOrEqual(line!.x + line!.width);

    /*
     * The hovered time reads day, then hour, left to right: "15 Oct, 10:00"
     * starts with a digit, and a right-to-left page reordered such a run.
     */
    const hovered: Locator = widget.getByTestId("value-widget-hovered-time");
    const oldestDay: string = await dayLabel(page, series[0]!.timestamp);
    const oldestHour: string = `${pad(series[0]!.timestamp.getUTCHours())}:00`;

    await expect(hovered).toHaveText(
      await hourLabel(page, series[0]!.timestamp),
    );
    expect(await drawnInOrder(hovered, oldestDay, oldestHour)).toBe(true);

    /*
     * The page as the viewer sees it: an element's own screenshot is cut
     * from the wrong place on a right-to-left page.
     */
    await shootViewport(page, testInfo, "persian-hover");

    // The arrow's tooltip: each half's dates read from its start to its end.
    await page.mouse.move(5, 5);

    const trend: ValueWidgetTrend = trendOf(
      await readOf(page, LINES[0]!),
      LINES[0]!,
    )!;

    await trendChipOf(widget).hover();

    const details: Locator = await trendTooltipSettled(page);
    const firstHalf: Locator = details.locator('[data-half="first"] bdi');
    const secondHalf: Locator = details.locator('[data-half="second"] bdi');
    const startDay: string = await dayLabel(page, trend.firstHalfStart);
    const midDay: string = await dayLabel(page, trend.midpoint);
    const endDay: string = await dayLabel(page, trend.secondHalfEnd);

    await expect(firstHalf).toHaveText(`${startDay} – ${midDay}`);
    await expect(secondHalf).toHaveText(`${midDay} – ${endDay}`);
    expect(await drawnInOrder(firstHalf, startDay, midDay)).toBe(true);
    expect(await drawnInOrder(secondHalf, midDay, endDay)).toBe(true);

    await shootViewport(page, testInfo, "persian-trend-tooltip");
  });

  test("on a phone, a tap on the arrow says what it compares", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    test.skip(
      !test.info().project.use.isMobile,
      "A tap is a phone's: covered by the hover at 1280.",
    );
    await openApp(page);

    const chip: Locator = trendChipOf(widgetTitled(page, "Log errors"));

    await chip.scrollIntoViewIfNeeded();
    await chip.tap();

    await expect(await trendTooltipSettled(page)).toContainText("First half");

    await shootViewport(page, testInfo, "phone-trend-tooltip");
  });
});

test.describe("the Value widgets on the public dashboard", () => {
  test("draw the same lines and the same arrows", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openPublic(page);

    await expectLinesOldestFirst(page, LINES);
    await expectArrows(page, LINES);

    // A public dashboard draws no Data Source widget.
    await expect(widgetTitled(page, EXTERNAL.title)).toHaveCount(0);

    await shoot(page, testInfo, "public");
  });

  test("a Dark dashboard keeps every word legible", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openPublic(page, "?publicTheme=Dark");

    await expect(page.locator("html")).toHaveClass(DARK_THEME);
    expect(await lowContrastTextsIn(page.getByTestId("value-widget"))).toEqual(
      [],
    );

    await shoot(page, testInfo, "public-dark");
  });
});
