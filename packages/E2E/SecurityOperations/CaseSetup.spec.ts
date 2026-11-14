import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { boxesInOneFrame } from "../SuiteHelpers/Frames";
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

/*
 * A failed read whose answer says nothing ("Server Error", as the fixture's
 * ?casesetup=fail answers) is one the server did not explain (#6836): a page
 * says why and what to do next under its own words for what failed, and a
 * line that shows the message as it is says both in one sentence.
 */
const UNEXPLAINED_WHY_AND_NEXT: string =
  "The server ran into a problem it could not explain. Try again in a moment.";
const UNEXPLAINED_MESSAGE: string =
  "The server ran into a problem it could not explain, so this did not finish. Try again in a moment.";

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
  caseSetup?:
    | "none"
    | "fail"
    | "fail-with-reference"
    | "fail-twice"
    | "notes-fail-with-reference"
    | "notes-fail-twice"
    | "notes-more-fail"
    | "notes-more-pages"
    | "note-post-fail"
    | undefined;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// A piece of a line of text, and where the browser drew it.
interface DrawnPiece {
  text: string;
  left: number;
  right: number;
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

  /*
   * The menu reads its templates once it has opened. Until they arrive it
   * draws its loading rows, with nothing to focus but itself: it drew an
   * empty list with Manage templates, which the focus took and then lost to
   * the page when the templates arrived.
   */
  test("opened from the keyboard, the composer's Templates menu puts the focus on the first template", async ({
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
    await page
      .getByTestId("note-composer")
      .getByTestId("note-template-menu-button")
      .focus();
    await page.keyboard.press("Enter");

    await expect(
      page
        .getByTestId("note-template-menu")
        .getByRole("button", { name: /^Containment checklist/ }),
    ).toBeFocused();
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

/*
 * The Templates menu is only as tall as the room beside its button, and cuts
 * off what runs past its end. On a phone held sideways (844 x 390), with the
 * button in the middle of the window, that is less room than its failure or
 * its empty state needs: each scrolls inside the menu, as the list does, and
 * the wheel over it brings its end into sight without moving the page under
 * the menu.
 */
const SHORT_WINDOW: { width: number; height: number } = {
  width: 844,
  height: 390,
};

// The composer's Templates menu, opened with its button mid-window.
async function openTemplateMenuMidWindow(
  page: Page,
  caseSetup: "none" | "fail-with-reference",
): Promise<Locator> {
  await open(page, CASE_NOTES_PATH, { ...SHORT_WINDOW, caseSetup });
  await page
    .getByTestId("note-composer-prompt")
    .getByRole("button")
    .first()
    .click({ timeout: 30000 });
  const trigger: Locator = page
    .getByTestId("note-composer")
    .getByTestId("note-template-menu-button");
  // The button in the middle of the window: the least room on either side.
  await trigger.evaluate((element: Element) => {
    element.scrollIntoView({ block: "center" });
  });
  await trigger.click();

  return page.getByTestId("note-template-menu");
}

/*
 * Whether the whole of `control` is inside the menu's box. Both boxes are
 * read in one frame: the menu scrolls while the wheel test polls this.
 */
async function isInsideMenu(menu: Locator, control: Locator): Promise<boolean> {
  const [own, box] = await boxesInOneFrame([menu, control]);

  return (
    box!.y >= own!.y - 0.5 && box!.y + box!.height <= own!.y + own!.height + 0.5
  );
}

/*
 * `control` starts past the menu's end; the wheel over the menu brings it
 * into sight, whole, and the page and the menu stay where they were.
 */
async function expectTheWheelScrollsTheMenuTo(
  page: Page,
  menu: Locator,
  control: Locator,
): Promise<void> {
  expect(
    await isInsideMenu(menu, control),
    "the window leaves the menu less room than it needs",
  ).toBe(false);

  const opened: Box = (await menu.boundingBox())!;
  expect(opened.y).toBeGreaterThanOrEqual(0);
  expect(opened.y + opened.height).toBeLessThanOrEqual(SHORT_WINDOW.height);
  const pageScrolled: number = await page.evaluate((): number => {
    return window.scrollY;
  });

  await page.mouse.move(
    opened.x + opened.width / 2,
    opened.y + opened.height / 2,
  );
  await page.mouse.wheel(0, 400);

  await expect
    .poll((): Promise<boolean> => {
      return isInsideMenu(menu, control);
    })
    .toBe(true);
  // Not cut off by the menu, nor by what scrolls inside it.
  await expect(control).toBeInViewport({ ratio: 1 });
  // What the menu draws scrolled, not the page: the menu is where it opened.
  expect(
    await page.evaluate((): number => {
      return window.scrollY;
    }),
  ).toBe(pageScrolled);
  expect((await menu.boundingBox())!.y).toBe(opened.y);
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

  test("on a short window, the menu's empty state scrolls inside the menu to Create a template (844 x 390)", async ({
    page,
  }: {
    page: Page;
  }) => {
    const menu: Locator = await openTemplateMenuMidWindow(page, "none");
    const empty: Locator = menu.getByTestId("note-templates-empty");
    const create: Locator = empty.getByRole("link", {
      name: "Create a template",
    });
    await expect(empty).toContainText("No note templates yet");

    await expectTheWheelScrollsTheMenuTo(page, menu, create);
    await screenshot(page, "case-note-templates-menu-empty-844x390", {
      fullPage: false,
    });

    // Where it scrolled to, it is a link like any other.
    await create.click();
    await expect(page).toHaveURL(new RegExp(`${NOTE_TEMPLATES_PATH}$`));
  });
});

test.describe("reads that fail", () => {
  test("a case's Custom Fields page says why and reads again with Try again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASE_FIELDS_PATH, { caseSetup: "fail" });
    /*
     * The read's answer says nothing ("Server Error"): the card says the
     * server could not explain it, and what to do next (#6836).
     */
    await expect(page.getByTestId("error-what-failed")).toHaveText(
      "This did not finish.",
      { timeout: 30000 },
    );
    await expect(page.getByTestId("error-why-and-next")).toHaveText(
      UNEXPLAINED_WHY_AND_NEXT,
    );
    await expect(page.getByText("Server Error")).toHaveCount(0);
    await screenshot(page, "case-custom-fields-fail-1280-light");

    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("INC-48213")).toBeVisible();
    await expect(page.getByTestId("error-explanation")).toHaveCount(0);
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
      // Under the list's own "Couldn't load ...", why and what to do next.
      await expect(page.getByTestId("error-why-and-next")).toHaveText(
        UNEXPLAINED_WHY_AND_NEXT,
        { timeout: 30000 },
      );
      await expect(page.getByText("Server Error")).toHaveCount(0);
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
    /*
     * The menu's failure reads as the lists' do (#7544): what failed, in
     * the menu's words, then why and what to do next - never the message
     * as it came, in one sentence.
     */
    await expect(menu.getByTestId("error-what-failed")).toHaveText(
      "Couldn't load note templates.",
    );
    await expect(menu.getByTestId("error-why-and-next")).toHaveText(
      UNEXPLAINED_WHY_AND_NEXT,
    );
    await expect(menu).not.toContainText(UNEXPLAINED_MESSAGE);
    await expect(menu).not.toContainText("Server Error");
    await menu.getByRole("button", { name: "Try again" }).click();
    await expect(
      menu.getByRole("button", { name: /^Containment checklist/ }),
    ).toBeVisible();
    await expect(menu.getByTestId("error-explanation")).toHaveCount(0);
  });

  /*
   * A list's Try again gives way to the loading rows, which hold nothing to
   * focus (#7621): pressed from the keyboard, the focus fell to the page,
   * and the next Tab started over at its top. The table holds the focus
   * now while the rows load again - with no ring around it - and gives it
   * back to Try again if they fail once more; when they arrive it keeps it,
   * just before them. Once the focus moves on, the table is not focusable,
   * so a click on its words leaves the focus with the page, as before.
   */
  test("pressed from the keyboard, a list's Try again keeps the focus: on Try again after another failure, then just before the rows", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CUSTOM_FIELDS_PATH, { caseSetup: "fail-twice" });
    const tryAgain: Locator = page.getByRole("button", { name: "Try again" });
    // The table as a whole: what holds its rows and its footer.
    const table: Locator = page.getByTestId("table-scroll").locator("..");
    await tryAgain.focus({ timeout: 30000 });

    // Counts each change to the page that left the focus on the page itself.
    await page.evaluate((): void => {
      const tracked: Window & { focusFellToPage?: number } = window;
      tracked.focusFellToPage = 0;
      new MutationObserver((): void => {
        if (document.activeElement === document.body) {
          tracked.focusFellToPage = (tracked.focusFellToPage || 0) + 1;
        }
      }).observe(document.body, { childList: true, subtree: true });
    });

    // The second read fails too.
    await page.keyboard.press("Enter");
    await expect(tryAgain).toBeFocused();

    // The third answers.
    await page.keyboard.press("Enter");
    await expect(
      page.locator("tbody tr").filter({ hasText: "Business Unit" }),
    ).toHaveCount(1);
    await expect(table).toBeFocused();
    expect(
      await table.evaluate((element: Element): string => {
        const style: CSSStyleDeclaration = getComputedStyle(element);
        return style.outlineStyle === "none" ||
          style.outlineColor === "rgba(0, 0, 0, 0)"
          ? "no ring"
          : `${style.outlineStyle} ${style.outlineColor}`;
      }),
    ).toBe("no ring");
    expect(
      await page.evaluate((): number => {
        return (window as Window & { focusFellToPage?: number })
          .focusFellToPage as number;
      }),
      "changes to the page that left the focus on the page itself",
    ).toBe(0);

    // The next Tab reaches the first of what the table holds.
    await page.keyboard.press("Tab");
    expect(
      await table.evaluate((element: Element): boolean => {
        return (
          document.activeElement !== element &&
          element.contains(document.activeElement)
        );
      }),
      "the focus is on a control in the table",
    ).toBe(true);

    // Focusable no more: a click on its words leaves the focus with the page.
    await page.getByText("Showing 1-2 of 2 case custom fields").click();
    expect(
      await page.evaluate((): boolean => {
        return document.activeElement === document.body;
      }),
      "the focus is on the page itself",
    ).toBe(true);
  });
});

/*
 * The Templates menu is fixed to the page and cuts off whatever runs past
 * its edges, so a failure that did not fit in it would lose its end rather
 * than scroll the page. A failure the server could not explain is the most
 * the menu draws when its templates do not load (#7544): what failed, why
 * and what to do next, and the reference's row with its copy button.
 */

// The reference CaseSetupFixture.js's ?casesetup=fail-with-reference names.
const FAILED_READ_REFERENCE: string = "3f9a2c1b";

// The Templates menu's box, and each box it draws that reaches past it.
async function templateMenuFit(menu: Locator): Promise<{
  menu: Box;
  windowWidth: number;
  outside: Array<string>;
}> {
  return menu.evaluate((element: Element) => {
    const own: DOMRect = element.getBoundingClientRect();
    const outside: Array<string> = [];

    for (const drawn of Array.from(element.querySelectorAll("*"))) {
      const box: DOMRect = drawn.getBoundingClientRect();

      if (box.width === 0 && box.height === 0) {
        continue;
      }

      if (
        box.left < own.left - 0.5 ||
        box.right > own.right + 0.5 ||
        box.top < own.top - 0.5 ||
        box.bottom > own.bottom + 0.5
      ) {
        outside.push(
          `${drawn.tagName.toLowerCase()} "${(drawn.textContent || "").trim().slice(0, 40)}"`,
        );
      }
    }

    return {
      menu: { x: own.x, y: own.y, width: own.width, height: own.height },
      windowWidth: document.documentElement.clientWidth,
      outside,
    };
  });
}

test.describe("the Templates menu's failure", () => {
  for (const lang of ["en", "fa"] as const) {
    test(`says what failed, why, what to do and its reference, inside the menu at 1280 and 390 (${lang === "en" ? "English" : "Persian"})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      // The Dashboard's Persian words, as the fixture draws them with ?lang=fa.
      const persian: Record<string, string> = JSON.parse(
        await fs.readFile(
          path.resolve(
            __dirname,
            "../../App/FeatureSet/Dashboard/src/Locales/fa.json",
          ),
          "utf8",
        ),
      ) as Record<string, string>;
      const wordsOf: (english: string) => string = (
        english: string,
      ): string => {
        return lang === "fa" ? persian[english]! : english;
      };

      for (const width of [1280, 390]) {
        await open(page, CASE_NOTES_PATH, {
          width,
          caseSetup: "fail-with-reference",
          ...(lang === "fa" ? { lang } : {}),
        });
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
        const failure: Locator = menu.getByTestId("note-templates-error");

        await expect(failure.getByTestId("error-what-failed")).toHaveText(
          wordsOf("Couldn't load note templates."),
        );
        await expect(failure.getByTestId("error-why-and-next")).toContainText(
          wordsOf("The server ran into a problem it could not explain."),
        );
        // The reference as written, with its copy button, then Try again.
        await expect(
          failure.getByTestId("error-reference").locator("code"),
        ).toHaveText(FAILED_READ_REFERENCE);
        await expect(
          failure.getByTestId("error-reference").getByRole("button"),
        ).toBeVisible();
        await expect(
          failure.getByRole("button", { name: wordsOf("Try again") }),
        ).toBeVisible();
        if (lang === "fa") {
          for (const english of [
            "Couldn't load note templates.",
            "The server ran into a problem",
            "Try again",
          ]) {
            await expect(failure).not.toContainText(english);
          }
        }

        const fit: Awaited<ReturnType<typeof templateMenuFit>> =
          await templateMenuFit(menu);
        expect(fit.outside, `what runs past the menu at ${width}`).toEqual([]);
        expect(fit.menu.x).toBeGreaterThanOrEqual(0);
        expect(fit.menu.x + fit.menu.width).toBeLessThanOrEqual(
          fit.windowWidth,
        );
        await expectNoSidewaysScroll(page, {
          message: `the menu's failure at ${width}`,
        });
        await screenshot(
          page,
          `case-note-templates-menu-fail-${lang}-${width}`,
          {
            fullPage: false,
          },
        );
      }
    });
  }

  // On a short window (SHORT_WINDOW), the failure scrolls as the list does.
  test("on a short window, it scrolls inside the menu to its Try again (844 x 390)", async ({
    page,
  }: {
    page: Page;
  }) => {
    const menu: Locator = await openTemplateMenuMidWindow(
      page,
      "fail-with-reference",
    );
    const failure: Locator = menu.getByTestId("note-templates-error");
    await expect(failure.getByTestId("error-reference")).toBeVisible();

    await expectTheWheelScrollsTheMenuTo(
      page,
      menu,
      failure.getByRole("button", { name: "Try again" }),
    );
    await screenshot(page, "case-note-templates-menu-fail-844x390", {
      fullPage: false,
    });
  });

  /*
   * Try again gives way to the loading rows, which hold nothing to focus.
   * Pressed from the keyboard, it leaves the focus in the menu while the
   * templates load again - it fell to the page behind the menu, and stayed
   * there - and the menu hands it on when the read ends, as it does when it
   * opens: to Try again if the templates fail once more, to the first of
   * them when they arrive.
   */
  test("pressed from the keyboard, Try again keeps the focus in the menu: on Try again after another failure, then on the first template", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASE_NOTES_PATH, { caseSetup: "fail-twice" });
    await page
      .getByTestId("note-composer-prompt")
      .getByRole("button")
      .first()
      .click({ timeout: 30000 });
    const trigger: Locator = page
      .getByTestId("note-composer")
      .getByTestId("note-template-menu-button");
    await trigger.focus();
    await page.keyboard.press("Enter");
    const menu: Locator = page.getByTestId("note-template-menu");
    const tryAgain: Locator = menu
      .getByTestId("note-templates-error")
      .getByRole("button", { name: "Try again" });
    await expect(tryAgain).toBeFocused();

    // The second read fails too.
    await page.keyboard.press("Enter");
    await expect(tryAgain).toBeFocused();

    // The third answers.
    await page.keyboard.press("Enter");
    await expect(
      menu.getByRole("button", { name: /^Containment checklist/ }),
    ).toBeFocused();
    await expect(menu.getByTestId("note-templates-error")).toHaveCount(0);
  });
});

/*
 * A case's notes that do not load (#7570). The feed said "Notes could not
 * be loaded" and, under it, API.getFriendlyMessage's English sentence as it
 * came: on a Persian page with its full stop at its start, and without the
 * reference to give. It reads as the lists and the Templates menu do now:
 * under the feed's heading - which alone says what failed - why and what
 * to do next, and the reference with its copy button, in the reader's
 * language; then Try again.
 */
test.describe("a case's notes feed, when the notes do not load", () => {
  for (const lang of ["en", "fa"] as const) {
    test(`says why, what to do and its reference under its own heading, at 1280 and 390, and Try again reads the notes (${lang === "en" ? "English" : "Persian"})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      // The Dashboard's Persian words, as the fixture draws them with ?lang=fa.
      const persian: Record<string, string> = JSON.parse(
        await fs.readFile(
          path.resolve(
            __dirname,
            "../../App/FeatureSet/Dashboard/src/Locales/fa.json",
          ),
          "utf8",
        ),
      ) as Record<string, string>;
      const wordsOf: (english: string) => string = (
        english: string,
      ): string => {
        return lang === "fa" ? persian[english]! : english;
      };

      for (const width of [1280, 390]) {
        await open(page, CASE_NOTES_PATH, {
          width,
          caseSetup: "notes-fail-with-reference",
          ...(lang === "fa" ? { lang } : {}),
        });
        const failure: Locator = page.getByTestId("notes-error");
        await expect(failure).toBeVisible({ timeout: 30000 });

        // What failed, once: the heading's words, and no line of its own.
        await expect(failure.locator("p").first()).toHaveText(
          wordsOf("Notes could not be loaded"),
        );
        await expect(failure.getByTestId("error-what-failed")).toHaveCount(0);
        await expect(failure).not.toContainText(
          wordsOf("This did not finish."),
        );
        const whyAndNext: Locator = failure.getByTestId("error-why-and-next");
        await expect(whyAndNext).toContainText(
          wordsOf("The server ran into a problem it could not explain."),
        );
        await expect(whyAndNext).toContainText(
          wordsOf(
            "Try again. If it keeps failing, give this reference to whoever runs your OneUptime server:",
          ),
        );
        // The reference as written, left to right, with its copy button.
        const reference: Locator = failure.getByTestId("error-reference");
        await expect(reference.locator("code")).toHaveText(
          FAILED_READ_REFERENCE,
        );
        await expect(reference.locator("code")).toHaveAttribute("dir", "ltr");
        await expect(reference.getByRole("button")).toBeVisible();
        await expect(
          failure.getByRole("button", { name: wordsOf("Try again") }),
        ).toBeVisible();
        // The reference and its copy button are centred, as the lines are.
        const offCentre: number = await failure.evaluate(
          (element: Element): number => {
            const row: Element = element.querySelector(
              "[data-testid='error-reference']",
            )!;
            const first: DOMRect =
              row.firstElementChild!.getBoundingClientRect();
            const last: DOMRect = row.lastElementChild!.getBoundingClientRect();
            const view: DOMRect = element.getBoundingClientRect();
            const drawn: number =
              (Math.min(first.left, last.left) +
                Math.max(first.right, last.right)) /
              2;
            return Math.abs(drawn - (view.left + view.width / 2));
          },
        );
        expect(
          offCentre,
          `the reference's row at ${width}`,
        ).toBeLessThanOrEqual(2);
        // Never the sentence as API.getFriendlyMessage wrote it.
        await expect(failure).not.toContainText("so this did not finish");
        if (lang === "fa") {
          for (const english of [
            "Notes could not be loaded",
            "The server ran into a problem",
            "Try again",
          ]) {
            await expect(failure).not.toContainText(english);
          }
        }

        await expectNoSidewaysScroll(page, {
          message: `the notes feed's failure at ${width}`,
        });
        await failure.scrollIntoViewIfNeeded();
        await screenshot(page, `case-notes-fail-${lang}-${width}`, {
          fullPage: false,
        });
      }

      await page
        .getByTestId("notes-error")
        .getByRole("button", { name: wordsOf("Try again") })
        .click();
      await expect(page.getByTestId("note-card")).toHaveCount(2);
      await expect(page.getByTestId("notes-error")).toHaveCount(0);
    });
  }

  /*
   * Try again gives way to the loading skeleton, which holds nothing to
   * focus: the focus fell to the page, and the next Tab started over at
   * its top. Pressed from the keyboard, it leaves the focus with the feed
   * while the notes load again - on Try again once more if they fail again,
   * though the reference's copy button comes before it, and in the feed,
   * just before the notes, when they arrive.
   */
  test("pressed from the keyboard, Try again keeps the focus: on Try again after another failure, then just before the notes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASE_NOTES_PATH, { caseSetup: "notes-fail-twice" });
    const failure: Locator = page.getByTestId("notes-error");
    const copy: Locator = failure
      .getByTestId("error-reference")
      .getByRole("button");
    const tryAgain: Locator = failure.getByRole("button", {
      name: "Try again",
    });
    await copy.focus({ timeout: 30000 });

    // From the copy button, one Tab reaches Try again.
    await page.keyboard.press("Tab");
    await expect(tryAgain).toBeFocused();

    // The second read fails too.
    await page.keyboard.press("Enter");
    await expect(tryAgain).toBeFocused();
    await expect(copy).not.toBeFocused();

    // The third answers.
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("note-card")).toHaveCount(2);
    await expect(page.getByTestId("notes-feed-body")).toBeFocused();

    // The next Tab reaches the first note.
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate((): boolean => {
        const firstNote: Element | null = document.querySelector(
          "[data-testid='note-card']",
        );
        return Boolean(
          firstNote &&
            document.activeElement &&
            firstNote.contains(document.activeElement),
        );
      }),
      "the focus is in the first note",
    ).toBe(true);
  });
});

/*
 * A case's Load more that fails (#7620). The banner over the feed said
 * what API.getFriendlyMessage said, and nothing else: English on every
 * page - on a Persian one with its full stop at its start - without the
 * reference to give, and silent on what had failed; and its Dismiss dropped
 * the keyboard's focus to the page. It says what failed now, then why and
 * what to do next with the reference and its copy button, in the reader's
 * language; Dismiss leaves the focus on Load more, one key from trying again.
 */
test.describe("a case's notes feed, when Load more fails", () => {
  // CASE-142's notes under ?casesetup=notes-more-fail: a page, then 3 more.
  const FIRST_PAGE: number = 25;
  const ALL_NOTES: number = 28;

  for (const lang of ["en", "fa"] as const) {
    test(`says what failed, why, what to do and its reference over the notes, at 1280 and 390 (${lang === "en" ? "English" : "Persian"})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      // The Dashboard's Persian words, as the fixture draws them with ?lang=fa.
      const persian: Record<string, string> = JSON.parse(
        await fs.readFile(
          path.resolve(
            __dirname,
            "../../App/FeatureSet/Dashboard/src/Locales/fa.json",
          ),
          "utf8",
        ),
      ) as Record<string, string>;
      const wordsOf: (english: string) => string = (
        english: string,
      ): string => {
        return lang === "fa" ? persian[english]! : english;
      };

      for (const width of [1280, 390]) {
        await open(page, CASE_NOTES_PATH, {
          width,
          caseSetup: "notes-more-fail",
          ...(lang === "fa" ? { lang } : {}),
        });
        await expect(page.getByTestId("note-card")).toHaveCount(FIRST_PAGE, {
          timeout: 30000,
        });
        await page.getByTestId("notes-load-more").click();

        const banner: Locator = page.getByTestId("notes-action-error");
        await expect(banner).toBeVisible();
        await expect(banner).toHaveAttribute("role", "alert");

        // What failed, once, then why and what to do next.
        await expect(
          banner.getByTestId("notes-action-error-what-failed"),
        ).toHaveText(wordsOf("Couldn't load more notes."));
        await expect(banner.getByTestId("error-what-failed")).toHaveCount(0);
        const whyAndNext: Locator = banner.getByTestId("error-why-and-next");
        await expect(whyAndNext).toContainText(
          wordsOf("The server ran into a problem it could not explain."),
        );
        await expect(whyAndNext).toContainText(
          wordsOf(
            "Try again. If it keeps failing, give this reference to whoever runs your OneUptime server:",
          ),
        );
        // The reference as written, left to right, with its copy button.
        const reference: Locator = banner.getByTestId("error-reference");
        await expect(reference.locator("code")).toHaveText(
          FAILED_READ_REFERENCE,
        );
        await expect(reference.locator("code")).toHaveAttribute("dir", "ltr");
        await expect(reference.getByRole("button")).toBeVisible();
        const dismiss: Locator = banner.getByRole("button", {
          name: wordsOf("Dismiss"),
        });
        await expect(dismiss).toBeVisible();
        // Dismiss on one line, though Persian says it in two words.
        const dismissLines: number = await dismiss.evaluate(
          (element: Element): number => {
            const range: Range = document.createRange();
            range.selectNodeContents(element);
            return new Set(
              Array.from(range.getClientRects()).map(
                (rect: DOMRect): number => {
                  return Math.round(rect.top);
                },
              ),
            ).size;
          },
        );
        expect(dismissLines, `Dismiss's lines at ${width}`).toBe(1);
        // Never the sentence as API.getFriendlyMessage wrote it.
        await expect(banner).not.toContainText("so this did not finish");
        if (lang === "fa") {
          for (const english of [
            "Couldn't load more notes.",
            "The server ran into a problem",
            "Dismiss",
          ]) {
            await expect(banner).not.toContainText(english);
          }
        }
        // The notes on screen stay.
        await expect(page.getByTestId("note-card")).toHaveCount(FIRST_PAGE);

        await expectNoSidewaysScroll(page, {
          message: `the notes feed's banner at ${width}`,
        });
        await banner.scrollIntoViewIfNeeded();
        await screenshot(page, `case-notes-more-fail-${lang}-${width}`, {
          fullPage: false,
        });
      }
    });
  }

  /*
   * Dismiss takes the banner away, and the focus on it fell to the page:
   * the next Tab started over at its top. It leaves the focus on Load more
   * now, and the next Enter reads the notes again.
   */
  test("dismissed from the keyboard, the banner leaves the focus on Load more, whose next press reads the notes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASE_NOTES_PATH, { caseSetup: "notes-more-fail" });
    await expect(page.getByTestId("note-card")).toHaveCount(FIRST_PAGE, {
      timeout: 30000,
    });
    const loadMore: Locator = page.getByTestId("notes-load-more");
    await loadMore.focus();
    await page.keyboard.press("Enter");

    const banner: Locator = page.getByTestId("notes-action-error");
    const dismiss: Locator = banner.getByRole("button", { name: "Dismiss" });
    await expect(banner).toBeVisible();

    // From the reference's copy button, one Tab reaches Dismiss.
    await banner.getByTestId("error-reference").getByRole("button").focus();
    await page.keyboard.press("Tab");
    await expect(dismiss).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(banner).toHaveCount(0);
    await expect(loadMore).toBeFocused();

    // Load more's next read answers.
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("note-card")).toHaveCount(ALL_NOTES);
    await expect(page.getByTestId("notes-action-error")).toHaveCount(0);
  });

  /*
   * The banner stayed up until it was dismissed: Load more pressed again
   * brought the notes under "Couldn't load more notes." (#7646). Its notes
   * take the banner away now, and a focus on the banner goes where Dismiss
   * puts it while Load more reads - the feed, just before the notes - not
   * to the page.
   */
  test("Load more pressed again brings the notes and takes the banner away, and a focus on the banner stays in the feed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASE_NOTES_PATH, { caseSetup: "notes-more-fail" });
    await expect(page.getByTestId("note-card")).toHaveCount(FIRST_PAGE, {
      timeout: 30000,
    });
    const loadMore: Locator = page.getByTestId("notes-load-more");
    await loadMore.click();

    const banner: Locator = page.getByTestId("notes-action-error");
    await expect(banner).toBeVisible();

    // A keyboard user on the banner, at its reference's copy button.
    await banner.getByTestId("error-reference").getByRole("button").focus();

    // Counts each change to the page that left the focus on the page itself.
    await page.evaluate((): void => {
      const tracked: Window & { focusFellToPage?: number } = window;
      tracked.focusFellToPage = 0;
      new MutationObserver((): void => {
        if (document.activeElement === document.body) {
          tracked.focusFellToPage = (tracked.focusFellToPage || 0) + 1;
        }
      }).observe(document.body, { childList: true, subtree: true });
    });

    // Load more, by a click that leaves the focus where it was, as Safari's does.
    await loadMore.dispatchEvent("click");

    await expect(page.getByTestId("note-card")).toHaveCount(ALL_NOTES);
    await expect(banner).toHaveCount(0);
    await expect(page.getByTestId("notes-feed-body")).toBeFocused();
    expect(
      await page.evaluate((): number => {
        return (window as Window & { focusFellToPage?: number })
          .focusFellToPage as number;
      }),
      "changes to the page that left the focus on the page itself",
    ).toBe(0);
  });

  /*
   * Load more is disabled while it reads, and a focus on it fell to the
   * page (#7706): in Firefox as soon as it was disabled, and in every
   * browser once the last page took Load more away - the next Tab started
   * over at the top of the page. The feed holds the focus while Load more
   * reads, with the page left where it is; a failure gives it to the
   * banner, which comes into view; its Dismiss gives it back to Load more;
   * and after the last page the feed keeps it, just before the notes.
   */
  test("pressed from the keyboard, Load more keeps the focus in the feed while it reads, gives it to the banner when it fails, and keeps it in the feed after the last page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASE_NOTES_PATH, { caseSetup: "notes-more-fail" });
    await expect(page.getByTestId("note-card")).toHaveCount(FIRST_PAGE, {
      timeout: 30000,
    });
    const feed: Locator = page.getByTestId("notes-feed-body");
    const loadMore: Locator = page.getByTestId("notes-load-more");
    // Nothing has given the feed the focus: it does not take it.
    await expect(feed).not.toHaveAttribute("tabindex");
    await loadMore.focus();

    /*
     * At each change to the page: where the focus is, whether Load more is
     * reading - disabled - and how far down the page is, for the press
     * (`press`) the test is on.
     */
    interface FocusRecord {
      press: number;
      focus: string;
      isReading: boolean;
      scrollY: number;
    }
    type TrackedWindow = Window & {
      press?: number;
      focusRecords?: Array<FocusRecord>;
    };
    await page.evaluate((): void => {
      const tracked: TrackedWindow = window;
      tracked.press = 0;
      tracked.focusRecords = [];
      new MutationObserver((): void => {
        const focused: Element | null = document.activeElement;
        const button: HTMLButtonElement | null = document.querySelector(
          "[data-testid='notes-load-more']",
        );
        tracked.focusRecords!.push({
          press: tracked.press || 0,
          focus:
            !focused || focused === document.body
              ? "the page"
              : focused.getAttribute("data-testid") ||
                focused.tagName.toLowerCase(),
          isReading: Boolean(button?.disabled),
          scrollY: Math.round(window.scrollY),
        });
      }).observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["disabled"],
      });
    });
    const pressEnter: (press: number) => Promise<number> = async (
      press: number,
    ): Promise<number> => {
      const scrollY: number = await page.evaluate((count: number): number => {
        (window as TrackedWindow).press = count;
        return Math.round(window.scrollY);
      }, press);
      await page.keyboard.press("Enter");
      return scrollY;
    };

    // Enter: the read fails.
    const firstScrollY: number = await pressEnter(1);
    const banner: Locator = page.getByTestId("notes-action-error");
    await expect(banner).toBeFocused();
    await expect(banner).toBeInViewport();
    await expect(
      banner.getByTestId("notes-action-error-what-failed"),
    ).toHaveText("Couldn't load more notes.");
    // A box the focus waits in, not a control: no ring, as the feed has none.
    expect(
      await banner.evaluate((element: Element): string => {
        const style: CSSStyleDeclaration = getComputedStyle(element);
        return style.outlineStyle === "none" ||
          style.outlineColor === "rgba(0, 0, 0, 0)"
          ? "no ring"
          : `${style.outlineStyle} ${style.outlineColor}`;
      }),
    ).toBe("no ring");
    await expect(feed).not.toHaveAttribute("tabindex");

    // Tab, Tab: the reference's copy button, then Dismiss.
    await page.keyboard.press("Tab");
    await expect(
      banner.getByTestId("error-reference").getByRole("button"),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(banner.getByRole("button", { name: "Dismiss" })).toBeFocused();
    // The focus has moved on: the banner does not take it again.
    await expect(banner).not.toHaveAttribute("tabindex");

    await page.keyboard.press("Enter");
    await expect(banner).toHaveCount(0);
    await expect(loadMore).toBeFocused();

    // Enter: the last page comes, Load more goes, and the feed keeps the focus.
    const secondScrollY: number = await pressEnter(2);
    await expect(page.getByTestId("note-card")).toHaveCount(ALL_NOTES);
    await expect(loadMore).toHaveCount(0);
    await expect(feed).toBeFocused();

    const records: Array<FocusRecord> = await page.evaluate(
      (): Array<FocusRecord> => {
        return (window as TrackedWindow).focusRecords || [];
      },
    );
    expect(
      records.filter((record: FocusRecord) => {
        return record.focus === "the page";
      }),
      "changes to the page that left the focus on the page itself",
    ).toEqual([]);
    // While each read was on its way: on the feed, the page where it was.
    const reads: Array<{ press: number; scrollY: number }> = [
      { press: 1, scrollY: firstScrollY },
      { press: 2, scrollY: secondScrollY },
    ];
    for (const read of reads) {
      const reading: Array<FocusRecord> = records.filter(
        (record: FocusRecord) => {
          return record.press === read.press && record.isReading;
        },
      );
      expect(
        reading.length,
        `changes while read ${read.press} was on its way`,
      ).toBeGreaterThan(0);
      expect(
        reading.map((record: FocusRecord) => {
          return `${record.focus} at ${record.scrollY}`;
        }),
        `the focus, and how far down the page was, while read ${read.press} was on its way`,
      ).toEqual(
        reading.map(() => {
          return `notes-feed-body at ${read.scrollY}`;
        }),
      );
    }

    // The next Tab reaches the first control in the feed, and the feed lets go.
    await page.keyboard.press("Tab");
    expect(
      await feed.evaluate((element: Element): boolean => {
        return (
          document.activeElement !== element &&
          element.contains(document.activeElement)
        );
      }),
      "the focus is on a control in the feed",
    ).toBe(true);
    await expect(feed).not.toHaveAttribute("tabindex");
  });

  /*
   * The feed's body was focusable for good, for the moments it holds the
   * focus (#7706): it took every click on a note's words, and the next Tab
   * started over at its top, at the first note, rather than after what was
   * clicked. It is focusable only while it holds the focus now.
   */
  test("a click on a note's words leaves the focus with the page, and the next Tab goes on from that note", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASE_NOTES_PATH, { caseSetup: "notes-more-fail" });
    const cards: Locator = page.getByTestId("note-card");
    await expect(cards).toHaveCount(FIRST_PAGE, { timeout: 30000 });
    const feed: Locator = page.getByTestId("notes-feed-body");

    // The fifth note's words.
    await cards
      .nth(4)
      .getByText(/^Shift log \d+:/)
      .click();
    await expect(feed).not.toBeFocused();
    await expect(feed).not.toHaveAttribute("tabindex");
    expect(
      await page.evaluate((): boolean => {
        return document.activeElement === document.body;
      }),
      "the focus is on the page itself",
    ).toBe(true);

    // On from the fifth note, not from the first.
    await page.keyboard.press("Tab");
    expect(
      await cards.evaluateAll((elements: Array<Element>): number => {
        return elements.findIndex((element: Element) => {
          return element.contains(document.activeElement);
        });
      }),
      "the note the focus is in, counted from 0",
    ).toBeGreaterThanOrEqual(4);
  });
});

/*
 * Load more pressed from the keyboard with more pages left (#7706): the
 * focus waits on the feed while it reads - in Firefox it fell to the page
 * as Load more was disabled - and goes back to Load more once the notes
 * are drawn, so the next page is one key away, with the page left on the
 * notes that came; after the last page the feed keeps it.
 */
test.describe("a case's notes feed, paged with Load more", () => {
  test("pressed from the keyboard, Load more has the focus back once the next page is drawn, with the page left on the notes that came", async ({
    page,
  }: {
    page: Page;
  }) => {
    // CASE-142's 60 notes under ?casesetup=notes-more-pages: three pages.
    await open(page, CASE_NOTES_PATH, { caseSetup: "notes-more-pages" });
    const cards: Locator = page.getByTestId("note-card");
    await expect(cards).toHaveCount(25, { timeout: 30000 });
    const feed: Locator = page.getByTestId("notes-feed-body");
    const loadMore: Locator = page.getByTestId("notes-load-more");
    await loadMore.focus();

    // Counts each change to the page that left the focus on the page itself.
    await page.evaluate((): void => {
      const tracked: Window & { focusFellToPage?: number } = window;
      tracked.focusFellToPage = 0;
      new MutationObserver((): void => {
        if (document.activeElement === document.body) {
          tracked.focusFellToPage = (tracked.focusFellToPage || 0) + 1;
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    const scrollY: () => Promise<number> = (): Promise<number> => {
      return page.evaluate((): number => {
        return Math.round(window.scrollY);
      });
    };
    const scrollYBefore: number = await scrollY();

    await page.keyboard.press("Enter");
    await expect(cards).toHaveCount(50);
    await expect(loadMore).toBeEnabled();
    await expect(loadMore).toBeFocused();
    // The page where it was, on the first of the notes that came.
    expect(await scrollY(), "how far down the page is").toBe(scrollYBefore);
    await expect(cards.nth(25)).toBeInViewport();
    await expect(feed).not.toHaveAttribute("tabindex");

    // The last page: Load more goes, and the feed keeps the focus.
    await page.keyboard.press("Enter");
    await expect(cards).toHaveCount(60);
    await expect(loadMore).toHaveCount(0);
    await expect(feed).toBeFocused();
    expect(
      await page.evaluate((): number => {
        return (window as Window & { focusFellToPage?: number })
          .focusFellToPage as number;
      }),
      "changes to the page that left the focus on the page itself",
    ).toBe(0);
  });
});

/*
 * The count by a case's notes heading was drawn as it came, in Latin
 * digits, on a Persian page whose count over the notes was in its own
 * (#7646).
 */
test.describe("a case's notes count on a Persian page", () => {
  test("the count by the heading is in Persian digits, as the count over the notes is", async ({
    page,
  }: {
    page: Page;
  }) => {
    // CASE-142's 28 notes under ?casesetup=notes-more-fail.
    await open(page, CASE_NOTES_PATH, {
      caseSetup: "notes-more-fail",
      lang: "fa",
    });
    await expect(page.getByTestId("note-card")).toHaveCount(25, {
      timeout: 30000,
    });

    await expect(page.getByTestId("notes-count")).toHaveText("۲۸");
    await expect(page.getByTestId("notes-summary")).toContainText("۲۸");
  });
});

/*
 * A note whose post fails (#7647). The composer's error line drew what
 * API.getFriendlyMessage said: English on every page - on a Persian one
 * with its full stop at its start - and, for a failure the server could not
 * explain, nothing of why, what to do next or the reference to give. It
 * says what failed now, then why and what to do next with the reference
 * and its copy button, in the reader's language, read from the right; the
 * draft is kept, and the next post saves it.
 */
test.describe("a case's note composer, when a post fails", () => {
  test("says in Persian that the note was not posted, why, what to do and its reference, read from the right; posted again, the draft is saved", async ({
    page,
  }: {
    page: Page;
  }) => {
    // The Dashboard's Persian words, as the fixture draws them with ?lang=fa.
    const persian: Record<string, string> = JSON.parse(
      await fs.readFile(
        path.resolve(
          __dirname,
          "../../App/FeatureSet/Dashboard/src/Locales/fa.json",
        ),
        "utf8",
      ),
    ) as Record<string, string>;
    const NOTE: string = "Paged the identity on-call.";

    await open(page, CASE_NOTES_PATH, {
      caseSetup: "note-post-fail",
      lang: "fa",
    });
    await page
      .getByTestId("note-composer-prompt")
      .getByRole("button")
      .first()
      .click({ timeout: 30000 });
    const composer: Locator = page.getByTestId("note-composer");
    await expect(composer).toBeVisible();
    await page.keyboard.type(NOTE);
    await composer.getByTestId("note-submit").click();

    const line: Locator = composer.getByTestId("note-composer-error");
    await expect(line).toBeVisible();
    await expect(line).toHaveAttribute("role", "alert");

    // What failed, then why and what to do next.
    const whatFailed: Locator = line.getByTestId("error-what-failed");
    await expect(whatFailed).toHaveText(persian["Couldn't post the note."]!);
    const whyAndNext: Locator = line.getByTestId("error-why-and-next");
    await expect(whyAndNext).toContainText(
      persian["The server ran into a problem it could not explain."]!,
    );
    await expect(whyAndNext).toContainText(
      persian[
        "Try again. If it keeps failing, give this reference to whoever runs your OneUptime server:"
      ]!,
    );
    // The reference as written, left to right, with its copy button.
    const reference: Locator = line.getByTestId("error-reference");
    await expect(reference.locator("code")).toHaveText(FAILED_READ_REFERENCE);
    await expect(reference.locator("code")).toHaveAttribute("dir", "ltr");
    await expect(reference.getByRole("button")).toBeVisible();
    // Never the sentence as API.getFriendlyMessage wrote it, nor English.
    for (const english of [
      "Couldn't post the note.",
      "The server ran into a problem",
      "so this did not finish",
      "This did not finish.",
    ]) {
      await expect(line).not.toContainText(english);
    }

    /*
     * Read from the right: "یادداشت افزوده نشد." ends with its full stop,
     * drawn to the left of its last word - not at the line's start.
     */
    const drawn: { stop: DrawnPiece; lastWord: DrawnPiece } =
      await whatFailed.evaluate(
        (element: Element): { stop: DrawnPiece; lastWord: DrawnPiece } => {
          const text: Node = element.firstChild!;
          const content: string = text.textContent || "";
          const boxOf: (from: number, to: number) => DrawnPiece = (
            from: number,
            to: number,
          ): DrawnPiece => {
            const range: Range = document.createRange();
            range.setStart(text, from);
            range.setEnd(text, to);
            const box: DOMRect = range.getBoundingClientRect();
            return {
              text: content.slice(from, to),
              left: box.left,
              right: box.right,
            };
          };
          const stopAt: number = content.length - 1;
          const lastWordAt: number = content.lastIndexOf(" ") + 1;
          return {
            stop: boxOf(stopAt, stopAt + 1),
            lastWord: boxOf(lastWordAt, stopAt),
          };
        },
      );
    expect(drawn.stop.text, "the sentence's last character").toBe(".");
    expect(drawn.lastWord.text).toBe("نشد");
    expect(drawn.stop.right).toBeLessThanOrEqual(drawn.lastWord.left + 0.5);

    // The draft is kept.
    await expect(composer.locator('[contenteditable="true"]')).toHaveText(NOTE);

    await expectNoSidewaysScroll(page, {
      message: "the composer's error line",
    });
    await line.scrollIntoViewIfNeeded();
    await screenshot(page, "case-note-post-fail-fa-1280", { fullPage: false });

    // Posted again, the note is saved, and the line goes.
    await composer.getByTestId("note-submit").click();
    await expect(page.getByTestId("note-composer-error")).toHaveCount(0);
    const posted: FixtureState["creates"] = (
      await fixture(page)
    ).creates.filter((entry: FixtureState["creates"][number]): boolean => {
      return entry.modelName === "SecurityCaseNote";
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]?.data["note"]).toBe(NOTE);
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
     * written: "Contained:", never ":Contained", in the Persian menu. Each
     * is a line of its own that reads left to right (IsolatedLine, #6979),
     * so one too long for the menu is cut short at its own end.
     */
    for (const [line, written] of [
      ["note-template-name", "Containment checklist"],
      ["note-template-preview", "Contained:"],
    ] as Array<[string, string]>) {
      const drawn: Locator = menu
        .getByTestId(line)
        .filter({ hasText: written });
      await expect(drawn).toHaveCount(1);
      await expect(drawn).toHaveAttribute("dir", "ltr");
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

  /*
   * A recent note's time beside its author (#7648) read "20 minutes ago" on
   * every language's page, and a Persian page laid that English out from
   * the right: "minutes ago 20". It is in the reader's language now, its
   * count in the language's digits, and read from the right in the order it
   * is written.
   */
  test("a recent note's time reads in Persian, from the right in the order it is written", async ({
    page,
  }: {
    page: Page;
  }) => {
    // CASE-142's notes: Diego's, 20 minutes old, and Maya's, 35.
    await open(page, CASE_NOTES_PATH);
    const times: Locator = page.getByTestId("note-time");
    for (const written of ["20 minutes ago", "35 minutes ago"]) {
      await expect(times.filter({ hasText: written })).toHaveCount(1, {
        timeout: 30000,
      });
    }

    await open(page, CASE_NOTES_PATH, { lang: "fa" });
    for (const written of ["۲۰ دقیقه پیش", "۳۵ دقیقه پیش"]) {
      await expect(times.filter({ hasText: written })).toHaveCount(1, {
        timeout: 30000,
      });
    }
    await expect(times).toHaveCount(2);
    await expect(times.filter({ hasText: /ago|[0-9]/ })).toHaveCount(0);

    // Where each word and each digit of "۲۰ دقیقه پیش" is drawn.
    const drawn: Array<{ text: string; left: number; right: number }> =
      await times
        .filter({ hasText: "۲۰ دقیقه پیش" })
        .evaluate(
          (
            element: Element,
          ): Array<{ text: string; left: number; right: number }> => {
            const label: Node = element.firstChild!;
            const content: string = label.textContent || "";
            const boxOf: (
              from: number,
              to: number,
            ) => { text: string; left: number; right: number } = (
              from: number,
              to: number,
            ): { text: string; left: number; right: number } => {
              const range: Range = document.createRange();
              range.setStart(label, from);
              range.setEnd(label, to);
              const box: DOMRect = range.getBoundingClientRect();
              return {
                text: content.slice(from, to),
                left: box.left,
                right: box.right,
              };
            };
            const pieces: Array<{ text: string; left: number; right: number }> =
              [];
            let start: number = 0;
            for (const word of content.split(" ")) {
              pieces.push(boxOf(start, start + word.length));
              start += word.length + 1;
            }
            // The count's two digits, each on its own.
            pieces.push(boxOf(0, 1), boxOf(1, 2));
            return pieces;
          },
        );
    const [count, minutes, ago, firstDigit, secondDigit] = drawn;

    expect(
      [count!.text, minutes!.text, ago!.text, firstDigit!.text],
      "the words as written",
    ).toEqual(["۲۰", "دقیقه", "پیش", "۲"]);
    // From the right: the count, then the unit to its left, then "ago".
    expect(minutes!.right).toBeLessThanOrEqual(count!.left + 0.5);
    expect(ago!.right).toBeLessThanOrEqual(minutes!.left + 0.5);
    // The count is drawn as written: "۲۰", never "۰۲".
    expect(firstDigit!.right).toBeLessThanOrEqual(secondDigit!.left + 0.5);

    await times.filter({ hasText: "۲۰ دقیقه پیش" }).scrollIntoViewIfNeeded();
    await screenshot(page, "case-notes-time-fa-1280", { fullPage: false });
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
