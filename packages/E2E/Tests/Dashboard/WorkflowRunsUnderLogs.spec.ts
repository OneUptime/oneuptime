import { BASE_URL } from "../../Config";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import { APIResponse, Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

interface WorkflowRecord {
  _id: string;
  name: string;
}

const urlFor: (path: string) => string = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

// For assertions that wait on the server; the suite's 5s default is for the screen.
const SERVER: { timeout: number } = { timeout: 30000 };

const desktopMenu: (page: Page) => Locator = (page: Page): Locator => {
  return page.locator("aside[role='navigation'][aria-label='Main navigation']");
};

/*
 * A side-menu section, found by its heading the way the jest harness finds
 * it: the nearest section wrapper around the <h6>. The heading is drawn in
 * capitals by CSS, so it is matched on its text, not on what is shown.
 */
type MenuSectionFunction = (page: Page, title: string) => Locator;

const menuSection: MenuSectionFunction = (
  page: Page,
  title: string,
): Locator => {
  return desktopMenu(page).locator(
    `xpath=.//h6[normalize-space(.)='${title}']/ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' mb-2 ')][1]`,
  );
};

/*
 * The run list's card, by its title. Matched among the page's card headings
 * rather than as the only one, so a notice card above it cannot make this
 * ambiguous.
 */
const runsCard: (page: Page) => Locator = (page: Page): Locator => {
  return page
    .getByTestId("card-details-heading")
    .filter({ hasText: /^\s*Runs\s*$/ });
};

type SectionTitlesFunction = (page: Page) => Promise<Array<string>>;

const sectionTitles: SectionTitlesFunction = async (
  page: Page,
): Promise<Array<string>> => {
  return (await desktopMenu(page).locator("h6").allTextContents()).map(
    (title: string): string => {
      return title.trim();
    },
  );
};

/*
 * Workflow runs are listed under Logs → Runs: in the Workflows menu, and in a
 * workflow's own menu, where they used to sit under Advanced, named for both
 * runs and logs. Real navigation against a real project: a workflow is
 * created through the API, both menus are read, both Runs pages are opened
 * from them and again from their URLs, which did not change. A temporary
 * project isolates it and is deleted even when the test fails. Growth,
 * because workflows are a Growth feature when billing is on.
 *
 * cd packages/E2E && HOST=localhost HTTP_PROTOCOL=http \
 *   npx playwright test Tests/Dashboard/WorkflowRunsUnderLogs.spec.ts \
 *   --project=chromium --retries=0
 */
test.describe("Workflow runs live under Logs → Runs", () => {
  test("both workflow menus list Runs in a Logs section, and both Runs pages open", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(240000);

    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Workflow Runs",
      preferredPlanName: "Growth",
      enablePaidUsage: false,
    });

    try {
      const workflowsPath: string = `/dashboard/${projectId}/workflows`;
      const allRunsPath: string = `${workflowsPath}/logs`;
      const workflowName: string = "e2e-workflow-runs-menu";

      const breadcrumb: Locator = page.getByRole("navigation", {
        name: "Breadcrumb",
      });

      const createResponse: APIResponse = await page.request.post(
        urlFor("/api/workflow"),
        {
          headers: { tenantid: projectId },
          data: { data: { projectId, name: workflowName } },
        },
      );
      expect(createResponse.ok(), await createResponse.text()).toBe(true);

      const listResponse: APIResponse = await page.request.post(
        urlFor("/api/workflow/get-list"),
        {
          headers: { tenantid: projectId },
          data: {
            query: { projectId, name: workflowName },
            select: { _id: true, name: true },
            limit: 2,
            skip: 0,
            sort: {},
          },
        },
      );
      expect(listResponse.ok(), await listResponse.text()).toBe(true);
      const workflows: Array<WorkflowRecord> = (
        (await listResponse.json()) as { data: Array<WorkflowRecord> }
      ).data;
      expect(workflows).toHaveLength(1);

      const workflowPath: string = `${workflowsPath}/${workflows[0]!._id}`;
      const workflowRunsPath: string = `${workflowPath}/logs`;

      // The Workflows menu: Logs, holding Runs, comes right after Workflows.
      await gotoProjectPage({
        page,
        projectId,
        url: urlFor(workflowsPath),
        ready: desktopMenu(page).locator(`a[href='${allRunsPath}']`),
      });
      const productSections: Array<string> = await sectionTitles(page);
      expect(productSections).toContain("Logs");
      expect(productSections.indexOf("Logs")).toBe(
        productSections.indexOf("Workflows") + 1,
      );

      const allRuns: Locator = menuSection(page, "Logs").getByRole("link", {
        name: "Runs",
        exact: true,
      });
      await expect(allRuns).toBeVisible();
      await expect(allRuns).toHaveAttribute("href", allRunsPath);
      await expect(menuSection(page, "Logs").getByRole("link")).toHaveCount(1);
      await expect(
        menuSection(page, "Workflows").locator(`a[href='${allRunsPath}']`),
      ).toHaveCount(0);

      // It opens the project's runs, under its old URL.
      await allRuns.click();
      await expect(page).toHaveURL(urlFor(allRunsPath), SERVER);
      await expect(breadcrumb).toContainText("Runs", SERVER);
      await expect(runsCard(page)).toBeVisible(SERVER);

      // A workflow's own menu: Logs comes right after Basic, before Advanced.
      await gotoProjectPage({
        page,
        projectId,
        url: urlFor(workflowPath),
        ready: desktopMenu(page).locator(`a[href='${workflowRunsPath}']`),
      });
      const workflowSections: Array<string> = await sectionTitles(page);
      expect(workflowSections).toContain("Logs");
      expect(workflowSections.indexOf("Logs")).toBe(
        workflowSections.indexOf("Basic") + 1,
      );
      expect(workflowSections.indexOf("Advanced")).toBeGreaterThan(
        workflowSections.indexOf("Logs"),
      );

      const workflowRuns: Locator = menuSection(page, "Logs").getByRole(
        "link",
        { name: "Runs", exact: true },
      );
      await expect(workflowRuns).toBeVisible();
      await expect(workflowRuns).toHaveAttribute("href", workflowRunsPath);
      await expect(
        menuSection(page, "Advanced").locator(`a[href='${workflowRunsPath}']`),
      ).toHaveCount(0);
      await expect(
        menuSection(page, "Advanced").getByRole("link", {
          name: "Delete Workflow",
        }),
      ).toBeVisible();

      // It opens this workflow's runs, under its old URL.
      await workflowRuns.click();
      await expect(page).toHaveURL(urlFor(workflowRunsPath), SERVER);
      await expect(breadcrumb).toContainText("View Workflow", SERVER);
      await expect(breadcrumb).toContainText("Runs");
      await expect(runsCard(page)).toBeVisible(SERVER);

      // A bookmarked runs URL still opens the page after a full load.
      await page.reload();
      await expect(runsCard(page)).toBeVisible(SERVER);
      await expect(workflowRuns).toBeVisible(SERVER);

      // Nothing in the menu still goes by the old combined name.
      await expect(
        desktopMenu(page).getByRole("link", { name: /Runs\s*&\s*Logs/ }),
      ).toHaveCount(0);
    } finally {
      const response: APIResponse = await page.request.delete(
        urlFor(`/api/project/${projectId}`),
        { headers: { tenantid: projectId } },
      );
      expect(response.ok(), "Temporary workflow runs project is deleted").toBe(
        true,
      );
    }
  });
});
