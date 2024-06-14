import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

test.beforeEach(async ({ page }: { page: Page }) => {
  if (!IS_BILLING_ENABLED) {
    return;
  }

  await page.goto(URL.fromString(BASE_URL.toString()).toString());
});
test.describe("check if pages loades with its title", () => {
  test("has title", async ({ page }: { page: Page }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    await expect(page).toHaveTitle(
      /OneUptime | One Complete SRE and DevOps platform./,
    );
  });
  test("oneUptime link navigate to homepage", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    await page.getByRole("link", { name: "OneUptime", exact: true }).click();

    await expect(page).toHaveURL(
      URL.fromString(BASE_URL.toString()).toString(),
    );
  });
});
