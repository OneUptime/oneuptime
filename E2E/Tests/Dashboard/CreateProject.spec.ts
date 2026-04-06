import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { Page, expect, test, Response, Locator } from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";
import selectProjectPlan from "../Helpers/selectProjectPlan";

const projectDashboardUrlRegex: RegExp =
  /\/dashboard\/([a-f0-9-]+)(?:\/home\/?)?$/;

test.describe("Project Creation", () => {
  test("should be able to create a new project", async ({
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

    await page.getByTestId("email").click();
    await page.getByTestId("email").fill(Faker.generateEmail().toString());
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

    // Click the "Create New Project" button
    await page.getByTestId("create-new-project-button").click();

    // Wait for the project creation modal to appear
    await page.getByTestId("modal").waitFor({ state: "visible" });
    const modalSubmitButton: Locator = page.getByTestId(
      "modal-footer-submit-button",
    );

    // Fill in the project name
    const projectName: string =
      "E2E Test Project " + Faker.generateName().toString();
    await page
      .locator("#create-project-from input[type='text']")
      .first()
      .fill(projectName);

    if (IS_BILLING_ENABLED) {
      // Click "Next" to go to the plan selection step
      await modalSubmitButton.click();

      await selectProjectPlan({ page, submitButton: modalSubmitButton });

      // Submit the form to create the project
      await modalSubmitButton.click();
    } else {
      // Submit the form to create the project
      await modalSubmitButton.click();
    }

    // Wait for navigation to the project dashboard.
    // The app does a hard reload (window.location.href) after project creation.
    // Use toHaveURL assertion which polls the URL, avoiding issues with
    // navigation event detection during hard reloads.
    await expect(page).toHaveURL(projectDashboardUrlRegex, { timeout: 120000 });

    // Give any final redirect triggered by project selection time to settle.
    await page.waitForTimeout(2000);
  });
});
