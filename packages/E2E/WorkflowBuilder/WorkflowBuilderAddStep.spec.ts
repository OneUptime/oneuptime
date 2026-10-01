import { expect, Locator, Page, test } from "@playwright/test";

/*
 * Adding a step to a workflow, in the real builder canvas.
 *
 * The maintainer's ask: "When I add a component to workflows, I see the modal
 * immediately. Can you please not open the modal automatically but wait for
 * me to click on the component in the canvas."
 *
 * So after a step is added: no settings dialog; the step is on the canvas,
 * selected, in view (not under the minimap or the zoom buttons) at the zoom
 * the builder chose, with the keyboard focus so Enter opens it; it says
 * "Click to set up" while its required settings are empty; and clicking it
 * opens its settings. These need a browser: react-flow keeps a new step
 * hidden until it has measured it, and only a browser has layout, focus
 * rings and the key events that follow a keydown.
 */

type Box = { x: number; y: number; width: number; height: number };

const SETTINGS_DIALOG: string = '[role="dialog"][aria-modal="true"]';

async function openBuilder(page: Page, scenario: string): Promise<void> {
  await page.goto(`/?scenario=${scenario}`);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
}

/*
 * Through the Add Component (or Add Trigger) panel, the way a person does
 * it. The panel is the only part of this file that knows its markup.
 */
async function chooseInPicker(page: Page, title: string): Promise<void> {
  // The panel's own box is empty: what it draws is fixed to the window.
  const panel: Locator = page.getByTestId("side-over");
  const search: Locator = panel.locator("#workflow-component-search");
  await expect(search).toBeVisible();
  await search.fill(title);
  await panel.getByRole("button", { name: title, exact: true }).click();
}

async function addComponent(page: Page, title: string): Promise<void> {
  await page.getByTestId("add-component").click();
  await chooseInPicker(page, title);
  await page
    .getByTestId("side-over")
    .getByRole("button", { name: "Add to Workflow" })
    .click();
  await expect(page.getByTestId("side-over")).toHaveCount(0);
}

function stepCard(page: Page, componentId: string): Locator {
  return page.locator(".react-flow__node", { hasText: componentId });
}

// The open settings dialog, once it shows the step's identifier.
async function expectSettingsFor(
  page: Page,
  componentId: string,
): Promise<Locator> {
  const dialog: Locator = page.locator(SETTINGS_DIALOG);
  await expect(dialog).toBeVisible();
  await expect
    .poll(async () => {
      return dialog
        .locator("input")
        .evaluateAll((inputs: Array<Element>): Array<string> => {
          return inputs.map((input: Element) => {
            return (input as HTMLInputElement).value;
          });
        });
    })
    .toContain(componentId);
  return dialog;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();

  if (!box) {
    throw new Error("Expected the element to be drawn.");
  }

  return box;
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

async function viewportTransform(page: Page): Promise<string> {
  return page
    .locator(".react-flow__viewport")
    .evaluate((element: Element): string => {
      return (element as HTMLElement).style.transform;
    });
}

async function viewportScale(page: Page): Promise<number> {
  const transform: string = await viewportTransform(page);
  const match: RegExpMatchArray | null = transform.match(/scale\(([\d.]+)\)/);
  return match ? Number(match[1]) : NaN;
}

test.describe("Workflow builder: adding a step", () => {
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

  test("the settings stay closed, and the new step is selected, focused and asks to be set up", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "graph");
    await addComponent(page, "Log");

    const added: Locator = stepCard(page, "log-2");
    await expect(added).toBeVisible();
    await expect(added).toHaveClass(/\bselected\b/);
    await expect(added).toBeFocused();
    await expect(added.getByTestId("workflow-node-setup-hint")).toHaveText(
      "Click to set up",
    );
    await expect(stepCard(page, "log-1")).not.toHaveClass(/\bselected\b/);

    // Give a dialog every chance to turn up; none may.
    await page.waitForTimeout(500);
    await expect(page.locator(SETTINGS_DIALOG)).toHaveCount(0);
  });

  test("the new step is in view and clear of the minimap and zoom buttons", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "graph");
    await addComponent(page, "Log");

    const added: Locator = stepCard(page, "log-2");
    await expect(added).toBeFocused();
    // Let the canvas finish gliding to it.
    await page.waitForTimeout(500);

    const card: Box = await boxOf(added);
    const canvas: Box = await boxOf(page.locator(".react-flow"));

    expect(card.x).toBeGreaterThanOrEqual(canvas.x);
    expect(card.y).toBeGreaterThanOrEqual(canvas.y);
    expect(card.x + card.width).toBeLessThanOrEqual(canvas.x + canvas.width);
    expect(card.y + card.height).toBeLessThanOrEqual(canvas.y + canvas.height);

    for (const overlay of [".react-flow__minimap", ".react-flow__controls"]) {
      expect(overlaps(card, await boxOf(page.locator(overlay)))).toBe(false);
    }
  });

  test("clicking the new step opens its settings", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "graph");
    await addComponent(page, "Log");
    await stepCard(page, "log-2").click();

    const dialog: Locator = await expectSettingsFor(page, "log-2");
    await expect(dialog).toContainText("Log");
  });

  test("from the keyboard: the new step shows a focus ring, and Enter opens its settings without typing into them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "graph");
    await page.getByTestId("add-component").click();
    await chooseInPicker(page, "Log");
    await page
      .getByTestId("side-over")
      .getByRole("button", { name: "Add to Workflow" })
      .focus();
    await page.keyboard.press("Enter");

    const added: Locator = stepCard(page, "log-2");
    await expect(added).toBeFocused();
    expect(
      await added.evaluate((element: Element): boolean => {
        return element.matches(":focus-visible");
      }),
    ).toBe(true);
    expect(
      await added.evaluate((element: Element): string => {
        return getComputedStyle(element).outlineStyle;
      }),
    ).toBe("solid");
    await expect(page.locator(SETTINGS_DIALOG)).toHaveCount(0);

    await page.keyboard.press("Enter");

    const dialog: Locator = await expectSettingsFor(page, "log-2");
    await page.waitForTimeout(300);

    // Whatever the dialog focused first got no stray new line from that Enter.
    const focusedValue: string = await page.evaluate((): string => {
      const active: Element | null = document.activeElement;
      return active && "value" in active
        ? String((active as HTMLInputElement).value)
        : "";
    });
    expect(focusedValue).not.toContain("\n");
    await expect(dialog.locator("textarea").first()).toHaveValue("");
  });

  test("a step added with the mouse draws no focus ring", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "graph");
    await addComponent(page, "Log");

    const added: Locator = stepCard(page, "log-2");
    await expect(added).toBeFocused();
    expect(
      await added.evaluate((element: Element): string => {
        return getComputedStyle(element).outlineStyle;
      }),
    ).toBe("none");
  });

  test("the zoom the builder chose is kept", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "graph");
    await page.locator(".react-flow__controls-zoomout").click();
    await page.locator(".react-flow__controls-zoomout").click();
    // The zoom buttons glide too.
    await page.waitForTimeout(500);
    const before: number = await viewportScale(page);
    expect(before).toBeLessThan(1);

    await addComponent(page, "Log");
    await expect(stepCard(page, "log-2")).toBeFocused();
    await page.waitForTimeout(500);

    expect(await viewportScale(page)).toBeCloseTo(before, 5);
  });

  test("a step that lands in view does not move the canvas", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    // On a phone the step lands under the zoom buttons, so it has to move.
    test.skip(isMobile, "There is no room for it below the trigger.");

    await openBuilder(page, "trigger-only");
    await page.waitForTimeout(300);
    const before: string = await viewportTransform(page);

    await addComponent(page, "Log");
    await expect(stepCard(page, "log-1")).toBeFocused();
    await page.waitForTimeout(500);

    expect(await viewportTransform(page)).toBe(before);
  });

  test("a trigger chosen from the placeholder lands the same way", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "empty");
    await page
      .locator(".react-flow__node", {
        hasText: "Choose what starts this workflow",
      })
      .click();
    await chooseInPicker(page, "Manual");
    await page
      .getByTestId("side-over")
      .getByRole("button", { name: "Add to Workflow" })
      .click();

    const trigger: Locator = stepCard(page, "manual-1");
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveClass(/\bselected\b/);
    await page.waitForTimeout(500);
    await expect(page.locator(SETTINGS_DIALOG)).toHaveCount(0);

    await trigger.click();
    await expectSettingsFor(page, "manual-1");
  });

  test("an unconnected new step gets an amber warning badge, not a red error", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "graph");
    await addComponent(page, "Log");

    const added: Locator = stepCard(page, "log-2");
    await expect(
      added.getByTestId("workflow-node-issue-badge"),
    ).toHaveAttribute("data-tone", "Warning");

    const borderColor: string = await added.evaluate(
      (element: Element): string => {
        return getComputedStyle(element.firstElementChild as Element)
          .borderTopColor;
      },
    );
    expect(borderColor).not.toBe("rgb(252, 165, 165)");
  });

  test("filling in the required setting takes the prompt away", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "graph");
    await addComponent(page, "Log");
    await stepCard(page, "log-2").click();

    const dialog: Locator = page.locator(SETTINGS_DIALOG);
    await expect(dialog).toBeVisible();
    await dialog.locator("textarea").first().fill("Hello");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);

    await expect(
      stepCard(page, "log-2").getByTestId("workflow-node-setup-hint"),
    ).toHaveCount(0);
  });

  test("what the canvas draws about a step never reaches the saved graph", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "graph");
    await addComponent(page, "Log");
    // Not connected yet, so the canvas still has something to say about it.
    await stepCard(page, "log-2").click();
    const dialog: Locator = page.locator(SETTINGS_DIALOG);
    await dialog.locator("textarea").first().fill("Hello");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      stepCard(page, "log-2").getByTestId("workflow-node-issue-badge"),
    ).toHaveAttribute("data-tone", "Warning");

    const saved: Array<Record<string, unknown>> = await page.evaluate(
      (): Array<Record<string, unknown>> => {
        const graph: { nodes: Array<{ data: Record<string, unknown> }> } = (
          window as unknown as {
            __savedGraph: { nodes: Array<{ data: Record<string, unknown> }> };
          }
        ).__savedGraph;

        return graph.nodes.map((node: { data: Record<string, unknown> }) => {
          return node.data;
        });
      },
    );

    expect(saved).toHaveLength(3);
    for (const data of saved) {
      expect(data).not.toHaveProperty("issueSummary");
      expect(data["error"] || "").toBe("");
    }
  });
});
