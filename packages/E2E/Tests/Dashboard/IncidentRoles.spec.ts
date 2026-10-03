import { BASE_URL } from "../../Config";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import { APIResponse, Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

const urlFor: (path: string) => string = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

/*
 * For assertions that wait on the server (a save, a page's first fetch, a
 * full navigation): the suite's 5s default is for what is already on screen.
 */
const SERVER: { timeout: number } = { timeout: 30000 };

/*
 * Incidents → Settings → Incident Roles, on a project created for the test.
 *
 * The maintainer: "To make things simple, can we remove all the roles except
 * Incident Commander by default? People can add more roles if they feel
 * like. Please also remove multiple users column from modal table (as this
 * complicates the UI)."
 *
 * Real project creation (which seeds the roles), the real page and real
 * saves, read back through the API: a new project has Incident Commander
 * alone; the table has no Multiple Users column; Incident Commander's Delete
 * is locked and its form has no Allow Multiple Users; a role added with
 * Allow Multiple Users (folded under Advanced) is saved with it, shows
 * "Configured" on its Edit, and can be deleted. Growth, because creating an
 * incident role is a Growth feature when billing is on.
 *
 * cd packages/E2E && HOST=localhost HTTP_PROTOCOL=http \
 *   npx playwright test Tests/Dashboard/IncidentRoles.spec.ts \
 *   --project=chromium --retries=0
 */

const LOCKED_DELETE_REASON: string =
  "Every incident needs someone in charge, so this role can be renamed, but not deleted.";

interface RoleOnServer {
  name: string;
  isPrimaryRole: boolean;
  isDeleteable: boolean;
  canAssignMultipleUsers: boolean;
}

// The project's roles as the server keeps them, by name.
const rolesOnServer: (
  page: Page,
  projectId: string,
) => Promise<Array<RoleOnServer>> = async (
  page: Page,
  projectId: string,
): Promise<Array<RoleOnServer>> => {
  const response: APIResponse = await page.request.post(
    urlFor("/api/incident-role/get-list"),
    {
      headers: { tenantid: projectId },
      data: {
        query: { projectId },
        select: {
          _id: true,
          name: true,
          isPrimaryRole: true,
          isDeleteable: true,
          canAssignMultipleUsers: true,
        },
        limit: 50,
        skip: 0,
        sort: { name: "ASC" },
      },
    },
  );
  expect(response.ok(), await response.text()).toBe(true);
  const body: { data: Array<Record<string, unknown>> } = await response.json();

  return body.data.map((row: Record<string, unknown>): RoleOnServer => {
    return {
      name: String(row["name"]),
      isPrimaryRole: Boolean(row["isPrimaryRole"]),
      isDeleteable: Boolean(row["isDeleteable"]),
      canAssignMultipleUsers: Boolean(row["canAssignMultipleUsers"]),
    };
  });
};

const rowOf: (page: Page, name: string) => Locator = (
  page: Page,
  name: string,
): Locator => {
  return page
    .getByRole("row")
    .filter({ has: page.getByText(name, { exact: true }) });
};

const deleteProject: (page: Page, projectId: string) => Promise<void> = async (
  page: Page,
  projectId: string,
): Promise<void> => {
  const response: APIResponse = await page.request.delete(
    urlFor(`/api/project/${projectId}`),
    { headers: { tenantid: projectId } },
  );
  expect(response.ok(), "Temporary project is deleted").toBe(true);
};

test.describe("Incident roles", () => {
  test("a new project has Incident Commander alone, and a role added with Allow Multiple Users under Advanced keeps it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Incident Roles",
      preferredPlanName: "Growth",
      enablePaidUsage: false,
    });

    try {
      const added: string = "E2E Observer";
      const modal: Locator = page.getByTestId("modal");
      const advancedHeader: Locator = modal.getByRole("button", {
        name: /^Advanced/,
      });
      const multipleUsers: Locator = modal.getByRole("switch", {
        name: "Allow Multiple Users",
        exact: true,
      });

      // Creating the project seeded one role: Incident Commander.
      expect(await rolesOnServer(page, projectId)).toEqual([
        {
          name: "Incident Commander",
          isPrimaryRole: true,
          isDeleteable: false,
          canAssignMultipleUsers: false,
        },
      ]);

      await gotoProjectPage({
        page,
        projectId,
        url: urlFor(`/dashboard/${projectId}/incidents/settings/roles`),
        ready: rowOf(page, "Incident Commander"),
      });

      // A titled card that says more roles can be added.
      await expect(page.getByTestId("card-details-heading")).toHaveText(
        "Incident Roles",
      );
      await expect(
        page.getByText(
          "The roles people take on during an incident, such as Incident Commander. Add more if your team needs them.",
        ),
      ).toBeVisible();

      // A role's name and description - no Multiple Users column.
      await expect(
        page.getByRole("columnheader", { name: /Multiple Users/ }),
      ).toHaveCount(0);
      for (const retired of ["Responder", "Communications Lead", "Observer"]) {
        await expect(rowOf(page, retired)).toHaveCount(0);
      }

      // Incident Commander's Delete is locked, saying why.
      await rowOf(page, "Incident Commander")
        .getByTestId("row-actions-more-button")
        .click();
      const lockedDelete: Locator = page.getByRole("menuitem", {
        name: "Delete",
      });
      await expect(lockedDelete).toHaveAttribute("aria-disabled", "true");
      await expect(lockedDelete).toHaveAccessibleDescription(
        LOCKED_DELETE_REASON,
      );
      await page.keyboard.press("Escape");
      await expect(lockedDelete).toHaveCount(0);

      // Its form has no Allow Multiple Users: it is always one person.
      await rowOf(page, "Incident Commander")
        .getByRole("button", { name: "Edit" })
        .click();
      await expect(modal).toBeVisible();
      await expect(
        modal.getByPlaceholder("Responder", { exact: true }),
      ).toHaveValue("Incident Commander", SERVER);
      await expect(advancedHeader).toHaveCount(0);
      await expect(modal.getByText("Allow Multiple Users")).toHaveCount(0);
      await modal.getByTestId("modal-footer-close-button").click();
      await expect(modal).toBeHidden();

      // A role of the team's own, held by more than one person.
      await page
        .getByTestId("card-button")
        .and(
          page.getByRole("button", {
            name: "Create Incident Role",
            exact: true,
          }),
        )
        .click();
      await expect(modal).toBeVisible();
      await modal.getByPlaceholder("Responder", { exact: true }).fill(added);
      await modal
        .getByPlaceholder("Does the hands-on work to resolve the incident.", {
          exact: true,
        })
        .fill("Follows the incident without working on it.");

      // Allow Multiple Users is folded under Advanced until it is opened.
      await expect(advancedHeader).toHaveAttribute("aria-expanded", "false");
      await expect(multipleUsers).toBeHidden();
      await advancedHeader.click();
      await expect(advancedHeader).toHaveAttribute("aria-expanded", "true");
      await expect(multipleUsers).toHaveAttribute("aria-checked", "false");
      await multipleUsers.click();
      await expect(multipleUsers).toHaveAttribute("aria-checked", "true");

      // Then how it looks: a colour is required.
      const submit: Locator = modal.getByTestId("modal-footer-submit-button");
      await expect(submit).toHaveText("Next");
      await submit.click();
      await modal
        .getByPlaceholder("Please select color for this role.", {
          exact: true,
        })
        .click();
      const picker: Locator = page.getByTestId("color-picker-popup");
      await expect(picker).toBeVisible();
      await picker.locator("input").first().fill("#0891b2");
      // Escape closes the picker, not the form.
      await page.keyboard.press("Escape");
      await expect(picker).toBeHidden();
      await expect(modal).toBeVisible();
      await expect(submit).toHaveText("Create Incident Role");
      await submit.click();
      await expect(modal).toBeHidden(SERVER);

      await expect(rowOf(page, added)).toHaveCount(1, SERVER);
      await expect
        .poll(async (): Promise<Array<RoleOnServer>> => {
          return rolesOnServer(page, projectId);
        }, SERVER)
        .toEqual([
          {
            name: added,
            isPrimaryRole: false,
            isDeleteable: true,
            canAssignMultipleUsers: true,
          },
          {
            name: "Incident Commander",
            isPrimaryRole: true,
            isDeleteable: false,
            canAssignMultipleUsers: false,
          },
        ]);

      // Its Edit keeps the switch under Advanced, saying something is set.
      await rowOf(page, added).getByRole("button", { name: "Edit" }).click();
      await expect(modal).toBeVisible();
      await expect(
        modal.getByPlaceholder("Responder", { exact: true }),
      ).toHaveValue(added, SERVER);
      await expect(advancedHeader).toHaveAttribute("aria-expanded", "false");
      await expect(advancedHeader).toContainText("Configured");
      await modal.getByTestId("modal-footer-close-button").click();
      await expect(modal).toBeHidden();

      // A role the team added can be deleted.
      await rowOf(page, added).getByTestId("row-actions-more-button").click();
      const deleteItem: Locator = page.getByRole("menuitem", {
        name: "Delete",
      });
      await expect(deleteItem).not.toHaveAttribute("aria-disabled", "true");
      await deleteItem.click();
      await expect(modal).toBeVisible();
      await modal.getByTestId("modal-footer-submit-button").click();
      await expect
        .poll(async (): Promise<Array<string>> => {
          return (await rolesOnServer(page, projectId)).map(
            (role: RoleOnServer): string => {
              return role.name;
            },
          );
        }, SERVER)
        .toEqual(["Incident Commander"]);
      await expect(rowOf(page, added)).toHaveCount(0, SERVER);
    } finally {
      await deleteProject(page, projectId);
    }
  });
});
