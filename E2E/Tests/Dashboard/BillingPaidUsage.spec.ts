import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { addTestPaymentMethod } from "./Helpers/Billing";
import { registerAndCreateProject } from "./Helpers/ProductOnboarding";
import { createTelemetryIngestionKey } from "./Helpers/Telemetry";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

test.describe("Payment method authorizes paid usage", () => {
  test.skip(!IS_BILLING_ENABLED, "Requires Stripe test-mode billing.");

  for (const planName of ["Free", "Growth"]) {
    test(`${planName} project can create paid resources only after adding a payment method`, async ({
      page,
    }: {
      page: Page;
    }) => {
      test.setTimeout(300000);

      const projectId: string = await registerAndCreateProject({
        page,
        projectNamePrefix: `E2E Billing ${planName}`,
        preferredPlanName: planName,
        enablePaidUsage: false,
      });

      try {
        const blockedResponse: APIResponse = await page.request.post(
          URL.fromString(BASE_URL.toString())
            .addRoute("/api/telemetry-ingestion-key")
            .toString(),
          {
            headers: { tenantid: projectId },
            data: { data: { name: "Key before payment method", projectId } },
          },
        );
        expect(blockedResponse.status()).toBe(402);
        expect(await blockedResponse.json()).toMatchObject({
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
        expect(deleteResponse.ok()).toBe(true);
      }
    });
  }
});
