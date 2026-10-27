import { expect, Locator, Page, test } from "@playwright/test";

/*
 * The toolbar's add button, in the real workflow builder canvas with the
 * real Add Trigger / Add Component panel and catalog.
 *
 * The maintainer's ask: "When there are no triggers on the form, the Add
 * Component button should say 'Add Trigger' so it's easier for people to
 * use and understand."
 *
 * So the button says Add Trigger while the canvas has no trigger and opens
 * the Add Trigger panel - the dashed card's panel - and says Add Component,
 * opening the Add Component panel, once a trigger is on the canvas. It
 * changes as soon as the first trigger is chosen or the last one deleted.
 * The fixture's toolbar button names itself as the Builder's does
 * (WorkflowAddButton); the canvas and the panel are the real ones.
 */

type SavedNode = {
  position: { x: number; y: number };
  data: { id: string; nodeType: string; componentType?: string | undefined };
};

async function openBuilder(page: Page, scenario: string): Promise<void> {
  await page.goto(`/?scenario=${scenario}`);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
}

function addButton(page: Page): Locator {
  return page.getByTestId("add-component");
}

function stepCard(page: Page, componentId: string): Locator {
  return page.locator(".react-flow__node", { hasText: componentId });
}

function dashedCard(page: Page): Locator {
  return page.locator(".react-flow__node", {
    hasText: "Choose what starts this workflow",
  });
}

// The panel's own box is empty: what it draws is fixed to the window.
function panel(page: Page): Locator {
  return page.getByTestId("side-over");
}

// Presses the toolbar's button; gives back the title of the panel it opened.
async function pressAddButton(page: Page): Promise<string> {
  await addButton(page).click();
  const title: Locator = panel(page).getByTestId("side-over-title");
  await expect(title).toBeVisible();
  return (await title.textContent()) || "";
}

// Search, and click the result: the panel adds it and closes.
async function choose(page: Page, title: string): Promise<void> {
  const search: Locator = panel(page).locator("#workflow-component-search");
  await expect(search).toBeVisible();
  await search.fill(title);
  await panel(page).getByRole("option", { name: title, exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
}

async function closePanel(page: Page): Promise<void> {
  await panel(page)
    .getByTestId("side-over-footer")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(panel(page)).toHaveCount(0);
}

// The graph the canvas last reported, as the Builder saves it.
async function savedNodes(page: Page): Promise<Array<SavedNode>> {
  return page.evaluate((): Array<SavedNode> => {
    const saved: { nodes: Array<SavedNode> } | undefined = (
      window as unknown as { __savedGraph?: { nodes: Array<SavedNode> } }
    ).__savedGraph;

    return (saved?.nodes || []).map((node: SavedNode): SavedNode => {
      return {
        position: { x: node.position.x, y: node.position.y },
        data: {
          id: node.data.id,
          nodeType: node.data.nodeType,
          componentType: node.data.componentType,
        },
      };
    });
  });
}

test.describe("Workflow builder: the toolbar's add button says what the workflow needs next", () => {
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

  test("a workflow from scratch: Add Trigger, which opens the Add Trigger panel and its triggers", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "empty");

    await expect(addButton(page)).toHaveText("Add Trigger");
    expect(await pressAddButton(page)).toBe("Add Trigger");
    await expect(panel(page).getByTestId("side-over-description")).toHaveText(
      "Click a trigger to add it to your workflow.",
    );
    await expect(
      panel(page).getByRole("region", { name: "Popular" }).getByRole("button"),
    ).toHaveText([
      /^Manual/,
      /^Schedule/,
      /^Webhook/,
      /^Incoming Email/,
      /^On Create Incident/,
      /^On Update Incident/,
      /^On Create Alert/,
      /^On Update Monitor/,
    ]);
  });

  test("the trigger chosen there makes it Add Component, which opens the Add Component panel", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "empty");
    await pressAddButton(page);
    await choose(page, "Manual");

    // The trigger took the dashed card's place, and its settings stay closed.
    await expect(stepCard(page, "manual-1")).toBeVisible();
    await expect(stepCard(page, "manual-1")).toBeFocused();
    await expect(dashedCard(page)).toHaveCount(0);
    await expect(
      page.locator('[role="dialog"][aria-modal="true"]'),
    ).toHaveCount(0);

    await expect(addButton(page)).toHaveText("Add Component");
    expect(await pressAddButton(page)).toBe("Add Component");
    await expect(panel(page).getByTestId("side-over-description")).toHaveText(
      "Click a component to add it to your workflow.",
    );

    await choose(page, "Log");

    await expect(stepCard(page, "log-1")).toBeVisible();
    await expect(addButton(page)).toHaveText("Add Component");
    expect(
      (await savedNodes(page)).map((node: SavedNode): Array<string> => {
        return [node.data.nodeType, node.data.id];
      }),
    ).toEqual([
      ["Node", "manual-1"],
      ["Node", "log-1"],
    ]);
  });

  test("the dashed card and the button open the same panel, and either one opens it again after it closes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "empty");

    await dashedCard(page).click();
    await expect(panel(page).getByTestId("side-over-title")).toHaveText(
      "Add Trigger",
    );
    await closePanel(page);

    expect(await pressAddButton(page)).toBe("Add Trigger");
    await closePanel(page);

    // Closed without a choice: nothing added, and the button works again.
    await expect(dashedCard(page)).toBeVisible();
    await expect(addButton(page)).toHaveText("Add Trigger");
    expect(await pressAddButton(page)).toBe("Add Trigger");
  });

  test("a workflow whose trigger was deleted: Add Trigger, and the new trigger takes the dashed card's place beside its step", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "no-trigger");

    await expect(dashedCard(page)).toBeVisible();
    await expect(stepCard(page, "log-1")).toBeVisible();
    await expect(addButton(page)).toHaveText("Add Trigger");

    const placeholder: SavedNode | undefined = (await savedNodes(page)).find(
      (node: SavedNode): boolean => {
        return node.data.nodeType === "PlaceholderNode";
      },
    );

    expect(placeholder).toBeDefined();

    expect(await pressAddButton(page)).toBe("Add Trigger");
    await choose(page, "Manual");

    await expect(dashedCard(page)).toHaveCount(0);
    await expect(stepCard(page, "log-1")).toBeVisible();
    await expect(addButton(page)).toHaveText("Add Component");

    const nodes: Array<SavedNode> = await savedNodes(page);
    const trigger: SavedNode | undefined = nodes.find(
      (node: SavedNode): boolean => {
        return node.data.id === "manual-1";
      },
    );

    expect(trigger?.data.componentType).toBe("Trigger");
    expect(trigger?.position).toEqual(placeholder?.position);
    expect(
      nodes
        .map((node: SavedNode): string => {
          return node.data.id;
        })
        .sort(),
    ).toEqual(["log-1", "manual-1"]);
  });

  /*
   * Run Workflow on a workflow with no trigger: the panel says there is
   * nothing to run from yet, and its one action - the footer's, where Run
   * Workflow Manually would be - is Add Trigger, which opens the triggers in
   * its place.
   */
  test("Run Workflow with no trigger says so, and its footer's Add Trigger opens the triggers in its place", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "no-trigger");
    await page.getByTestId("run-workflow").click();

    await expect(panel(page).getByTestId("side-over-title")).toHaveText(
      "Run Workflow",
    );
    await expect(
      panel(page).getByRole("heading", {
        name: "This workflow has no trigger yet",
      }),
    ).toBeVisible();
    await expect(
      panel(page).getByText(
        "A run starts from the workflow's trigger. Add one, then run the workflow from here.",
      ),
    ).toBeVisible();
    await expect(
      panel(page).getByRole("button", { name: "Run Workflow Manually" }),
    ).toHaveCount(0);

    const footer: Locator = panel(page).getByTestId("side-over-footer");
    await expect(footer.getByRole("button")).toHaveText([
      "Close",
      "Add Trigger",
    ]);

    await footer
      .getByRole("button", { name: "Add Trigger", exact: true })
      .click();

    await expect(panel(page)).toHaveCount(1);
    await expect(panel(page).getByTestId("side-over-title")).toHaveText(
      "Add Trigger",
    );
    await choose(page, "Manual");

    await expect(dashedCard(page)).toHaveCount(0);
    await expect(addButton(page)).toHaveText("Add Component");
  });

  test("deleting the last trigger brings back the dashed card and Add Trigger", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "trigger-only");
    await expect(addButton(page)).toHaveText("Add Component");

    await stepCard(page, "manual-1").click();
    const settings: Locator = page.getByRole("dialog", { name: "Manual" });
    await expect(settings).toBeVisible();
    await settings.getByRole("button", { name: "Delete", exact: true }).click();

    const confirm: Locator = page.getByRole("dialog", {
      name: "Delete Trigger",
    });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();

    await expect(
      page.locator('[role="dialog"][aria-modal="true"]'),
    ).toHaveCount(0);
    await expect(stepCard(page, "manual-1")).toHaveCount(0);
    await expect(dashedCard(page)).toBeVisible();
    await expect(addButton(page)).toHaveText("Add Trigger");

    expect(await pressAddButton(page)).toBe("Add Trigger");
    await choose(page, "Webhook");

    await expect(stepCard(page, "webhook-1")).toBeVisible();
    await expect(addButton(page)).toHaveText("Add Component");
  });

  test("a workflow with its trigger: Add Component from the start", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "graph");

    await expect(addButton(page)).toHaveText("Add Component");
    expect(await pressAddButton(page)).toBe("Add Component");
  });
});
