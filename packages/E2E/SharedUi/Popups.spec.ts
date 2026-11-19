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
  DrawnPopup,
  expectDrawnWhole,
  luminanceOf,
} from "../SuiteHelpers/Popups";

/*
 * MENUS, PANELS AND DEFINITIONS OPENED IN BOXES THAT CLIP ARE WHOLE.
 *
 * The shared parts the Dashboard draws them with, in the boxes it draws
 * them in (Fixture/Fixture.js, `?section=popups`):
 *
 *   - a logs list with no filter bar, its toolbar in the list's card and
 *     nothing under it yet: Columns, saved views, the keyboard shortcuts,
 *     Export and the time range were cut off at the card's foot (#9859);
 *   - a log row expanded in a list that scrolls sideways: the Copy
 *     attributes menu was cut off at the row's foot (#9861);
 *   - the traces explorer's facet list, 224px wide and scrolling: the Span
 *     Type's 288px definition was cut off at its edge (#9863).
 *
 * Each is drawn on the page's body now (the tooltip layer), placed against
 * the window. Here in both themes, on a page read right to left (Persian,
 * where each hangs from its control's other edge), on a tablet and a phone,
 * and from the keyboard. The trace and the traces explorer's own pages hold
 * the same in TraceDetail/MenusNeverCutOff.spec.ts and
 * ChartTimeZoom/FacetDefinitionWhole.spec.ts.
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

  // Nothing may leave the fixture: the glossary's read is refused, as offline.
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

async function open(
  page: Page,
  options: { width: number; height: number; query?: string },
): Promise<void> {
  await page.setViewportSize({ width: options.width, height: options.height });
  await page.goto(`${ROUTE}?section=popups${options.query || ""}`);
  await expect(page.getByTestId("section-popups")).toBeVisible({
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

function logsCard(page: Page): Locator {
  return page.getByTestId("popups-logs-card");
}

// The toolbar's display controls: Columns, the shortcuts, Export, the time range.
function displayControls(page: Page): Locator {
  return logsCard(page).getByTestId("logs-viewer-display-controls");
}

interface Popup {
  name: string;
  // Opens it, and says what it is and what opened it.
  open: (page: Page) => Promise<{ popup: Locator; control: Locator }>;
  /*
   * The edge of its control it hangs from, in the line's direction - or the
   * one it picked by the room it has (the time range, data-align).
   */
  edge: "start" | "end" | "picked";
  // The box that used to cut it off.
  box: (page: Page) => Locator;
}

const POPUPS: Array<Popup> = [
  {
    name: "Columns",
    edge: "end",
    box: logsCard,
    open: async (page: Page) => {
      const control: Locator = displayControls(page).locator(
        'button[aria-haspopup="dialog"]',
      );
      await control.click();
      return { popup: page.getByTestId("column-selector-panel"), control };
    },
  },
  {
    name: "saved views",
    edge: "start",
    box: logsCard,
    open: async (page: Page) => {
      // The view's controls, before the display controls: saved views.
      const control: Locator = logsCard(page)
        .getByTestId("logs-viewer-toolbar")
        .locator("> div")
        .first()
        .locator('button[aria-haspopup="dialog"]');
      await control.click();
      return { popup: page.getByRole("dialog").last(), control };
    },
  },
  {
    name: "the keyboard shortcuts",
    edge: "end",
    box: logsCard,
    open: async (page: Page) => {
      const control: Locator = displayControls(page).locator("button:has(kbd)");
      await control.click();
      return { popup: page.getByTestId("keyboard-shortcuts-help"), control };
    },
  },
  {
    name: "Export",
    edge: "end",
    box: logsCard,
    open: async (page: Page) => {
      // Export: the button drawn with the download tray.
      const control: Locator = displayControls(page).locator(
        'button:has(path[d^="M3 16.5v2.25"])',
      );
      await control.click();
      return { popup: page.getByTestId("logs-viewer-export-menu"), control };
    },
  },
  {
    name: "the time range",
    edge: "picked",
    box: logsCard,
    open: async (page: Page) => {
      const control: Locator = page.getByTestId("log-time-range-picker-button");
      await control.click();
      return {
        popup: page.getByTestId("log-time-range-picker-dropdown"),
        control,
      };
    },
  },
  {
    name: "Copy attributes",
    edge: "end",
    box: (page: Page): Locator => {
      return page.getByTestId("popups-log-rows-scroll");
    },
    open: async (page: Page) => {
      const control: Locator = page
        .getByTestId("popups-copy-json")
        .locator("button[aria-haspopup='menu']");
      await control.click();
      return { popup: page.getByRole("menu"), control };
    },
  },
  {
    name: "the Span definition",
    edge: "start",
    box: (page: Page): Locator => {
      return page.getByTestId("popups-facet-list");
    },
    open: async (page: Page) => {
      const control: Locator = page
        .getByTestId("popups-facet-list")
        .getByTestId("defined-term");
      await control.click();
      return {
        popup: page
          .locator("[data-tippy-root]")
          .filter({ has: page.getByTestId("defined-term-popover") })
          .locator(".tippy-box"),
        control,
      };
    },
  },
];

// Whether the box that used to cut the popup off holds it now.
async function boxHolds(box: Locator, popup: Locator): Promise<boolean> {
  const handle: Awaited<ReturnType<Locator["elementHandle"]>> =
    await popup.elementHandle();

  return await box.evaluate((element: Element, drawn: unknown): boolean => {
    return element.contains(drawn as Node);
  }, handle);
}

async function closeAll(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.mouse.click(2, 2);
}

for (const theme of ["light", "dark"] as const) {
  for (const language of ["en", "fa"] as const) {
    test.describe(`in the ${theme} theme, ${language === "fa" ? "in Persian, right to left" : "in English"}`, () => {
      test("every popup opens whole, over the page, hung from its control's edge", async ({
        page,
      }: {
        page: Page;
      }) => {
        await open(page, {
          width: 1280,
          height: 900,
          query: `${theme === "dark" ? "&theme=dark" : ""}${language === "fa" ? "&lang=fa" : ""}`,
        });

        if (language === "fa") {
          await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
        }

        for (const item of POPUPS) {
          const { popup } = await item.open(page);
          await expect(popup).toBeVisible();

          const drawn: DrawnPopup = await expectDrawnWhole(
            popup,
            `${item.name} (${theme}, ${language})`,
          );

          expect(
            await boxHolds(item.box(page), popup),
            `${item.name} is not inside the box that cut it off`,
          ).toBe(false);

          /*
           * Hung from its control's start or end, as the line is read:
           * Popper's start is the left, so a page read from the right swaps
           * them. The glossary's definition is a tooltip, above its word.
           */
          if (item.name !== "the Span definition") {
            const edge: string =
              item.edge === "picked"
                ? (await popup.getAttribute("data-align")) === "right"
                  ? "end"
                  : "start"
                : item.edge;
            const isLeftEdge: boolean =
              (edge === "start") !== (language === "fa");

            expect(drawn.placement, `${item.name}'s side and edge`).toMatch(
              new RegExp(`^(bottom|top)-${isLeftEdge ? "start" : "end"}$`),
            );
          }

          // In the page's direction.
          expect(
            await popup.evaluate((element: Element): string => {
              return getComputedStyle(element).direction;
            }),
          ).toBe(language === "fa" ? "rtl" : "ltr");

          if (theme === "dark" && item.name !== "the Span definition") {
            const ground: string = await popup.evaluate(
              (element: Element): string => {
                // A see-through ground is no ground: the one under it is.
                const seeThrough: RegExp = new RegExp("rgba\\(.*,\\s*0\\)$");
                let node: Element | null = element;

                while (node) {
                  const color: string = getComputedStyle(node).backgroundColor;

                  if (color && !seeThrough.test(color)) {
                    return color;
                  }

                  node = node.parentElement;
                }

                return "";
              },
            );

            expect(
              luminanceOf(ground),
              `${item.name}'s ground in the dark theme`,
            ).toBeLessThan(0.1);
          }

          if (item.name === "Columns") {
            await screenshot(page, `popups-columns-${theme}-${language}`);
          }

          await closeAll(page);
          await expect(popup).toHaveCount(0);
        }
      });
    });
  }
}

test.describe("on a tablet and a phone", () => {
  for (const size of [
    { name: "a tablet", width: 820, height: 1180 },
    { name: "a phone", width: 390, height: 844 },
  ]) {
    test(`on ${size.name}, every popup opens whole, inside the screen's sides`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, { width: size.width, height: size.height });

      for (const item of POPUPS) {
        const { popup } = await item.open(page);
        await expect(popup).toBeVisible();

        const drawn: DrawnPopup = await expectDrawnWhole(
          popup,
          `${item.name} on ${size.name}`,
        );

        if (item.name !== "the Span definition") {
          // 8px inside the screen's sides, as every portalled menu is.
          expect(drawn.box.x).toBeGreaterThanOrEqual(7.5);
          expect(drawn.box.x + drawn.box.width).toBeLessThanOrEqual(
            size.width - 7.5,
          );
        }

        await closeAll(page);
        await expect(popup).toHaveCount(0);
      }

      await screenshot(page, `popups-${size.width}`);
    });
  }
});

test.describe("from the keyboard, on a page read right to left", () => {
  test("Tab goes into Columns and back, and Escape hands the focus back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { width: 1280, height: 900, query: "&lang=fa" });

    const control: Locator = displayControls(page).locator(
      'button[aria-haspopup="dialog"]',
    );
    await control.focus();
    await page.keyboard.press("Enter");

    const panel: Locator = page.getByTestId("column-selector-panel");
    await expect(panel).toBeVisible();

    await page.keyboard.press("Tab");
    expect(
      await panel.evaluate((element: Element): boolean => {
        return element.contains(document.activeElement);
      }),
      "Tab went into the panel",
    ).toBe(true);

    await page.keyboard.press("Shift+Tab");
    await expect(control).toBeFocused();

    await page.keyboard.press("Tab");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(control).toBeFocused();
  });

  test("the Copy attributes menu: the arrows move between shapes, Escape hands the focus back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { width: 1280, height: 900, query: "&lang=fa" });

    const caret: Locator = page
      .getByTestId("popups-copy-json")
      .locator("button[aria-haspopup='menu']");
    await caret.focus();
    await page.keyboard.press("ArrowDown");

    const menu: Locator = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitemradio").first()).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitemradio").last()).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(caret).toBeFocused();
  });

  test("the Span definition: Tab goes from the word to Read more, then on from the word", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { width: 1280, height: 900, query: "&lang=fa" });

    const word: Locator = page
      .getByTestId("popups-facet-list")
      .getByTestId("defined-term");

    await page
      .getByTestId("popups-facet-list")
      .locator("button[aria-expanded]")
      .first()
      .focus();
    await page.keyboard.press("Tab");
    await expect(word).toBeFocused();
    await expect(page.getByTestId("defined-term-read-more")).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(page.getByTestId("defined-term-read-more")).toBeFocused();

    // Past its last: on from the word, to the facet's first option.
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("defined-term-read-more")).toHaveCount(0);
    await expect(page.getByTestId("popups-entry-spans")).toBeFocused();
  });

  test("in the dark theme the definition reads on the dark surface", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { width: 1280, height: 900, query: "&theme=dark" });

    await page
      .getByTestId("popups-facet-list")
      .getByTestId("defined-term")
      .click();

    const box: Locator = page
      .locator("[data-tippy-root]")
      .filter({ has: page.getByTestId("defined-term-popover") })
      .locator(".tippy-box");
    await expect(box).toBeVisible();

    const colors: { ground: string; link: string } = await box.evaluate(
      (element: Element): { ground: string; link: string } => {
        return {
          ground: getComputedStyle(element).backgroundColor,
          link: getComputedStyle(
            element.querySelector('[data-testid="defined-term-read-more"]')!,
          ).color,
        };
      },
    );

    expect(luminanceOf(colors.ground)).toBeLessThan(0.1);
    expect(contrastOf(colors.ground, colors.link)).toBeGreaterThanOrEqual(4.5);
  });
});
