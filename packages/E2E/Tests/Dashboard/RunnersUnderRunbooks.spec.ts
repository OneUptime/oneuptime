import { BASE_URL } from "../../Config";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import { APIResponse, Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

interface RunnerRecord {
  _id: string;
  name: string;
}

const urlFor: (path: string) => string = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

/*
 * For assertions that wait on the server (a save, a page's first fetch, a
 * full navigation): the suite's 5s default is for what is already on screen.
 */
const SERVER: { timeout: number } = { timeout: 30000 };

/*
 * Runners are set up under Runbooks → Runners; they used to be a Project
 * Settings page. Real navigation, the real create form and real persistence:
 * the Runner is created through the dashboard, read back through the API,
 * opened, reached again through the old Project Settings bookmarks, and
 * deleted. A temporary project isolates it and is deleted even when the test
 * fails. Growth, because Runner Credentials are a Growth feature when billing
 * is on.
 *
 * cd packages/E2E && HOST=localhost HTTP_PROTOCOL=http \
 *   npx playwright test Tests/Dashboard/RunnersUnderRunbooks.spec.ts \
 *   --project=chromium --retries=0
 */
test.describe("Runners live under Runbooks", () => {
  test("a Runner is created, opened, bookmarked and deleted under Runbooks", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Runners",
      preferredPlanName: "Growth",
      enablePaidUsage: false,
    });

    try {
      const runbooksPath: string = `/dashboard/${projectId}/runbooks`;
      const runnersPath: string = `${runbooksPath}/runners`;
      const credentialsPath: string = `${runbooksPath}/runner-credentials`;
      const settingsPath: string = `/dashboard/${projectId}/settings`;
      const runnerName: string = "e2e-runbooks-runner";

      const runnersLink: Locator = page.locator(`a[href='${runnersPath}']`);
      const credentialsLink: Locator = page.locator(
        `a[href='${credentialsPath}']`,
      );
      const breadcrumb: Locator = page.getByRole("navigation", {
        name: "Breadcrumb",
      });
      const modal: Locator = page.getByTestId("modal");

      const readRunners: () => Promise<Array<RunnerRecord>> = async (): Promise<
        Array<RunnerRecord>
      > => {
        const response: APIResponse = await page.request.post(
          urlFor("/api/runner/get-list"),
          {
            headers: { tenantid: projectId },
            data: {
              query: { projectId, name: runnerName },
              select: { _id: true, name: true },
              limit: 2,
              skip: 0,
              sort: {},
            },
          },
        );
        expect(response.ok(), await response.text()).toBe(true);
        const body: { data: Array<RunnerRecord> } = await response.json();
        return body.data;
      };

      /*
       * The Runbooks menu lists both Runner pages, in a Runners section that
       * starts folded down to its title, like every rarely used section: its
       * rows are hidden until it is opened.
       */
      const runnersSectionToggle: Locator = page
        .locator("aside[role='navigation'][aria-label='Main navigation']")
        .locator(
          "xpath=.//h6[normalize-space(.)='Runners']/ancestor::button[1]",
        );
      await gotoProjectPage({
        page,
        projectId,
        url: urlFor(runbooksPath),
        ready: runnersSectionToggle,
      });
      await expect(runnersSectionToggle).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await expect(runnersLink.first()).toBeHidden();
      await runnersSectionToggle.click();
      await expect(runnersSectionToggle).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      await expect(runnersLink.first()).toBeVisible();
      await expect(credentialsLink.first()).toBeVisible();

      // Its Runners entry opens the list, under Runbooks.
      await runnersLink.first().click();
      await expect(page).toHaveURL(urlFor(runnersPath), SERVER);
      await expect(breadcrumb).toContainText("Runbooks");
      await expect(breadcrumb).toContainText("Runners");
      await expect(breadcrumb).not.toContainText("Settings");
      // The menu section is a heading called Runners too: this is the card's.
      await expect(page.getByTestId("card-details-heading")).toHaveText(
        "Runners",
        SERVER,
      );

      // Create a Runner through the form: Runner, Capabilities, Labels.
      await page
        .getByTestId("card-button")
        .and(page.getByRole("button", { name: "Create Runner", exact: true }))
        .click();
      await expect(modal).toBeVisible();
      await modal
        .getByPlaceholder("prod-eu-runner", { exact: true })
        .fill(runnerName);
      const submit: Locator = modal.getByTestId("modal-footer-submit-button");
      await expect(submit).toHaveText("Next");
      await submit.click();
      // Capabilities: a new Runner runs runbooks unless told otherwise.
      await expect(
        modal.getByRole("switch", { name: /^Runs Runbooks/ }),
      ).toBeChecked();
      await expect(submit).toHaveText("Next");
      await submit.click();
      await expect(submit).not.toHaveText("Next");
      await submit.click();
      await expect(modal).toBeHidden(SERVER);

      // It is saved, and listed where it was created.
      await expect
        .poll(async (): Promise<number> => {
          return (await readRunners()).length;
        }, SERVER)
        .toBe(1);
      const runner: RunnerRecord = (await readRunners())[0]!;
      const runnerPath: string = `${runnersPath}/${runner._id}`;
      const row: Locator = page
        .getByRole("row")
        .filter({ hasText: runnerName });
      await expect(row).toBeVisible(SERVER);
      await expect(page).toHaveURL(urlFor(runnersPath));

      // View Runner opens its page under Runbooks, with the install command.
      const runnerDetails: Locator = page.getByRole("heading", {
        name: "Runner Details",
        exact: true,
      });
      await row.getByRole("button", { name: "View Runner" }).click();
      await expect(page).toHaveURL(urlFor(runnerPath), SERVER);
      await expect(runnerDetails).toBeVisible(SERVER);
      await expect(breadcrumb).toContainText("View Runner");
      await expect(
        page.getByText(`ONEUPTIME_RUNNER_ID=${runner._id}`),
      ).toBeVisible(SERVER);

      // A bookmarked Runner URL also resolves after a full reload.
      await page.reload();
      await expect(runnerDetails).toBeVisible(SERVER);
      await expect(page).toHaveURL(urlFor(runnerPath));

      // The old Project Settings bookmarks arrive at the same pages.
      await page.goto(urlFor(`${settingsPath}/runners/${runner._id}`));
      await expect(page).toHaveURL(urlFor(runnerPath), SERVER);
      await expect(runnerDetails).toBeVisible(SERVER);

      await page.goto(urlFor(`${settingsPath}/runner-credentials`));
      await expect(page).toHaveURL(urlFor(credentialsPath), SERVER);
      await expect(breadcrumb).toContainText("Runner Credentials", SERVER);

      await page.goto(urlFor(`${settingsPath}/runners`));
      await expect(page).toHaveURL(urlFor(runnersPath), SERVER);
      await expect(row).toBeVisible(SERVER);

      // Project Settings no longer lists them.
      await gotoProjectPage({
        page,
        projectId,
        url: urlFor(settingsPath),
        ready: page.locator(`a[href='${settingsPath}/labels']`).first(),
      });
      await expect(
        page.locator(`a[href*='${settingsPath}/runner']`),
      ).toHaveCount(0);
      await expect(page.locator(`a[href*='/runbooks/runner']`)).toHaveCount(0);

      // Deleting the Runner returns to Runbooks → Runners, without it.
      await page.goto(urlFor(runnerPath));
      await expect(runnerDetails).toBeVisible(SERVER);
      await page
        .getByRole("button", { name: "Delete Runner", exact: true })
        .click();
      await expect(modal).toBeVisible();
      await modal.getByTestId("modal-footer-submit-button").click();
      await expect(page).toHaveURL(urlFor(runnersPath), SERVER);
      await expect
        .poll(async (): Promise<number> => {
          return (await readRunners()).length;
        }, SERVER)
        .toBe(0);
      await expect(row).toHaveCount(0, SERVER);
    } finally {
      const response: APIResponse = await page.request.delete(
        urlFor(`/api/project/${projectId}`),
        { headers: { tenantid: projectId } },
      );
      expect(response.ok(), "Temporary Runners project is deleted").toBe(true);
    }
  });
});
