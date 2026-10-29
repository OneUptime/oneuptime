import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Archive and Unarchive for the values records pick from, in a browser,
 * against the offline fixture (ArchivableValues/Fixture): the real Incident
 * Severity and Incident State settings pages and the real Create Incident
 * Template form.
 *
 * The maintainer: "Can we build functionality to archive things like
 * severity, stage, labels, etc., so they cannot be used in new records like
 * incidents or monitors, but the old records should exist? The current
 * functionality only has delete, but when you delete it, the old records are
 * modified as well." - the screenshot was an incident severity renamed
 * "[DONOTUSE] Very critical".
 *
 * The fixture records every update and delete the page sends, so the tests
 * check what was archived or deleted as well as what the page drew.
 */

const ROUTE: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/incidents/settings";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/archivable-values-ui",
);

const IDS: Record<string, string> = {
  critical: "20000000-0000-4000-8000-000000000001",
  major: "20000000-0000-4000-8000-000000000002",
  minor: "20000000-0000-4000-8000-000000000003",
  veryCritical: "20000000-0000-4000-8000-000000000004",
};

const ARCHIVED_SECTION: string = "archived-values-section";

interface RecordedUpdate {
  tableName: string;
  id: string;
  data: Record<string, unknown>;
}

interface RecordedDelete {
  tableName: string;
  id: string;
}

interface ListRequest {
  tableName: string;
  query: Record<string, unknown>;
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
  // A page that threw while drawing is a bug even when the test passed.
  expect(pageErrors.get(page) || []).toEqual([]);
});

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function dialogScreenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await dialog(page).screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    animations: "disabled",
  });
}

async function open(page: Page, search: string): Promise<void> {
  await page.goto(`${ROUTE}${search}`);
  await expect(
    page.getByTestId("row-actions-more-button").first(),
  ).toBeVisible();
}

// The page's own table: the live values, outside the Archived section.
function liveRows(page: Page): Locator {
  return page.locator(
    `tbody tr:not([data-testid="${ARCHIVED_SECTION}"] tbody tr)`,
  );
}

function liveRow(page: Page, name: string): Locator {
  return page
    .locator("tbody tr")
    .filter({ has: page.getByText(name, { exact: true }) })
    .first();
}

function archivedSection(page: Page): Locator {
  return page.getByTestId(ARCHIVED_SECTION);
}

function dialog(page: Page): Locator {
  return page.getByTestId("modal");
}

async function openRowMenu(page: Page, name: string): Promise<Locator> {
  await liveRow(page, name).getByTestId("row-actions-more-button").click();
  const menu: Locator = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

async function updatesSent(page: Page): Promise<Array<RecordedUpdate>> {
  return await page.evaluate((): Array<RecordedUpdate> => {
    return (
      window as unknown as { __fixture: { updates: Array<RecordedUpdate> } }
    ).__fixture.updates;
  });
}

async function deletesSent(page: Page): Promise<Array<RecordedDelete>> {
  return await page.evaluate((): Array<RecordedDelete> => {
    return (
      window as unknown as { __fixture: { deletes: Array<RecordedDelete> } }
    ).__fixture.deletes;
  });
}

async function listRequests(page: Page): Promise<Array<ListRequest>> {
  return await page.evaluate((): Array<ListRequest> => {
    return (
      window as unknown as { __fixture: { listRequests: Array<ListRequest> } }
    ).__fixture.listRequests;
  });
}

async function expandArchived(page: Page): Promise<void> {
  await archivedSection(page)
    .getByRole("button", { name: /Archived Incident Severities/ })
    .click();
  await expect(
    archivedSection(page).getByText("[DONOTUSE] Very critical"),
  ).toBeVisible();
}

test.describe("the Incident Severity settings page", () => {
  test("lists the live severities, and the archived one apart, folded", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?page=severities");

    await expect(liveRow(page, "Critical")).toBeVisible();
    await expect(liveRow(page, "Major")).toBeVisible();
    await expect(liveRow(page, "Minor")).toBeVisible();

    // Not in the page's table: only in the Archived section, folded.
    const section: Locator = archivedSection(page);
    await expect(section).toBeVisible();
    await expect(section).toContainText("Archived Incident Severities");
    await expect(section).toContainText("1 archived");
    await expect(section.getByText("[DONOTUSE] Very critical")).toBeHidden();

    // The page asked for the live ones only.
    const requests: Array<ListRequest> = await listRequests(page);
    expect(
      requests.some((request: ListRequest): boolean => {
        return (
          request.tableName === "IncidentSeverity" &&
          request.query["isArchived"] === false
        );
      }),
    ).toBe(true);

    await screenshot(page, "severities-folded-1280-light");

    await expandArchived(page);

    await expect(
      section.getByRole("button", { name: "Unarchive" }),
    ).toBeVisible();
    await expect(section).toContainText("Maya Chen");

    await screenshot(page, "severities-archived-open-1280-light");
  });

  test("Archive asks first, naming the settings that keep using it, then moves the severity to Archived", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?page=severities");

    const menu: Locator = await openRowMenu(page, "Critical");
    await menu.getByRole("menuitem", { name: "Archive" }).click();

    await expect(dialog(page)).toContainText("Archive Critical?");
    await expect(dialog(page)).toContainText(
      "Nobody can pick an archived severity for a new incident",
    );
    await expect(dialog(page)).toContainText(
      "These keep using it until you change them:",
    );
    await expect(dialog(page)).toContainText("Incident On-Call Rules (3)");
    // The incidents that have it are not listed: archiving keeps them.
    await expect(dialog(page)).not.toContainText("Incidents (12)");

    await dialogScreenshot(page, "archive-dialog-1280-light");

    // Nothing is sent until the dialog's Archive.
    expect(await updatesSent(page)).toEqual([]);

    await dialog(page).getByRole("button", { name: "Archive" }).click();
    await expect(dialog(page)).toBeHidden();

    expect(await updatesSent(page)).toEqual([
      {
        tableName: "IncidentSeverity",
        id: IDS["critical"],
        data: { isArchived: true },
      },
    ]);

    await expect(archivedSection(page)).toContainText("2 archived");
    await expect(liveRows(page).filter({ hasText: /^Critical/ })).toHaveCount(
      0,
    );
  });

  test("Unarchive puts a severity back, and the section goes when nothing is archived", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?page=severities");
    await expandArchived(page);

    await archivedSection(page)
      .getByRole("button", { name: "Unarchive" })
      .click();

    await expect(archivedSection(page)).toBeHidden();
    expect(await updatesSent(page)).toEqual([
      {
        tableName: "IncidentSeverity",
        id: IDS["veryCritical"],
        data: { isArchived: false },
      },
    ]);
    await expect(liveRow(page, "[DONOTUSE] Very critical")).toBeVisible();
  });

  test("an archive the server refuses keeps the dialog open, in the server's words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?page=severities&refuse-archive=1");

    const menu: Locator = await openRowMenu(page, "Minor");
    await menu.getByRole("menuitem", { name: "Archive" }).click();
    await dialog(page).getByRole("button", { name: "Archive" }).click();

    await expect(dialog(page)).toContainText(
      "Every new incident needs a severity, so keep at least one that is not archived.",
    );
    await expect(dialog(page)).toContainText("Archive Minor?");
  });

  test("Delete of a severity incidents have is refused, with Archive instead as the way on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?page=severities");

    const menu: Locator = await openRowMenu(page, "Critical");
    await menu.getByRole("menuitem", { name: "Delete" }).click();

    await expect(dialog(page)).toContainText(
      "Critical can't be deleted while these have it:",
    );
    await expect(dialog(page)).toContainText("Incidents (12)");
    await expect(dialog(page)).toContainText(
      "Archive it instead: nobody can pick it again, and everything that has it keeps it.",
    );
    // No Delete to press: the server would refuse it.
    await expect(
      dialog(page).getByRole("button", { name: "Delete" }),
    ).toHaveCount(0);

    await dialogScreenshot(page, "delete-refused-1280-light");

    await dialog(page).getByRole("button", { name: "Archive instead" }).click();
    await expect(dialog(page)).toBeHidden();

    expect(await deletesSent(page)).toEqual([]);
    expect(await updatesSent(page)).toEqual([
      {
        tableName: "IncidentSeverity",
        id: IDS["critical"],
        data: { isArchived: true },
      },
    ]);
  });

  test("Delete of a severity only a rule uses says what it changes, beside Archive instead", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?page=severities");

    const menu: Locator = await openRowMenu(page, "Major");
    await menu.getByRole("menuitem", { name: "Delete" }).click();

    await expect(dialog(page)).toContainText("Deleting it also changes these:");
    await expect(dialog(page)).toContainText(
      "Removed from: Incident Label Rules (1)",
    );
    await expect(
      dialog(page).getByRole("button", { name: "Archive instead" }),
    ).toBeVisible();

    await dialogScreenshot(page, "delete-changes-1280-light");

    await dialog(page).getByRole("button", { name: "Delete" }).click();
    await expect(dialog(page)).toBeHidden();

    expect(await deletesSent(page)).toEqual([
      { tableName: "IncidentSeverity", id: IDS["major"] },
    ]);
  });
});

/*
 * What uses a value is read from the server, and on a big project that
 * takes a moment: a click is never left without an answer while it is read.
 */
test.describe("while what uses a value is still being read", () => {
  test("Archive opens on the click, says it is checking, then lists what keeps using it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?page=severities&slow-usage=1");

    const menu: Locator = await openRowMenu(page, "Critical");
    await menu.getByRole("menuitem", { name: "Archive" }).click();

    // Open before the answer: what archiving does, and that it is checking.
    await expect(dialog(page)).toContainText("Archive Critical?");
    await expect(dialog(page)).toContainText(
      "Nobody can pick an archived severity for a new incident",
    );

    const checking: Locator = dialog(page).getByTestId(
      "archivable-value-checking",
    );

    await expect(checking).toHaveText("Checking what still uses it…");
    await expect(checking).toHaveAttribute("role", "status");

    await dialogScreenshot(page, "archive-dialog-checking-1280-light");

    // The answer replaces the line in place.
    await expect(dialog(page)).toContainText("Incident On-Call Rules (3)");
    await expect(checking).toHaveCount(0);
    await expect(dialog(page)).toContainText(
      "These keep using it until you change them:",
    );
  });

  test("Delete opens saying it is checking, and its Delete waits for the words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?page=severities&slow-usage=1");

    const menu: Locator = await openRowMenu(page, "Major");
    await menu.getByRole("menuitem", { name: "Delete" }).click();

    const checking: Locator = dialog(page).getByTestId(
      "delete-confirmation-loading",
    );

    await expect(checking).toHaveText(
      "Checking what deleting it would change…",
    );

    const deleteButton: Locator = dialog(page).getByRole("button", {
      name: "Delete",
      exact: true,
    });

    await expect(deleteButton).toBeDisabled();
    // No Archive instead until it knows what the delete would change.
    await expect(
      dialog(page).getByRole("button", { name: "Archive instead" }),
    ).toHaveCount(0);

    await dialogScreenshot(page, "delete-dialog-checking-1280-light");

    await expect(dialog(page)).toContainText(
      "Removed from: Incident Label Rules (1)",
    );
    await expect(checking).toHaveCount(0);
    await expect(deleteButton).toBeEnabled();
    await expect(
      dialog(page).getByRole("button", { name: "Archive instead" }),
    ).toBeVisible();

    // Nothing was deleted while it was checking.
    expect(await deletesSent(page)).toEqual([]);
  });

  test("closed while it is checking, the late answer never reopens it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?page=severities&slow-usage=1");

    const menu: Locator = await openRowMenu(page, "Major");
    await menu.getByRole("menuitem", { name: "Delete" }).click();

    await expect(
      dialog(page).getByTestId("delete-confirmation-loading"),
    ).toBeVisible();

    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toHaveCount(0);

    // Longer than the answer takes.
    await page.waitForTimeout(2000);

    await expect(dialog(page)).toHaveCount(0);
    expect(await deletesSent(page)).toEqual([]);
  });
});

test.describe("the Incident State settings page", () => {
  test("Archive is locked on a state OneUptime moves incidents into, and says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?page=states");

    const menu: Locator = await openRowMenu(page, "Identified");
    const archive: Locator = menu.getByRole("menuitem", { name: /Archive/ });

    await expect(archive).toBeVisible();
    await expect(archive).toHaveAttribute("aria-disabled", "true");

    await archive.hover();
    await expect(
      page
        .getByText(
          "New incidents start in this state, so it can't be archived.",
        )
        .first(),
    ).toBeVisible();

    await screenshot(page, "states-locked-archive-1280-light");
  });

  test("a state of the project's own can be archived", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?page=states");

    const menu: Locator = await openRowMenu(page, "Investigating");
    const archive: Locator = menu.getByRole("menuitem", { name: "Archive" });

    await expect(archive).not.toHaveAttribute("aria-disabled", "true");
  });
});

test.describe("a create form's pickers", () => {
  test("Create Incident Template never offers an archived severity", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${ROUTE}?page=templates`);

    await page
      .getByRole("button", { name: /Create Incident Template/ })
      .first()
      .click();

    // The form's first step names the template; its second, the incident.
    await dialog(page).getByPlaceholder("Template Name").fill("Database down");
    await dialog(page)
      .getByPlaceholder("Template Description")
      .fill("The primary database is down.");
    await dialog(page).getByRole("button", { name: "Next" }).click();

    const severity: Locator = page.getByRole("combobox", {
      name: /Incident Severity/,
    });
    await expect(severity).toBeVisible();
    await severity.click();

    const options: Locator = page.getByRole("option");
    await expect(options.filter({ hasText: "Critical" }).first()).toBeVisible();
    await expect(options.filter({ hasText: "Major" })).toHaveCount(1);
    await expect(
      options.filter({ hasText: "[DONOTUSE] Very critical" }),
    ).toHaveCount(0);

    await screenshot(page, "create-template-severity-1280-light");

    const requests: Array<ListRequest> = await listRequests(page);

    for (const tableName of ["IncidentSeverity", "IncidentState"]) {
      const reads: Array<ListRequest> = requests.filter(
        (request: ListRequest): boolean => {
          return request.tableName === tableName && !("_id" in request.query);
        },
      );

      expect({ tableName, reads: reads.length > 0 }).toEqual({
        tableName,
        reads: true,
      });

      for (const read of reads) {
        expect({ tableName, isArchived: read.query["isArchived"] }).toEqual({
          tableName,
          isArchived: false,
        });
      }
    }
  });
});

test.describe("at a phone's width, and in the dark", () => {
  test("the page and the Archive dialog fit a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "?page=severities");
    await expandArchived(page);

    const overflow: number = await page.evaluate((): number => {
      return (
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
      );
    });

    expect(overflow).toBeLessThanOrEqual(0);

    await screenshot(page, "severities-390-light");

    // At a phone's width the rows are cards: Critical's is the first.
    await page.getByTestId("row-actions-more-button").first().click();
    const menu: Locator = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "Archive" }).click();
    await expect(dialog(page)).toContainText("Archive Critical?");

    const box: { x: number; width: number } | null =
      await dialog(page).boundingBox();

    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);

    await dialogScreenshot(page, "archive-dialog-390-light");
  });

  test("dark mode, at a laptop's width and a phone's", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?page=severities&theme=dark");
    await expandArchived(page);

    expect(
      await page.evaluate((): boolean => {
        return document.documentElement.classList.contains("dark");
      }),
    ).toBe(true);

    await screenshot(page, "severities-1280-dark");

    const menu: Locator = await openRowMenu(page, "Critical");
    await menu.getByRole("menuitem", { name: "Delete" }).click();
    await expect(dialog(page)).toContainText(
      "Critical can't be deleted while these have it:",
    );
    await dialogScreenshot(page, "delete-refused-1280-dark");
    await dialog(page).getByRole("button", { name: "Cancel" }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    await screenshot(page, "severities-390-dark");
  });
});

/*
 * WHAT REALLY USES A SEVERITY (block 28). The maintainer: "What are these 22
 * Notification Rules? I only have two rules." The Archive dialog listed
 * every member's own on-call rules - one per severity, kind and method - as
 * the project's settings that keep using it. They are said apart now, by
 * person, as what they are and what they keep doing.
 */
test.describe("what really uses a severity", () => {
  test("Archive lists the project's settings, then how many people have on-call rules for it, which stay", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?page=severities");

    const menu: Locator = await openRowMenu(page, "Critical");
    await menu.getByRole("menuitem", { name: "Archive" }).click();

    await expect(dialog(page)).toContainText("Archive Critical?");
    await expect(
      dialog(page).getByTestId("archivable-value-still-used-by"),
    ).toHaveText("•Incident On-Call Rules (3)");

    const people: Locator = dialog(page).getByTestId(
      "archivable-value-people-UserNotificationRule",
    );

    await expect(people).toHaveText(
      "11 people have on-call rules for this severity. They stay as they are, so incidents with it still page them. See your on-call rules",
    );
    await expect(dialog(page)).not.toContainText("Notification Rules");

    // The link opens the reader's own On-Call Rules, on the Incidents tab.
    const link: Locator = dialog(page).getByRole("link", {
      name: "See your on-call rules",
    });

    await expect(link).toHaveAttribute(
      "href",
      "/dashboard/10000000-0000-4000-8000-000000000001/user-settings/on-call-rules",
    );

    await dialogScreenshot(page, "archive-dialog-people-1280-light");
  });

  test("the maintainer's dialog: a severity only people's own rules use has nothing to change, and says so in one sentence", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?page=severities");

    const menu: Locator = await openRowMenu(page, "Minor");
    await menu.getByRole("menuitem", { name: "Archive" }).click();

    await expect(dialog(page)).toContainText(
      "2 people have on-call rules for this severity. They stay as they are, so incidents with it still page them.",
    );
    await expect(dialog(page)).not.toContainText(
      "These keep using it until you change them:",
    );
    await expect(
      dialog(page).getByTestId("archivable-value-still-used-by"),
    ).toHaveCount(0);

    await dialogScreenshot(page, "archive-dialog-people-only-1280-light");

    // Archiving goes on as before: nothing else is sent.
    await dialog(page).getByRole("button", { name: "Archive" }).click();
    await expect(dialog(page)).toBeHidden();

    expect(await updatesSent(page)).toEqual([
      {
        tableName: "IncidentSeverity",
        id: IDS["minor"],
        data: { isArchived: true },
      },
    ]);
  });

  test("Delete of a severity only people's rules use says whose rules go with it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?page=severities");

    const menu: Locator = await openRowMenu(page, "Minor");
    await menu.getByRole("menuitem", { name: "Delete" }).click();

    await expect(dialog(page)).toContainText("Deleting it also changes these:");
    await expect(
      dialog(page).getByTestId("archivable-value-delete-group-Deleted"),
    ).toHaveText("•Deleted with it: On-call rules of 2 people");

    await dialogScreenshot(page, "delete-dialog-people-1280-light");
  });
});

async function selectSeverities(
  page: Page,
  names: Array<string>,
): Promise<void> {
  for (const name of names) {
    await liveRow(page, name).locator('input[type="checkbox"]').check();
  }
}

async function openBulkDelete(page: Page): Promise<void> {
  await page.getByText("Bulk Actions", { exact: true }).click();
  const menu: Locator = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Delete" }).click();
}

interface BulkUsageRead {
  ids: Array<string>;
  purpose: string;
}

async function bulkUsageReads(page: Page): Promise<Array<BulkUsageRead>> {
  return await page.evaluate((): Array<BulkUsageRead> => {
    return (
      window as unknown as {
        __fixture: { bulkUsageReads: Array<BulkUsageRead> };
      }
    ).__fixture.bulkUsageReads;
  });
}

/*
 * Bulk Actions > Delete on the severities used to ask only "Are you sure?"
 * and send every delete: one incidents still had came back refused, and one
 * only people's rules named took every one of those rules with it unsaid.
 */
test.describe("Bulk Actions > Delete of severities", () => {
  test("reads what they have while its Delete waits, names the ones incidents have, and what deleting the rest changes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?page=severities&slow-usage=1");
    await selectSeverities(page, ["Critical", "Major", "Minor"]);
    await openBulkDelete(page);

    await expect(
      dialog(page).getByRole("heading", {
        name: "Delete 3 Incident Severities",
      }),
    ).toBeVisible();

    // Checking, and Delete waits for the answer.
    await expect(
      dialog(page).getByTestId("archivable-values-bulk-checking"),
    ).toHaveText("Checking what still uses them…");

    const deleteButton: Locator = dialog(page).getByTestId(
      "modal-footer-submit-button",
    );

    await expect(deleteButton).toBeDisabled();
    await dialogScreenshot(page, "bulk-delete-checking-1280-light");

    await expect(
      dialog(page).getByTestId("archivable-values-bulk-delete-refused"),
    ).toBeVisible();
    await expect(deleteButton).toBeEnabled();

    // One read for the selection.
    expect(await bulkUsageReads(page)).toEqual([
      {
        ids: [IDS["critical"], IDS["major"], IDS["minor"]],
        purpose: "Delete",
      },
    ]);

    const refused: Locator = dialog(page).getByTestId(
      "archivable-values-bulk-delete-refused",
    );

    await expect(refused).toContainText(
      "Critical can't be deleted while these have it:",
    );
    await expect(
      refused.getByTestId("archivable-values-bulk-delete-refused-by"),
    ).toHaveText("•Incidents (12)");
    await expect(refused).toContainText(
      "It is left as it is. Archive it instead: nobody can pick it again, and everything that has it keeps it.",
    );

    const changes: Locator = dialog(page).getByTestId(
      "archivable-values-bulk-delete-changes",
    );

    await expect(changes).toContainText(
      "Deleting the others also changes these:",
    );
    // Two values go: what goes is deleted with them.
    await expect(
      changes.getByTestId("archivable-value-delete-group-Deleted"),
    ).toHaveText("•Deleted with them: On-call rules of 2 people");
    await expect(
      changes.getByTestId("archivable-value-delete-group-RemovedFromList"),
    ).toHaveText("•Removed from: Incident Label Rules (1)");

    await dialogScreenshot(page, "bulk-delete-1280-light");

    expect(await deletesSent(page)).toEqual([]);

    await deleteButton.click();

    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "2 Incident Severities deleted",
    );
    await expect(page.getByTestId("bulk-action-failed-count")).toHaveText(
      "1 Incident Severity not deleted",
    );
    await expect(page.getByTestId("bulk-action-failed-items")).toContainText(
      "Critical",
    );
    await expect(dialog(page)).toContainText(
      "Records still have it, so it can't be deleted. Archive it instead.",
    );

    // The one incidents have was never sent.
    expect(
      (await deletesSent(page))
        .map((sent: RecordedDelete): string => {
          return sent.id;
        })
        .sort(),
    ).toEqual([IDS["major"], IDS["minor"]].sort());

    await dialogScreenshot(page, "bulk-delete-result-1280-light");
  });

  test("with only severities incidents have, its Delete stays unavailable", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?page=severities");
    await selectSeverities(page, ["Critical"]);
    await openBulkDelete(page);

    await expect(
      dialog(page).getByTestId("archivable-values-bulk-delete-refused"),
    ).toContainText("Critical can't be deleted while these have it:");
    await expect(
      dialog(page).getByTestId("modal-footer-submit-button"),
    ).toBeDisabled();
    await expect(
      dialog(page).getByTestId("archivable-values-bulk-delete-changes"),
    ).toHaveCount(0);
  });
});

// The dialog's box once it has come to rest: it grows in over 150ms.
async function restingDialogBox(
  page: Page,
): Promise<{ x: number; width: number }> {
  await expect(dialog(page)).toHaveCSS("opacity", "1");
  await dialog(page).evaluate(async (element: Element): Promise<void> => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation: Animation): Promise<Animation> => {
          return animation.finished;
        }),
    );
  });

  const box: { x: number; width: number } | null =
    await dialog(page).boundingBox();

  expect(box).not.toBeNull();

  return box!;
}

interface LanguageCase {
  lang: "de" | "fa";
  // The menus' words in that language.
  archive: string;
  delete: string;
  bulkActions: string;
  // The people line, in that language, for the 11 people Critical has.
  people: string;
  link: string;
  // The bulk Delete's line about the refused one.
  refused: string;
}

const LANGUAGES: Array<LanguageCase> = [
  {
    lang: "de",
    archive: "Archivieren",
    delete: "Löschen",
    bulkActions: "Massenaktionen",
    people:
      "11 Personen haben Bereitschaftsregeln für diesen Schweregrad. Sie bleiben, wie sie sind, daher alarmieren Vorfälle mit diesem Schweregrad diese Personen weiterhin.",
    link: "Ihre Bereitschaftsregeln ansehen",
    refused:
      "Critical kann nicht gelöscht werden, solange Folgendes darauf verweist:",
  },
  {
    lang: "fa",
    archive: "بایگانی",
    delete: "حذف",
    bulkActions: "اقدامات گروهی",
    people: "برای این شدت قواعد آنکال دارند",
    link: "قواعد آنکال خود را ببینید",
    refused: "نمی‌توان آن را حذف کرد",
  },
];

for (const language of LANGUAGES) {
  for (const theme of ["light", "dark"]) {
    test.describe(`in ${language.lang}, ${theme}`, () => {
      for (const width of [1280, 390]) {
        test(`the Archive dialog's people line and the bulk Delete at ${width}px`, async ({
          page,
        }: {
          page: Page;
        }) => {
          await page.setViewportSize({
            width: width,
            height: width === 390 ? 844 : 900,
          });
          await open(
            page,
            `?page=severities&lang=${language.lang}${theme === "dark" ? "&theme=dark" : ""}`,
          );

          expect(
            await page.evaluate((): string => {
              return document.documentElement.dir;
            }),
          ).toBe(language.lang === "fa" ? "rtl" : "ltr");

          const overflow: number = await page.evaluate((): number => {
            return (
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth
            );
          });

          expect(overflow).toBeLessThanOrEqual(0);

          // Critical's row is the first: at a phone's width the rows are cards.
          await page.getByTestId("row-actions-more-button").first().click();
          const menu: Locator = page.getByRole("menu");
          await expect(menu).toBeVisible();
          await menu
            .getByRole("menuitem", { name: language.archive, exact: true })
            .click();

          const people: Locator = dialog(page).getByTestId(
            "archivable-value-people-UserNotificationRule",
          );

          await expect(people).toContainText(language.people);
          await expect(people.getByRole("link")).toHaveText(language.link);

          const box: { x: number; width: number } =
            await restingDialogBox(page);

          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);

          await dialogScreenshot(
            page,
            `archive-dialog-people-${width}-${theme}-${language.lang}`,
          );

          await dialog(page).getByTestId("modal-footer-close-button").click();
          await expect(dialog(page)).toHaveCount(0);

          /*
           * The bulk Delete of Critical and Minor, picked by their boxes'
           * names: the table draws a seeded name in the reader's language
           * ("Kritisch"), and the box keeps the name as the project wrote it.
           */
          for (const name of ["Critical", "Minor"]) {
            await page.getByRole("checkbox", { name: name }).first().check();
          }

          await page.getByText(language.bulkActions, { exact: true }).click();
          const bulkMenu: Locator = page.getByRole("menu");
          await expect(bulkMenu).toBeVisible();
          await bulkMenu
            .getByRole("menuitem", { name: language.delete, exact: true })
            .click();

          await expect(
            dialog(page).getByTestId("archivable-values-bulk-delete-refused"),
          ).toContainText(language.refused);
          await expect(
            dialog(page).getByTestId("archivable-values-bulk-delete-changes"),
          ).toBeVisible();

          const bulkBox: { x: number; width: number } =
            await restingDialogBox(page);

          expect(bulkBox.x).toBeGreaterThanOrEqual(0);
          expect(bulkBox.x + bulkBox.width).toBeLessThanOrEqual(width);

          await dialogScreenshot(
            page,
            `bulk-delete-${width}-${theme}-${language.lang}`,
          );
        });
      }
    });
  }
}
