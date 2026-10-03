import { expect, Locator, Page, test } from "@playwright/test";

/*
 * The "Create a workflow" dialog, in a real browser, with the real template
 * catalog. The fixture page (?page=create-workflow) is the Workflows page's
 * Create Workflow button and the dialog it opens; only the server is left
 * out, and what the dialog would create is read from
 * window.__createdRecords.
 *
 * The maintainer, about the version before this one: "This select template
 * for workflow is extremely hard to use because it shows a lot of
 * information on the modal. Can you please make sure the modal is very
 * simple to use? ... 'Start from scratch' should be more visible as well
 * because that's the most commonly used option."
 *
 * So the dialog opens on Start from scratch - first, focused, one click (or
 * Enter) from a name - with a few recommended templates below it, a quiet
 * search and category select, and a template's details only in its own row
 * once it is picked. jsdom covers the behaviour in packages/Common (the
 * CreateWorkflowModal and WorkflowTemplatePicker suites); this covers what
 * only a browser shows: real focus and keys, real layout at a laptop's and a
 * phone's width, and the real dark theme.
 */

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const CREATED_WORKFLOW_ID: string = "33333333-3333-4333-8333-333333333333";

const SLACK_TEMPLATE_NAME: string = "Tell Slack when an incident opens";
const SLACK_WORKFLOW_NAME: string = "Notify Slack on new incident";
const SLACK_WEBHOOK_URL: string =
  "https://hooks.slack.com/services/T000/B000/XXXX";

const RECOMMENDED_COUNT: number = 6;

// What the fixture recorded the dialog sending, in order.
interface CreatedRecord {
  kind: "workflow" | "variable" | "deleted";
  name?: string;
  description?: string;
  isEnabled?: boolean;
  projectId?: string | null;
  graph?: { nodes: Array<unknown>; edges: Array<unknown> };
  content?: string;
  isSecret?: boolean;
  workflowId?: string | null;
  id?: string;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function openDialog(page: Page, query: string = ""): Promise<Locator> {
  await page.goto(`/?page=create-workflow${query}`);
  await page.getByTestId("create-workflow").click();

  const dialog: Locator = page.getByRole("dialog", {
    name: "Create a workflow",
  });

  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("workflow-template-picker")).toBeVisible();

  return dialog;
}

async function createdRecords(page: Page): Promise<Array<CreatedRecord>> {
  return page.evaluate((): Array<CreatedRecord> => {
    return (window as unknown as { __createdRecords: Array<CreatedRecord> })
      .__createdRecords;
  });
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();

  expect(box).not.toBeNull();

  return box as Box;
}

/*
 * The template rows. Scoped to the list: the category select's own <option>s
 * are options too.
 */
function templateOptions(dialog: Locator): Locator {
  return dialog.getByRole("listbox").getByRole("option");
}

function templateRow(dialog: Locator, name: string): Locator {
  return dialog
    .getByRole("listbox")
    .getByRole("option", { name: name, exact: true });
}

function submitButton(dialog: Locator): Locator {
  return dialog.getByTestId("modal-footer-submit-button");
}

test.describe("Create a workflow", () => {
  test("opens on Start from scratch: first, focused, and the only way on until a template is picked", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDialog(page);
    const scratch: Locator = dialog.getByTestId("workflow-start-from-scratch");

    await expect(scratch).toBeFocused();
    await expect(scratch).toContainText("Start from scratch");
    await expect(templateOptions(dialog)).toHaveCount(RECOMMENDED_COUNT);
    await expect(dialog.getByTestId("workflow-template-details")).toHaveCount(
      0,
    );
    // The footer holds Cancel alone until a template is picked.
    await expect(submitButton(dialog)).toHaveCount(0);
    await expect(dialog.getByTestId("modal-footer-close-button")).toBeVisible();

    // Start from scratch sits above the templates, and spans the step.
    const scratchBox: Box = await boxOf(scratch);
    const headingBox: Box = await boxOf(
      dialog.getByRole("heading", { name: "Or start from a template" }),
    );
    const listBox: Box = await boxOf(dialog.getByRole("listbox"));

    expect(scratchBox.y + scratchBox.height).toBeLessThanOrEqual(headingBox.y);
    expect(scratchBox.width).toBeGreaterThanOrEqual(listBox.width - 1);
  });

  test("Enter on Start from scratch, a name, and Create Workflow: an empty workflow, switched off, and the builder opens", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDialog(page);

    await page.keyboard.press("Enter");

    const name: Locator = dialog.getByTestId("workflow-name-input");

    await expect(name).toBeFocused();
    await expect(name).toHaveValue("");

    await page.keyboard.type("Page the on-call team");
    await expect(submitButton(dialog)).toHaveText("Create Workflow");
    await submitButton(dialog).click();

    await expect(page.getByTestId("created-workflow")).toHaveText(
      "Opened the builder for Page the on-call team",
    );
    await expect(dialog).toHaveCount(0);

    expect(await createdRecords(page)).toEqual([
      {
        kind: "workflow",
        name: "Page the on-call team",
        description: "",
        isEnabled: false,
        projectId: PROJECT_ID,
        graph: { nodes: [], edges: [] },
      },
    ]);
  });

  test("a template: a click opens its details in its row and brings Use this template; its setting is saved as a secret variable", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDialog(page);
    const row: Locator = templateRow(dialog, SLACK_TEMPLATE_NAME);

    await row.click();

    await expect(row).toHaveAttribute("aria-selected", "true");

    const details: Locator = row.getByTestId("workflow-template-details");

    await expect(details).toBeVisible();
    await expect(
      details.getByTestId("workflow-template-details-trigger"),
    ).toContainText("On Create Incident");
    await expect(
      details.getByTestId("workflow-template-details-setting-slackWebhookUrl"),
    ).toContainText("Slack Incoming Webhook URL");
    // One template open at a time, and only the one picked.
    await expect(dialog.getByTestId("workflow-template-details")).toHaveCount(
      1,
    );

    await expect(submitButton(dialog)).toHaveText("Use this template");
    await submitButton(dialog).click();

    await expect(dialog.getByTestId("workflow-name-input")).toHaveValue(
      SLACK_WORKFLOW_NAME,
    );
    await expect(submitButton(dialog)).toHaveText("Next");
    await submitButton(dialog).click();

    const webhook: Locator = dialog.getByTestId(
      "workflow-variable-slackWebhookUrl",
    );

    // The Configure step is for its fields: the first one has the focus.
    await expect(webhook).toBeFocused();
    await expect(webhook).toHaveAttribute("type", "password");
    await page.keyboard.type(SLACK_WEBHOOK_URL);
    await expect(submitButton(dialog)).toHaveText("Create Workflow");
    await submitButton(dialog).click();

    await expect(page.getByTestId("created-workflow")).toHaveText(
      `Opened the builder for ${SLACK_WORKFLOW_NAME}`,
    );

    const records: Array<CreatedRecord> = await createdRecords(page);

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      kind: "workflow",
      name: SLACK_WORKFLOW_NAME,
      isEnabled: false,
      projectId: PROJECT_ID,
    });
    expect(records[0]?.graph?.nodes.length).toBeGreaterThan(1);
    expect(records[1]).toEqual({
      kind: "variable",
      name: "slackWebhookUrl",
      content: SLACK_WEBHOOK_URL,
      isSecret: true,
      workflowId: CREATED_WORKFLOW_ID,
    });
  });

  test("search: '/' jumps to it, typing picks and opens the best match, and Enter uses it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDialog(page);
    const search: Locator = dialog.getByRole("combobox", {
      name: "Search templates…",
    });

    await page.keyboard.press("/");
    await expect(search).toBeFocused();
    await expect(search).toHaveValue("");

    await page.keyboard.type("discord");

    const discord: Locator = templateRow(
      dialog,
      "Tell Discord when an incident opens",
    );

    await expect(templateOptions(dialog)).toHaveCount(1);
    await expect(discord).toHaveAttribute("aria-selected", "true");
    await expect(
      discord.getByTestId("workflow-template-details"),
    ).toBeVisible();
    // A search looks through every template.
    await expect(
      dialog.getByTestId("workflow-template-view-select"),
    ).toHaveValue("all");

    await page.keyboard.press("Enter");

    await expect(dialog.getByTestId("workflow-name-input")).toHaveValue(
      "Notify Discord on new incident",
    );
  });

  test("the arrow keys pick a template from the search box, and Escape clears the search before it closes the dialog", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDialog(page);
    const search: Locator = dialog.getByRole("combobox", {
      name: "Search templates…",
    });

    await search.click();
    await page.keyboard.press("ArrowDown");

    const first: Locator = templateOptions(dialog).first();

    await expect(first).toHaveAttribute("aria-selected", "true");
    await expect(first.getByTestId("workflow-template-details")).toBeVisible();
    await expect(search).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(templateOptions(dialog).nth(1)).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.keyboard.type("slack");
    await expect(search).toHaveValue("slack");
    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("a search that finds nothing says so, and Start from scratch is still the way on", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDialog(page);

    await dialog
      .getByRole("combobox", { name: "Search templates…" })
      .fill("pagerduty");

    await expect(dialog.getByTestId("workflow-template-empty")).toContainText(
      "No templates match your search.",
    );
    await expect(templateOptions(dialog)).toHaveCount(0);
    await expect(submitButton(dialog)).toHaveCount(0);
    await expect(
      dialog.getByTestId("workflow-start-from-scratch"),
    ).toBeVisible();

    await dialog.getByTestId("workflow-template-empty-clear").click();
    await expect(templateOptions(dialog)).toHaveCount(RECOMMENDED_COUNT);
  });

  test("the category select: Jira lists its incident templates, then its alert templates, under their own headings", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDialog(page);

    await dialog
      .getByTestId("workflow-template-view-select")
      .selectOption("Jira");

    const listbox: Locator = dialog.getByRole("listbox");

    await expect(listbox.getByRole("option")).toHaveCount(17);
    await expect(listbox.getByRole("group")).toHaveCount(2);
    await expect(
      listbox.getByRole("group", { name: "Incidents" }).getByRole("option"),
    ).toHaveCount(9);
    await expect(
      listbox.getByRole("group", { name: "Alerts" }).getByRole("option"),
    ).toHaveCount(8);
    // Nothing is picked on a new list: no details, no Use this template.
    await expect(dialog.getByTestId("workflow-template-details")).toHaveCount(
      0,
    );
    await expect(submitButton(dialog)).toHaveCount(0);
  });

  test("Back from Name keeps the template picked, its details open, and the focus on the list", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDialog(page);

    await templateRow(dialog, SLACK_TEMPLATE_NAME).dblclick();
    await expect(dialog.getByTestId("workflow-name-input")).toHaveValue(
      SLACK_WORKFLOW_NAME,
    );

    await dialog.getByTestId("workflow-wizard-back").click();

    const row: Locator = templateRow(dialog, SLACK_TEMPLATE_NAME);

    await expect(row).toHaveAttribute("aria-selected", "true");
    await expect(row.getByTestId("workflow-template-details")).toBeVisible();
    await expect(dialog.getByRole("listbox")).toBeFocused();
    await expect(submitButton(dialog)).toHaveText("Use this template");
  });

  test("a setting that cannot be saved takes the new workflow away again, and says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDialog(page, "&failVariables=true");

    await templateRow(dialog, SLACK_TEMPLATE_NAME).click();
    await submitButton(dialog).click();
    await submitButton(dialog).click();
    await dialog
      .getByTestId("workflow-variable-slackWebhookUrl")
      .fill(SLACK_WEBHOOK_URL);
    await submitButton(dialog).click();

    await expect(dialog).toContainText("The server refused this setting.");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("created-workflow")).toHaveCount(0);

    const records: Array<CreatedRecord> = await createdRecords(page);

    expect(
      records.map((record: CreatedRecord): string => {
        return record.kind;
      }),
    ).toEqual(["workflow", "deleted"]);
    expect(records[1]?.id).toBe(CREATED_WORKFLOW_ID);
  });

  test("it fits the window with no sideways scroll, and lays the search out for the width", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDialog(page);

    await templateRow(dialog, SLACK_TEMPLATE_NAME).click();

    const viewport: { width: number; height: number } = page.viewportSize()!;
    const dialogBox: Box = await boxOf(dialog);

    expect(
      await page.evaluate((): number => {
        return (
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
        );
      }),
    ).toBeLessThanOrEqual(0);
    expect(dialogBox.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(
      viewport.width + 1,
    );
    expect(dialogBox.height).toBeLessThanOrEqual(viewport.height);

    const heading: Box = await boxOf(
      dialog.getByRole("heading", { name: "Or start from a template" }),
    );
    const search: Box = await boxOf(
      dialog.getByRole("combobox", { name: "Search templates…" }),
    );
    const select: Box = await boxOf(
      dialog.getByTestId("workflow-template-view-select"),
    );
    const center: (box: Box) => number = (box: Box): number => {
      return box.y + box.height / 2;
    };

    if (viewport.width >= 640) {
      // One row: the heading, the search and the select.
      expect(Math.abs(center(search) - center(heading))).toBeLessThan(12);
      expect(Math.abs(center(select) - center(heading))).toBeLessThan(12);
      expect(search.x).toBeGreaterThan(heading.x + heading.width);
    } else {
      // A phone: the select beside the heading, the search on a row of its own.
      expect(search.y).toBeGreaterThanOrEqual(heading.y + heading.height - 1);
      expect(search.width).toBeGreaterThan(viewport.width * 0.7);
      expect(select.y + select.height).toBeLessThanOrEqual(search.y + 1);
    }

    // The details open inside the picked row, not in a column beside it.
    const row: Locator = templateRow(dialog, SLACK_TEMPLATE_NAME);
    const rowBox: Box = await boxOf(row);
    const detailsBox: Box = await boxOf(
      row.getByTestId("workflow-template-details"),
    );

    expect(detailsBox.x).toBeGreaterThanOrEqual(rowBox.x);
    expect(detailsBox.x + detailsBox.width).toBeLessThanOrEqual(
      rowBox.x + rowBox.width + 1,
    );
    expect(detailsBox.y).toBeGreaterThan(rowBox.y);
  });

  test("in the dark theme, nothing in it is left white", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDialog(page, "&theme=dark");

    await templateRow(dialog, SLACK_TEMPLATE_NAME).click();

    const backgroundOf: (locator: Locator) => Promise<string> = async (
      locator: Locator,
    ): Promise<string> => {
      return locator.evaluate((element: Element): string => {
        return window.getComputedStyle(element).backgroundColor;
      });
    };

    const surfaces: Array<Locator> = [
      dialog,
      dialog.getByTestId("workflow-start-from-scratch"),
      dialog.getByRole("combobox", { name: "Search templates…" }),
      dialog.getByTestId("workflow-template-view-select"),
      templateRow(dialog, SLACK_TEMPLATE_NAME),
      dialog.getByTestId("workflow-template-details-trigger").first(),
    ];

    for (const surface of surfaces) {
      expect(await backgroundOf(surface)).not.toBe("rgb(255, 255, 255)");
    }
  });
});
