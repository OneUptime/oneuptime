import {
  BASE_URL,
  IS_USER_REGISTERED,
  REGISTERED_USER_EMAIL,
  REGISTERED_USER_PASSWORD,
} from "../../Config";
import { Locator, Page, expect, test, Response } from "@playwright/test";
import URL from "Common/Types/API/URL";

test.describe("Login", () => {
  test("should be able to login", async ({ page }: { page: Page }) => {
    if (
      !IS_USER_REGISTERED ||
      !REGISTERED_USER_EMAIL ||
      !REGISTERED_USER_PASSWORD
    ) {
      // pass this test if the user is not registered
      return;
    }

    // go to login page
    const pageResult: Response | null = await page.goto(
      URL.fromString(BASE_URL.toString()).addRoute("/accounts/").toString(),
    );

    if (pageResult?.status() === 504 || pageResult?.status() === 502) {
      // reload page if it fails to load
      await page.reload();
    }

    await page.locator('input[type="email"]').click();
    await page
      .locator('input[type="email"]')
      .fill(REGISTERED_USER_EMAIL.toString());
    await page.locator('input[type="email"]').press("Tab");
    await page
      .locator('input[type="password"]')
      .fill(REGISTERED_USER_PASSWORD.toString());
    await page.locator('input[type="password"]').press("Enter");

    // wait for navigation with base url
    await page.waitForURL(
      URL.fromString(BASE_URL.toString())
        .addRoute("/dashboard/welcome")
        .toString(),
    );
    expect(page.url()).toBe(
      URL.fromString(BASE_URL.toString())
        .addRoute("/dashboard/welcome")
        .toString(),
    );

    await page.getByTestId("create-new-project-button").click();
  });

  /*
   * A refused sign-in leaves the Email field editable. It used to turn
   * read-only after the first refusal, so a mistyped address could only be
   * fixed by reloading the page.
   */
  test("a mistyped address can be corrected after a refused sign-in", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(
      !IS_USER_REGISTERED ||
        !REGISTERED_USER_EMAIL ||
        !REGISTERED_USER_PASSWORD,
      "needs a registered account to sign in as",
    );

    page.setDefaultNavigationTimeout(120000); // 2 minutes

    await page.goto(
      URL.fromString(BASE_URL.toString())
        .addRoute("/accounts/login")
        .toString(),
    );

    // `.invalid` is reserved (RFC 2606), so no account can have it.
    const email: Locator = page.locator('input[type="email"]');
    const password: Locator = page.locator('input[type="password"]');
    await email.fill("e2e-mistyped-address@oneuptime-e2e.invalid");
    await password.fill(REGISTERED_USER_PASSWORD);
    await password.press("Enter");

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(email).toBeEditable();

    await email.fill(REGISTERED_USER_EMAIL);
    await password.fill(REGISTERED_USER_PASSWORD);
    await password.press("Enter");

    await page.waitForURL((url: globalThis.URL) => {
      return url.pathname.startsWith("/dashboard");
    });
  });
});
