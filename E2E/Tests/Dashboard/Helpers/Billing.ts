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
 * The start of BillingService.toPaymentProviderReadFailure's message: the 503
 * the product sends when Stripe still could not be read after its own retries,
 * telling the client to try again. CI shares its Stripe test account with
 * environments we do not control, so the gate can meet this even when the
 * suite itself is well-behaved. Any other 503 is a different fault.
 */
const PAYMENT_PROVIDER_UNAVAILABLE_PREFIX: string =
  "Could not reach the payment provider";

/*
 * Each of these answers has already spent readPaymentProvider's ladder on the
 * server - 1s+2s+4s+8s with up to 50% jitter, 15-22s - before it came back.
 * 120s leaves room for five server attempts, each its own round of Stripe
 * reads. No attempt starts past the budget, so the worst case is the budget
 * plus the attempt in flight, about 140s. A provider still refusing after that
 * is an outage, and the test should fail naming it rather than wait it out.
 */
const PAYMENT_PROVIDER_RETRY_BUDGET_IN_MS: number = 120000;
const PAYMENT_PROVIDER_FIRST_RETRY_DELAY_IN_MS: number = 2000;
const PAYMENT_PROVIDER_MAX_RETRY_DELAY_IN_MS: number = 16000;

type SendPaymentGatedRequestFunction = () => Promise<APIResponse>;

export interface PaymentGatedResponse {
  response: APIResponse;
  // Append to every assertion message on the response.
  retryDiagnostic: string;
}

type WaitFunction = (ms: number) => Promise<void>;

const wait: WaitFunction = (ms: number): Promise<void> => {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, ms);
  });
};

type IsPaymentProviderUnavailableFunction = (
  response: APIResponse,
) => Promise<boolean>;

const isPaymentProviderUnavailable: IsPaymentProviderUnavailableFunction =
  async (response: APIResponse): Promise<boolean> => {
    if (response.status() !== 503) {
      return false;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return false;
    }

    /*
     * The express error handler sends the exception's message as `error`, and
     * Response.sendErrorResponse sends it as `message`; both carry the same
     * ServiceUnavailableException text.
     */
    const envelope: { error?: unknown; message?: unknown } = (body ?? {}) as {
      error?: unknown;
      message?: unknown;
    };
    return [envelope.error, envelope.message].some(
      (message: unknown): boolean => {
        return (
          typeof message === "string" &&
          message.startsWith(PAYMENT_PROVIDER_UNAVAILABLE_PREFIX)
        );
      },
    );
  };

/*
 * For assertions on the payment gate's definitive answer - a 402, or
 * pay-as-you-go-status's isAllowed. "Please try again" is not that answer, so
 * it is retried within the budget above; the final response, whatever it is,
 * goes back to the caller to assert on. A 503 is never turned into success and
 * no other status is retried. Only use it for a request that a 503 leaves
 * unapplied, because the request is sent again.
 */
export const sendThroughPaymentGate: (data: {
  send: SendPaymentGatedRequestFunction;
}) => Promise<PaymentGatedResponse> = async (data: {
  send: SendPaymentGatedRequestFunction;
}): Promise<PaymentGatedResponse> => {
  const startedAt: number = Date.now();
  let retriedAnswers: number = 0;
  let delayInMs: number = PAYMENT_PROVIDER_FIRST_RETRY_DELAY_IN_MS;
  let response: APIResponse = await data.send();

  while (await isPaymentProviderUnavailable(response)) {
    if (
      Date.now() - startedAt + delayInMs >
      PAYMENT_PROVIDER_RETRY_BUDGET_IN_MS
    ) {
      break;
    }

    await wait(delayInMs);
    delayInMs = Math.min(delayInMs * 2, PAYMENT_PROVIDER_MAX_RETRY_DELAY_IN_MS);
    retriedAnswers++;
    response = await data.send();
  }

  return {
    response,
    retryDiagnostic: ` [retried ${retriedAnswers} "${PAYMENT_PROVIDER_UNAVAILABLE_PREFIX}" 503s over ${Math.round(
      (Date.now() - startedAt) / 1000,
    )}s]`,
  };
};

/*
 * A subscription (including a paid-plan trial) does not authorize metered
 * usage. Give feature-test projects a real Stripe test payment method through
 * the billing UI before creating paid resources.
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
  const status: PaymentGatedResponse = await sendThroughPaymentGate({
    send: (): Promise<APIResponse> => {
      return page.request.get(
        URL.fromString(BASE_URL.toString())
          .addRoute("/api/billing/pay-as-you-go-status")
          .toString(),
        { headers: { tenantid: data.projectId } },
      );
    },
  });
  const statusResponse: APIResponse = status.response;
  const statusDiagnostic: string = `GET /api/billing/pay-as-you-go-status returned ${statusResponse.status()}: ${await statusResponse.text()}${status.retryDiagnostic}`;
  expect(statusResponse.ok(), statusDiagnostic).toBe(true);
  expect(await statusResponse.json(), statusDiagnostic).toMatchObject({
    isAllowed: true,
  });

  await expect(
    page.getByRole("row").filter({ hasText: "*****4242" }),
  ).toBeVisible({
    timeout: 60000,
  });
};
