import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import {
  contrastOf,
  DrawnPopup,
  expectDrawnWhole,
  luminanceOf,
} from "../SuiteHelpers/Popups";

/*
 * A GLOSSARY TERM'S DEFINITION IS WHOLE IN THE TRACES FACET SIDEBAR (#9863).
 *
 * The Traces explorer's Span Type draws its title as the Glossary's Span.
 * Its definition was drawn after the title, inside the facet list - a box
 * that scrolls, 224px wide by default - and the definition is 288px wide:
 * Popper slid it along but could not fit it, and its end was cut off at the
 * sidebar's edge. It is drawn on the page's body now, as every tooltip is
 * (TooltipLayer), and placed against the window: whole at its four corners
 * at the sidebar's default width, beside a tablet's list and on a phone, in
 * both themes. The keyboard still goes from the word to Read more, and on
 * from the word to the (i) after it.
 *
 * The production explorer, on the offline fixture (Fixture/Fixture.js).
 */

const PORT: string = process.env["CHART_TIME_ZOOM_FIXTURE_PORT"] || "4233";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const TRACES_PATH: string = `/dashboard/${PROJECT_ID}/traces`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/chart-time-zoom-ui",
);

interface SpecWindow {
  __chartTimeZoomFixture: {
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

  await page.clock.install({ time: NOW });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    await page
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
      }),
    "requests the fixture does not model",
  ).toEqual([]);
});

async function open(
  page: Page,
  options: { width: number; height?: number; theme?: "dark" },
): Promise<void> {
  await page.setViewportSize({
    width: options.width,
    height: options.height || 1000,
  });
  await page.goto(
    `${TRACES_PATH}${options.theme === "dark" ? "?theme=dark" : ""}`,
  );
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });

  // Below md the sidebar is folded behind the Filters toggle.
  const toggle: Locator = page.getByTestId("telemetry-viewer-filters-toggle");
  if (await toggle.isVisible()) {
    await toggle.click();
  }

  await expect(spanTypeTitle(page)).toBeVisible({ timeout: 30000 });
  await spanTypeTitle(page).evaluate((element: Element): void => {
    element.scrollIntoView({ block: "center" });
  });
}

// The Span Type's title: the defined word beside the fold button.
function spanTypeTitle(page: Page): Locator {
  return page.getByTestId("facet-section-defined-title").first();
}

function word(page: Page): Locator {
  return spanTypeTitle(page).getByTestId("defined-term");
}

// The definition's box: the popover's Tippy box, on the page's body.
function definitionBox(page: Page): Locator {
  return page
    .locator("[data-tippy-root]")
    .filter({ has: page.getByTestId("defined-term-popover") })
    .locator(".tippy-box");
}

// The list of facets the title sits in: the box that scrolls, and clipped it.
async function facetListOf(title: Locator): Promise<{
  right: number;
  holdsTheDefinition: boolean;
}> {
  return await title.evaluate(
    (element: Element): { right: number; holdsTheDefinition: boolean } => {
      let box: Element | null = element.parentElement;

      while (box && getComputedStyle(box).overflowY !== "auto") {
        box = box.parentElement;
      }

      return {
        right: box ? box.getBoundingClientRect().right : 0,
        holdsTheDefinition: Boolean(
          box && box.querySelector('[data-testid="defined-term-popover"]'),
        ),
      };
    },
  );
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    animations: "disabled",
  });
}

test.describe("Traces explorer: the Span Type's definition is never cut off (#9863)", () => {
  for (const size of [
    { name: "at the sidebar's default width", width: 1440 },
    { name: "beside a tablet's list", width: 820 },
    { name: "on a phone", width: 390 },
  ]) {
    test(`${size.name}, it is drawn over the page, whole, past the facet list's edge`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, { width: size.width });

      await word(page).click();
      await expect(page.getByTestId("defined-term-read-more")).toBeVisible();

      const drawn: DrawnPopup = await expectDrawnWhole(
        definitionBox(page),
        `the Span definition ${size.name}`,
      );
      const list: { right: number; holdsTheDefinition: boolean } =
        await facetListOf(spanTypeTitle(page));

      expect(list.holdsTheDefinition).toBe(false);

      if (size.width >= 768) {
        // Wider than the facet list: it reaches past the list's edge, whole.
        expect(drawn.box.x + drawn.box.width).toBeGreaterThan(list.right);
      }

      // The section stays open: the word's press folds nothing.
      await expect(
        page.locator("button[aria-expanded][aria-label='Span Type']").first(),
      ).toHaveAttribute("aria-expanded", "true");

      await screenshot(page, `facet-definition-whole-${size.width}`);
    });
  }

  test("in the dark theme it is whole, on the dark surface, and reads", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await open(page, { width: 1440, theme: "dark" });

    await word(page).click();
    await expect(page.getByTestId("defined-term-read-more")).toBeVisible();
    await expectDrawnWhole(definitionBox(page), "the dark Span definition");

    const colors: { box: string; link: string } = await definitionBox(
      page,
    ).evaluate((box: Element): { box: string; link: string } => {
      return {
        box: getComputedStyle(box).backgroundColor,
        link: getComputedStyle(
          box.querySelector('[data-testid="defined-term-read-more"]')!,
        ).color,
      };
    });

    expect(luminanceOf(colors.box)).toBeLessThan(0.1);
    expect(contrastOf(colors.box, colors.link)).toBeGreaterThanOrEqual(4.5);

    await screenshot(page, "facet-definition-whole-dark-1440");
  });

  test("the keyboard goes from the word to Read more, then on from the word to the (i)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { width: 1440 });

    await page
      .locator("button[aria-expanded][aria-label='Span Type']")
      .first()
      .focus();
    await page.keyboard.press("Tab");
    await expect(word(page)).toBeFocused();
    await expect(page.getByTestId("defined-term-read-more")).toBeVisible();

    // Into the definition, drawn on the page's body.
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("defined-term-read-more")).toBeFocused();
    expect(
      await page
        .getByTestId("defined-term-read-more")
        .evaluate((link: Element): boolean => {
          return (
            link.closest("[data-tippy-root]")?.parentElement === document.body
          );
        }),
    ).toBe(true);

    // Past its last: on from the word, to the (i) right after the title.
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "About Span Type", exact: true }),
    ).toBeFocused();
    await expect(page.getByTestId("defined-term-read-more")).toHaveCount(0);
  });

  test("Escape puts it away and leaves the focus on the word", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { width: 1440 });

    await page
      .locator("button[aria-expanded][aria-label='Span Type']")
      .first()
      .focus();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("defined-term-read-more")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("defined-term-read-more")).toBeHidden();
    await expect(word(page)).toBeFocused();
  });
});
