import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { Page, expect, test, Response } from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";

test.describe("Monitor Creation", () => {
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

    const projectName: string =
      "E2E Monitor Project " + Faker.generateName().toString();
    await page
      .locator("#create-project-from input[type='text']")
      .first()
      .fill(projectName);

    if (IS_BILLING_ENABLED) {
      await page.getByTestId("modal-footer-submit-button").click();

      await page
        .locator("[data-testid^='card-select-option-']")
        .first()
        .click();

      await page.getByTestId("modal-footer-submit-button").click();
    } else {
      await page.getByTestId("modal-footer-submit-button").click();
    }

    // Wait for navigation to the project dashboard
    await page.waitForURL(/\/dashboard\/[a-f0-9-]+/, {
      timeout: 30000,
    });

    // Wait for the page to fully settle after project creation
    // The app may perform internal redirects after project setup
    await page.waitForLoadState("networkidle");

    // Extract the project ID from the URL
    const projectUrl: string = page.url();
    const projectIdMatch: RegExpMatchArray | null = projectUrl.match(
      /\/dashboard\/([a-f0-9-]+)/,
    );
    expect(projectIdMatch).not.toBeNull();
    const projectId: string = projectIdMatch![1]!;

    // Navigate to the monitor creation page
    await page.goto(
      URL.fromString(BASE_URL.toString())
        .addRoute(`/dashboard/${projectId}/monitors/create`)
        .toString(),
      { waitUntil: "networkidle" },
    );

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
