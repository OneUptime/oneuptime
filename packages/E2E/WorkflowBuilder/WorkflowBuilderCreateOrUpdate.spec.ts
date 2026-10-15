import { expect, Locator, Page, test } from "@playwright/test";

/*
 * On Create or Update in the real workflow builder: one trigger that runs
 * when a record is created and when it is updated.
 *
 * The maintainer's ask: "we only have components called 'on create' for
 * create and 'on update' for update in workflows, but we do not have 'on
 * create or on update' ... Can you please create that component as well?"
 *
 * The rules - which models have it, when it runs, what it hands on - are
 * unit tested in packages/Common and packages/App. What only a browser shows
 * is checked here, against the real catalog and the real Incident schema:
 * where the Add Trigger panel lists it and what finds it, what a new one
 * starts with and what its Fields to watch say, Run Workflow's question and
 * what follows its answer, a later step's value list offering What Happened,
 * and the question on a phone and in the dark theme.
 */

type Box = { x: number; y: number; width: number; height: number };

interface StartedRun {
  metadataId: string;
  arguments: Record<string, unknown>;
}

const TRIGGER_ID: string = "incident-on-create-or-update-1";
const INC_11: string = "a0000000-0000-4000-8000-000000000011";
const WHAT_HAPPENED: string = `{{local.components.${TRIGGER_ID}.returnValues.what-happened}}`;

const SETTINGS_DIALOG: string = '[role="dialog"][aria-modal="true"]';
const MODAL: string = '[role="dialog"][aria-modal="true"]';

function stepCard(page: Page, componentId: string): Locator {
  return page.locator(".react-flow__node", { hasText: componentId });
}

async function openBuilder(page: Page, query: string = ""): Promise<void> {
  await page.goto(`/?scenario=record&trigger=create-or-update${query}`);
  await expect(stepCard(page, TRIGGER_ID)).toBeVisible();
}

async function openRunPanel(page: Page, query: string = ""): Promise<Locator> {
  await openBuilder(page, query);
  await page.getByTestId("run-workflow").click();

  const panel: Locator = page.getByTestId("side-over");

  await expect(panel.getByTestId("run-record-field")).toBeVisible();

  return panel;
}

function answer(
  panel: Locator,
  name: "Just created" | "Just updated",
): Locator {
  return panel
    .getByTestId("run-what-happened")
    .getByRole("radio", { name: name });
}

async function pickIncident11(panel: Locator): Promise<void> {
  const search: Locator = panel.getByTestId("run-record-field-search");

  await search.click();
  await search.fill("INC-11");
  await expect(panel.getByTestId("run-record-field-option")).toHaveCount(1);
  await panel.getByTestId("run-record-field-option").first().click();
  await expect(panel.getByTestId("run-record-field-picked")).toContainText(
    "Database is down",
  );
}

function confirmation(page: Page): Locator {
  return page.locator(MODAL).filter({ hasText: "Run this workflow now?" });
}

async function startedRuns(page: Page): Promise<Array<StartedRun>> {
  return page.evaluate((): Array<StartedRun> => {
    return (window as unknown as { __runs: Array<StartedRun> }).__runs;
  });
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();

  if (!box) {
    throw new Error("Expected the element to be drawn.");
  }

  return box;
}

test.describe("Workflow builder: On Create or Update", () => {
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

  test("the Add Trigger panel lists it after the incident's On Create and On Update, and a search for what it does finds it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/?scenario=record-new");
    await page
      .locator(".react-flow__node", {
        hasText: "Choose what starts this workflow",
      })
      .click();

    const panel: Locator = page.getByTestId("side-over");

    await expect(panel.getByTestId("side-over-title")).toHaveText(
      "Add Trigger",
    );

    await panel.getByRole("button", { name: "Incident, 4 triggers" }).click();
    await expect(
      panel
        .getByRole("group", { name: "Incident triggers" })
        .getByRole("button"),
    ).toHaveText([
      /^On Create Incident/,
      /^On Update Incident/,
      /^On Create or Update Incident/,
      /^On Delete Incident/,
    ]);

    const search: Locator = panel.locator("#workflow-component-search");

    // A search for one of the two it stands for still finds that one first.
    await search.fill("incident created");
    await expect(panel.getByRole("option").first()).toHaveAccessibleName(
      "On Create Incident",
    );
    await expect(panel.getByRole("option").nth(1)).toHaveAccessibleName(
      "On Create or Update Incident",
    );

    // What it does finds it first.
    await search.fill("incident created or updated");
    await expect(panel.getByRole("option").first()).toHaveAccessibleName(
      "On Create or Update Incident",
    );
    await panel.getByRole("option").first().click();

    await expect(panel).toHaveCount(0);
    await expect(stepCard(page, TRIGGER_ID)).toBeVisible();
  });

  test("a new one passes on the incident's title, and its Fields to watch say a new incident always runs it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/?scenario=record-new");
    await page
      .locator(".react-flow__node", {
        hasText: "Choose what starts this workflow",
      })
      .click();

    const panel: Locator = page.getByTestId("side-over");

    await panel
      .locator("#workflow-component-search")
      .fill("create or update incident");
    await panel.getByRole("option").first().click();
    await stepCard(page, TRIGGER_ID).click();

    const dialog: Locator = page.locator(SETTINGS_DIALOG);

    await expect(dialog.getByTestId("fields-to-pass-on")).toBeVisible();
    await expect(dialog.getByTestId("fields-to-pass-on-chip")).toHaveText([
      /Title/,
    ]);
    await expect(dialog.getByTestId("fields-to-watch-empty")).toHaveText(
      "Every new incident, and every change to one, runs this workflow.",
    );
    await expect(
      dialog.getByText(
        "Run on an update only when it changes one of these fields. A new Incident always runs this workflow. Leave it empty to run on every change.",
      ),
    ).toBeVisible();
  });

  test("Run Workflow asks what happened; the record's line, the confirmation and the run follow the answer", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openRunPanel(page);

    await expect(panel.getByTestId("run-what-happened")).toBeVisible();

    // Above the incident's search, whose list opens under it.
    const question: Box = await boxOf(panel.getByTestId("run-what-happened"));
    const record: Box = await boxOf(panel.getByTestId("run-record-field"));

    expect(question.y + question.height).toBeLessThanOrEqual(record.y);
    await expect(answer(panel, "Just created")).toBeChecked();
    await expect(answer(panel, "Just updated")).not.toBeChecked();
    await expect(
      panel.getByText(
        "The run starts as if this incident had just been created.",
      ),
    ).toBeVisible();

    await answer(panel, "Just updated").check();

    await expect(answer(panel, "Just updated")).toBeChecked();
    await expect(
      panel.getByText(
        "The run starts as if this incident had just been updated.",
      ),
    ).toBeVisible();

    await pickIncident11(panel);
    await panel.getByRole("button", { name: "Run Workflow Manually" }).click();

    await expect(confirmation(page)).toContainText(
      "It runs as if INC-11 · Database is down had just been updated.",
    );
    await confirmation(page).getByRole("button", { name: "Run" }).click();

    await expect
      .poll(async (): Promise<number> => {
        return (await startedRuns(page)).length;
      })
      .toBe(1);

    const run: StartedRun = (await startedRuns(page))[0]!;

    expect(run.metadataId).toBe("incident-on-create-or-update");
    expect(run.arguments["_id"]).toBe(INC_11);
    expect(run.arguments["what-happened"]).toBe("updated");
  });

  test("left as it is, the run goes as created", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openRunPanel(page);

    await pickIncident11(panel);
    await panel.getByRole("button", { name: "Run Workflow Manually" }).click();

    await expect(confirmation(page)).toContainText(
      "It runs as if INC-11 · Database is down had just been created.",
    );
    await confirmation(page).getByRole("button", { name: "Run" }).click();

    await expect
      .poll(async (): Promise<unknown> => {
        return (await startedRuns(page))[0]?.arguments["what-happened"];
      })
      .toBe("created");
  });

  test("a step after it can use What Happened, offered as the trigger's own value", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page);
    await stepCard(page, "log-1").click();

    const dialog: Locator = page.locator(SETTINGS_DIALOG);

    await expect(dialog).toBeVisible();
    await dialog.getByTestId("workflow-argument-value-insert-value").click();

    const menu: Locator = page.getByTestId("value-picker");

    await expect(menu).toBeVisible();
    await expect(menu.getByText("Loading variables…")).toHaveCount(0);

    const option: Locator = menu.locator(
      `[data-testid="value-picker-option"][data-reference="${WHAT_HAPPENED}"]`,
    );

    await expect(option).toBeVisible();
    await expect(option).toContainText("What Happened");
    // Plain text, picked whole: nothing to open, nothing greyed.
    await expect(option).not.toHaveAttribute("data-empty-here", "true");
  });

  test("the question fits a phone's width and reads in the dark theme", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openRunPanel(page, "&theme=dark");
    const question: Locator = panel.getByTestId("run-what-happened");

    await expect(question).toBeVisible();

    const width: number = await page.evaluate((): number => {
      return document.documentElement.clientWidth;
    });

    // Once the panel has slid in, the question is wholly on screen.
    await expect
      .poll(async (): Promise<boolean> => {
        const box: Box = await boxOf(question);

        return box.x >= 0 && box.x + box.width <= width + 0.5;
      })
      .toBe(true);

    // Both answers on screen, one under the other, each a full row.
    const created: Box = await boxOf(answer(panel, "Just created"));
    const updated: Box = await boxOf(answer(panel, "Just updated"));

    expect(updated.y).toBeGreaterThan(created.y);

    const background: string = await question.evaluate(
      (element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      },
    );

    // A dark surface, not the light theme's white.
    expect(background).not.toBe("rgb(255, 255, 255)");
  });
});
