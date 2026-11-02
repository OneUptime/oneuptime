import fs from "fs";
import path from "path";
import BillingMarketingEvents, {
  MARKETING_STRIPE_WEBHOOK_EVENTS,
  SubscriptionEndReason,
} from "../../../Server/Billing/BillingMarketingEvents";
import type Project from "Common/Models/DatabaseModels/Project";
import type DeletedProject from "Common/Models/DatabaseModels/DeletedProject";
import DeletedProjectService from "Common/Server/Services/DeletedProjectService";
import MarketplaceSubscriptionService from "Common/Server/Services/MarketplaceSubscriptionService";
import ProjectService from "Common/Server/Services/ProjectService";
import GoogleAnalyticsMeasurementProtocol from "Common/Server/Utils/Marketing/GoogleAnalyticsMeasurementProtocol";
import MarketingEventUtil from "Common/Server/Utils/Marketing/MarketingEventUtil";
import logger from "Common/Server/Utils/Logger";
import ProductAnalytics from "Common/Server/Utils/ProductAnalytics";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import { MarketingEvent } from "Common/Types/Marketing/MarketingEvent";
import ObjectID from "Common/Types/ObjectID";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The two revenue moments only Stripe sees: a project's first payment - most
 * often a free trial converting, with no browser there to report it - and a
 * paid subscription ending.
 *
 * What a receiver cannot repair if it is wrong is pinned hardest: the event
 * id, which must come out the same however many times Stripe sends the
 * webhook; the amount, which must be the money that arrived; and silence,
 * for a free-plan project, a $0 invoice, a payment that is not the first, and
 * a cancellation that is really a plan change or a move to a marketplace.
 *
 * The services, PostHog, the queue and Google Analytics are replaced. Stripe
 * is a plain object answering the two listings the class makes.
 */

jest.mock("Common/Server/Services/ProjectService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock("Common/Server/Services/DeletedProjectService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock("Common/Server/Services/MarketplaceSubscriptionService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock("Common/Server/Utils/ProductAnalytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

jest.mock(
  "Common/Server/Utils/Marketing/GoogleAnalyticsMeasurementProtocol",
  () => {
    return {
      __esModule: true,
      default: { sendPurchaseInBackground: jest.fn() },
    };
  },
);

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const CREATOR_USER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const OWNER_EMAIL: string = "owner@example.com";
const CUSTOMER_ID: string = "cus_marketing_123";
const SUBSCRIPTION_ID: string = "sub_flat_fee_123";

const GROWTH_MONTHLY_PRICE_ID: string = "price_monthly_growth";
const GROWTH_YEARLY_PRICE_ID: string = "price_yearly_growth";
const FREE_MONTHLY_PRICE_ID: string = "price_monthly_free";
const ENTERPRISE_MONTHLY_PRICE_ID: string = "price_monthly_enterprise";
const METERED_PRICE_ID: string = "price_metered_active_monitoring";

const GROWTH_PLAN: SubscriptionPlan = new SubscriptionPlan(
  GROWTH_MONTHLY_PRICE_ID,
  GROWTH_YEARLY_PRICE_ID,
  "Growth",
  49,
  45,
  2,
  14,
);

const FREE_PLAN: SubscriptionPlan = new SubscriptionPlan(
  FREE_MONTHLY_PRICE_ID,
  "price_yearly_free",
  "Free",
  0,
  0,
  1,
  0,
);

const ENTERPRISE_PLAN: SubscriptionPlan = new SubscriptionPlan(
  ENTERPRISE_MONTHLY_PRICE_ID,
  "price_yearly_enterprise",
  "Enterprise",
  -1,
  -1,
  4,
  0,
);

const PLANS_BY_PRICE_ID: Record<string, SubscriptionPlan> = {
  [GROWTH_MONTHLY_PRICE_ID]: GROWTH_PLAN,
  [GROWTH_YEARLY_PRICE_ID]: GROWTH_PLAN,
  [FREE_MONTHLY_PRICE_ID]: FREE_PLAN,
  [ENTERPRISE_MONTHLY_PRICE_ID]: ENTERPRISE_PLAN,
};

// 2026-09-07T10:00:00Z, when the fourteen day trial ended and was charged.
const TRIAL_ENDED_AT_UNIX: number = 1788775200;
const PAID_AT_UNIX: number = TRIAL_ENDED_AT_UNIX + 60;

interface FakeStripe {
  invoices: { list: jest.Mock };
  subscriptions: { list: jest.Mock };
}

let stripe: FakeStripe;
let marketingEvents: BillingMarketingEvents;

const findProject: jest.Mock = ProjectService.findOneBy as unknown as jest.Mock;
const findDeletedProject: jest.Mock =
  DeletedProjectService.findOneBy as unknown as jest.Mock;
const findMarketplacePurchase: jest.Mock =
  MarketplaceSubscriptionService.findOneBy as unknown as jest.Mock;
const capture: jest.Mock = ProductAnalytics.capture as unknown as jest.Mock;
const sendPurchase: jest.Mock =
  GoogleAnalyticsMeasurementProtocol.sendPurchaseInBackground as unknown as jest.Mock;
const loggerError: jest.Mock = logger.error as unknown as jest.Mock;

let emitInBackground: jest.SpyInstance;

function fakeProject(overrides?: Record<string, unknown>): Project {
  return {
    id: PROJECT_ID,
    _id: PROJECT_ID.toString(),
    createdOwnerEmail: new Email(OWNER_EMAIL),
    createdByUserId: CREATOR_USER_ID,
    paymentProviderPlanId: GROWTH_MONTHLY_PRICE_ID,
    trialEndsAt: new Date(TRIAL_ENDED_AT_UNIX * 1000),

    // The campaign the creating user carried, copied onto the project row.
    utmSource: "google",
    utmMedium: "cpc",
    utmCampaign: "status-page-uk",
    utmTerm: "status page software",
    utmContent: "ad-variant-b",
    utmId: "2233445566",
    clickIds: { gclid: "gclid_abc123" },
    firstTouchAttribution: { utmSource: "google" },
    ...overrides,
  } as unknown as Project;
}

function fakeInvoice(overrides?: Record<string, unknown>): Stripe.Invoice {
  return {
    id: "in_trial_end_001",
    object: "invoice",
    customer: CUSTOMER_ID,
    amount_paid: 4900,
    currency: "usd",
    billing_reason: "subscription_cycle",
    created: TRIAL_ENDED_AT_UNIX,
    status: "paid",
    status_transitions: {
      finalized_at: TRIAL_ENDED_AT_UNIX,
      marked_uncollectible_at: null,
      paid_at: PAID_AT_UNIX,
      voided_at: null,
    },
    ...overrides,
  } as unknown as Stripe.Invoice;
}

function invoicePaidEvent(
  invoice: Stripe.Invoice,
  eventId: string = "evt_invoice_paid_001",
): Stripe.Event {
  return {
    id: eventId,
    object: "event",
    type: "invoice.paid",
    created: PAID_AT_UNIX + 2,
    data: { object: invoice },
  } as unknown as Stripe.Event;
}

function fakeSubscription(
  overrides?: Record<string, unknown>,
): Stripe.Subscription {
  return {
    id: SUBSCRIPTION_ID,
    object: "subscription",
    customer: CUSTOMER_ID,
    currency: "usd",
    status: "canceled",
    trial_end: TRIAL_ENDED_AT_UNIX,
    canceled_at: TRIAL_ENDED_AT_UNIX + 86400 * 20,
    ended_at: TRIAL_ENDED_AT_UNIX + 86400 * 20,
    metadata: {},
    items: {
      data: [{ id: "si_flat_fee", price: { id: GROWTH_MONTHLY_PRICE_ID } }],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function subscriptionEvent(data: {
  type: "customer.subscription.deleted" | "customer.subscription.updated";
  subscription: Stripe.Subscription;
  previousAttributes?: JSONObject | undefined;
  eventId?: string | undefined;
  created?: number | undefined;
}): Stripe.Event {
  return {
    id: data.eventId || "evt_subscription_001",
    object: "event",
    type: data.type,
    created: data.created || TRIAL_ENDED_AT_UNIX + 86400 * 21,
    data: {
      object: data.subscription,
      ...(data.previousAttributes
        ? { previous_attributes: data.previousAttributes }
        : {}),
    },
  } as unknown as Stripe.Event;
}

// One page of a Stripe listing.
function page<T>(data: Array<T>, hasMore: boolean = false): Stripe.ApiList<T> {
  return {
    object: "list",
    data: data,
    has_more: hasMore,
    url: "/v1/list",
  } as Stripe.ApiList<T>;
}

function emittedEvents(): Array<MarketingEvent> {
  return emitInBackground.mock.calls.map((call: Array<unknown>) => {
    const emitted: unknown = call[0];
    return typeof emitted === "function"
      ? (emitted as () => MarketingEvent)()
      : (emitted as MarketingEvent);
  });
}

function onlyEmittedEvent(): MarketingEvent {
  const events: Array<MarketingEvent> = emittedEvents();
  expect(events).toHaveLength(1);
  return events[0]!;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();

  stripe = {
    invoices: { list: jest.fn() },
    subscriptions: { list: jest.fn() },
  };

  marketingEvents = new BillingMarketingEvents(stripe as unknown as Stripe);

  emitInBackground = jest
    .spyOn(MarketingEventUtil, "emitInBackground")
    .mockReturnValue(undefined);

  jest
    .spyOn(SubscriptionPlan, "getSubscriptionPlanById")
    .mockImplementation((priceId: string): SubscriptionPlan | undefined => {
      return PLANS_BY_PRICE_ID[priceId];
    });

  findProject.mockResolvedValue(fakeProject() as never);
  findDeletedProject.mockResolvedValue(null as never);
  findMarketplacePurchase.mockResolvedValue(null as never);

  // By default the trial-end invoice is the only one that took money.
  stripe.invoices.list.mockResolvedValue(
    page([
      fakeInvoice(),
      // The $0 invoice the trial opened with is not a payment.
      fakeInvoice({
        id: "in_trial_start_000",
        amount_paid: 0,
        billing_reason: "subscription_create",
        created: TRIAL_ENDED_AT_UNIX - 14 * 86400,
        status_transitions: { paid_at: TRIAL_ENDED_AT_UNIX - 14 * 86400 },
      }),
    ]) as never,
  );

  stripe.subscriptions.list.mockResolvedValue(page([]) as never);
});

describe("first_payment", () => {
  it("reports a free trial converting into a payment, with the money that arrived", async () => {
    await marketingEvents.report(invoicePaidEvent(fakeInvoice()));

    const event: MarketingEvent = onlyEmittedEvent();

    expect(event.eventType).toBe("first_payment");
    expect(event.email).toBe(OWNER_EMAIL);
    expect(event.occurredAt).toBe(new Date(PAID_AT_UNIX * 1000).toISOString());
    expect(event.data).toMatchObject({
      project_id: PROJECT_ID.toString(),
      invoice_id: "in_trial_end_001",
      plan: "Growth",
      amount_paid: 49,
      currency: "USD",
      value: 49,
      is_trial_conversion: true,
      has_custom_pricing: false,
      trial_ends_at: new Date(TRIAL_ENDED_AT_UNIX * 1000).toISOString(),
      click_ids: { gclid: "gclid_abc123" },
    });
  });

  it("carries the Project row's campaign as its attribution", async () => {
    await marketingEvents.report(invoicePaidEvent(fakeInvoice()));

    expect(onlyEmittedEvent().attribution).toMatchObject({
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "status-page-uk",
      utmTerm: "status page software",
      utmContent: "ad-variant-b",
      utmId: "2233445566",
      clickIds: { gclid: "gclid_abc123" },
      firstTouch: { utmSource: "google" },
    });
  });

  it("is keyed on the project, so a project has one first payment however often Stripe asks", async () => {
    await marketingEvents.report(invoicePaidEvent(fakeInvoice()));

    expect(onlyEmittedEvent().eventId).toBe(
      `first_payment:${PROJECT_ID.toString()}`,
    );
  });

  it("comes out identical when Stripe sends the same webhook again", async () => {
    /*
     * Stripe retries a webhook it did not see answered, and sometimes sends
     * one twice anyway. Both reach here; the receiver keeps one because both
     * carry the same id, PostHog because both carry the same key and moment,
     * and Google Analytics because both carry the same transaction id.
     */
    const event: Stripe.Event = invoicePaidEvent(fakeInvoice());

    await marketingEvents.report(event);
    await marketingEvents.report(event);

    const [first, retry] = emittedEvents();

    expect(retry).toEqual(first);
    expect(capture.mock.calls[1]).toEqual(capture.mock.calls[0]);
    expect(sendPurchase.mock.calls[1]).toEqual(sendPurchase.mock.calls[0]);
  });

  it("keeps the id when the same payment arrives as a different Stripe event", async () => {
    await marketingEvents.report(
      invoicePaidEvent(fakeInvoice(), "evt_invoice_paid_001"),
    );
    await marketingEvents.report(
      invoicePaidEvent(fakeInvoice(), "evt_invoice_paid_002"),
    );

    const [first, second] = emittedEvents();

    expect(second!.eventId).toBe(first!.eventId);
  });

  it("mirrors the event to PostHog with the campaign columns, keyed for deduplication", async () => {
    await marketingEvents.report(invoicePaidEvent(fakeInvoice()));

    expect(capture).toHaveBeenCalledTimes(1);

    const captured: {
      event: string;
      distinctId: string;
      properties: JSONObject;
      deduplicationKey: string;
      timestamp: Date;
    } = capture.mock.calls[0]![0] as never;

    expect(captured.event).toBe("server/first_payment");
    expect(captured.distinctId).toBe(OWNER_EMAIL);
    expect(captured.deduplicationKey).toBe(
      `first_payment:${PROJECT_ID.toString()}`,
    );
    expect(captured.timestamp).toEqual(new Date(PAID_AT_UNIX * 1000));
    expect(captured.properties).toMatchObject({
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "status-page-uk",
      utm_id: "2233445566",
      click_ids: { gclid: "gclid_abc123" },
      amount_paid: 49,
      currency: "USD",
    });
  });

  it("sends Google Analytics the purchase no browser was there to send", async () => {
    await marketingEvents.report(invoicePaidEvent(fakeInvoice()));

    expect(sendPurchase).toHaveBeenCalledTimes(1);
    expect(sendPurchase.mock.calls[0]![0]).toMatchObject({
      userId: CREATOR_USER_ID.toString(),
      transactionId: `first_payment:${PROJECT_ID.toString()}`,
      value: 49,
      currency: "USD",
      plan: "Growth",
      occurredAt: new Date(PAID_AT_UNIX * 1000),
    });
    expect(
      (sendPurchase.mock.calls[0]![0] as { attributionSource: Project })
        .attributionSource.utmCampaign,
    ).toBe("status-page-uk");
  });

  it("reports a project that pays at once without sending Google Analytics a second purchase", async () => {
    /*
     * A plan without a trial is invoiced as it is created, and the browser
     * sends that purchase itself (Common/Utils/Analytics.ts). Sending it
     * from here too would count the revenue twice.
     */
    const invoice: Stripe.Invoice = fakeInvoice({
      id: "in_created_paid",
      billing_reason: "subscription_create",
    });
    stripe.invoices.list.mockResolvedValue(page([invoice]) as never);
    findProject.mockResolvedValue(fakeProject({ trialEndsAt: null }) as never);

    await marketingEvents.report(invoicePaidEvent(invoice));

    expect(onlyEmittedEvent().data["is_trial_conversion"]).toBe(false);
    expect(onlyEmittedEvent().data["trial_ends_at"]).toBeUndefined();
    expect(sendPurchase).not.toHaveBeenCalled();
  });

  it("reports a free project's move to a paid plan without a second Google Analytics purchase", async () => {
    const invoice: Stripe.Invoice = fakeInvoice({
      id: "in_upgrade",
      billing_reason: "subscription_update",
    });
    stripe.invoices.list.mockResolvedValue(page([invoice]) as never);

    await marketingEvents.report(invoicePaidEvent(invoice));

    expect(onlyEmittedEvent().data["is_trial_conversion"]).toBe(false);
    expect(sendPurchase).not.toHaveBeenCalled();
  });

  it("reports nothing for a payment that is not the project's first", async () => {
    const renewal: Stripe.Invoice = fakeInvoice({
      id: "in_renewal_002",
      created: PAID_AT_UNIX + 30 * 86400,
      status_transitions: { paid_at: PAID_AT_UNIX + 30 * 86400 },
    });
    stripe.invoices.list.mockResolvedValue(
      page([renewal, fakeInvoice()]) as never,
    );

    await marketingEvents.report(invoicePaidEvent(renewal));

    expect(emitInBackground).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(sendPurchase).not.toHaveBeenCalled();
  });

  it("finds an earlier payment on a later page of the listing", async () => {
    const renewal: Stripe.Invoice = fakeInvoice({
      id: "in_renewal_200",
      status_transitions: { paid_at: PAID_AT_UNIX + 400 * 86400 },
    });

    stripe.invoices.list
      .mockResolvedValueOnce(
        page(
          [
            renewal,
            fakeInvoice({ id: "in_zero_a", amount_paid: 0 }),
            fakeInvoice({ id: "in_zero_b", amount_paid: 0 }),
          ],
          true,
        ) as never,
      )
      .mockResolvedValueOnce(page([fakeInvoice()]) as never);

    await marketingEvents.report(invoicePaidEvent(renewal));

    expect(stripe.invoices.list).toHaveBeenCalledTimes(2);
    expect(stripe.invoices.list.mock.calls[0]![0]).toMatchObject({
      customer: CUSTOMER_ID,
      status: "paid",
    });
    expect(stripe.invoices.list.mock.calls[1]![0]).toMatchObject({
      customer: CUSTOMER_ID,
      status: "paid",
      starting_after: "in_zero_b",
    });
    expect(emitInBackground).not.toHaveBeenCalled();
  });

  it("makes exactly one of two invoices paid in the same second the first", async () => {
    // At trial end the flat fee and the metered usage are invoiced together.
    const flatFee: Stripe.Invoice = fakeInvoice({ id: "in_a_flat_fee" });
    const usage: Stripe.Invoice = fakeInvoice({
      id: "in_b_usage",
      amount_paid: 312,
    });
    stripe.invoices.list.mockResolvedValue(page([usage, flatFee]) as never);

    await marketingEvents.report(invoicePaidEvent(usage));
    expect(emitInBackground).not.toHaveBeenCalled();

    await marketingEvents.report(invoicePaidEvent(flatFee));
    expect(onlyEmittedEvent().data["invoice_id"]).toBe("in_a_flat_fee");
  });

  it("reports nothing for a $0 invoice, and asks nobody about it", async () => {
    await marketingEvents.report(
      invoicePaidEvent(
        fakeInvoice({ amount_paid: 0, billing_reason: "subscription_create" }),
      ),
    );

    expect(findProject).not.toHaveBeenCalled();
    expect(stripe.invoices.list).not.toHaveBeenCalled();
    expect(emitInBackground).not.toHaveBeenCalled();
  });

  it("reports nothing for a free-plan project, even for usage it paid for", async () => {
    findProject.mockResolvedValue(
      fakeProject({
        paymentProviderPlanId: FREE_MONTHLY_PRICE_ID,
        trialEndsAt: null,
      }) as never,
    );

    await marketingEvents.report(
      invoicePaidEvent(fakeInvoice({ amount_paid: 525 })),
    );

    expect(emitInBackground).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(sendPurchase).not.toHaveBeenCalled();
  });

  it("reports nothing for a customer no project has", async () => {
    findProject.mockResolvedValue(null as never);

    await marketingEvents.report(invoicePaidEvent(fakeInvoice()));

    expect(emitInBackground).not.toHaveBeenCalled();
  });

  it("reports a custom-priced plan's payment, with the amount the invoice took", async () => {
    findProject.mockResolvedValue(
      fakeProject({
        paymentProviderPlanId: ENTERPRISE_MONTHLY_PRICE_ID,
        trialEndsAt: null,
      }) as never,
    );
    const invoice: Stripe.Invoice = fakeInvoice({
      amount_paid: 125000,
      billing_reason: "manual",
    });
    stripe.invoices.list.mockResolvedValue(page([invoice]) as never);

    await marketingEvents.report(invoicePaidEvent(invoice));

    expect(onlyEmittedEvent().data).toMatchObject({
      plan: "Enterprise",
      amount_paid: 1250,
      value: 1250,
      has_custom_pricing: true,
    });
  });

  it("reads a zero-decimal currency's amount as it is", async () => {
    const invoice: Stripe.Invoice = fakeInvoice({
      amount_paid: 7400,
      currency: "jpy",
    });
    stripe.invoices.list.mockResolvedValue(page([invoice]) as never);

    await marketingEvents.report(invoicePaidEvent(invoice));

    expect(onlyEmittedEvent().data).toMatchObject({
      amount_paid: 7400,
      currency: "JPY",
    });
  });
});

describe("subscription_ended", () => {
  it("reports a free trial that ended without ever being paid", async () => {
    stripe.invoices.list.mockResolvedValue(page([]) as never);
    const endedAt: number = TRIAL_ENDED_AT_UNIX + 86400 * 21;

    await marketingEvents.report(
      subscriptionEvent({
        type: "customer.subscription.updated",
        subscription: fakeSubscription({
          status: "unpaid",
          canceled_at: null,
          ended_at: null,
        }),
        previousAttributes: { status: "past_due" },
        created: endedAt,
      }),
    );

    const event: MarketingEvent = onlyEmittedEvent();

    expect(event.eventType).toBe("subscription_ended");
    expect(event.eventId).toBe(`subscription_ended:${SUBSCRIPTION_ID}`);
    expect(event.email).toBe(OWNER_EMAIL);
    expect(event.occurredAt).toBe(new Date(endedAt * 1000).toISOString());
    expect(event.attribution).toMatchObject({
      utmCampaign: "status-page-uk",
      clickIds: { gclid: "gclid_abc123" },
    });
    expect(event.data).toMatchObject({
      project_id: PROJECT_ID.toString(),
      subscription_id: SUBSCRIPTION_ID,
      plan: "Growth",
      status: "unpaid",
      reason: SubscriptionEndReason.TrialEndedUnpaid,
      ever_paid: false,
      lifetime_amount_paid: 0,
      currency: "USD",
      trial_ends_at: new Date(TRIAL_ENDED_AT_UNIX * 1000).toISOString(),
      utm_campaign: "status-page-uk",
      click_ids: { gclid: "gclid_abc123" },
    });
  });

  it("reports a cancellation with everything the project paid", async () => {
    stripe.invoices.list.mockResolvedValue(
      page([
        fakeInvoice({ id: "in_renewal_002" }),
        fakeInvoice(),
        fakeInvoice({ id: "in_trial_start_000", amount_paid: 0 }),
      ]) as never,
    );
    const subscription: Stripe.Subscription = fakeSubscription();

    await marketingEvents.report(
      subscriptionEvent({
        type: "customer.subscription.deleted",
        subscription: subscription,
      }),
    );

    const event: MarketingEvent = onlyEmittedEvent();

    expect(event.occurredAt).toBe(
      new Date((subscription.ended_at as number) * 1000).toISOString(),
    );
    expect(event.data).toMatchObject({
      status: "canceled",
      reason: SubscriptionEndReason.Canceled,
      ever_paid: true,
      lifetime_amount_paid: 98,
      currency: "USD",
    });
  });

  it("says when Stripe cancelled it because the card kept failing", async () => {
    await marketingEvents.report(
      subscriptionEvent({
        type: "customer.subscription.deleted",
        subscription: fakeSubscription({
          cancellation_details: { reason: "payment_failed" },
        }),
      }),
    );

    expect(onlyEmittedEvent().data["reason"]).toBe(
      SubscriptionEndReason.PaymentFailed,
    );
  });

  it("reports a deleted project's subscription from the snapshot it left", async () => {
    findProject.mockResolvedValue(null as never);
    findDeletedProject.mockResolvedValue({
      projectId: PROJECT_ID,
      projectCreatedByUserEmail: new Email(OWNER_EMAIL),
    } as unknown as DeletedProject as never);

    await marketingEvents.report(
      subscriptionEvent({
        type: "customer.subscription.deleted",
        subscription: fakeSubscription(),
      }),
    );

    const event: MarketingEvent = onlyEmittedEvent();

    expect(findDeletedProject.mock.calls[0]![0]).toMatchObject({
      query: { paymentProviderSubscriptionId: SUBSCRIPTION_ID },
    });
    expect(event.email).toBe(OWNER_EMAIL);
    expect(event.data).toMatchObject({
      project_id: PROJECT_ID.toString(),
      reason: SubscriptionEndReason.ProjectDeleted,
      click_ids: {},
    });
    expect(event.attribution.clickIds).toEqual({});
  });

  it("comes out under the same id when Stripe sends the webhook again", async () => {
    const event: Stripe.Event = subscriptionEvent({
      type: "customer.subscription.deleted",
      subscription: fakeSubscription(),
    });

    await marketingEvents.report(event);
    await marketingEvents.report(event);

    const [first, retry] = emittedEvents();

    expect(retry).toEqual(first);
    expect(capture.mock.calls[1]).toEqual(capture.mock.calls[0]);
    expect(
      (capture.mock.calls[0]![0] as { deduplicationKey: string })
        .deduplicationKey,
    ).toBe(`subscription_ended:${SUBSCRIPTION_ID}`);
  });

  it("mirrors the event to PostHog", async () => {
    await marketingEvents.report(
      subscriptionEvent({
        type: "customer.subscription.deleted",
        subscription: fakeSubscription(),
      }),
    );

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0]![0]).toMatchObject({
      event: "server/subscription_ended",
      distinctId: OWNER_EMAIL,
      properties: {
        reason: SubscriptionEndReason.Canceled,
        utm_source: "google",
        click_ids: { gclid: "gclid_abc123" },
      },
    });
    expect(sendPurchase).not.toHaveBeenCalled();
  });

  it("reports nothing for a subscription a plan change replaced", async () => {
    /*
     * The replacement exists, pointing at this subscription, before this one
     * is cancelled - and the project row may still name this one for a
     * moment after.
     */
    stripe.subscriptions.list.mockResolvedValue(
      page([
        fakeSubscription({
          id: "sub_replacement_456",
          status: "trialing",
          metadata: { replacedSubscriptionId: SUBSCRIPTION_ID },
        }),
      ]) as never,
    );

    await marketingEvents.report(
      subscriptionEvent({
        type: "customer.subscription.deleted",
        subscription: fakeSubscription(),
      }),
    );

    expect(emitInBackground).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("reports nothing when a cloud marketplace took the project's billing over", async () => {
    findMarketplacePurchase.mockResolvedValue({ _id: "purchase" } as never);

    await marketingEvents.report(
      subscriptionEvent({
        type: "customer.subscription.deleted",
        subscription: fakeSubscription(),
      }),
    );

    expect(findMarketplacePurchase.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID },
    });
    expect(emitInBackground).not.toHaveBeenCalled();
  });

  it("reports nothing for a project whose row already says a marketplace bills it", async () => {
    findProject.mockResolvedValue(
      fakeProject({ billingMarketplace: "aws" }) as never,
    );

    await marketingEvents.report(
      subscriptionEvent({
        type: "customer.subscription.deleted",
        subscription: fakeSubscription(),
      }),
    );

    expect(emitInBackground).not.toHaveBeenCalled();
  });

  it("reports nothing when a free-plan subscription ends", async () => {
    await marketingEvents.report(
      subscriptionEvent({
        type: "customer.subscription.deleted",
        subscription: fakeSubscription({
          trial_end: null,
          items: {
            data: [{ id: "si_free", price: { id: FREE_MONTHLY_PRICE_ID } }],
          },
        }),
      }),
    );

    expect(emitInBackground).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(stripe.subscriptions.list).not.toHaveBeenCalled();
  });

  it("reports nothing when the metered subscription ends alongside the plan's", async () => {
    await marketingEvents.report(
      subscriptionEvent({
        type: "customer.subscription.deleted",
        subscription: fakeSubscription({
          id: "sub_metered_789",
          items: {
            data: [{ id: "si_metered", price: { id: METERED_PRICE_ID } }],
          },
        }),
      }),
    );

    expect(emitInBackground).not.toHaveBeenCalled();
  });

  it("reports nothing for a subscription no project, live or deleted, has", async () => {
    findProject.mockResolvedValue(null as never);

    await marketingEvents.report(
      subscriptionEvent({
        type: "customer.subscription.deleted",
        subscription: fakeSubscription(),
      }),
    );

    expect(emitInBackground).not.toHaveBeenCalled();
  });

  it("reports nothing for updates that leave the subscription billing", async () => {
    for (const change of [
      { status: "active", previous: { quantity: 3 } },
      { status: "past_due", previous: { status: "trialing" } },
      { status: "active", previous: { status: "past_due" } },
      // Already unpaid: a metadata change, not a new ending.
      { status: "unpaid", previous: { metadata: {} } },
    ]) {
      await marketingEvents.report(
        subscriptionEvent({
          type: "customer.subscription.updated",
          subscription: fakeSubscription({ status: change.status }),
          previousAttributes: change.previous as JSONObject,
        }),
      );
    }

    expect(findProject).not.toHaveBeenCalled();
    expect(stripe.subscriptions.list).not.toHaveBeenCalled();
    expect(emitInBackground).not.toHaveBeenCalled();
  });
});

describe("reportInBackground", () => {
  it("neither throws nor rejects when Stripe or the database fails", async () => {
    stripe.invoices.list.mockRejectedValue(
      new Error("Stripe is down") as never,
    );

    expect(() => {
      marketingEvents.reportInBackground(invoicePaidEvent(fakeInvoice()));
    }).not.toThrow();

    // Let the background work settle.
    await new Promise((resolve: (value: unknown) => void) => {
      setImmediate(resolve);
    });

    expect(emitInBackground).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining("Stripe is down"),
    );
  });

  it("does nothing with an event it does not read", async () => {
    await marketingEvents.report({
      id: "evt_other",
      type: "invoice.finalized",
      created: PAID_AT_UNIX,
      data: { object: fakeInvoice() },
    } as unknown as Stripe.Event);

    expect(findProject).not.toHaveBeenCalled();
    expect(emitInBackground).not.toHaveBeenCalled();
  });
});

describe("getEndReason", () => {
  const endedAt: Date = new Date((TRIAL_ENDED_AT_UNIX + 86400 * 21) * 1000);
  const trialEndsAt: Date = new Date(TRIAL_ENDED_AT_UNIX * 1000);

  it("does not call a trial cancelled while it was still running one that ended unpaid", () => {
    expect(
      BillingMarketingEvents.getEndReason({
        subscription: fakeSubscription(),
        endedAt: new Date((TRIAL_ENDED_AT_UNIX - 86400) * 1000),
        everPaid: false,
        trialEndsAt: trialEndsAt,
        isProjectDeleted: false,
      }),
    ).toBe(SubscriptionEndReason.Canceled);
  });

  it("calls an unpaid subscription that had paid before a payment failure", () => {
    expect(
      BillingMarketingEvents.getEndReason({
        subscription: fakeSubscription({ status: "unpaid" }),
        endedAt: endedAt,
        everPaid: true,
        trialEndsAt: trialEndsAt,
        isProjectDeleted: false,
      }),
    ).toBe(SubscriptionEndReason.PaymentFailed);
  });

  it("calls a first invoice that was never paid, with no trial, a payment failure", () => {
    expect(
      BillingMarketingEvents.getEndReason({
        subscription: fakeSubscription({
          status: "incomplete_expired",
          trial_end: null,
        }),
        endedAt: endedAt,
        everPaid: false,
        trialEndsAt: null,
        isProjectDeleted: false,
      }),
    ).toBe(SubscriptionEndReason.PaymentFailed);
  });
});

describe("toMajorUnits", () => {
  it("divides by each currency's smallest unit", () => {
    expect(BillingMarketingEvents.toMajorUnits(4900, "usd")).toBe(49);
    expect(BillingMarketingEvents.toMajorUnits(1999, "EUR")).toBe(19.99);
    expect(BillingMarketingEvents.toMajorUnits(7400, "jpy")).toBe(7400);
    expect(BillingMarketingEvents.toMajorUnits(5120, "kwd")).toBe(5.12);
  });
});

describe("the Stripe dashboard setup the docs ask for", () => {
  it("names every webhook event this reads", () => {
    /*
     * Stripe sends an endpoint only the event types ticked on it, and only a
     * maintainer can tick them. An event read here and missing from the docs
     * is one nobody will enable, and the moment it carries is never measured.
     */
    const docs: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../Docs/analytics/marketing-event-webhooks.md",
      ),
      "utf8",
    );

    for (const stripeEventType of MARKETING_STRIPE_WEBHOOK_EVENTS) {
      expect(docs).toContain(`\`${stripeEventType}\``);
    }
  });
});
