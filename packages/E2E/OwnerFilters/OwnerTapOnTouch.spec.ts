import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs";
import path from "path";
import {
  contrastOf,
  expectDrawnWhole,
  luminanceOf,
} from "../SuiteHelpers/Popups";

/*
 * ON A TOUCH SCREEN, A TAP ON A CARD'S OWNER SAYS WHO OWNS THE ROW (#9866).
 *
 * From 768px to about 1100px wide, beside the side menu, a list draws its
 * rows as cards, and the cards keep their Owners: a tablet's width, with no
 * pointer to hover. An owner is drawn as initials, its name only in the
 * avatar's hover tooltip, and a tap on the avatar was a tap on the card,
 * which opened the record: on a tablet the list never said who owned a row.
 * In this fixture at 844x390 with touch, a tap on the first card's owner
 * opened the schedule instead of naming its owner.
 *
 * Now the first tap on the avatar shows its tooltip - drawn whole on the
 * page's body (#9769) - and the card stays: the schedules list is still the
 * page. It stays once the finger lifts. A second tap on the avatar, or a tap
 * anywhere else on the card, opens the schedule as before. A mouse's click
 * on the avatar of a table's row opens the schedule at once, as it always
 * did.
 *
 * On-Call > Schedules, in Chromium with touch, against the offline fixture
 * (OwnerFilters/Fixture). Payments Primary, the first card, is owned by the
 * Payments team, drawn as "P".
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000f1";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/on-call-duty/schedules`;
const PORT: string = process.env["OWNER_FILTERS_FIXTURE_PORT"] || "4481";
const TABLE_ID: string = "on-call-schedules-table";
const OWNER: string = "Payments";
// A schedule's own page: where a card opens.
const SCHEDULE_PAGE: RegExp =
  /\/on-call-duty\/schedules\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

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
});

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    animations: "disabled",
  });
}

// The list's rows: table rows on a laptop, cards in a narrower window.
function rows(page: Page): Locator {
  return page.locator(`#${TABLE_ID}-body > tr, #${TABLE_ID}-body > div`);
}

async function openList(
  page: Page,
  options: { width: number; height: number; query?: string },
): Promise<void> {
  await page.setViewportSize({ width: options.width, height: options.height });
  await page.goto(`${PAGE_PATH}${options.query || ""}`);
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await expect(page.getByTestId("table-skeleton-loader")).toHaveCount(0);
  // The first load parses a large bundle.
  await expect(rows(page).first()).toBeVisible({ timeout: 60000 });
}

// The first card's owner: an image named by its owner (#9850).
function firstOwner(page: Page): Locator {
  return rows(page).first().getByRole("img", { name: OWNER });
}

// The owner's tooltip's box, wherever the page draws it.
function ownerTooltip(page: Page): Locator {
  return page
    .locator("[data-tippy-root]")
    .filter({ hasText: OWNER })
    .locator(".tippy-box");
}

async function expectStillTheList(page: Page): Promise<void> {
  expect(new URL(page.url()).pathname).toBe(PAGE_PATH);
  await expect(rows(page).first()).toContainText("Payments Primary");
}

const TABLET_SIZES: Array<{ name: string; width: number; height: number }> = [
  { name: "a tablet held upright", width: 820, height: 1180 },
  { name: "a tablet on its side", width: 1024, height: 768 },
  { name: "the fixture's 844x390", width: 844, height: 390 },
];

test.describe("a card's owner, tapped on a touch screen (#9866)", () => {
  test.use({ hasTouch: true });

  for (const size of TABLET_SIZES) {
    test(`on ${size.name}, the first tap says who owns the row and keeps the list`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openList(page, size);

      // A card, not a table row: the width the issue is about.
      expect(
        await rows(page)
          .first()
          .evaluate((row: Element): string => {
            return row.tagName;
          }),
      ).toBe("DIV");

      await firstOwner(page).scrollIntoViewIfNeeded();
      await firstOwner(page).tap();

      await expect(ownerTooltip(page)).toBeVisible();
      await expect(ownerTooltip(page)).toContainText("Team");
      await expectDrawnWhole(
        ownerTooltip(page),
        `the owner's tooltip on ${size.name}`,
      );
      await expectStillTheList(page);

      // The finger has lifted: it stays.
      await page.waitForTimeout(600);
      await expect(ownerTooltip(page)).toBeVisible();
      await expectStillTheList(page);

      await screenshot(page, `owner-tap-${size.width}x${size.height}`);
    });
  }

  test("a second tap on the owner opens the schedule, as before", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, { width: 820, height: 1180 });

    await firstOwner(page).tap();
    await expect(ownerTooltip(page)).toBeVisible();
    await expectStillTheList(page);

    await firstOwner(page).tap();
    await expect(page).toHaveURL(SCHEDULE_PAGE);
  });

  test("a tap anywhere else on the card opens the schedule, as before", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, { width: 820, height: 1180 });

    await firstOwner(page).tap();
    await expect(ownerTooltip(page)).toBeVisible();

    await rows(page)
      .first()
      .getByText("Payments Primary", { exact: true })
      .first()
      .tap();
    await expect(page).toHaveURL(SCHEDULE_PAGE);
  });

  test("a tap away from the card puts it away, and the next tap on the owner shows it again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, { width: 820, height: 1180 });

    await firstOwner(page).tap();
    await expect(ownerTooltip(page)).toBeVisible();

    // The page's heading: nothing there opens anything.
    await page.getByRole("heading").first().tap();
    await expect(ownerTooltip(page)).toHaveCount(0);
    await expectStillTheList(page);

    await firstOwner(page).tap();
    await expect(ownerTooltip(page)).toBeVisible();
    await expectStillTheList(page);
  });

  test("in the dark theme the tapped tooltip is whole, on the dark surface, and reads", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, { width: 820, height: 1180, query: "?theme=dark" });

    await firstOwner(page).tap();
    await expect(ownerTooltip(page)).toBeVisible();
    await expectDrawnWhole(ownerTooltip(page), "the dark owner's tooltip");

    const colors: { box: string; name: string } = await ownerTooltip(
      page,
    ).evaluate((box: Element, owner: string): { box: string; name: string } => {
      const name: Element = Array.from(box.querySelectorAll("div")).find(
        (element: Element): boolean => {
          return element.textContent === owner;
        },
      )!;

      return {
        box: getComputedStyle(box).backgroundColor,
        name: getComputedStyle(name).color,
      };
    }, OWNER);

    expect(luminanceOf(colors.box)).toBeLessThan(0.1);
    expect(contrastOf(colors.box, colors.name)).toBeGreaterThanOrEqual(4.5);
    await expectStillTheList(page);

    await screenshot(page, "owner-tap-dark-820");
  });

  test("on a page read right to left (Persian) the tapped tooltip is whole, and the card stays", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, { width: 820, height: 1180, query: "?lang=fa" });
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    await firstOwner(page).tap();
    await expect(ownerTooltip(page)).toBeVisible();
    await expectDrawnWhole(ownerTooltip(page), "the Persian owner's tooltip");

    expect(
      await ownerTooltip(page).evaluate((box: Element): string => {
        return getComputedStyle(box).direction;
      }),
    ).toBe("rtl");
    expect(new URL(page.url()).pathname).toBe(PAGE_PATH);

    await screenshot(page, "owner-tap-fa-820");
  });

  test("the owner is still named for a screen reader, tapped or not", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, { width: 820, height: 1180 });

    await expect(firstOwner(page)).toHaveAccessibleName(OWNER);
    await firstOwner(page).tap();
    await expect(firstOwner(page)).toHaveAccessibleName(OWNER);
  });
});

test.describe("a row's owner, clicked with a mouse", () => {
  test("a click opens the schedule at once, as it always did", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, { width: 1280, height: 900 });

    // A table row, on a laptop.
    expect(
      await rows(page)
        .first()
        .evaluate((row: Element): string => {
          return row.tagName;
        }),
    ).toBe("TR");

    await firstOwner(page).click();
    await expect(page).toHaveURL(SCHEDULE_PAGE);
  });
});
