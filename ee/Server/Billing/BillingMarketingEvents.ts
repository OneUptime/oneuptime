import { getAllEnvVars } from "Common/Server/EnvironmentConfig";
import Project from "Common/Models/DatabaseModels/Project";
import DeletedProject from "Common/Models/DatabaseModels/DeletedProject";
import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import Select from "Common/Server/Types/Database/Select";
import DeletedProjectService from "Common/Server/Services/DeletedProjectService";
import MarketplaceSubscriptionService from "Common/Server/Services/MarketplaceSubscriptionService";
import ProjectService from "Common/Server/Services/ProjectService";
import GoogleAnalyticsMeasurementProtocol from "Common/Server/Utils/Marketing/GoogleAnalyticsMeasurementProtocol";
import MarketingEventUtil, {
  utmAnalyticsProperties,
} from "Common/Server/Utils/Marketing/MarketingEventUtil";
import logger from "Common/Server/Utils/Logger";
import ProductAnalytics from "Common/Server/Utils/ProductAnalytics";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  UtmPropertyKeys,
  UtmUrlPropertyKey,
} from "Common/Types/Marketing/Attribution";
import { MarketingEventType } from "Common/Types/Marketing/MarketingEvent";
import Stripe from "stripe";

/*
 * The Stripe webhook events these marketing events are read from. Each has
 * to be ticked on OneUptime Cloud's webhook endpoint in the Stripe
 * dashboard (Developers > Webhooks), next to invoice.finalized: Stripe sends
 * an endpoint only the events it was set up with, and nothing in this
 * repository can change that.
 */
export const MARKETING_STRIPE_WEBHOOK_EVENTS: ReadonlyArray<string> = [
  "invoice.paid",
  "customer.subscription.deleted",
  "customer.subscription.updated",
];

/*
 * The statuses a subscription stops bringing in money with: cancelled, given
 * up on after its card kept failing, or never paid for at all. Monitoring
 * stops at them too (SubscriptionStatusUtil); past_due is not one of them,
 * because Stripe is still retrying the card.
 */
const ENDED_SUBSCRIPTION_STATUSES: Array<Stripe.Subscription.Status> = [
  "canceled",
  "unpaid",
  "incomplete_expired",
];

/*
 * The endings an update reports. A cancellation always arrives as
 * customer.subscription.deleted, so it is read from that event alone.
 */
const ENDED_BY_UPDATE_STATUSES: Array<Stripe.Subscription.Status> = [
  "unpaid",
  "incomplete_expired",
];

const INVOICE_PAGE_SIZE: number = 100;

/*
 * Bounds every listing. 2,000 paid invoices is more than eighty years of a
 * project's two monthly subscriptions.
 */
const MAX_LIST_PAGES: number = 20;

/*
 * How close to the end of a project's trial the invoice that ends it is
 * raised. Stripe raises it as the trial ends; the next cycle's invoice comes
 * a month or a year later.
 */
const TRIAL_END_INVOICE_WINDOW_IN_SECONDS: number = 2 * 24 * 60 * 60;

/*
 * Stripe's amounts are in a currency's smallest unit: a hundredth for most,
 * the unit itself for these, a thousandth for the three-decimal ones.
 */
const ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set<string>([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);

const THREE_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set<string>([
  "bhd",
  "jod",
  "kwd",
  "omr",
  "tnd",
]);

export enum SubscriptionEndReason {
  // The trial ran out and the project never paid anything.
  TrialEndedUnpaid = "trial_ended_unpaid",
  // Stripe stopped the subscription because its card kept failing.
  PaymentFailed = "payment_failed",
  // The project was deleted, which cancels its subscriptions.
  ProjectDeleted = "project_deleted",
  // Cancelled any other way: on request, or by OneUptime staff in Stripe.
  Canceled = "canceled",
}

// The Project row's campaign, driven from the shared contract.
const PROJECT_ATTRIBUTION_SELECT: Select<Project> = {
  ...Object.fromEntries(
    [...UtmPropertyKeys, UtmUrlPropertyKey].map(
      (propertyKey: string): [string, boolean] => {
        return [propertyKey, true];
      },
    ),
  ),
  clickIds: true,
  firstTouchAttribution: true,
} as Select<Project>;

const PROJECT_SELECT: Select<Project> = {
  _id: true,
  createdOwnerEmail: true,
  createdByUserId: true,
  paymentProviderPlanId: true,
  trialEndsAt: true,
  billingMarketplace: true,
  ...PROJECT_ATTRIBUTION_SELECT,
} as Select<Project>;

// Who a subscription that ended belonged to.
interface SubscriptionOwner {
  projectId: string;
  email: string;
  // The live Project row, with its campaign. Absent for a deleted project.
  project?: Project | undefined;
  isProjectDeleted: boolean;
}

/*
 * The two revenue moments only Stripe sees, as marketing events
 * (Docs/analytics/marketing-event-webhooks.md):
 *
 *   first_payment       invoice.paid: the first invoice of a project on a
 *                       paid plan that took money - most often the one
 *                       Stripe raises when the free trial ends.
 *   subscription_ended  customer.subscription.deleted, or .updated into
 *                       unpaid / incomplete_expired: a paid plan's
 *                       subscription stopped.
 *
 * Like every marketing event, each goes out through MarketingEventUtil to the
 * signed webhook, and to PostHog with the campaign columns. A trial that
 * converts also reaches Google Analytics as a purchase
 * (GoogleAnalyticsMeasurementProtocol), because no browser is there to send
 * one.
 *
 * Nothing is stored. Whether a payment is a project's first is asked of
 * Stripe, which holds every invoice, and both event ids are naturally unique
 * - a project has one first payment, a Stripe subscription ends once - so a
 * webhook Stripe sends again carries the id it carried the first time and the
 * receiver keeps one.
 *
 * Every step is best-effort. reportInBackground neither throws nor makes the
 * webhook wait: a failure here costs one marketing event and nothing else.
 */
export default class BillingMarketingEvents {
  private stripe: Stripe;

  public constructor(stripe: Stripe) {
    this.stripe = stripe;
  }

  public reportInBackground(event: Stripe.Event): void {
    try {
      this.report(event).catch((err: unknown) => {
        logger.error(
          `MarketingEvent: could not report Stripe event ${event.id} (${event.type}): ${err}`,
        );
      });
    } catch (err) {
      logger.error(
        `MarketingEvent: could not report Stripe event ${event?.id} (${event?.type}): ${err}`,
      );
    }
  }

  public async report(event: Stripe.Event): Promise<void> {
    if (event.type === "invoice.paid") {
      await this.reportFirstPayment(event);
      return;
    }

    if (event.type === "customer.subscription.deleted") {
      await this.reportSubscriptionEnded(event);
      return;
    }

    if (
      event.type === "customer.subscription.updated" &&
      BillingMarketingEvents.hasJustStoppedBilling(event)
    ) {
      await this.reportSubscriptionEnded(event);
    }
  }

  private async reportFirstPayment(event: Stripe.Event): Promise<void> {
    const invoice: Stripe.Invoice = event.data.object as Stripe.Invoice;
    const customerId: string | null = BillingMarketingEvents.getCustomerId(
      invoice.customer,
    );

    /*
     * A $0 invoice is no payment: the one a trial opens with, a free plan's,
     * one a credit balance covered.
     */
    if (!invoice.id || !customerId || !(invoice.amount_paid > 0)) {
      return;
    }

    // Every project has a Stripe customer of its own.
    const project: Project | null = await ProjectService.findOneBy({
      query: {
        paymentProviderCustomerId: customerId,
      },
      select: PROJECT_SELECT,
      props: {
        isRoot: true,
      },
    });

    if (!project || !project.id || !project.createdOwnerEmail) {
      return;
    }

    /*
     * A free-plan project emits nothing, even for usage it pays for: like
     * subscription_started, this reports a plan's revenue.
     */
    const plan: SubscriptionPlan | null = BillingMarketingEvents.getPaidPlan(
      project.paymentProviderPlanId,
    );

    if (!plan) {
      return;
    }

    const paidAt: Date = OneUptimeDate.fromUnixTimestamp(
      invoice.status_transitions?.paid_at || event.created,
    );

    if (!(await this.isFirstPayment({ customerId, invoice }))) {
      return;
    }

    const amountPaid: number = BillingMarketingEvents.toMajorUnits(
      invoice.amount_paid,
      invoice.currency,
    );
    const currency: string = invoice.currency.toUpperCase();
    const trialEndsAt: Date | null = project.trialEndsAt || null;

    /*
     * The trial converting: the invoice Stripe raises as the subscription
     * moves from its trial into its first paid period, when the trial ends.
     * A project that pays at once, or moves from the free plan to a paid one
     * - even one that left a trial for the free plan and came back - pays on
     * another invoice, and its browser has already sent Google Analytics the
     * purchase.
     */
    const isTrialConversion: boolean =
      invoice.billing_reason === "subscription_cycle" &&
      Boolean(trialEndsAt) &&
      Math.abs(
        invoice.created -
          OneUptimeDate.toUnixTimestamp(OneUptimeDate.fromString(trialEndsAt!)),
      ) <= TRIAL_END_INVOICE_WINDOW_IN_SECONDS;

    const eventId: string = `${MarketingEventType.FirstPayment}:${project.id.toString()}`;

    const properties: JSONObject = {
      project_id: project.id.toString(),
      invoice_id: invoice.id,
      plan: plan.getName(),
      amount_paid: amountPaid,
      currency: currency,
      // Value for ROAS reporting: the money this payment brought in.
      value: amountPaid,
      is_trial_conversion: isTrialConversion,
      has_custom_pricing: plan.isCustomPricing(),
      ...(trialEndsAt
        ? { trial_ends_at: OneUptimeDate.toString(trialEndsAt) }
        : {}),
      ...utmAnalyticsProperties(project as unknown as JSONObject),
      click_ids: project.clickIds || {},
    };

    this.emit({
      eventType: MarketingEventType.FirstPayment,
      eventId: eventId,
      occurredAt: paidAt,
      email: project.createdOwnerEmail.toString(),
      project: project,
      properties: properties,
    });

    if (isTrialConversion && project.createdByUserId) {
      GoogleAnalyticsMeasurementProtocol.sendPurchaseInBackground({
        userId: project.createdByUserId.toString(),
        transactionId: eventId,
        value: amountPaid,
        currency: currency,
        plan: plan.getName(),
        occurredAt: paidAt,
        attributionSource: project,
      });
    }
  }

  private async reportSubscriptionEnded(event: Stripe.Event): Promise<void> {
    const subscription: Stripe.Subscription = event.data
      .object as Stripe.Subscription;
    const customerId: string | null = BillingMarketingEvents.getCustomerId(
      subscription.customer,
    );

    if (
      !subscription.id ||
      !customerId ||
      !ENDED_SUBSCRIPTION_STATUSES.includes(subscription.status)
    ) {
      return;
    }

    /*
     * The plan the subscription itself carried. A metered subscription
     * carries no plan, and a free plan's ending loses no revenue.
     */
    const plan: SubscriptionPlan | null =
      BillingMarketingEvents.getPaidPlanOfSubscription(subscription);

    if (!plan) {
      return;
    }

    if (await this.wasReplaced({ customerId, subscription })) {
      return;
    }

    const owner: SubscriptionOwner | null = await this.findOwner(
      subscription.id,
    );

    if (!owner) {
      return;
    }

    const endedAt: Date = OneUptimeDate.fromUnixTimestamp(
      (event.type === "customer.subscription.deleted"
        ? subscription.ended_at || subscription.canceled_at
        : null) || event.created,
    );

    const payments: { amountInSmallestUnit: number; currency: string | null } =
      await this.getAmountPaid(customerId);

    const currency: string = (
      payments.currency ||
      subscription.currency ||
      "usd"
    ).toLowerCase();

    const everPaid: boolean = payments.amountInSmallestUnit > 0;
    const trialEndsAt: Date | null = subscription.trial_end
      ? OneUptimeDate.fromUnixTimestamp(subscription.trial_end)
      : null;

    const reason: SubscriptionEndReason = BillingMarketingEvents.getEndReason({
      subscription: subscription,
      endedAt: endedAt,
      everPaid: everPaid,
      trialEndsAt: trialEndsAt,
      isProjectDeleted: owner.isProjectDeleted,
    });

    const properties: JSONObject = {
      project_id: owner.projectId,
      subscription_id: subscription.id,
      plan: plan.getName(),
      status: subscription.status,
      reason: reason,
      ever_paid: everPaid,
      // Everything the project paid, across all its invoices.
      lifetime_amount_paid: BillingMarketingEvents.toMajorUnits(
        payments.amountInSmallestUnit,
        currency,
      ),
      currency: currency.toUpperCase(),
      has_custom_pricing: plan.isCustomPricing(),
      ...(trialEndsAt
        ? { trial_ends_at: OneUptimeDate.toString(trialEndsAt) }
        : {}),
      ...utmAnalyticsProperties((owner.project || {}) as unknown as JSONObject),
      click_ids: owner.project?.clickIds || {},
    };

    this.emit({
      eventType: MarketingEventType.SubscriptionEnded,
      // A Stripe subscription ends once.
      eventId: `${MarketingEventType.SubscriptionEnded}:${subscription.id}`,
      occurredAt: endedAt,
      email: owner.email,
      project: owner.project,
      properties: properties,
    });
  }

  /*
   * The same event to PostHog and to the receiver, under one key, so a
   * webhook Stripe sends again is stored once in each.
   */
  private emit(data: {
    eventType: MarketingEventType;
    eventId: string;
    occurredAt: Date;
    email: string;
    project?: Project | undefined;
    properties: JSONObject;
  }): void {
    ProductAnalytics.capture({
      event: `server/${data.eventType}`,
      distinctId: data.email,
      properties: data.properties,
      deduplicationKey: data.eventId,
      timestamp: data.occurredAt,
    });

    MarketingEventUtil.emitInBackground(() => {
      return MarketingEventUtil.buildEvent({
        eventType: data.eventType,
        eventId: data.eventId,
        occurredAt: data.occurredAt,
        email: data.email,
        attributionSource: data.project,
        data: data.properties,
      });
    });
  }

  /*
   * Whether no other invoice of the customer took money before this one.
   * Stripe lists newest first, so a project already paying stops at its
   * previous invoice, on the first page. Two invoices paid in the same
   * second are ordered by id, so exactly one of them is the first.
   */
  private async isFirstPayment(data: {
    customerId: string;
    invoice: Stripe.Invoice;
  }): Promise<boolean> {
    const paidAt: number = BillingMarketingEvents.getPaidAt(data.invoice);
    let isFirst: boolean = true;

    await this.visitPaidInvoices(
      data.customerId,
      (other: Stripe.Invoice): boolean => {
        if (other.id === data.invoice.id || !(other.amount_paid > 0)) {
          return true;
        }

        const otherPaidAt: number = BillingMarketingEvents.getPaidAt(other);

        if (
          otherPaidAt < paidAt ||
          (otherPaidAt === paidAt && (other.id || "") < (data.invoice.id || ""))
        ) {
          isFirst = false;
          return false;
        }

        return true;
      },
    );

    return isFirst;
  }

  /*
   * What the customer paid in all, in the currency of its latest payment
   * (OneUptime Cloud charges in one currency, so in practice all of it).
   */
  private async getAmountPaid(customerId: string): Promise<{
    amountInSmallestUnit: number;
    currency: string | null;
  }> {
    let amountInSmallestUnit: number = 0;
    let currency: string | null = null;

    await this.visitPaidInvoices(
      customerId,
      (invoice: Stripe.Invoice): boolean => {
        if (!(invoice.amount_paid > 0)) {
          return true;
        }

        currency = currency || invoice.currency;

        if (invoice.currency === currency) {
          amountInSmallestUnit += invoice.amount_paid;
        }

        return true;
      },
    );

    return { amountInSmallestUnit, currency };
  }

  // A customer's paid invoices, newest first, until `visit` returns false.
  private async visitPaidInvoices(
    customerId: string,
    visit: (invoice: Stripe.Invoice) => boolean,
  ): Promise<void> {
    let startingAfter: string | undefined = undefined;

    for (let page: number = 0; page < MAX_LIST_PAGES; page++) {
      const invoices: Stripe.ApiList<Stripe.Invoice> =
        await this.stripe.invoices.list({
          customer: customerId,
          status: "paid",
          limit: INVOICE_PAGE_SIZE,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });

      for (const invoice of invoices.data) {
        if (!visit(invoice)) {
          return;
        }
      }

      const lastInvoice: Stripe.Invoice | undefined =
        invoices.data[invoices.data.length - 1];

      if (!invoices.has_more || !lastInvoice) {
        return;
      }

      startingAfter = lastInvoice.id;
    }
  }

  /*
   * Whether a plan change replaced this subscription rather than ending it.
   * A plan change that cannot swap the price on the subscription creates a
   * replacement first - carrying the id of the one it replaces - and only
   * then cancels the old one, so the replacement is already there to find
   * when the cancellation arrives, even before the project row points at it
   * (StripeBillingProvider.changePlan).
   */
  private async wasReplaced(data: {
    customerId: string;
    subscription: Stripe.Subscription;
  }): Promise<boolean> {
    let startingAfter: string | undefined = undefined;

    for (let page: number = 0; page < MAX_LIST_PAGES; page++) {
      const subscriptions: Stripe.ApiList<Stripe.Subscription> =
        await this.stripe.subscriptions.list({
          customer: data.customerId,
          status: "all",
          limit: INVOICE_PAGE_SIZE,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });

      for (const other of subscriptions.data) {
        if (
          other.id !== data.subscription.id &&
          other.metadata?.["replacedSubscriptionId"] === data.subscription.id
        ) {
          return true;
        }
      }

      const lastSubscription: Stripe.Subscription | undefined =
        subscriptions.data[subscriptions.data.length - 1];

      if (!subscriptions.has_more || !lastSubscription) {
        return false;
      }

      startingAfter = lastSubscription.id;
    }

    return false;
  }

  /*
   * The project whose subscription ended. A project that has moved to the
   * new subscription, or whose billing a cloud marketplace took over, has
   * not lost the revenue; one that was deleted has, and is read from the
   * snapshot DeletedProject keeps, which has no campaign left to carry.
   */
  private async findOwner(
    subscriptionId: string,
  ): Promise<SubscriptionOwner | null> {
    const project: Project | null = await ProjectService.findOneBy({
      query: {
        paymentProviderSubscriptionId: subscriptionId,
      },
      select: PROJECT_SELECT,
      props: {
        isRoot: true,
      },
    });

    if (project) {
      if (!project.id || !project.createdOwnerEmail) {
        return null;
      }

      /*
       * A marketplace purchase is linked to the project before its card
       * subscriptions are cancelled, and the row only says so afterwards
       * (MarketplacePurchases.linkToProject).
       */
      if (
        project.billingMarketplace ||
        (await this.isBilledByMarketplace(project.id))
      ) {
        return null;
      }

      return {
        projectId: project.id.toString(),
        email: project.createdOwnerEmail.toString(),
        project: project,
        isProjectDeleted: false,
      };
    }

    const deletedProject: DeletedProject | null =
      await DeletedProjectService.findOneBy({
        query: {
          paymentProviderSubscriptionId: subscriptionId,
        },
        select: {
          projectId: true,
          projectCreatedByUserEmail: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (
      !deletedProject?.projectId ||
      !deletedProject.projectCreatedByUserEmail
    ) {
      return null;
    }

    return {
      projectId: deletedProject.projectId.toString(),
      email: deletedProject.projectCreatedByUserEmail.toString(),
      isProjectDeleted: true,
    };
  }

  private async isBilledByMarketplace(projectId: ObjectID): Promise<boolean> {
    const purchase: MarketplaceSubscription | null =
      await MarketplaceSubscriptionService.findOneBy({
        query: {
          projectId: projectId,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    return Boolean(purchase);
  }

  public static getEndReason(data: {
    subscription: Stripe.Subscription;
    endedAt: Date;
    everPaid: boolean;
    trialEndsAt: Date | null;
    isProjectDeleted: boolean;
  }): SubscriptionEndReason {
    if (data.isProjectDeleted) {
      return SubscriptionEndReason.ProjectDeleted;
    }

    if (
      !data.everPaid &&
      data.trialEndsAt &&
      !OneUptimeDate.isAfter(data.trialEndsAt, data.endedAt)
    ) {
      return SubscriptionEndReason.TrialEndedUnpaid;
    }

    if (data.subscription.status !== "canceled") {
      return SubscriptionEndReason.PaymentFailed;
    }

    /*
     * Stripe says why it cancelled a subscription. The field is newer than
     * the API version this client is pinned to, so it is read untyped, and
     * a cancellation without it counts as an ordinary one.
     */
    const cancellationReason: string | null | undefined = (
      data.subscription as unknown as {
        cancellation_details?: { reason?: string | null } | null;
      }
    ).cancellation_details?.reason;

    if (
      cancellationReason === "payment_failed" ||
      cancellationReason === "payment_disputed"
    ) {
      return SubscriptionEndReason.PaymentFailed;
    }

    return SubscriptionEndReason.Canceled;
  }

  // An update that moved the subscription into a status it stops billing at.
  public static hasJustStoppedBilling(event: Stripe.Event): boolean {
    const subscription: Stripe.Subscription = event.data
      .object as Stripe.Subscription;
    const previousStatus: Stripe.Subscription.Status | undefined = (
      event.data.previous_attributes as
        | { status?: Stripe.Subscription.Status | undefined }
        | undefined
    )?.status;

    return (
      Boolean(previousStatus) &&
      ENDED_BY_UPDATE_STATUSES.includes(subscription.status) &&
      !ENDED_SUBSCRIPTION_STATUSES.includes(previousStatus!)
    );
  }

  /*
   * The plan a price belongs to, when it is a paid one: custom pricing, or
   * an amount above zero. The same rule subscription_started applies.
   */
  public static getPaidPlan(
    priceId: string | undefined | null,
  ): SubscriptionPlan | null {
    if (!priceId) {
      return null;
    }

    const plan: SubscriptionPlan | undefined =
      SubscriptionPlan.getSubscriptionPlanById(priceId, getAllEnvVars());

    if (!plan) {
      return null;
    }

    if (plan.isCustomPricing()) {
      return plan;
    }

    const monthlyAmountInUSD: number =
      plan.getYearlyPlanId() === priceId
        ? plan.getYearlySubscriptionAmountInUSD()
        : plan.getMonthlySubscriptionAmountInUSD();

    return monthlyAmountInUSD > 0 ? plan : null;
  }

  public static getPaidPlanOfSubscription(
    subscription: Stripe.Subscription,
  ): SubscriptionPlan | null {
    for (const item of subscription.items?.data || []) {
      const priceId: string | undefined = item.price?.id;

      if (
        priceId &&
        SubscriptionPlan.getSubscriptionPlanById(priceId, getAllEnvVars())
      ) {
        return this.getPaidPlan(priceId);
      }
    }

    return null;
  }

  public static toMajorUnits(
    amountInSmallestUnit: number,
    currency: string,
  ): number {
    const normalizedCurrency: string = currency.toLowerCase();

    if (ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency)) {
      return amountInSmallestUnit;
    }

    if (THREE_DECIMAL_CURRENCIES.has(normalizedCurrency)) {
      return amountInSmallestUnit / 1000;
    }

    return amountInSmallestUnit / 100;
  }

  private static getPaidAt(invoice: Stripe.Invoice): number {
    return invoice.status_transitions?.paid_at || invoice.created;
  }

  private static getCustomerId(
    customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
  ): string | null {
    if (!customer) {
      return null;
    }

    return typeof customer === "string" ? customer : customer.id;
  }
}
