import { BASE_URL, IS_BILLING_ENABLED } from "../../../Config";
import { gotoProjectPage } from "./ProductOnboarding";
import {
  APIResponse,
  FrameLocator,
  Locator,
  Page,
  expect,
} from "@playwright/test";
import URL from "Common/Types/API/URL";

type ProjectBillingFunction = (data: {
  page: Page;
  projectId: string;
}) => Promise<void>;

/*
 * A subscription (including a paid-plan trial) does not authorize metered
 * usage. Give feature-test projects a real Stripe test payment method through
 * the billing UI, including its usage consent, before creating paid resources.
 * This must never submit payment details to a live Stripe account.
 */
export const addTestPaymentMethod: ProjectBillingFunction = async (data: {
  page: Page;
  projectId: string;
}): Promise<void> => {
  if (!IS_BILLING_ENABLED) {
    return;
  }

  const page: Page = data.page;
  const usesStripeTestMode: boolean = await page.evaluate((): boolean => {
    const browserWindow: Window & {
      process?: { env?: Record<string, string | undefined> };
    } = window;
    return Boolean(
      browserWindow.process?.env?.["BILLING_PUBLIC_KEY"]?.startsWith(
        "pk_test_",
      ),
    );
  });
  expect(
    usesStripeTestMode,
    "SaaS E2E payment setup requires a Stripe test-mode publishable key (pk_test_).",
  ).toBe(true);

  const billingUrl: string = URL.fromString(BASE_URL.toString())
    .addRoute(`/dashboard/${data.projectId}/settings/billing`)
    .toString();
  const addPaymentMethodButton: Locator = page.getByRole("button", {
    name: "Add Payment Method",
    exact: true,
  });

  await gotoProjectPage({
    page,
    projectId: data.projectId,
    url: billingUrl,
    ready: addPaymentMethodButton,
  });
  await addPaymentMethodButton.click();

  const modal: Locator = page.getByTestId("modal");
  await expect(modal).toBeVisible();
  await modal
    .getByTestId("payment-method-usage-consent")
    .check({ timeout: 60000 });

  // Stripe's bank-search helper shares the title, even for a card-only form.
  const paymentFrame: FrameLocator = modal.frameLocator(
    'iframe[title="Secure payment input frame"]:not([aria-hidden="true"])',
  );
  await paymentFrame
    .locator('input[name="number"]')
    .fill("4242424242424242", { timeout: 60000 });
  await paymentFrame
    .locator('input[name="expiry"]')
    .fill(`12${String(new Date().getFullYear() + 3).slice(-2)}`);
  await paymentFrame.locator('input[name="cvc"]').fill("123");
  await paymentFrame.locator('select[name="country"]').selectOption("US");
  await paymentFrame.locator('input[name="postalCode"]').fill("10001");

  await modal.getByTestId("modal-footer-submit-button").click();
  await expect(modal).toBeHidden({ timeout: 60000 });

  // Check the gate before waiting on UI state so API failures retain their cause.
  const statusResponse: APIResponse = await page.request.get(
    URL.fromString(BASE_URL.toString())
      .addRoute("/api/billing/pay-as-you-go-status")
      .toString(),
    { headers: { tenantid: data.projectId } },
  );
  const statusDiagnostic: string = `GET /api/billing/pay-as-you-go-status returned ${statusResponse.status()}: ${await statusResponse.text()}`;
  expect(statusResponse.ok(), statusDiagnostic).toBe(true);
  expect(await statusResponse.json(), statusDiagnostic).toMatchObject({
    isAllowed: true,
  });

  await expect(page.getByTestId("billing-usage-status")).toContainText(
    "A payment method is on file.",
    { timeout: 60000 },
  );
  await expect(
    page.getByRole("row").filter({ hasText: "*****4242" }),
  ).toBeVisible({
    timeout: 60000,
  });
};
