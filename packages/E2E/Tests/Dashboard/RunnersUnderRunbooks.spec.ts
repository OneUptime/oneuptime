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
 * The heading of the card that lists the project's own Runners: Runners on
 * a server with no global Runner, Custom Runners under the Global Runners
 * card on one that has some.
 */
const OWN_RUNNERS_CARD_HEADING: RegExp = /^(?:Custom )?Runners$/;

/*
 * Runners are set up under Runbooks → Runners; they used to be a Project
 * Settings page. Real navigation, the real create form and real persistence:
 * the Runner is created through the dashboard, read back through the API,
 * opened, reached again through the old Project Settings bookmarks, and
 * deleted. A temporary project isolates it and is deleted even when the test
 * fails. Growth, so every Runbooks page - runbook variables among them - is
 * open when billing is on. The addresses of Runner Credentials, later AI
 * Access, open the Runners: it is gone, with the runbook credentials it held.
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
      // AI Access's address: the page is gone, and the address opens the Runners.
      const aiAccessPath: string = `${runbooksPath}/runner-credentials`;
      const settingsPath: string = `/dashboard/${projectId}/settings`;
      const runnerName: string = "e2e-runbooks-runner";

      const runnersLink: Locator = page.locator(`a[href='${runnersPath}']`);
      const aiAccessLink: Locator = page.locator(`a[href='${aiAccessPath}']`);
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
       * The Runbooks menu lists the Runners with the runbooks and their
       * executions, in its first section, which is open: AI Access, which
       * stood beside them in a folded section of their own, is gone with the
       * runbook credentials it held, and so is that section.
       */
      await gotoProjectPage({
        page,
        projectId,
        url: urlFor(runbooksPath),
        ready: runnersLink.first(),
      });
      await expect(runnersLink.first()).toBeVisible();
      await expect(aiAccessLink).toHaveCount(0);
      await expect(
        page
          .locator("aside[role='navigation'][aria-label='Main navigation']")
          .locator("xpath=.//h6[normalize-space(.)='Runners']"),
      ).toHaveCount(0);

      // Its Runners entry opens the list, under Runbooks.
      await runnersLink.first().click();
      await expect(page).toHaveURL(urlFor(runnersPath), SERVER);
      await expect(breadcrumb).toContainText("Runbooks");
      await expect(breadcrumb).toContainText("Runners");
      await expect(breadcrumb).not.toContainText("Settings");
      /*
       * The card of the project's own Runners. On a server that runs a
       * global Runner - every Docker Compose install does - the global ones
       * have a card of their own above it, and this one is Custom Runners.
       */
      await expect(
        page
          .getByTestId("card-details-heading")
          .filter({ hasText: OWN_RUNNERS_CARD_HEADING }),
      ).toBeVisible(SERVER);

      /*
       * Create a Runner through the form: one page - Name, Description, and
       * More fields folded at its end, holding "Runs Runbooks" (on) and the
       * labels. A Runner has no switch for OneUptime AI's commands: an auto
       * remediation rule picks the Runner.
       */
      await page
        .getByTestId("card-button")
        .and(page.getByRole("button", { name: "Create Runner", exact: true }))
        .click();
      await expect(modal).toBeVisible();
      await modal
        .getByPlaceholder("prod-eu-runner", { exact: true })
        .fill(runnerName);
      // A name is all a Runner needs: Create Runner is right there.
      const submit: Locator = modal.getByTestId("modal-footer-submit-button");
      await expect(modal.getByTestId("modal-footer-next-button")).toHaveCount(
        0,
      );
      await expect(submit).toHaveText("Create Runner");
      const moreFields: Locator = modal.getByRole("button", {
        name: "More fields",
        exact: true,
      });
      await expect(moreFields).toHaveAttribute("aria-expanded", "false");
      await moreFields.click();
      await expect(
        modal.getByRole("switch", { name: /^Runs Runbooks/ }),
      ).toBeChecked();
      await expect(modal).not.toContainText("Runs AI Remediation Commands");
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

      // Runner Credentials, later AI Access, is gone: both its addresses open the Runners.
      for (const gone of [`${settingsPath}/runner-credentials`, aiAccessPath]) {
        await page.goto(urlFor(gone));
        await expect(page).toHaveURL(urlFor(runnersPath), SERVER);
        await expect(row).toBeVisible(SERVER);
        await expect(breadcrumb).not.toContainText("AI Access");
      }

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
