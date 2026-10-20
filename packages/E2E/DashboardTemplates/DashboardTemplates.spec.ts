import { expect, Locator, Page, TestInfo, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Create a dashboard, in a real browser, with the real template catalog,
 * beside the Create a workflow dialog it was made to work like.
 *
 * The maintainer: "The workflow templates model is a lot easier to
 * understand and use. Please make the dashboard templates model like
 * workflow templates." Create Dashboard used to open Create from Template,
 * sixteen equally large cards in four groups that ran past the dialog, a
 * click on any card going straight on to a second dialog. It now opens one
 * dialog drawn with the shared template picker: Start from scratch first, a
 * few recommended templates as one-line rows, a search and a category
 * select, a template's details in its row once it is picked, Use this
 * template, then a Name step.
 *
 * jsdom covers the behaviour (packages/Common: DashboardTemplatePicker,
 * CreateDashboardModal, DashboardCreateFromTemplate); this covers what only
 * a browser shows - real focus and keys, real layout at a laptop's and a
 * phone's width, the real dark theme - and holds the dialog to Create a
 * workflow's look, measured side by side. The fixture page
 * (DashboardTemplates/Fixture) leaves out only the server: what the dialog
 * would create is read from window.__fixture.created.
 */

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/dashboard-templates-ui",
);

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000d1";

const RECOMMENDED: Array<string> = [
  "Monitor Dashboard",
  "Incident Dashboard",
  "Alert Dashboard",
  "Kubernetes Dashboard",
  "Hosts Dashboard",
  "Metrics Dashboard",
];

// Every template the picker lists, by its type, as the catalog orders them.
const TEMPLATES: Array<{ type: string; name: string }> = [
  { type: "Monitor", name: "Monitor Dashboard" },
  { type: "Metrics", name: "Metrics Dashboard" },
  { type: "Rum", name: "Real User Monitoring Dashboard" },
  { type: "Slo", name: "SLO Dashboard" },
  { type: "Incident", name: "Incident Dashboard" },
  { type: "Alert", name: "Alert Dashboard" },
  { type: "Kubernetes", name: "Kubernetes Dashboard" },
  { type: "KubernetesCost", name: "Kubernetes Cost Dashboard" },
  { type: "Host", name: "Hosts Dashboard" },
  { type: "Proxmox", name: "Proxmox Dashboard" },
  { type: "VMware", name: "VMware Dashboard" },
  { type: "Ceph", name: "Ceph Dashboard" },
  { type: "StorageArray", name: "Storage Array Dashboard" },
  { type: "DockerSwarm", name: "Docker Swarm Dashboard" },
  { type: "Network", name: "Network Dashboard" },
];

interface CreatedRecord {
  kind: "dashboard" | "workflow" | "variable";
  name?: string;
  description?: string | null;
  projectId?: string | null;
  templateType?: string | null;
}

interface FixtureRecord {
  created: Array<CreatedRecord>;
  namesRequests: number;
  unmodelled: Array<string>;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
  page.on("console", (message: { type: () => string; text: () => string }) => {
    // React's own warnings (invalid nesting, keys) are errors here.
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  // Nothing leaves the fixture server.
  await page.route(
    (url: URL): boolean => {
      return url.hostname !== "127.0.0.1";
    },
    async (route: { abort: () => Promise<void> }) => {
      errors.push("A request left the fixture server.");
      await route.abort();
    },
  );
});

test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
  // A skipped test never opened the fixture.
  if (testInfo.status === "skipped") {
    return;
  }

  expect(pageErrors.get(page) || []).toEqual([]);
  // Every read the dialog made is one the fixture answers as the API does.
  expect((await fixture(page)).unmodelled).toEqual([]);
});

async function fixture(page: Page): Promise<FixtureRecord> {
  return await page.evaluate((): FixtureRecord => {
    return (window as unknown as { __fixture: FixtureRecord }).__fixture;
  });
}

async function created(page: Page): Promise<Array<CreatedRecord>> {
  return (await fixture(page)).created;
}

async function openDashboardDialog(
  page: Page,
  query: string = "",
): Promise<Locator> {
  await page.goto(`/?page=create-dashboard${query}`);
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await page.getByTestId("create-dashboard").click();

  const dialog: Locator = page.getByRole("dialog");

  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("dashboard-template-picker")).toBeVisible();

  return dialog;
}

async function openWorkflowDialog(
  page: Page,
  query: string = "",
): Promise<Locator> {
  await page.goto(`/?page=create-workflow${query}`);
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await page.getByTestId("create-workflow").click();

  const dialog: Locator = page.getByRole("dialog", {
    name: "Create a workflow",
  });

  await expect(dialog.getByTestId("workflow-template-picker")).toBeVisible();

  return dialog;
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
function templateRows(dialog: Locator): Locator {
  return dialog.getByRole("listbox").getByRole("option");
}

function templateRow(dialog: Locator, name: string): Locator {
  return dialog
    .getByRole("listbox")
    .getByRole("option", { name: name, exact: true });
}

// Create Dashboard: the dialog's one primary button, on the Name step only.
function createButton(dialog: Locator): Locator {
  return dialog.getByTestId("modal-footer-submit-button");
}

// Use this template: the plain way on from the picker.
function useButton(dialog: Locator): Locator {
  return dialog.getByTestId("modal-footer-next-button");
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.getByRole("dialog").screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    animations: "disabled",
  });
}

function widthName(page: Page): string {
  return (page.viewportSize()?.width || 0) < 640 ? "390" : "1280";
}

// The heading's line, text-sm: a box this tall, or a little more, is one line.
const LINE_HEIGHT: number = 20;

// Every language the Dashboard speaks (Dashboard/src/Locales), English first.
const LANGUAGES: Array<string> = [
  "en",
  "da",
  "de",
  "es",
  "fa",
  "fr",
  "hi",
  "it",
  "ja",
  "ko",
  "nl",
  "no",
  "pt",
  "ru",
  "sv",
  "zh-CN",
  "zh-TW",
];

interface PromptFit {
  prompt: string;
  // How wide the prompt is drawn, in the box's own font.
  promptWidth: number;
  // The room the box leaves for it, between its paddings.
  room: number;
}

// How wide a search box's prompt is, and how much room the box gives it.
async function promptFit(search: Locator): Promise<PromptFit> {
  return await search.evaluate((element: Element): PromptFit => {
    const input: HTMLInputElement = element as HTMLInputElement;
    const style: CSSStyleDeclaration = window.getComputedStyle(input);
    const context: CanvasRenderingContext2D = document
      .createElement("canvas")
      .getContext("2d") as CanvasRenderingContext2D;

    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

    return {
      prompt: input.placeholder,
      promptWidth: context.measureText(input.placeholder).width,
      room:
        input.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight),
    };
  });
}

test.describe("Create a dashboard", () => {
  test("opens on Start from scratch: first, focused, and the six recommended templates as one-line rows", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDashboardDialog(page);
    const scratch: Locator = dialog.getByTestId("dashboard-start-from-scratch");

    await expect(dialog).toHaveAccessibleName("Create a dashboard");
    await expect(scratch).toBeFocused();
    await expect(scratch).toContainText("Start from scratch");
    await expect(scratch).toContainText(
      "Begin with an empty dashboard and add your own widgets.",
    );
    await expect(templateRows(dialog)).toHaveCount(RECOMMENDED.length);
    await expect(templateRows(dialog)).toContainText(RECOMMENDED);
    // The footer holds Cancel alone until a template is picked.
    await expect(createButton(dialog)).toHaveCount(0);
    await expect(useButton(dialog)).toHaveCount(0);
    await expect(dialog.getByTestId("modal-footer-close-button")).toBeVisible();

    /*
     * One line each: every row as tall as the others. The list draws a line
     * above every row but the first, so the first is a pixel shorter.
     */
    const heights: Array<number> = [];

    for (const name of RECOMMENDED) {
      heights.push((await boxOf(templateRow(dialog, name))).height);
    }

    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(
      1.5,
    );

    // Start from scratch sits above the templates, and spans the step.
    const scratchBox: Box = await boxOf(scratch);
    const listBox: Box = await boxOf(dialog.getByRole("listbox"));

    expect(scratchBox.y + scratchBox.height).toBeLessThan(listBox.y);
    expect(scratchBox.width).toBeGreaterThanOrEqual(listBox.width - 1);

    await screenshot(page, `dashboard-picker-${widthName(page)}-light`);
  });

  test("a click opens a template's details in its row - its widgets as chips, its variables - and brings Use this template", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDashboardDialog(page);
    const row: Locator = templateRow(dialog, "Kubernetes Dashboard");

    await row.click();

    const details: Locator = row.getByTestId("dashboard-template-details");

    await expect(row).toHaveAttribute("aria-selected", "true");
    await expect(details).toBeVisible();
    await expect(
      details.getByTestId("dashboard-template-details-widget"),
    ).toHaveText(["Value", "Chart", "Pods", "Nodes", "Table", "Log Stream"]);
    await expect(
      details.getByTestId("dashboard-template-details-variable"),
    ).toHaveText(["Cluster", "Namespace"]);
    await expect(useButton(dialog)).toHaveText("Use this template");

    // The details open inside the picked row, and fit it.
    const rowBox: Box = await boxOf(row);
    const detailsBox: Box = await boxOf(details);

    expect(detailsBox.x).toBeGreaterThanOrEqual(rowBox.x);
    expect(detailsBox.x + detailsBox.width).toBeLessThanOrEqual(
      rowBox.x + rowBox.width + 1,
    );
    expect(detailsBox.y).toBeGreaterThan(rowBox.y);

    await screenshot(page, `dashboard-picked-${widthName(page)}-light`);
  });

  test("Use this template: the name filled in and numbered, Create builds the template, and the new dashboard opens", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDashboardDialog(
      page,
      "&names=Kubernetes Dashboard",
    );

    await templateRow(dialog, "Kubernetes Dashboard").click();
    await useButton(dialog).click();

    const name: Locator = dialog.getByTestId("dashboard-name-input");

    await expect(name).toBeFocused();
    await expect(name).toHaveValue("Kubernetes Dashboard 2");
    await expect(dialog.getByTestId("dashboard-template-chosen")).toContainText(
      "Kubernetes Dashboard",
    );
    await expect(createButton(dialog)).toHaveText("Create Dashboard");

    await screenshot(page, `dashboard-name-${widthName(page)}-light`);

    await createButton(dialog).click();

    await expect(page.getByTestId("created-dashboard")).toHaveText(
      "Opened the new dashboard: Kubernetes Dashboard 2",
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await created(page)).toEqual([
      {
        kind: "dashboard",
        name: "Kubernetes Dashboard 2",
        description: null,
        projectId: PROJECT_ID,
        templateType: "Kubernetes",
      },
    ]);
  });

  test("Enter on Start from scratch, a name, and Create Dashboard: an empty dashboard, built from no template", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDashboardDialog(page);

    await page.keyboard.press("Enter");

    const name: Locator = dialog.getByTestId("dashboard-name-input");

    await expect(name).toBeFocused();
    await expect(name).toHaveValue("");
    await expect(dialog.getByTestId("dashboard-template-chosen")).toHaveCount(
      0,
    );

    // Too short: refused, saying why.
    await page.keyboard.type("x");
    await createButton(dialog).click();
    await expect(
      dialog.getByText(
        "Please give this dashboard a name of at least 2 letters.",
      ),
    ).toBeVisible();

    await name.fill("Checkout on-call");
    await createButton(dialog).click();

    await expect(page.getByTestId("created-dashboard")).toHaveText(
      "Opened the new dashboard: Checkout on-call",
    );
    expect(await created(page)).toEqual([
      {
        kind: "dashboard",
        name: "Checkout on-call",
        description: null,
        projectId: PROJECT_ID,
        templateType: null,
      },
    ]);
  });

  /*
   * Found in the UI review: Enter in the name did nothing, so the keyboard
   * that picks a template in the picker had to give way to the mouse on the
   * last step. Enter there now creates, as Create Dashboard does.
   */
  test("without the mouse: Enter on Start from scratch, a name, and Enter make an empty dashboard", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDashboardDialog(page);

    await page.keyboard.press("Enter");
    await expect(dialog.getByTestId("dashboard-name-input")).toBeFocused();
    await page.keyboard.type("Checkout on-call");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("created-dashboard")).toHaveText(
      "Opened the new dashboard: Checkout on-call",
    );
    expect(await created(page)).toEqual([
      {
        kind: "dashboard",
        name: "Checkout on-call",
        description: null,
        projectId: PROJECT_ID,
        templateType: null,
      },
    ]);
  });

  test("without the mouse: '/', a search and Enter take a template, and Enter in its numbered name creates it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDashboardDialog(
      page,
      "&names=Hosts Dashboard",
    );

    await page.keyboard.press("/");
    await page.keyboard.type("servers");
    await page.keyboard.press("Enter");

    const name: Locator = dialog.getByTestId("dashboard-name-input");

    await expect(name).toBeFocused();
    await expect(name).toHaveValue("Hosts Dashboard 2");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("created-dashboard")).toHaveText(
      "Opened the new dashboard: Hosts Dashboard 2",
    );
    expect(await created(page)).toEqual([
      {
        kind: "dashboard",
        name: "Hosts Dashboard 2",
        description: null,
        projectId: PROJECT_ID,
        templateType: "Host",
      },
    ]);
  });

  test("search: '/' jumps to it, typing picks and opens the best match, and Enter uses it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDashboardDialog(page);
    const search: Locator = dialog.getByRole("combobox", {
      name: "Search templates…",
    });

    await page.keyboard.press("/");
    await expect(search).toBeFocused();

    await page.keyboard.type("k8s");

    await expect(templateRows(dialog)).toHaveCount(2);
    await expect(templateRow(dialog, "Kubernetes Dashboard")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      dialog.getByTestId("dashboard-template-details"),
    ).toBeVisible();

    // The arrows move the pick; Enter uses it.
    await page.keyboard.press("ArrowDown");
    await expect(
      templateRow(dialog, "Kubernetes Cost Dashboard"),
    ).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");

    await expect(dialog.getByTestId("dashboard-name-input")).toHaveValue(
      "Kubernetes Dashboard",
    );
  });

  test("a search that finds nothing says so; narrowed to a category, it offers the matches elsewhere; Escape clears it first", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDashboardDialog(page);
    const search: Locator = dialog.getByRole("combobox", {
      name: "Search templates…",
    });

    await search.fill("zzzzzz");

    const empty: Locator = dialog.getByTestId("dashboard-template-empty");

    await expect(empty).toContainText("No templates match your search.");
    await expect(useButton(dialog)).toHaveCount(0);

    await screenshot(page, `dashboard-search-miss-${widthName(page)}-light`);

    await search.fill("ceph");
    await dialog
      .getByTestId("dashboard-template-view-select")
      .selectOption("Incident Response");

    await expect(
      dialog.getByTestId("dashboard-template-search-everywhere"),
    ).toHaveText("Search all templates (1)");
    await dialog.getByTestId("dashboard-template-search-everywhere").click();
    await expect(templateRows(dialog)).toHaveCount(1);
    await expect(templateRows(dialog)).toContainText(["Ceph Dashboard"]);

    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(page.getByRole("dialog")).toHaveCount(1);
  });

  test("the category select: each category its own templates, All templates all fifteen under three headings", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDashboardDialog(page);
    const select: Locator = dialog.getByTestId(
      "dashboard-template-view-select",
    );

    await expect(select.locator("option")).toHaveText([
      "Recommended",
      "Monitoring & APM",
      "Incident Response",
      "Infrastructure",
      "All templates",
    ]);

    await select.selectOption("Infrastructure");
    await expect(templateRows(dialog)).toHaveCount(9);

    await select.selectOption("all");
    await expect(templateRows(dialog)).toHaveCount(TEMPLATES.length);
    await expect(dialog.getByRole("listbox").getByRole("group")).toHaveCount(3);
  });

  test("Back from Name keeps the template picked, its details open, and the focus on the list", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDashboardDialog(page);
    const select: Locator = dialog.getByTestId(
      "dashboard-template-view-select",
    );

    await select.selectOption("Infrastructure");
    await templateRow(dialog, "Proxmox Dashboard").dblclick();
    await expect(dialog.getByTestId("dashboard-name-input")).toHaveValue(
      "Proxmox Dashboard",
    );

    await dialog.getByTestId("dashboard-wizard-back").click();

    await expect(select).toHaveValue("Infrastructure");
    await expect(templateRow(dialog, "Proxmox Dashboard")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(dialog.getByRole("listbox")).toBeFocused();
  });

  test("a name taken meanwhile is refused on the Name step, and the retry still builds the template", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDashboardDialog(page, "&create=taken");

    await templateRow(dialog, "Monitor Dashboard").click();
    await useButton(dialog).click();
    await createButton(dialog).click();

    await expect(
      dialog.getByText("Dashboard with the same name already exists."),
    ).toBeVisible();

    await screenshot(page, `dashboard-name-taken-${widthName(page)}-light`);

    await dialog
      .getByTestId("dashboard-name-input")
      .fill("Monitor Dashboard 2");
    await createButton(dialog).click();

    await expect(page.getByTestId("created-dashboard")).toHaveText(
      "Opened the new dashboard: Monitor Dashboard 2",
    );
    expect(await created(page)).toEqual([
      {
        kind: "dashboard",
        name: "Monitor Dashboard 2",
        description: null,
        projectId: PROJECT_ID,
        templateType: "Monitor",
      },
    ]);
  });

  test("a template taken while the names are on the way waits, busy, then goes on with a name nothing has", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDashboardDialog(
      page,
      "&namesDelay=2500&names=Hosts Dashboard",
    );
    const row: Locator = templateRow(dialog, "Hosts Dashboard");

    await row.click();
    await useButton(dialog).click();

    await expect(row).toHaveAttribute("aria-busy", "true");
    await expect(useButton(dialog)).toBeDisabled();

    await expect(dialog.getByTestId("dashboard-name-input")).toHaveValue(
      "Hosts Dashboard 2",
      { timeout: 10000 },
    );
  });

  test("the description waits under More fields, and is sent when typed", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDashboardDialog(page);

    await templateRow(dialog, "Alert Dashboard").dblclick();

    const description: Locator = dialog.getByTestId(
      "dashboard-description-input",
    );

    await expect(description).toBeHidden();
    await dialog.getByRole("button", { name: /More fields/ }).click();
    await expect(description).toBeVisible();
    await description.fill("For the on-call standup");
    await createButton(dialog).click();

    await expect(page.getByTestId("created-dashboard")).toBeVisible();
    expect((await created(page))[0]?.description).toBe(
      "For the on-call standup",
    );
  });

  test("it fits the window with no sideways scroll, and lays the search out for the width", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDashboardDialog(page);

    await templateRow(dialog, "Kubernetes Dashboard").click();

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
      dialog.getByTestId("dashboard-template-view-select"),
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
       * A phone: one under the other, each as wide as the list. Beside the
       * heading, the select - as wide as its longest category - pushed the
       * heading into two lines, three in Russian.
       */
      expect(search.y).toBeGreaterThanOrEqual(heading.y + heading.height - 1);
      expect(select.y).toBeGreaterThanOrEqual(search.y + search.height - 1);
      expect(search.width).toBeGreaterThan(viewport.width * 0.7);
      expect(Math.abs(select.width - search.width)).toBeLessThanOrEqual(1);
      expect(heading.height).toBeLessThanOrEqual(LINE_HEIGHT * 1.5);
    }

    // The widget chips wrap inside the row, never past it.
    const row: Box = await boxOf(templateRow(dialog, "Kubernetes Dashboard"));

    for (const chip of await dialog
      .getByTestId("dashboard-template-details-widget")
      .all()) {
      const chipBox: Box = await boxOf(chip);

      expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(
        row.x + row.width + 1,
      );
    }
  });

  test("between a phone and a laptop (768px), the select sits beside the heading and the search has a row of its own", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(isMobile, "Laid out once, at a tablet's width.");

    await page.setViewportSize({ width: 768, height: 900 });

    const dialog: Locator = await openDashboardDialog(page, "&lang=de");
    const heading: Box = await boxOf(
      dialog.locator("#dashboard-template-list-heading"),
    );
    const search: Box = await boxOf(
      dialog.getByTestId("dashboard-template-search"),
    );
    const select: Box = await boxOf(
      dialog.getByTestId("dashboard-template-view-select"),
    );
    const list: Box = await boxOf(dialog.getByRole("listbox"));

    // German's heading on one line, the select beside it.
    expect(heading.height).toBeLessThanOrEqual(LINE_HEIGHT * 1.5);
    expect(
      Math.abs(heading.y + heading.height / 2 - (select.y + select.height / 2)),
    ).toBeLessThan(12);
    expect(select.x).toBeGreaterThan(heading.x + heading.width);
    // The search under them, as wide as the list.
    expect(search.y).toBeGreaterThanOrEqual(select.y + select.height - 1);
    expect(Math.abs(search.width - list.width)).toBeLessThanOrEqual(1);
  });

  test("in the dark theme, nothing in it is left white", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDashboardDialog(page, "&theme=dark");

    await screenshot(page, `dashboard-picker-${widthName(page)}-dark`);

    await templateRow(dialog, "Kubernetes Dashboard").click();

    const backgroundOf: (locator: Locator) => Promise<string> = async (
      locator: Locator,
    ): Promise<string> => {
      return locator.evaluate((element: Element): string => {
        return window.getComputedStyle(element).backgroundColor;
      });
    };

    for (const surface of [
      dialog,
      dialog.getByTestId("dashboard-start-from-scratch"),
      dialog.getByRole("combobox", { name: "Search templates…" }),
      dialog.getByTestId("dashboard-template-view-select"),
      templateRow(dialog, "Kubernetes Dashboard"),
      dialog.getByTestId("dashboard-template-details-widget").first(),
    ]) {
      expect(await backgroundOf(surface)).not.toBe("rgb(255, 255, 255)");
    }

    await screenshot(page, `dashboard-picked-${widthName(page)}-dark`);

    await useButton(dialog).click();
    await expect(dialog.getByTestId("dashboard-name-input")).toBeVisible();
    expect(
      await backgroundOf(dialog.getByTestId("dashboard-template-chosen")),
    ).not.toBe("rgb(255, 255, 255)");

    await screenshot(page, `dashboard-name-${widthName(page)}-dark`);
  });

  test("in German, it reads as the Dashboard words it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openDashboardDialog(page, "&lang=de");

    await expect(dialog.getByTestId("modal-title")).toHaveText(
      "Dashboard erstellen",
    );
    await expect(
      dialog.getByTestId("dashboard-start-from-scratch"),
    ).toContainText("Ohne Vorlage beginnen");
    await expect(
      dialog.getByTestId("dashboard-template-view-select").locator("option"),
    ).toHaveText([
      "Empfohlen",
      "Überwachung & APM",
      "Reaktion auf Vorfälle",
      "Infrastruktur",
      "Alle Vorlagen",
    ]);

    await templateRow(dialog, "Kubernetes Dashboard").click();
    await expect(useButton(dialog)).toHaveText("Diese Vorlage verwenden");
    await expect(
      dialog.getByTestId("dashboard-template-details"),
    ).toContainText("Variablen");

    await screenshot(page, `dashboard-picked-${widthName(page)}-de`);
  });
});

/*
 * Found in the UI review: in German and French the search box cut its own
 * prompt short ("Vorlagen durchsuchen.."), and wherever the heading, the
 * search and the select did not fit one row - a tablet, a phone, a long
 * language - the heading broke into two or three lines. Both dialogs draw
 * the step, so both are read in every language the Dashboard speaks.
 */
test.describe("in every language", () => {
  const DIALOGS: Array<{ name: string; prefix: string; page: string }> = [
    {
      name: "Create a dashboard",
      prefix: "dashboard",
      page: "create-dashboard",
    },
    { name: "Create a workflow", prefix: "workflow", page: "create-workflow" },
  ];

  for (const which of DIALOGS) {
    test(`${which.name}: the heading keeps one line, the search's prompt fits its box, and nothing scrolls sideways`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.goto(`/?page=${which.page}`);
      await page.evaluate(async (): Promise<void> => {
        await document.fonts.ready;
      });

      for (const language of LANGUAGES) {
        // The page switches language as the Dashboard does, then opens the dialog.
        await page.evaluate(async (lang: string): Promise<void> => {
          await (
            window as unknown as {
              __fixture: { setLanguage: (lang: string) => Promise<void> };
            }
          ).__fixture.setLanguage(lang);
        }, language);
        await page.getByTestId(which.page).click();

        const dialog: Locator = page.getByRole("dialog");
        const search: Locator = dialog.getByTestId(
          `${which.prefix}-template-search`,
        );

        await expect(search).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("lang", language);

        const where: string = `${which.prefix}, ${language}`;
        const heading: Box = await boxOf(
          dialog.locator(`#${which.prefix}-template-list-heading`),
        );
        const searchBox: Box = await boxOf(search);
        const select: Box = await boxOf(
          dialog.getByTestId(`${which.prefix}-template-view-select`),
        );
        const dialogBox: Box = await boxOf(dialog);
        const fit: PromptFit = await promptFit(search);

        // Soft: one language that does not fit leaves the others still read.
        expect
          .soft({ where, lines: heading.height <= LINE_HEIGHT * 1.5 })
          .toEqual({ where, lines: true });
        expect
          .soft({
            where,
            prompt: fit.prompt,
            fits: fit.promptWidth <= fit.room,
          })
          .toEqual({ where, prompt: fit.prompt, fits: true });
        expect
          .soft({
            where,
            inside: select.x + select.width <= dialogBox.x + dialogBox.width,
          })
          .toEqual({ where, inside: true });
        expect
          .soft({
            where,
            sideways: await page.evaluate((): number => {
              return (
                document.documentElement.scrollWidth -
                document.documentElement.clientWidth
              );
            }),
          })
          .toEqual({ where, sideways: 0 });

        if ((page.viewportSize()?.width || 0) >= 1024) {
          // One row at a laptop's width, in every language.
          expect
            .soft({
              where,
              oneRow:
                Math.abs(
                  searchBox.y +
                    searchBox.height / 2 -
                    (heading.y + heading.height / 2),
                ) < 12 &&
                Math.abs(
                  select.y +
                    select.height / 2 -
                    (heading.y + heading.height / 2),
                ) < 12,
            })
            .toEqual({ where, oneRow: true });
        }

        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
      }
    });
  }
});

test.describe("Create a dashboard, beside Create a workflow", () => {
  interface Measures {
    dialogWidth: number;
    scratchHeight: number;
    rowHeight: number;
    searchHeight: number;
    selectHeight: number;
    headingToList: number;
  }

  async function measure(dialog: Locator, prefix: string): Promise<Measures> {
    const scratch: Box = await boxOf(
      dialog.getByTestId(`${prefix}-start-from-scratch`),
    );
    const row: Box = await boxOf(templateRows(dialog).first());
    const search: Box = await boxOf(
      dialog.getByTestId(`${prefix}-template-search`),
    );
    const select: Box = await boxOf(
      dialog.getByTestId(`${prefix}-template-view-select`),
    );
    const heading: Box = await boxOf(
      dialog.getByRole("heading", { name: "Or start from a template" }),
    );
    const list: Box = await boxOf(dialog.getByRole("listbox"));

    return {
      dialogWidth: Math.round((await boxOf(dialog)).width),
      scratchHeight: Math.round(scratch.height),
      rowHeight: Math.round(row.height),
      searchHeight: Math.round(search.height),
      selectHeight: Math.round(select.height),
      headingToList: Math.round(list.y - (heading.y + heading.height)),
    };
  }

  test("is drawn as Create a workflow is: the same width, the same Start from scratch card, rows, search and select", async ({
    page,
  }: {
    page: Page;
  }) => {
    const workflow: Locator = await openWorkflowDialog(page);
    const workflowMeasures: Measures = await measure(workflow, "workflow");

    await screenshot(page, `workflow-picker-${widthName(page)}-light`);
    await templateRows(workflow).first().click();
    await screenshot(page, `workflow-picked-${widthName(page)}-light`);

    const dashboard: Locator = await openDashboardDialog(page);
    const dashboardMeasures: Measures = await measure(dashboard, "dashboard");

    expect(dashboardMeasures.dialogWidth).toBe(workflowMeasures.dialogWidth);
    expect(dashboardMeasures.rowHeight).toBe(workflowMeasures.rowHeight);
    expect(dashboardMeasures.searchHeight).toBe(workflowMeasures.searchHeight);
    expect(dashboardMeasures.selectHeight).toBe(workflowMeasures.selectHeight);
    expect(dashboardMeasures.headingToList).toBe(
      workflowMeasures.headingToList,
    );

    // The card's line is the dialog's own, so it may wrap differently on a phone.
    if ((page.viewportSize()?.width || 0) >= 640) {
      expect(dashboardMeasures.scratchHeight).toBe(
        workflowMeasures.scratchHeight,
      );
    }
  });

  test("dark, side by side", async ({ page }: { page: Page }) => {
    const workflow: Locator = await openWorkflowDialog(page, "&theme=dark");

    await templateRows(workflow).first().click();
    await screenshot(page, `workflow-picked-${widthName(page)}-dark`);
  });
});

test.describe("every template", () => {
  // The catalog walk runs once, at a laptop's width.
  test.skip(({ isMobile }: { isMobile: boolean }): boolean => {
    return isMobile;
  }, "The catalog walk runs once, at a laptop's width.");

  test("creates the dashboard it names, built from itself", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/?page=create-dashboard");

    for (const template of TEMPLATES) {
      await page.getByTestId("create-dashboard").click();

      const dialog: Locator = page.getByRole("dialog");
      const search: Locator = dialog.getByRole("combobox", {
        name: "Search templates…",
      });

      await search.fill(template.name);
      await search.press("Enter");
      await expect(dialog.getByTestId("dashboard-name-input")).toHaveValue(
        template.name,
      );
      await createButton(dialog).click();
      await expect(page.getByTestId("created-dashboard")).toHaveText(
        `Opened the new dashboard: ${template.name}`,
      );
    }

    expect(
      (await created(page)).map((record: CreatedRecord) => {
        return [record.name, record.templateType];
      }),
    ).toEqual(
      TEMPLATES.map((template: { type: string; name: string }) => {
        return [template.name, template.type];
      }),
    );
  });
});
