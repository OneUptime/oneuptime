import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import {
  PaymentGatedResponse,
  addTestPaymentMethod,
  sendThroughPaymentGate,
} from "./Helpers/Billing";
import { registerAndCreateProject } from "./Helpers/ProductOnboarding";
import { createTelemetryIngestionKey } from "./Helpers/Telemetry";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

test.describe("Payment method authorizes paid usage", () => {
  test.skip(!IS_BILLING_ENABLED, "Requires Stripe test-mode billing.");

  test("Free project can create paid resources only after adding a payment method", async ({
    page,
  }: {
    page: Page;
  }) => {
    /*
     * Both gate checks below may each wait out up to ~140s of "please try
     * again" from the payment provider; leave room for that instead of
     * letting the test timeout hide which check it was.
     */
    test.setTimeout(480000);

    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Billing Free",
      preferredPlanName: "Free",
      enablePaidUsage: false,
    });

    try {
      /*
       * Sending the create again is safe: the payment gate throws in
       * TelemetryIngestionKeyService.onBeforeCreate, before the key is
       * saved, so a "please try again" answer created nothing.
       */
      const blocked: PaymentGatedResponse = await sendThroughPaymentGate({
        send: (): Promise<APIResponse> => {
          return page.request.post(
            URL.fromString(BASE_URL.toString())
              .addRoute("/api/telemetry-ingestion-key")
              .toString(),
            {
              headers: { tenantid: projectId },
              data: {
                data: { name: "Key before payment method", projectId },
              },
            },
          );
        },
      });
      const blockedResponse: APIResponse = blocked.response;
      const blockedResponseDetail: string =
        blockedResponse.status() >= 400
          ? await blockedResponse.text()
          : "Successful response body omitted.";
      const blockedDiagnostic: string = `POST /api/telemetry-ingestion-key returned ${blockedResponse.status()}: ${blockedResponseDetail}${blocked.retryDiagnostic}`;
      expect(blockedResponse.status(), blockedDiagnostic).toBe(402);
      expect(await blockedResponse.json(), blockedDiagnostic).toMatchObject({
        error: expect.stringContaining("Add a payment method"),
      });

      await addTestPaymentMethod({ page, projectId });
      await createTelemetryIngestionKey({
        page,
        projectId,
        keyName: "Key after payment method",
      });
    } finally {
      // Project deletion also cancels its Stripe test subscriptions.
      const deleteResponse: APIResponse = await page.request.delete(
        URL.fromString(BASE_URL.toString())
          .addRoute(`/api/project/${projectId}`)
          .toString(),
        { headers: { tenantid: projectId } },
      );
      const deleteResponseDetail: string =
        deleteResponse.status() >= 400
          ? await deleteResponse.text()
          : "Successful response body omitted.";
      expect(
        deleteResponse.ok(),
        `DELETE /api/project returned ${deleteResponse.status()}: ${deleteResponseDetail}`,
      ).toBe(true);
    }
  });

  /*
   * The payment-method requirement applies only to the Free plan: a paid plan
   * is itself the billing agreement, so a Growth project may use paid
   * features straight away, with no card on file.
   */
  test("Growth project can create paid resources without a payment method", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(480000);

    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Billing Growth",
      preferredPlanName: "Growth",
      enablePaidUsage: false,
    });

    try {
      await createTelemetryIngestionKey({
        page,
        projectId,
        keyName: "Key on a paid plan without a card",
      });
    } finally {
      // Project deletion also cancels its Stripe test subscriptions.
      const deleteResponse: APIResponse = await page.request.delete(
        URL.fromString(BASE_URL.toString())
          .addRoute(`/api/project/${projectId}`)
          .toString(),
        { headers: { tenantid: projectId } },
      );
      const deleteResponseDetail: string =
        deleteResponse.status() >= 400
          ? await deleteResponse.text()
          : "Successful response body omitted.";
      expect(
        deleteResponse.ok(),
        `DELETE /api/project returned ${deleteResponse.status()}: ${deleteResponseDetail}`,
      ).toBe(true);
    }
  });
});
