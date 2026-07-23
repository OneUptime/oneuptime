import { expect, Locator, Page } from "@playwright/test";

/*
 * Picks a plan on the billing-enabled "Create Project" modal.
 *
 * `preferredPlanName` (e.g. "Growth") selects that plan by its visible title.
 * Some features — on-call duty policy execution logs and user on-call
 * notification logs — are gated behind the Growth plan when billing is
 * enabled (see TableBillingAccessControl on those models), so specs that
 * assert on them must not land on the free plan. When the preferred plan is
 * not offered by the server's configured plan list, the helper falls back to
 * the "first option that unlocks submit" behaviour used by every other spec.
 */
type SelectProjectPlanFunction = (data: {
  page: Page;
  submitButton: Locator;
  preferredPlanName?: string | undefined;
}) => Promise<void>;

const selectProjectPlan: SelectProjectPlanFunction = async (data: {
  page: Page;
  submitButton: Locator;
  preferredPlanName?: string | undefined;
}): Promise<void> => {
  const planOptions: Locator = data.page.locator(
    "[data-testid^='card-select-option-']",
  );

  await expect(planOptions.first()).toBeVisible({ timeout: 30000 });

  const planOptionCount: number = await planOptions.count();
  expect(planOptionCount).toBeGreaterThan(0);

  if (data.preferredPlanName) {
    const preferred: Locator = planOptions.filter({
      hasText: data.preferredPlanName,
    });

    if ((await preferred.count()) > 0) {
      await preferred.first().click();
      await expect(data.submitButton).toBeEnabled({ timeout: 30000 });
      return;
    }
  }

  /*
   * Billing can render the default plan as checked while keeping submit disabled
   * until the selection changes. Try each visible option until the form unlocks.
   */
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
