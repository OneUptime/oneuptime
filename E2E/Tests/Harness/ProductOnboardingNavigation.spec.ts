import { waitForOnboardingWelcome } from "../Dashboard/Helpers/ProductOnboarding";
import { Locator, Page, expect, test } from "@playwright/test";

test.describe("Product onboarding navigation", () => {
  test("lets Dashboard finish the intermediate handoff without starting a competing navigation", async () => {
    const dashboardUrl: string = "http://localhost/dashboard";
    const welcomeUrl: string = "http://localhost/dashboard/welcome";
    const calls: Array<string> = [];
    let currentUrl: string = dashboardUrl;

    const page: Page = {
      getByTestId: (testId: string): Locator => {
        expect(testId).toBe("create-new-project-button");

        return {
          waitFor: async (): Promise<void> => {
            calls.push("wait-for-create-project-button");
            expect(currentUrl).toBe(welcomeUrl);
          },
        } as Locator;
      },
      goto: async (): Promise<never> => {
        throw new Error(
          "the helper must not compete with Dashboard navigation",
        );
      },
      waitForURL: async (url: string | RegExp): Promise<void> => {
        calls.push("wait-for-welcome-url");
        expect(url).toBe(welcomeUrl);
        expect(currentUrl).toBe(dashboardUrl);

        // Simulate Dashboard Init completing its own SPA redirect.
        currentUrl = welcomeUrl;
      },
    } as unknown as Page;

    await waitForOnboardingWelcome({ page, welcomeUrl });

    expect(calls).toEqual([
      "wait-for-welcome-url",
      "wait-for-create-project-button",
    ]);
  });

  test("preserves the final-route failure instead of masking it", async () => {
    const navigationError: Error = new Error(
      "Dashboard did not reach the onboarding route",
    );
    let waitedForButton: boolean = false;

    const page: Page = {
      getByTestId: (): Locator => {
        return {
          waitFor: async (): Promise<void> => {
            waitedForButton = true;
          },
        } as Locator;
      },
      waitForURL: async (): Promise<void> => {
        throw navigationError;
      },
    } as unknown as Page;

    await expect(
      waitForOnboardingWelcome({
        page,
        welcomeUrl: "http://localhost/dashboard/welcome",
      }),
    ).rejects.toBe(navigationError);
    expect(waitedForButton).toBe(false);
  });
});
