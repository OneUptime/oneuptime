import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Delete on the real Status Pages list, in a browser, against the offline
 * fixture (ListDelete/Fixture): the row's ⋯ menu, the bulk bar, both
 * confirmations, a bulk Delete the server refuses part of, a member who may
 * not delete, the Archived page, and the page a bulk Delete empties.
 *
 * The maintainer's ask: "Please also have delete options here and in bulk
 * actions" - the screenshot was this list's ⋯ menu holding only Show ID.
 * Every Delete here goes through its confirmation, and the fixture records
 * each DELETE the page sends, so the tests check what was deleted as well as
 * what the page drew.
 */

const ROUTE: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/status-pages";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/list-delete-ui",
);

const IDS: Record<string, string> = {
  demo13: "30000000-0000-4000-8000-000000000001",
  demo: "30000000-0000-4000-8000-000000000002",
  production: "30000000-0000-4000-8000-000000000003",
  oldMarketing: "30000000-0000-4000-8000-000000000004",
  staging: "30000000-0000-4000-8000-000000000005",
};

// DeleteConsequences' sentence for a status page.
const STATUS_PAGE_CONSEQUENCE: string =
  "Deleting a status page also deletes its subscribers, private users and custom domains.";

// ARCHIVE_INSTEAD_OF_DELETE, said on the live list only.
const ARCHIVE_INSTEAD: string =
  "To take it off this list and keep everything, archive it instead.";

const REFUSAL: string =
  "You do not have permission to delete this Status Page. You need to have one of the following labels: Marketing.";

interface RecordedDelete {
  tableName: string;
  id: string;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
});

test.afterEach(({ page }: { page: Page }) => {
  // A Delete that threw while drawing is a bug even when the test passed.
  expect(pageErrors.get(page) || []).toEqual([]);
});

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: false,
    animations: "disabled",
  });
}

async function openList(page: Page, search: string = ""): Promise<void> {
  await page.goto(`${ROUTE}${search}`);
  await expect(
    page.getByTestId("row-actions-more-button").first(),
  ).toBeVisible();
}

function row(page: Page, name: string): Locator {
  return page
    .locator("tbody tr")
    .filter({ has: page.getByText(name, { exact: true }) });
}

function rowNames(page: Page): Locator {
  return page.locator("tbody tr");
}

async function deletesSent(page: Page): Promise<Array<RecordedDelete>> {
  return await page.evaluate((): Array<RecordedDelete> => {
    return (
      window as unknown as {
        __fixture: { deletes: Array<RecordedDelete> };
      }
    ).__fixture.deletes;
  });
}

async function openRowMenu(page: Page, name: string): Promise<Locator> {
  await row(page, name).getByTestId("row-actions-more-button").click();
  const menu: Locator = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

async function selectRows(page: Page, names: Array<string>): Promise<void> {
  for (const name of names) {
    await row(page, name).locator('input[type="checkbox"]').check();
  }
}

async function openBulkMenu(page: Page): Promise<Locator> {
  await page.getByText("Bulk Actions", { exact: true }).click();
  const menu: Locator = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

function dialog(page: Page): Locator {
  return page.getByTestId("modal");
}

test.describe("a row's ⋯ menu", () => {
  test("offers Delete, last and apart from the everyday actions", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page);
    const menu: Locator = await openRowMenu(page, "Demo Status");

    await expect(menu.getByRole("menuitem")).toHaveText(["Show ID", "Delete"]);
    // MoreMenuDivider: the gap between the everyday actions and Delete.
    await expect(menu.locator('[role="none"].py-1')).toHaveCount(1);
    await expect(
      menu.getByRole("menuitem", { name: "Delete" }),
    ).not.toHaveAttribute("aria-disabled", "true");

    await screenshot(page, "row-menu");
  });

  test("asks first, naming the status page and what goes with it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page);
    const menu: Locator = await openRowMenu(page, "Demo Status");
    await menu.getByRole("menuitem", { name: "Delete" }).click();

    await expect(dialog(page)).toBeVisible();
    await expect(
      dialog(page).getByRole("heading", { name: "Delete Status Page" }),
    ).toBeVisible();
    await expect(page.getByTestId("delete-confirmation-message")).toHaveText(
      `Are you sure you want to delete Demo Status? This action cannot be undone. ${STATUS_PAGE_CONSEQUENCE} ${ARCHIVE_INSTEAD}`,
    );
    // The name is the record, drawn apart from the sentence around it.
    await expect(
      page.getByTestId("delete-confirmation-message").locator("strong", {
        hasText: "Demo Status",
      }),
    ).toBeVisible();
    // What goes with it is a paragraph of its own under the question.
    await expect(
      page.getByTestId("delete-confirmation-consequence"),
    ).toHaveText(`${STATUS_PAGE_CONSEQUENCE} ${ARCHIVE_INSTEAD}`);

    await screenshot(page, "row-delete-dialog");

    // Nothing is deleted until the danger button is pressed.
    expect(await deletesSent(page)).toEqual([]);
  });

  test("Cancel deletes nothing", async ({ page }: { page: Page }) => {
    await openList(page);
    const menu: Locator = await openRowMenu(page, "Demo Status");
    await menu.getByRole("menuitem", { name: "Delete" }).click();

    await dialog(page).getByRole("button", { name: "Cancel" }).click();

    await expect(dialog(page)).toBeHidden();
    await expect(rowNames(page)).toHaveCount(3);
    expect(await deletesSent(page)).toEqual([]);
  });

  test("Delete deletes that status page, and only it, and the list refreshes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page);
    const menu: Locator = await openRowMenu(page, "Demo Status");
    await menu.getByRole("menuitem", { name: "Delete" }).click();

    await dialog(page).getByTestId("modal-footer-submit-button").click();

    await expect(dialog(page)).toBeHidden();
    await expect(row(page, "Demo Status")).toHaveCount(0);
    await expect(rowNames(page)).toHaveCount(2);
    await expect(row(page, "Demo Status 13")).toHaveCount(1);
    await expect(row(page, "Production Status Page")).toHaveCount(1);
    await expect(page.getByText("Showing 1-2 of 2 status pages")).toBeVisible();

    expect(await deletesSent(page)).toEqual([
      { tableName: "StatusPage", id: IDS["demo"] },
    ]);
  });
});

test.describe("Bulk Actions", () => {
  test("offer Delete beside the list's other actions, as a danger action", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page);
    await selectRows(page, ["Demo Status 13", "Demo Status"]);
    await expect(page.getByText("2 Status Pages Selected")).toBeVisible();

    const menu: Locator = await openBulkMenu(page);
    const titles: Array<string> = await menu
      .getByRole("menuitem")
      .allInnerTexts();

    // Danger actions are listed last, after a divider: Delete is the last.
    expect(titles[titles.length - 1]?.trim()).toBe("Delete");
    expect(titles).toContain("Archive");
    await expect(
      menu.getByRole("menuitem", { name: "Delete" }),
    ).not.toHaveAttribute("aria-disabled", "true");

    await screenshot(page, "bulk-menu");
  });

  test("ask first: the count, the names, and what goes with them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page);
    await selectRows(page, ["Demo Status 13", "Demo Status"]);
    const menu: Locator = await openBulkMenu(page);
    await menu.getByRole("menuitem", { name: "Delete" }).click();

    await expect(
      dialog(page).getByRole("heading", { name: "Delete 2 Status Pages" }),
    ).toBeVisible();
    await expect(page.getByTestId("confirm-modal-description")).toHaveText(
      "Are you sure you want to delete 2 Status Pages? This action cannot be undone.",
    );
    await expect(page.getByTestId("delete-confirmation-item")).toHaveText([
      "Demo Status 13",
      "Demo Status",
    ]);
    // After the names, a paragraph of its own.
    await expect(page.getByTestId("bulk-delete-consequence")).toHaveText(
      `${STATUS_PAGE_CONSEQUENCE} ${ARCHIVE_INSTEAD}`,
    );
    await expect(
      dialog(page).getByTestId("modal-footer-submit-button"),
    ).toHaveText("Delete");

    await screenshot(page, "bulk-delete-dialog");
    expect(await deletesSent(page)).toEqual([]);
  });

  test("delete exactly the selected status pages, then clear the selection and refresh the list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page);
    await selectRows(page, ["Demo Status 13", "Demo Status"]);
    const menu: Locator = await openBulkMenu(page);
    await menu.getByRole("menuitem", { name: "Delete" }).click();
    await dialog(page).getByTestId("modal-footer-submit-button").click();

    await expect(dialog(page).getByText("Completed")).toBeVisible();
    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "2 Status Pages deleted",
    );
    await expect(page.getByTestId("bulk-action-failed-count")).toHaveCount(0);

    await dialog(page).getByRole("button", { name: "Close" }).click();

    await expect(dialog(page)).toBeHidden();
    await expect(page.getByText("2 Status Pages Selected")).toHaveCount(0);
    await expect(rowNames(page)).toHaveCount(1);
    await expect(row(page, "Production Status Page")).toHaveCount(1);

    expect(
      (await deletesSent(page)).map((sent: RecordedDelete): string => {
        return sent.id;
      }),
    ).toEqual([IDS["demo13"], IDS["demo"]]);
  });

  test("delete the rest when the server refuses one, and say which and why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, `?refuse=${IDS["production"]}`);
    await page.locator("thead").locator('input[type="checkbox"]').check();
    await expect(page.getByText("3 Status Pages Selected")).toBeVisible();

    const menu: Locator = await openBulkMenu(page);
    await menu.getByRole("menuitem", { name: "Delete" }).click();
    await dialog(page).getByTestId("modal-footer-submit-button").click();

    await expect(dialog(page).getByText("Completed")).toBeVisible();
    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "2 Status Pages deleted",
    );
    await expect(page.getByTestId("bulk-action-failed-count")).toHaveText(
      "1 Status Page not deleted",
    );
    const failures: Locator = page.getByTestId("bulk-action-failed-items");
    await expect(failures).toContainText("Status Page: Production Status Page");
    await expect(failures).toContainText(REFUSAL);

    await screenshot(page, "bulk-delete-partial-failure");

    await dialog(page).getByRole("button", { name: "Close" }).click();

    // The one the server refused is still listed; the rest are gone.
    await expect(rowNames(page)).toHaveCount(1);
    await expect(row(page, "Production Status Page")).toHaveCount(1);
    await expect(page.getByText(/Status Pages? Selected/)).toHaveCount(0);

    // Every selected row was tried, the refused one included.
    expect(
      (await deletesSent(page)).map((sent: RecordedDelete): string => {
        return sent.id;
      }),
    ).toEqual([IDS["demo13"], IDS["demo"], IDS["production"]]);
  });

  test("land on the last page with rows when they empty the page they started on", async ({
    page,
  }: {
    page: Page;
  }) => {
    // 3 + 10 status pages, 10 to a page: page 2 holds three.
    await openList(page, "?rows=10");
    await page.getByRole("button", { name: "Go to page 2" }).click();
    await expect(rowNames(page)).toHaveCount(3);

    await page.locator("thead").locator('input[type="checkbox"]').check();
    const menu: Locator = await openBulkMenu(page);
    await menu.getByRole("menuitem", { name: "Delete" }).click();
    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "3 Status Pages deleted",
    );
    await dialog(page).getByRole("button", { name: "Close" }).click();

    // Page 1, with its ten rows - not an empty page 2.
    await expect(rowNames(page)).toHaveCount(10);
    await expect(
      page.getByText("Showing 1-10 of 10 status pages"),
    ).toBeVisible();
  });
});

test.describe("a member who may not delete status pages", () => {
  test("sees the row's Delete locked, saying which permission is missing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "?role=viewer");
    const menu: Locator = await openRowMenu(page, "Demo Status");
    const item: Locator = menu.getByRole("menuitem", { name: "Delete" });

    await expect(item).toHaveAttribute("aria-disabled", "true");
    await item.hover();
    await expect(page.getByRole("tooltip")).toContainText(
      "You do not have permission to delete this Status Page.",
    );

    await screenshot(page, "row-delete-locked");

    await item.click({ force: true });
    await expect(dialog(page)).toHaveCount(0);
    expect(await deletesSent(page)).toEqual([]);
  });

  test("sees the bulk Delete locked too, and nothing is deleted", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "?role=viewer");
    await selectRows(page, ["Demo Status"]);
    const menu: Locator = await openBulkMenu(page);
    const item: Locator = menu.getByRole("menuitem", { name: "Delete" });

    await expect(item).toHaveAttribute("aria-disabled", "true");
    await item.click({ force: true });
    await expect(dialog(page)).toHaveCount(0);
    expect(await deletesSent(page)).toEqual([]);
  });
});

test.describe("the Archived page", () => {
  test("deletes from the row's ⋯ menu, without suggesting to archive what is archived", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "?page=archived");
    await expect(rowNames(page)).toHaveCount(2);

    const menu: Locator = await openRowMenu(page, "Old Marketing Page");
    await menu.getByRole("menuitem", { name: "Delete" }).click();

    await expect(page.getByTestId("delete-confirmation-message")).toHaveText(
      `Are you sure you want to delete Old Marketing Page? This action cannot be undone. ${STATUS_PAGE_CONSEQUENCE}`,
    );
    await expect(dialog(page)).not.toContainText("archive it instead");

    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(row(page, "Old Marketing Page")).toHaveCount(0);
    await expect(rowNames(page)).toHaveCount(1);
    expect(await deletesSent(page)).toEqual([
      { tableName: "StatusPage", id: IDS["oldMarketing"] },
    ]);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("the row's ⋯ menu offers Delete, and its dialog deletes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page);
    // Rows are cards here: the second card is Demo Status.
    await page.getByTestId("row-actions-more-button").nth(1).click();
    const menu: Locator = page.getByRole("menu");
    // Show ID is left off phones (hideOnMobile); Delete is not.
    await expect(menu.getByRole("menuitem")).toHaveText(["Delete"]);
    await menu.getByRole("menuitem", { name: "Delete" }).click();

    await expect(page.getByTestId("delete-confirmation-message")).toContainText(
      "Are you sure you want to delete Demo Status?",
    );
    const submit: Locator = dialog(page).getByTestId(
      "modal-footer-submit-button",
    );
    // The whole dialog fits the screen, its buttons included.
    await expect(submit).toBeInViewport();

    await screenshot(page, "row-delete-dialog-phone");

    await submit.click();
    await expect(dialog(page)).toBeHidden();
    expect(await deletesSent(page)).toEqual([
      { tableName: "StatusPage", id: IDS["demo"] },
    ]);
  });
});

test.describe("in dark mode", () => {
  test("the Delete dialogs are drawn in the dark theme", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "?theme=dark");
    await expect(page.locator("html")).toHaveClass(/dark/);

    const menu: Locator = await openRowMenu(page, "Demo Status");
    await menu.getByRole("menuitem", { name: "Delete" }).click();
    await expect(
      page.getByTestId("delete-confirmation-consequence"),
    ).toBeVisible();
    await screenshot(page, "row-delete-dialog-dark");
    await dialog(page).getByRole("button", { name: "Cancel" }).click();

    await selectRows(page, ["Demo Status 13", "Demo Status"]);
    const bulkMenu: Locator = await openBulkMenu(page);
    await bulkMenu.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByTestId("bulk-delete-consequence")).toBeVisible();
    await screenshot(page, "bulk-delete-dialog-dark");
  });
});
