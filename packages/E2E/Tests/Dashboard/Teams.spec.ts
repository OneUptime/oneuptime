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
import { APIResponse, Locator, Page, expect, test } from "@playwright/test";
import Faker from "Common/Utils/Faker";

/*
 * Settings > Teams: Create Team asks for a name and what the team's members
 * may do (Access: a role, or Choose permissions later, which is picked), then
 * opens the new team where its next step is
 * (App/FeatureSet/Dashboard/src/Components/Team/TeamCreateForm.ts):
 *
 *   - given a role, its Members page - and the role is on the team, as an
 *     allow permission for the whole project;
 *   - with permissions left for later, its Permissions page, where Add Role
 *     is - and the team holds no permissions at all.
 *
 * Both teams then show in the list, and one opens on its overview. What is
 * saved is read back through the API.
 *
 * Creating a team is a Scale feature when billing is on.
 *
 * cd packages/E2E && HOST=localhost HTTP_PROTOCOL=http \
 *   npx playwright test Tests/Dashboard/Teams.spec.ts \
 *   --project=chromium --retries=0
 */

const teamPermissionsOnServer: (data: {
  page: Page;
  projectId: string;
  teamId: string;
}) => Promise<Array<ServerRow>> = async (data: {
  page: Page;
  projectId: string;
  teamId: string;
}): Promise<Array<ServerRow>> => {
  const response: APIResponse = await data.page.request.post(
    urlFor("/api/team-permission/get-list"),
    {
      headers: { tenantid: data.projectId },
      data: {
        query: { projectId: data.projectId, teamId: data.teamId },
        select: { _id: true, permission: true, isBlockPermission: true },
        limit: 50,
        skip: 0,
        sort: {},
      },
    },
  );
  expect(response.ok(), await response.text()).toBe(true);
  const body: { data: Array<ServerRow> } = await response.json();

  return body.data;
};

test.describe("Settings > Teams", () => {
  test("a new team opens where its next step is, with the access it was given", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(300000);

    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Teams",
      preferredPlanName: IS_BILLING_ENABLED ? "Scale" : undefined,
    });

    try {
      // Run-unique, so the rows are this run's and nothing else matches them.
      const token: string = Faker.generateName().toString();
      const memberTeamName: string = `E2E Responders ${token}`;
      const laterTeamName: string = `E2E Auditors ${token}`;

      const listUrl: string = urlFor(`/dashboard/${projectId}/teams`);
      const createButton: Locator = getCardButton(page, "Create Team");
      const modal: Locator = page.getByTestId("modal");

      const teamIdOnServer: (name: string) => Promise<string> = async (
        name: string,
      ): Promise<string> => {
        let rows: Array<ServerRow> = [];
        await expect
          .poll(async (): Promise<number> => {
            rows = await listByName({
              page,
              projectId,
              apiPath: "team",
              name,
            });
            return rows.length;
          }, SERVER)
          .toBe(1);
        return rows[0]!._id;
      };

      // Opens Create Team and names the team; Access is left to the caller.
      const openCreateTeam: (name: string) => Promise<void> = async (
        name: string,
      ): Promise<void> => {
        await gotoProjectPage({
          page,
          projectId,
          url: listUrl,
          ready: createButton,
        });
        await createButton.click();
        await expect(modal).toBeVisible();
        await modal
          .getByRole("textbox", { name: "Name", exact: true })
          .fill(name);
      };

      const accessOption: (value: string) => Locator = (
        value: string,
      ): Locator => {
        return modal.getByTestId(`card-select-option-${value}`).first();
      };

      // ---- A team given the Project Member role ----
      await openCreateTeam(memberTeamName);

      // Choose permissions later is picked until something else is.
      await expect(accessOption("ChoosePermissionsLater")).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await accessOption("ProjectMember").click();
      await expect(accessOption("ProjectMember")).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect(accessOption("ChoosePermissionsLater")).toHaveAttribute(
        "aria-checked",
        "false",
      );

      await modal.getByTestId("modal-footer-submit-button").click();

      // It can do something now, so it opens on Members, to invite people.
      await expect(page).toHaveURL(
        new RegExp(`/dashboard/${projectId}/teams/${UUID_PATTERN}/members$`),
        SERVER,
      );
      const memberTeamId: string = await teamIdOnServer(memberTeamName);
      expect(page.url()).toContain(memberTeamId);
      await expect(
        page
          .getByTestId("card-details-heading")
          .filter({ hasText: "Team Members" }),
      ).toBeVisible(SERVER);

      // The role is on the team: one allow permission, Project Member.
      await expect
        .poll(async (): Promise<Array<string>> => {
          const rows: Array<ServerRow> = await teamPermissionsOnServer({
            page,
            projectId,
            teamId: memberTeamId,
          });
          return rows.map((row: ServerRow): string => {
            return `${String(row["permission"])}:${row["isBlockPermission"] ? "block" : "allow"}`;
          });
        }, SERVER)
        .toEqual(["ProjectMember:allow"]);

      // ---- A team whose permissions are left for later ----
      await openCreateTeam(laterTeamName);
      await expect(accessOption("ChoosePermissionsLater")).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await modal.getByTestId("modal-footer-submit-button").click();

      // Its Permissions page, where Add Role is.
      await expect(page).toHaveURL(
        new RegExp(
          `/dashboard/${projectId}/teams/${UUID_PATTERN}/permissions$`,
        ),
        SERVER,
      );
      const laterTeamId: string = await teamIdOnServer(laterTeamName);
      expect(page.url()).toContain(laterTeamId);
      await expect(getCardButton(page, "Add Role").first()).toBeVisible(SERVER);
      expect(
        await teamPermissionsOnServer({
          page,
          projectId,
          teamId: laterTeamId,
        }),
      ).toEqual([]);

      // ---- Both in the list; one opens on its overview ----
      await gotoProjectPage({
        page,
        projectId,
        url: listUrl,
        ready: createButton,
      });
      const memberRow: Locator = page
        .getByRole("row")
        .filter({ hasText: memberTeamName });
      const laterRow: Locator = page
        .getByRole("row")
        .filter({ hasText: laterTeamName });
      await expect(memberRow).toBeVisible(SERVER);
      await expect(laterRow).toBeVisible(SERVER);

      await clickRowAction({ row: laterRow, name: "View Team" });
      await expect(page).toHaveURL(
        new RegExp(`/dashboard/${projectId}/teams/${laterTeamId}$`),
        SERVER,
      );
      const detailsCard: Locator = page
        .getByTestId("card")
        .filter({
          has: page
            .getByTestId("card-details-heading")
            .filter({ hasText: "Team Details" }),
        })
        .first();
      await expect(detailsCard).toContainText(laterTeamName, SERVER);
      await expect(detailsCard).toContainText(laterTeamId);
    } finally {
      await deleteProject(page, projectId);
    }
  });
});
