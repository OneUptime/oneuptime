import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * COPY LINK ON A LOG ROW ITSELF (#9944).
 *
 * A log line's link (#9794) was copied from its details alone, so the line
 * had to be opened first. A row of the Logs explorer's list has Copy Link
 * beside its Copy log message now, and the keyboard has `l` for the row it
 * is on. Here the production explorer runs on the offline fixture
 * (Fixture/Fixture.js), whose generated log lines each carry an id, and
 * what is pinned is what a reader meets:
 *
 *   - on a laptop, the row's Copy Link shows under the pointer and to the
 *     keyboard as Tab reaches it, copies the very link the row's details
 *     copy - the Logs page naming the line, over the list's window - says
 *     "Link copied", and leaves the row closed; the link opens that line;
 *   - `l` copies the link of the row j moved to, and the shortcuts panel
 *     lists it;
 *   - on a phone, where nothing hovers, the row's actions show on every
 *     row, each 32px across under a finger and apart, and a tap copies
 *     the link without opening the row, the page never scrolling sideways.
 *
 * The clipboard is the page's own, recorded (navigator.clipboard is
 * replaced before the page loads), so what was copied is read exactly.
 */

const PORT: string = process.env["CHART_TIME_ZOOM_FIXTURE_PORT"] || "4233";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const LOGS_PATH: string = `/dashboard/${PROJECT_ID}/logs`;

const ROW_LINK_TEST_ID: string = "logs-table-row-copy-link";
const DETAILS_LINK_TEST_ID: string = "log-details-copy-link";
const COPIED_TOAST_TEST_ID: string = "log-line-link-copied";

interface SpecWindow {
  __chartTimeZoomFixture: {
    unhandled: Array<Record<string, unknown>>;
  };
  __copiedTexts: Array<string>;
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

  // What the page copies, as it copies it.
  await page.addInitScript((): void => {
    const copied: Array<string> = [];
    (window as unknown as { __copiedTexts: Array<string> }).__copiedTexts =
      copied;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string): Promise<void> => {
          copied.push(text);
        },
      },
    });
  });

  await page.clock.install({ time: NOW });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);

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

async function openLogs(page: Page, path: string = LOGS_PATH): Promise<void> {
  await page.goto(path);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(rows(page).first()).toBeVisible({ timeout: 30000 });
}

// The list's rows: each line's own, not an opened line's details.
function rows(page: Page): Locator {
  return page
    .getByTestId("logs-table")
    .locator("tbody tr")
    .filter({ has: page.getByTestId("logs-table-row-actions") });
}

async function copiedTexts(page: Page): Promise<Array<string>> {
  return page.evaluate((): Array<string> => {
    return [...(window as unknown as SpecWindow).__copiedTexts];
  });
}

async function opacityOf(locator: Locator): Promise<number> {
  return locator.evaluate((element: Element): number => {
    return Number(getComputedStyle(element).opacity);
  });
}

// The link copied, read: the page it opens, the line, and the list's window.
function readLink(link: string): {
  pathname: string;
  log: string | null;
  logTime: string | null;
  range: string | null;
  start: string | null;
  end: string | null;
} {
  const url: URL = new URL(link);

  return {
    pathname: url.pathname,
    log: url.searchParams.get("log"),
    logTime: url.searchParams.get("logTime"),
    range: url.searchParams.get("range"),
    start: url.searchParams.get("start"),
    end: url.searchParams.get("end"),
  };
}

test.describe("Copy Link on a log row, on a laptop", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("shows under the pointer, copies the link the row's details copy, says so, and leaves the row closed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLogs(page);

    const row: Locator = rows(page).nth(1);
    const button: Locator = row.getByTestId(ROW_LINK_TEST_ID);

    // Out of sight until the pointer is on its row.
    await expect
      .poll(() => {
        return opacityOf(button);
      })
      .toBe(0);
    await row.hover();
    await expect
      .poll(() => {
        return opacityOf(button);
      })
      .toBe(1);
    await expect(button).toHaveAccessibleName("Copy Link");

    // Beside Copy log message, at the row's end.
    const [message, link]: Array<FrameBox> = await boxesInOneFrame([
      row.getByRole("button", { name: "Copy log message" }),
      button,
    ]);
    expect(link!.x).toBeGreaterThan(message!.x + message!.width - 1);
    expect(Math.abs(link!.y - message!.y)).toBeLessThan(2);

    await button.click();

    await expect(page.getByTestId(COPIED_TOAST_TEST_ID)).toContainText(
      "Link copied",
    );
    // Pressing the row's own action did not open the row.
    await expect(page.getByTestId(DETAILS_LINK_TEST_ID)).toHaveCount(0);

    const [fromRow] = await copiedTexts(page);
    const read: ReturnType<typeof readLink> = readLink(fromRow!);

    expect(read.pathname).toBe(LOGS_PATH);
    expect(read.log).toMatch(/^[0-9a-f-]{36}$/);
    expect(read.logTime).not.toBeNull();
    // The list's window, pinned: past an hour, read at the fixture's noon.
    expect(read.range).toBe("Custom");
    expect(
      new Date(read.end!).getTime() - new Date(read.start!).getTime(),
    ).toBe(60 * 60 * 1000);

    // The row's details copy the very same link.
    await row.locator("td").first().click();
    await page.getByTestId(DETAILS_LINK_TEST_ID).click();

    await expect
      .poll(() => {
        return copiedTexts(page);
      })
      .toEqual([fromRow, fromRow]);
  });

  test("the link it copies opens that very line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLogs(page);

    const row: Locator = rows(page).nth(2);
    const message: string = (
      (await row.locator("td").nth(3).locator("p").first().textContent()) || ""
    ).trim();

    await row.hover();
    await row.getByTestId(ROW_LINK_TEST_ID).click();
    await expect(page.getByTestId(COPIED_TOAST_TEST_ID)).toBeVisible();

    const [link] = await copiedTexts(page);
    const url: URL = new URL(link!);

    await openLogs(page, `${url.pathname}${url.search}`);

    const opened: Locator = page.getByTestId("logs-viewer-opened-line");

    await expect(opened).toBeVisible();
    await expect(opened).toContainText(message);
  });

  test("from the keyboard: Tab reaches it after Copy log message and shows it, and Enter presses it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLogs(page);

    const row: Locator = rows(page).first();
    const copyMessage: Locator = row.getByRole("button", {
      name: "Copy log message",
    });
    const button: Locator = row.getByTestId(ROW_LINK_TEST_ID);

    await copyMessage.focus();
    await page.keyboard.press("Tab");

    await expect(button).toBeFocused();
    await expect
      .poll(() => {
        return opacityOf(button);
      })
      .toBe(1);

    await page.keyboard.press("Enter");

    await expect(page.getByTestId(COPIED_TOAST_TEST_ID)).toBeVisible();
    await expect
      .poll(async () => {
        return (await copiedTexts(page)).length;
      })
      .toBe(1);
    // Enter on the button pressed it, and opened no row.
    await expect(page.getByTestId(DETAILS_LINK_TEST_ID)).toHaveCount(0);
  });

  test("l copies the link of the row j moved to, and the shortcuts panel lists it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLogs(page);

    // The second row: j twice from the list's top.
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("j");
    await page.keyboard.press("j");
    await page.keyboard.press("l");

    await expect(page.getByTestId(COPIED_TOAST_TEST_ID)).toBeVisible();

    const [fromKeyboard] = await copiedTexts(page);

    // The same link the second row's Copy Link copies.
    const second: Locator = rows(page).nth(1);
    await second.hover();
    await second.getByTestId(ROW_LINK_TEST_ID).click();

    await expect
      .poll(() => {
        return copiedTexts(page);
      })
      .toEqual([fromKeyboard, fromKeyboard]);

    // ? opens the shortcuts, where l is listed after Enter.
    await page.keyboard.press("?");

    const help: Locator = page.getByTestId("keyboard-shortcuts-help");

    await expect(help).toBeVisible();
    await expect(help).toContainText("Copy link to selected log");

    const said: string = (await help.textContent()) || "";

    expect(said.indexOf("Expand / collapse selected log")).toBeLessThan(
      said.indexOf("Copy link to selected log"),
    );
  });
});

test.describe("Copy Link on a log row, on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("shows on every row with nothing to hover, a finger's size, and a tap copies the link without opening the row", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLogs(page);
    await expectNoSidewaysScroll(page, { message: "the Logs explorer" });

    const row: Locator = rows(page).first();
    const copyMessage: Locator = row.getByRole("button", {
      name: "Copy log message",
    });
    const button: Locator = row.getByTestId(ROW_LINK_TEST_ID);

    // A phone has no pointer to hover: both of the row's actions show.
    await button.scrollIntoViewIfNeeded();
    await expect
      .poll(() => {
        return opacityOf(button);
      })
      .toBe(1);
    await expect
      .poll(() => {
        return opacityOf(copyMessage);
      })
      .toBe(1);

    const [message, link]: Array<FrameBox> = await boxesInOneFrame([
      copyMessage,
      button,
    ]);

    // 32px across under a finger, side by side with room between.
    for (const box of [message!, link!]) {
      expect(box.width).toBeGreaterThanOrEqual(32);
      expect(box.height).toBeGreaterThanOrEqual(32);
    }
    expect(link!.x - (message!.x + message!.width)).toBeGreaterThanOrEqual(8);

    await button.tap();

    await expect(page.getByTestId(COPIED_TOAST_TEST_ID)).toContainText(
      "Link copied",
    );
    await expect(page.getByTestId(DETAILS_LINK_TEST_ID)).toHaveCount(0);

    const [copied] = await copiedTexts(page);

    expect(readLink(copied!).pathname).toBe(LOGS_PATH);
    // The list scrolls sideways inside its card; the page never does.
    await expectNoSidewaysScroll(page, {
      message: "the Logs explorer, after the tap",
    });
  });
});
