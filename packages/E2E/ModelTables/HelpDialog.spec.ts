import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";
import { dashboardWord } from "../SuiteHelpers/LocaleChunks";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * The help a list page opens from its header's More options menu (Help),
 * drawn in Chromium by the real Device Roles page: Common's HelpModal
 * (#8889). Common/Tests/UI/Components/Help/HelpModal.test.tsx holds what the
 * dialog says and does in jsdom; this holds what only a browser shows:
 *   - a reading width, not the page's, with what the document says in short
 *     above its topics, the first topic open, its words lined up under the
 *     topic's name;
 *   - its topics walked by the keyboard, as WAI-ARIA's accordion is;
 *   - a phone's dialog that fits its window, Close in sight;
 *   - every word of it legible, at 4.5:1 or more against what is drawn
 *     behind it, in the light theme and in the dark one, whose overrides
 *     (Theme.css) are what turn the In short box from pale indigo to dark;
 *   - its own words in the page's language, and on a right-to-left page
 *     each topic's chevron at its start, pointing the way the page reads.
 */

const PROJECT: string = "10000000-0000-4000-8000-000000000001";
const ROLES: string = `/dashboard/${PROJECT}/network-devices/settings/roles`;
const TITLE: string = "How Device Roles Work";

// What WCAG's AA asks of text of a normal size.
const LEGIBLE_CONTRAST: number = 4.5;

// ModalWidth.Medium: a reading width, where Large is the page's.
const READING_WIDTH: number = 768;

const PHONE: { width: number; height: number } = { width: 390, height: 844 };

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/model-tables-ui",
);

interface FixtureRecord {
  unmodelled: Array<string>;
}

// The parts of the dialog whose words are read against what is behind them.
interface DialogPart {
  name: string;
  selector: string;
}

interface Legibility {
  name: string;
  contrast: number;
}

const WORDS: Array<DialogPart> = [
  {
    name: "the In short label",
    selector: "[data-testid=help-modal-summary] h3",
  },
  {
    name: "what it says in short",
    selector: "[data-testid=help-modal-summary] p",
  },
  {
    name: "a code word in what it says in short",
    selector: "[data-testid=help-modal-summary] code",
  },
  {
    name: "Expand all",
    selector: "[data-testid=help-modal-expand-all]",
  },
  {
    name: "a topic's name",
    selector: "[data-testid=help-modal-sections] h3 button span",
  },
  {
    name: "an open topic's words",
    selector:
      "[data-testid=help-modal-sections] [role=region]:not([hidden]) :is(p, li)",
  },
];

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
  // Every read the page made is one the fixture answers as the API does.
  expect((await fixture(page)).unmodelled).toEqual([]);
});

async function fixture(page: Page): Promise<FixtureRecord> {
  return await page.evaluate((): FixtureRecord => {
    return (window as unknown as { __fixture: FixtureRecord }).__fixture;
  });
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

/*
 * Every finite animation run to its end: the fixture's Tailwind writes its
 * styles as elements appear, so a transition plays on first paint, and the
 * dialog grows in from 95%. A box read meanwhile is short.
 */
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

async function open(
  page: Page,
  address: string,
  width: number = 1280,
  height: number = 900,
): Promise<void> {
  await page.setViewportSize({ width: width, height: height });
  await page.goto(address);
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await expect(page.getByTestId("table-skeleton-loader")).toHaveCount(0);
  await finishAnimations(page);
}

// Opens the page's help as a person does, and gives the dialog it opened.
async function openHelp(page: Page, language: string): Promise<Locator> {
  await page
    .getByRole("button", {
      name: dashboardWord(language, "More options"),
      exact: true,
    })
    .first()
    .click();
  await page
    .getByRole("menuitem", {
      name: dashboardWord(language, "Help"),
      exact: true,
    })
    .click();

  const dialog: Locator = page.getByRole("dialog");

  await expect(dialog.getByTestId("help-modal")).toBeVisible();
  await finishAnimations(page);

  return dialog;
}

function topicsOf(dialog: Locator): Locator {
  return dialog.getByTestId("help-modal-sections").locator("h3 > button");
}

function topicBodiesOf(dialog: Locator): Locator {
  return dialog.getByTestId("help-modal-sections").locator("[role=region]");
}

async function expectTopicsOpen(
  topics: Locator,
  open: Array<boolean>,
): Promise<void> {
  await expect
    .poll(async (): Promise<Array<boolean>> => {
      return (await topics.evaluateAll((buttons: Array<Element>) => {
        return buttons.map((button: Element): boolean => {
          return button.getAttribute("aria-expanded") === "true";
        });
      })) as Array<boolean>;
    })
    .toEqual(open);
}

/*
 * How far apart each part's words and what is drawn behind them are, as
 * WCAG measures it: the words' colour and every background under them,
 * each drawn over the one below as the browser composites them, down to the
 * first that is opaque.
 */
async function legibilityOf(dialog: Locator): Promise<Array<Legibility>> {
  return await dialog.evaluate(
    (root: Element, parts: Array<DialogPart>): Array<Legibility> => {
      type Colour = [number, number, number, number];

      const parse: (value: string) => Colour = (value: string): Colour => {
        const numbers: Array<number> = (value.match(/[\d.]+/g) || []).map(
          Number,
        );

        return [
          numbers[0] || 0,
          numbers[1] || 0,
          numbers[2] || 0,
          numbers.length > 3 ? numbers[3]! : 1,
        ];
      };

      const over: (top: Colour, bottom: Colour) => Colour = (
        top: Colour,
        bottom: Colour,
      ): Colour => {
        const alpha: number = top[3] + bottom[3] * (1 - top[3]);

        if (alpha === 0) {
          return [0, 0, 0, 0];
        }

        const mix: (channel: number) => number = (channel: number): number => {
          return (
            (top[channel]! * top[3] +
              bottom[channel]! * bottom[3] * (1 - top[3])) /
            alpha
          );
        };

        return [mix(0), mix(1), mix(2), alpha];
      };

      const backgroundOf: (element: Element) => Colour = (
        element: Element,
      ): Colour => {
        const layers: Array<Colour> = [];

        for (
          let node: Element | null = element;
          node;
          node = node.parentElement
        ) {
          const layer: Colour = parse(getComputedStyle(node).backgroundColor);

          if (layer[3] > 0) {
            layers.push(layer);
          }

          if (layer[3] >= 1) {
            break;
          }
        }

        let drawn: Colour = [255, 255, 255, 1];

        for (const layer of layers.reverse()) {
          drawn = over(layer, drawn);
        }

        return drawn;
      };

      const luminance: (colour: Colour) => number = (
        colour: Colour,
      ): number => {
        const linear: (value: number) => number = (value: number): number => {
          const share: number = value / 255;

          return share <= 0.04045
            ? share / 12.92
            : Math.pow((share + 0.055) / 1.055, 2.4);
        };

        return (
          0.2126 * linear(colour[0]) +
          0.7152 * linear(colour[1]) +
          0.0722 * linear(colour[2])
        );
      };

      return parts.map((part: DialogPart): Legibility => {
        const element: Element | null = root.querySelector(part.selector);

        // A part not drawn reads as illegible, and is named.
        if (!element) {
          return { name: part.name, contrast: 0 };
        }

        const background: Colour = backgroundOf(element);
        const words: Colour = over(
          parse(getComputedStyle(element).color),
          background,
        );
        const lighter: number = Math.max(
          luminance(words),
          luminance(background),
        );
        const darker: number = Math.min(
          luminance(words),
          luminance(background),
        );

        return {
          name: part.name,
          contrast:
            Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100,
        };
      });
    },
    WORDS,
  );
}

test.describe("the help dialog", () => {
  test("says in short what device roles are, over its topics, the first one open, at a reading width", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ROLES);

    const dialog: Locator = await openHelp(page, "en");
    const summary: Locator = dialog.getByTestId("help-modal-summary");
    const sections: Locator = dialog.getByTestId("help-modal-sections");
    const topics: Locator = topicsOf(dialog);
    const bodies: Locator = topicBodiesOf(dialog);

    await expect(dialog.getByTestId("modal-title")).toHaveText(TITLE);
    await expect(summary.locator("h3")).toHaveText("In short");

    const count: number = await topics.count();

    // Enough topics that only the first opens, and Expand all is offered.
    expect(count).toBeGreaterThan(2);
    await expectTopicsOpen(
      topics,
      Array.from({ length: count }, (_: unknown, index: number): boolean => {
        return index === 0;
      }),
    );
    await expect(bodies.first()).toBeVisible();
    await expect(bodies.nth(1)).toBeHidden();

    const [
      dialogBox,
      summaryBox,
      sectionsBox,
      nameBox,
      wordsBox,
    ]: Array<FrameBox> = await boxesInOneFrame([
      dialog,
      summary,
      sections,
      topics.first().locator("span"),
      // The topic's markdown as drawn: its words start at its left edge.
      bodies.first().locator(":scope > *").first(),
    ]);

    // A reading width at 1280px, not the page's.
    expect(dialogBox!.width).toBeLessThanOrEqual(READING_WIDTH);
    expect(dialogBox!.width).toBeGreaterThan(READING_WIDTH * 0.8);
    // In short first, then the topics.
    expect(summaryBox!.y + summaryBox!.height).toBeLessThanOrEqual(
      sectionsBox!.y,
    );
    // An open topic's words start where its name does, under it.
    expect(Math.abs(wordsBox!.x - nameBox!.x)).toBeLessThanOrEqual(1);
    expect(wordsBox!.y).toBeGreaterThan(nameBox!.y + nameBox!.height);

    // The page gives no documentation link, so the footer offers none.
    await expect(dialog.getByTestId("help-modal-docs-link")).toHaveCount(0);

    await screenshot(page, "help-dialog-1280");

    const expandAll: Locator = dialog.getByTestId("help-modal-expand-all");

    await expect(expandAll).toHaveText("Expand all");
    await expect(expandAll).toHaveAttribute("aria-expanded", "false");
    await expandAll.click();
    await expectTopicsOpen(
      topics,
      Array.from({ length: count }, (): boolean => {
        return true;
      }),
    );
    await expect(expandAll).toHaveText("Collapse all");
    await expect(expandAll).toHaveAttribute("aria-expanded", "true");
    await expect(bodies.last()).toBeVisible();

    await screenshot(page, "help-dialog-1280-expanded");

    await expandAll.click();
    await expectTopicsOpen(
      topics,
      Array.from({ length: count }, (): boolean => {
        return false;
      }),
    );
  });

  test("the keyboard walks its topics: arrows step, Home and End jump, Enter and Space open and close, Escape closes the dialog", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ROLES);

    const dialog: Locator = await openHelp(page, "en");
    const topics: Locator = topicsOf(dialog);
    const count: number = await topics.count();

    // The dialog takes the focus as it opens, not a topic.
    await expect(dialog).toBeFocused();

    await topics.first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(topics.nth(1)).toBeFocused();
    await page.keyboard.press("End");
    await expect(topics.nth(count - 1)).toBeFocused();
    // Past the last, round to the first, and back.
    await page.keyboard.press("ArrowDown");
    await expect(topics.first()).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(topics.nth(count - 1)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(topics.first()).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(topics.nth(1)).toHaveAttribute("aria-expanded", "true");
    await expect(topicBodiesOf(dialog).nth(1)).toBeVisible();

    // The topic a key reached shows it has the focus: a ring is drawn.
    expect(
      await topics.nth(1).evaluate((element: Element): string => {
        return getComputedStyle(element).boxShadow;
      }),
    ).not.toBe("none");

    await page.keyboard.press("Space");
    await expect(topics.nth(1)).toHaveAttribute("aria-expanded", "false");

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("help-modal")).toHaveCount(0);
  });

  test("on a phone it fits its window, Close in sight, each topic's words under its name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ROLES, PHONE.width, PHONE.height);

    const dialog: Locator = await openHelp(page, "en");
    const topics: Locator = topicsOf(dialog);

    await expectNoSidewaysScroll(page, {
      message: "The help dialog on a 390px phone",
    });

    const [
      dialogBox,
      summaryBox,
      sectionsBox,
      closeBox,
      nameBox,
      wordsBox,
    ]: Array<FrameBox> = await boxesInOneFrame([
      dialog,
      dialog.getByTestId("help-modal-summary"),
      dialog.getByTestId("help-modal-sections"),
      dialog
        .getByTestId("modal-footer")
        .getByRole("button", { name: "Close", exact: true }),
      topics.first().locator("span"),
      topicBodiesOf(dialog).first().locator(":scope > *").first(),
    ]);

    // The dialog inside the window, and Close inside it, in sight.
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(PHONE.width);
    expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
    expect(closeBox!.y + closeBox!.height).toBeLessThanOrEqual(PHONE.height);

    // In short and the topics inside the dialog, side to side.
    for (const box of [summaryBox!, sectionsBox!]) {
      expect(box.x).toBeGreaterThanOrEqual(dialogBox!.x);
      expect(box.x + box.width).toBeLessThanOrEqual(
        dialogBox!.x + dialogBox!.width,
      );
    }

    expect(Math.abs(wordsBox!.x - nameBox!.x)).toBeLessThanOrEqual(1);

    await screenshot(page, "help-dialog-390");
  });

  for (const theme of ["light", "dark"]) {
    test(`every word of it reads at ${LEGIBLE_CONTRAST}:1 or more against what is behind it, in the ${theme} theme`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, theme === "dark" ? `${ROLES}?theme=dark` : ROLES);

      const dialog: Locator = await openHelp(page, "en");
      const readings: Array<Legibility> = await legibilityOf(dialog);

      expect(readings.length).toBe(WORDS.length);
      expect(
        readings.filter((reading: Legibility): boolean => {
          return reading.contrast < LEGIBLE_CONTRAST;
        }),
      ).toEqual([]);

      await screenshot(page, `help-dialog-1280-${theme}`);
    });
  }

  for (const language of ["de", "fa"]) {
    const isRightToLeft: boolean = language === "fa";

    test(`in ${language}, its own words are the page's language, it fits a phone, and each topic's chevron is at its start${
      isRightToLeft ? ", on the right, pointing left" : ""
    }`, async ({ page }: { page: Page }) => {
      await open(page, `${ROLES}?lang=${language}`, PHONE.width, PHONE.height);

      const dialog: Locator = await openHelp(page, language);

      await expect(dialog.getByTestId("modal-title")).toHaveText(
        dashboardWord(language, TITLE),
      );
      await expect(
        dialog.getByTestId("help-modal-summary").locator("h3"),
      ).toHaveText(dashboardWord(language, "In short"));
      await expect(dialog.getByTestId("help-modal-expand-all")).toHaveText(
        dashboardWord(language, "Expand all"),
      );
      await expect(
        dialog.getByTestId("modal-footer").getByRole("button", {
          name: dashboardWord(language, "Close"),
          exact: true,
        }),
      ).toBeVisible();

      await expectNoSidewaysScroll(page, {
        message: `The help dialog in ${language} on a 390px phone`,
      });

      // A closed topic: its chevron, and the name beside it.
      const topic: Locator = topicsOf(dialog).nth(1);
      const [chevronBox, nameBox]: Array<FrameBox> = await boxesInOneFrame([
        topic.locator("svg"),
        topic.locator("span"),
      ]);

      if (isRightToLeft) {
        expect(chevronBox!.x).toBeGreaterThan(nameBox!.x);
      } else {
        expect(chevronBox!.x).toBeLessThan(nameBox!.x);
      }

      // Mirrored on a right-to-left page, so it points the way it reads.
      expect(
        await topic.locator("svg").evaluate((element: Element): string => {
          return getComputedStyle(element).scale;
        }),
      ).toBe(isRightToLeft ? "-1 1" : "none");

      await screenshot(page, `help-dialog-390-${language}`);
    });
  }
});
