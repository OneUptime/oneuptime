import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * A project's own case setup on the Security Operations fixture
 * (Fixture/CaseSetupFixture.js lays it out): Security Events > Settings >
 * Custom Fields, Note Templates and Numbering, and what a case shows of
 * them - its Overview's Custom Fields card and its own Custom Fields page,
 * its note composer's Templates menu, and the case queue's columns. What
 * the unit tests cannot see: that the pages are reached from the menus,
 * that what they send is what the fixture records, and that each fits a
 * laptop's width, a tablet's and a phone's, in both themes, in German and
 * in Persian.
 *
 * Every test pins the clock and fences the network, as
 * SecurityOperations.spec.ts does: afterEach fails a test on an uncaught
 * page error, on any request that left the fixture server and on anything
 * the fixture does not model.
 */

const PORT: string = process.env["SECURITY_OPERATIONS_FIXTURE_PORT"] || "4234";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-14T12:00:00.000Z");

const PRODUCT: string = `/dashboard/${PROJECT_ID}/security-events`;
const caseIdOf: (number: number) => string = (number: number): string => {
  return `20000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
};
const SPRAY_CASE_ID: string = caseIdOf(142);
const SPRAY_CASE_PATH: string = `${PRODUCT}/cases/${SPRAY_CASE_ID}`;
const CASE_FIELDS_PATH: string = `${SPRAY_CASE_PATH}/custom-fields`;
const CASE_NOTES_PATH: string = `${SPRAY_CASE_PATH}/notes`;
const OPEN_CASES_PATH: string = `${PRODUCT}/cases`;
const CUSTOM_FIELDS_PATH: string = `${PRODUCT}/settings/custom-fields`;
const NOTE_TEMPLATES_PATH: string = `${PRODUCT}/settings/note-templates`;
const NUMBERING_PATH: string = `${PRODUCT}/settings/numbering`;
const CONTAINMENT_TEMPLATE_ID: string = "4b000000-0000-4000-8000-000000000001";
const CONTAINMENT_TEMPLATE_PATH: string = `${NOTE_TEMPLATES_PATH}/${CONTAINMENT_TEMPLATE_ID}`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/security-operations-ui",
);

interface FixtureState {
  creates: Array<{ modelName: string; data: Record<string, unknown> }>;
  updates: Array<{
    modelName: string;
    id: string;
    data: Record<string, unknown>;
  }>;
  deletes: Array<{ modelName: string; id: string }>;
  unhandled: Array<unknown>;
}

interface OpenOptions {
  width?: number;
  height?: number;
  theme?: "dark" | undefined;
  lang?: "de" | "fa" | undefined;
  // CaseSetupFixture.js's ?casesetup= scenarios.
  caseSetup?: "none" | "fail" | undefined;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

test.use({ deviceScaleFactor: 2, actionTimeout: 15000 });

const pageErrors: Map<Page, Array<string>> = new Map();
const abortedRequests: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const aborted: Array<string> = [];
  pageErrors.set(page, errors);
  abortedRequests.set(page, aborted);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing the page asks for may leave the fixture server.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    aborted.push(route.request().url());
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    abortedRequests.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);

  const hasFixture: boolean = await page
    .evaluate((): boolean => {
      return Boolean(
        (window as unknown as { __securityOperationsFixture?: unknown })
          .__securityOperationsFixture,
      );
    })
    .catch((): boolean => {
      return false;
    });
  if (hasFixture) {
    expect(
      (await fixture(page)).unhandled,
      "requests the fixture does not model",
    ).toEqual([]);
  }
});

/*
 * ---------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------
 */

async function open(
  page: Page,
  target: string,
  options: OpenOptions = {},
): Promise<void> {
  await page.setViewportSize({
    width: options.width || 1280,
    height: options.height || 1000,
  });
  await page.clock.setFixedTime(NOW);
  const url: URL = new URL(target, `http://127.0.0.1:${PORT}`);
  if (options.theme === "dark") {
    url.searchParams.set("theme", "dark");
  }
  if (options.lang) {
    url.searchParams.set("lang", options.lang);
  }
  if (options.caseSetup) {
    url.searchParams.set("casesetup", options.caseSetup);
  }
  await page.goto(`${url.pathname}${url.search}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.load("600 14px Inter");
    await document.fonts.ready;
  });
}

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (
          window as unknown as {
            __securityOperationsFixture: FixtureState;
          }
        ).__securityOperationsFixture,
      ),
    ) as FixtureState;
  });
}

async function screenshot(
  page: Page,
  name: string,
  options: { fullPage?: boolean } = {},
): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: options.fullPage !== false,
    animations: "disabled",
  });
}

function sideMenu(page: Page): Locator {
  return page.locator('aside[role="navigation"]');
}

function menuEntry(page: Page, title: string): Locator {
  return sideMenu(page).getByRole("link", { name: title, exact: true });
}

function menuSection(page: Page, title: string): Locator {
  return sideMenu(page).getByRole("button", { name: title, exact: true });
}

// The entries of the menu marked as the page you are on.
async function litEntries(page: Page): Promise<Array<string>> {
  return sideMenu(page)
    .locator("a.bg-indigo-50")
    .evaluateAll((anchors: Array<Element>): Array<string> => {
      return anchors.map((anchor: Element): string => {
        return (
          anchor.querySelector('[data-testid="side-menu-item-title"]')
            ?.textContent ||
          anchor.textContent ||
          ""
        ).trim();
      });
    });
}

async function menuTitles(page: Page): Promise<Array<string>> {
  return (
    await sideMenu(page).getByTestId("side-menu-item-title").allInnerTexts()
  ).map((title: string): string => {
    return title.trim();
  });
}

async function breadcrumbs(page: Page): Promise<Array<string>> {
  return (
    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("listitem")
      .allInnerTexts()
  ).map((crumb: string): string => {
    return crumb.trim();
  });
}

function dialog(page: Page): Locator {
  return page.getByTestId("modal");
}

// The body rows of the page's table, each as its cells read.
async function rowTexts(page: Page): Promise<Array<string>> {
  return (await page.locator("tbody tr").allInnerTexts()).map(
    (row: string): string => {
      return row.replace(/\s+/g, " ").trim();
    },
  );
}

// The titles of the page's cards, top to bottom.
async function cardTitles(page: Page): Promise<Array<string>> {
  return (await page.getByTestId("card-details-heading").allInnerTexts()).map(
    (title: string): string => {
      return title.trim();
    },
  );
}

/*
 * ---------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------------
 */

test.describe("Security Events > Settings", () => {
  test("lists Custom Fields, Note Templates and Numbering after Case Statuses, each its own page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CUSTOM_FIELDS_PATH);
    await expect(page.getByText("Business Unit").first()).toBeVisible({
      timeout: 30000,
    });

    const titles: Array<string> = await menuTitles(page);
    expect(
      titles.slice(
        titles.indexOf("Case Priorities"),
        titles.indexOf("Risk Scoring") + 1,
      ),
    ).toEqual([
      "Case Priorities",
      "Response Targets",
      "Case Statuses",
      "Custom Fields",
      "Note Templates",
      "Numbering",
      "Risk Scoring",
    ]);
    await expect(menuSection(page, "Settings")).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    for (const [title, crumb, address] of [
      ["Custom Fields", "Custom Fields", CUSTOM_FIELDS_PATH],
      ["Note Templates", "Note Templates", NOTE_TEMPLATES_PATH],
      ["Numbering", "Numbering", NUMBERING_PATH],
    ] as Array<[string, string, string]>) {
      await menuEntry(page, title).click();
      await expect(page).toHaveURL(new RegExp(`${address}$`));
      expect(await litEntries(page)).toEqual([title]);
      expect(await breadcrumbs(page)).toEqual([
        "Project",
        "Security Events",
        "Settings",
        crumb,
      ]);
    }
  });

  test("Custom Fields: the project's case fields, each by name and type", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CUSTOM_FIELDS_PATH);
    await expect(
      page.getByRole("heading", { name: "Case Custom Fields" }),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.locator("tbody tr")).toHaveCount(2);

    const rows: Array<string> = await rowTexts(page);
    expect(rows[0]).toContain("Business Unit");
    expect(rows[0]).toContain("Dropdown");
    expect(rows[1]).toContain("External Ticket");
    expect(rows[1]).toContain("Text");
    /*
     * The card says what case fields are for, and names one as its title
     * does - not by the model's longer name ("Create Security Case Custom
     * Field"), and not what custom fields are, as every product's says.
     */
    await expect(
      page.getByText(
        "The fields your team fills in on every case, such as its business unit or its ticket in another tool.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create Case Custom Field" }),
    ).toBeVisible();
    await expect(
      page.getByText("Showing 1-2 of 2 case custom fields"),
    ).toBeVisible();
    await screenshot(page, "case-custom-fields-settings-1280-light");

    await page
      .getByRole("button", { name: "Create Case Custom Field" })
      .click();
    await expect(dialog(page)).toContainText("Create New Case Custom Field");
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toHaveCount(0);
  });

  test("in German, its create button names a case field as briefly as the title, on one line beside the side menu", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CUSTOM_FIELDS_PATH, { width: 1024, lang: "de" });
    const create: Locator = page.getByRole("button", {
      name: "Benutzerdefiniertes Fallfeld erstellen",
    });
    await expect(create).toBeVisible({ timeout: 30000 });
    // Not "Benutzerdefiniertes Feld für Sicherheitsfälle erstellen".
    await expect(page.getByText("für Sicherheitsfälle erstellen")).toHaveCount(
      0,
    );

    // The lines its words take: the tops of their text, the icon left out.
    const lines: number = await create.evaluate((element: Element): number => {
      const tops: Set<number> = new Set<number>();
      const walker: TreeWalker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
      );
      let node: Node | null = walker.nextNode();

      while (node) {
        if ((node.textContent || "").trim()) {
          const range: Range = document.createRange();
          range.selectNodeContents(node);

          for (const rect of Array.from(range.getClientRects())) {
            tops.add(Math.round(rect.top));
          }
        }

        node = walker.nextNode();
      }

      return tops.size;
    });
    expect(lines).toBe(1);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "case-custom-fields-settings-de-1024");
  });
});

/*
 * ---------------------------------------------------------------------------
 * A case's fields
 * ---------------------------------------------------------------------------
 */

test.describe("a case's own fields", () => {
  test("the Overview ends with the case's fields; Advanced > Custom Fields lists them and saves a change", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE_PATH);
    await expect(
      page.getByRole("heading", { name: "Custom Fields", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Corporate IT").first()).toBeVisible();
    await expect(page.getByText("INC-48213").first()).toBeVisible();
    // The Overview's last card, after ATT&CK.
    const titles: Array<string> = await cardTitles(page);
    expect(titles[titles.length - 1]).toBe("Custom Fields");
    expect(titles.indexOf("MITRE ATT&CK")).toBe(titles.length - 2);

    // Advanced > Custom Fields: the same fields, on a page of their own.
    await menuSection(page, "Advanced").click();
    await menuEntry(page, "Custom Fields").click();
    await expect(page).toHaveURL(new RegExp(`${CASE_FIELDS_PATH}$`));
    await expect(
      page.getByRole("heading", { name: "Case Custom Fields" }),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByText("The project's own fields, filled in for this case."),
    ).toBeVisible();
    expect(await litEntries(page)).toEqual(["Custom Fields"]);
    expect(await breadcrumbs(page)).toEqual([
      "Project",
      "Security Events",
      "Security Cases",
      "CASE-142",
      "Custom Fields",
    ]);
    await screenshot(page, "case-custom-fields-1280-light");

    // Edit Fields saves the case's values, as the server would keep them.
    await page.getByRole("button", { name: "Edit Fields" }).click();
    const ticket: Locator = dialog(page).getByLabel(/External Ticket/);
    await expect(ticket).toHaveValue("INC-48213");
    await ticket.fill("INC-48300");
    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByText("INC-48300")).toBeVisible();

    const update: FixtureState["updates"][number] | undefined = (
      await fixture(page)
    ).updates.find((entry: FixtureState["updates"][number]): boolean => {
      return entry.modelName === "SecurityCase" && entry.id === SPRAY_CASE_ID;
    });
    expect(update?.data["customFields"]).toEqual({
      "Business Unit": "Corporate IT",
      "External Ticket": "INC-48300",
    });
  });

  test("the case queue offers each field as a column, off until it is picked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OPEN_CASES_PATH);
    await expect(
      page.getByText(`Password spray against Okta from 203.0.113.47`).first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByRole("columnheader", { name: /Business Unit/ }),
    ).toHaveCount(0);
    await expect(page.getByText("Corporate IT")).toHaveCount(0);

    await page.getByRole("button", { name: "More options" }).first().click();
    await page.getByRole("menuitem", { name: "Columns" }).click();
    const picker: Locator = page.getByTestId("column-customization-modal");
    await expect(picker).toBeVisible();
    const toggle: Locator = picker.getByTestId(
      "column-toggle-customFields.Business Unit",
    );
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await page.getByTestId("modal-footer-submit-button").click();
    await expect(picker).toHaveCount(0);

    await expect(
      page.getByRole("columnheader", { name: /Business Unit/ }),
    ).toBeVisible();
    /*
     * A column added past the card's width is at the list's end: the list
     * scrolls sideways to it, as it does for any column a person adds.
     */
    await page.getByText("Corporate IT").first().scrollIntoViewIfNeeded();
    await expect(page.getByText("Corporate IT").first()).toBeInViewport();
    await screenshot(page, "cases-business-unit-column-1280-light", {
      fullPage: false,
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * Note templates
 * ---------------------------------------------------------------------------
 */

test.describe("note templates", () => {
  test("the list names each template and what it is for; Create adds one on one page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, NOTE_TEMPLATES_PATH);
    await expect(
      page.getByRole("heading", { name: "Case Note Templates" }),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.locator("tbody tr")).toHaveCount(2);
    const rows: Array<string> = await rowTexts(page);
    expect(rows[0]).toContain("Containment checklist");
    expect(rows[0]).toContain(
      "What was contained, how, and what is still open.",
    );
    expect(rows[1]).toContain("Shift hand-over");
    await screenshot(page, "case-note-templates-1280-light");

    await page.getByRole("button", { name: "Create Note Template" }).click();
    await expect(dialog(page)).toBeVisible();
    // One page: no steps to walk.
    await expect(
      dialog(page).getByRole("navigation", { name: "Progress" }),
    ).toHaveCount(0);
    await dialog(page)
      .getByPlaceholder("Containment checklist")
      .fill("Eradication summary");
    await dialog(page)
      .getByTestId("markdown-editor-toolbar")
      .getByRole("button", { name: "Markdown" })
      .click();
    const source: Locator = dialog(page)
      .locator("textarea")
      .filter({ hasNot: page.getByPlaceholder(/What was contained/) })
      .last();
    await source.fill("**Removed:** \n\n**Verified clean:** ");
    await screenshot(page, "case-note-template-create-1280-light", {
      fullPage: false,
    });
    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator("tbody tr")).toHaveCount(3);

    const created: FixtureState["creates"][number] | undefined = (
      await fixture(page)
    ).creates.find((entry: FixtureState["creates"][number]): boolean => {
      return entry.modelName === "SecurityCaseNoteTemplate";
    });
    expect(created?.data["templateName"]).toBe("Eradication summary");
    expect(created?.data["note"]).toBe("**Removed:** \n\n**Verified clean:** ");
  });

  test("a template's page: its details and its note, each edited on its own, and Delete", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, NOTE_TEMPLATES_PATH);
    await expect(page.locator("tbody tr")).toHaveCount(2, { timeout: 30000 });
    await page
      .locator("tbody tr")
      .filter({ hasText: "Containment checklist" })
      .getByRole("button", { name: "View" })
      .click();
    await expect(page).toHaveURL(new RegExp(`${CONTAINMENT_TEMPLATE_PATH}$`));
    await expect(
      page.getByRole("heading", { name: "Template Details" }),
    ).toBeVisible({ timeout: 30000 });
    /*
     * Its list's entry stays lit, and the trail goes through it to the
     * template, named once it is read - as a hunt's, a watchlist's and a
     * playbook's are - and so is the browser's tab.
     */
    expect(await litEntries(page)).toEqual(["Note Templates"]);
    await expect
      .poll(async (): Promise<Array<string>> => {
        return breadcrumbs(page);
      })
      .toEqual([
        "Project",
        "Security Events",
        "Settings",
        "Note Templates",
        "Containment checklist",
      ]);
    await expect(page).toHaveTitle(
      "OneUptime | Project - Security Events - Settings - Note Templates - Containment checklist",
    );
    await expect(
      page.getByRole("heading", { name: "Note Template", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Still open:")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete Note Template" }),
    ).toBeVisible();
    await screenshot(page, "case-note-template-1280-light");

    // Each card's Edit names the template as the list does.
    for (const button of ["Edit Details", "Edit Note Template"]) {
      await page.getByRole("button", { name: button }).click();
      await expect(dialog(page)).toBeVisible();
      await expect(
        dialog(page).getByRole("heading", { name: "Edit Note Template" }),
      ).toBeVisible();
      await expect(dialog(page)).not.toContainText(
        "Security Case Note Template",
      );
      await dialog(page).getByRole("button", { name: "Cancel" }).click();
      await expect(dialog(page)).toHaveCount(0);
    }

    await page.getByRole("button", { name: "Delete Note Template" }).click();
    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(page).toHaveURL(new RegExp(`${NOTE_TEMPLATES_PATH}$`));
    expect((await fixture(page)).deletes).toEqual([
      { modelName: "SecurityCaseNoteTemplate", id: CONTAINMENT_TEMPLATE_ID },
    ]);
    await expect(page.locator("tbody tr")).toHaveCount(1);
  });

  test("a case's note composer offers them under Templates; a pick lands in the note, and Manage templates leads to the list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASE_NOTES_PATH);
    await page
      .getByTestId("note-composer-prompt")
      .getByRole("button")
      .first()
      .click({ timeout: 30000 });
    const composer: Locator = page.getByTestId("note-composer");
    await expect(composer).toBeVisible();

    await composer.getByTestId("note-template-menu-button").click();
    const menu: Locator = page.getByTestId("note-template-menu");
    await expect(menu.getByRole("button")).toHaveText([
      /^Containment checklist/,
      /^Shift hand-over/,
    ]);
    await expect(
      menu.getByRole("link", { name: "Manage templates" }),
    ).toHaveAttribute("href", NOTE_TEMPLATES_PATH);
    await screenshot(page, "case-note-templates-menu-1280-light", {
      fullPage: false,
    });

    await menu.getByRole("button", { name: /^Shift hand-over/ }).click();
    await expect(menu).toHaveCount(0);
    const editor: Locator = composer.locator('[contenteditable="true"]');
    await expect(editor).toContainText("Where it stands:");
    await expect(editor).toContainText("Next steps:");

    await composer.getByTestId("note-template-menu-button").click();
    await page
      .getByTestId("note-template-menu")
      .getByRole("link", { name: "Manage templates" })
      .click();
    await expect(page).toHaveURL(new RegExp(`${NOTE_TEMPLATES_PATH}$`));
  });
});

/*
 * ---------------------------------------------------------------------------
 * Numbering
 * ---------------------------------------------------------------------------
 */

test.describe("numbering", () => {
  test("CASE- and the next number; a start at or below the highest is refused, a new prefix and start are saved", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, NUMBERING_PATH);
    await expect(page.getByTestId("number-prefix-value").first()).toHaveText(
      "CASE-",
      { timeout: 30000 },
    );
    await expect(
      page.getByTestId("number-prefix-example").first(),
    ).toContainText("CASE-42");
    await expect(page.getByTestId("next-number-value").first()).toHaveText(
      "CASE-143",
    );
    await expect(page.getByTestId("next-number-highest").first()).toContainText(
      "142",
    );
    await screenshot(page, "case-numbering-1280-light");

    // The next number: one at or below the highest is refused, in words.
    await page.getByRole("button", { name: "Update" }).nth(1).click();
    await expect(dialog(page)).toContainText(
      "Must be higher than 142, the highest used so far.",
    );
    const start: Locator = dialog(page).getByTestId(
      "next-number-field-SecurityCase",
    );
    await start.fill("100");
    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toContainText("Use a number higher than 142.");
    await start.fill("2001");
    await expect(dialog(page).getByTestId("next-number-preview")).toHaveText(
      "CASE-2001",
    );
    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByTestId("next-number-value").first()).toHaveText(
      "CASE-2001",
    );

    // The prefix: only new cases take it.
    await page.getByRole("button", { name: "Update" }).first().click();
    await expect(dialog(page)).toContainText(
      "Only new cases use the new prefix. Existing cases keep their numbers.",
    );
    await dialog(page)
      .getByTestId("number-prefix-field-securityCaseNumberPrefix")
      .fill("SOC-");
    await expect(dialog(page).getByTestId("number-prefix-preview")).toHaveText(
      "SOC-42",
    );
    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByTestId("number-prefix-value").first()).toHaveText(
      "SOC-",
    );

    const projectUpdates: Array<Record<string, unknown>> = (
      await fixture(page)
    ).updates
      .filter((entry: FixtureState["updates"][number]): boolean => {
        return entry.modelName === "Project";
      })
      .map(
        (entry: FixtureState["updates"][number]): Record<string, unknown> => {
          const data: Record<string, unknown> = { ...entry.data };
          delete data["_id"];
          return data;
        },
      );
    expect(projectUpdates).toEqual([
      { securityCaseNumbersStartAt: 2001 },
      { securityCaseNumberPrefix: "SOC-" },
    ]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * A project with none yet, reads that fail, a phone and other languages
 * ---------------------------------------------------------------------------
 */

// The case's Custom Fields card, its title and its fields' box, in one read.
async function caseFieldsCardGeometry(page: Page): Promise<{
  card: Box;
  title: Box;
  body: Box;
  firstField: Box | null;
}> {
  return page.evaluate(() => {
    const boxOf: (element: Element) => {
      x: number;
      y: number;
      width: number;
      height: number;
    } = (element: Element) => {
      const rect: DOMRect = element.getBoundingClientRect();

      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const body: Element = document.querySelector(
      '[data-testid="custom-fields-detail-body"]',
    )!;
    const card: Element = body.closest('[data-testid="card"]')!;
    const title: Element = card.querySelector(
      '[data-testid="card-details-heading"]',
    )!;
    const field: Element | null = body.querySelector(
      '[data-testid="detail-field"]',
    );

    return {
      card: boxOf(card),
      title: boxOf(title),
      body: boxOf(body),
      firstField: field ? boxOf(field) : null,
    };
  });
}

test.describe("a project with no case fields or note templates yet", () => {
  test("a case's Custom Fields page says so and leads to where fields are added; its Overview draws no card", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [1280, 390]) {
      await open(page, CASE_FIELDS_PATH, { width, caseSetup: "none" });
      await expect(
        page.getByText("This project has no custom fields for its cases yet."),
      ).toBeVisible({ timeout: 30000 });
      // Never the shared card's "You may add custom fields in Project Settings".
      await expect(page.getByText(/Project Settings/)).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Edit Fields" }),
      ).toHaveCount(0);
      await expectNoSidewaysScroll(page, { message: `at ${width}` });
      await screenshot(page, `case-custom-fields-none-${width}-light`);
    }

    await page.getByTestId("custom-fields-add-fields").click();
    await expect(page).toHaveURL(new RegExp(`${CUSTOM_FIELDS_PATH}$`));
    await expect(
      page.getByRole("heading", { name: "Case Custom Fields" }),
    ).toBeVisible({ timeout: 30000 });

    // The Overview leaves the card out while the project has no fields.
    await open(page, SPRAY_CASE_PATH, { caseSetup: "none" });
    await expect(
      page.getByRole("heading", { name: "MITRE ATT&CK" }),
    ).toBeVisible({ timeout: 30000 });
    await page.waitForLoadState("networkidle");
    expect(await cardTitles(page)).not.toContain("Custom Fields");
  });

  test("the composer's Templates menu offers to create one, and leads to the list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASE_NOTES_PATH, { caseSetup: "none" });
    await page
      .getByTestId("note-composer-prompt")
      .getByRole("button")
      .first()
      .click({ timeout: 30000 });
    const composer: Locator = page.getByTestId("note-composer");
    await composer.getByTestId("note-template-menu-button").click();
    const empty: Locator = page.getByTestId("note-templates-empty");
    await expect(empty).toContainText("No note templates yet");
    await screenshot(page, "case-note-templates-menu-none-1280-light", {
      fullPage: false,
    });

    await empty.getByRole("link", { name: "Create a template" }).click();
    await expect(page).toHaveURL(new RegExp(`${NOTE_TEMPLATES_PATH}$`));
    await expect(page.getByText("No note templates yet")).toBeVisible({
      timeout: 30000,
    });
  });
});

test.describe("reads that fail", () => {
  test("a case's Custom Fields page says why and reads again with Try again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASE_FIELDS_PATH, { caseSetup: "fail" });
    await expect(page.getByText("Server Error")).toBeVisible({
      timeout: 30000,
    });
    await screenshot(page, "case-custom-fields-fail-1280-light");

    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("INC-48213")).toBeVisible();
    await expect(page.getByText("Server Error")).toHaveCount(0);
  });

  test("the settings lists say why and read again; so does the Templates menu", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [address, row] of [
      [CUSTOM_FIELDS_PATH, "Business Unit"],
      [NOTE_TEMPLATES_PATH, "Containment checklist"],
    ] as Array<[string, string]>) {
      await open(page, address, { caseSetup: "fail" });
      await expect(page.getByText("Server Error")).toBeVisible({
        timeout: 30000,
      });
      await page.getByRole("button", { name: "Try again" }).click();
      await expect(
        page.locator("tbody tr").filter({ hasText: row }),
      ).toHaveCount(1);
    }

    await open(page, CASE_NOTES_PATH, { caseSetup: "fail" });
    await page
      .getByTestId("note-composer-prompt")
      .getByRole("button")
      .first()
      .click({ timeout: 30000 });
    await page
      .getByTestId("note-composer")
      .getByTestId("note-template-menu-button")
      .click();
    const menu: Locator = page.getByTestId("note-template-menu");
    await expect(menu).toContainText("Server Error");
    await menu.getByRole("button", { name: "Try again" }).click();
    await expect(
      menu.getByRole("button", { name: /^Containment checklist/ }),
    ).toBeVisible();
  });
});

test.describe("a case's Custom Fields card on a phone", () => {
  /*
   * The card's fields' box is a detail card's: the rule under its header
   * meets the card's edges, no further, and the fields start where the
   * title does. It pulled itself out 24px whatever the card's padding: on
   * a phone the rule ran past the card and the fields sat 8px left of the
   * title.
   */
  for (const theme of ["light", "dark"] as const) {
    test(`its rule meets the card's edges and its fields start under the title (390, ${theme})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      for (const address of [CASE_FIELDS_PATH, SPRAY_CASE_PATH]) {
        await open(page, address, {
          width: 390,
          ...(theme === "dark" ? { theme: "dark" } : {}),
        });
        await expect(page.getByText("INC-48213").first()).toBeVisible({
          timeout: 30000,
        });
        await page
          .getByTestId("custom-fields-detail-body")
          .scrollIntoViewIfNeeded();

        const geometry: Awaited<ReturnType<typeof caseFieldsCardGeometry>> =
          await caseFieldsCardGeometry(page);

        // Inside the card's 1px border, exactly.
        expect(
          Math.abs(geometry.body.x - (geometry.card.x + 1)),
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(
            geometry.body.x +
              geometry.body.width -
              (geometry.card.x + geometry.card.width - 1),
          ),
        ).toBeLessThanOrEqual(1);
        expect(geometry.firstField).not.toBeNull();
        expect(
          Math.abs(geometry.firstField!.x - geometry.title.x),
        ).toBeLessThanOrEqual(1);
        await expectNoSidewaysScroll(page);
      }
      await screenshot(page, `case-overview-custom-fields-390-${theme}`, {
        fullPage: false,
      });
    });
  }
});

test.describe("in the reader's language", () => {
  test("the Overview's card says what it holds in German; the Templates menu reads in Persian", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE_PATH, { lang: "de" });
    await expect(
      page.getByText(
        "Benutzerdefinierte Felder dieses Eintrags (Sicherheitsfall).",
      ),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Custom fields for this")).toHaveCount(0);

    await open(page, CASE_NOTES_PATH, { lang: "fa" });
    await page
      .getByTestId("note-composer-prompt")
      .getByRole("button")
      .first()
      .click({ timeout: 30000 });
    await page
      .getByTestId("note-composer")
      .getByTestId("note-template-menu-button")
      .click();
    const menu: Locator = page.getByTestId("note-template-menu");
    await expect(menu).toContainText("درج قالب");
    await expect(menu).not.toContainText("Insert a template");
    /*
     * A template's English name and first line read the way they are
     * written, each in an isolate of its own: "Contained:", never
     * ":Contained", in the Persian menu.
     */
    for (const written of ["Containment checklist", "Contained:"]) {
      await expect(
        menu.locator("bdi[dir='ltr']").filter({ hasText: written }),
      ).toHaveCount(1);
    }
    await screenshot(page, "case-note-templates-menu-fa-1280", {
      fullPage: false,
    });

    await open(page, CONTAINMENT_TEMPLATE_PATH, { lang: "fa" });
    await expect(
      page.getByRole("button", { name: "ویرایش قالب یادداشت" }),
    ).toBeVisible({ timeout: 30000 });

    // A case field's English description keeps its full stop at its end.
    await open(page, CASE_FIELDS_PATH, { lang: "fa" });
    await expect(
      page
        .locator("bdi[dir='ltr']")
        .filter({ hasText: "The part of the company the case is about." }),
    ).toHaveCount(1, { timeout: 30000 });
    await screenshot(page, "case-custom-fields-fa-1280-isolated", {
      fullPage: false,
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * Every page at every width
 * ---------------------------------------------------------------------------
 */

const PAGES: Array<[string, string, string]> = [
  ["case-custom-fields-settings", CUSTOM_FIELDS_PATH, "Case Custom Fields"],
  ["case-note-templates", NOTE_TEMPLATES_PATH, "Case Note Templates"],
  ["case-note-template", CONTAINMENT_TEMPLATE_PATH, "Template Details"],
  ["case-numbering", NUMBERING_PATH, "Number Prefix"],
  ["case-custom-fields", CASE_FIELDS_PATH, "Case Custom Fields"],
];

test.describe("every page fits", () => {
  for (const width of [390, 768, 1024, 1280]) {
    for (const theme of ["light", "dark"] as const) {
      test(`at ${width} in the ${theme} theme, with no sideways scroll`, async ({
        page,
      }: {
        page: Page;
      }) => {
        for (const [name, address, heading] of PAGES) {
          await open(page, address, {
            width,
            ...(theme === "dark" ? { theme: "dark" } : {}),
          });
          await expect(
            page.getByRole("heading", { name: heading }).first(),
          ).toBeVisible({ timeout: 30000 });
          await expectNoSidewaysScroll(page, {
            message: `${name} at ${width}`,
          });
          if (width === 390 || width === 1024 || theme === "dark") {
            await screenshot(page, `${name}-${width}-${theme}`);
          }
        }
      });
    }
  }

  for (const lang of ["de", "fa"] as const) {
    test(`in ${lang === "de" ? "German" : "Persian"}, at 1280 and 390`, async ({
      page,
    }: {
      page: Page;
    }) => {
      for (const width of [1280, 390]) {
        for (const [name, address] of PAGES) {
          await open(page, address, { width, lang });
          await expect(page.getByTestId("synthetic-banner")).toBeVisible();
          await expect(page.locator("main, #root").first()).toBeVisible();
          await page.waitForLoadState("networkidle");
          await expectNoSidewaysScroll(page, {
            message: `${name} at ${width}`,
          });
          await screenshot(page, `${name}-${lang}-${width}`);
        }
      }
    });
  }
});
