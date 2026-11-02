// First, so the Stripe client the provider builds is the mocked one.
import { mockStripe } from "./Helpers/Stripe.mock";
import { mockIsBillingEnabled } from "./Helpers/StripeBillingProviderHelper";
import type StripeBillingProvider from "../../../Server/Billing/StripeBillingProvider";
import type BillingMarketingEvents from "../../../Server/Billing/BillingMarketingEvents";
import type Stripe from "stripe";
import { describe, expect, it } from "@jest/globals";

/*
 * Stripe's webhook hands every event to BillingMarketingEvents, which turns a
 * first payment and a subscription ending into marketing events. The webhook
 * must answer Stripe whatever happens there: a receiver, PostHog or Google
 * Analytics that is slow or down may cost a marketing event, never the
 * webhook - Stripe would send it again, and the invoice email with it.
 */

const INVOICE_PAID: Stripe.Event = {
  id: "evt_invoice_paid_wiring",
  object: "event",
  type: "invoice.paid",
  created: 1788775262,
  data: {
    object: {
      id: "in_wiring_001",
      object: "invoice",
      customer: "cus_wiring_001",
      amount_paid: 4900,
      currency: "usd",
    },
  },
} as unknown as Stripe.Event;

function marketingEventsOf(
  provider: StripeBillingProvider,
): BillingMarketingEvents {
  return (provider as unknown as { marketingEvents: BillingMarketingEvents })
    .marketingEvents;
}

// Lets the work handleWebhookEvent left running settle.
async function settle(): Promise<void> {
  await new Promise((resolve: (value: unknown) => void) => {
    setImmediate(resolve);
  });
}

describe("StripeBillingProvider.handleWebhookEvent - marketing events", () => {
  it("hands every event to the marketing events, on the provider's own Stripe client", async () => {
    const provider: StripeBillingProvider = await mockIsBillingEnabled(true);
    const marketingEvents: BillingMarketingEvents = marketingEventsOf(provider);
    const report: jest.SpyInstance = jest
      .spyOn(marketingEvents, "report")
      .mockResolvedValue(undefined);

    await provider.handleWebhookEvent(INVOICE_PAID);

    expect(report).toHaveBeenCalledWith(INVOICE_PAID);
    expect((marketingEvents as unknown as { stripe: unknown }).stripe).toBe(
      mockStripe,
    );
  });

  it("answers Stripe without waiting for them", async () => {
    const provider: StripeBillingProvider = await mockIsBillingEnabled(true);
    jest
      .spyOn(marketingEventsOf(provider), "report")
      .mockReturnValue(new Promise<void>(() => {}));

    await expect(
      provider.handleWebhookEvent(INVOICE_PAID),
    ).resolves.toBeUndefined();
  });

  it("answers Stripe when they fail", async () => {
    const provider: StripeBillingProvider = await mockIsBillingEnabled(true);
    jest
      .spyOn(marketingEventsOf(provider), "report")
      .mockRejectedValue(new Error("the marketing receiver is down"));

    await expect(
      provider.handleWebhookEvent(INVOICE_PAID),
    ).resolves.toBeUndefined();

    await settle();
  });

  it("answers Stripe when they throw before they start", async () => {
    const provider: StripeBillingProvider = await mockIsBillingEnabled(true);
    jest
      .spyOn(marketingEventsOf(provider), "report")
      .mockImplementation((): Promise<void> => {
        throw new Error("thrown synchronously");
      });

    await expect(
      provider.handleWebhookEvent(INVOICE_PAID),
    ).resolves.toBeUndefined();
  });

  it("reports nothing with billing off", async () => {
    const provider: StripeBillingProvider = await mockIsBillingEnabled(false);
    const report: jest.SpyInstance = jest.spyOn(
      marketingEventsOf(provider),
      "report",
    );

    await provider.handleWebhookEvent(INVOICE_PAID);

    expect(report).not.toHaveBeenCalled();
  });
});
