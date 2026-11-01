import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Delete on the real Status Pages list, in a browser, against the offline
 * fixture (ListDelete/Fixture): the row's ⋯ menu, the bulk bar, both
 * confirmations, a bulk Delete the server refuses part of, a member who may
 * not delete, the Archived page, and the page a bulk Delete empties. Then
 * the same Delete where a row can't always go: an incident's State Timeline
 * (its only state) and the Teams list (the teams every project comes with).
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

    // The list's own Archive first, then what every row carries.
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Archive",
      "Show ID",
      "Delete",
    ]);
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
      "Are you sure you want to delete 2 status pages? This action cannot be undone.",
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
    // Show ID is left off phones (hideOnMobile); Archive and Delete are not.
    await expect(menu.getByRole("menuitem")).toHaveText(["Archive", "Delete"]);
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

/*
 * An incident's State Timeline page: the same row ⋯ menu and Bulk Actions,
 * with a Delete that knows the rule its service follows - the incident's
 * only state can't go, and every other row's dialog says what deleting it
 * does to the states around it.
 */
const PROJECT_PATH: string = "/dashboard/10000000-0000-4000-8000-000000000001";

const INCIDENT_WITH_HISTORY: string = "40000000-0000-4000-8000-000000000001";
const INCIDENT_JUST_DECLARED: string = "40000000-0000-4000-8000-000000000002";

const TIMELINE_IDS: Record<string, string> = {
  created: "42000000-0000-4000-8000-000000000001",
  acknowledged: "42000000-0000-4000-8000-000000000002",
  resolved: "42000000-0000-4000-8000-000000000003",
  declared: "42000000-0000-4000-8000-000000000004",
};

// ONLY_STATE_DELETE_MESSAGES' words for an incident: the server's refusal.
const ONLY_INCIDENT_STATE: string =
  "The incident's only state can't be deleted: an incident always has a state. To change it, add a new state.";

function timelinePath(incidentId: string, search: string = ""): string {
  return `${PROJECT_PATH}/incidents/${incidentId}/state-timeline?page=incident-timeline${search}`;
}

async function openPath(page: Page, pathWithQuery: string): Promise<void> {
  await page.goto(pathWithQuery);
  await expect(
    page.getByTestId("row-actions-more-button").first(),
  ).toBeVisible();
}

function stateRowQuestion(page: Page): Locator {
  return page.getByTestId("state-row-delete-confirmation");
}

test.describe("an incident's State Timeline", () => {
  test("keeps Delete on the incident's only state locked, in the server's words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPath(page, timelinePath(INCIDENT_JUST_DECLARED));
    await expect(rowNames(page)).toHaveCount(1);

    const menu: Locator = await openRowMenu(page, "Created");
    const item: Locator = menu.getByRole("menuitem", { name: "Delete" });

    await expect(item).toHaveAttribute("aria-disabled", "true");
    await item.hover();
    await expect(page.getByRole("tooltip")).toContainText(ONLY_INCIDENT_STATE);

    await screenshot(page, "timeline-only-state-locked");

    await item.click({ force: true });
    await expect(dialog(page)).toHaveCount(0);
    expect(await deletesSent(page)).toEqual([]);
  });

  test("the newest state: its dialog names it and says the one before becomes current again, and Delete deletes it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPath(page, timelinePath(INCIDENT_WITH_HISTORY));
    await expect(rowNames(page)).toHaveCount(3);

    const menu: Locator = await openRowMenu(page, "Resolved");
    const item: Locator = menu.getByRole("menuitem", { name: "Delete" });

    // More than one state: nothing is locked.
    await expect(item).not.toHaveAttribute("aria-disabled", "true");
    await item.click();

    // A row is a state change, not the model's "Incident State Timeline".
    await expect(
      dialog(page).getByRole("heading", { name: "Delete State Change" }),
    ).toBeVisible();
    await expect(stateRowQuestion(page)).toContainText(
      "Are you sure you want to delete the Resolved state that started",
    );
    await expect(stateRowQuestion(page)).toContainText(
      "Acknowledged, the state before it, becomes the incident's current state again.",
    );
    await expect(stateRowQuestion(page)).toContainText(
      "This action cannot be undone.",
    );
    // The states are the record's words, drawn apart from the sentence.
    await expect(
      stateRowQuestion(page).locator("strong", { hasText: "Resolved" }),
    ).toBeVisible();
    await expect(
      stateRowQuestion(page).locator("strong", { hasText: "Acknowledged" }),
    ).toBeVisible();
    await expect(
      dialog(page).getByTestId("modal-footer-submit-button"),
    ).toHaveText("Delete");

    /*
     * What deleting it does is a paragraph of its own under the question and
     * "This action cannot be undone.", as every Delete dialog sets apart what
     * goes with a record - not a sentence in the middle of the question.
     */
    const effect: Locator = dialog(page).getByTestId("state-row-delete-effect");
    await expect(effect).toHaveText(
      "Acknowledged, the state before it, becomes the incident's current state again.",
    );
    await expect(effect).toHaveCSS("display", "block");
    const startsAt: Locator = dialog(page).getByTestId(
      "delete-confirmation-starts-at",
    );
    expect((await effect.boundingBox())!.y).toBeGreaterThan(
      (await startsAt.boundingBox())!.y +
        (await startsAt.boundingBox())!.height,
    );
    // When it began is one thing, on one line: it broke after "Oct" here.
    expect(
      await startsAt.evaluate((element: Element): number => {
        return element.getClientRects().length;
      }),
    ).toBe(1);
    await expect(stateRowQuestion(page)).toContainText(
      "This action cannot be undone. Acknowledged, the state before it",
    );

    await screenshot(page, "timeline-newest-state-dialog");
    expect(await deletesSent(page)).toEqual([]);

    await dialog(page).getByTestId("modal-footer-submit-button").click();

    await expect(dialog(page)).toBeHidden();
    await expect(rowNames(page)).toHaveCount(2);
    await expect(row(page, "Resolved")).toHaveCount(0);
    // The state before it is the current one again.
    await expect(row(page, "Acknowledged")).toContainText("Currently Active");
    expect(await deletesSent(page)).toEqual([
      { tableName: "IncidentStateTimeline", id: TIMELINE_IDS["resolved"] },
    ]);
  });

  test("a state in the middle: its dialog says the one before takes over its time", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPath(page, timelinePath(INCIDENT_WITH_HISTORY));

    const menu: Locator = await openRowMenu(page, "Acknowledged");
    await menu.getByRole("menuitem", { name: "Delete" }).click();

    await expect(stateRowQuestion(page)).toContainText(
      "Are you sure you want to delete the Acknowledged state that started",
    );
    await expect(stateRowQuestion(page)).toContainText(
      "Created, the state before it, takes over its time.",
    );
    await expect(stateRowQuestion(page)).not.toContainText(
      "current state again",
    );

    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(rowNames(page)).toHaveCount(3);
    expect(await deletesSent(page)).toEqual([]);
  });

  test("the oldest state: its dialog only asks", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPath(page, timelinePath(INCIDENT_WITH_HISTORY));

    const menu: Locator = await openRowMenu(page, "Created");
    await menu.getByRole("menuitem", { name: "Delete" }).click();

    await expect(stateRowQuestion(page)).toContainText(
      "Are you sure you want to delete the Created state that started",
    );
    await expect(stateRowQuestion(page)).toContainText(
      "This action cannot be undone.",
    );
    await expect(stateRowQuestion(page)).not.toContainText(
      "the state before it",
    );
  });

  test("a bulk Delete names each state by its name and start, and says the rule", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPath(page, timelinePath(INCIDENT_WITH_HISTORY));
    await selectRows(page, ["Resolved", "Acknowledged"]);

    await expect(page.getByText("2 State Changes Selected")).toBeVisible();
    const menu: Locator = await openBulkMenu(page);
    await menu.getByRole("menuitem", { name: "Delete" }).click();

    await expect(
      dialog(page).getByRole("heading", { name: "Delete 2 State Changes" }),
    ).toBeVisible();
    // Named by state and start, never by id.
    await expect(page.getByTestId("delete-confirmation-item")).toHaveText([
      /^Resolved \(.+\)$/,
      /^Acknowledged \(.+\)$/,
    ]);
    await expect(page.getByTestId("bulk-delete-consequence")).toHaveText(
      "The state before each deleted state takes over its time, so deleting the newest one changes the incident's current state.",
    );

    await screenshot(page, "timeline-bulk-delete-dialog");

    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "2 State Changes deleted",
    );
    await expect(page.getByTestId("bulk-action-failed-count")).toHaveCount(0);
    await dialog(page).getByRole("button", { name: "Close" }).click();

    await expect(rowNames(page)).toHaveCount(1);
    await expect(row(page, "Created")).toContainText("Currently Active");
    expect(
      (await deletesSent(page)).map((sent: RecordedDelete): string => {
        return sent.id;
      }),
    ).toEqual([TIMELINE_IDS["resolved"], TIMELINE_IDS["acknowledged"]]);
  });

  test("the dialog reads in dark mode", async ({ page }: { page: Page }) => {
    await openPath(page, timelinePath(INCIDENT_WITH_HISTORY, "&theme=dark"));
    await expect(page.locator("html")).toHaveClass(/dark/);

    const menu: Locator = await openRowMenu(page, "Resolved");
    await menu.getByRole("menuitem", { name: "Delete" }).click();
    await expect(stateRowQuestion(page)).toBeVisible();

    await screenshot(page, "timeline-newest-state-dialog-dark");
  });
});

/*
 * The Teams list: Owners and Admin come with every project and are never
 * deleted - their Delete stays in the row's menu, locked, saying why - while
 * a project's own team deletes like any other row.
 */
const TEAMS_PATH: string = `${PROJECT_PATH}/settings/teams?page=teams`;

const TEAM_IDS: Record<string, string> = {
  owners: "50000000-0000-4000-8000-000000000001",
  admin: "50000000-0000-4000-8000-000000000002",
  members: "50000000-0000-4000-8000-000000000003",
  platform: "50000000-0000-4000-8000-000000000004",
};

const BUILT_IN_TEAM: string =
  "This team comes with every project and can't be deleted.";

const TEAM_CONSEQUENCE: string =
  "Deleting a team takes away the permissions it gave its members. Anyone for whom it was their only team loses access to the project.";

test.describe("the Teams list", () => {
  test("keeps Delete on Owners and Admin locked, saying why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPath(page, TEAMS_PATH);
    await expect(rowNames(page)).toHaveCount(4);

    for (const name of ["Owners", "Admin"]) {
      const menu: Locator = await openRowMenu(page, name);
      const item: Locator = menu.getByRole("menuitem", { name: "Delete" });

      await expect(item).toHaveAttribute("aria-disabled", "true");
      await item.hover();
      await expect(page.getByRole("tooltip")).toContainText(BUILT_IN_TEAM);

      if (name === "Owners") {
        await screenshot(page, "teams-built-in-locked");
      }

      /*
       * One Escape never does two things (Tooltip/TooltipEscape, #5420): the
       * first puts the tooltip away and leaves the menu open, the next one
       * closes the menu.
       */
      await page.keyboard.press("Escape");
      await expect(page.getByRole("tooltip")).toBeHidden();
      await expect(menu).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
    }

    // Members, which may be deleted, keeps an unlocked Delete.
    const membersMenu: Locator = await openRowMenu(page, "Members");
    await expect(
      membersMenu.getByRole("menuitem", { name: "Delete" }),
    ).not.toHaveAttribute("aria-disabled", "true");
    expect(await deletesSent(page)).toEqual([]);
  });

  test("deletes a project's own team after saying what goes with it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPath(page, TEAMS_PATH);

    const menu: Locator = await openRowMenu(page, "Platform On-Call");
    await menu.getByRole("menuitem", { name: "Delete" }).click();

    await expect(page.getByTestId("delete-confirmation-message")).toHaveText(
      `Are you sure you want to delete Platform On-Call? This action cannot be undone. ${TEAM_CONSEQUENCE}`,
    );

    await screenshot(page, "teams-row-delete-dialog");

    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toBeHidden();
    await expect(row(page, "Platform On-Call")).toHaveCount(0);
    await expect(rowNames(page)).toHaveCount(3);
    expect(await deletesSent(page)).toEqual([
      { tableName: "Team", id: TEAM_IDS["platform"] },
    ]);
  });

  test("a bulk Delete deletes the project's own team and lists a built-in one as not deleted, saying why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPath(page, TEAMS_PATH);
    await selectRows(page, ["Admin", "Platform On-Call"]);

    const menu: Locator = await openBulkMenu(page);
    await menu.getByRole("menuitem", { name: "Delete" }).click();

    await expect(page.getByTestId("delete-confirmation-item")).toHaveText([
      "Admin",
      "Platform On-Call",
    ]);
    await expect(page.getByTestId("bulk-delete-consequence")).toHaveText(
      TEAM_CONSEQUENCE,
    );

    await dialog(page).getByTestId("modal-footer-submit-button").click();

    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "1 Team deleted",
    );
    await expect(page.getByTestId("bulk-action-failed-count")).toHaveText(
      "1 Team not deleted",
    );
    const failures: Locator = page.getByTestId("bulk-action-failed-items");
    await expect(failures).toContainText("Admin");
    await expect(failures).toContainText(BUILT_IN_TEAM);

    await screenshot(page, "teams-bulk-delete-partial");

    await dialog(page).getByRole("button", { name: "Close" }).click();
    await expect(rowNames(page)).toHaveCount(3);
    await expect(row(page, "Admin")).toHaveCount(1);
    await expect(row(page, "Platform On-Call")).toHaveCount(0);

    // A built-in team is never sent to the server: only the other one is.
    expect(await deletesSent(page)).toEqual([
      { tableName: "Team", id: TEAM_IDS["platform"] },
    ]);
  });
});

/*
 * The UI review's additions: the surfaces this change touched that the
 * tests above did not draw - the Monitors list (whose Delete says the most
 * about what goes with a record), a status page's own Delete page, the
 * dialogs in German and Japanese, a name with nowhere to break, a phone's
 * Bulk Actions menu and a locked Delete tapped on a phone, and a bulk
 * result where many rows were refused for one reason.
 */
const LOCALES: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/Dashboard/src/Locales",
);

async function readLocale(language: string): Promise<Record<string, string>> {
  return JSON.parse(
    await fs.readFile(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

const MONITORS_PATH: string = `${PROJECT_PATH}/monitors?page=monitors`;

const MONITOR_IDS: Record<string, string> = {
  checkout: "60000000-0000-4000-8000-000000000001",
  website: "60000000-0000-4000-8000-000000000002",
  database: "60000000-0000-4000-8000-000000000003",
};

// DeleteConsequences' sentence for a monitor: it names its SLOs too.
const MONITOR_CONSEQUENCE: string =
  "Deleting a monitor also deletes its status history and takes it off status pages, monitor groups and SLOs. Its incidents and alerts stay.";

test.describe("the Monitors list", () => {
  test("a row's Delete says what goes with the monitor, then that archiving keeps it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPath(page, MONITORS_PATH);
    await expect(rowNames(page)).toHaveCount(3);

    const menu: Locator = await openRowMenu(page, "Checkout API");
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Archive",
      "Show ID",
      "Delete",
    ]);
    await menu.getByRole("menuitem", { name: "Delete" }).click();

    await expect(
      dialog(page).getByRole("heading", { name: "Delete Monitor" }),
    ).toBeVisible();
    await expect(page.getByTestId("delete-confirmation-message")).toHaveText(
      `Are you sure you want to delete Checkout API? This action cannot be undone. ${MONITOR_CONSEQUENCE} ${ARCHIVE_INSTEAD}`,
    );
    await expect(
      page.getByTestId("delete-confirmation-consequence"),
    ).toHaveText(`${MONITOR_CONSEQUENCE} ${ARCHIVE_INSTEAD}`);

    await screenshot(page, "monitors-row-delete-dialog");

    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toBeHidden();
    await expect(row(page, "Checkout API")).toHaveCount(0);
    expect(await deletesSent(page)).toEqual([
      { tableName: "Monitor", id: MONITOR_IDS["checkout"] },
    ]);
  });

  test("a bulk Delete asks about the monitors in a sentence, names them, and deletes exactly those", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPath(page, MONITORS_PATH);
    await selectRows(page, ["Checkout API", "Marketing Website"]);

    const menu: Locator = await openBulkMenu(page);
    await menu.getByRole("menuitem", { name: "Delete" }).click();

    await expect(
      dialog(page).getByRole("heading", { name: "Delete 2 Monitors" }),
    ).toBeVisible();
    await expect(page.getByTestId("confirm-modal-description")).toHaveText(
      "Are you sure you want to delete 2 monitors? This action cannot be undone.",
    );
    await expect(page.getByTestId("delete-confirmation-item")).toHaveText([
      "Checkout API",
      "Marketing Website",
    ]);
    await expect(page.getByTestId("bulk-delete-consequence")).toHaveText(
      `${MONITOR_CONSEQUENCE} ${ARCHIVE_INSTEAD}`,
    );

    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "2 Monitors deleted",
    );
    await dialog(page).getByRole("button", { name: "Close" }).click();

    await expect(rowNames(page)).toHaveCount(1);
    await expect(row(page, "Primary Database Ping")).toHaveCount(1);
    expect(
      (await deletesSent(page)).map((sent: RecordedDelete): string => {
        return sent.id;
      }),
    ).toEqual([MONITOR_IDS["checkout"], MONITOR_IDS["website"]]);
  });
});

test.describe("a status page's own Delete page", () => {
  const deletePath: string = `${PROJECT_PATH}/status-pages/${IDS["demo"]}/delete?page=status-page-delete`;

  test("says what goes with the status page on the card and in the dialog, as the list does", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(deletePath);

    const card: Locator = page.getByTestId("model-delete-card-message");
    await expect(card).toHaveText(
      `Permanently delete Demo Status. This action cannot be undone. ${STATUS_PAGE_CONSEQUENCE}`,
    );
    await expect(card.getByTestId("delete-confirmation-consequence")).toHaveCSS(
      "display",
      "block",
    );

    await screenshot(page, "status-page-delete-page");

    await page
      .getByRole("button", { name: "Delete Status Page" })
      .first()
      .click();
    await expect(dialog(page)).toBeVisible();
    await expect(
      dialog(page).getByTestId("delete-confirmation-message"),
    ).toHaveText(
      `Are you sure you want to delete Demo Status? This action cannot be undone. ${STATUS_PAGE_CONSEQUENCE}`,
    );
    // A record's own page is not a list: it does not offer to archive.
    await expect(dialog(page)).not.toContainText("archive it instead");

    await screenshot(page, "status-page-delete-page-dialog");

    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toBeHidden();
    expect(await deletesSent(page)).toEqual([
      { tableName: "StatusPage", id: IDS["demo"] },
    ]);
  });
});

test.describe("in the reader's language", () => {
  test("German: the row dialog and what goes with the status page are German", async ({
    page,
  }: {
    page: Page;
  }) => {
    const german: Record<string, string> = await readLocale("de");

    await openList(page, "?lang=de");
    await row(page, "Demo Status")
      .getByTestId("row-actions-more-button")
      .click();
    await page.getByRole("menu").getByRole("menuitem").last().click();

    await expect(
      page.getByTestId("delete-confirmation-consequence"),
    ).toHaveText(
      `${german[STATUS_PAGE_CONSEQUENCE]} ${german[ARCHIVE_INSTEAD]}`,
    );
    await expect(dialog(page)).not.toContainText(STATUS_PAGE_CONSEQUENCE);
    await expect(
      dialog(page).getByTestId("modal-footer-submit-button"),
    ).toHaveText(german["Delete"]!);

    await screenshot(page, "row-delete-dialog-german");
  });

  test("Japanese: what goes with the status page runs on with no space after a full stop", async ({
    page,
  }: {
    page: Page;
  }) => {
    const japanese: Record<string, string> = await readLocale("ja");

    await openList(page, "?lang=ja");
    await row(page, "Demo Status")
      .getByTestId("row-actions-more-button")
      .click();
    await page.getByRole("menu").getByRole("menuitem").last().click();

    const consequence: string =
      (await page
        .getByTestId("delete-confirmation-consequence")
        .textContent()) || "";

    expect(consequence).toBe(
      `${japanese[STATUS_PAGE_CONSEQUENCE]}${japanese[ARCHIVE_INSTEAD]}`,
    );
    expect(consequence).not.toContain("。 ");

    await screenshot(page, "row-delete-dialog-japanese");
  });
});

test.describe("a long name, on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  const SLUG: string =
    "status.eu-west-1.enterprise-customers.partners-and-resellers.example.com";

  test("wraps inside the dialog, which never scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "?long=1");

    // The slug's card is the last; its ⋯ is the last on the page.
    await page.getByTestId("row-actions-more-button").last().click();
    await page.getByRole("menu").getByRole("menuitem").last().click();

    const name: Locator = dialog(page).getByTestId("delete-confirmation-name");
    await expect(name).toHaveText(SLUG);

    const overflow: { scrollWidth: number; clientWidth: number } = await dialog(
      page,
    ).evaluate(
      (element: Element): { scrollWidth: number; clientWidth: number } => {
        return {
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        };
      },
    );
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

    const box: { x: number; width: number } | null = await name.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });
});

test.describe("Bulk Actions on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("open their menu on the screen, Delete included", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page);
    await page
      .getByRole("checkbox", {
        name: "Select Status Page: Demo Status 13",
        exact: true,
      })
      .check();
    await page
      .getByRole("checkbox", {
        name: "Select Status Page: Demo Status",
        exact: true,
      })
      .check();

    const menu: Locator = await openBulkMenu(page);

    /*
     * Measured once it has opened: it grows in from 95% of its size, and a
     * box read mid-way sits a few pixels in from where it comes to rest.
     */
    await expect(menu).toHaveCSS("opacity", "1");
    await menu.evaluate(async (element: Element): Promise<void> => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation: Animation): Promise<Animation> => {
            return animation.finished;
          }),
      );
    });
    const box: { x: number; width: number } | null = await menu.boundingBox();
    expect(box!.width).toBe(224);

    // It used to hang off the left edge, from a button at the start of a line.
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await expect(
      menu.getByRole("menuitem", { name: "Delete" }),
    ).toBeInViewport();

    await screenshot(page, "bulk-menu-phone");
  });
});

test.describe("a locked Delete, tapped on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("says why it is locked, and the reason stays once the finger lifts", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "?role=viewer");
    await page.getByTestId("row-actions-more-button").nth(1).tap();

    const item: Locator = page
      .getByRole("menu")
      .getByRole("menuitem", { name: "Delete" });
    await expect(item).toHaveAttribute("aria-disabled", "true");

    const box: { x: number; y: number; width: number; height: number } | null =
      await item.boundingBox();
    await page.touchscreen.tap(
      box!.x + box!.width / 2,
      box!.y + box!.height / 2,
    );

    const tooltip: Locator = page.getByRole("tooltip");
    await expect(tooltip).toContainText(
      "You do not have permission to delete this Status Page.",
    );

    // A tap ends with the pointer leaving; the reason is still there to read.
    await page.waitForTimeout(600);
    await expect(tooltip).toBeVisible();

    await screenshot(page, "row-delete-locked-phone");

    await expect(dialog(page)).toHaveCount(0);
    expect(await deletesSent(page)).toEqual([]);
  });
});

test.describe("a bulk Delete refused for one reason", () => {
  const REGIONAL_IDS: Array<string> = [1, 2, 3, 4, 5, 6].map(
    (index: number): string => {
      return `31000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    },
  );

  test("says the reason once, with every status page it refused", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, `?rows=6&refuse=${REGIONAL_IDS.join(",")}`);
    await page.locator("thead").locator('input[type="checkbox"]').check();

    const menu: Locator = await openBulkMenu(page);
    await menu.getByRole("menuitem", { name: "Delete" }).click();
    await dialog(page).getByTestId("modal-footer-submit-button").click();

    await expect(page.getByTestId("bulk-action-failed-count")).toHaveText(
      "6 Status Pages not deleted",
    );

    const failures: Locator = page.getByTestId("bulk-action-failed-items");
    await expect(
      failures.getByTestId("bulk-action-failed-items-group"),
    ).toHaveCount(1);
    await expect(failures.getByRole("listitem")).toHaveText(
      [1, 2, 3, 4, 5, 6].map((index: number): string => {
        return `Status Page: Regional Status 0${index}`;
      }),
    );
    expect(
      ((await failures.textContent()) || "").split(REFUSAL).length - 1,
    ).toBe(1);

    // All six names and the reason fit without scrolling the list.
    const list: { scrollHeight: number; clientHeight: number } =
      await failures.evaluate(
        (element: Element): { scrollHeight: number; clientHeight: number } => {
          const scroller: Element = element.firstElementChild || element;
          return {
            scrollHeight: scroller.scrollHeight,
            clientHeight: scroller.clientHeight,
          };
        },
      );
    expect(list.scrollHeight).toBeLessThanOrEqual(list.clientHeight);

    await screenshot(page, "bulk-delete-refused-one-reason");
  });
});

test.describe("an incident's State Timeline on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("keeps when the state began on one line, and says what deleting it does under the question", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPath(page, timelinePath(INCIDENT_WITH_HISTORY));
    // Cards, newest first: Resolved is the first.
    await page.getByTestId("row-actions-more-button").first().click();
    await page
      .getByRole("menu")
      .getByRole("menuitem", { name: "Delete" })
      .click();

    const startsAt: Locator = dialog(page).getByTestId(
      "delete-confirmation-starts-at",
    );
    await expect(startsAt).toBeVisible();
    const lines: number = await startsAt.evaluate(
      (element: Element): number => {
        return element.getClientRects().length;
      },
    );
    expect(lines).toBe(1);

    await expect(
      dialog(page).getByTestId("state-row-delete-effect"),
    ).toHaveText(
      "Acknowledged, the state before it, becomes the incident's current state again.",
    );
    await expect(
      dialog(page).getByTestId("modal-footer-submit-button"),
    ).toBeInViewport();

    await screenshot(page, "timeline-newest-state-dialog-phone");
  });
});
