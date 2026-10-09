import { IS_BILLING_ENABLED } from "../../Config";
import { getCardButton } from "../Helpers/CardButton";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import {
  SERVER,
  ServerRow,
  clickRowAction,
  deleteProject,
  listByName,
  urlFor,
} from "./Helpers/ProjectResources";
import { Locator, Page, expect, test } from "@playwright/test";
import Faker from "Common/Utils/Faker";

/*
 * Settings > Labels: the list every other resource's Labels field picks
 * from. A label is created through the card's form (name, description, and
 * a colour the form has already picked), shows in the list, is edited from
 * its row and deleted from its row's ⋯ menu - each step read back through
 * the API, so it is the saved row that is checked, not only the page.
 *
 * Creating a label is a Growth feature when billing is on.
 *
 * cd packages/E2E && HOST=localhost HTTP_PROTOCOL=http \
 *   npx playwright test Tests/Dashboard/Labels.spec.ts \
 *   --project=chromium --retries=0
 */

const API_PATH: string = "label";

test.describe("Settings > Labels", () => {
  test("a label is created from the form, listed, edited and deleted", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(300000);

    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Labels",
      preferredPlanName: IS_BILLING_ENABLED ? "Growth" : undefined,
    });

    try {
      // Run-unique, so the row is this run's and nothing else matches it.
      const token: string = Faker.generateName().toString();
      const labelName: string = `e2e-label-${token}`;
      const description: string = "Created by the Labels e2e spec.";
      const editedDescription: string = "Edited by the Labels e2e spec.";

      const createButton: Locator = getCardButton(page, "Create Label");
      const modal: Locator = page.getByTestId("modal");
      const row: Locator = page.getByRole("row").filter({ hasText: labelName });

      await gotoProjectPage({
        page,
        projectId,
        url: urlFor(`/dashboard/${projectId}/settings/labels`),
        ready: createButton,
      });

      // The card says what labels are for; a new project has none.
      await expect(
        page.getByTestId("card-details-heading").filter({ hasText: "Labels" }),
      ).toBeVisible();
      await expect(page.getByText("No labels found")).toBeVisible(SERVER);

      // ---- Create ----
      await createButton.click();
      await expect(modal).toBeVisible();
      await modal
        .getByPlaceholder("internal-service", { exact: true })
        .fill(labelName);
      await modal
        .getByPlaceholder("This label is for all the internal services.", {
          exact: true,
        })
        .fill(description);

      /*
       * Label Color is required, and a Create form starts with one picked,
       * so the form saves without the colour being touched.
       */
      const colorField: Locator = modal.getByTestId("color-picker");
      await expect(colorField).toHaveAttribute(
        "data-value",
        /^#[0-9a-fA-F]{6}$/,
      );

      await modal.getByTestId("modal-footer-submit-button").click();
      await expect(modal).toBeHidden(SERVER);

      // In the list, with its description.
      await expect(row).toBeVisible(SERVER);
      await expect(row).toContainText(description);
      await expect(page.getByText("No labels found")).toHaveCount(0);

      // And on the server, once, with the colour the form picked.
      await expect
        .poll(async (): Promise<number> => {
          return (
            await listByName({
              page,
              projectId,
              apiPath: API_PATH,
              name: labelName,
            })
          ).length;
        }, SERVER)
        .toBe(1);
      const saved: ServerRow = (
        await listByName({
          page,
          projectId,
          apiPath: API_PATH,
          name: labelName,
          select: { description: true, color: true },
        })
      )[0]!;
      expect(saved["description"]).toBe(description);
      const color: unknown = saved["color"];
      expect(
        String(
          typeof color === "string"
            ? color
            : (color as { value?: string } | undefined)?.value || "",
        ),
      ).toMatch(/^#[0-9a-fA-F]{6}$/);

      // ---- Edit ----
      await clickRowAction({ row, name: "Edit" });
      await expect(modal).toBeVisible();
      const descriptionField: Locator = modal.getByPlaceholder(
        "This label is for all the internal services.",
        { exact: true },
      );
      await expect(descriptionField).toHaveValue(description);
      await descriptionField.fill(editedDescription);
      await modal.getByTestId("modal-footer-submit-button").click();
      await expect(modal).toBeHidden(SERVER);

      await expect(row).toContainText(editedDescription, SERVER);
      await expect
        .poll(async (): Promise<unknown> => {
          const rows: Array<ServerRow> = await listByName({
            page,
            projectId,
            apiPath: API_PATH,
            name: labelName,
            select: { description: true },
          });
          return rows[0]?.["description"];
        }, SERVER)
        .toBe(editedDescription);

      // ---- Delete ----
      await clickRowAction({ row, name: "Delete" });
      await expect(modal).toBeVisible();
      await modal.getByTestId("modal-footer-submit-button").click();
      await expect(modal).toBeHidden(SERVER);

      await expect(row).toHaveCount(0, SERVER);
      await expect
        .poll(async (): Promise<number> => {
          return (
            await listByName({
              page,
              projectId,
              apiPath: API_PATH,
              name: labelName,
            })
          ).length;
        }, SERVER)
        .toBe(0);
    } finally {
      await deleteProject(page, projectId);
    }
  });
});
