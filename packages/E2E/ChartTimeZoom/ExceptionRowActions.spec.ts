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
 * Each exception's ⋯ menu on the exceptions list: Resolve or Reopen,
 * Archive or Unarchive, as the exception's own page offers them in its
 * header - and the row it sits in, on a desktop and on a phone.
 *
 * "Please also check the entire product for missing things in more menu
 * just like this and build those as well." - the maintainer.
 *
 * The production exceptions explorer runs on the offline fixture
 * (Fixture/Fixture.js), whose five exception groups are all unresolved. On a
 * phone the status pill leads the service line rather than sitting beside
 * the ⋯, so the exception's type and message keep the row's width.
 */

const PORT: string = process.env["CHART_TIME_ZOOM_FIXTURE_PORT"] || "4233";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const UNRESOLVED_PATH: string = `/dashboard/${PROJECT_ID}/exceptions/unresolved?range=Past%201%20Day`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/chart-time-zoom-ui",
);

interface RecordedRequest {
  kind: string;
  modelName?: string | undefined;
  id?: string | undefined;
  body?: Record<string, unknown> | undefined;
}

interface SpecWindow {
  __chartTimeZoomFixture: {
    requests: Array<RecordedRequest>;
    unhandled: Array<Record<string, unknown>>;
  };
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
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
    await route.abort();
  });

  // The fixture's moment, and a clock that keeps ticking from it.
  await page.clock.install({ time: NOW });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    await page.evaluate((): Array<Record<string, unknown>> => {
      return JSON.parse(
        JSON.stringify(
          (window as unknown as SpecWindow).__chartTimeZoomFixture.unhandled,
        ),
      ) as Array<Record<string, unknown>>;
    }),
    "requests the fixture does not model",
  ).toEqual([]);
});

async function open(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width: width, height: 1000 });
  await page.goto(UNRESOLVED_PATH);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(page.getByText("DeadlineExceededError").first()).toBeVisible();
}

// An exception's row on the list: the button that opens it and its ⋯.
function exceptionRow(page: Page, type: string): Locator {
  return page
    .locator("div.group")
    .filter({ has: page.getByTestId("exception-row-actions") })
    .filter({ hasText: type });
}

async function updates(page: Page): Promise<Array<RecordedRequest>> {
  return await page.evaluate((): Array<RecordedRequest> => {
    return (
      JSON.parse(
        JSON.stringify(
          (window as unknown as SpecWindow).__chartTimeZoomFixture.requests,
        ),
      ) as Array<RecordedRequest>
    ).filter((request: RecordedRequest): boolean => {
      return request.kind === "updateById";
    });
  });
}

// The box beside an exception's row, that ticks it for Bulk Actions.
function rowBox(page: Page, type: string): Locator {
  return page
    .locator("li")
    .filter({ has: exceptionRow(page, type) })
    .getByTestId("telemetry-viewer-select-row");
}

// What the list's header line says is selected, once rows are ticked.
function selectedCount(page: Page): Locator {
  return page.getByTestId("bulk-update-selected-count");
}

function clearSelection(page: Page): Locator {
  return page.getByRole("button", { name: "Clear Selection" });
}

// Where an element sits, to the pixel, in one frame.
async function topOf(locator: Locator): Promise<number> {
  const box: { y: number } | null = await locator.boundingBox();

  return Math.round(box!.y);
}

async function scrollsSideways(page: Page): Promise<boolean> {
  return await page.evaluate((): boolean => {
    return (
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1
    );
  });
}

test.describe("an exception's ⋯ menu on the exceptions list", () => {
  test("offers Resolve and Archive on an unresolved exception, and Resolve takes it off the Unresolved list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, 1440);

    const deadline: Locator = exceptionRow(page, "DeadlineExceededError");

    await deadline.getByTestId("row-actions-more-button").click();

    const menu: Locator = page.getByRole("menu");

    await expect(menu).toBeVisible();
    // And, since #5422, Assign to me.
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Resolve",
      "Archive",
      "Assign to me",
    ]);

    await menu.getByRole("menuitem", { name: "Resolve", exact: true }).click();

    // Only the switch is sent; the server records who turned it and when.
    await expect
      .poll(async (): Promise<Array<Record<string, unknown>>> => {
        return (await updates(page)).map(
          (request: RecordedRequest): Record<string, unknown> => {
            return {
              modelName: request.modelName,
              body: request.body,
            };
          },
        );
      })
      .toEqual([
        { modelName: "TelemetryException", body: { isResolved: true } },
      ]);

    // Read again, a resolved exception has left the Unresolved list.
    await expect(exceptionRow(page, "DeadlineExceededError")).toHaveCount(0);
    await expect(exceptionRow(page, "TypeError")).toHaveCount(1);
  });

  test("at 1440 the status sits at the row's top right, beside the ⋯", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, 1440);

    const deadline: Locator = exceptionRow(page, "DeadlineExceededError");
    const corner: Locator = deadline.getByTestId("exception-row-status");

    await expect(corner).toBeVisible();
    await expect(corner).toHaveText("Unresolved");
    await expect(
      deadline.getByTestId("exception-row-status-inline"),
    ).toBeHidden();

    const pill: { x: number; y: number; width: number } | null =
      await corner.boundingBox();
    const more: { x: number; y: number; height: number } | null = await deadline
      .getByTestId("row-actions-more-button")
      .boundingBox();

    // On the ⋯'s line, just left of it.
    expect(pill!.x + pill!.width).toBeLessThanOrEqual(more!.x);
    expect(Math.abs(pill!.y - more!.y)).toBeLessThan(more!.height);
  });

  for (const theme of ["light", "dark"]) {
    test(`on a phone the status leads the service line, and the message keeps the row's width (${theme})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      if (theme === "dark") {
        await page.emulateMedia({ colorScheme: "dark" });
      }

      await page.setViewportSize({ width: 390, height: 1000 });
      await page.goto(
        `${UNRESOLVED_PATH}${theme === "dark" ? "&theme=dark" : ""}`,
      );
      await expect(page.getByTestId("synthetic-banner")).toBeVisible({
        timeout: 60000,
      });

      const deadline: Locator = exceptionRow(page, "DeadlineExceededError");

      await expect(deadline).toBeVisible();
      await expect(deadline.getByTestId("exception-row-status")).toBeHidden();

      const inline: Locator = deadline.getByTestId(
        "exception-row-status-inline",
      );

      await expect(inline).toBeVisible();
      await expect(inline).toHaveText("Unresolved");

      // The pill leads the line the service chip is on.
      const pill: { x: number; y: number; height: number } | null =
        await inline.boundingBox();
      const service: { x: number; y: number } | null = await deadline
        .getByText("checkout-api", { exact: true })
        .boundingBox();

      expect(pill!.x).toBeLessThan(service!.x);
      expect(Math.abs(pill!.y - service!.y)).toBeLessThan(pill!.height);

      // The service chip is one line: it never breaks inside.
      const chipLines: number = await deadline
        .getByText("checkout-api", { exact: true })
        .evaluate((element: Element): number => {
          // The lines its name's text takes (the dot beside it is no line).
          const tops: Set<number> = new Set<number>();
          const range: Range = document.createRange();
          for (const node of Array.from(element.childNodes)) {
            if (node.nodeType !== Node.TEXT_NODE) {
              continue;
            }
            range.selectNodeContents(node);
            for (const rect of Array.from(range.getClientRects())) {
              tops.add(Math.round(rect.top));
            }
          }
          return tops.size;
        });

      expect(chipLines).toBe(1);

      // The type and message take the row's width, not what the pill left.
      const button: { width: number } | null = await deadline
        .locator("button")
        .first()
        .boundingBox();
      const row: { width: number } | null = await deadline.boundingBox();

      expect(button!.width).toBeGreaterThan(row!.width * 0.8);
      expect(await scrollsSideways(page)).toBe(false);

      await fs.mkdir(SCREENSHOTS, { recursive: true });
      await deadline.screenshot({
        path: path.join(SCREENSHOTS, `exception-row-390-${theme}.png`),
        animations: "disabled",
      });
    });
  }
});

/*
 * Bulk Actions on the exceptions list: the rows had a ⋯ each and no
 * selection (#5248's follow-up). A box beside each row and one for the
 * page tick exceptions, and the list's header line - how many, a × to let
 * go of them, Bulk Actions at its end - resolves, reopens, archives or
 * unarchives them in one go, one request each, as each row's own action
 * would. The line is as tall ticked as not: ticking the first row moves no
 * row.
 */
test.describe("Bulk Actions on the exceptions list", () => {
  test("two ticked exceptions are resolved in one go, and both leave the Unresolved list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, 1440);

    // Nothing ticked: the line names the page's box, and nothing else.
    await expect(clearSelection(page)).toHaveCount(0);
    await expect(selectedCount(page)).toHaveCount(0);

    await rowBox(page, "DeadlineExceededError").check();
    await rowBox(page, "TypeError").check();

    await expect(selectedCount(page)).toHaveText("2 selected");
    await expect(
      page.locator("li").filter({
        has: exceptionRow(page, "DeadlineExceededError"),
      }),
    ).toHaveAttribute("data-selected", "true");

    // The page's box reads part-ticked.
    expect(
      await page
        .getByTestId("telemetry-viewer-select-page")
        .evaluate((element: Element): boolean => {
          return (element as HTMLInputElement).indeterminate;
        }),
    ).toBe(true);

    await page.getByRole("button", { name: "Bulk Actions" }).click();
    const menu: Locator = page.getByRole("menu");
    /*
     * Both are unresolved and live: what they can take, and nothing else -
     * and, since #5422, Assign to… for the ticked exceptions.
     */
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Resolve",
      "Archive",
      "Assign to…",
    ]);

    await fs.mkdir(SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: path.join(SCREENSHOTS, "exceptions-bulk-menu-1440.png"),
      animations: "disabled",
    });

    await menu.getByRole("menuitem", { name: "Resolve", exact: true }).click();

    // One request each, the one switch, as the row's own Resolve sends it.
    await expect
      .poll(async (): Promise<Array<Record<string, unknown>>> => {
        return (await updates(page)).map(
          (request: RecordedRequest): Record<string, unknown> => {
            return {
              modelName: request.modelName,
              body: request.body,
            };
          },
        );
      })
      .toEqual([
        { modelName: "TelemetryException", body: { isResolved: true } },
        { modelName: "TelemetryException", body: { isResolved: true } },
      ]);

    const result: Locator = page.getByRole("dialog");
    // In the words of what was done, as an incident list's Resolve says it.
    await expect(result.getByText("2 Exceptions resolved")).toBeVisible();
    await page.screenshot({
      path: path.join(SCREENSHOTS, "exceptions-bulk-result-1440.png"),
      animations: "disabled",
    });
    await result.getByRole("button", { name: "Close" }).click();

    // Read again: both have left the Unresolved list, and nothing is ticked.
    await expect(exceptionRow(page, "DeadlineExceededError")).toHaveCount(0);
    await expect(exceptionRow(page, "TypeError")).toHaveCount(0);
    await expect(clearSelection(page)).toHaveCount(0);
  });

  for (const width of [1440, 390]) {
    test(`ticking the first exception moves no row: the header line says how many in its own height (${width})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: width, height: 1000 });
      await page.goto(UNRESOLVED_PATH);
      // The first load parses a large bundle.
      await expect(page.getByTestId("synthetic-banner")).toBeVisible({
        timeout: 60000,
      });

      const header: Locator = page.getByTestId("telemetry-viewer-bulk");
      const second: Locator = exceptionRow(page, "ConnectionResetError");

      // On a phone the facet sidebar is folded: wait for the rows themselves.
      await expect(exceptionRow(page, "DeadlineExceededError")).toBeVisible();
      await expect(second).toBeVisible();

      const headerBefore: { height: number } | null =
        await header.boundingBox();
      const secondBefore: number = await topOf(second);

      await rowBox(page, "DeadlineExceededError").check();
      await expect(selectedCount(page)).toHaveText("1 selected");

      const headerAfter: { height: number } | null = await header.boundingBox();

      expect(Math.round(headerAfter!.height)).toBe(
        Math.round(headerBefore!.height),
      );
      expect(await topOf(second)).toBe(secondBefore);

      // One line: the count and Bulk Actions side by side, the menu at the end.
      const count: { y: number; height: number } | null =
        await selectedCount(page).boundingBox();
      const actions: {
        x: number;
        y: number;
        width: number;
        height: number;
      } | null = await page
        .getByRole("button", { name: "Bulk Actions" })
        .boundingBox();
      const headerBox: { x: number; width: number } | null =
        await header.boundingBox();

      expect(
        Math.abs(
          count!.y + count!.height / 2 - (actions!.y + actions!.height / 2),
        ),
      ).toBeLessThanOrEqual(2);
      // Its end edge lines up with the rows' ⋯ menus.
      const more: { x: number; width: number } | null = await second
        .getByTestId("row-actions-more-button")
        .boundingBox();

      expect(
        Math.abs(actions!.x + actions!.width - (more!.x + more!.width)),
      ).toBeLessThanOrEqual(1);
      expect(headerBox!.x + headerBox!.width).toBeGreaterThan(
        actions!.x + actions!.width,
      );
      expect(await scrollsSideways(page)).toBe(false);
    });
  }

  test("the page's box, or the words beside it, ticks every exception on the page; Clear Selection clears them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, 1440);

    const rows: number = await page
      .getByTestId("telemetry-viewer-select-row")
      .count();
    expect(rows).toBeGreaterThan(1);

    // The words say what the box does, and a press on them ticks it.
    await page.getByText("Select all exceptions on this page").click();
    await expect(
      page.getByTestId("telemetry-viewer-select-page"),
    ).toBeChecked();
    await expect(selectedCount(page)).toHaveText(`${rows} selected`);
    for (const box of await page
      .getByTestId("telemetry-viewer-select-row")
      .all()) {
      await expect(box).toBeChecked();
    }

    // The count's ×, named Clear Selection, lets go of them all.
    await clearSelection(page).click();
    await expect(clearSelection(page)).toHaveCount(0);
    await expect(
      page.getByText("Select all exceptions on this page"),
    ).toBeVisible();
    for (const box of await page
      .getByTestId("telemetry-viewer-select-row")
      .all()) {
      await expect(box).not.toBeChecked();
    }

    // The box itself does the same.
    await page.getByTestId("telemetry-viewer-select-page").check();
    await expect(selectedCount(page)).toHaveText(`${rows} selected`);
  });

  for (const theme of ["light", "dark"]) {
    test(`on a phone each row's box sits at its start, level with its first line, and nothing scrolls sideways (${theme})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 390, height: 1000 });
      await page.goto(
        `${UNRESOLVED_PATH}${theme === "dark" ? "&theme=dark" : ""}`,
      );
      await expect(page.getByTestId("synthetic-banner")).toBeVisible({
        timeout: 60000,
      });

      const deadline: Locator = exceptionRow(page, "DeadlineExceededError");
      await expect(deadline).toBeVisible();

      const box: Locator = rowBox(page, "DeadlineExceededError");
      const boxRect: { x: number; y: number; height: number } | null =
        await box.boundingBox();
      const rowRect: { x: number; y: number } | null =
        await deadline.boundingBox();
      // The row's first line: the exception's type.
      const typeRect: { y: number; height: number } | null = await deadline
        .getByText("DeadlineExceededError", { exact: true })
        .boundingBox();

      // Before the row, and level with its first line.
      expect(boxRect!.x).toBeLessThan(rowRect!.x);
      expect(
        Math.abs(
          boxRect!.y +
            boxRect!.height / 2 -
            (typeRect!.y + typeRect!.height / 2),
        ),
      ).toBeLessThanOrEqual(3);

      await box.check();
      await expect(selectedCount(page)).toHaveText("1 selected");
      expect(await scrollsSideways(page)).toBe(false);

      await deadline.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(SCREENSHOTS, `exceptions-bulk-390-${theme}.png`),
        animations: "disabled",
      });

      await page
        .locator("li")
        .filter({ has: deadline })
        .screenshot({
          path: path.join(
            SCREENSHOTS,
            `exception-row-selected-390-${theme}.png`,
          ),
          animations: "disabled",
        });
    });
  }
});

/*
 * Every exception that matches, not only the page's: "Select every
 * matching exception across pages, not just the page shown" - the
 * maintainer's follow-up to #5344. Two to a page (pageSize=2), the
 * fixture's five unresolved exceptions are three pages. Once the page's
 * two are ticked, the header line offers all five, by number; taken, the
 * list's own read reads every match - its query, its columns, its order
 * with the exception's id after it - and the selection holds from page to
 * page. A quick move over it asks first, naming how many.
 */
test.describe("every exception that matches, not only the page's", () => {
  const TWO_A_PAGE: string = `${UNRESOLVED_PATH}&pageSize=2`;

  async function openTwoAPage(page: Page, width: number): Promise<void> {
    await page.setViewportSize({ width: width, height: 1000 });
    await page.goto(TWO_A_PAGE);
    await expect(page.getByTestId("synthetic-banner")).toBeVisible({
      timeout: 60000,
    });
    await expect(page.getByTestId("telemetry-viewer-select-row")).toHaveCount(
      2,
    );
  }

  function offer(page: Page): Locator {
    return page.getByTestId("bulk-update-select-all-matching");
  }

  async function exceptionReads(page: Page): Promise<Array<RecordedRequest>> {
    return await page.evaluate((): Array<RecordedRequest> => {
      return (
        JSON.parse(
          JSON.stringify(
            (window as unknown as SpecWindow).__chartTimeZoomFixture.requests,
          ),
        ) as Array<RecordedRequest & { modelName?: string }>
      ).filter((request: RecordedRequest): boolean => {
        return (
          request.kind === "getList" &&
          request.modelName === "TelemetryException"
        );
      });
    });
  }

  test("1440: Select all 5 exceptions reads the whole match with the list's own query, and holds from page to page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTwoAPage(page, 1440);

    // Some of the page: nothing more to offer yet.
    await rowBox(page, "DeadlineExceededError").check();
    await expect(offer(page)).toHaveCount(0);

    await page.getByTestId("telemetry-viewer-select-page").check();
    await expect(selectedCount(page)).toHaveText("2 selected");
    await expect(offer(page)).toHaveText("Select all 5 exceptions");

    await fs.mkdir(SCREENSHOTS, { recursive: true });
    await page.getByTestId("telemetry-viewer-list").screenshot({
      path: path.join(SCREENSHOTS, "exceptions-select-all-offer-1440.png"),
      animations: "disabled",
    });

    const before: Array<RecordedRequest> = await exceptionReads(page);
    const pageRead: RecordedRequest & { query?: unknown } = before[
      before.length - 1
    ] as RecordedRequest & { query?: unknown };

    await offer(page).click();

    await expect(selectedCount(page)).toHaveText("All 5 selected");
    await expect(offer(page)).toHaveCount(0);

    // One read of every match: the list's query, a thousand at a time.
    const reads: Array<
      RecordedRequest & {
        query?: unknown;
        limit?: number;
        skip?: number;
        sort?: Record<string, unknown>;
      }
    > = (await exceptionReads(page)).slice(before.length);

    expect(reads).toHaveLength(1);
    expect(reads[0]!.limit).toBe(1000);
    expect(reads[0]!.skip).toBe(0);
    expect(reads[0]!.query).toEqual(pageRead.query);
    // The list's order, then the exception's id: no page shares a row.
    expect(Object.keys(reads[0]!.sort || {})).toEqual(["lastSeenAt", "_id"]);

    // Page two: its exceptions are ticked too, and the count still says all.
    await page.getByTestId("pagination-next-button").click();
    await expect(exceptionRow(page, "IndexNotFoundException")).toBeVisible();
    for (const box of await page
      .getByTestId("telemetry-viewer-select-row")
      .all()) {
      await expect(box).toBeChecked();
    }
    await expect(
      page.getByTestId("telemetry-viewer-select-page"),
    ).toBeChecked();
    await expect(selectedCount(page)).toHaveText("All 5 selected");

    await page.getByTestId("telemetry-viewer-list").screenshot({
      path: path.join(SCREENSHOTS, "exceptions-all-selected-1440.png"),
      animations: "disabled",
    });
  });

  test("1440: Resolve over every match asks first, naming how many, then resolves each one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTwoAPage(page, 1440);

    await page.getByTestId("telemetry-viewer-select-page").check();
    await offer(page).click();
    await expect(selectedCount(page)).toHaveText("All 5 selected");

    await page.getByRole("button", { name: "Bulk Actions" }).click();
    await page
      .getByRole("menu")
      .getByRole("menuitem", { name: "Resolve", exact: true })
      .click();

    const question: Locator = page.getByRole("dialog");
    // What it does and to how many, as an incidents list's Resolve says.
    await expect(question.getByTestId("modal-title")).toHaveText(
      "Resolve 5 Exceptions",
    );
    await expect(question).toContainText(
      "This changes all 5 selected exceptions, including those on other pages.",
    );
    // Nothing is written until the person says so.
    expect(await updates(page)).toEqual([]);

    await page.screenshot({
      path: path.join(SCREENSHOTS, "exceptions-every-match-question-1440.png"),
      animations: "disabled",
    });

    await question.getByTestId("modal-footer-submit-button").click();

    await expect
      .poll(async (): Promise<number> => {
        return (await updates(page)).length;
      })
      .toBe(5);
    for (const update of await updates(page)) {
      expect(update.body).toEqual({ isResolved: true });
    }

    const result: Locator = page.getByRole("dialog");
    await expect(result.getByText("5 Exceptions resolved")).toBeVisible();
    await result.getByRole("button", { name: "Close" }).click();

    // Read again: none is left unresolved, and nothing is ticked.
    await expect(page.getByTestId("telemetry-viewer-select-row")).toHaveCount(
      0,
    );
    await expect(selectedCount(page)).toHaveCount(0);
  });

  test("a changed status lets every match go: back on Unresolved, nothing is ticked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTwoAPage(page, 1440);

    await page.getByTestId("telemetry-viewer-select-page").check();
    await offer(page).click();
    await expect(selectedCount(page)).toHaveText("All 5 selected");

    await page.getByRole("button", { name: "Resolved", exact: true }).click();
    await expect(page.getByTestId("telemetry-viewer-select-row")).toHaveCount(
      0,
    );

    await page.getByRole("button", { name: "Unresolved", exact: true }).click();
    await expect(page.getByTestId("telemetry-viewer-select-row")).toHaveCount(
      2,
    );
    for (const box of await page
      .getByTestId("telemetry-viewer-select-row")
      .all()) {
      await expect(box).not.toBeChecked();
    }
    await expect(selectedCount(page)).toHaveCount(0);
  });

  for (const theme of ["light", "dark"]) {
    test(`390 (${theme}): the offer takes a line of its own under the count, the page's box level with the count, nothing sideways`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 390, height: 1000 });
      await page.goto(`${TWO_A_PAGE}${theme === "dark" ? "&theme=dark" : ""}`);
      await expect(page.getByTestId("synthetic-banner")).toBeVisible({
        timeout: 60000,
      });
      await expect(page.getByTestId("telemetry-viewer-select-row")).toHaveCount(
        2,
      );

      await page.getByTestId("telemetry-viewer-select-page").check();
      await expect(offer(page)).toBeVisible();

      interface Line {
        box: { y: number; height: number };
        count: { y: number; height: number };
        actions: { y: number; height: number; x: number; width: number };
        offer: { y: number; x: number; width: number };
        header: { x: number; width: number };
        countWords: { x: number };
        offerWords: { x: number };
      }

      // Read in one frame.
      const line: Line = await page.evaluate((): Line => {
        const rectOf: (selector: string) => DOMRect = (
          selector: string,
        ): DOMRect => {
          return (
            document.querySelector(selector) as Element
          ).getBoundingClientRect();
        };

        return {
          box: rectOf("[data-testid=telemetry-viewer-select-page]"),
          count: rectOf("[data-testid=bulk-update-selected-count]"),
          actions: rectOf("[data-testid=bulk-update-actions] button"),
          offer: rectOf("[data-testid=bulk-update-select-all-matching]"),
          header: rectOf("[data-testid=telemetry-viewer-bulk]"),
          countWords: rectOf("[data-testid=bulk-update-selected-count] > span"),
          offerWords: rectOf(
            "[data-testid=bulk-update-select-all-matching] > span",
          ),
        };
      });

      const centerOf: (rect: { y: number; height: number }) => number = (rect: {
        y: number;
        height: number;
      }): number => {
        return rect.y + rect.height / 2;
      };

      // The box, the count and Bulk Actions on the first line.
      expect(
        Math.abs(centerOf(line.box) - centerOf(line.count)),
      ).toBeLessThanOrEqual(2);
      expect(
        Math.abs(centerOf(line.actions) - centerOf(line.count)),
      ).toBeLessThanOrEqual(2);
      // The offer under them, inside the header line's box.
      expect(line.offer.y).toBeGreaterThanOrEqual(
        line.count.y + line.count.height - 1,
      );
      expect(line.offer.x + line.offer.width).toBeLessThanOrEqual(
        line.header.x + line.header.width,
      );
      // Its words start where the count's do, a line under them.
      expect(
        Math.abs(line.offerWords.x - line.countWords.x),
      ).toBeLessThanOrEqual(1);
      expect(await scrollsSideways(page)).toBe(false);

      await page.getByTestId("telemetry-viewer-list").screenshot({
        path: path.join(SCREENSHOTS, `exceptions-select-all-390-${theme}.png`),
        animations: "disabled",
      });
    });
  }
});
