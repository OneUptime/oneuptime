import { expect, Locator, Page, test } from "@playwright/test";

/*
 * The Builder page around the canvas, in a browser: the toolbar's add button
 * and the notice shown while the workflow is off. The page is the
 * Dashboard's real Builder (the fixture's ?page=builder-page, BuilderPage.js)
 * with the real canvas and panels; only the API is stood in for.
 *
 * The maintainer's ask: "When there are no triggers on the form, the Add
 * Component button should say 'Add Trigger' so it's easier for people to
 * use and understand." Its UI review went on from the words to the page:
 *
 * - Until the workflow has a trigger, choosing one is the only thing to do
 *   first, so Add Trigger is the page's one primary button. Once there is a
 *   trigger, Add Component is a plain bordered button, like the product's
 *   Create buttons (it was a borderless one that read like a label).
 * - The off notice waits for the trigger: it says the trigger is paused and
 *   Run Workflow tests it, neither true without one, and its Turn on
 *   workflow would be a second primary button beside Add Trigger.
 * - The toolbar's buttons line up with the Enabled switch when they wrap
 *   under it (a tablet's column beside the side menu), and fill the
 *   toolbar's width on a phone.
 * - The notice puts Turn on workflow under its sentences until the window
 *   is lg wide: beside them, in a tablet's column, they were squeezed into
 *   a column of a word or two a line.
 *
 * jsdom draws no layout and runs no Tailwind, so these live here.
 */

// Tailwind's colours, as the browser computes them.
const INDIGO_600: string = "rgb(79, 70, 229)";
const WHITE: string = "rgb(255, 255, 255)";
const GRAY_300: string = "rgb(209, 213, 219)";

// The Builder's column on a tablet, beside the side menu.
const TABLET: { width: number; height: number } = { width: 768, height: 1000 };
const TABLET_COLUMN: number = 430;

type Box = { x: number; y: number; width: number; height: number };

async function openBuilderPage(page: Page, query: string): Promise<void> {
  await page.goto(`/?page=builder-page${query}`);
  await expect(addButton(page)).toBeVisible();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
}

function addButton(page: Page): Locator {
  return page.getByTestId("workflow-add-button");
}

function runButton(page: Page): Locator {
  return page.getByTestId("run-workflow-button");
}

function enabledSwitch(page: Page): Locator {
  return page.getByRole("switch", { name: "Enabled" });
}

function notice(page: Page): Locator {
  return page.getByTestId("workflow-turned-off-notice");
}

function panel(page: Page): Locator {
  return page.getByTestId("side-over");
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();

  if (!box) {
    throw new Error("Expected the element to be drawn.");
  }

  return box;
}

// The labels of every button on the page drawn as a primary one.
async function primaryButtons(page: Page): Promise<Array<string>> {
  return page.evaluate((fill: string): Array<string> => {
    return Array.from(document.querySelectorAll("button"))
      .filter((button: HTMLButtonElement): boolean => {
        return getComputedStyle(button).backgroundColor === fill;
      })
      .map((button: HTMLButtonElement): string => {
        return (button.textContent || "").trim();
      });
  }, INDIGO_600);
}

// The toolbar's add button, then its panel: the trigger chosen there.
async function addTrigger(page: Page, title: string): Promise<void> {
  await addButton(page).click();
  await expect(panel(page).getByTestId("side-over-title")).toHaveText(
    "Add Trigger",
  );
  await panel(page).locator("#workflow-component-search").fill(title);
  await panel(page).getByRole("option", { name: title, exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
}

// Within a pixel: layout rounds.
function expectSameX(first: Box, second: Box): void {
  expect(Math.abs(first.x - second.x)).toBeLessThanOrEqual(1);
}

test.describe("Workflow builder page: what the toolbar and the off notice put first", () => {
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

  test("a workflow from scratch, off as a new one is: Add Trigger is the page's one primary button, and no notice", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilderPage(page, "");

    await expect(addButton(page)).toHaveText("Add Trigger");
    await expect(addButton(page)).toHaveCSS("background-color", INDIGO_600);
    await expect(enabledSwitch(page)).toHaveAttribute("aria-checked", "false");
    await expect(notice(page)).toHaveCount(0);
    expect(await primaryButtons(page)).toEqual(["Add Trigger"]);
  });

  test("its trigger chosen: the notice comes, Add Component is a plain bordered button, and deleting the trigger goes back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilderPage(page, "");
    await addTrigger(page, "Manual");

    await expect(addButton(page)).toHaveText("Add Component");
    await expect(addButton(page)).toHaveCSS("background-color", WHITE);
    await expect(addButton(page)).toHaveCSS("border-top-color", GRAY_300);
    await expect(notice(page)).toBeVisible();
    await expect(
      notice(page).getByTestId("workflow-turned-off-notice-title"),
    ).toHaveText("This workflow is off");
    // The one primary button now is the notice's.
    expect(await primaryButtons(page)).toEqual(["Turn on workflow"]);

    // Deleting the trigger: the dashed card, Add Trigger first, no notice.
    await page.locator(".react-flow__node", { hasText: "manual-1" }).click();
    const settings: Locator = page.getByRole("dialog", { name: "Manual" });
    await expect(settings).toBeVisible();
    await settings.getByRole("button", { name: "Delete", exact: true }).click();
    const confirm: Locator = page.getByRole("dialog", {
      name: "Delete Trigger",
    });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();

    await expect(addButton(page)).toHaveText("Add Trigger");
    await expect(addButton(page)).toHaveCSS("background-color", INDIGO_600);
    await expect(notice(page)).toHaveCount(0);
  });

  test("a workflow with its trigger: the notice from the start while it is off, none once it is on; steps without a trigger: none", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilderPage(page, "&graph=trigger");
    await expect(addButton(page)).toHaveText("Add Component");
    await expect(addButton(page)).toHaveCSS("background-color", WHITE);
    await expect(notice(page)).toBeVisible();

    await openBuilderPage(page, "&graph=trigger&enabled=1");
    await expect(enabledSwitch(page)).toHaveAttribute("aria-checked", "true");
    await expect(addButton(page)).toHaveText("Add Component");
    await expect(notice(page)).toHaveCount(0);

    await openBuilderPage(page, "&graph=deleted");
    await expect(addButton(page)).toHaveText("Add Trigger");
    await expect(addButton(page)).toHaveCSS("background-color", INDIGO_600);
    await expect(notice(page)).toHaveCount(0);
  });

  test("in a tablet's column, the toolbar's buttons wrap under the Enabled switch and line up with it", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(isMobile, "A phone's toolbar is the next test's.");

    await page.setViewportSize(TABLET);

    for (const graph of ["", "&graph=trigger"]) {
      await openBuilderPage(page, `${graph}&column=${TABLET_COLUMN}`);

      const toggle: Box = await boxOf(enabledSwitch(page));
      const add: Box = await boxOf(addButton(page));
      const run: Box = await boxOf(runButton(page));

      // Under the switch, starting where it does - not indented.
      expect(add.y).toBeGreaterThanOrEqual(toggle.y + toggle.height);
      expectSameX(add, toggle);
      // Run Workflow beside it, a gap away.
      expect(Math.abs(run.y - add.y)).toBeLessThanOrEqual(1);
      expect(run.x).toBeGreaterThan(add.x + add.width);
    }
  });

  test("on a phone, the add button and Run Workflow are each as wide as the toolbar, under the switch", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(!isMobile, "The phone's own width decides this.");

    for (const graph of ["", "&graph=trigger"]) {
      await openBuilderPage(page, graph);

      const toggle: Box = await boxOf(enabledSwitch(page));
      const add: Box = await boxOf(addButton(page));
      const run: Box = await boxOf(runButton(page));

      expectSameX(add, toggle);
      expectSameX(run, add);
      expect(Math.abs(run.width - add.width)).toBeLessThanOrEqual(1);
      expect(run.y).toBeGreaterThanOrEqual(add.y + add.height);
      // The width of the toolbar inside its padding, not of the label.
      expect(add.width).toBeGreaterThan(page.viewportSize()!.width / 2);
    }
  });

  test("in a tablet's column, the notice puts Turn on workflow under its sentences, where they start", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    if (!isMobile) {
      await page.setViewportSize(TABLET);
    }

    await openBuilderPage(
      page,
      isMobile ? "&graph=trigger" : `&graph=trigger&column=${TABLET_COLUMN}`,
    );

    const body: Box = await boxOf(
      page.getByTestId("workflow-turned-off-notice-body"),
    );
    const turnOn: Box = await boxOf(
      page.getByTestId("workflow-turn-on-button"),
    );

    expect(turnOn.y).toBeGreaterThanOrEqual(body.y + body.height);

    if (isMobile) {
      // A phone's button is as wide as the notice, from under the icon.
      expect(turnOn.x).toBeLessThan(body.x);
      expect(turnOn.width).toBeGreaterThan(body.width);
    } else {
      expectSameX(turnOn, body);
    }

    // The sentences have the notice's width: a few lines, not a dozen.
    expect(body.height).toBeLessThan(5 * 24);
  });

  test("on a laptop, the notice keeps Turn on workflow beside its sentences", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(isMobile, "A phone has no room beside them.");

    await openBuilderPage(page, "&graph=trigger");

    const body: Box = await boxOf(
      page.getByTestId("workflow-turned-off-notice-body"),
    );
    const turnOn: Box = await boxOf(
      page.getByTestId("workflow-turn-on-button"),
    );

    expect(turnOn.x).toBeGreaterThanOrEqual(body.x + body.width);
    expect(turnOn.y).toBeLessThan(body.y + body.height);
  });
});
