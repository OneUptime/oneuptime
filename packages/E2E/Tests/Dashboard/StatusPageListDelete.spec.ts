import { IS_BILLING_ENABLED } from "../../Config";
import { getCardButton } from "../Helpers/CardButton";
import { openRowActionsMenu } from "../Helpers/RowActions";
import { createItem, JSONish, toId } from "./Helpers/MonitorAlerting";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import {
  SERVER,
  ServerRow,
  deleteProject,
  listByName,
  urlFor,
} from "./Helpers/ProjectResources";
import { Locator, Page, expect, test } from "@playwright/test";
import Faker from "Common/Utils/Faker";

/*
 * Delete on the Status Pages list, against the real stack: from a row's ⋯
 * menu, and from Bulk Actions for several at once. Each confirmation names
 * what it deletes and what goes with it, and every delete is read back
 * through the API, so it is the server's status pages that are checked -
 * gone when deleted, there when the dialog was cancelled.
 *
 * The offline suite (packages/E2E/ListDelete) covers what needs a server
 * that misbehaves on purpose: a refused row, a member who may not delete, a
 * page emptied by a bulk Delete.
 *
 * cd packages/E2E && HOST=localhost HTTP_PROTOCOL=http \
 *   npx playwright test Tests/Dashboard/StatusPageListDelete.spec.ts \
 *   --project=chromium --retries=0
 */

const API_PATH: string = "status-page";

// Status pages are on every paid plan when billing is on.
const PLAN_NAME: string = "Growth";

// DeleteConsequences' sentence for a status page, then the live list's own.
const STATUS_PAGE_CONSEQUENCE: string =
  "Deleting a status page also deletes its subscribers, private users and custom domains.";
const ARCHIVE_INSTEAD: string =
  "To take it off this list and keep everything, archive it instead.";

test.describe("Status Pages list: Delete", () => {
  test("a row's ⋯ menu and Bulk Actions delete status pages, after asking", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(300000);

    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Status Page Delete",
      preferredPlanName: IS_BILLING_ENABLED ? PLAN_NAME : undefined,
    });

    try {
      // Run-unique, so the rows are this run's and nothing else matches them.
      const token: string = Faker.generateName().toString();
      const names: Record<"single" | "first" | "second" | "kept", string> = {
        single: `E2E Row ${token}`,
        first: `E2E Bulk One ${token}`,
        second: `E2E Bulk Two ${token}`,
        kept: `E2E Kept ${token}`,
      };

      for (const name of Object.values(names)) {
        const created: JSONish = await createItem({
          page,
          projectId,
          path: `/api/${API_PATH}`,
          item: {
            name,
            description: "Created by StatusPageListDelete.spec.ts",
            projectId,
            pageTitle: name,
          },
        });
        expect(toId(created["_id"]), `${name} was created`).not.toBe("");
      }

      const onServer: (name: string) => Promise<Array<ServerRow>> = (
        name: string,
      ): Promise<Array<ServerRow>> => {
        return listByName({ page, projectId, apiPath: API_PATH, name });
      };

      const row: (name: string) => Locator = (name: string): Locator => {
        return page
          .locator("tbody tr")
          .filter({ has: page.getByText(name, { exact: true }) });
      };

      const modal: Locator = page.getByTestId("modal");

      await gotoProjectPage({
        page,
        projectId,
        url: urlFor(`/dashboard/${projectId}/status-pages`),
        ready: getCardButton(page, "Create Status Page"),
      });

      for (const name of Object.values(names)) {
        await expect(row(name)).toBeVisible(SERVER);
      }

      // ---- A row's ⋯ menu: Cancel first, which deletes nothing ----
      let menu: Locator = await openRowActionsMenu(row(names.single));
      await menu.getByRole("menuitem", { name: "Delete", exact: true }).click();

      await expect(modal).toBeVisible();
      await expect(
        modal.getByRole("heading", { name: "Delete Status Page" }),
      ).toBeVisible();
      await expect(modal.getByTestId("delete-confirmation-message")).toHaveText(
        `Are you sure you want to delete ${names.single}? This action cannot be undone. ${STATUS_PAGE_CONSEQUENCE} ${ARCHIVE_INSTEAD}`,
      );
      await expect(
        modal.getByTestId("delete-confirmation-consequence"),
      ).toHaveText(`${STATUS_PAGE_CONSEQUENCE} ${ARCHIVE_INSTEAD}`);

      await modal.getByRole("button", { name: "Cancel" }).click();
      await expect(modal).toBeHidden();
      await expect(row(names.single)).toBeVisible();
      expect((await onServer(names.single)).length).toBe(1);

      // ---- Then Delete, for real ----
      menu = await openRowActionsMenu(row(names.single));
      await menu.getByRole("menuitem", { name: "Delete", exact: true }).click();
      await expect(modal).toBeVisible();
      await modal.getByTestId("modal-footer-submit-button").click();

      await expect(modal).toBeHidden(SERVER);
      await expect(row(names.single)).toHaveCount(0, SERVER);
      await expect
        .poll(async (): Promise<number> => {
          return (await onServer(names.single)).length;
        }, SERVER)
        .toBe(0);
      // Only that one.
      expect((await onServer(names.first)).length).toBe(1);

      // ---- Bulk Actions: two selected, one left ----
      for (const name of [names.first, names.second]) {
        await row(name).locator('input[type="checkbox"]').check();
      }
      await expect(page.getByText("2 Status Pages Selected")).toBeVisible();

      await page.getByText("Bulk Actions", { exact: true }).click();
      const bulkMenu: Locator = page.getByRole("menu");
      await expect(bulkMenu).toBeVisible();
      await bulkMenu
        .getByRole("menuitem", { name: "Delete", exact: true })
        .click();

      await expect(
        modal.getByRole("heading", { name: "Delete 2 Status Pages" }),
      ).toBeVisible();
      await expect(modal.getByTestId("confirm-modal-description")).toHaveText(
        "Are you sure you want to delete 2 Status Pages? This action cannot be undone.",
      );
      await expect(modal.getByTestId("delete-confirmation-item")).toHaveText([
        names.first,
        names.second,
      ]);
      await expect(modal.getByTestId("bulk-delete-consequence")).toHaveText(
        `${STATUS_PAGE_CONSEQUENCE} ${ARCHIVE_INSTEAD}`,
      );

      await modal.getByTestId("modal-footer-submit-button").click();

      await expect(modal.getByText("Completed")).toBeVisible(SERVER);
      await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
        "2 Status Pages deleted",
      );
      await expect(page.getByTestId("bulk-action-failed-count")).toHaveCount(0);
      await modal.getByRole("button", { name: "Close" }).click();
      await expect(modal).toBeHidden();

      // The selection is cleared and the list shows what is left.
      await expect(page.getByText("2 Status Pages Selected")).toHaveCount(0);
      await expect(row(names.first)).toHaveCount(0, SERVER);
      await expect(row(names.second)).toHaveCount(0);
      await expect(row(names.kept)).toBeVisible();

      for (const name of [names.first, names.second]) {
        await expect
          .poll(async (): Promise<number> => {
            return (await onServer(name)).length;
          }, SERVER)
          .toBe(0);
      }
      expect((await onServer(names.kept)).length).toBe(1);
    } finally {
      await deleteProject(page, projectId);
    }
  });
});
