import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * A monitor's Status Timeline and an incident's State Timeline (the name of
 * its side-menu entry and its card, as for an alert, a maintenance event and
 * an episode), in a browser, against the offline fixture
 * (StatusTimeline/Fixture).
 *
 * The maintainer's ask: "improve the UI for this and make it actually look
 * like timeline view" - the screenshot was a monitor's 63 status events as
 * a table, ten to a page. The page now opens on a timeline: a band drawn to
 * scale over a period (a month first), each status where and as long as it
 * was, the list of changes under it by day, and the period moved with a
 * picker, the period before and after, a click on a cluster or a drag
 * across the band - with every action the table had, gated the same way.
 *
 * The fixture records each read, create and delete the page sends, so the
 * tests check what the page asked for as well as what it drew: a month's
 * rows and the one before them, never the whole history; the cause and the
 * log only when asked for.
 */

const MONITOR_ROUTE: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/monitors/60000000-0000-4000-8000-000000000001/status-timeline";

const INCIDENT_ROUTE: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/incidents/40000000-0000-4000-8000-000000000001/state-timeline";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/status-timeline-ui",
);

// The maintainer's screenshot was taken at 08:36 BST on October 14.
const NOW: Date = new Date("2026-10-14T07:36:00.000Z");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const MONTH_BEFORE_NOW: string = "2026-09-14T07:36:00.000Z";

// The fixture's rows of the screenshot's history, newest first.
const eventId: (index: number) => string = (index: number): string => {
  return `62000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
};

const NEWEST_OPERATIONAL: string = eventId(1);
const OFFLINE_38_SECONDS: string = eventId(2);
// Oct 4: five changes within an hour and a quarter - one cluster at a month.
const OCT_4_CHANGES: Array<string> = [4, 5, 6, 7, 8].map(eventId);

/*
 * The 38-second blip's name on the band: both ends in one minute, so to
 * the second (Chromium writes a narrow no-break space before AM).
 */
const BLIP_LABEL: RegExp =
  /^Offline, Oct 9, 7:26:01\sAM – 7:26:39\sAM, 38 secs$/;

// The buttons beside the Timeline | Table switch in an incident's header.
const INCIDENT_HEADER_BUTTON_NAME: RegExp =
  /^(Create State Change|More options)$/;

const MONITOR_ONLY_EVENT_REFUSAL: string =
  "The monitor's only status event can't be deleted: the monitor would have no status, and status pages would show it gray. To change its status, add a new status event.";

interface ListRequest {
  tableName: string;
  startsAt: { type: string; from?: string; to?: string; value?: string } | null;
  queryKeys: Array<string>;
  selectKeys: Array<string>;
  sort: Record<string, string>;
  skip: number;
  limit: number;
}

interface ItemRequest {
  tableName: string;
  id: string;
  selectKeys: Array<string>;
}

interface FixtureRecord {
  listRequests: Array<ListRequest>;
  itemRequests: Array<ItemRequest>;
  deletes: Array<{ tableName: string; id: string }>;
  creates: Array<{
    tableName: string;
    state: string | null;
    startsAt: string;
    recordId: string;
  }>;
  updates: Array<{
    tableName: string;
    id: string;
    data: Record<string, unknown>;
  }>;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
  await page.clock.setFixedTime(NOW);
});

test.afterEach(({ page }: { page: Page }) => {
  // A timeline that threw while drawing is a bug even when the test passed.
  expect(pageErrors.get(page) || []).toEqual([]);
});

async function screenshot(
  page: Page,
  name: string,
  fullPage: boolean = true,
): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: fullPage,
    animations: "disabled",
  });
}

async function fixture(page: Page): Promise<FixtureRecord> {
  return await page.evaluate((): FixtureRecord => {
    return (window as unknown as { __fixture: FixtureRecord }).__fixture;
  });
}

async function timelineReads(page: Page): Promise<Array<ListRequest>> {
  return (await fixture(page)).listRequests.filter(
    (request: ListRequest): boolean => {
      return (
        request.tableName === "MonitorStatusTimeline" ||
        request.tableName === "IncidentStateTimeline"
      );
    },
  );
}

// The reads of the rows the band draws: the ones that ask for a status.
async function bandReads(page: Page): Promise<Array<ListRequest>> {
  return (await timelineReads(page)).filter((request: ListRequest): boolean => {
    return (
      request.selectKeys.includes("monitorStatus") ||
      request.selectKeys.includes("incidentState")
    );
  });
}

async function openMonitor(page: Page, search: string = ""): Promise<void> {
  await page.goto(`${MONITOR_ROUTE}${search}`);
  await expect(page.getByTestId("status-timeline-band")).toBeVisible();
  await expect(page.getByTestId("status-timeline-loading")).toHaveCount(0);
}

async function openIncident(page: Page, search: string = ""): Promise<void> {
  await page.goto(
    `${INCIDENT_ROUTE}?page=incident${search ? `&${search}` : ""}`,
  );
  await expect(page.getByTestId("status-timeline-band")).toBeVisible();
  await expect(page.getByTestId("status-timeline-loading")).toHaveCount(0);
}

function entry(page: Page, id: string): Locator {
  return page.locator(
    `[data-testid="status-timeline-entry"][data-entry-id="${id}"]`,
  );
}

function mark(page: Page, entryId: string): Locator {
  return page
    .getByTestId("status-timeline-band")
    .locator(`[data-entry-ids="${entryId}"]`);
}

function legendItems(page: Page): Locator {
  return page.getByTestId("status-timeline-legend-item");
}

// The fixture's Offline status, by its id.
const OFFLINE_STATUS_ID: string = "61000000-0000-4000-8000-000000000003";

function offlineInLegend(page: Page): Locator {
  return page.locator(
    `[data-testid="status-timeline-legend-item"][data-status-key="${OFFLINE_STATUS_ID}"]`,
  );
}

async function openEntryMenu(page: Page, id: string): Promise<Locator> {
  await entry(page, id).getByTestId("row-actions-more-button").click();
  const menu: Locator = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

async function boxOf(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box: { x: number; y: number; width: number; height: number } | null =
    await locator.boundingBox();

  expect(box).not.toBeNull();

  return box!;
}

interface UnreadableWords {
  words: string;
  contrast: number;
}

/*
 * Every word the timeline's card draws that reads under WCAG AA (4.5:1)
 * against what is behind it, measured as Chromium draws it: the text's
 * colour over its ground, a translucent ground blended down to the first
 * solid one under it.
 */
async function unreadableWords(page: Page): Promise<Array<UnreadableWords>> {
  return await page.evaluate(() => {
    const RGB_CHANNELS: RegExp = /rgba?\(([^)]+)\)/;

    type Rgba = [number, number, number, number];

    const parse: (color: string) => Rgba = (color: string): Rgba => {
      const parts: Array<number> = (
        color.match(RGB_CHANNELS)?.[1] || "0, 0, 0, 0"
      )
        .split(",")
        .map((part: string): number => {
          return Number(part.trim());
        });

      return [
        parts[0] || 0,
        parts[1] || 0,
        parts[2] || 0,
        parts[3] === undefined ? 1 : parts[3],
      ];
    };

    // What is behind an element: its ground, or the nearest one above.
    const groundOf: (element: Element | null) => Rgba = (
      element: Element | null,
    ): Rgba => {
      let current: Element | null = element;

      while (current) {
        const ground: Rgba = parse(getComputedStyle(current).backgroundColor);

        if (ground[3] > 0.99) {
          return ground;
        }

        if (ground[3] > 0) {
          const below: Rgba = groundOf(current.parentElement);
          const alpha: number = ground[3];

          return [
            ground[0] * alpha + below[0] * (1 - alpha),
            ground[1] * alpha + below[1] * (1 - alpha),
            ground[2] * alpha + below[2] * (1 - alpha),
            1,
          ];
        }

        current = current.parentElement;
      }

      return [255, 255, 255, 1];
    };

    const luminance: (color: Rgba) => number = (color: Rgba): number => {
      const linear: Array<number> = color
        .slice(0, 3)
        .map((part: number): number => {
          const value: number = part / 255;

          return value <= 0.03928
            ? value / 12.92
            : Math.pow((value + 0.055) / 1.055, 2.4);
        });

      return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
    };

    const root: Element = document.querySelector('[data-testid="card"]')!;
    const walker: TreeWalker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
    );
    const found: Array<{ words: string; contrast: number }> = [];

    while (walker.nextNode()) {
      const element: Element | null = walker.currentNode.parentElement;
      const words: string = (walker.currentNode.textContent || "").trim();

      if (
        !words ||
        !element ||
        element.closest('.sr-only, [aria-disabled="true"], :disabled')
      ) {
        continue;
      }

      const box: DOMRect = element.getBoundingClientRect();

      if (box.width === 0 || box.height === 0) {
        continue;
      }

      const ground: Rgba = groundOf(element);
      const text: Rgba = parse(getComputedStyle(element).color);
      const drawn: Rgba = [
        text[0] * text[3] + ground[0] * (1 - text[3]),
        text[1] * text[3] + ground[1] * (1 - text[3]),
        text[2] * text[3] + ground[2] * (1 - text[3]),
        1,
      ];
      const lighter: number = Math.max(luminance(drawn), luminance(ground));
      const darker: number = Math.min(luminance(drawn), luminance(ground));
      const contrast: number = (lighter + 0.05) / (darker + 0.05);

      if (contrast < 4.5) {
        found.push({
          words: words,
          contrast: Math.round(contrast * 100) / 100,
        });
      }
    }

    return found;
  });
}

/*
 * The Timeline | Table switch's icons, as Chromium draws them: what each
 * draws, how big, the colour it is drawn in and the grounds behind it (from
 * the icon up to the page), and the extent of its drawing in the icon's 24
 * units, stroke included.
 */
interface SwitchIcon {
  view: string;
  width: number;
  height: number;
  top: number;
  paths: Array<{ d: string | null; strokeWidth: string | null }>;
  inkWidth: number;
  inkHeight: number;
  colour: string;
  grounds: Array<string>;
}

// IconProp.Timeline: three stretches of time stepping down to the right.
const TIMELINE_ICON_PATH: string = "M4.5 6h7.5M8.25 12h7.5M12 18h7.5";

// IconProp.TableCells begins with its bottom edge.
const TABLE_ICON_PATH_START: string = "M3.375 19.5h17.25";

// What WCAG 2.1 (1.4.11) asks of a graphic that helps say what a control is.
const NON_TEXT_CONTRAST: number = 3;

async function switchIcons(page: Page): Promise<Array<SwitchIcon>> {
  return await page.evaluate((): Array<SwitchIcon> => {
    return ["timeline", "table"].map((view: string): SwitchIcon => {
      const svg: SVGSVGElement = document.querySelector(
        `[data-testid="status-timeline-view-${view}"] svg`,
      )!;
      const box: DOMRect = svg.getBoundingClientRect();
      const paths: Array<SVGPathElement> = Array.from(
        svg.querySelectorAll("path"),
      );
      let left: number = Infinity;
      let right: number = -Infinity;
      let top: number = Infinity;
      let bottom: number = -Infinity;

      for (const path of paths) {
        const shape: DOMRect = path.getBBox();
        // A stroke, and a round end, reach half its width past the shape.
        const reach: number =
          Number.parseFloat(getComputedStyle(path).strokeWidth) / 2;

        left = Math.min(left, shape.x - reach);
        right = Math.max(right, shape.x + shape.width + reach);
        top = Math.min(top, shape.y - reach);
        bottom = Math.max(bottom, shape.y + shape.height + reach);
      }

      const grounds: Array<string> = [];
      let element: Element | null = svg;

      while (element) {
        grounds.push(getComputedStyle(element).backgroundColor);
        element = element.parentElement;
      }

      return {
        view: view,
        width: box.width,
        height: box.height,
        top: box.top,
        paths: paths.map(
          (
            path: SVGPathElement,
          ): { d: string | null; strokeWidth: string | null } => {
            return {
              d: path.getAttribute("d"),
              strokeWidth: path.getAttribute("stroke-width"),
            };
          },
        ),
        inkWidth: right - left,
        inkHeight: bottom - top,
        colour: getComputedStyle(svg).color,
        grounds: grounds,
      };
    });
  });
}

type DrawnColour = [number, number, number, number];

const COLOUR_CHANNELS: RegExp = /rgba?\(([^)]+)\)/;

function rgbaOf(colour: string): DrawnColour {
  const parts: Array<number> = (
    colour.match(COLOUR_CHANNELS)?.[1] || "0, 0, 0, 0"
  )
    .split(",")
    .map((part: string): number => {
      return Number(part.trim());
    });

  return [
    parts[0] || 0,
    parts[1] || 0,
    parts[2] || 0,
    parts[3] === undefined ? 1 : parts[3],
  ];
}

function drawnOver(colour: DrawnColour, ground: DrawnColour): DrawnColour {
  const alpha: number = colour[3];

  return [
    colour[0] * alpha + ground[0] * (1 - alpha),
    colour[1] * alpha + ground[1] * (1 - alpha),
    colour[2] * alpha + ground[2] * (1 - alpha),
    1,
  ];
}

function luminanceOf(colour: DrawnColour): number {
  const linear: Array<number> = colour.slice(0, 3).map((part: number) => {
    const value: number = part / 255;

    return value <= 0.03928
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

/*
 * How an icon stands out from what is behind it: the first solid ground
 * above it, with any see-through ones between laid over it, nearest last.
 */
function contrastOfIcon(icon: SwitchIcon): number {
  const grounds: Array<DrawnColour> = icon.grounds.map(rgbaOf);
  const solid: number = grounds.findIndex((ground: DrawnColour): boolean => {
    return ground[3] > 0.99;
  });
  let ground: DrawnColour =
    solid < 0 ? [255, 255, 255, 1] : (grounds[solid] as DrawnColour);

  for (
    let index: number = (solid < 0 ? grounds.length : solid) - 1;
    index >= 0;
    index--
  ) {
    ground = drawnOver(grounds[index] as DrawnColour, ground);
  }

  const drawn: DrawnColour = drawnOver(rgbaOf(icon.colour), ground);
  const lighter: number = Math.max(luminanceOf(drawn), luminanceOf(ground));
  const darker: number = Math.min(luminanceOf(drawn), luminanceOf(ground));

  return (lighter + 0.05) / (darker + 0.05);
}

test.describe("a monitor's Status Timeline", () => {
  test("opens on a month's timeline, reading that month's events and the one in effect when it began - never the whole history", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);

    const reads: Array<ListRequest> = await bandReads(page);

    expect(reads).toHaveLength(2);
    expect(reads[0]).toMatchObject({
      startsAt: {
        type: "InBetween",
        from: MONTH_BEFORE_NOW,
        to: NOW.toISOString(),
      },
      sort: { startsAt: "DESC" },
      skip: 0,
      limit: 500,
    });
    expect(reads[1]).toMatchObject({
      startsAt: { type: "LessThan", value: MONTH_BEFORE_NOW },
      sort: { startsAt: "DESC" },
      limit: 1,
    });

    // The cause and the log are read when asked for, not with every row.
    for (const read of await timelineReads(page)) {
      expect(read.selectKeys).not.toContain("rootCause");
      expect(read.selectKeys).not.toContain("statusChangeLog");
    }

    await expect(
      page.getByTestId("monitor-status-timeline-range-button"),
    ).toContainText("Past 1 Month");
    await screenshot(page, "monitor-month");
  });

  test("the band is drawn to scale: the status now runs to Now, and the legend sums the month", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);

    const band: { x: number; width: number } = await boxOf(
      page.getByTestId("status-timeline-band"),
    );
    const now: { x: number; width: number } = await boxOf(
      mark(page, NEWEST_OPERATIONAL),
    );

    // Operational since Oct 9, 07:26 BST: the last sixth of the month.
    const startsAt: number = Date.parse("2026-10-09T06:26:39.000Z");
    const fraction: number =
      (startsAt - Date.parse(MONTH_BEFORE_NOW)) / (30 * DAY_IN_MS);

    expect(Math.abs(now.x - (band.x + fraction * band.width))).toBeLessThan(3);
    expect(Math.abs(now.x + now.width - (band.x + band.width))).toBeLessThan(
      1.5,
    );
    await expect(mark(page, NEWEST_OPERATIONAL)).toHaveAttribute(
      "data-ongoing",
      "true",
    );
    await expect(page.getByTestId("status-timeline-now")).toBeVisible();

    await expect(legendItems(page)).toHaveText([
      "Operational99.96% · 29 days 23 hours",
      "Degraded<0.01% · 1 min 47 secs",
      "Offline0.04% · 15 mins 32 secs · 5 times",
    ]);
  });

  test("a 38-second outage is wide enough to see and to click, and clicking it shows its entry", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);

    const blip: Locator = mark(page, OFFLINE_38_SECONDS);

    await expect(blip).toHaveAttribute("data-widened", "true");

    // Drawn four pixels wide (give or take the sub-pixel the band's width leaves).
    const drawn: { x: number; y: number; width: number; height: number } =
      await boxOf(blip);

    expect(drawn.width).toBeGreaterThan(3.9);

    // Pointing at it says what it was.
    await blip.hover();
    const tooltip: Locator = page.getByRole("tooltip");
    await expect(tooltip).toContainText("Offline");
    await expect(tooltip).toContainText("38 secs");

    // A click a little beside it still finds it: four pixels are hard to hit.
    await page.mouse.move(0, 0);
    await page.mouse.click(
      drawn.x + drawn.width + 4,
      drawn.y + drawn.height / 2,
    );

    await expect(blip).toHaveAttribute("aria-pressed", "true");
    await expect(entry(page, OFFLINE_38_SECONDS)).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(entry(page, OFFLINE_38_SECONDS)).toBeInViewport();
  });

  test("changes too close to tell apart are one cluster: clicking it zooms in to them, and Reset zoom goes back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);

    const cluster: Locator = page
      .getByTestId("status-timeline-cluster")
      .filter({ has: page.locator(":scope") })
      .and(
        page.locator(
          `[data-entry-ids="${OCT_4_CHANGES.slice().reverse().join(",")}"], [data-entry-ids="${OCT_4_CHANGES.join(",")}"]`,
        ),
      );

    await expect(cluster).toHaveCount(1);
    await cluster.click();

    // The stretch of those changes is read, and the picker names it.
    await expect
      .poll(async () => {
        return (await bandReads(page)).length;
      })
      .toBeGreaterThan(2);

    const zoomed: ListRequest = (await bandReads(page))[2]!;

    expect(zoomed.startsAt!.type).toBe("InBetween");
    expect(
      Date.parse(zoomed.startsAt!.to!) - Date.parse(zoomed.startsAt!.from!),
    ).toBeLessThan(DAY_IN_MS);
    await expect(
      page.getByTestId("monitor-status-timeline-range-button"),
    ).not.toContainText("Past 1 Month");

    // Each change is its own segment now.
    for (const id of OCT_4_CHANGES) {
      await expect(mark(page, id)).toHaveCount(1);
    }

    await screenshot(page, "monitor-zoomed-cluster");

    await page.getByTestId("monitor-status-timeline-reset-zoom").click();

    await expect(
      page.getByTestId("monitor-status-timeline-range-button"),
    ).toContainText("Past 1 Month");
    await expect(
      page.getByTestId("monitor-status-timeline-reset-zoom"),
    ).toHaveCount(0);
  });

  test("dragging across the band zooms to the stretch dragged over", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);

    const band: { x: number; y: number; width: number; height: number } =
      await boxOf(page.getByTestId("status-timeline-band"));
    const y: number = band.y + band.height / 2;

    await page.mouse.move(band.x + band.width * 0.5, y);
    await page.mouse.down();
    await page.mouse.move(band.x + band.width * 0.6, y, { steps: 4 });
    await expect(page.getByTestId("status-timeline-drag-box")).toBeVisible();
    await page.mouse.move(band.x + band.width * 0.7, y, { steps: 4 });
    await page.mouse.up();

    await expect
      .poll(async () => {
        return (await bandReads(page)).length;
      })
      .toBeGreaterThan(2);

    const zoomed: ListRequest = (await bandReads(page))[2]!;
    const from: number = Date.parse(MONTH_BEFORE_NOW) + 0.5 * 30 * DAY_IN_MS;
    const to: number = Date.parse(MONTH_BEFORE_NOW) + 0.7 * 30 * DAY_IN_MS;

    // Within a pixel of where the drag began and ended.
    const pixel: number = (30 * DAY_IN_MS) / band.width;
    expect(Math.abs(Date.parse(zoomed.startsAt!.from!) - from)).toBeLessThan(
      2 * pixel,
    );
    expect(Math.abs(Date.parse(zoomed.startsAt!.to!) - to)).toBeLessThan(
      2 * pixel,
    );
    await expect(
      page.getByTestId("monitor-status-timeline-reset-zoom"),
    ).toBeVisible();
  });

  test("the period is picked as every time range is, with the period before and after a click away", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);

    await expect(
      page.getByTestId("monitor-status-timeline-later"),
    ).toBeDisabled();

    await page.getByTestId("monitor-status-timeline-range-button").click();
    await page
      .getByRole("button", { name: "Past 1 Week", exact: true })
      .click();

    await expect
      .poll(async () => {
        return (await bandReads(page)).length;
      })
      .toBe(4);

    const week: ListRequest = (await bandReads(page))[2]!;

    expect(
      Date.parse(week.startsAt!.to!) - Date.parse(week.startsAt!.from!),
    ).toBe(7 * DAY_IN_MS);

    await page.getByTestId("monitor-status-timeline-earlier").click();

    await expect
      .poll(async () => {
        return (await bandReads(page)).length;
      })
      .toBe(6);

    const before: ListRequest = (await bandReads(page))[4]!;

    expect(before.startsAt!.to).toBe(week.startsAt!.from);
    await expect(
      page.getByTestId("monitor-status-timeline-later"),
    ).toBeEnabled();

    await page.getByTestId("monitor-status-timeline-later").click();

    await expect
      .poll(async () => {
        return (await bandReads(page)).length;
      })
      .toBe(8);
    expect((await bandReads(page))[6]!.startsAt!.to).toBe(week.startsAt!.to);
  });

  test("under the list, the period before is one click away - where a table had its next page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);

    await page.getByTestId("status-timeline-show-earlier").click();

    await expect
      .poll(async () => {
        return (await bandReads(page)).length;
      })
      .toBe(4);
    expect((await bandReads(page))[2]!.startsAt!.to).toBe(MONTH_BEFORE_NOW);
  });

  test("View cause reads the cause when asked, and shows it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);

    await entry(page, OFFLINE_38_SECONDS)
      .getByTestId("monitor-status-timeline-view-cause")
      .click();

    const dialog: Locator = page.getByRole("dialog");

    await expect(dialog).toContainText("Root Cause");
    await expect(dialog).toContainText(
      "Response status code is 503, which is not 200.",
    );
    expect((await fixture(page)).itemRequests).toContainEqual({
      tableName: "MonitorStatusTimeline",
      id: OFFLINE_38_SECONDS,
      selectKeys: ["rootCause"],
    });
  });

  test("an entry's ⋯ holds Show ID, View Logs and Delete - View cause is on its line, not twice; View Logs shows what the check recorded", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);

    const menu: Locator = await openEntryMenu(page, OFFLINE_38_SECONDS);

    await expect(menu.getByRole("menuitem")).toHaveText([
      "Show ID",
      "View Logs",
      "Delete",
    ]);
    await expect(
      entry(page, OFFLINE_38_SECONDS).getByTestId(
        "monitor-status-timeline-view-cause",
      ),
    ).toBeVisible();

    await menu.getByRole("menuitem", { name: "View Logs" }).click();

    const dialog: Locator = page.getByRole("dialog");

    await expect(dialog).toContainText('"responseCode": 503');
    expect((await fixture(page)).itemRequests).toContainEqual({
      tableName: "MonitorStatusTimeline",
      id: OFFLINE_38_SECONDS,
      selectKeys: ["statusChangeLog"],
    });
  });

  test("Delete asks first, naming the event and what deleting it does, then deletes that one event", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);

    await expect(offlineInLegend(page)).toContainText("5 times");

    const menu: Locator = await openEntryMenu(page, OFFLINE_38_SECONDS);
    await menu.getByRole("menuitem", { name: "Delete" }).click();

    const dialog: Locator = page.getByRole("dialog");

    await expect(dialog).toContainText(
      "Are you sure you want to delete the Offline status event that started",
    );
    await expect(dialog).toContainText(
      "Operational, the status before it, takes over its time.",
    );
    await screenshot(page, "monitor-delete-dialog", false);

    await dialog.getByRole("button", { name: "Delete" }).click();

    await expect(entry(page, OFFLINE_38_SECONDS)).toHaveCount(0);
    expect((await fixture(page)).deletes).toEqual([
      { tableName: "MonitorStatusTimeline", id: OFFLINE_38_SECONDS },
    ]);
    // One outage fewer in the month.
    await expect(offlineInLegend(page)).toContainText("4 times");
  });

  test("the monitor's only event: Delete locked, saying why in the server's words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page, "?scenario=new");

    const menu: Locator = await openEntryMenu(page, eventId(1));
    const remove: Locator = menu.getByRole("menuitem", { name: "Delete" });

    await expect(remove).toHaveAttribute("aria-disabled", "true");
    await remove.hover();
    await expect(page.getByRole("tooltip")).toContainText(
      MONITOR_ONLY_EVENT_REFUSAL,
    );
    expect((await fixture(page)).deletes).toEqual([]);
  });

  test("Create Monitor Status Event: the status and when it began, and the new status is the monitor's now", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);

    await page
      .getByRole("button", { name: "Create Monitor Status Event" })
      .first()
      .click();

    const dialog: Locator = page.getByRole("dialog");

    await expect(dialog).toContainText("Monitor Status");
    await expect(dialog).toContainText("Starts At");

    // A minute goes by filling it in: the new status has begun by then.
    await page.clock.setFixedTime(new Date(NOW.getTime() + 60 * 1000));
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: "Degraded", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Create Monitor Status Event" })
      .click();

    await expect(dialog).toHaveCount(0);
    expect((await fixture(page)).creates).toEqual([
      {
        tableName: "MonitorStatusTimeline",
        state: "Degraded",
        startsAt: expect.any(String),
        recordId: "60000000-0000-4000-8000-000000000001",
      },
    ]);

    const current: Locator = page.locator(
      '[data-testid="status-timeline-entry"][data-ongoing="true"]',
    );

    await expect(current).toHaveCount(1);
    await expect(current.getByTestId("status-timeline-entry-name")).toHaveText(
      "Degraded",
    );
  });

  test("a member who may not create or delete sees both locked, saying which permission is missing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page, "?role=viewer");

    const create: Locator = page
      .getByRole("button", { name: "Create Monitor Status Event" })
      .first();

    await expect(create).toBeDisabled();
    await create.hover({ force: true });
    await expect(page.getByRole("tooltip")).toContainText("permission");

    await page.mouse.move(0, 0);
    const menu: Locator = await openEntryMenu(page, OFFLINE_38_SECONDS);
    const remove: Locator = menu.getByRole("menuitem", { name: "Delete" });

    await expect(remove).toHaveAttribute("aria-disabled", "true");
    expect((await fixture(page)).deletes).toEqual([]);
  });

  test("by keyboard: the band is one tab stop, the arrow keys move along it, Enter shows the entry", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);

    const stop: Locator = page
      .getByTestId("status-timeline-band")
      .locator('[tabindex="0"]');

    await expect(stop).toHaveCount(1);
    await stop.focus();

    const first: string | null = await stop.getAttribute("aria-label");

    await page.keyboard.press("ArrowLeft");

    const focused: Locator = page.locator(":focus");
    const second: string | null = await focused.getAttribute("aria-label");

    expect(second).not.toBe(first);
    await expect(focused).toHaveAttribute("tabindex", "0");

    await page.keyboard.press("End");
    await expect(page.locator(":focus")).toHaveAttribute(
      "data-entry-ids",
      NEWEST_OPERATIONAL,
    );

    await page.keyboard.press("Enter");
    await expect(entry(page, NEWEST_OPERATIONAL)).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  test("Table shows the table it was, and the choice is remembered; Timeline brings the timeline back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);

    await page.getByTestId("status-timeline-view-table").click();

    await expect(page.getByTestId("status-timeline-band")).toHaveCount(0);
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await screenshot(page, "monitor-table-view", false);

    await page.reload();

    await expect(page.locator("tbody tr").first()).toBeVisible();
    await expect(
      page.getByTestId("status-timeline-view-table"),
    ).toHaveAttribute("aria-pressed", "true");

    await page.getByTestId("status-timeline-view-timeline").click();

    await expect(page.getByTestId("status-timeline-band")).toBeVisible();
  });

  test("a month of flapping: the newest 500 changes are drawn, the stretch before them says so, and Load reads the rest", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page, "?scenario=flapping");

    const notLoaded: Locator = page.locator(
      '[data-testid="status-timeline-gap"][data-kind="not-loaded"]',
    );

    await expect(notLoaded).toHaveCount(1);
    // 700 changes in the month: 500 drawn, 200 before them not loaded.
    await expect(notLoaded).toContainText("200 older changes not loaded");
    await screenshot(page, "monitor-flapping", false);

    await page.getByTestId("status-timeline-gap-load-older").click();

    await expect(notLoaded).toHaveCount(0);

    const reads: Array<ListRequest> = await bandReads(page);

    expect(reads[reads.length - 1]).toMatchObject({
      skip: 500,
      limit: 500,
      startsAt: { type: "InBetween" },
    });
  });

  test("a new monitor: its one status since it began, and nothing earlier to show", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page, "?scenario=new");

    await expect(page.getByTestId("status-timeline-entry")).toHaveCount(1);
    await expect(
      page.getByTestId("monitor-status-timeline-earlier"),
    ).toBeDisabled();
    await expect(page.getByTestId("status-timeline-show-earlier")).toHaveCount(
      0,
    );
    await expect(
      page.locator('[data-testid="status-timeline-gap"][data-kind="no-data"]'),
    ).toHaveCount(1);
    await expect(legendItems(page)).toHaveText(["Operational100% · 1 hour"]);
  });

  test("a monitor with no status yet says so, and offers Create where the reader looks", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${MONITOR_ROUTE}?scenario=empty`);

    await expect(page.getByTestId("status-timeline-empty")).toContainText(
      "No status recorded for this monitor yet.",
    );
    await expect(
      page.getByTestId("monitor-status-timeline-empty-create-button"),
    ).toBeVisible();
    // With no history there is no period to move through.
    await expect(
      page.getByTestId("monitor-status-timeline-window-controls"),
    ).toHaveCount(0);
  });

  test("a read that fails says why, keeps the period to move on from, and reads again when asked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${MONITOR_ROUTE}?fail=timeline`);

    await expect(page.getByTestId("card")).toContainText(
      "Error connecting to server. Please try again in a few minutes.",
    );
    await expect(page.getByTestId("status-timeline-band")).toHaveCount(0);
    await expect(
      page.getByTestId("monitor-status-timeline-window-controls"),
    ).toBeVisible();

    const reads: number = (await bandReads(page)).length;

    await page.getByTestId("refresh-button").click();

    await expect
      .poll(async () => {
        return (await bandReads(page)).length;
      })
      .toBeGreaterThan(reads);
  });

  test("a blip shorter than a minute is named to the second for a screen reader, never 7:26 – 7:26", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);

    await expect(mark(page, OFFLINE_38_SECONDS)).toHaveAttribute(
      "aria-label",
      BLIP_LABEL,
    );
  });

  test("on a phone, a zoomed period keeps both arrows beside its picker, cut short rather than wrapped", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openMonitor(page);

    await page.getByTestId("status-timeline-cluster").first().click();
    await expect(
      page.getByTestId("monitor-status-timeline-reset-zoom"),
    ).toBeVisible();

    const earlier: { x: number; y: number; width: number } = await boxOf(
      page.getByTestId("monitor-status-timeline-earlier"),
    );
    const picker: { x: number; y: number; width: number } = await boxOf(
      page.getByTestId("monitor-status-timeline-range-button"),
    );
    const later: { x: number; y: number; width: number } = await boxOf(
      page.getByTestId("monitor-status-timeline-later"),
    );

    // One line: earlier, the period, later.
    expect(Math.abs(later.y - earlier.y)).toBeLessThan(2);
    expect(picker.x).toBeGreaterThan(earlier.x + earlier.width);
    expect(later.x).toBeGreaterThanOrEqual(picker.x + picker.width);
    expect(later.x + later.width).toBeLessThanOrEqual(390 - 16);
    // The whole period is the picker's tooltip.
    expect(
      await page
        .getByTestId("monitor-status-timeline-range-button")
        .getAttribute("title"),
    ).toContain(" – ");

    const widths: { scroll: number; client: number } = await page.evaluate(
      () => {
        return {
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        };
      },
    );

    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    await screenshot(page, "monitor-phone-zoomed", false);
  });

  test("in the light theme, every word the timeline writes reads at AA, as drawn", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);

    expect(await unreadableWords(page)).toEqual([]);
  });

  test("on a phone: nothing runs off the screen, and every entry keeps its actions", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openMonitor(page);

    const widths: { scroll: number; client: number } = await page.evaluate(
      () => {
        return {
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        };
      },
    );

    expect(widths.scroll).toBeLessThanOrEqual(widths.client);

    const band: { x: number; width: number } = await boxOf(
      page.getByTestId("status-timeline-band"),
    );

    expect(band.x).toBeGreaterThanOrEqual(16);
    expect(band.x + band.width).toBeLessThanOrEqual(390 - 16);

    for (const item of await legendItems(page).all()) {
      const box: { x: number; width: number } = await boxOf(item);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }

    const newest: Locator = entry(page, NEWEST_OPERATIONAL);
    await expect(
      newest.getByTestId("row-actions-more-button"),
    ).toBeInViewport();
    await expect(
      newest.getByTestId("monitor-status-timeline-view-cause"),
    ).toBeInViewport();

    // The axis' labels never run into each other.
    const ticks: Array<{ x: number; width: number }> = [];
    for (const tick of await page
      .getByTestId("status-timeline-axis")
      .locator("span")
      .all()) {
      ticks.push(await boxOf(tick));
    }
    ticks.sort((a: { x: number }, b: { x: number }) => {
      return a.x - b.x;
    });
    for (let index: number = 1; index < ticks.length; index++) {
      expect(ticks[index]!.x).toBeGreaterThanOrEqual(
        ticks[index - 1]!.x + ticks[index - 1]!.width,
      );
    }

    await screenshot(page, "monitor-phone");
  });

  test("in the dark theme, every word the timeline writes reads at AA, as drawn", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page, "?theme=dark");

    const unreadable: Array<UnreadableWords> = await unreadableWords(page);

    expect(unreadable).toEqual([]);

    // The card is the dark theme's, not a white box on a slate page.
    const ground: string = await page
      .getByTestId("status-timeline-band")
      .evaluate((element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      });

    expect(ground).not.toBe("rgb(243, 244, 246)");
    await screenshot(page, "monitor-dark");
  });
});

test.describe("a monitor's Status Timeline in German", () => {
  test("the timeline's own words are the reader's language", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page, "?lang=de");

    await expect(page.getByTestId("status-timeline-view-timeline")).toHaveText(
      "Zeitachse",
    );
    await expect(page.getByTestId("status-timeline-view-table")).toHaveText(
      "Tabelle",
    );
    await expect(page.getByTestId("status-timeline-now")).toHaveText("Jetzt");
    await expect(
      entry(page, OFFLINE_38_SECONDS).getByTestId(
        "monitor-status-timeline-view-cause",
      ),
    ).toHaveText("Ursache anzeigen");
    await expect(page.getByTestId("status-timeline-show-earlier")).toHaveText(
      "Den Zeitraum davor anzeigen",
    );
    await expect(
      page.getByRole("group", { name: "Verlauf anzeigen als" }),
    ).toBeVisible();
    await screenshot(page, "monitor-german", false);
  });
});

/*
 * "Timeline icon should be better and more relevant" (the maintainer): the
 * switch drew a bar chart for Timeline. Each view now shows a picture of
 * itself - the timeline its stretches of time stepping along
 * (IconProp.Timeline), the table its grid - measured here as Chromium draws
 * them, in both themes and whichever view is shown.
 */
test.describe("the Timeline | Table switch's icons", () => {
  for (const theme of ["light", "dark"]) {
    test(`${theme} theme: each view draws a picture of itself, the two the same size, and each stands out from the switch whichever view is shown`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openMonitor(page, theme === "dark" ? "?theme=dark" : "");

      for (const shown of ["timeline", "table"]) {
        if (shown === "table") {
          await page.getByTestId("status-timeline-view-table").click();
          await expect(
            page.getByTestId("status-timeline-view-table"),
          ).toHaveAttribute("aria-pressed", "true");
        }

        const icons: Array<SwitchIcon> = await switchIcons(page);
        const timeline: SwitchIcon = icons[0]!;
        const table: SwitchIcon = icons[1]!;

        // The timeline's steps, drawn as bars; the table's grid.
        expect(timeline.paths).toEqual([
          { d: TIMELINE_ICON_PATH, strokeWidth: "3" },
        ]);
        expect(table.paths).toHaveLength(1);
        expect(table.paths[0]!.d!.startsWith(TABLE_ICON_PATH_START)).toBe(true);

        // Both 16px, side by side on one line.
        expect([timeline.width, timeline.height]).toEqual([16, 16]);
        expect([table.width, table.height]).toEqual([16, 16]);
        expect(Math.abs(timeline.top - table.top)).toBeLessThan(0.5);

        // The same size to the eye: the timeline fills the table's box.
        for (const ratio of [
          timeline.inkWidth / table.inkWidth,
          timeline.inkHeight / table.inkHeight,
        ]) {
          expect(ratio).toBeGreaterThanOrEqual(0.85);
          expect(ratio).toBeLessThanOrEqual(1.1);
        }

        for (const icon of icons) {
          const contrast: number = contrastOfIcon(icon);

          expect({
            view: icon.view,
            shown: shown,
            standsOut: contrast >= NON_TEXT_CONTRAST,
          }).toEqual({ view: icon.view, shown: shown, standsOut: true });
        }

        await fs.mkdir(SCREENSHOTS, { recursive: true });
        await page.getByTestId("status-timeline-view-switch").screenshot({
          path: path.join(
            SCREENSHOTS,
            `view-switch-${theme}-${shown}-shown-synthetic.png`,
          ),
          animations: "disabled",
        });
      }
    });
  }
});

test.describe("an incident's State Timeline", () => {
  /*
   * "There are buttons which do not match the sizes" - the switch stood
   * 32px beside the 38px Create State Change and ⋯ in the card's header,
   * in both views. It is their height now: 38px, and 42px on a phone.
   */
  test("the Timeline | Table switch is as tall as the buttons beside it, in both views and on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    const heightsInHeader: () => Promise<Array<number>> = async (): Promise<
      Array<number>
    > => {
      const switchBox: { height: number } = await boxOf(
        page.getByTestId("status-timeline-view-switch"),
      );
      const actions: Locator = page.getByTestId("card-header-actions").filter({
        has: page.getByTestId("status-timeline-view-switch"),
      });
      const buttons: Array<Locator> = await actions
        .getByRole("button", { name: INCIDENT_HEADER_BUTTON_NAME })
        .all();

      expect(buttons).toHaveLength(2);

      const heights: Array<number> = [Math.round(switchBox.height)];

      for (const button of buttons) {
        heights.push(Math.round((await boxOf(button)).height));
      }

      return heights;
    };

    await page.setViewportSize({ width: 1280, height: 900 });
    await openIncident(page);
    expect(await heightsInHeader()).toEqual([38, 38, 38]);

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await heightsInHeader()).toEqual([42, 42, 42]);

    await page.getByTestId("status-timeline-view-table").click();
    await expect(
      page.getByTestId("status-timeline-view-table"),
    ).toHaveAttribute("aria-pressed", "true");
    expect(await heightsInHeader()).toEqual([42, 42, 42]);

    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await heightsInHeader()).toEqual([38, 38, 38]);
    await screenshot(page, "incident-header-switch-table-1280");
  });

  test("its whole life on one band, with no period to pick, and each state's whole time", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openIncident(page);

    const reads: Array<ListRequest> = await bandReads(page);

    expect(reads).toHaveLength(1);
    expect(reads[0]!.startsAt).toBeNull();
    await expect(
      page.getByTestId("incident-status-timeline-window-controls"),
    ).toHaveCount(0);
    await expect(legendItems(page)).toHaveText([
      "Created12 mins",
      "Acknowledged1 hour 48 mins",
      "Resolved21 days",
    ]);
    await screenshot(page, "incident-resolved");
  });

  test("under each state change, whether status page subscribers were told, with Retry", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openIncident(page);

    const acknowledged: Locator = entry(
      page,
      "42000000-0000-4000-8000-000000000002",
    );
    const notification: Locator = acknowledged.getByTestId(
      "state-timeline-subscriber-notification",
    );

    await expect(notification).toContainText("Status page subscribers:");
    await expect(notification).toContainText("Failed");

    await notification.getByRole("button", { name: "more details" }).click();
    await page.getByTestId("modal-footer-submit-button").click();

    await expect
      .poll(async () => {
        return (await fixture(page)).updates;
      })
      .toEqual([
        {
          tableName: "IncidentStateTimeline",
          id: "42000000-0000-4000-8000-000000000002",
          data: {
            subscriberNotificationStatus: "Pending",
            subscriberNotificationStatusMessage: null,
          },
        },
      ]);
  });

  test("an incident still open runs to Now", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openIncident(page, "scenario=ongoing");

    await expect(page.getByTestId("status-timeline-now")).toBeVisible();
    await expect(
      page.locator(
        '[data-testid="status-timeline-entry"][data-ongoing="true"]',
      ),
    ).toContainText("Acknowledged");
    await screenshot(page, "incident-ongoing", false);
  });

  test("an incident moved on to a state its project placed after Resolved is done: its band ends, not at Now", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openIncident(page, "scenario=closed");

    // "Closed" carries no flag; its place after Resolved makes it resolved.
    await expect(
      page.locator(
        '[data-testid="status-timeline-entry"][data-ongoing="true"]',
      ),
    ).toContainText("Closed");
    await expect(page.getByTestId("status-timeline-now")).toHaveCount(0);
    expect(
      (await fixture(page)).listRequests.some(
        (request: ListRequest): boolean => {
          return request.tableName === "IncidentState";
        },
      ),
    ).toBe(true);
  });

  test("every word reads at AA as drawn, the subscriber notification under each change included, in both themes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openIncident(page);

    // A failed send says so in red, with its details one click away.
    await expect(
      page.getByTestId("subscriber-notification-more-details"),
    ).toBeVisible();
    expect(await unreadableWords(page)).toEqual([]);

    await openIncident(page, "theme=dark");
    expect(await unreadableWords(page)).toEqual([]);
    await screenshot(page, "incident-dark");
  });

  test("the subscriber notification under each change is in the reader's language", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openIncident(page, "lang=de");

    const notifications: Locator = page.getByTestId(
      "state-timeline-subscriber-notification",
    );

    await expect(notifications.first()).toContainText(
      "Gesendete Benachrichtigungen",
    );
    await expect(
      page.getByText("Notifications Sent", { exact: true }),
    ).toHaveCount(0);
  });

  test("the incident's only state: Delete locked, in the server's words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openIncident(page, "scenario=declared");

    const menu: Locator = await openEntryMenu(
      page,
      "42000000-0000-4000-8000-000000000001",
    );

    await expect(
      menu.getByRole("menuitem", { name: "Delete" }),
    ).toHaveAttribute("aria-disabled", "true");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The other five status timeline pages
 * ---------------------------------------------------------------------------
 *
 * An alert's, a scheduled maintenance event's, the two kinds of episode's
 * and a network site's history open on the same timeline, each with what
 * its table had: Create where the table had it, the subscriber notification
 * under a maintenance event's changes, a site's month and no actions.
 */

interface OtherPage {
  name: string;
  page: string;
  // The legend, each state with its time, in the order the record went.
  legend: Array<string>;
  // The band runs on to Now: the record is still open, or a period ends now.
  runsToNow: boolean;
  // Create, as the table offered it.
  createLabel: string | null;
  // The status page subscribers line under each change.
  subscriberLines: number;
  // A period to move through, rather than the record's whole life.
  hasPeriod: boolean;
  screenshot: string;
}

const OTHER_PAGES: Array<OtherPage> = [
  {
    name: "an alert's, still open",
    page: "alert",
    legend: ["Created9 mins", "Acknowledged31 mins"],
    runsToNow: true,
    createLabel: "Create State Change",
    subscriberLines: 0,
    hasPeriod: false,
    screenshot: "alert-ongoing",
  },
  {
    name: "a scheduled maintenance event's, completed",
    page: "maintenance",
    legend: [
      "Scheduled2 days 14 hours",
      "Ongoing2 hours",
      "Ended5 mins",
      "Completed7 hours 55 mins",
    ],
    // Completed eight hours ago, after a two-and-a-half-day life: recent.
    runsToNow: true,
    createLabel: "Create State Change",
    subscriberLines: 4,
    hasPeriod: false,
    screenshot: "maintenance-completed",
  },
  {
    name: "an incident episode's, resolved a day ago",
    page: "incident-episode",
    legend: [
      "Created20 mins",
      "Acknowledged2 hours 40 mins",
      "Resolved1 day 1 hour",
    ],
    runsToNow: false,
    createLabel: "Create State Change",
    subscriberLines: 0,
    hasPeriod: false,
    screenshot: "incident-episode-resolved",
  },
  {
    name: "an alert episode's, still open",
    page: "alert-episode",
    legend: ["Created30 mins", "Acknowledged4 hours 30 mins"],
    runsToNow: true,
    createLabel: "Create State Change",
    subscriberLines: 0,
    hasPeriod: false,
    screenshot: "alert-episode-ongoing",
  },
  {
    name: "a network site's month",
    page: "site",
    legend: [
      "Operational99.18% · 29 days 18 hours",
      "Degraded0.72% · 5 hours 10 mins · 2 times",
      "Offline0.1% · 44 mins 12 secs · 2 times",
    ],
    runsToNow: true,
    createLabel: null,
    subscriberLines: 0,
    hasPeriod: true,
    screenshot: "site-month",
  },
];

async function openOtherPage(
  page: Page,
  name: string,
  search: string = "",
): Promise<void> {
  await page.goto(
    `${INCIDENT_ROUTE}?page=${name}${search ? `&${search}` : ""}`,
  );
  await expect(page.getByTestId("status-timeline-band")).toBeVisible();
  await expect(page.getByTestId("status-timeline-loading")).toHaveCount(0);
}

test.describe("every other status timeline page", () => {
  for (const otherPage of OTHER_PAGES) {
    test(`${otherPage.name}: opens on its timeline, with what its table offered, and the table one click away`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openOtherPage(page, otherPage.page);

      await expect(legendItems(page)).toHaveText(otherPage.legend);
      await expect(page.getByTestId("status-timeline-now")).toHaveCount(
        otherPage.runsToNow ? 1 : 0,
      );
      await expect(
        page.locator('[data-testid$="-window-controls"]'),
      ).toHaveCount(otherPage.hasPeriod ? 1 : 0);
      await expect(
        page.getByTestId("state-timeline-subscriber-notification"),
      ).toHaveCount(otherPage.subscriberLines);

      const card: Locator = page
        .getByTestId("card")
        .filter({ has: page.getByTestId("status-timeline-band") });

      if (otherPage.createLabel) {
        await expect(
          card.getByRole("button", { name: otherPage.createLabel }),
        ).toBeVisible();
        // Each change keeps its ⋯, with Delete.
        await expect(
          page
            .getByTestId("status-timeline-entry")
            .first()
            .getByTestId("row-actions-more-button"),
        ).toBeVisible();
      } else {
        // A site's history is its rollup's: nothing to add or delete.
        await expect(card.getByRole("button", { name: /^Create/ })).toHaveCount(
          0,
        );
        await expect(page.getByTestId("row-actions-more-button")).toHaveCount(
          0,
        );
      }

      // Every word reads at AA as drawn, the subscriber line included.
      if (otherPage.page !== "site") {
        expect(await unreadableWords(page)).toEqual([]);
      }

      await screenshot(page, otherPage.screenshot);

      await page.getByTestId("status-timeline-view-table").click();
      await expect(page.locator("table")).toBeVisible();
      await expect(page.getByTestId("status-timeline-band")).toHaveCount(0);
      await page.getByTestId("status-timeline-view-timeline").click();
      await expect(page.getByTestId("status-timeline-band")).toBeVisible();
    });

    test(`${otherPage.name}: on a phone, nothing runs off the screen`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openOtherPage(page, otherPage.page);

      const widths: { scroll: number; client: number } = await page.evaluate(
        () => {
          return {
            scroll: document.documentElement.scrollWidth,
            client: document.documentElement.clientWidth,
          };
        },
      );

      expect(widths.scroll).toBeLessThanOrEqual(widths.client);

      const band: { x: number; width: number } = await boxOf(
        page.getByTestId("status-timeline-band"),
      );

      expect(band.x + band.width).toBeLessThanOrEqual(390 - 16);
      await screenshot(page, `${otherPage.screenshot}-phone`);
    });
  }

  test("a maintenance event in progress runs on to Now", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOtherPage(page, "maintenance", "scenario=ongoing");

    await expect(page.getByTestId("status-timeline-now")).toBeVisible();
    await expect(
      page.locator(
        '[data-testid="status-timeline-entry"][data-ongoing="true"]',
      ),
    ).toContainText("Ongoing");
  });

  test("an alert resolved two days ago ends a little after it was resolved", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOtherPage(page, "alert", "scenario=resolved");

    await expect(page.getByTestId("status-timeline-now")).toHaveCount(0);
    // Its project's alert states were read to tell that Resolved is done.
    expect(
      (await fixture(page)).listRequests.some(
        (request: ListRequest): boolean => {
          return request.tableName === "AlertState";
        },
      ),
    ).toBe(true);
  });
});
