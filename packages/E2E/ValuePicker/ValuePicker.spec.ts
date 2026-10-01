import { Locator, Page, expect, test } from "@playwright/test";

/*
 * The value picker every workflow setting has, in a real browser.
 *
 * The maintainer asked for the Create One Incident field's picker on every
 * field, without "Pick this value from other component or from variable".
 * A setting now shows the values it uses as chips - "Webhook › Request
 * Body" for {{local.components.webhook-1.returnValues.request-body}} - and
 * gets new ones from { } or by typing "{{".
 *
 * The chip editor is a contenteditable element, and browsers differ around
 * a non-editable chip: Firefox puts the caret inside one for Home, will not
 * step back over one that opens a line, and lands a click past a chip at the
 * end of a line before it. These are the cases checked here, in both.
 */

const BODY: string = "{{local.components.webhook-1.returnValues.request-body}}";
const DEPLOY_ENV: string = "{{local.variables.DEPLOY_ENV}}";

type FieldFunction = (page: Page, id: string) => Locator;

const field: FieldFunction = (page: Page, id: string): Locator => {
  return page.getByTestId(`${id}-field`);
};

type ValueOfFunction = (page: Page, id: string) => Promise<string>;

const valueOf: ValueOfFunction = async (
  page: Page,
  id: string,
): Promise<string> => {
  return page.getByTestId(`${id}-value`).inputValue();
};

type ChipFunction = (page: Page, id: string, index?: number) => Locator;

const chip: ChipFunction = (
  page: Page,
  id: string,
  index: number = 0,
): Locator => {
  return field(page, id).locator("[data-template-reference]").nth(index);
};

type ClickSideFunction = (
  target: Locator,
  side: "left" | "right",
) => Promise<void>;

// A press on one half of a chip.
const clickChip: ClickSideFunction = async (
  target: Locator,
  side: "left" | "right",
): Promise<void> => {
  const box: { x: number; y: number; width: number; height: number } | null =
    await target.boundingBox();

  if (!box) {
    throw new Error("The chip is not on screen");
  }

  await target
    .page()
    .mouse.click(
      box.x + (side === "left" ? 3 : box.width - 3),
      box.y + box.height / 2,
    );
};

type OpenFieldsFunction = (page: Page, theme?: string) => Promise<void>;

const openFields: OpenFieldsFunction = async (
  page: Page,
  theme?: string,
): Promise<void> => {
  await page.goto(`/?scenario=fields${theme ? `&theme=${theme}` : ""}`);
  await expect(field(page, "message")).toBeVisible();
};

type OpenStepFunction = (page: Page, stepId: string) => Promise<void>;

// The builder, with the settings of one step open.
const openStep: OpenStepFunction = async (
  page: Page,
  stepId: string,
): Promise<void> => {
  await page.goto("/?scenario=builder");
  await page.locator(`[data-id="rf-${stepId}"]`).click();
  await expect(page.getByTestId("workflow-component-settings")).toBeVisible();
};

type OptionReferencesFunction = (page: Page) => Promise<Array<string>>;

const optionReferences: OptionReferencesFunction = async (
  page: Page,
): Promise<Array<string>> => {
  return page
    .getByTestId("value-picker")
    .getByRole("option")
    .evaluateAll((options: Array<Element>) => {
      return options.map((option: Element) => {
        return option.getAttribute("data-reference") || "";
      });
    });
};

test.describe("a reference is a chip", () => {
  test("it says what it reads, and the field stores the reference", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFields(page);

    await expect(chip(page, "message")).toHaveText("Webhook›Request Body");
    await expect(chip(page, "message")).toHaveAttribute("title", BODY);
    expect(await valueOf(page, "message")).toBe(`Body: ${BODY} end`);
  });

  test("Backspace right after it removes all of it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFields(page);

    await clickChip(chip(page, "message"), "right");
    await page.keyboard.press("Backspace");

    expect(await valueOf(page, "message")).toBe("Body:  end");
    await expect(chip(page, "message")).toHaveCount(0);
  });

  test("the arrow keys step over it in one press", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFields(page);

    await clickChip(chip(page, "message"), "right");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("X");

    expect(await valueOf(page, "message")).toBe(`Body: X${BODY} end`);

    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("Y");

    expect(await valueOf(page, "message")).toBe(`Body: X${BODY}Y end`);
  });

  test("a press on it puts the caret on that side of it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFields(page);

    await clickChip(chip(page, "message"), "left");
    await page.keyboard.type("<");
    await clickChip(chip(page, "message"), "right");
    await page.keyboard.type(">");

    expect(await valueOf(page, "message")).toBe(`Body: <${BODY}> end`);
  });

  test("Home before a value that opens the field, then typing goes before it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFields(page);

    await field(page, "leading").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Home");
    await page.keyboard.type("Hi ");

    expect(await valueOf(page, "leading")).toBe(`Hi ${DEPLOY_ENV} tail`);
  });

  test("the left arrow gets back past a value that opens the field", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFields(page);

    await field(page, "leading").click();
    await page.keyboard.press("End");

    for (let press: number = 0; press < 6; press++) {
      await page.keyboard.press("ArrowLeft");
    }

    await page.keyboard.type("^");

    expect(await valueOf(page, "leading")).toBe(`^${DEPLOY_ENV} tail`);
  });

  test("End, and Ctrl+End, go past a value that ends the field", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFields(page);

    await field(page, "trailing").click();
    await page.keyboard.press("Home");
    await page.keyboard.press("End");
    await page.keyboard.type("1");
    await page.keyboard.press("Home");
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("2");

    expect(await valueOf(page, "trailing")).toBe(`Env: ${DEPLOY_ENV}12`);
  });

  test("a click past a value that ends the field puts the caret after it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFields(page);

    const box: { x: number; y: number; width: number; height: number } | null =
      await field(page, "trailing").boundingBox();

    // Right of the chip, well clear of it.
    await page.mouse.click(box!.x + box!.width - 40, box!.y + box!.height / 2);
    await page.keyboard.type("!");

    expect(await valueOf(page, "trailing")).toBe(`Env: ${DEPLOY_ENV}!`);
  });

  test("a reference to a step that is not there is a warning that says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFields(page);

    await expect(chip(page, "broken")).toHaveAttribute("data-tone", "Warning");
    await expect(chip(page, "broken")).toHaveAttribute(
      "title",
      /No step in this workflow has the ID "gone-1"/,
    );
  });
});

test.describe("typing", () => {
  test("Enter starts a new line and the browser's own markup never gets in", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFields(page);

    await field(page, "message").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("!");
    await page.keyboard.press("Enter");
    await page.keyboard.type("second line");
    await page.keyboard.press("Enter");

    expect(await valueOf(page, "message")).toBe(
      `Body: ${BODY} end!\nsecond line\n`,
    );
    // Text and chips only: no <div> per line, no stray <br>, no formatting.
    await expect(
      field(page, "message").locator(
        "div, p, b, i, font, br:not([data-template-line-end])",
      ),
    ).toHaveCount(0);
  });

  test("a one-line field stays one line", async ({ page }: { page: Page }) => {
    await openFields(page);

    await field(page, "subject").click();
    await page.keyboard.type("one");
    await page.keyboard.press("Enter");
    await page.keyboard.type(" line");

    expect(await valueOf(page, "subject")).toBe("one line");
  });

  test("undo and redo", async ({ page }: { page: Page }) => {
    await openFields(page);

    await field(page, "subject").click();
    await page.keyboard.type("abc");
    await page.keyboard.press("ControlOrMeta+z");

    expect(await valueOf(page, "subject")).toBe("");

    await page.keyboard.press("ControlOrMeta+Shift+z");

    expect(await valueOf(page, "subject")).toBe("abc");
  });

  test("copying carries the reference, and pasting it brings back a chip", async ({
    page,
    browserName,
  }: {
    page: Page;
    browserName: string;
  }) => {
    test.skip(
      browserName === "firefox",
      "Headless Firefox does not give the page a clipboard to paste from.",
    );

    await openFields(page);

    await field(page, "message").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+c");

    await page.getByTestId("scratch").click();
    await page.keyboard.press("ControlOrMeta+v");

    await expect(page.getByTestId("scratch")).toHaveValue(`Body: ${BODY} end`);

    await field(page, "subject").click();
    await page.keyboard.press("ControlOrMeta+v");

    expect(await valueOf(page, "subject")).toBe(`Body: ${BODY} end`);
    await expect(chip(page, "subject")).toHaveCount(1);
  });
});

test.describe("{ }: the list of values", () => {
  test("it opens under the field with the focus in its search box", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFields(page);

    await page.getByTestId("subject-field-insert-value").click();

    const picker: Locator = page.getByTestId("value-picker");
    await expect(picker).toBeVisible();
    await expect(page.getByTestId("value-picker-search")).toBeFocused();

    const fieldBox: { y: number; height: number } | null = await page
      .getByTestId("subject-field-box")
      .boundingBox();
    const pickerBox: { y: number; height: number } | null =
      await picker.boundingBox();

    expect(pickerBox!.y).toBeGreaterThanOrEqual(fieldBox!.y + fieldBox!.height);
  });

  test("search, the keys, and the value lands where the caret was", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFields(page);

    await field(page, "subject").click();
    await page.keyboard.type("Deploying to  now");
    for (let press: number = 0; press < 4; press++) {
      await page.keyboard.press("ArrowLeft");
    }

    await page.getByTestId("subject-field-insert-value").click();
    await page.keyboard.type("deploy");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("value-picker")).toHaveCount(0);
    expect(await valueOf(page, "subject")).toBe(
      `Deploying to ${DEPLOY_ENV} now`,
    );

    // Back in the field, just after the chip.
    await page.keyboard.type("!");
    expect(await valueOf(page, "subject")).toBe(
      `Deploying to ${DEPLOY_ENV}! now`,
    );
  });

  test("a path inside a JSON value", async ({ page }: { page: Page }) => {
    await openFields(page);

    await page.getByTestId("subject-field-insert-value").click();
    await page.getByTestId("value-picker-look-inside").first().click();
    await page.getByTestId("value-picker-path").fill("alerts[0].status");
    await page.getByTestId("value-picker-path-insert").click();

    expect(await valueOf(page, "subject")).toBe(
      "{{local.components.webhook-1.returnValues.request-body.alerts[0].status}}",
    );
    await expect(chip(page, "subject")).toHaveText(
      "Webhook›Request Body›alerts[0].status",
    );
  });

  test("typing {{ opens it under the field; Enter takes the value", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFields(page);

    await field(page, "subject").click();
    await page.keyboard.type("Body: {{body");

    await expect(page.getByTestId("value-picker-inline")).toBeVisible();
    await expect(field(page, "subject")).toBeFocused();

    await page.keyboard.press("Enter");

    expect(await valueOf(page, "subject")).toBe(`Body: ${BODY}`);
    await expect(page.getByTestId("value-picker-inline")).toHaveCount(0);
  });

  test("Escape closes {{'s list and leaves what was typed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFields(page);

    await field(page, "subject").click();
    await page.keyboard.type("{{x");
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("value-picker-inline")).toHaveCount(0);
    expect(await valueOf(page, "subject")).toBe("{{x");
  });
});

test.describe("in the builder", () => {
  test("a step's list has the steps before it, and not the one after", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openStep(page, "log-1");

    await page.getByTestId("workflow-argument-value-insert-value").click();
    await expect(page.getByText("Loading variables…")).toHaveCount(0);

    const references: Array<string> = await optionReferences(page);

    expect(references).toContain(BODY);
    expect(references).toContain(
      "{{local.components.api-post-1.returnValues.response-body}}",
    );
    expect(references).toContain(DEPLOY_ENV);
    expect(references).toContain("{{global.variables.API_KEY}}");
    expect(
      references.some((reference: string) => {
        return reference.includes("slack-1");
      }),
    ).toBe(false);
  });

  test("a step not connected yet offers the trigger and says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openStep(page, "loose-1");

    await page.getByTestId("workflow-argument-value-insert-value").click();

    await expect(page.getByTestId("value-picker-not-connected")).toBeVisible();
    expect(
      (await optionReferences(page)).filter((reference: string) => {
        return reference.includes("local.components");
      }),
    ).toEqual([
      "{{local.components.webhook-1.returnValues.request-headers}}",
      "{{local.components.webhook-1.returnValues.request-params}}",
      BODY,
    ]);
  });

  test("Escape closes the list, not the step's settings", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openStep(page, "log-1");

    await page.getByTestId("workflow-argument-value-insert-value").click();
    await expect(page.getByTestId("value-picker")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByTestId("value-picker")).toHaveCount(0);
    await expect(page.getByTestId("workflow-component-settings")).toBeVisible();
    await expect(page.getByTestId("workflow-argument-value")).toBeFocused();
  });

  test("a picked value is saved with the step", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openStep(page, "log-1");

    const value: Locator = page.getByTestId("workflow-argument-value");
    await value.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" and ");

    await page.getByTestId("workflow-argument-value-insert-value").click();
    await page.keyboard.type("response body");
    await page.keyboard.press("Enter");

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("workflow-component-settings")).toHaveCount(
      0,
    );

    // The builder hands the saved step on a moment after the dialog closes.
    await expect
      .poll(async () => {
        const saved: Record<string, Record<string, string>> = JSON.parse(
          await page.getByTestId("saved-arguments").inputValue(),
        );

        return saved["log-1"]!["value"];
      })
      .toBe(
        `Body: ${BODY} and {{local.components.api-post-1.returnValues.response-body}}`,
      );
  });

  test("a JSON body gets the reference in quotes where JSON needs them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openStep(page, "api-post-1");

    const body: Locator = page.getByRole("textbox", { name: /^Request Body/ });
    await body.fill('{"environment": }');
    await body.evaluate((element: HTMLTextAreaElement) => {
      element.setSelectionRange(16, 16);
    });

    await page
      .getByTestId("workflow-argument-request-body-insert-value")
      .click();
    await page.keyboard.type("deploy");
    await page.keyboard.press("Enter");

    await expect(body).toHaveValue(`{"environment": "${DEPLOY_ENV}"}`);
  });
});

test.describe("dark theme", () => {
  test("chips and the list take the dark colours", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFields(page, "dark");

    const chipBackground: string = await chip(page, "message").evaluate(
      (element: Element) => {
        return getComputedStyle(element).backgroundColor;
      },
    );

    // Not indigo-50, the light theme's chip.
    expect(chipBackground).not.toBe("rgb(238, 242, 255)");

    await page.getByTestId("message-field-insert-value").click();

    const listBackground: string = await page
      .getByTestId("value-picker")
      .evaluate((element: Element) => {
        return getComputedStyle(element).backgroundColor;
      });

    expect(listBackground).not.toBe("rgb(255, 255, 255)");
  });
});
