import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { DrawnPopup, expectDrawnWhole } from "../SuiteHelpers/Popups";

/*
 * A BUSY DAY'S "+N MORE" LIST IS NEVER CUT OFF BY THE MONTH VIEW (#9865).
 *
 * #9865, found by reading the code, said the month view keeps the list
 * inside itself and clips it: Calendar.css gives .rbc-month-view
 * `overflow: hidden` for its rounded border, so a day with more events
 * than fit in the view's height would have its list cut off at the view's
 * edge. It does not happen: react-big-calendar draws the list through
 * react-overlays' Overlay, which portals it to the page's body (no
 * container is given), and positions it there in the page's coordinates
 * (lib/Popup.js) - under the "+N more", or above it where under it would
 * leave the month view - so the view's overflow never applies to it. What
 * a day holds past the list's 320px scrolls inside the list.
 *
 * These pin it, on the real Maintenance Calendar (MaintenanceCalendar/
 * Fixture.js): the list is drawn on the body, outside the month view,
 * whole at its four corners and inside the window, for the busy 22nd and
 * for the first and last weeks of a month busy every day, on a laptop, a
 * tablet and a phone, and in the dark theme.
 *
 * Placed against the month view, the library's list opened above its "+N
 * more" in a short window where the day had scrolled near the window's top,
 * and started above the window's top edge (#9911). The calendar draws the
 * list on the tooltip layer now (LayeredPopover), placed against the
 * window: so it is whole where it opens - never scrolled into view first -
 * under its "+N more" while the window has the room there, and a keyboard
 * goes from the "+N more" through its events.
 */

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/maintenance-calendar-ui",
);

const NOW: Date = new Date("2026-10-15T10:20:00.000Z");

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });
});

test.afterEach(({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
});

async function open(
  page: Page,
  query: string,
  size: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(size);
  await page.clock.setFixedTime(NOW);
  await page.goto(`/?${query}`);
  await expect(page.getByTestId("fixture-page")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(
    page.getByTestId("scheduled-maintenance-calendar"),
  ).toBeVisible();
  await expect(
    page.getByTestId("scheduled-maintenance-calendar-loading"),
  ).toHaveCount(0);
}

function monthView(page: Page): Locator {
  return page
    .getByTestId("scheduled-maintenance-calendar")
    .locator(".rbc-month-view");
}

// The list a "+N more" opens: on the tooltip layer, at the end of the body.
function busyDayList(page: Page): Locator {
  return page.locator(".rbc-overlay");
}

async function openList(page: Page, more: Locator): Promise<Locator> {
  await more.scrollIntoViewIfNeeded();
  await more.click();

  const list: Locator = busyDayList(page);
  await expect(list).toBeVisible();

  // Drawn on the body's tooltip layer, outside the month view and its overflow.
  expect(
    await list.evaluate((element: Element): boolean => {
      const layer: Element | null = element.closest("[data-tippy-root]");

      return Boolean(layer && layer.parentElement === document.body);
    }),
    "the list is drawn on the page's body",
  ).toBe(true);
  expect(
    await monthView(page).evaluate((view: Element): boolean => {
      return Boolean(view.querySelector(".rbc-overlay"));
    }),
    "the month view does not hold the list",
  ).toBe(false);

  return list;
}

/*
 * The list is whole in the window where it opens: what the page shows at
 * its corners is the list, inside the window's edges, never scrolled into
 * view first (#9911). It is a popup of the tooltip layer, read as every
 * other one is (SuiteHelpers/Popups).
 */
async function expectListWhole(
  list: Locator,
  what: string,
): Promise<DrawnPopup> {
  return await expectDrawnWhole(list, what);
}

const SIZES: Array<{ name: string; width: number; height: number }> = [
  { name: "a laptop", width: 1280, height: 900 },
  { name: "a short laptop window", width: 1280, height: 560 },
  { name: "a tablet", width: 820, height: 1180 },
  { name: "a phone", width: 390, height: 844 },
];

test.describe("a busy day's +N more list in the month view (#9865)", () => {
  for (const size of SIZES) {
    test(`on ${size.name}, the 22nd's list is drawn on the body, whole`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, "events=many", size);

      const list: Locator = await openList(
        page,
        monthView(page).locator(".rbc-show-more").first(),
      );

      await expectListWhole(list, `the 22nd's list on ${size.name}`);

      // A day of sixty scrolls inside the list.
      expect(
        await list.evaluate((element: Element): boolean => {
          return element.scrollHeight > element.clientHeight;
        }),
      ).toBe(true);

      fs.mkdirSync(SCREENSHOTS, { recursive: true });
      await page.screenshot({
        path: path.join(
          SCREENSHOTS,
          `busy-day-list-${size.width}x${size.height}.png`,
        ),
        animations: "disabled",
      });
    });
  }

  test("with every day busy, the first week's and the last week's lists are whole too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "external=many", { width: 1280, height: 900 });

    const more: Locator = monthView(page).locator(".rbc-show-more");
    await expect(more.first()).toBeVisible();

    for (const which of ["first", "last"] as const) {
      const list: Locator = await openList(
        page,
        which === "first" ? more.first() : more.last(),
      );

      await expectListWhole(list, `the ${which} busy day's list`);

      await page.keyboard.press("Escape");
      await page.mouse.click(2, 2);
      await expect(busyDayList(page)).toHaveCount(0);
    }
  });

  test("in the dark theme it is whole, and drawn on the dark surface", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "events=many&theme=dark", { width: 1280, height: 900 });

    const list: Locator = await openList(
      page,
      monthView(page).locator(".rbc-show-more").first(),
    );

    await expectListWhole(list, "the dark 22nd's list");
    expect(
      await list.evaluate((element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      }),
    ).not.toBe("rgb(255, 255, 255)");
  });
});

test.describe("a busy day's +N more list stays inside the window (#9911)", () => {
  /*
   * The report: a 1280x560 window, the page scrolled so the busy 22nd is
   * near the window's top. The library opened the 320px list above its
   * "+N more", past the window's top edge, though the window had the room
   * under it.
   */
  test("in a short window, with the day near the window's top, it opens under its +N more, whole where it opens", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "events=many", { width: 1280, height: 560 });

    const more: Locator = monthView(page).locator(".rbc-show-more").first();

    // The 22nd scrolled as near the window's top as the page goes.
    await more.evaluate((element: Element): void => {
      window.scrollBy(0, element.getBoundingClientRect().top - 48);
    });

    const room: { above: number; below: number } = await more.evaluate(
      (element: Element): { above: number; below: number } => {
        const box: DOMRect = element.getBoundingClientRect();

        return { above: box.top, below: window.innerHeight - box.bottom };
      },
    );

    // The library's 320px list, put above, started past the window's top here.
    expect(
      room.above,
      "less room above the +N more than the list",
    ).toBeLessThan(320);

    await more.click();

    const list: Locator = busyDayList(page);
    await expect(list).toBeVisible();

    const drawn: DrawnPopup = await expectListWhole(
      list,
      "the 22nd's list in a short window",
    );

    expect(drawn.box.y, "it starts inside the window").toBeGreaterThanOrEqual(
      0,
    );
    // On the side with the room for it, or the more room: under it here.
    expect(drawn.placement, "it opens on the roomier side").toMatch(
      room.below >= room.above ? /^bottom/ : /^top/,
    );
    expect(drawn.placement).toMatch(/^bottom/);

    fs.mkdirSync(SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: path.join(SCREENSHOTS, "busy-day-list-1280x560-near-the-top.png"),
      animations: "disabled",
    });
  });

  test("in a short window, with the day near the window's foot, it opens above it, whole", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "events=many", { width: 1280, height: 560 });

    const more: Locator = monthView(page).locator(".rbc-show-more").first();

    // The 22nd at the window's foot, with the room above it.
    await more.evaluate((element: Element): void => {
      window.scrollBy(
        0,
        element.getBoundingClientRect().bottom - window.innerHeight + 24,
      );
    });

    await more.click();

    const drawn: DrawnPopup = await expectListWhole(
      busyDayList(page),
      "the 22nd's list at a short window's foot",
    );

    expect(drawn.placement, "it opens above its +N more").toMatch(/^top/);
  });

  test("in a narrow window, it stays inside the window's sides", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "events=many", { width: 390, height: 844 });

    const list: Locator = await openList(
      page,
      monthView(page).locator(".rbc-show-more").last(),
    );

    const drawn: DrawnPopup = await expectListWhole(
      list,
      "the last busy day's list on a phone",
    );

    expect(drawn.box.x).toBeGreaterThanOrEqual(8);
    expect(drawn.box.x + drawn.box.width).toBeLessThanOrEqual(390 - 8);

    fs.mkdirSync(SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: path.join(SCREENSHOTS, "busy-day-list-390x844-last.png"),
      animations: "disabled",
    });
  });

  test("a keyboard opens it, goes through its events from the +N more, and Escape brings it back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "events=many", { width: 1280, height: 900 });

    const more: Locator = monthView(page).locator(".rbc-show-more").first();

    await more.scrollIntoViewIfNeeded();
    await more.focus();
    await page.keyboard.press("Enter");

    const list: Locator = busyDayList(page);
    await expect(list).toBeVisible();
    await expect(more).toBeFocused();

    // Tab goes from the +N more into the list, to its first event's link.
    await page.keyboard.press("Tab");
    await expect(
      list.getByTestId("scheduled-maintenance-calendar-event").first(),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      list.getByTestId("scheduled-maintenance-calendar-event").nth(1),
    ).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(more).toBeFocused();
  });
});
