import { IS_BILLING_ENABLED } from "../../Config";
import { getCardButton } from "../Helpers/CardButton";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import {
  SERVER,
  ServerRow,
  UUID_PATTERN,
  clickRowAction,
  deleteProject,
  listByName,
  urlFor,
} from "./Helpers/ProjectResources";
import { Locator, Page, expect, test } from "@playwright/test";
import Faker from "Common/Utils/Faker";

/*
 * Monitor Groups: a group is created from the list's form, shows in the
 * list, opens on its own page (details, edited there), and is deleted from
 * its Delete Group page, which hands back to the list. Each step is read
 * back through the API, so it is the saved group that is checked.
 *
 * Monitor groups are a Scale feature when billing is on.
 *
 * cd packages/E2E && HOST=localhost HTTP_PROTOCOL=http \
 *   npx playwright test Tests/Dashboard/MonitorGroups.spec.ts \
 *   --project=chromium --retries=0
 */

const API_PATH: string = "monitor-group";

test.describe("Monitor Groups", () => {
  test("a group is created, opened, edited on its page and deleted", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(300000);

    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Monitor Groups",
      preferredPlanName: IS_BILLING_ENABLED ? "Scale" : undefined,
    });

    try {
      // Run-unique, so the row is this run's and nothing else matches it.
      const token: string = Faker.generateName().toString();
      const groupName: string = `E2E Checkout ${token}`;
      const description: string = "Every monitor behind checkout.";
      const editedDescription: string = "Checkout, payments and the cart.";

      const listUrl: string = urlFor(`/dashboard/${projectId}/monitor-groups`);
      const createButton: Locator = getCardButton(page, "Create Monitor Group");
      const modal: Locator = page.getByTestId("modal");
      const row: Locator = page.getByRole("row").filter({ hasText: groupName });

      const groupsOnServer: (
        select?: Record<string, boolean>,
      ) => Promise<Array<ServerRow>> = (
        select?: Record<string, boolean>,
      ): Promise<Array<ServerRow>> => {
        return listByName({
          page,
          projectId,
          apiPath: API_PATH,
          name: groupName,
          select,
        });
      };

      await gotoProjectPage({
        page,
        projectId,
        url: listUrl,
        ready: createButton,
      });

      // A new project has no groups.
      await expect(
        page
          .getByTestId("card-details-heading")
          .filter({ hasText: "Monitor Groups" }),
      ).toBeVisible();
      await expect(page.getByText("No monitor groups found")).toBeVisible(
        SERVER,
      );

      // ---- Create ----
      await createButton.click();
      await expect(modal).toBeVisible();
      await modal
        .getByRole("textbox", { name: "Name", exact: true })
        .fill(groupName);
      await modal
        .getByRole("textbox", { name: /^Description/ })
        .fill(description);
      await modal.getByTestId("modal-footer-submit-button").click();
      await expect(modal).toBeHidden(SERVER);

      await expect(row).toBeVisible(SERVER);
      await expect(page.getByText("No monitor groups found")).toHaveCount(0);

      await expect
        .poll(async (): Promise<number> => {
          return (await groupsOnServer()).length;
        }, SERVER)
        .toBe(1);
      const saved: ServerRow = (
        await groupsOnServer({ description: true })
      )[0]!;
      expect(saved["description"]).toBe(description);
      const groupId: string = saved._id;

      // ---- View ----
      await clickRowAction({ row, name: "View Monitor Group" });
      await expect(page).toHaveURL(
        new RegExp(`/dashboard/${projectId}/monitor-groups/${UUID_PATTERN}$`),
        SERVER,
      );
      expect(page.url()).toContain(groupId);

      const detailsCard: Locator = page
        .getByTestId("card")
        .filter({
          has: page
            .getByTestId("card-details-heading")
            .filter({ hasText: "Monitor Group Details" }),
        })
        .first();
      await expect(detailsCard).toBeVisible(SERVER);
      await expect(detailsCard).toContainText(groupName, SERVER);
      await expect(detailsCard).toContainText(description);
      await expect(detailsCard).toContainText(groupId);

      // ---- Edit, on the group's page ----
      await getCardButton(detailsCard, "Edit Monitor Group").click();
      await expect(modal).toBeVisible();
      const descriptionField: Locator = modal.getByRole("textbox", {
        name: /Description/,
      });
      await expect(descriptionField).toHaveValue(description, SERVER);
      await descriptionField.fill(editedDescription);
      await modal.getByTestId("modal-footer-submit-button").click();
      await expect(modal).toBeHidden(SERVER);

      await expect(detailsCard).toContainText(editedDescription, SERVER);
      await expect
        .poll(async (): Promise<unknown> => {
          return (await groupsOnServer({ description: true }))[0]?.[
            "description"
          ];
        }, SERVER)
        .toBe(editedDescription);

      // ---- Delete, from its Delete Group page ----
      await gotoProjectPage({
        page,
        projectId,
        url: urlFor(`/dashboard/${projectId}/monitor-groups/${groupId}/delete`),
        ready: page.getByRole("button", {
          name: "Delete Monitor Group",
          exact: true,
        }),
      });
      await page
        .getByRole("button", { name: "Delete Monitor Group", exact: true })
        .click();
      await expect(modal).toBeVisible();
      await modal.getByTestId("modal-footer-submit-button").click();

      // Back on the list, which no longer has it.
      await expect(page).toHaveURL(
        new RegExp(`/dashboard/${projectId}/monitor-groups/?$`),
        SERVER,
      );
      await expect(page.getByText("No monitor groups found")).toBeVisible(
        SERVER,
      );
      await expect(row).toHaveCount(0);
      await expect
        .poll(async (): Promise<number> => {
          return (await groupsOnServer()).length;
        }, SERVER)
        .toBe(0);
    } finally {
      await deleteProject(page, projectId);
    }
  });
});
