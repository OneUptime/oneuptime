import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs";
import path from "path";
import { DrawnPopup, expectDrawnWhole } from "../SuiteHelpers/Popups";

/*
 * POPUPS MOVED ONTO THE TOOLTIP LAYER ARE WHOLE, AND KEEP THEIR KEYS.
 *
 * The parts the Dashboard draws them with, in the boxes it draws them in
 * (Fixture/Fixture.js, `?section=layered-popups`):
 *
 *   - an investigation drawer's body, short and scrolling, with an
 *     explorer's search and the logs search at its top: their syntax help
 *     and suggestions were drawn in place and ran into its scroll area
 *     (#9909). They are a combobox's popups, so the search keeps the focus,
 *     the arrows, Enter, Tab and Escape - checked here as well as whole;
 *   - Ask AI's composer row, in a card that rounds its corners, with its
 *     provider and "what the AI may do" pickers (#9910);
 *   - Code's request box, which clips, with its repository picker (#9910);
 *   - a session replay player that rounds its corners, with its "N
 *     sessions" menu (#9910).
 *
 * Each is drawn on the page's body (LayeredPopover), placed against the
 * window: whole on a laptop and on a phone, never inside the box that held
 * its control.
 */

const PORT: string = process.env["SHARED_UI_FIXTURE_PORT"] || "4329";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const ROUTE: string = `/dashboard/${PROJECT_ID}/shared-ui`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/shared-ui",
);

interface FixtureRecord {
  unmodelled: Array<string>;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing may leave the fixture.
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
  expect(pageErrors.get(page) || []).toEqual([]);
  expect(
    (
      await page.evaluate((): FixtureRecord => {
        return (window as unknown as { __fixture: FixtureRecord }).__fixture;
      })
    ).unmodelled,
  ).toEqual([]);
});

interface WindowSize {
  name: string;
  width: number;
  height: number;
}

const SIZES: Array<WindowSize> = [
  { name: "a laptop", width: 1280, height: 900 },
  { name: "a phone", width: 390, height: 844 },
];

async function open(
  page: Page,
  size: WindowSize,
  query: string = "",
): Promise<void> {
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.goto(`${ROUTE}?section=layered-popups${query}`);
  await expect(page.getByTestId("section-layered-popups")).toBeVisible({
    timeout: 60000,
  });
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
}

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    animations: "disabled",
  });
}

// Whether a box holds a popup: it must not, once the popup is on the layer.
async function isInside(box: Locator, popup: Locator): Promise<boolean> {
  const handle: Awaited<ReturnType<Locator["elementHandle"]>> =
    await popup.elementHandle();

  return await box.evaluate((element: Element, inner: Element | null) => {
    return Boolean(inner && element.contains(inner));
  }, handle);
}

interface SearchBox {
  name: string;
  testId: string;
  // The syntax help it drops down while it is empty.
  help: (page: Page) => Locator;
}

const SEARCHES: Array<SearchBox> = [
  {
    name: "an explorer's search",
    testId: "layered-explorer-search",
    help: (page: Page): Locator => {
      return page
        .locator(".layered-popover")
        .filter({ hasText: "Search syntax" })
        .locator("> div");
    },
  },
  {
    name: "the logs search",
    testId: "layered-logs-search",
    help: (page: Page): Locator => {
      return page.getByTestId("log-search-help");
    },
  },
];

function searchInput(page: Page, search: SearchBox): Locator {
  return page.getByTestId(search.testId).getByRole("textbox");
}

function suggestions(page: Page): Locator {
  return page.getByTestId("search-suggestions");
}

for (const size of SIZES) {
  test.describe(`on ${size.name} (${size.width}px)`, () => {
    for (const search of SEARCHES) {
      test(`${search.name}: its help and its suggestions open whole over the drawer, as wide as the search on a phone`, async ({
        page,
      }: {
        page: Page;
      }) => {
        await open(page, size);

        const drawer: Locator = page.getByTestId("layered-drawer");
        const input: Locator = searchInput(page, search);

        await input.click();

        const help: Locator = search.help(page);

        await expect(help).toBeVisible();

        const drawnHelp: DrawnPopup = await expectDrawnWhole(
          help,
          `${search.name}'s syntax help`,
        );

        expect(await isInside(drawer, help)).toBe(false);
        expect(drawnHelp.placement).toMatch(/^bottom/);

        await input.fill("se");

        const list: Locator = suggestions(page);

        await expect(list).toBeVisible();

        const drawnList: DrawnPopup = await expectDrawnWhole(
          list,
          `${search.name}'s suggestions`,
        );

        expect(await isInside(drawer, list)).toBe(false);

        // As wide as the search box it hangs from, as it was in place.
        const widths: { list: number; box: number } = await page
          .getByTestId(search.testId)
          .evaluate((box: Element) => {
            const field: Element | null = box.querySelector("div.relative");
            const shown: Element | null = document.querySelector(
              '[data-testid="search-suggestions"]',
            );

            return {
              list: shown ? shown.getBoundingClientRect().width : 0,
              box: field ? field.getBoundingClientRect().width : 0,
            };
          });

        expect(Math.abs(widths.list - widths.box)).toBeLessThanOrEqual(1);
        expect(drawnList.box.x + drawnList.box.width).toBeLessThanOrEqual(
          size.width,
        );

        await screenshot(
          page,
          `layered-${search.testId}-suggestions-${size.width}`,
        );
      });

      test(`${search.name}: the search keeps the focus and the keys`, async ({
        page,
      }: {
        page: Page;
      }) => {
        await open(page, size);

        const input: Locator = searchInput(page, search);

        await input.click();
        await input.fill("sev");
        await expect(suggestions(page)).toBeVisible();

        // The arrows move the selection, and the caret stays where it was.
        await input.press("End");
        await input.press("ArrowDown");

        const caret: number = await input.evaluate(
          (element: HTMLInputElement) => {
            return element.selectionStart || 0;
          },
        );

        expect(caret).toBe(3);
        await expect(
          suggestions(page).getByRole("button", { name: "severity" }),
        ).toHaveClass(/bg-indigo-50/);

        // Enter applies it, and the search keeps the focus.
        await input.press("Enter");
        await expect(input).toHaveValue("severity:");
        await expect(input).toBeFocused();

        // A press on a suggestion picks it and leaves the focus in the search.
        await input.fill("sta");
        await suggestions(page)
          .getByRole("button", { name: /^status$/ })
          .click();
        await expect(input).toHaveValue("status:");
        await expect(input).toBeFocused();

        // Escape is the search's: the list goes, the focus stays.
        await input.fill("se");
        await expect(suggestions(page)).toBeVisible();
        await input.press("Escape");
        await expect(suggestions(page)).toHaveCount(0);
        await expect(input).toBeFocused();

        // Tab goes on to the search's Clear button, never into the list.
        await input.fill("");
        await input.fill("se");
        await expect(suggestions(page)).toBeVisible();
        await input.press("Tab");
        await expect(
          page.getByTestId(search.testId).getByTitle("Clear search"),
        ).toBeFocused();
        await expect(suggestions(page)).toHaveCount(0);
      });
    }

    test("Ask AI's pickers open whole over the card, and close with the focus back", async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, size);

      const card: Locator = page.getByTestId("layered-composer");
      const provider: Locator = page.getByTitle("Choose LLM provider");

      await provider.click();

      const providers: Locator = page.getByRole("menu", {
        name: "LLM provider",
      });

      await expectDrawnWhole(providers, "the LLM provider menu");
      expect(await isInside(card, providers)).toBe(false);

      await page.keyboard.press("Escape");
      await expect(providers).toHaveCount(0);
      await expect(provider).toBeFocused();

      const modes: Locator = page.getByTitle(
        "Choose what the AI is allowed to do",
      );

      await modes.click();

      const permissions: Locator = page.getByRole("menu", {
        name: "AI permissions",
      });

      await expectDrawnWhole(permissions, "the AI permissions menu");
      expect(await isInside(card, permissions)).toBe(false);

      await screenshot(page, `layered-ai-permissions-${size.width}`);

      // Tab from the button reaches the menu's first mode.
      await modes.focus();
      await page.keyboard.press("Tab");
      await expect(
        permissions.getByRole("menuitemradio").first(),
      ).toBeFocused();

      await permissions
        .getByRole("menuitemradio", { name: /^Read-only/ })
        .click();
      await expect(permissions).toHaveCount(0);
      await expect(modes).toHaveText(/Read-only/);
      await expect(modes).toBeFocused();
    });

    test("Code's repository picker opens whole over the request box, and the keys pick", async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, size);

      const box: Locator = page.getByTestId("layered-request");
      const button: Locator = page.getByTestId("layered-repository-button");

      await button.click();

      const menu: Locator = page.getByTestId("layered-repository-menu");

      await expectDrawnWhole(menu, "the repository list");
      expect(await isInside(box, menu)).toBe(false);
      await expect(page.getByTestId("layered-repository-search")).toBeFocused();

      await screenshot(page, `layered-code-picker-${size.width}`);

      await page.keyboard.type("pay");
      await page.keyboard.press("Enter");

      await expect(menu).toHaveCount(0);
      await expect(page.getByTestId("layered-repository-value")).toHaveText(
        "payments",
      );
      await expect(button).toBeFocused();

      // Escape closes it, picking nothing, and gives the button its focus back.
      await button.click();
      await expect(menu).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(button).toBeFocused();
    });

    test("the player's sessions menu opens whole over the player, and the keys move through it", async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, size);

      const player: Locator = page.getByTestId("layered-player");
      const trigger: Locator = page.getByTestId("replay-user-sessions-button");

      await trigger.click();

      const menu: Locator = page.getByTestId("replay-user-sessions-menu");

      await expectDrawnWhole(menu, "the sessions menu");
      expect(await isInside(player, menu)).toBe(false);

      // It opens on the session being watched; the arrows move from there.
      const current: Locator = menu.getByRole("option", { selected: true });

      await expect(current).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(menu.locator('[data-session-id="older"]')).toBeFocused();

      await screenshot(page, `layered-replay-sessions-${size.width}`);

      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();

      // A press outside closes it.
      await trigger.click();
      await expect(menu).toBeVisible();
      await page.mouse.click(2, 2);
      await expect(menu).toHaveCount(0);
    });
  });
}

test("in the dark theme, the suggestions and the help are drawn on the dark surface", async ({
  page,
}: {
  page: Page;
}) => {
  await open(
    page,
    { name: "a laptop", width: 1280, height: 900 },
    "&theme=dark",
  );

  const input: Locator = searchInput(page, SEARCHES[0]!);

  await input.click();

  const help: Locator = SEARCHES[0]!.help(page);

  await expectDrawnWhole(help, "the dark syntax help");
  expect(
    await help.evaluate((element: Element): string => {
      return getComputedStyle(element).backgroundColor;
    }),
  ).not.toBe("rgb(255, 255, 255)");

  await input.fill("se");
  await expectDrawnWhole(suggestions(page), "the dark suggestions");
  expect(
    await suggestions(page).evaluate((element: Element): string => {
      return getComputedStyle(element).backgroundColor;
    }),
  ).not.toBe("rgb(255, 255, 255)");

  await screenshot(page, "layered-explorer-search-dark-1280");
});
