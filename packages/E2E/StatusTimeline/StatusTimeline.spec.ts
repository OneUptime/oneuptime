import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * A monitor's and an incident's Status Timeline, in a browser, against the
 * offline fixture (StatusTimeline/Fixture).
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
      "Operational99.91% · 29 days 23 hours",
      "Offline0.09% · 41 mins 1 sec · 7 times",
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

  test("an entry's ⋯ holds Show ID, View Cause, View Logs and Delete; View Logs shows what the check recorded", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);

    const menu: Locator = await openEntryMenu(page, OFFLINE_38_SECONDS);

    await expect(menu.getByRole("menuitem")).toHaveText([
      "Show ID",
      "View Cause",
      "View Logs",
      "Delete",
    ]);

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
    await expect(legendItems(page).nth(1)).toContainText("6 times");
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

    const unreadable: Array<{ words: string; contrast: number }> =
      await page.evaluate(() => {
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
            const ground: Rgba = parse(
              getComputedStyle(current).backgroundColor,
            );

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

          return (
            0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
          );
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

test.describe("an incident's Status Timeline", () => {
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
