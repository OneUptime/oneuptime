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
    await expect(menu.getByRole("menuitem")).toHaveText(["Resolve", "Archive"]);

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
 * page tick exceptions, and the bar over the list resolves, reopens,
 * archives or unarchives them in one go, one request each, as each row's
 * own action would.
 */
test.describe("Bulk Actions on the exceptions list", () => {
  test("two ticked exceptions are resolved in one go, and both leave the Unresolved list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, 1440);

    // Nothing ticked: no bar.
    await expect(page.getByText("Clear Selection")).toHaveCount(0);

    await rowBox(page, "DeadlineExceededError").check();
    await rowBox(page, "TypeError").check();

    await expect(page.getByText("2 Exceptions Selected")).toBeVisible();
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
    // Both are unresolved and live: what they can take, and nothing else.
    await expect(menu.getByRole("menuitem")).toHaveText(["Resolve", "Archive"]);

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
    await expect(page.getByText("Clear Selection")).toHaveCount(0);
  });

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
    await expect(page.getByText(`${rows} Exceptions Selected`)).toBeVisible();
    for (const box of await page
      .getByTestId("telemetry-viewer-select-row")
      .all()) {
      await expect(box).toBeChecked();
    }

    await page.getByRole("button", { name: "Clear Selection" }).click();
    await expect(page.getByText("Clear Selection")).toHaveCount(0);
    for (const box of await page
      .getByTestId("telemetry-viewer-select-row")
      .all()) {
      await expect(box).not.toBeChecked();
    }

    // The box itself does the same.
    await page.getByTestId("telemetry-viewer-select-page").check();
    await expect(page.getByText(`${rows} Exceptions Selected`)).toBeVisible();
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
      await expect(page.getByText("1 Exception Selected")).toBeVisible();
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
