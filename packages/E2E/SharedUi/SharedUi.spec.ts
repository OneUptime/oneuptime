import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs";
import path from "path";

/*
 * The shared buttons, dialogs and cards, drawn by the production components
 * in a real browser against the offline fixture (SharedUi/Fixture), where
 * jsdom cannot show them: what a button draws, how it looks when it cannot
 * be pressed and under the pointer, where a dialog's first focus lands once
 * its form has drawn, what a card says on a phone, how tall an open section
 * gets, what the pills, stat tiles and chips look like, and a team's avatar
 * on a dark card - at 1280 and 390 pixels, beside a side menu at 1024 and
 * 768, in the dark theme, and in German, Persian, Japanese and Chinese.
 */

const PORT: string = process.env["SHARED_UI_FIXTURE_PORT"] || "4329";

const ROUTE: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/shared-ui";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/shared-ui",
);

const LOCALES: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/Dashboard/src/Locales",
);

// Every ButtonStyleType, as the gallery draws a row for each.
const OUTLINE_STYLES: Array<string> = [
  "OUTLINE",
  "HOVER_DANGER_OUTLINE",
  "HOVER_SUCCESS_OUTLINE",
  "HOVER_PRIMARY_OUTLINE",
];

const ALL_STYLES: Array<string> = [
  "PRIMARY",
  "SECONDARY",
  "OUTLINE",
  "NORMAL",
  "DANGER",
  "DANGER_OUTLINE",
  "SUCCESS",
  "SUCCESS_OUTLINE",
  "WARNING",
  "WARNING_OUTLINE",
  "ICON_LIGHT",
  "LINK",
  "SECONDARY_LINK",
  "ICON",
  "HOVER_DANGER_OUTLINE",
  "HOVER_SUCCESS_OUTLINE",
  "HOVER_PRIMARY_OUTLINE",
];

// The styles that draw a fill of their own.
const FILLED_STYLES: Array<string> = [
  "PRIMARY",
  "SECONDARY",
  "DANGER",
  "SUCCESS",
  "WARNING",
];

// Tailwind 3.4's colours, as the browser reports them.
const GRAY_50: string = "rgb(249, 250, 251)";
const GRAY_100: string = "rgb(243, 244, 246)";
const RED_50: string = "rgb(254, 242, 242)";
const RED_700: string = "rgb(185, 28, 28)";
const GREEN_50: string = "rgb(240, 253, 244)";
const GREEN_700: string = "rgb(21, 128, 61)";
const INDIGO_50: string = "rgb(238, 242, 255)";
const INDIGO_700: string = "rgb(67, 56, 202)";

interface FixtureRecord {
  reads: Array<{ kind: string; tableName: string; id?: string }>;
  updates: Array<{ tableName: string; id: string; deleted?: boolean }>;
  unmodelled: Array<string>;
}

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
  expect(pageErrors.get(page) || []).toEqual([]);
  // Every read the page made is one the fixture answers as the API does.
  expect((await fixture(page)).unmodelled).toEqual([]);
});

async function fixture(page: Page): Promise<FixtureRecord> {
  return await page.evaluate((): FixtureRecord => {
    return (window as unknown as { __fixture: FixtureRecord }).__fixture;
  });
}

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`${ROUTE}?${query}`);
  await expect(page.getByTestId("shared-ui-gallery")).toBeVisible();
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
}

async function screenshot(
  page: Page,
  name: string,
  options: { fullPage?: boolean } = {},
): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: options.fullPage !== false,
    animations: "disabled",
  });
}

async function styleOf(locator: Locator, property: string): Promise<string> {
  return await locator.evaluate((element: Element, name: string): string => {
    return window.getComputedStyle(element).getPropertyValue(name);
  }, property);
}

async function horizontalOverflow(page: Page): Promise<number> {
  return await page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
}

/*
 * The first ancestor that cuts the element off below - one that clips its
 * overflow and ends above the element's own end - or null when nothing
 * does. Read without scrolling: a clipped box scrolls inside itself, so
 * scrolling the element into view would hide the cut.
 */
async function clippingAncestor(locator: Locator): Promise<string | null> {
  return await locator.evaluate((element: Element): string | null => {
    const bottom: number = element.getBoundingClientRect().bottom;
    let ancestor: Element | null = element.parentElement;

    while (ancestor && ancestor !== document.body) {
      const style: CSSStyleDeclaration = window.getComputedStyle(ancestor);

      if (
        style.overflowY !== "visible" &&
        bottom > ancestor.getBoundingClientRect().bottom + 1
      ) {
        return `${ancestor.tagName.toLowerCase()} (max-height ${style.maxHeight})`;
      }

      ancestor = ancestor.parentElement;
    }

    return null;
  });
}

function button(page: Page, testId: string): Locator {
  return page.getByTestId(testId).first();
}

function dialog(page: Page): Locator {
  return page.getByTestId("modal");
}

function card(page: Page, title: string): Locator {
  return page
    .getByTestId("card")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const COLOUR: RegExp = /rgba?\(([^)]+)\)/g;

function coloursIn(value: string): Array<Rgba> {
  return Array.from(value.matchAll(COLOUR), (match: RegExpMatchArray) => {
    const parts: Array<number> = match[1]!
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);

    return {
      r: parts[0]!,
      g: parts[1]!,
      b: parts[2]!,
      a: parts.length > 3 ? parts[3]! : 1,
    };
  });
}

function colourOf(value: string): Rgba {
  const colour: Rgba | undefined = coloursIn(value)[0];

  if (!colour) {
    throw new Error(`Not a colour: ${value}`);
  }

  return colour;
}

function channel(value: number): number {
  const srgb: number = value / 255;

  return srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
}

function luminance(colour: Rgba): number {
  return (
    0.2126 * channel(colour.r) +
    0.7152 * channel(colour.g) +
    0.0722 * channel(colour.b)
  );
}

function contrast(first: Rgba, second: Rgba): number {
  const a: number = luminance(first);
  const b: number = luminance(second);

  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

// The background of the card an element sits on.
async function cardBackground(inside: Locator): Promise<Rgba> {
  return colourOf(
    await inside.evaluate((element: Element): string => {
      const surface: Element | null = element.closest('[data-testid="card"]');

      if (!surface) {
        throw new Error("The element is on no card");
      }

      return window.getComputedStyle(surface).backgroundColor;
    }),
  );
}

test.describe("an outline button draws a border, a fill, a hover and a focus ring", () => {
  test("every outline style, as the gallery draws it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "section=buttons");

    for (const style of OUTLINE_STYLES) {
      const control: Locator = button(page, `button-${style}`);

      expect(await styleOf(control, "border-top-width")).toBe("1px");
      expect(await styleOf(control, "border-top-style")).toBe("solid");
      const border: Rgba = colourOf(await styleOf(control, "border-top-color"));
      expect(border.a).toBeGreaterThan(0);
      expect(contrast(border, await cardBackground(control))).toBeGreaterThan(
        1.3,
      );
      expect(await styleOf(control, "background-color")).toBe(
        "rgb(255, 255, 255)",
      );
      expect(await styleOf(control, "border-top-left-radius")).toBe("6px");
    }

    await screenshot(page, "buttons-1280");
  });

  test("each outline style's hover is the tint its name says", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "section=buttons");

    const hovers: Array<[string, string, string | undefined]> = [
      ["OUTLINE", GRAY_50, undefined],
      ["HOVER_DANGER_OUTLINE", RED_50, RED_700],
      ["HOVER_SUCCESS_OUTLINE", GREEN_50, GREEN_700],
      ["HOVER_PRIMARY_OUTLINE", INDIGO_50, INDIGO_700],
    ];

    for (const [style, fill, text] of hovers) {
      const control: Locator = button(page, `button-${style}`);

      await control.hover();
      await expect
        .poll(async () => {
          return await styleOf(control, "background-color");
        })
        .toBe(fill);

      if (text) {
        await expect
          .poll(async () => {
            return await styleOf(control, "color");
          })
          .toBe(text);
      }
    }

    await button(page, "button-HOVER_DANGER_OUTLINE").hover();
    await screenshot(page, "buttons-hover-danger-outline-1280", {
      fullPage: false,
    });
  });

  test("the keyboard's focus draws a ring round an outline button", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "section=buttons");

    const control: Locator = button(page, "button-OUTLINE");
    await control.focus();
    // A focus placed by script is not :focus-visible; a Tab is.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(control).toBeFocused();

    await expect
      .poll(async () => {
        return await styleOf(control, "box-shadow");
      })
      .toContain("rgb(99, 102, 241)");
  });

  test("a network device's Ping and Traceroute are bordered buttons, in both themes", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const theme of ["light", "dark"]) {
      await open(
        page,
        `section=buttons${theme === "dark" ? "&theme=dark" : ""}`,
      );

      const tools: Locator = card(page, "Connectivity tools");

      for (const name of ["Ping", "Traceroute"]) {
        const control: Locator = tools.getByRole("button", {
          name: name,
          exact: true,
        });

        await expect(control).toBeVisible();
        expect(await styleOf(control, "border-top-width")).toBe("1px");
        const border: Rgba = colourOf(
          await styleOf(control, "border-top-color"),
        );
        expect(contrast(border, await cardBackground(control))).toBeGreaterThan(
          theme === "dark" ? 2 : 1.3,
        );
      }

      await tools.scrollIntoViewIfNeeded();
      await screenshot(page, `connectivity-tools-${theme}`, {
        fullPage: false,
      });
    }
  });

  test("in the dark theme an outline button is a dark control with a light edge, not a white block", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "section=buttons&theme=dark");

    for (const style of OUTLINE_STYLES) {
      const control: Locator = button(page, `button-${style}`);
      const fill: Rgba = colourOf(await styleOf(control, "background-color"));
      const surface: Rgba = await cardBackground(control);

      expect(luminance(fill)).toBeLessThan(0.1);
      expect(
        contrast(colourOf(await styleOf(control, "border-top-color")), surface),
      ).toBeGreaterThan(2);
      expect(
        contrast(colourOf(await styleOf(control, "color")), fill),
      ).toBeGreaterThan(4.5);
    }

    await screenshot(page, "buttons-dark-1280");
  });
});

/*
 * The gap between a button's icon and its words, in pixels, on the words'
 * side: the icon's end to the words' start, whichever way the page reads.
 */
async function iconGap(control: Locator): Promise<number> {
  return await control.evaluate((element: Element): number => {
    const icon: Element | null = element.querySelector("svg");
    const walker: TreeWalker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
    );
    let words: Node | null = walker.nextNode();

    while (words && !(words.textContent || "").trim()) {
      words = walker.nextNode();
    }

    if (!icon || !words) {
      throw new Error("The button has no icon or no words");
    }

    const range: Range = document.createRange();
    range.selectNodeContents(words);
    const text: DOMRect = range.getBoundingClientRect();
    const glyph: DOMRect = icon.getBoundingClientRect();
    const isRightToLeft: boolean =
      window.getComputedStyle(element).direction === "rtl";

    return isRightToLeft ? glyph.left - text.right : text.left - glyph.right;
  });
}

test.describe("a button's icon keeps its gap from the words, in either direction", () => {
  test("in English and in Persian, where the icon sits to the right of the words", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const language of ["en", "fa"]) {
      await open(page, `section=buttons${language === "fa" ? "&lang=fa" : ""}`);

      for (const style of ["NORMAL", "OUTLINE", "PRIMARY", "LINK"]) {
        const gap: number = await iconGap(button(page, `button-${style}`));

        // me-1 is 4px; the icon's own box adds none.
        expect(gap).toBeGreaterThanOrEqual(3);
        expect(gap).toBeLessThanOrEqual(12);
      }
    }

    await screenshot(page, "buttons-fa-1280");
  });
});

test.describe("a button that cannot be pressed looks it", () => {
  test("every style fades and shows the not-allowed cursor when locked; pressable and busy ones do not", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "section=buttons");

    for (const style of ALL_STYLES) {
      const enabled: Locator = button(page, `button-${style}`);
      const locked: Locator = button(page, `button-${style}-disabled`);

      await expect(locked).toBeDisabled();
      expect(await styleOf(locked, "opacity")).toBe("0.5");
      expect(await styleOf(locked, "cursor")).toBe("not-allowed");
      expect(await styleOf(enabled, "opacity")).toBe("1");
      expect(await styleOf(enabled, "cursor")).not.toBe("not-allowed");

      // Busy, not locked: a loading button keeps its look.
      const busy: Locator = page.getByTestId(`button-${style}-loading`);

      if ((await busy.count()) > 0) {
        expect(await styleOf(busy.first(), "opacity")).toBe("1");
      }
    }
  });

  test("a locked button keeps its look under the pointer", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "section=buttons");

    for (const style of ["NORMAL", "OUTLINE", "PRIMARY", "DANGER"]) {
      const locked: Locator = button(page, `button-${style}-disabled`);
      const before: string = await styleOf(locked, "background-color");

      await locked.hover({ force: true });

      expect(await styleOf(locked, "background-color")).toBe(before);
    }
  });

  test("a locked filled button keeps its own fill and fades, in both themes", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const theme of ["light", "dark"]) {
      await open(
        page,
        `section=buttons${theme === "dark" ? "&theme=dark" : ""}`,
      );

      for (const style of FILLED_STYLES) {
        const enabled: string = await styleOf(
          button(page, `button-${style}`),
          "background-color",
        );
        const locked: Locator = button(page, `button-${style}-disabled`);

        expect(await styleOf(locked, "background-color")).toBe(enabled);
        expect(await styleOf(locked, "opacity")).toBe("0.5");
      }
    }
  });

  test("a locked button with a reason says why on hover, under the not-allowed cursor", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "section=buttons");

    const wrapper: Locator = page.getByTestId(
      "locked-with-reason-disabled-wrapper",
    );

    expect(await styleOf(wrapper, "cursor")).toBe("not-allowed");
    await wrapper.hover();
    await expect(page.getByRole("tooltip")).toContainText(
      "Your role cannot change this monitor.",
    );
    await screenshot(page, "locked-with-a-reason", { fullPage: false });
  });

  test("a busy link keeps its spinner beside its words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "section=buttons");

    for (const style of ["LINK", "SECONDARY_LINK"]) {
      const busy: Locator = button(page, `button-${style}-loading`);
      const spinner: Locator = busy.locator(".animate-spin").first();
      const words: Locator = busy.getByText("Ping", { exact: true });

      const spinnerBox: { y: number; height: number } | null =
        await spinner.boundingBox();
      const wordsBox: { y: number; height: number } | null =
        await words.boundingBox();

      expect(spinnerBox).not.toBeNull();
      expect(wordsBox).not.toBeNull();

      const spinnerMiddle: number = spinnerBox!.y + spinnerBox!.height / 2;

      // The spinner's middle is on the words' line.
      expect(spinnerMiddle).toBeGreaterThan(wordsBox!.y);
      expect(spinnerMiddle).toBeLessThan(wordsBox!.y + wordsBox!.height);
    }
  });
});

test.describe("a menu's own ⋯ is a bare icon button", () => {
  test("no box until the pointer is over it, then a grey wash; it opens its menu", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "section=buttons");

    const trigger: Locator = page.getByTestId("bare-more-menu");

    expect(colourOf(await styleOf(trigger, "background-color")).a).toBe(0);
    expect(colourOf(await styleOf(trigger, "border-top-color")).a).toBe(0);
    await expect(trigger).toHaveAttribute("aria-label", "Row options");

    await trigger.hover();
    await expect
      .poll(async () => {
        return await styleOf(trigger, "background-color");
      })
      .toBe(GRAY_100);

    await trigger.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Copy ID", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("a menu with words shows them beside its icon, on one line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "section=buttons");

    const trigger: Locator = page.getByTestId("worded-more-menu");
    await expect(trigger).toHaveText("1m");

    const icon: { y: number; height: number } | null = await trigger
      .locator("svg")
      .first()
      .boundingBox();
    const words: { y: number; height: number } | null = await trigger
      .getByText("1m", { exact: true })
      .boundingBox();
    const iconMiddle: number = icon!.y + icon!.height / 2;

    expect(iconMiddle).toBeGreaterThan(words!.y);
    expect(iconMiddle).toBeLessThan(words!.y + words!.height);
  });
});

test.describe("a dialog's first focus waits for its form", () => {
  test("an edit dialog that reads its record first starts on its first field once it draws", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "section=dialogs&read=800");

    await card(page, "Probes").getByTestId("card-button").click();
    await expect(dialog(page)).toBeVisible();

    // While the record is read there is nothing to fill in.
    await expect(page.getByTestId("modal-footer-submit-button")).toBeFocused();

    // It starts on a switch, which no field's autoFocus reaches.
    const toggle: Locator = dialog(page).getByRole("switch");
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeFocused();
    await expect(
      page.getByTestId("modal-footer-submit-button"),
    ).not.toBeFocused();

    // From there the keyboard walks the form in order.
    await page.keyboard.press("Tab");
    await expect(dialog(page).getByPlaceholder("Probe name")).toBeFocused();
    await screenshot(page, "edit-dialog-first-field", { fullPage: false });
  });

  test("a person who moved the focus before the form drew keeps their place", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "section=dialogs&read=1500");

    await card(page, "Probes").getByTestId("card-button").click();
    await expect(page.getByTestId("modal-footer-submit-button")).toBeFocused();

    await page.getByTestId("modal-footer-close-button").focus();
    await expect(dialog(page).getByRole("switch")).toBeVisible();

    await expect(page.getByTestId("modal-footer-close-button")).toBeFocused();
    await expect(dialog(page).getByRole("switch")).not.toBeFocused();
  });
});

test.describe("Duplicate and Reset say what happens", () => {
  test("Duplicate says the copy opens, and Reset what stops working, never 'Are you sure'", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "section=dialogs");

    await card(page, "Duplicate Workflow").getByTestId("card-button").click();
    await expect(dialog(page)).toContainText(
      "The copy opens as soon as it is made.",
    );
    await expect(dialog(page)).not.toContainText("Are you sure");
    await screenshot(page, "duplicate-dialog-1280", { fullPage: false });
    await page.getByTestId("modal-footer-close-button").click();
    await expect(dialog(page)).toHaveCount(0);

    await card(page, "Reset API Key").getByTestId("card-button").click();
    await expect(dialog(page)).toContainText(
      "API Key gets a new value. Anything that still uses the old value stops working until you give it the new one.",
    );
    await expect(dialog(page)).not.toContainText("Are you sure");
    await screenshot(page, "reset-dialog-1280", { fullPage: false });
  });

  for (const language of ["de", "fa"]) {
    test(`in ${language === "de" ? "German" : "Persian"} too`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const words: Record<string, string> = readLocale(language);
      const duplicate: string = words["The copy opens as soon as it is made."]!;

      expect(duplicate).toBeTruthy();
      expect(duplicate).not.toBe("The copy opens as soon as it is made.");

      await open(page, `section=dialogs&lang=${language}`);

      await page.getByTestId("card-button").nth(1).click();
      await expect(dialog(page)).toContainText(duplicate);
      await screenshot(page, `duplicate-dialog-${language}`, {
        fullPage: false,
      });
      await page.getByTestId("modal-footer-close-button").click();

      await page.getByTestId("card-button").nth(2).click();
      const reset: string =
        words[
          "{{columnName}} gets a new value. Anything that still uses the old value stops working until you give it the new one."
        ]!;
      expect(reset).toContain("{{columnName}}");
      // The template's words after the column's name, as translated.
      const afterName: string = reset.split("}}").pop()!.trim();
      await expect(dialog(page)).toContainText(afterName);
      await screenshot(page, `reset-dialog-${language}`, { fullPage: false });
    });
  }
});

test.describe("a card with nothing under its title keeps its description on a phone", () => {
  test("Duplicate, Reset and Delete say what they do at 390 pixels, not just a title and a button", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await open(page, "section=dialogs");

    const expectations: Array<[string, string]> = [
      [
        "Duplicate Workflow",
        "Duplicating this workflow will create another workflow exactly like this one.",
      ],
      ["Reset API Key", "Reset the API Key to a new value."],
      ["Delete Workflow", "This action cannot be undone."],
    ];

    for (const [title, words] of expectations) {
      const description: Locator = card(page, title).getByTestId(
        "card-description",
      );

      await expect(description).toBeVisible();
      await expect(description).toContainText(words);
    }

    // A card with a body still keeps its description for wider screens.
    await expect(
      card(page, "Probes").getByTestId("card-description"),
    ).toBeHidden();
    expect(await horizontalOverflow(page)).toBe(0);
    await screenshot(page, "cards-390");
  });

  test("beside a side menu, at a laptop's and a tablet's width", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [1024, 768]) {
      await page.setViewportSize({ width: width, height: 900 });
      await open(page, "section=dialogs&layout=side-menu");

      await expect(page.getByTestId("side-menu-layout")).toBeVisible();

      for (const title of [
        "Duplicate Workflow",
        "Reset API Key",
        "Delete Workflow",
      ]) {
        await expect(
          card(page, title).getByTestId("card-description"),
        ).toBeVisible();
      }

      expect(await horizontalOverflow(page)).toBe(0);
      await screenshot(page, `cards-side-menu-${width}`);
    }
  });

  test("on a phone in the dark theme and in Persian", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });

    await open(page, "section=dialogs&theme=dark");
    await expect(
      card(page, "Delete Workflow").getByTestId("card-description"),
    ).toBeVisible();
    await screenshot(page, "cards-dark-390");

    await open(page, "section=dialogs&lang=fa");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("card-description").last()).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
    await screenshot(page, "cards-fa-390");
  });
});

test.describe("a Delete dialog in Japanese and Chinese", () => {
  for (const language of ["ja", "zh-CN"]) {
    test(`${language}: no space after the full-width question mark`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `section=dialogs&lang=${language}`);

      await page.getByTestId("card-button").last().click();
      const content: Locator = page.getByTestId("modal-content");
      await expect(content).toContainText("？");

      const text: string = (await content.textContent()) || "";
      expect(text).not.toMatch(/？\s/u);
      expect(text).toMatch(/？\S/u);
      await screenshot(page, `delete-dialog-${language}`, { fullPage: false });
    });
  }
});

test.describe("an open section is as tall as what it holds", () => {
  test("a folded section opens all the way: the end of a 6,400 pixel body is there to press", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "section=sections");

    await page.getByRole("button", { name: "Advanced Options" }).click();

    const end: Locator = page.getByTestId("collapsible-end");
    await expect(end).toBeVisible();
    // Measured before anything scrolls: a cut section scrolls inside itself.
    await expect
      .poll(async () => {
        return await clippingAncestor(end);
      })
      .toBeNull();
    await end.scrollIntoViewIfNeeded();
    await end.click();

    const body: { height: number } | null = await page
      .getByTestId("collapsible-tall-body")
      .boundingBox();
    expect(body!.height).toBeGreaterThanOrEqual(6400);
  });

  test("a side menu section of 90 pages shows its last one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "section=sections");

    await page
      .getByTestId("tall-side-menu")
      .getByRole("button", { name: "Pages" })
      .click();

    const last: Locator = page.getByTestId("side-menu-last");
    await expect(last).toBeVisible();
    await expect
      .poll(async () => {
        return await clippingAncestor(last);
      })
      .toBeNull();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();

    const menu: { height: number } | null = await page
      .getByTestId("tall-side-menu")
      .boundingBox();
    expect(menu!.height).toBeGreaterThan(2000);
  });
});

test.describe("one pill, plain stat tiles and whole chips", () => {
  test("a label, a yes/no and a choice are one pill: the same height, corners, type and dot", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "section=pills");

    const label: Locator = page
      .getByTestId("pill-row-label")
      .locator("[data-ou-pill]")
      .first();
    const yes: Locator = page.locator('[data-boolean-value="yes"]').first();
    const no: Locator = page.locator('[data-boolean-value="no"]').first();
    const choice: Locator = card(page, "One pill")
      .locator("[data-ou-pill]")
      .filter({ hasText: "High" })
      .first();

    const pills: Array<Locator> = [label, yes, no, choice];
    const heights: Array<number> = [];
    const dots: Array<number> = [];

    for (const pill of pills) {
      await expect(pill).toBeVisible();
      const height: number = (await pill.boundingBox())!.height;
      heights.push(height);
      // A capsule: its corners at least half its height.
      expect(
        parseFloat(await styleOf(pill, "border-top-left-radius")),
      ).toBeGreaterThanOrEqual(height / 2 - 0.5);
      expect(await styleOf(pill, "font-size")).toBe(
        await styleOf(label, "font-size"),
      );
      expect(await styleOf(pill, "padding-left")).toBe(
        await styleOf(label, "padding-left"),
      );
      const dot: Locator = pill.locator("span.rounded-full").first();
      dots.push((await dot.boundingBox())!.width);
    }

    for (const height of heights) {
      expect(Math.abs(height - heights[0]!)).toBeLessThanOrEqual(1);
    }

    for (const dot of dots) {
      expect(Math.abs(dot - dots[0]!)).toBeLessThanOrEqual(0.5);
    }

    await screenshot(page, "pills-1280");
  });

  test("a stat tile names what it counts in plain words: no capitals, no tracking, no dot", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "section=pills");

    for (const name of ["Ready", "Restarts", "Uptime"]) {
      const title: Locator = page.getByText(name, { exact: true }).first();

      await expect(title).toBeVisible();
      expect(await styleOf(title, "text-transform")).toBe("none");
      expect(await styleOf(title, "letter-spacing")).toBe("normal");
      // The label's own line holds its words, and the (i) when it has one.
      const line: Locator = title.locator("xpath=..");
      expect(await line.locator("span.rounded-full").count()).toBe(0);
    }
  });

  test("on a phone a multi-select's chips show whole names, wrapping inside the field", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await open(page, "section=pills");

    for (const scope of ["multi-select", "entity-multi-select"]) {
      const field: Locator = page.getByTestId(scope);
      const fieldBox: { x: number; width: number } | null =
        await field.boundingBox();

      for (const name of [
        "Singapore (ap-southeast-1) - Global probe",
        "Frankfurt (eu-central-1) - Global probe",
        "N. Virginia (us-east-1) - Global probe",
      ]) {
        const words: Locator = field.getByText(name, { exact: true }).first();

        await expect(words).toBeVisible();
        const cut: boolean = await words.evaluate(
          (element: Element): boolean => {
            return element.scrollWidth > element.clientWidth + 1;
          },
        );
        expect(cut).toBe(false);
        expect(await styleOf(words, "text-overflow")).not.toBe("ellipsis");

        const box: { x: number; width: number } | null =
          await words.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(fieldBox!.x - 1);
        expect(box!.x + box!.width).toBeLessThanOrEqual(
          fieldBox!.x + fieldBox!.width + 1,
        );
      }
    }

    expect(await horizontalOverflow(page)).toBe(0);
    await screenshot(page, "pills-390");
  });

  test("in the dark theme and in German", async ({ page }: { page: Page }) => {
    await open(page, "section=pills&theme=dark");
    await expect(
      page.locator('[data-boolean-value="yes"]').first(),
    ).toBeVisible();
    await screenshot(page, "pills-dark-1280");

    await open(page, "section=pills&lang=de");
    await expect(
      page.locator('[data-boolean-value="yes"]').first(),
    ).toBeVisible();
    await screenshot(page, "pills-de-1280");
  });
});

test.describe("a team's avatar on a dark card", () => {
  test("every edge of a team's tile stands out from the card at 3:1, its initials at 4.5:1", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "section=avatars&theme=dark");

    const tiles: Locator = page.locator(
      '[data-testid^="avatar-"][data-kind="team"] div.bg-gradient-to-br',
    );
    const count: number = await tiles.count();
    expect(count).toBeGreaterThanOrEqual(5);

    for (let index: number = 0; index < count; index++) {
      const tile: Locator = tiles.nth(index);
      const surface: Rgba = await cardBackground(tile);
      const stops: Array<Rgba> = coloursIn(
        await styleOf(tile, "background-image"),
      );

      expect(stops.length).toBeGreaterThanOrEqual(2);

      for (const stop of stops) {
        expect(contrast(stop, surface)).toBeGreaterThanOrEqual(3);
        expect(
          contrast(colourOf(await styleOf(tile, "color")), stop),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }

    await screenshot(page, "avatars-dark-1280");
  });

  test("and in the light theme a team is still a dark tile", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "section=avatars");

    const tile: Locator = page
      .locator(
        '[data-testid^="avatar-"][data-kind="team"] div.bg-gradient-to-br',
      )
      .first();

    for (const stop of coloursIn(await styleOf(tile, "background-image"))) {
      // slate-700 to slate-900: 0.052 and 0.009.
      expect(luminance(stop)).toBeLessThan(0.06);
    }

    await screenshot(page, "avatars-1280");
  });
});
