import { expect, Locator, Page } from "@playwright/test";

const selectProjectPlan = async (data: {
  page: Page;
  submitButton: Locator;
}): Promise<void> => {
  const planOptions: Locator = data.page.locator(
    "[data-testid^='card-select-option-']",
  );

  await expect(planOptions.first()).toBeVisible({ timeout: 30000 });

  const planOptionCount: number = await planOptions.count();
  expect(planOptionCount).toBeGreaterThan(0);

  // Billing can render the default plan as checked while keeping submit disabled
  // until the selection changes. Try each visible option until the form unlocks.
  for (let attempt: number = 0; attempt < planOptionCount * 2; attempt++) {
    await planOptions.nth(attempt % planOptionCount).click();

    if (await data.submitButton.isEnabled()) {
      return;
    }

    await data.page.waitForTimeout(500);
  }

  await expect(data.submitButton).toBeEnabled({ timeout: 30000 });
};

export default selectProjectPlan;
