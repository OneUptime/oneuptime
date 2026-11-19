import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * AN OWNER'S TOOLTIP IN THE FIRST ROW OF A LIST IS WHOLE (#9769).
 *
 * "In the Monitors list view, hovering over an owner avatar in the first
 * row causes the hover tooltip to be visually cut off and clipped on the
 * left and top edges." A rich tooltip is interactive, and Tippy drew an
 * interactive tooltip inside its trigger's parent: the table's cell, which
 * clips its value across (overflow-x: clip), inside the list's box, which
 * clips both ways once the list scrolls sideways. Now every tooltip is
 * drawn on the page's body and placed against the window.
 *
 * On-Call > Schedules, in Chromium, against the offline fixture
 * (OwnerFilters/Fixture): its first row, Payments Primary, is owned by the
 * Payments team, drawn as "P". Hovering that avatar shows a tooltip that is
 * drawn on the body, inside the window, showing at every corner - a box cut
 * off by a cell, a list or a card shows the page there instead - and
 * pointing at its avatar:
 *
 *   - on a laptop, above the avatar, over the list's header;
 *   - while the list scrolls sideways, across the list's top edge, and
 *     following its avatar as the list and the page scroll;
 *   - at the window's top edge, below the avatar instead;
 *   - in dark mode, on the dark surface;
 *   - on a page read right to left (Persian);
 *   - in a narrow window, where the rows are cards.
 *
 * A phone's card leaves the owners out (hideOnMobile), so on a phone there
 * is no owner's tooltip to cut off, and nothing runs past the screen.
 * Screenshots land in output/playwright/owner-filters-ui.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000f1";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/on-call-duty/schedules`;
const PORT: string = process.env["OWNER_FILTERS_FIXTURE_PORT"] || "4481";
const TABLE_ID: string = "on-call-schedules-table";

// The first row's owner: the Payments team, as its initial.
const FIRST_ROW_OWNER_INITIAL: string = "P";
const FIRST_ROW_OWNER_NAME: string = "Payments";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/owner-filters-ui",
);

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing may leave the fixture: a request to a real host is a test bug.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());

    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }

    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  // Every read the page made is one the fixture answers as the API does.
  expect(
    await page.evaluate((): Array<unknown> => {
      return (window as unknown as { __fixture: { unhandled: Array<unknown> } })
        .__fixture.unhandled;
    }),
  ).toEqual([]);
});

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();

  expect(box).not.toBeNull();
  return box!;
}

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    animations: "disabled",
  });
}

// Lets every finite animation on the page run its course.
async function finishAnimations(page: Page): Promise<void> {
  await page.evaluate(async (): Promise<void> => {
    await new Promise((resolve: (value: unknown) => void) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
    await Promise.all(
      document
        .getAnimations()
        .filter((animation: Animation): boolean => {
          return animation.effect?.getTiming().iterations !== Infinity;
        })
        .map((animation: Animation): Promise<unknown> => {
          return animation.finished.catch(() => {
            return undefined;
          });
        }),
    );
  });
}

// The list's rows: table rows on a laptop, cards in a narrow window.
function rows(page: Page): Locator {
  return page.locator(`#${TABLE_ID}-body > tr, #${TABLE_ID}-body > div`);
}

async function openList(
  page: Page,
  options: { width?: number; height?: number; query?: string } = {},
): Promise<void> {
  await page.setViewportSize({
    width: options.width || 1280,
    height: options.height || 900,
  });
  await page.goto(`${PAGE_PATH}${options.query || ""}`);
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await expect(page.getByTestId("table-skeleton-loader")).toHaveCount(0);
  // The first load parses a large bundle.
  await expect(rows(page).first()).toBeVisible({ timeout: 60000 });
  await finishAnimations(page);
}

/*
 * The first row's owner avatar - its first "P": a tooltip drawn inside the
 * row, as before #9769, brought a second, its own avatar of the owner.
 */
function firstRowOwner(page: Page): Locator {
  return rows(page)
    .first()
    .getByText(FIRST_ROW_OWNER_INITIAL, { exact: true })
    .first();
}

// The owner's tooltip, wherever the page draws it.
function ownerTooltip(page: Page): Locator {
  return page
    .locator("[data-tippy-root]")
    .filter({ hasText: FIRST_ROW_OWNER_NAME });
}

/*
 * Hovers the first row's owner and waits for its tooltip. Once over first:
 * the fixture's Tailwind writes a class's rule only as an element with it
 * first appears, so a tooltip's first showing is placed before its width
 * is - where the Dashboard's built stylesheet has every rule from the
 * start.
 */
async function showOwnerTooltip(page: Page): Promise<Locator> {
  const avatar: Locator = firstRowOwner(page);

  await avatar.hover();
  await expect(ownerTooltip(page)).toBeVisible();
  // Away to the list's own title, where nothing has a tooltip.
  await page.mouse.move(1, (await boxOf(avatar)).y + 200);
  await expect(ownerTooltip(page)).toHaveCount(0);

  await avatar.hover();
  await expect(ownerTooltip(page)).toBeVisible();
  await finishAnimations(page);

  return ownerTooltip(page);
}

interface Shown {
  box: Box;
  avatar: Box;
  placement: string | null;
}

/*
 * The tooltip is drawn on the page's body, inside the window, shows at
 * every corner and points at its avatar, its words whole.
 */
async function expectWhole(page: Page, tooltip: Locator): Promise<Shown> {
  const tooltipBox: Locator = tooltip.locator(".tippy-box");
  const box: Box = await boxOf(tooltipBox);
  const avatar: Box = await boxOf(firstRowOwner(page));
  const window: { width: number; height: number } = page.viewportSize()!;

  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(window.width);
  expect(box.y + box.height).toBeLessThanOrEqual(window.height);

  /*
   * What the page shows at each of its corners (a few pixels in, past the
   * rounding) is the tooltip: where a cell, a list or a card cuts it off,
   * the page shows through instead.
   */
  const shownAtCorners: Array<boolean> = await tooltip.evaluate(
    (root: HTMLElement): Array<boolean> => {
      const rect: DOMRect = root
        .querySelector(".tippy-box")!
        .getBoundingClientRect();
      const inset: number = 6;

      return [
        [rect.left + inset, rect.top + inset],
        [rect.right - inset, rect.top + inset],
        [rect.left + inset, rect.bottom - inset],
        [rect.right - inset, rect.bottom - inset],
      ].map(([x, y]: Array<number>): boolean => {
        const shown: Element | null = document.elementFromPoint(x!, y!);
        return Boolean(shown && root.contains(shown));
      });
    },
  );

  expect(shownAtCorners, "the tooltip shows at its four corners").toEqual([
    true,
    true,
    true,
    true,
  ]);

  // It points at its avatar, from above or below it.
  const placement: string | null =
    await tooltipBox.getAttribute("data-placement");
  const arrow: Box = await boxOf(tooltip.locator(".tippy-arrow"));

  expect(["top", "bottom"]).toContain(placement);
  expect(
    Math.abs(arrow.x + arrow.width / 2 - (avatar.x + avatar.width / 2)),
  ).toBeLessThanOrEqual(2);

  if (placement === "top") {
    expect(box.y + box.height).toBeLessThanOrEqual(avatar.y);
  } else {
    expect(box.y).toBeGreaterThanOrEqual(avatar.y + avatar.height);
  }

  // Its words whole: the team's name, nothing cut short.
  const name: Locator = tooltip.getByText(FIRST_ROW_OWNER_NAME, {
    exact: true,
  });
  const isNameWhole: boolean = await name.evaluate(
    (element: HTMLElement): boolean => {
      return element.scrollWidth <= element.clientWidth;
    },
  );

  expect(isNameWhole, "the owner's name is whole").toBe(true);

  // Drawn on the page's body: no cell, list or card around it to cut it off.
  const drawnOnTheBody: boolean = await tooltip.evaluate(
    (root: HTMLElement): boolean => {
      return root.parentElement === document.body;
    },
  );

  expect(drawnOnTheBody, "drawn on the page's body").toBe(true);

  return { box, avatar, placement };
}

// The relative luminance of a CSS colour, as WCAG reads it.
function luminanceOf(color: string): number {
  const channels: Array<number> = (color.match(/[\d.]+/g) || [])
    .slice(0, 3)
    .map((value: string): number => {
      const channel: number = Number(value) / 255;
      return channel <= 0.03928
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4);
    });

  return (
    0.2126 * (channels[0] || 0) +
    0.7152 * (channels[1] || 0) +
    0.0722 * (channels[2] || 0)
  );
}

function contrastOf(first: string, second: string): number {
  const [lighter, darker]: Array<number> = [
    luminanceOf(first),
    luminanceOf(second),
  ].sort((a: number, b: number) => {
    return b - a;
  });

  return (lighter! + 0.05) / (darker! + 0.05);
}

test.describe("an owner's tooltip in the first row of a list is whole (#9769)", () => {
  test("on a laptop: drawn over the page, above its avatar, showing at every corner", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page);

    const tooltip: Locator = await showOwnerTooltip(page);
    const shown: Shown = await expectWhole(page, tooltip);

    // Above its avatar, over the list's header row.
    expect(shown.placement).toBe("top");
    const header: Box = await boxOf(page.locator("thead").first());
    expect(shown.box.y).toBeLessThan(header.y + header.height);

    await expect(tooltip).toContainText("Team");

    await screenshot(page, "owner-tooltip-first-row-1280");
  });

  test("while the list scrolls sideways, it reaches past the list's top edge whole, and follows its avatar", async ({
    page,
  }: {
    page: Page;
  }) => {
    // At 1150px the list's columns are wider than its card: it scrolls sideways.
    await openList(page, { width: 1150, height: 700 });

    const list: Locator = page.getByTestId("table-scroll");
    await expect(list).toHaveAttribute("data-overflowing", "true");

    const tooltip: Locator = await showOwnerTooltip(page);
    const shown: Shown = await expectWhole(page, tooltip);

    // A box that scrolls sideways clips up and down too: this is that edge.
    expect(shown.placement).toBe("top");
    expect(shown.box.y).toBeLessThan((await boxOf(list)).y);

    await screenshot(page, "owner-tooltip-list-scrolls-sideways-1150");

    // The list scrolls 8px sideways under the pointer: the tooltip goes with its avatar.
    await list.evaluate((element: HTMLElement) => {
      element.scrollLeft += 8;
    });
    await expect
      .poll(async (): Promise<number> => {
        return Math.abs(
          (await boxOf(firstRowOwner(page))).x - (shown.avatar.x - 8),
        );
      })
      .toBeLessThanOrEqual(1);
    await expect
      .poll(async (): Promise<number> => {
        return Math.abs(
          (await boxOf(tooltip.locator(".tippy-box"))).x - (shown.box.x - 8),
        );
      })
      .toBeLessThanOrEqual(1);

    // The page scrolls 8px: so does the tooltip.
    const beforePageScroll: Box = await boxOf(tooltip.locator(".tippy-box"));
    await page.evaluate(() => {
      window.scrollBy(0, 8);
    });
    expect(
      await page.evaluate((): number => {
        return window.scrollY;
      }),
    ).toBe(8);
    await expect
      .poll(async (): Promise<number> => {
        return Math.abs(
          (await boxOf(tooltip.locator(".tippy-box"))).y -
            (beforePageScroll.y - 8),
        );
      })
      .toBeLessThanOrEqual(1);

    await expectWhole(page, tooltip);
  });

  test("at the window's top edge, it opens below its avatar, whole", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, { height: 420 });

    // The first row scrolled up to just under the list's header, stuck at the window's top.
    const avatar: Box = await boxOf(firstRowOwner(page));
    await page.evaluate((by: number) => {
      window.scrollBy(0, by);
    }, avatar.y - 50);
    await finishAnimations(page);
    expect((await boxOf(firstRowOwner(page))).y).toBeLessThan(60);

    const tooltip: Locator = await showOwnerTooltip(page);
    const shown: Shown = await expectWhole(page, tooltip);

    expect(shown.placement).toBe("bottom");

    await screenshot(page, "owner-tooltip-window-top-edge");
  });

  test("in dark mode it is whole, drawn on the dark surface, and reads", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, { query: "?theme=dark" });

    const tooltip: Locator = await showOwnerTooltip(page);
    await expectWhole(page, tooltip);

    const colors: { box: string; name: string } = await tooltip.evaluate(
      (root: HTMLElement, name: string): { box: string; name: string } => {
        const nameElement: HTMLElement = Array.from(
          root.querySelectorAll<HTMLElement>("div"),
        ).find((element: HTMLElement): boolean => {
          return element.textContent === name;
        })!;

        return {
          box: getComputedStyle(root.querySelector(".tippy-box")!)
            .backgroundColor,
          name: getComputedStyle(nameElement).color,
        };
      },
      FIRST_ROW_OWNER_NAME,
    );

    expect(colors.box).not.toBe("rgb(255, 255, 255)");
    expect(luminanceOf(colors.box)).toBeLessThan(0.1);
    expect(contrastOf(colors.box, colors.name)).toBeGreaterThanOrEqual(4.5);

    await screenshot(page, "owner-tooltip-first-row-dark");
  });

  test("on a page read right to left (Persian) it is whole", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, { query: "?lang=fa" });

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    const tooltip: Locator = await showOwnerTooltip(page);
    await expectWhole(page, tooltip);

    // Drawn in the page's reading direction.
    expect(
      await tooltip.evaluate((root: HTMLElement): string => {
        return getComputedStyle(root).direction;
      }),
    ).toBe("rtl");

    await screenshot(page, "owner-tooltip-first-row-fa");
  });

  test("in a narrow window, where the rows are cards, it is whole", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, { width: 820 });

    // A card, not a table row.
    expect(
      await rows(page)
        .first()
        .evaluate((row: HTMLElement): string => {
          return row.tagName;
        }),
    ).toBe("DIV");

    const tooltip: Locator = await showOwnerTooltip(page);
    await expectWhole(page, tooltip);

    await screenshot(page, "owner-tooltip-first-card-820");
  });

  test("on a 390px phone a card leaves the owners out: no owner's tooltip to cut off, nothing past the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, { width: 390, height: 844 });

    await expect(rows(page).first()).toContainText("Payments Primary");
    await expect(firstRowOwner(page)).toHaveCount(0);
    await expectNoSidewaysScroll(page, { message: "a 390px phone" });
  });
});
