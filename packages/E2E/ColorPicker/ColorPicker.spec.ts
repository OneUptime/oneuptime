import { Locator, Page, TestInfo, expect, test } from "@playwright/test";

/*
 * The color field in a real browser, with the app's Tailwind, theme and font.
 *
 * "Please make the color picker better in the entire project. This should
 * be more user friendly and easy to use." - the maintainer, with a picture of
 * Create Label's color picker spilling out of the dialog over its Cancel and
 * Create Label buttons. jsdom lays nothing out, so what only a browser can
 * show is checked here: the fine picker opening inside the dialog body above
 * its footer, a row's popover staying inside the dialog and the window,
 * a real drag on the saturation square, the dark theme's surfaces, and a
 * phone's width.
 */

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

type BoxOfFunction = (locator: Locator) => Promise<Box>;

const boxOf: BoxOfFunction = async (locator: Locator): Promise<Box> => {
  const box: Box | null = await locator.boundingBox();

  if (!box) {
    throw new Error("Not on screen");
  }

  return box;
};

type ExpectInsideFunction = (inner: Box, outer: Box, label: string) => void;

// Inside, give or take a pixel of rounding.
const expectInside: ExpectInsideFunction = (
  inner: Box,
  outer: Box,
  label: string,
): void => {
  expect(inner.x, `${label}: left edge`).toBeGreaterThanOrEqual(outer.x - 1);
  expect(inner.y, `${label}: top edge`).toBeGreaterThanOrEqual(outer.y - 1);
  expect(inner.x + inner.width, `${label}: right edge`).toBeLessThanOrEqual(
    outer.x + outer.width + 1,
  );
  expect(inner.y + inner.height, `${label}: bottom edge`).toBeLessThanOrEqual(
    outer.y + outer.height + 1,
  );
};

type OpenFunction = (page: Page, query: string) => Promise<void>;

const open: OpenFunction = async (page: Page, query: string): Promise<void> => {
  await page.goto(`/?${query}`);
  // A phone's dialog covers the page under it: rendered is enough.
  await expect(
    page.getByTestId("dialog-state").or(page.getByTestId("page-color")),
  ).toBeAttached();
};

type LabelColorFunction = (page: Page) => Locator;

const labelColor: LabelColorFunction = (page: Page): Locator => {
  return page.getByTestId("label-color");
};

type SubmittedFunction = (page: Page) => Promise<Record<string, unknown>>;

const submitted: SubmittedFunction = async (
  page: Page,
): Promise<Record<string, unknown>> => {
  await expect(page.getByTestId("submitted")).not.toBeEmpty();

  return JSON.parse(
    (await page.getByTestId("submitted").textContent()) || "{}",
  ) as Record<string, unknown>;
};

type IsMobileFunction = (testInfo: TestInfo) => boolean;

const isMobile: IsMobileFunction = (testInfo: TestInfo): boolean => {
  return testInfo.project.name === "mobile";
};

test.describe("the Create Label dialog's color", () => {
  test("leads with named swatches, the color it starts with ticked, under plain words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "scenario=label");

    const group: Locator = labelColor(page).getByRole("radiogroup", {
      name: "Label Color",
    });

    await expect(group.getByRole("radio")).toHaveCount(10);
    await expect(group.getByRole("radio", { name: "Indigo" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(
      page.getByText("Pick a color, or choose a custom one."),
    ).toBeVisible();
    await expect(page.getByText(/in Hex|#32a852/)).toHaveCount(0);
    // A required color has no way back to none.
    await expect(group.getByRole("radio", { name: "No color" })).toHaveCount(0);
  });

  test("a click on a swatch picks it, and Create Label sends it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "scenario=label");

    await page.getByTestId("label-name").fill("payments");
    await labelColor(page).getByRole("radio", { name: "Teal" }).click();

    await expect(
      labelColor(page).getByRole("radio", { name: "Teal" }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(labelColor(page)).toHaveAttribute("data-value", "#0d9488");

    await page.getByTestId("modal-footer-submit-button").click();

    expect((await submitted(page))["color"]).toBe("#0d9488");
  });

  test("REGRESSION: Custom color opens inside the dialog body, above its buttons, and a typed code is sent", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "scenario=label");

    await page.getByTestId("label-name").fill("payments");
    await labelColor(page).getByTestId("color-picker-custom").click();

    const panel: Locator = labelColor(page).getByTestId(
      "color-picker-custom-panel",
    );

    await expect(panel).toBeVisible();

    // In the body, scrolled into view, never over the footer.
    const body: Box = await boxOf(page.getByTestId("modal-content"));
    const footer: Box = await boxOf(page.getByTestId("modal-footer"));
    const panelBox: Box = await boxOf(panel);

    expectInside(panelBox, body, "the Custom color panel");
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(footer.y + 1);

    // No HEX/RGB/HSL switch: one box, one notation.
    await expect(panel.getByRole("textbox")).toHaveCount(1);
    await expect(panel.getByText(/^(HEX|RGB|HSL)$/)).toHaveCount(0);

    const code: Locator = panel.getByRole("textbox", { name: "Color code" });

    await code.fill("#3E409A");
    await code.press("Enter");

    await expect(labelColor(page)).toHaveAttribute("data-value", "#3e409a");
    await expect(
      labelColor(page).getByTestId("color-picker-custom"),
    ).toHaveAttribute("data-picked", "true");

    await panel.getByRole("button", { name: "Done" }).click();
    await expect(panel).toBeHidden();

    await page.getByTestId("modal-footer-submit-button").click();

    expect((await submitted(page))["color"]).toBe("#3e409a");
  });

  test("a drag across the saturation square picks a color and keeps the dialog", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    test.skip(
      isMobile(testInfo),
      "a pointer drag; touch is a desktop-only check here",
    );

    await open(page, "scenario=label");

    await labelColor(page).getByTestId("color-picker-custom").click();

    const square: Locator = labelColor(page).getByTestId(
      "color-picker-saturation",
    );
    const box: Box = await boxOf(square);

    // From the middle, overshooting the right edge and the top.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 200, box.y - 200, { steps: 8 });
    await page.mouse.up();

    // Held to the top right corner: indigo's hue at full color.
    await expect(labelColor(page)).toHaveAttribute(
      "data-value",
      /^#[0-9a-f]{6}$/,
    );
    expect(await labelColor(page).getAttribute("data-value")).not.toBe(
      "#6366f1",
    );
    await expect(page.getByTestId("dialog-state")).toHaveText("open");
    await expect(page.getByTestId("modal")).toBeVisible();
  });

  test("a code that is not a color is explained, and changes nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "scenario=label");

    await labelColor(page).getByTestId("color-picker-custom").click();

    const code: Locator = labelColor(page).getByRole("textbox", {
      name: "Color code",
    });

    await code.fill("#12345g");
    await code.press("Enter");

    await expect(labelColor(page).getByRole("alert")).toHaveText(
      "Color codes use only the numbers 0-9 and the letters a-f, like #6366f1.",
    );
    await expect(labelColor(page)).toHaveAttribute("data-value", "#6366f1");
  });

  test("by keyboard: Tab to the colors, arrows pick, Custom color takes a code, Escape leaves the dialog", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    test.skip(isMobile(testInfo), "a keyboard check");

    await open(page, "scenario=label");

    const indigo: Locator = labelColor(page).getByRole("radio", {
      name: "Indigo",
    });

    await indigo.focus();
    await page.keyboard.press("ArrowRight");

    const purple: Locator = labelColor(page).getByRole("radio", {
      name: "Purple",
    });

    await expect(purple).toBeFocused();
    await expect(purple).toHaveAttribute("aria-checked", "true");

    // The group is one Tab stop: the next Tab is Custom color.
    await page.keyboard.press("Tab");

    const custom: Locator = labelColor(page).getByTestId("color-picker-custom");

    await expect(custom).toBeFocused();

    await page.keyboard.press("Enter");

    const code: Locator = labelColor(page).getByRole("textbox", {
      name: "Color code",
    });

    await expect(code).toBeFocused();

    await page.keyboard.type("#16a34a");
    await page.keyboard.press("Escape");

    await expect(
      labelColor(page).getByTestId("color-picker-custom-panel"),
    ).toBeHidden();
    await expect(custom).toBeFocused();
    await expect(page.getByTestId("dialog-state")).toHaveText("open");
    // #16a34a is the palette's green: the swatch is ticked, not Custom.
    await expect(
      labelColor(page).getByRole("radio", { name: "Green" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("on a phone the colors wrap as two lines of five and stay on screen", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    test.skip(!isMobile(testInfo), "a phone's width");

    await open(page, "scenario=label");

    const runs: Locator = labelColor(page).getByTestId(
      "color-picker-swatch-run",
    );

    await expect(runs).toHaveCount(2);

    const first: Box = await boxOf(runs.nth(0));
    const second: Box = await boxOf(runs.nth(1));

    // Two lines, never nine and one.
    expect(second.y).toBeGreaterThan(first.y);

    const viewport: { width: number; height: number } = page.viewportSize()!;

    for (const run of [first, second]) {
      expect(run.x).toBeGreaterThanOrEqual(0);
      expect(run.x + run.width).toBeLessThanOrEqual(viewport.width);
    }
  });

  test("in the dark theme the pills and the panel are the dialog's dark surface", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "scenario=label&theme=dark&color=%233e409a");

    await labelColor(page).getByTestId("color-picker-custom").click();

    const panel: Locator = labelColor(page).getByTestId(
      "color-picker-custom-panel",
    );

    await expect(panel).toBeVisible();

    const backgrounds: Array<string> = await Promise.all(
      [panel, page.getByTestId("modal")].map((locator: Locator) => {
        return locator.evaluate((element: Element): string => {
          return getComputedStyle(element).backgroundColor;
        });
      }),
    );

    // Not white: the theme's surface, the same as the dialog's.
    expect(backgrounds[0]).not.toBe("rgb(255, 255, 255)");
    expect(backgrounds[0]).toBe(backgrounds[1]);

    // The custom color's tick stays white on its dark swatch.
    const tickColor: string = await labelColor(page)
      .getByTestId("color-picker-custom-dot")
      .locator("svg")
      .evaluate((element: Element): string => {
        return getComputedStyle(element).color;
      });

    expect(tickColor).toBe("rgb(255, 255, 255)");
  });
});

test.describe("a custom field's option colors (the popover)", () => {
  type TriggerFunction = (page: Page, index: number) => Locator;

  const trigger: TriggerFunction = (page: Page, index: number): Locator => {
    return page
      .getByTestId(`dropdown-option-color-${index}`)
      .getByTestId("color-picker-trigger");
  };

  test("REGRESSION: the last option's popover stays inside the dialog body, clear of its buttons and inside the window", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "scenario=options");

    const last: Locator = trigger(page, 5);

    await last.scrollIntoViewIfNeeded();
    await last.click();

    const popup: Locator = page.getByTestId("color-picker-popup");

    await expect(popup).toBeVisible();

    const popupBox: Box = await boxOf(popup);
    const body: Box = await boxOf(page.getByTestId("modal-content"));
    const footer: Box = await boxOf(page.getByTestId("modal-footer"));
    const viewport: { width: number; height: number } = page.viewportSize()!;

    expectInside(popupBox, body, "the popover");
    expect(popupBox.y + popupBox.height).toBeLessThanOrEqual(footer.y + 1);
    expectInside(
      popupBox,
      { x: 0, y: 0, width: viewport.width, height: viewport.height },
      "the popover in the window",
    );
  });

  test("with Custom color open it is placed again, still inside the dialog body", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "scenario=options");

    const high: Locator = trigger(page, 2);

    await high.scrollIntoViewIfNeeded();
    await high.click();

    const popup: Locator = page.getByTestId("color-picker-popup");

    // High's color is a custom one: the popover opens on the fine picker.
    await expect(popup.getByTestId("color-picker-custom-panel")).toBeVisible();

    expectInside(
      await boxOf(popup),
      await boxOf(page.getByTestId("modal-content")),
      "the grown popover",
    );
  });

  test("a swatch colors the option and closes the popover", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "scenario=options");

    await trigger(page, 1).click();
    await page
      .getByTestId("color-picker-popup")
      .getByRole("radio", { name: "Teal" })
      .click();

    await expect(page.getByTestId("color-picker-popup")).toBeHidden();
    await expect(trigger(page, 1)).toHaveText(/Teal/);
    await expect(trigger(page, 1)).toBeFocused();
    await expect(page.getByTestId("submitted")).toContainText(
      '{"value":"Medium","color":"#0d9488"}',
    );
  });

  test("Escape closes the popover and leaves the dialog", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "scenario=options");

    await trigger(page, 0).click();
    await expect(page.getByTestId("color-picker-popup")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByTestId("color-picker-popup")).toBeHidden();
    await expect(page.getByTestId("dialog-state")).toHaveText("open");
  });

  test("a press elsewhere in the dialog closes the popover and leaves the dialog", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "scenario=options");

    await trigger(page, 0).click();
    await expect(page.getByTestId("color-picker-popup")).toBeVisible();

    await page.getByTestId("modal-title").click();

    await expect(page.getByTestId("color-picker-popup")).toBeHidden();
    await expect(page.getByTestId("dialog-state")).toHaveText("open");
  });

  test("a press on the backdrop puts the popover away first, the dialog second", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    test.skip(isMobile(testInfo), "a phone's dialog fills the screen");

    await open(page, "scenario=options");

    await trigger(page, 0).click();
    await expect(page.getByTestId("color-picker-popup")).toBeVisible();

    await page.mouse.click(5, 5);

    await expect(page.getByTestId("color-picker-popup")).toBeHidden();
    await expect(page.getByTestId("dialog-state")).toHaveText("open");

    await page.mouse.click(5, 5);

    await expect(page.getByTestId("dialog-state")).toHaveText("closed");
  });
});

test.describe("a color field on a page", () => {
  test("an optional color offers No color, and a compact one at the foot of the page opens upwards inside the window", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "scenario=page");

    await expect(
      page.getByTestId("page-color").getByRole("radio", { name: "No color" }),
    ).toHaveAttribute("aria-checked", "true");

    const foot: Locator = page
      .getByTestId("foot-color")
      .getByTestId("color-picker-trigger");

    await foot.scrollIntoViewIfNeeded();
    await page.evaluate((): void => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await foot.click();

    const popup: Locator = page.getByTestId("color-picker-popup");

    await expect(popup).toBeVisible();

    const viewport: { width: number; height: number } = page.viewportSize()!;

    expectInside(
      await boxOf(popup),
      { x: 0, y: 0, width: viewport.width, height: viewport.height },
      "the popover in the window",
    );
  });
});
