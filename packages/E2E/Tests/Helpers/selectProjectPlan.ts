import { expect, Locator, Page } from "@playwright/test";

/*
 * Picks a plan in the billing-enabled Create New Project dialog.
 *
 * The dialog is one page: Project Name, then the plan picker (PlanPicker), a
 * radio per plan named by the plan, with Free picked to start with. So a spec
 * that does not mind which plan it gets needs no click at all.
 *
 * `preferredPlanName` (e.g. "Growth") picks that plan's radio by its exact
 * name. Some features - on-call duty policy execution logs and user on-call
 * notification logs among them - are gated behind the Growth plan when
 * billing is enabled (see TableBillingAccessControl on those models), so
 * specs that assert on them must not land on Free. When the preferred plan is
 * not offered by the server's configured plan list, the helper keeps the plan
 * already picked, or picks the first one when none is (a deployment that
 * sells only paid plans picks none for you).
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
  const picker: Locator = data.page
    .getByTestId("modal")
    .getByTestId("plan-picker");

  await expect(picker).toBeVisible({ timeout: 30000 });

  const planOptions: Locator = picker.getByRole("radio");

  await expect(planOptions.first()).toBeVisible({ timeout: 30000 });
  expect(await planOptions.count()).toBeGreaterThan(0);

  if (data.preferredPlanName) {
    const preferred: Locator = picker.getByRole("radio", {
      name: data.preferredPlanName,
      exact: true,
    });

    if ((await preferred.count()) > 0) {
      await preferred.check();
      await expect(preferred).toBeChecked();
      await expect(data.submitButton).toBeEnabled({ timeout: 30000 });
      return;
    }
  }

  if ((await picker.getByRole("radio", { checked: true }).count()) === 0) {
    await planOptions.first().check();
  }

  await expect(picker.getByRole("radio", { checked: true })).toHaveCount(1);
  await expect(data.submitButton).toBeEnabled({ timeout: 30000 });
};

export default selectProjectPlan;
