import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { Page, expect, test, Response, Locator } from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";
import selectProjectPlan from "../Helpers/selectProjectPlan";

const projectDashboardUrlRegex: RegExp =
  /\/dashboard\/([a-f0-9-]+)(?:\/home\/?)?$/;

test.describe.skip("Monitor Creation", () => {
  test("should be able to create a new monitor", async ({
    page,
  }: {
    page: Page;
  }) => {
    // Register a new user first
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

    // Create a project first
    await page.getByTestId("create-new-project-button").click();
    await page.getByTestId("modal").waitFor({ state: "visible" });
    const modalSubmitButton: Locator = page.getByTestId(
      "modal-footer-submit-button",
    );

    const projectName: string =
      "E2E Monitor Project " + Faker.generateName().toString();
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
     * Wait for navigation to the project dashboard.
     * The app does a hard reload (window.location.href) after project creation.
     * Use toHaveURL assertion which polls the URL, avoiding issues with
     * navigation event detection during hard reloads.
     */
    await expect(page).toHaveURL(projectDashboardUrlRegex, { timeout: 120000 });

    // Let project-selection redirects finish before navigating deeper.
    await page.waitForTimeout(2000);

    // Extract the project ID from the URL
    const projectUrl: string = page.url();
    const projectIdMatch: RegExpMatchArray | null = projectUrl.match(
      projectDashboardUrlRegex,
    );
    expect(projectIdMatch).not.toBeNull();
    const projectId: string = projectIdMatch![1]!;

    // Navigate to the monitor creation page
    const monitorCreateUrl: string = URL.fromString(BASE_URL.toString())
      .addRoute(`/dashboard/${projectId}/monitors/create`)
      .toString();

    let lastNavigationError: Error | null = null;

    for (let attempt: number = 0; attempt < 3; attempt++) {
      try {
        await page.goto(monitorCreateUrl, { waitUntil: "domcontentloaded" });
        await page
          .locator("#create-monitor-form")
          .waitFor({ state: "visible", timeout: 30000 });
        lastNavigationError = null;
        break;
      } catch (error) {
        lastNavigationError = error as Error;

        if (attempt === 2) {
          break;
        }

        await page.waitForURL(
          new RegExp(`/dashboard/${projectId}(?:/home/?)?$`),
          {
            timeout: 30000,
          },
        );
        await page.waitForTimeout(1000);
      }
    }

    if (lastNavigationError) {
      throw lastNavigationError;
    }

    // Wait for the create monitor form to load
    await page.locator("#create-monitor-form").waitFor({ state: "visible" });

    // Fill in monitor name
    const monitorName: string =
      "E2E Test Monitor " + Faker.generateName().toString();
    await page
      .locator("#create-monitor-form input[placeholder='Monitor Name']")
      .fill(monitorName);

    // Select "Manual" monitor type (simplest - no criteria or interval steps needed)
    await page.getByTestId("card-select-option-Manual").click();

    // Click "Create Monitor" to submit (Manual type has no additional steps)
    await page.getByTestId("Create Monitor").click();

    // Wait for navigation to the monitor view page
    await page.waitForURL(
      new RegExp(`/dashboard/${projectId}/monitors/[a-f0-9-]+`),
      {
        timeout: 30000,
      },
    );

    // Verify we are on the monitor view page
    const monitorUrl: string = page.url();
    expect(monitorUrl).toMatch(
      new RegExp(`/dashboard/${projectId}/monitors/[a-f0-9-]+`),
    );
  });
});
