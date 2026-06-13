import { BASE_URL, IS_BILLING_ENABLED } from "../../../Config";
import { Page, expect, Response, Locator } from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";
import selectProjectPlan from "../../Helpers/selectProjectPlan";

const projectDashboardUrlRegex: RegExp =
  /\/dashboard\/([a-f0-9-]+)(?:\/home\/?)?$/;

/*
 * Registers a fresh user, creates a project, and returns the project id.
 * Mirrors the flow in CreateProject.spec.ts / CreateMonitor.spec.ts so the
 * product onboarding specs stay consistent with the existing Dashboard
 * specs (register -> selectProjectPlan -> getByTestId navigation).
 */
type RegisterAndCreateProjectFunction = (data: {
  page: Page;
  projectNamePrefix: string;
}) => Promise<string>;

export const registerAndCreateProject: RegisterAndCreateProjectFunction =
  async (data: { page: Page; projectNamePrefix: string }): Promise<string> => {
    const page: Page = data.page;

    let pageResult: Response | null = await page.goto(
      URL.fromString(BASE_URL.toString())
        .addRoute("/accounts/register")
        .toString(),
    );

    while (pageResult?.status() === 504 || pageResult?.status() === 502) {
      try {
        pageResult = await page.reload();
      } catch {
        pageResult = await page.goto(
          URL.fromString(BASE_URL.toString())
            .addRoute("/accounts/register")
            .toString(),
        );
      }
    }

    const email: string = Faker.generateEmail().toString();

    await page.getByTestId("email").click();
    await page.getByTestId("email").fill(email);
    await page.getByTestId("email").press("Tab");
    await page.getByTestId("name").fill("E2E Test User");
    await page.getByTestId("name").press("Tab");

    if (IS_BILLING_ENABLED) {
      await page.getByTestId("companyName").fill("E2E Test Company");
      await page.getByTestId("companyName").press("Tab");
      await page.getByTestId("companyPhoneNumber").fill("+1234567890");
      await page.getByTestId("companyPhoneNumber").press("Tab");
    }

    await page.getByTestId("password").fill("sample");
    await page.getByTestId("password").press("Tab");
    await page.getByTestId("confirmPassword").fill("sample");
    await page.getByTestId("Sign Up").click();

    await page.waitForURL(
      URL.fromString(BASE_URL.toString())
        .addRoute("/dashboard/welcome")
        .toString(),
    );

    await page.getByTestId("create-new-project-button").click();
    await page.getByTestId("modal").waitFor({ state: "visible" });
    const modalSubmitButton: Locator = page.getByTestId(
      "modal-footer-submit-button",
    );

    const projectName: string =
      data.projectNamePrefix + " " + Faker.generateName().toString();
    await page
      .locator("#create-project-from input[type='text']")
      .first()
      .fill(projectName);

    if (IS_BILLING_ENABLED) {
      await modalSubmitButton.click();

      await selectProjectPlan({ page, submitButton: modalSubmitButton });

      await modalSubmitButton.click();
    } else {
      await modalSubmitButton.click();
    }

    /*
     * Wait for navigation to the project dashboard. The app does a hard
     * reload (window.location.href) after project creation, so poll the URL
     * with toHaveURL instead of waiting for a navigation event.
     */
    await expect(page).toHaveURL(projectDashboardUrlRegex, { timeout: 120000 });

    // Let project-selection redirects finish before navigating deeper.
    await page.waitForTimeout(2000);

    const projectUrl: string = page.url();
    const projectIdMatch: RegExpMatchArray | null = projectUrl.match(
      projectDashboardUrlRegex,
    );
    expect(projectIdMatch).not.toBeNull();
    return projectIdMatch![1]!;
  };

/*
 * Navigates to a page inside the project dashboard and waits for a ready
 * locator, retrying when the project-selection redirect bounces the SPA
 * back to the project home page (same retry loop as CreateMonitor.spec.ts).
 */
type GotoProjectPageFunction = (data: {
  page: Page;
  projectId: string;
  url: string;
  ready: Locator;
}) => Promise<void>;

export const gotoProjectPage: GotoProjectPageFunction = async (data: {
  page: Page;
  projectId: string;
  url: string;
  ready: Locator;
}): Promise<void> => {
  let lastNavigationError: Error | null = null;

  for (let attempt: number = 0; attempt < 3; attempt++) {
    try {
      await data.page.goto(data.url, { waitUntil: "domcontentloaded" });
      await data.ready.waitFor({ state: "visible", timeout: 30000 });
      lastNavigationError = null;
      break;
    } catch (error) {
      lastNavigationError = error as Error;

      if (attempt === 2) {
        break;
      }

      await data.page.waitForURL(
        new RegExp(`/dashboard/${data.projectId}(?:/home/?)?$`),
        {
          timeout: 30000,
        },
      );
      await data.page.waitForTimeout(1000);
    }
  }

  if (lastNavigationError) {
    throw lastNavigationError;
  }
};

/*
 * Fills and submits the inline "Create Ingestion Key" ModelFormModal used
 * by the Proxmox/Ceph DocumentationCard (form id "create-ingestion-key").
 * The caller clicks the trigger button first — either the empty-state
 * "Create Ingestion Key" CTA or the "New Key" button next to the dropdown.
 */
type SubmitIngestionKeyModalFunction = (data: {
  page: Page;
  keyName: string;
}) => Promise<void>;

export const submitIngestionKeyModal: SubmitIngestionKeyModalFunction =
  async (data: { page: Page; keyName: string }): Promise<void> => {
    await data.page.getByTestId("modal").waitFor({ state: "visible" });
    await data.page
      .locator("#create-ingestion-key input[type='text']")
      .first()
      .fill(data.keyName);
    await data.page.getByTestId("modal-footer-submit-button").click();
    await data.page.getByTestId("modal").waitFor({ state: "hidden" });
  };
