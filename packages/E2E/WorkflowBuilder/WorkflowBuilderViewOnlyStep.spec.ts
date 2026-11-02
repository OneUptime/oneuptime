import { expect, Locator, Page, test } from "@playwright/test";

/*
 * A step opened to be read on a Builder that is a view (WorkflowViewOnly),
 * in a browser: the Dashboard's real Builder page (the fixture's
 * ?page=builder-page&graph=request&role=member, BuilderPage.js) for a
 * Workflow Member, who runs workflows but may not change them.
 *
 * #5320's follow-up: "In a view-only step, a code box's own Copy button is
 * disabled along with the rest of the step: copying changes nothing, so it
 * should stay usable." The whole of a step's settings sat in one disabled
 * fieldset the pointer went through, so a code box's Copy - and the More
 * fields fold, the only way to read the settings folded there - were dead
 * with everything else. Each setting is held still on its own now:
 *
 *   - a code box shows its code to be read: Read-only, no Format, its text
 *     reached by the pointer and the keyboard, and its own Copy copies it;
 *   - More fields opens, to read what it folds away;
 *   - nothing typed anywhere changes a setting, and nothing is saved.
 *
 * jsdom has no pointer-events, no clipboard and no real focus, so these live
 * here.
 */

const SETTINGS_DIALOG: string = '[role="dialog"][aria-modal="true"]';

// What the fixture's &graph=request steps hold (BuilderPage.js).
const REQUEST_URL: string = "https://deploys.example.com/hooks/checkout";
const REQUEST_BODY: string = '{"service": "checkout", "status": "deployed"}';
const REQUEST_AUTHORIZATION: string = "Bearer deploy-token";
const SCRIPT_CODE: string = "return { ok: args.status === 'deployed' };";

async function openBuilder(page: Page, role: string): Promise<void> {
  await page.goto(`/?page=builder-page&graph=request${role}`);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
}

function stepCard(page: Page, componentId: string): Locator {
  return page.locator(".react-flow__node", { hasText: componentId });
}

/*
 * Opened from the keyboard, as a step is: Enter on its card. On a phone the
 * last card sits under the minimap, which a click would land on instead.
 */
async function openStep(page: Page, componentId: string): Promise<Locator> {
  await stepCard(page, componentId).focus();
  await page.keyboard.press("Enter");
  const dialog: Locator = page.locator(SETTINGS_DIALOG);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-code-type]").first()).toBeVisible();
  return dialog;
}

function codeBox(dialog: Locator, codeType: string): Locator {
  return dialog.locator(`[data-code-type="${codeType}"]`);
}

// The settings' code box textarea, the pointer's and the keyboard's way in.
function codeInput(box: Locator): Locator {
  return box.getByTestId("code-editor-input");
}

// Whether the pointer reaches an element: nothing it is in lets it through.
async function pointerReaches(locator: Locator): Promise<boolean> {
  return locator.evaluate((element: Element): boolean => {
    return getComputedStyle(element).pointerEvents !== "none";
  });
}

test.describe("Workflow builder, a view: a step's settings are read, its code copied, More fields opened", () => {
  let pageErrors: Array<string> = [];

  test.beforeEach(async ({ page }: { page: Page }) => {
    pageErrors = [];
    page.on("pageerror", (error: Error) => {
      pageErrors.push(error.message);
    });
  });

  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
  });

  test("the Builder says View only, and a step opens to be read, with Close", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "&role=member");

    // The pill says View only, with why read out after it.
    await expect(page.getByTestId("workflow-view-only-status")).toContainText(
      "View only",
    );

    const dialog: Locator = await openStep(page, "api-post-1");

    // What the dialog is, with why read out after it.
    await expect(
      dialog.getByTestId("workflow-component-view-only-note"),
    ).toContainText("You can look at this step but not change it.");
    await expect(dialog.getByTestId("modal-footer-close-button")).toHaveText(
      "Close",
    );
    await expect(dialog.getByRole("button", { name: "Save" })).toHaveCount(0);
  });

  test("a code box shows its code to be read: Read-only, no Format, and its own Copy copies it", async ({
    page,
    browserName,
  }: {
    page: Page;
    browserName: string;
  }) => {
    test.skip(
      browserName !== "chromium",
      "Only Chromium lets a test read the clipboard back.",
    );

    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await openBuilder(page, "&role=member");

    const dialog: Locator = await openStep(page, "api-post-1");
    const box: Locator = codeBox(dialog, "json");

    await expect(codeInput(box)).toHaveValue(REQUEST_BODY);
    await expect(codeInput(box)).toHaveAttribute("readonly", "");
    await expect(box.getByTestId("code-editor-read-only")).toHaveText(
      "Read-only",
    );
    await expect(box.getByTestId("code-editor-format-button")).toHaveCount(0);
    await expect(
      dialog.getByTestId("workflow-argument-request-body-insert-value"),
    ).toHaveCount(0);

    const copy: Locator = box.getByTestId("code-editor-copy-button");

    await expect(copy).toBeEnabled();
    expect(await pointerReaches(copy)).toBe(true);

    await copy.click();
    await expect(copy).toHaveText("Copied");

    expect(
      await page.evaluate(async (): Promise<string> => {
        return await navigator.clipboard.readText();
      }),
    ).toBe(REQUEST_BODY);
  });

  test("a script's two code boxes are each read, and each copied with its own Copy", async ({
    page,
    browserName,
  }: {
    page: Page;
    browserName: string;
  }) => {
    test.skip(
      browserName !== "chromium",
      "Only Chromium lets a test read the clipboard back.",
    );

    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await openBuilder(page, "&role=member");

    const dialog: Locator = await openStep(page, "javascript-1");

    for (const codeType of ["javascript", "json"]) {
      await expect(codeInput(codeBox(dialog, codeType))).toHaveAttribute(
        "readonly",
        "",
      );
    }

    const script: Locator = codeBox(dialog, "javascript");

    await script.getByTestId("code-editor-copy-button").click();
    await expect(script.getByTestId("code-editor-copy-button")).toHaveText(
      "Copied",
    );

    expect(
      await page.evaluate(async (): Promise<string> => {
        return await navigator.clipboard.readText();
      }),
    ).toBe(SCRIPT_CODE);
  });

  test("a code box's text is reached by the pointer and the keyboard, and nothing typed changes it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "&role=member");

    const dialog: Locator = await openStep(page, "api-post-1");
    const input: Locator = codeInput(codeBox(dialog, "json"));

    expect(await pointerReaches(input)).toBe(true);

    // Into it by the pointer, then all of it selected from the keyboard.
    await input.click();
    await expect(input).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");

    expect(
      await input.evaluate((element: Element): Array<number> => {
        const area: HTMLTextAreaElement = element as HTMLTextAreaElement;
        return [area.selectionStart, area.selectionEnd];
      }),
    ).toEqual([0, REQUEST_BODY.length]);

    await page.keyboard.type("{}");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Backspace");

    await expect(input).toHaveValue(REQUEST_BODY);
  });

  test("More fields opens, to read the header folded there - held still as it is", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "&role=member");

    const dialog: Locator = await openStep(page, "api-post-1");
    const moreFields: Locator = dialog.getByRole("button", {
      name: /^More fields/,
    });

    await expect(moreFields).toHaveAttribute("aria-expanded", "false");
    expect(await pointerReaches(moreFields)).toBe(true);

    await moreFields.click();

    await expect(moreFields).toHaveAttribute("aria-expanded", "true");

    const key: Locator = dialog.locator('input[value="Authorization"]');

    await expect(key).toBeVisible();
    await expect(key).toBeDisabled();
    await expect(
      dialog.getByTestId("workflow-argument-request-headers-value-0"),
    ).toHaveText(REQUEST_AUTHORIZATION);

    // And it folds away again.
    await moreFields.click();
    await expect(moreFields).toHaveAttribute("aria-expanded", "false");
  });

  test("nothing typed into a value box or the identifier changes it, and nothing is saved", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "&role=member");

    const dialog: Locator = await openStep(page, "api-post-1");
    const url: Locator = dialog.getByTestId("workflow-argument-url");

    await expect(url).toHaveText(REQUEST_URL);
    await expect(url).toHaveAttribute("contenteditable", "false");

    await url.click();
    await page.keyboard.type("x");
    await expect(url).toHaveText(REQUEST_URL);

    await expect(
      dialog.getByRole("textbox", { name: /^Identifier/ }),
    ).toBeDisabled();

    await dialog.getByRole("button", { name: "Close" }).last().click();
    await expect(page.locator(SETTINGS_DIALOG)).toHaveCount(0);

    expect(
      await page.evaluate((): unknown => {
        return (window as unknown as { __builderSaves: unknown })
          .__builderSaves;
      }),
    ).toEqual([]);
  });

  test("nothing in the settings takes the focus as the step opens: there is nothing to type", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "&role=member");

    const dialog: Locator = await openStep(page, "javascript-1");

    await expect(codeInput(codeBox(dialog, "javascript"))).toBeVisible();

    expect(
      await page.evaluate((): boolean => {
        const settings: Element | null = document.querySelector(
          '[data-testid="workflow-component-settings-view-only"]',
        );
        return Boolean(settings && settings.contains(document.activeElement));
      }),
    ).toBe(false);
  });

  test("for someone who may change the workflow, the same step is edited as it always was", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "");

    await expect(page.getByTestId("workflow-view-only-status")).toHaveCount(0);

    const dialog: Locator = await openStep(page, "api-post-1");
    const box: Locator = codeBox(dialog, "json");

    await expect(codeInput(box)).not.toHaveAttribute("readonly", "");
    await expect(box.getByTestId("code-editor-read-only")).toHaveCount(0);
    await expect(box.getByTestId("code-editor-format-button")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save" })).toBeVisible();
  });
});
