import { expect, Locator, Page, test } from "@playwright/test";
import { pickDropdownOption } from "../SuiteHelpers/Dropdowns";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * SAVED FUNNELS AND RETENTION TABLES, IN A REAL BROWSER (issue #6718).
 *
 * The component suites (jsdom) cover the saved views menu, its dialogs, the
 * page address and the widgets one by one. This drives them together in
 * Chromium, where layout is real: a funnel saved on its page opens again
 * from the menu and from its link, says "(changed)" with Update once a step
 * changes, is renamed and deleted; on a 390px touch screen the menu opens
 * inside the screen with each row's Edit and Delete under its name (the
 * #6699 review found a panel that opened off it, which jsdom cannot see); a
 * retention table is saved and draws All cohorts over two cohorts or more,
 * and not over one; and a saved funnel put on a dashboard as a Funnel widget
 * draws its numbers, its corner link opening the Funnels page on it.
 *
 * Fixture/Fixture.js answers the reads and keeps what is saved for the tab.
 * The desktop project runs at 1280 pixels, the phone one at 390 with a
 * touch screen.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-00000000a718";
const APP_ID: string = "20000000-0000-4000-8000-00000000a718";
const DASHBOARD_ID: string = "30000000-0000-4000-8000-00000000a718";
// The first saved view's id, as the fixture numbers them.
const FIRST_SAVED_ID: string = "50000000-0000-4000-8000-000000000001";

const SCREENSHOTS: string =
  "../../output/playwright/product-analytics-saved-views-ui";

interface FixtureRecord {
  reads: Array<{ route: string; data: Record<string, unknown> }>;
  unexpected: Array<string>;
}

function rumPath(page: string, search: string = ""): string {
  return `/dashboard/${PROJECT_ID}/rum/${APP_ID}/${page}${search}`;
}

function funnelsPath(search: string = ""): string {
  return rumPath("product-analytics-funnels", search);
}

function retentionPath(search: string = ""): string {
  return rumPath("product-analytics-retention", search);
}

function boardPath(search: string = ""): string {
  return `/dashboard/${PROJECT_ID}/dashboards/${DASHBOARD_ID}${search}`;
}

function isPhone(): boolean {
  return Boolean(test.info().project.use.isMobile);
}

/*
 * A press as the reader makes it: a click at 1280, and on the phone the
 * click a tap ends in, after scrolling the control into view (Playwright's
 * own click cannot reach a control the phone emulation scrolled away).
 */
async function press(control: Locator): Promise<void> {
  if (!isPhone()) {
    await control.click();
    return;
  }

  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  await control.dispatchEvent("click");
}

async function fixtureRecord(page: Page): Promise<FixtureRecord> {
  return (await page.evaluate((): unknown => {
    return (window as unknown as Record<string, unknown>)[
      "__productAnalyticsSavedViewsFixture"
    ];
  })) as FixtureRecord;
}

// The saved views menu's button, which names the open one.
function savedMenuButton(page: Page, testId: string): Locator {
  return page.getByTestId(testId).getByRole("button").first();
}

async function openSavedMenu(
  page: Page,
  testId: string,
  name: string,
): Promise<Locator> {
  await press(savedMenuButton(page, testId));

  const panel: Locator = page.getByRole("dialog", { name: name });

  await expect(panel).toBeVisible();

  return panel;
}

// A saved view's row in the open menu: its name's button, Edit and Delete.
function savedRow(panel: Locator, name: string): Locator {
  return panel
    .getByRole("button", { name: name, exact: true })
    .locator("xpath=..");
}

/*
 * A row's own action (Edit, Delete), pressed as a reader reaches it: with a
 * mouse it shows while the row is hovered; on a touch screen it is always
 * there, under the name.
 */
async function pressRowAction(row: Locator, action: string): Promise<void> {
  if (!isPhone()) {
    await row.hover();
  }

  await press(row.getByRole("button", { name: action, exact: true }));
}

async function saveCurrentView(
  page: Page,
  panel: Locator,
  create: string,
  dialogName: string,
  name: string,
): Promise<void> {
  await press(panel.getByRole("button", { name: create }));

  const dialog: Locator = page.getByRole("dialog", { name: dialogName });

  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Name" }).fill(name);
  await press(dialog.getByRole("button", { name: dialogName }));
  await expect(dialog).toHaveCount(0);
}

// The conversion chart's rows, as a reader reads them.
async function conversionRows(page: Page): Promise<Array<string>> {
  // The list of steps' people, under Conversion (the step pickers' list has none).
  const conversion: Locator = page
    .getByRole("list")
    .filter({ hasText: "people" })
    .last();

  return (await conversion.getByRole("listitem").allInnerTexts()).map(
    (text: string): string => {
      return text.replace(/\s+/g, " ").trim();
    },
  );
}

test.afterEach(async ({ page }: { page: Page }) => {
  // Nothing the fixture does not model was asked for.
  expect((await fixtureRecord(page)).unexpected).toEqual([]);
});

test.describe("a saved funnel", () => {
  test("is saved, opens again from its link, says it changed with Update, and is renamed and deleted", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(funnelsPath());
    await expect(page.getByRole("combobox", { name: "Step 2" })).toBeVisible();
    await expect
      .poll(async (): Promise<Array<string>> => {
        return await conversionRows(page);
      })
      .toEqual([
        expect.stringContaining("Session started 1,000 people 100%"),
        expect.stringContaining("Signed up 420 people 42%"),
      ]);

    // + Save funnel: named, then the open one, checked, and in the address.
    let panel: Locator = await openSavedMenu(
      page,
      "product-analytics-funnels-saved",
      "Saved funnels",
    );

    await saveCurrentView(
      page,
      panel,
      "+ Save funnel",
      "Save funnel",
      "Checkout",
    );
    await expect(page).toHaveURL(new RegExp(`view=${FIRST_SAVED_ID}`));
    await expect(
      savedMenuButton(page, "product-analytics-funnels-saved"),
    ).toContainText("Checkout");

    panel = await openSavedMenu(
      page,
      "product-analytics-funnels-saved",
      "Saved funnels",
    );
    await expect(
      savedRow(panel, "Checkout").getByRole("button", {
        name: "Checkout",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");

    // Its link opens it for anyone who may see it: here, in a fresh load.
    await page.goto(funnelsPath(`?view=${FIRST_SAVED_ID}`));
    await expect(
      savedMenuButton(page, "product-analytics-funnels-saved"),
    ).toContainText("Checkout");
    await expect(page.getByRole("combobox", { name: "Step 2" })).toBeVisible();
    await expect
      .poll(async (): Promise<Array<string>> => {
        return await conversionRows(page);
      })
      .toEqual([
        expect.stringContaining("Session started 1,000 people 100%"),
        expect.stringContaining("Signed up 420 people 42%"),
      ]);

    // A step changed: its name says so, and Update saves the change.
    await pickDropdownOption(
      page,
      page.getByRole("combobox", { name: "Step 2" }),
      "Purchased",
    );
    await expect(
      savedMenuButton(page, "product-analytics-funnels-saved"),
    ).toContainText("Checkout (changed)");

    panel = await openSavedMenu(
      page,
      "product-analytics-funnels-saved",
      "Saved funnels",
    );
    /*
     * The open one's row says it changed too, and Update is its own action,
     * beside Edit and Delete.
     */
    await pressRowAction(savedRow(panel, "Checkout (changed)"), "Update");
    await expect(
      savedMenuButton(page, "product-analytics-funnels-saved"),
    ).not.toContainText("(changed)");

    // What was updated is what opens: reload, and Purchased is its second step.
    await page.reload();
    await expect(
      page
        .getByRole("listitem")
        .filter({ has: page.getByRole("combobox", { name: "Step 2" }) }),
    ).toContainText("Purchased");

    // Edit renames it.
    panel = await openSavedMenu(
      page,
      "product-analytics-funnels-saved",
      "Saved funnels",
    );
    await pressRowAction(savedRow(panel, "Checkout"), "Edit");

    const rename: Locator = page.getByRole("dialog", {
      name: "Rename saved funnel",
    });

    await expect(rename.getByRole("textbox", { name: "Name" })).toHaveValue(
      "Checkout",
    );
    await rename.getByRole("textbox", { name: "Name" }).fill("Checkout v2");
    await press(rename.getByRole("button", { name: "Save Changes" }));
    await expect(rename).toHaveCount(0);
    await expect(
      savedMenuButton(page, "product-analytics-funnels-saved"),
    ).toContainText("Checkout v2");

    // Delete deletes it for everyone; its link then says it is gone.
    panel = await openSavedMenu(
      page,
      "product-analytics-funnels-saved",
      "Saved funnels",
    );
    await pressRowAction(savedRow(panel, "Checkout v2"), "Delete");
    await press(page.getByTestId("modal-footer-submit-button"));
    await expect(page.getByTestId("modal")).toHaveCount(0);

    await page.goto(funnelsPath(`?view=${FIRST_SAVED_ID}`));
    await expect(
      page.getByText(
        "The saved funnel this link opens was deleted, or you cannot see it.",
        { exact: false },
      ),
    ).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Step 2" })).toBeVisible();

    await page.screenshot({
      path: `${SCREENSHOTS}/saved-funnel-deleted-${test.info().project.name}.png`,
      fullPage: true,
    });
  });

  test("opens its menu inside the screen, each row's Edit and Delete under its name, and the page never scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(funnelsPath());

    let panel: Locator = await openSavedMenu(
      page,
      "product-analytics-funnels-saved",
      "Saved funnels",
    );

    await saveCurrentView(
      page,
      panel,
      "+ Save funnel",
      "Save funnel",
      "Sign-up to first purchase, every device",
    );

    panel = await openSavedMenu(
      page,
      "product-analytics-funnels-saved",
      "Saved funnels",
    );

    const box: { x: number; width: number } | null = await panel.boundingBox();
    const width: number = page.viewportSize()?.width || 0;

    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);

    const row: Locator = savedRow(
      panel,
      "Sign-up to first purchase, every device",
    );

    // With a mouse a row's actions show while it is hovered.
    if (!isPhone()) {
      await row.hover();
    }

    // Read in one frame: the menu may still be settling where it opened.
    const [name, edit, remove]: Array<FrameBox> = await boxesInOneFrame([
      row.getByRole("button", {
        name: "Sign-up to first purchase, every device",
        exact: true,
      }),
      row.getByRole("button", { name: "Edit" }),
      row.getByRole("button", { name: "Delete" }),
    ]);

    for (const control of [edit!, remove!]) {
      expect(control.x).toBeGreaterThanOrEqual(0);
      expect(control.x + control.width).toBeLessThanOrEqual(width);
    }

    if (isPhone()) {
      // Under its name on a touch screen, where hover reveals nothing.
      expect(edit!.y).toBeGreaterThanOrEqual(name!.y + name!.height - 1);
      expect(remove!.y).toBeGreaterThanOrEqual(name!.y + name!.height - 1);
    }

    await expectNoSidewaysScroll(page, {
      message: `the Funnels page with its saved menu open, ${test.info().project.name}`,
    });

    await page.screenshot({
      path: `${SCREENSHOTS}/saved-funnels-menu-${test.info().project.name}.png`,
    });
  });

  test("reads the same in the dark theme, in German and in Persian, and fits a phone in each", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [search, menuName, title] of [
      ["?theme=dark", "Saved funnels", "Funnels"],
      ["?lang=de", "Gespeicherte Trichter", "Trichter"],
      ["?lang=fa", "قیف‌های ذخیره‌شده", "قیف‌ها"],
    ] as Array<[string, string, string]>) {
      await page.goto(funnelsPath(search));
      await expect(
        page.getByRole("heading", { name: title, exact: true }),
      ).toBeVisible();

      await press(savedMenuButton(page, "product-analytics-funnels-saved"));

      const panel: Locator = page.getByRole("dialog", { name: menuName });

      await expect(panel).toBeVisible();

      const box: { x: number; width: number } | null =
        await panel.boundingBox();
      const width: number = page.viewportSize()?.width || 0;

      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);

      await expectNoSidewaysScroll(page, {
        message: `the Funnels page ${search}, ${test.info().project.name}`,
      });
      await page.screenshot({
        path: `${SCREENSHOTS}/saved-funnels-menu-${search.slice(1).replace("=", "-")}-${test.info().project.name}.png`,
      });
    }
  });
});

test.describe("a saved retention table", () => {
  test("is saved and opens again from its link, All cohorts above two cohorts or more", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(retentionPath());
    await expect(
      page.getByTestId("product-analytics-retention-table-average-row"),
    ).toBeVisible();
    await expect(
      page.getByTestId("product-analytics-retention-table-average-row"),
    ).toContainText("All cohorts");

    const panel: Locator = await openSavedMenu(
      page,
      "product-analytics-retention-saved",
      "Saved retention tables",
    );

    await saveCurrentView(
      page,
      panel,
      "+ Save retention table",
      "Save retention table",
      "Weekly return",
    );
    await expect(page).toHaveURL(new RegExp(`view=${FIRST_SAVED_ID}`));

    await page.goto(retentionPath(`?view=${FIRST_SAVED_ID}`));
    await expect(
      savedMenuButton(page, "product-analytics-retention-saved"),
    ).toContainText("Weekly return");
    await expect(
      page.getByTestId("product-analytics-retention-table-row"),
    ).toHaveCount(3);
    await expectNoSidewaysScroll(page, {
      message: `the User Retention page, ${test.info().project.name}`,
    });
    await page.screenshot({
      path: `${SCREENSHOTS}/saved-retention-table-${test.info().project.name}.png`,
      fullPage: true,
    });
  });

  test("draws no All cohorts row over one cohort", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(retentionPath("?cohorts=1"));
    await expect(
      page.getByTestId("product-analytics-retention-table-row"),
    ).toHaveCount(1);
    await expect(
      page.getByTestId("product-analytics-retention-table-average-row"),
    ).toHaveCount(0);
  });
});

test.describe("a saved funnel on a dashboard", () => {
  test("is added as a Funnel widget, draws its numbers, and its corner link opens it on its page", async ({
    page,
  }: {
    page: Page;
  }) => {
    // A funnel saved on its page first.
    await page.goto(funnelsPath());

    const panel: Locator = await openSavedMenu(
      page,
      "product-analytics-funnels-saved",
      "Saved funnels",
    );

    await saveCurrentView(
      page,
      panel,
      "+ Save funnel",
      "Save funnel",
      "Checkout",
    );

    // Add Widget > Product Analytics > Funnel, with the saved funnel picked.
    await page.goto(boardPath());
    await press(page.getByRole("button", { name: "More dashboard options" }));
    await press(page.getByRole("menuitem", { name: "Edit Dashboard" }));
    await press(page.getByTitle("Add Widget").first());
    await page.getByTestId("add-widget-search").fill("Funnel");
    await press(page.getByTestId("widget-card-ProductAnalyticsFunnel"));

    const settings: Locator = page.getByTestId("modal");

    await expect(settings).toBeVisible();
    // Said where the saved funnel is picked: a public dashboard shows only its title (#6717).
    await expect(settings).toContainText(
      "Public dashboards show only its title.",
    );
    await settings
      .getByText("Public dashboards show only its title.", { exact: false })
      .scrollIntoViewIfNeeded();
    await settings.screenshot({
      path: `${SCREENSHOTS}/funnel-widget-settings-${test.info().project.name}.png`,
    });
    await pickDropdownOption(
      page,
      settings.getByRole("combobox").first(),
      /Checkout/,
    );
    await press(settings.getByRole("button", { name: "Done" }));
    await expect(settings).toHaveCount(0);
    await press(
      page.getByRole("button", { name: "Save Changes", exact: true }),
    );

    // Its title, its steps' numbers, in the dashboard's time range.
    const widget: Locator = page.getByTestId(
      "dashboard-product-analytics-funnel",
    );

    await expect(widget).toBeVisible();
    await expect(widget).toContainText("Checkout");
    await expect(widget).toContainText("1,000");
    await expect(widget).toContainText("420");

    const reads: FixtureRecord["reads"] = (await fixtureRecord(page)).reads;
    const funnelReads: Array<Record<string, unknown>> = reads
      .filter((read: { route: string }) => {
        return read.route === "funnel";
      })
      .map((read: { data: Record<string, unknown> }) => {
        return read.data;
      });

    expect(funnelReads.length).toBeGreaterThan(0);

    // The corner link opens the Funnels page on the saved funnel.
    const open: Locator = widget.getByRole("link", { name: /Open in Funnels/ });

    await expect(open).toHaveAttribute(
      "href",
      new RegExp(
        `/rum/${APP_ID}/product-analytics-funnels\\?.*view=${FIRST_SAVED_ID}`,
      ),
    );

    await page.screenshot({
      path: `${SCREENSHOTS}/funnel-widget-${test.info().project.name}.png`,
      fullPage: true,
    });

    await press(open);
    await expect(page).toHaveURL(new RegExp("/product-analytics-funnels"));
    await expect(
      savedMenuButton(page, "product-analytics-funnels-saved"),
    ).toContainText("Checkout");
  });
});
