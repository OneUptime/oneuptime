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

// Create Workflow: the wizard's one primary button, on its last step only.
function submitButton(dialog: Locator): Locator {
  return dialog.getByTestId("modal-footer-submit-button");
}

/*
 * The plain way on before the last step: Use this template on the picker,
 * Next on a Name step that has Configure after it.
 */
function nextButton(dialog: Locator): Locator {
  return dialog.getByTestId("modal-footer-next-button");
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
    await expect(nextButton(dialog)).toHaveCount(0);
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

    // Plain: it only walks on. Create Workflow is the one primary button.
    await expect(nextButton(dialog)).toHaveText("Use this template");
    await expect(submitButton(dialog)).toHaveCount(0);
    await nextButton(dialog).click();

    await expect(dialog.getByTestId("workflow-name-input")).toHaveValue(
      SLACK_WORKFLOW_NAME,
    );
    await expect(nextButton(dialog)).toHaveText("Next");
    await expect(submitButton(dialog)).toHaveCount(0);
    await nextButton(dialog).click();

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
    await expect(nextButton(dialog)).toHaveCount(0);
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
    await expect(nextButton(dialog)).toHaveCount(0);
  });

  /*
   * A paging template asks who to page in this dialog, the step after Name:
   * one of the project's own schedules, teams, policies or people, which no
   * template can name. Its details list it under What you'll need; the
   * dialog does not create the workflow until somebody is picked; and the
   * workflow it creates holds the pick on its Page step, so the Builder
   * opens on it with nothing left to set up - where it used to open with
   * "1 error", the Page step waiting for who to page.
   */
  test("a paging template asks who to page after Name, does not create the workflow without it, and saves the pick on its Page step", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDialog(page);

    await dialog
      .getByTestId("workflow-template-view-select")
      .selectOption("On-Call");

    const row: Locator = templateRow(
      dialog,
      "Page whoever is on call when a critical incident is created",
    );

    await row.click();

    const details: Locator = row.getByTestId("workflow-template-details");
    const needs: Locator = details.getByTestId(
      "workflow-template-details-who-to-page-page-on-call-1",
    );

    await expect(needs).toHaveText("Who to page for critical incidents");
    await expect(
      details.getByTestId("workflow-template-details-in-builder"),
    ).toHaveCount(0);
    await expect(
      details.getByTestId("workflow-template-details-no-settings"),
    ).toHaveCount(0);
    // Its two steps after the trigger, and no Log on an Error output.
    await expect(
      details.getByTestId("workflow-template-details-step"),
    ).toHaveCount(2);
    await expect(
      details.getByTestId("workflow-template-details-step"),
    ).toContainText(["If / Else", "Page Whoever Is On Call"]);

    // Inside its row, at a laptop's width and at a phone's.
    const rowBox: Box = await boxOf(row);
    const needsBox: Box = await boxOf(needs);

    expect(needsBox.x).toBeGreaterThanOrEqual(rowBox.x);
    expect(needsBox.x + needsBox.width).toBeLessThanOrEqual(
      rowBox.x + rowBox.width + 0.5,
    );

    await nextButton(dialog).click();
    await expect(dialog.getByTestId("workflow-name-input")).toHaveValue(
      "Page on-call for critical incidents",
    );
    await nextButton(dialog).click();

    // The last step asks who to page, and nothing else.
    const question: Locator = dialog.getByTestId(
      "workflow-who-to-page-page-on-call-1",
    );

    await expect(question).toBeVisible();
    await expect(dialog).toContainText(
      "Page whoever is on call when a critical incident is created pages people in this project. Pick who it pages here, or change it later on its Page step in the Builder.",
    );
    await expect(
      dialog.locator("#workflow-who-to-page-page-on-call-1-label"),
    ).toContainText("Who to page for critical incidents");

    // Nobody picked: the dialog says so where the question is, and creates nothing.
    await submitButton(dialog).click();
    await expect(dialog).toContainText("Pick who to page.");
    expect(await createdRecords(page)).toEqual([]);

    await question
      .getByRole("button", { name: "Add on-call schedule" })
      .click();

    const list: Locator = page.getByRole("dialog", {
      name: "Add on-call schedule",
    });

    await list.getByText("Primary", { exact: true }).click();
    await expect(question.getByTestId("people-chip")).toHaveCount(1);
    // Escape closes the list, not the dialog.
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText("Pick who to page.");

    await submitButton(dialog).click();

    await expect(page.getByTestId("created-workflow")).toHaveText(
      "Opened the builder for Page on-call for critical incidents",
    );

    const records: Array<CreatedRecord> = await createdRecords(page);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      kind: "workflow",
      name: "Page on-call for critical incidents",
      isEnabled: false,
      projectId: PROJECT_ID,
    });

    type StoredNode = {
      data?: { metadataId?: string; arguments?: Record<string, unknown> };
    };

    const pageSteps: Array<StoredNode> = (
      (records[0]?.graph?.nodes || []) as Array<StoredNode>
    ).filter((node: StoredNode): boolean => {
      return node.data?.metadataId === "page-on-call";
    });

    expect(pageSteps).toHaveLength(1);
    // About the incident that started it, and paging the schedule picked.
    expect(pageSteps[0]?.data?.arguments).toMatchObject({
      about: "incident",
      "on-call-schedules": ["5c4e0000-0000-4000-8000-000000000001"],
    });
  });

  /*
   * A Jira template that links the issue in what it writes asks first for
   * the site that link goes to: the address people open Jira at, apart from
   * the Jira API URL the requests go to. A page's address pasted from the
   * address bar is refused where it is typed, saying what to type, and
   * nothing is created; a site's address, with the slash an address bar
   * ends it with, is saved as typed.
   */
  test("a Jira template that links the issue asks for the Jira Site URL first, refuses a page's address there, and saves a site's", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDialog(page);

    await dialog
      .getByTestId("workflow-template-view-select")
      .selectOption("Jira");
    await templateRow(
      dialog,
      "Add Jira comments to the incident as private notes",
    ).click();
    await nextButton(dialog).click();
    await expect(dialog.getByTestId("workflow-name-input")).toHaveValue(
      "Copy Jira comments to incident",
    );
    await nextButton(dialog).click();

    const site: Locator = dialog.getByTestId("workflow-variable-jiraSiteUrl");
    const api: Locator = dialog.getByTestId("workflow-variable-jiraBaseUrl");
    const token: Locator = dialog.getByTestId(
      "workflow-variable-jiraBasicAuthToken",
    );
    const message: string =
      "Enter only your Jira site's address, such as https://your-company.atlassian.net, not a page in it. On Jira Data Center, enter its base URL, such as https://example.com/jira.";

    // The site first, and focused: the address people know best.
    await expect(site).toBeFocused();
    await expect(
      dialog.locator('label[for="workflow-variable-jiraSiteUrl"]'),
    ).toHaveText("Jira Site URL");
    await expect(
      dialog.locator('label[for="workflow-variable-jiraBaseUrl"]'),
    ).toHaveText("Jira API URL");
    expect((await boxOf(site)).y).toBeLessThan((await boxOf(api)).y);
    expect((await boxOf(api)).y).toBeLessThan((await boxOf(token)).y);
    await expect(site).toHaveAttribute("type", "text");

    /*
     * Typed once: the Jira API URL takes the site's address until it is
     * typed into, without the slash the site may end with.
     */
    await site.fill("https://acme.atlassian.net/");
    await expect(api).toHaveValue("https://acme.atlassian.net");
    await site.fill("https://acme.atlassian.net/jira/your-work");
    await expect(api).toHaveValue("https://acme.atlassian.net/jira/your-work");
    await api.fill("https://acme.atlassian.net");
    await token.fill("cHJpeWFAYWNtZS5jb206QVRBVFQzeEZmR0YwUzNjcjN0");
    await submitButton(dialog).click();

    await expect(dialog).toContainText(message);
    await expect(site).toHaveAttribute("aria-invalid", "true");
    expect(await createdRecords(page)).toEqual([]);

    // The Configure step fits a phone's width as well as a laptop's.
    expect(
      await page.evaluate((): number => {
        return (
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
        );
      }),
    ).toBeLessThanOrEqual(0);

    await site.fill("https://acme.atlassian.net/");
    await expect(dialog).not.toContainText(message);
    // Typed into, the Jira API URL keeps what was typed there.
    await expect(api).toHaveValue("https://acme.atlassian.net");
    await submitButton(dialog).click();

    await expect(page.getByTestId("created-workflow")).toHaveText(
      "Opened the builder for Copy Jira comments to incident",
    );

    const records: Array<CreatedRecord> = await createdRecords(page);

    expect(
      records.map((record: CreatedRecord): string => {
        return `${record.kind} ${record.name}`;
      }),
    ).toEqual([
      "workflow Copy Jira comments to incident",
      "variable jiraSiteUrl",
      "variable jiraBaseUrl",
      "variable jiraBasicAuthToken",
    ]);
    expect(records[1]).toEqual({
      kind: "variable",
      name: "jiraSiteUrl",
      content: "https://acme.atlassian.net/",
      isSecret: false,
      workflowId: CREATED_WORKFLOW_ID,
    });
    // The script that writes the note is handed the site by reference.
    expect(JSON.stringify(records[0]?.graph)).toContain(
      "{{local.variables.jiraSiteUrl}}",
    );
    expect(JSON.stringify(records[0]?.graph)).not.toContain(
      "acme.atlassian.net",
    );
  });

  /*
   * Zabbix, like Jira: the workflow its problems come to, and the two that
   * write back to Zabbix, for incidents and then for alerts, each set under
   * its own heading.
   */
  test("the category select: Zabbix lists its three incident templates, then its three alert templates, under their own headings", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDialog(page);

    await dialog
      .getByTestId("workflow-template-view-select")
      .selectOption("Zabbix");

    const listbox: Locator = dialog.getByRole("listbox");

    await expect(listbox.getByRole("option")).toHaveCount(6);
    await expect(listbox.getByRole("group")).toHaveCount(2);

    const incidents: Locator = listbox
      .getByRole("group", { name: "Incidents" })
      .getByRole("option");
    const alerts: Locator = listbox
      .getByRole("group", { name: "Alerts" })
      .getByRole("option");

    await expect(incidents).toHaveCount(3);
    await expect(alerts).toHaveCount(3);
    // The workflow Zabbix sends its problems to comes first in each.
    await expect(incidents.first()).toContainText(
      "Declare an incident for each Zabbix problem",
    );
    await expect(alerts.first()).toContainText(
      "Create an alert for each Zabbix problem",
    );
    await expect(dialog.getByTestId("workflow-template-details")).toHaveCount(
      0,
    );
  });

  /*
   * The workflow Zabbix sends its problems to asks for one setting, the
   * address its links to a problem go to, and who to page for High and
   * Disaster problems, which it may leave empty. A page's address pasted
   * from the address bar is refused where it is typed, and nothing is
   * created; the address Zabbix is opened at, under a path and with the
   * slash an address bar ends it with, is saved as typed. With nobody
   * picked, the workflow is created without its Page step and the If / Else
   * only that step needs, so nothing in it waits to be set up.
   */
  test("the Zabbix problems template asks for the Zabbix URL and, optionally, who to page, refuses a page's address there, and with nobody picked leaves the Page step out", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDialog(page);

    await dialog
      .getByTestId("workflow-template-view-select")
      .selectOption("Zabbix");

    const row: Locator = templateRow(
      dialog,
      "Declare an incident for each Zabbix problem",
    );

    await row.click();

    const details: Locator = row.getByTestId("workflow-template-details");

    await expect(
      details.getByTestId("workflow-template-details-trigger"),
    ).toContainText("Webhook");
    await expect(
      details.getByTestId("workflow-template-details-setting-zabbixUrl"),
    ).toContainText("Zabbix URL");
    const whoToPage: Locator = details.getByTestId(
      "workflow-template-details-who-to-page-page-on-call-policy-1",
    );

    await expect(whoToPage).toContainText(
      "Who to page for High and Disaster problems",
    );
    await expect(whoToPage).toContainText("(Optional)");
    await expect(
      details.getByTestId("workflow-template-details-in-builder"),
    ).toHaveCount(0);

    await nextButton(dialog).click();
    await expect(dialog.getByTestId("workflow-name-input")).toHaveValue(
      "Zabbix problems to incidents",
    );
    await nextButton(dialog).click();

    const url: Locator = dialog.getByTestId("workflow-variable-zabbixUrl");
    const message: string =
      "Enter only the address you open Zabbix at, such as https://zabbix.example.com, not a page in it.";

    await expect(url).toBeFocused();
    await expect(url).toHaveAttribute("type", "text");
    await expect(
      dialog.locator('label[for="workflow-variable-zabbixUrl"]'),
    ).toHaveText("Zabbix URL");
    await expect(
      dialog.getByTestId("workflow-variable-zabbixApiToken"),
    ).toHaveCount(0);
    // Who to page comes after the settings, and is kept on the Page step.
    await expect(dialog.getByTestId("workflow-who-to-page-intro")).toHaveText(
      "Who it pages is kept on its Page step, where you can change it later in the Builder.",
    );
    await expect(
      dialog.getByTestId("workflow-who-to-page-page-on-call-policy-1"),
    ).toBeVisible();

    await url.fill("https://example.com/zabbix/zabbix.php?action=problem.view");
    await submitButton(dialog).click();

    await expect(dialog).toContainText(message);
    await expect(url).toHaveAttribute("aria-invalid", "true");
    expect(await createdRecords(page)).toEqual([]);

    await url.fill("https://example.com/zabbix/");
    await expect(dialog).not.toContainText(message);
    await submitButton(dialog).click();

    await expect(page.getByTestId("created-workflow")).toHaveText(
      "Opened the builder for Zabbix problems to incidents",
    );

    const records: Array<CreatedRecord> = await createdRecords(page);

    expect(
      records.map((record: CreatedRecord): string => {
        return `${record.kind} ${record.name}`;
      }),
    ).toEqual(["workflow Zabbix problems to incidents", "variable zabbixUrl"]);
    expect(records[0]).toMatchObject({
      isEnabled: false,
      projectId: PROJECT_ID,
    });
    expect(records[1]).toEqual({
      kind: "variable",
      name: "zabbixUrl",
      content: "https://example.com/zabbix/",
      isSecret: false,
      workflowId: CREATED_WORKFLOW_ID,
    });

    type StoredNode = {
      data?: { metadataId?: string; arguments?: Record<string, unknown> };
    };

    const nodes: Array<StoredNode> = (records[0]?.graph?.nodes ||
      []) as Array<StoredNode>;
    const pageSteps: Array<StoredNode> = nodes.filter(
      (node: StoredNode): boolean => {
        return node.data?.metadataId === "page-on-call-policy";
      },
    );

    expect(
      nodes.filter((node: StoredNode): boolean => {
        return node.data?.metadataId === "webhook";
      }),
    ).toHaveLength(1);
    // Nobody picked: no Page step, and not the If / Else in front of it.
    expect(pageSteps).toHaveLength(0);
    expect(
      nodes.map((node: StoredNode): string => {
        return node.data?.metadataId || "";
      }),
    ).toEqual(["webhook", "javascript-check", "incident-from-another-tool"]);
  });

  /*
   * The two that call Zabbix ask for its URL and an API token: the token is
   * masked, refused unless it is a token's 64 characters - a session ID or
   * a token typed with "Bearer" is the usual slip - and saved as the one
   * secret variable.
   */
  test("a Zabbix template that calls Zabbix asks for its URL and its API token, refuses what is not a token, and saves only the token as a secret", async ({
    page,
  }: {
    page: Page;
  }) => {
    const token: string =
      "bbcfce79a2d95037502f7e9a534906d3466c9a1484beb6ea0f4e7be28e8b8ce2";
    const dialog: Locator = await openDialog(page);

    await dialog
      .getByTestId("workflow-template-view-select")
      .selectOption("Zabbix");
    await templateRow(
      dialog,
      "Acknowledge or close the Zabbix problem with the alert",
    ).click();
    await nextButton(dialog).click();
    await expect(dialog.getByTestId("workflow-name-input")).toHaveValue(
      "Sync alert state to Zabbix",
    );
    await nextButton(dialog).click();

    const url: Locator = dialog.getByTestId("workflow-variable-zabbixUrl");
    const secret: Locator = dialog.getByTestId(
      "workflow-variable-zabbixApiToken",
    );
    const message: string =
      "Paste the 64-character API token Zabbix showed when you created it.";

    await expect(url).toBeFocused();
    expect((await boxOf(url)).y).toBeLessThan((await boxOf(secret)).y);
    await expect(secret).toHaveAttribute("type", "password");

    await url.fill("https://zabbix.example.com");
    await secret.fill(`Bearer ${token}`);
    await submitButton(dialog).click();

    await expect(dialog).toContainText(message);
    await expect(secret).toHaveAttribute("aria-invalid", "true");
    expect(await createdRecords(page)).toEqual([]);

    await secret.fill(token);
    await expect(dialog).not.toContainText(message);
    await submitButton(dialog).click();

    await expect(page.getByTestId("created-workflow")).toHaveText(
      "Opened the builder for Sync alert state to Zabbix",
    );

    const records: Array<CreatedRecord> = await createdRecords(page);

    expect(records.slice(1)).toEqual([
      {
        kind: "variable",
        name: "zabbixUrl",
        content: "https://zabbix.example.com",
        isSecret: false,
        workflowId: CREATED_WORKFLOW_ID,
      },
      {
        kind: "variable",
        name: "zabbixApiToken",
        content: token,
        isSecret: true,
        workflowId: CREATED_WORKFLOW_ID,
      },
    ]);
    // The workflow reads the token by reference, and never holds it: Update Zabbix Problem sends it.
    const graph: string = JSON.stringify(records[0]?.graph);

    type StoredNode = {
      data?: { metadataId?: string; arguments?: Record<string, unknown> };
    };

    const update: StoredNode | undefined = (
      (records[0]?.graph?.nodes || []) as Array<StoredNode>
    ).find((node: StoredNode): boolean => {
      return node.data?.metadataId === "zabbix-update-problem";
    });

    expect(update?.data?.arguments?.["api-token"]).toBe(
      "{{local.variables.zabbixApiToken}}",
    );
    expect(graph).not.toContain(token);
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
    await expect(nextButton(dialog)).toHaveText("Use this template");
  });

  test("a setting that cannot be saved takes the new workflow away again, and says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDialog(page, "&failVariables=true");

    await templateRow(dialog, SLACK_TEMPLATE_NAME).click();
    // Use this template, then Next: both plain, before the last step.
    await nextButton(dialog).click();
    await expect(dialog.getByTestId("workflow-name-input")).toBeVisible();
    await nextButton(dialog).click();
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

  /*
   * Enter in the name goes on, as the footer's button does - here Create
   * Workflow, for a start from scratch - as it does in Create a dashboard,
   * which shares the step. It did nothing before.
   */
  test("without the mouse: Enter on Start from scratch, a name, and Enter create the workflow", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDialog(page);

    await page.keyboard.press("Enter");
    await expect(dialog.getByTestId("workflow-name-input")).toBeFocused();
    await page.keyboard.type("Page the on-call");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("created-workflow")).toBeVisible();
    expect(
      (await createdRecords(page)).map((record: CreatedRecord): string => {
        return record.kind;
      }),
    ).toEqual(["workflow"]);
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

    if (viewport.width >= 1024) {
      // One row: the heading, the search and the select.
      expect(Math.abs(center(search) - center(heading))).toBeLessThan(12);
      expect(Math.abs(center(select) - center(heading))).toBeLessThan(12);
      expect(search.x).toBeGreaterThan(heading.x + heading.width);
    } else {
      /*
       * A phone: one under the other, each as wide as the list, so the
       * heading keeps one line. Beside it, the select - as wide as its
       * longest category - pushed the heading into two lines, or three.
       */
      expect(search.y).toBeGreaterThanOrEqual(heading.y + heading.height - 1);
      expect(select.y).toBeGreaterThanOrEqual(search.y + search.height - 1);
      expect(search.width).toBeGreaterThan(viewport.width * 0.7);
      expect(Math.abs(select.width - search.width)).toBeLessThanOrEqual(1);
      expect(heading.height).toBeLessThanOrEqual(30);
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
