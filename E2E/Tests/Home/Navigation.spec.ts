import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

test.beforeEach(async ({ page }: { page: Page }) => {
  if (!IS_BILLING_ENABLED) {
    return;
  }

  await page.goto(URL.fromString(BASE_URL.toString()).toString());
});

test.describe("navigation bar", () => {
  test("product page", async ({ page }: { page: Page }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }
    await page.getByRole("button", { name: "Products" }).click();
    await page.getByRole("button", { name: "Products" }).hover();
    await expect(page.getByRole("button", { name: "Products" })).toHaveText(
      /Products/,
    );
    await expect(page.getByRole("button", { name: "Products" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Products" }),
    ).toBeInViewport();
  });

  test("pricing page", async ({ page }: { page: Page }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }
    const navPricingLink: Locator = page
      .getByRole("navigation")
      .getByRole("link", { name: "Pricing" });
    await navPricingLink.click();
    await navPricingLink.hover();
    await expect(navPricingLink).toHaveText(/Pricing/);
    await expect(navPricingLink).toBeVisible();
    await expect(navPricingLink).toBeInViewport();
    await expect(page).toHaveURL(/.*pricing/);
  });

  test("Enterprise", async ({ page }: { page: Page }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }
    // Enterprise is now a dropdown button, not a direct link
    const navEnterpriseButton: Locator = page
      .getByRole("navigation")
      .getByRole("button", { name: "Enterprise" });
    await navEnterpriseButton.click();
    await expect(navEnterpriseButton).toBeVisible();
    await expect(navEnterpriseButton).toBeInViewport();
    await expect(navEnterpriseButton).toHaveText(/Enterprise/);

    // Click on Enterprise Overview link in the dropdown
    const enterpriseOverviewLink: Locator = page
      .getByRole("link", { name: "Enterprise Overview" })
      .first();
    await enterpriseOverviewLink.click();
    await expect(page).toHaveURL(/.*enterprise\/overview/);
  });

  test("Request Demo", async ({ page }: { page: Page }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }
    // Request Demo is now inside the Enterprise dropdown
    const navEnterpriseButton: Locator = page
      .getByRole("navigation")
      .getByRole("button", { name: "Enterprise" });
    await navEnterpriseButton.click();

    await page.getByTestId("request-demo-desktop-link").click();
    await expect(page).toHaveURL(/.*enterprise\/demo/);
  });
});
