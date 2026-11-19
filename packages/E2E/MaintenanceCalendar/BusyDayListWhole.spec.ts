import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";

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

// The list a "+N more" opens: drawn by the library at the end of the body.
function busyDayList(page: Page): Locator {
  return page.locator(".rbc-overlay");
}

async function openList(page: Page, more: Locator): Promise<Locator> {
  await more.scrollIntoViewIfNeeded();
  await more.click();

  const list: Locator = busyDayList(page);
  await expect(list).toBeVisible();

  // Drawn on the body, outside the month view and its overflow.
  expect(
    await list.evaluate((element: Element): boolean => {
      return element.parentElement === document.body;
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
 * The list is whole in the window: what the page shows at its corners is
 * the list. It is the library's, not a popup of the tooltip layer, so its
 * corners are read here rather than by SuiteHelpers/Popups.
 */
async function expectListWhole(list: Locator, what: string): Promise<void> {
  // Brought into the window first: the page scrolls, the list with it.
  await list.evaluate((element: Element): void => {
    element.scrollIntoView({ block: "nearest" });
  });

  await expect
    .poll(
      async (): Promise<Array<boolean>> => {
        return await list.evaluate((element: Element): Array<boolean> => {
          const rect: DOMRect = element.getBoundingClientRect();
          const inset: number = 6;

          return [
            [rect.left + inset, rect.top + inset],
            [rect.right - inset, rect.top + inset],
            [rect.left + inset, rect.bottom - inset],
            [rect.right - inset, rect.bottom - inset],
          ].map(([x, y]: Array<number>): boolean => {
            const shown: Element | null = document.elementFromPoint(x!, y!);
            return Boolean(shown && element.contains(shown));
          });
        });
      },
      { message: `${what}: what the page shows at its four corners` },
    )
    .toEqual([true, true, true, true]);
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
