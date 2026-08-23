import {
  BillingPrivateKey,
  BillingWebhookSecret,
  IsBillingEnabled,
  DashboardClientUrl,
} from "../EnvironmentConfig";
import Project from "../../Models/DatabaseModels/Project";
import ServerMeteredPlan from "../Types/Billing/MeteredPlan/ServerMeteredPlan";
import Errors from "../Utils/Errors";
import logger, { LogAttributes } from "../Utils/Logger";
import BaseService from "./BaseService";
import MailService from "./MailService";
import ProjectService from "./ProjectService";
import SubscriptionPlan from "../../Types/Billing/SubscriptionPlan";
import SubscriptionStatus, {
  SubscriptionStatusUtil,
} from "../../Types/Billing/SubscriptionStatus";
import OneUptimeDate from "../../Types/Date";
import Dictionary from "../../Types/Dictionary";
import Email from "../../Types/Email";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import APIException from "../../Types/Exception/ApiException";
import BadDataException from "../../Types/Exception/BadDataException";
import ProductType from "../../Types/MeteredPlan/ProductType";
import ObjectID from "../../Types/ObjectID";
import Sleep from "../../Types/Sleep";
import Stripe from "stripe";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export type SubscriptionItem = Stripe.SubscriptionItem;

export type Coupon = Stripe.Coupon;

export interface PaymentMethod {
  id: string;
  type: string;
  last4Digits: string;
  isDefault: boolean;
}

/*
 * Stripe rejects a trial_end more than two years past the billing cycle
 * anchor. Enforce the same ceiling here so an admin gets a readable error
 * instead of a raw payment-provider failure.
 */
export const MAX_TRIAL_LENGTH_IN_DAYS: number = 730;

/*
 * How long to wait before trying a cancel again, per retry.
 *
 * The errors that lose a cancel - a rate limit, a dropped connection, a
 * transient 5xx - are the ones a second attempt fixes, and a cancel that never
 * lands leaves an open subscription nothing in OneUptime points at any more.
 * Kept short and finite because this runs inside the plan change request.
 */
const CANCEL_RETRY_DELAYS_IN_MS: Array<number> = [1000, 3000];

export interface Invoice {
  id: string;
  amount: number;
  currencyCode: string;
  subscriptionId?: string | undefined;
  status: string;
  downloadableLink: string;
  customerId: string | undefined;
  invoiceDate: Date;
  invoiceNumber: string | undefined;
  paymentIntentId?: string | undefined;
}

export class BillingService extends BaseService {
  public constructor() {
    super();
  }

  private stripe: Stripe = new Stripe(BillingPrivateKey, {
    apiVersion: "2022-08-01",
  });

  // returns billing id of the customer.
  @CaptureSpan()
  public async createCustomer(data: {
    name: string;
    id: ObjectID;
    email: Email;
  }): Promise<string> {
    if (!this.isBillingEnabled()) {
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }
    const customer: Stripe.Response<Stripe.Customer> =
      await this.stripe.customers.create({
        name: data.name,
        email: data.email.toString(),
        metadata: {
          id: data.id.toString(),
        },
      });
    return customer.id;
  }

  @CaptureSpan()
  public async updateCustomerName(id: string, newName: string): Promise<void> {
    if (!this.isBillingEnabled()) {
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }

    await this.stripe.customers.update(id, { name: newName });
  }

  @CaptureSpan()
  public async updateCustomerBusinessDetails(
    id: string,
    businessDetails: string,
    countryCode?: string | null,
    financeAccountingEmail?: string | null,
    sendInvoicesByEmail?: boolean | null,
  ): Promise<void> {
    logger.debug(
      `[Invoice Email] updateCustomerBusinessDetails called - customerId: ${id}, sendInvoicesByEmail: ${sendInvoicesByEmail}`,
    );

    if (!this.isBillingEnabled()) {
      logger.debug(
        `[Invoice Email] Billing not enabled, skipping updateCustomerBusinessDetails for customer ${id}`,
      );
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }
    /*
     * Goal: Update Stripe Customer "Billing details" (address fields) rather than invoice footer.
     * We only have a single free-form textarea. We'll map:
     *   First non-empty line -> address.line1
     *   Second non-empty line (if any) and remaining (joined, truncated) -> address.line2
     * We also persist full text in metadata so we can reconstruct or improve parsing later.
     * NOTE: Because Stripe requires structured address, any city/state/postal/country detection
     * would be heuristic; we keep it simple unless we later add structured fields.
     */

    const lines: Array<string> = businessDetails
      .split(/\r?\n/)
      .map((l: string) => {
        return l.trim();
      })
      .filter((l: string) => {
        return l.length > 0;
      });

    let line1: string | undefined = undefined;
    let line2: string | undefined = undefined;

    if (lines && lines.length > 0) {
      const first: string = lines[0]!; // non-null
      line1 = first.substring(0, 200); // Stripe typical limit safeguard.
    }
    if (lines && lines.length > 1) {
      const rest: string = lines.slice(1).join(", ");
      line2 = rest.substring(0, 200);
    }

    /*
     * financeAccountingEmail may be a comma/semicolon-separated list. Parse the first
     * valid address for Stripe (which stores a single email), and keep the full list
     * in metadata so OneUptime can fan out invoice emails to every recipient.
     */
    const parsedEmails: Array<Email> = financeAccountingEmail
      ? (() => {
          try {
            return Email.parseList(financeAccountingEmail);
          } catch (err) {
            logger.error(
              `[Invoice Email] Failed to parse financeAccountingEmail for customer ${id}: ${err}`,
            );
            return [];
          }
        })()
      : [];

    const normalizedEmailList: string = parsedEmails
      .map((e: Email): string => {
        return e.toString();
      })
      .join(", ");

    const metadata: Record<string, string> = {
      business_details_full: businessDetails.substring(0, 5000),
    };
    if (normalizedEmailList) {
      metadata["finance_accounting_email"] = normalizedEmailList.substring(
        0,
        500,
      );
    } else {
      // Remove if cleared
      metadata["finance_accounting_email"] = "";
    }
    if (sendInvoicesByEmail !== undefined && sendInvoicesByEmail !== null) {
      metadata["send_invoices_by_email"] = sendInvoicesByEmail
        ? "true"
        : "false";
      logger.debug(
        `[Invoice Email] Setting send_invoices_by_email metadata to "${metadata["send_invoices_by_email"]}" for customer ${id}`,
      );
    }

    const updateParams: Stripe.CustomerUpdateParams = {
      metadata,
      address: {},
    };

    /*
     * Stripe's customer.email only accepts one address. Use the first parsed email;
     * the rest are delivered by OneUptime's own webhook-driven invoice email path.
     */
    if (parsedEmails.length > 0) {
      updateParams.email = parsedEmails[0]!.toString();
    }

    if (line1) {
      updateParams.address = updateParams.address || {};
      updateParams.address.line1 = line1;
    }
    if (line2) {
      updateParams.address = updateParams.address || {};
      updateParams.address.line2 = line2;
    }
    if (countryCode) {
      updateParams.address = updateParams.address || {};
      // Stripe expects uppercase 2-letter ISO code
      updateParams.address.country = countryCode.toUpperCase();
    }

    if (!line1 && !line2 && !countryCode) {
      // Clear address if empty details submitted.
      updateParams.address = {
        line1: "",
        line2: "",
      } as any;
    }

    logger.debug(
      `[Invoice Email] Updating Stripe customer ${id} with metadata: ${JSON.stringify(metadata)}`,
    );
    await this.stripe.customers.update(id, updateParams);
    logger.debug(`[Invoice Email] Successfully updated Stripe customer ${id}`);
  }

  @CaptureSpan()
  public async deleteCustomer(id: string): Promise<void> {
    if (!this.isBillingEnabled()) {
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }

    await this.stripe.customers.del(id);
  }

  public isBillingEnabled(): boolean {
    return IsBillingEnabled;
  }

  public isSubscriptionActive(status: SubscriptionStatus): boolean {
    return SubscriptionStatusUtil.isSubscriptionActive(status);
  }

  @CaptureSpan()
  public async subscribeToMeteredPlan(data: {
    projectId: ObjectID;
    customerId: string;
    serverMeteredPlans: Array<ServerMeteredPlan>;
    trialDate: Date | null;
    defaultPaymentMethodId?: string | undefined;
    promoCode?: string | undefined;
    metadata?: Dictionary<string> | undefined;
  }): Promise<{
    meteredSubscriptionId: string;
    trialEndsAt: Date | null;
  }> {
    /*
     * Only plans with a Stripe price can become subscription items. A plan
     * without one yet would make getPriceId throw and abort project
     * creation, so we skip them here - their usage still stages
     * into TelemetryUsageBilling and is pushed once the price ids exist.
     */
    const priceableMeteredPlans: Array<ServerMeteredPlan> =
      data.serverMeteredPlans.filter((plan: ServerMeteredPlan) => {
        return plan.hasPriceId();
      });

    const meteredPlanSubscriptionParams: Stripe.SubscriptionCreateParams = {
      customer: data.customerId,

      proration_behavior: "always_invoice",

      items: priceableMeteredPlans.map((item: ServerMeteredPlan) => {
        return {
          price: item.getPriceId(),
        };
      }),

      trial_end:
        data.trialDate && OneUptimeDate.isInTheFuture(data.trialDate)
          ? OneUptimeDate.toUnixTimestamp(data.trialDate)
          : "now",
    };

    if (data.promoCode) {
      meteredPlanSubscriptionParams.coupon = data.promoCode;
    }

    if (data.defaultPaymentMethodId) {
      meteredPlanSubscriptionParams.default_payment_method =
        data.defaultPaymentMethodId;
    }

    if (data.metadata) {
      meteredPlanSubscriptionParams.metadata = data.metadata;
    }

    // Create metered subscriptions
    const meteredSubscription: Stripe.Response<Stripe.Subscription> =
      await this.stripe.subscriptions.create(meteredPlanSubscriptionParams);

    for (const serverMeteredPlan of data.serverMeteredPlans) {
      await serverMeteredPlan.reportQuantityToBillingProvider(data.projectId, {
        meteredPlanSubscriptionId: meteredSubscription.id,
      });
    }

    return {
      meteredSubscriptionId: meteredSubscription.id,
      trialEndsAt: data.trialDate,
    };
  }

  public isTestEnvironment(): boolean {
    return BillingPrivateKey.startsWith("sk_test");
  }

  @CaptureSpan()
  public async generateCouponCode(data: {
    name: string;
    metadata?: Dictionary<string> | undefined;
    percentOff: number;
    durationInMonths: number;
    maxRedemptions: number;
  }): Promise<string> {
    const coupon: Coupon = await this.stripe.coupons.create({
      name: data.name,
      percent_off: data.percentOff,
      duration: "repeating",
      duration_in_months: data.durationInMonths,
      max_redemptions: data.maxRedemptions,
      metadata: data.metadata || null,
    });

    return coupon.id;
  }

  @CaptureSpan()
  public async subscribeToPlan(data: {
    projectId: ObjectID;
    customerId: string;
    serverMeteredPlans: Array<ServerMeteredPlan>;
    plan: SubscriptionPlan;
    quantity: number;
    isYearly: boolean;
    trial: boolean | Date | undefined;
    defaultPaymentMethodId?: string | undefined;
    promoCode?: string | undefined;
  }): Promise<{
    subscriptionId: string;
    meteredSubscriptionId: string;
    trialEndsAt: Date | null;
  }> {
    if (!this.isBillingEnabled()) {
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }

    let trialDate: Date | null = null;

    if (typeof data.trial === "boolean") {
      if (data.trial) {
        trialDate = OneUptimeDate.getSomeDaysAfter(data.plan.getTrialPeriod());
      } else {
        trialDate = null;
      }
    } else if (data.trial instanceof Date) {
      trialDate = data.trial;
    }

    /*
     * A trial is live when its end date is still ahead of us - nothing else
     * decides it.
     *
     * The new plan's configured trial length is an input to how long a *fresh*
     * trial runs (the boolean branch above). It must not decide whether an
     * already-running trial handed over by changePlan survives: gating on it
     * meant a project that changed plan mid-trial onto a plan configured with
     * 0 trial days got trial_end "now", and Stripe invoiced the full plan on
     * the spot. That is the upgrade-during-trial charge customers reported.
     *
     * Same predicate as subscribeToMeteredPlan, so the flat-fee and the
     * metered subscription always end their trial on the same date.
     */
    const isTrialing: boolean = Boolean(
      trialDate && OneUptimeDate.isInTheFuture(trialDate),
    );

    const subscriptionId: string = await this.createFlatFeeSubscription({
      customerId: data.customerId,
      plan: data.plan,
      quantity: data.quantity,
      isYearly: data.isYearly,
      trialDate: isTrialing ? trialDate : null,
      defaultPaymentMethodId: data.defaultPaymentMethodId,
      promoCode: data.promoCode,
    });

    // Create metered subscriptions
    const meteredSubscription: {
      meteredSubscriptionId: string;
      trialEndsAt: Date | null;
    } = await this.subscribeToMeteredPlan({
      ...data,

      /*
       * The resolved trial, not the raw one: both subscriptions have to answer
       * "is this project trialing" the same way, or usage starts being invoiced
       * while the flat fee is still waived.
       */
      trialDate: isTrialing ? trialDate : null,
    });

    return {
      subscriptionId: subscriptionId,
      meteredSubscriptionId: meteredSubscription.meteredSubscriptionId,

      /*
       * Reported with the same predicate that built trial_end. Callers persist
       * this onto the project row, so a mismatch would leave the project
       * showing no trial while Stripe has the subscription trialing (or the
       * reverse) - and the project row is what gates the in-app trial banner.
       */
      trialEndsAt: isTrialing ? trialDate : null,
    };
  }

  /*
   * Creates the flat-fee subscription that carries the plan's price.
   *
   * Split out of subscribeToPlan so a plan change can rebuild the flat-fee
   * subscription on its own. The metered subscription is not part of a plan
   * change - it carries the usage already reported for the current period -
   * and is only ever rebuilt when it is itself dead.
   *
   * The trial is passed in already resolved. Whether one is running is the
   * caller's decision, and it has to be the same decision the metered
   * subscription is created with, or usage starts being invoiced while the
   * flat fee is still waived.
   */
  private async createFlatFeeSubscription(data: {
    customerId: string;
    plan: SubscriptionPlan;
    quantity: number;
    isYearly: boolean;
    trialDate: Date | null;
    defaultPaymentMethodId?: string | undefined;
    promoCode?: string | undefined;
    metadata?: Dictionary<string> | undefined;
  }): Promise<string> {
    const subscriptionParams: Stripe.SubscriptionCreateParams = {
      customer: data.customerId,

      items: [
        {
          price: data.isYearly
            ? data.plan.getYearlyPlanId()
            : data.plan.getMonthlyPlanId(),
          quantity: data.quantity,
        },
      ],

      proration_behavior: "always_invoice",

      // Same predicate as subscribeToMeteredPlan, so the pair trials together.
      trial_end:
        data.trialDate && OneUptimeDate.isInTheFuture(data.trialDate)
          ? OneUptimeDate.toUnixTimestamp(data.trialDate)
          : "now",
    };

    if (data.promoCode) {
      subscriptionParams.coupon = data.promoCode;
    }

    if (data.defaultPaymentMethodId) {
      subscriptionParams.default_payment_method = data.defaultPaymentMethodId;
    }

    if (data.metadata) {
      subscriptionParams.metadata = data.metadata;
    }

    const subscription: Stripe.Response<Stripe.Subscription> =
      await this.stripe.subscriptions.create(subscriptionParams);

    return subscription.id;
  }

  @CaptureSpan()
  public async changeQuantity(
    subscriptionId: string,
    quantity: number,
  ): Promise<void> {
    if (!this.isBillingEnabled()) {
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }

    const subscription: Stripe.Response<Stripe.Subscription> =
      await this.stripe.subscriptions.retrieve(subscriptionId);

    if (!subscription) {
      throw new BadDataException(Errors.BillingService.SUBSCRIPTION_NOT_FOUND);
    }
    if (subscription.status === "canceled") {
      // subscription is canceled.
      return;
    }

    const subscriptionItemId: string | undefined =
      subscription.items.data[0]?.id;

    if (!subscriptionItemId) {
      throw new BadDataException(
        Errors.BillingService.SUBSCRIPTION_ITEM_NOT_FOUND,
      );
    }

    await this.stripe.subscriptionItems.update(subscriptionItemId, {
      quantity: quantity,
    });

    // add billing anchor, so that the billing cycle starts now. New quantity will be charged from now. https://stackoverflow.com/questions/44417047/immediately-charge-for-subscription-changes
    await this.stripe.subscriptions.update(subscriptionId, {
      proration_behavior: "always_invoice",
    });
  }

  @CaptureSpan()
  public async addOrUpdateMeteredPricingOnSubscription(
    subscriptionId: string,
    serverMeteredPlan: ServerMeteredPlan,
    quantity: number,
  ): Promise<void> {
    if (!this.isBillingEnabled()) {
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }

    /*
     * A plan without a Stripe price yet cannot be pushed
     * to a subscription - getPriceId would throw. Usage has already been staged
     * into TelemetryUsageBilling by the caller, so skipping here loses nothing;
     * the push happens once the price ids are created.
     */
    if (!serverMeteredPlan.hasPriceId()) {
      return;
    }

    // get subscription.
    const subscription: Stripe.Subscription = await this.getSubscription(
      subscriptionId.toString(),
    );

    if (!subscription) {
      throw new BadDataException(Errors.BillingService.SUBSCRIPTION_NOT_FOUND);
    }

    // check if this pricing exists

    const pricingExists: boolean = subscription.items.data.some(
      (item: SubscriptionItem) => {
        return item.price?.id === serverMeteredPlan.getPriceId();
      },
    );

    if (pricingExists) {
      // update the quantity.
      const subscriptionItemId: string | undefined =
        subscription.items.data.find((item: SubscriptionItem) => {
          return item.price?.id === serverMeteredPlan.getPriceId();
        })?.id;

      if (!subscriptionItemId) {
        throw new BadDataException(
          Errors.BillingService.SUBSCRIPTION_ITEM_NOT_FOUND,
        );
      }

      // use stripe usage based api to update the quantity.
      await this.stripe.subscriptionItems.createUsageRecord(
        subscriptionItemId,
        {
          quantity: quantity,
        },
      );
    } else {
      // add the pricing.
      const subscriptionItem: SubscriptionItem =
        await this.stripe.subscriptionItems.create({
          subscription: subscriptionId,
          price: serverMeteredPlan.getPriceId(),
        });

      // use stripe usage based api to update the quantity.
      await this.stripe.subscriptionItems.createUsageRecord(
        subscriptionItem.id,
        {
          quantity: quantity,
        },
      );
    }

    // complete.
  }

  @CaptureSpan()
  public async isPromoCodeValid(promoCode: string): Promise<boolean> {
    if (!this.isBillingEnabled()) {
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }
    try {
      const promoCodeResponse: Stripe.Response<Stripe.Coupon> =
        await this.stripe.coupons.retrieve(promoCode);

      if (!promoCodeResponse) {
        throw new BadDataException(Errors.BillingService.PROMO_CODE_NOT_FOUND);
      }

      return promoCodeResponse.valid;
    } catch (err) {
      throw new BadDataException(
        (err as Error).message || Errors.BillingService.PROMO_CODE_INVALID,
      );
    }
  }

  @CaptureSpan()
  public async removeSubscriptionItem(
    subscriptionId: string,
    subscriptionItemId: string,
    isMeteredSubscriptionItem: boolean,
  ): Promise<void> {
    if (!this.isBillingEnabled()) {
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }

    const subscription: Stripe.Response<Stripe.Subscription> =
      await this.stripe.subscriptions.retrieve(subscriptionId);

    if (!subscription) {
      throw new BadDataException(Errors.BillingService.SUBSCRIPTION_NOT_FOUND);
    }

    if (subscription.status === "canceled") {
      // subscription is canceled.
      return;
    }

    const subscriptionItemOptions: Stripe.SubscriptionItemDeleteParams =
      isMeteredSubscriptionItem
        ? {
            proration_behavior: "create_prorations",
            clear_usage: true,
          }
        : {};

    await this.stripe.subscriptionItems.del(
      subscriptionItemId,
      subscriptionItemOptions,
    );
  }

  @CaptureSpan()
  public async getSubscriptionItems(
    subscriptionId: string,
  ): Promise<Array<SubscriptionItem>> {
    if (!this.isBillingEnabled()) {
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }

    const subscription: Stripe.Response<Stripe.Subscription> =
      await this.stripe.subscriptions.retrieve(subscriptionId);

    if (!subscription) {
      throw new BadDataException(Errors.BillingService.SUBSCRIPTION_NOT_FOUND);
    }

    return subscription.items.data;
  }

  /*
   * The trial a subscription itself carries, as a Date. Null when it carries
   * none - which is also what a subscription that no longer exists reports.
   */
  private getTrialEndOnSubscription(
    subscription: Stripe.Subscription | null,
  ): Date | null {
    return subscription?.trial_end
      ? OneUptimeDate.fromUnixTimestamp(subscription.trial_end)
      : null;
  }

  /*
   * Whether a subscription is one the project has to keep.
   *
   * A subscription that still bills the customer - active, trialing, or
   * past_due, the same three the rest of the product counts as active - is
   * kept, and a plan change is applied to it in place. Cancelling one of
   * these and creating a replacement bills the customer for both for as long
   * as the cancel does not land, and Stripe is still collecting on a past_due
   * subscription, so an abandoned one is not harmless either.
   *
   * The rest - cancelled, unpaid, incomplete, incomplete_expired, paused -
   * bill nothing and cannot be revived by an update: swapping a price onto
   * one would leave the project on a subscription that still bills nothing.
   * Those are replaced.
   */
  private isSubscriptionStillBilling(
    subscription: Stripe.Subscription | null,
  ): boolean {
    if (!subscription?.status) {
      return false;
    }

    /*
     * isSubscriptionActive answers "yes" to an absent status - it is written
     * for project rows, where no status means a project that predates the
     * column. A subscription always has one, and the guard above has already
     * dealt with a subscription that is not there at all.
     */
    return SubscriptionStatusUtil.isSubscriptionActive(
      subscription.status as SubscriptionStatus,
    );
  }

  /*
   * Whether a subscription has already finished, and so has nothing left to
   * cancel.
   *
   * Not the negation of isSubscriptionStillBilling: between the two sit the
   * statuses that bill nothing but are not over either - unpaid, incomplete,
   * paused - which are replaced AND still have to be cancelled, because the
   * subscription is still open at the payment provider.
   *
   * A subscription that is already cancelled or expired is not sent to the
   * provider to be cancelled again. The provider rejects that, and the reject
   * is indistinguishable to the retry loop from a cancel that genuinely did
   * not land: it would spend seconds retrying and then raise an alert asking
   * an operator to cancel by hand something that is already cancelled. Null
   * is the same case - findSubscription has already established the provider
   * does not have it.
   */
  private isSubscriptionAlreadyFinished(
    subscription: Stripe.Subscription | null,
  ): boolean {
    return (
      !subscription ||
      subscription.status === "canceled" ||
      subscription.status === "incomplete_expired"
    );
  }

  /*
   * Retrieves a subscription, returning null only when the payment provider
   * says it does not have it.
   *
   * A project row can point at an id the provider has since dropped, and that
   * is a reason to give the project a new subscription rather than to fail its
   * plan change outright.
   *
   * Every other error is thrown. A rate limit, a dropped connection or a
   * transient 5xx says nothing about whether the subscription is live, and
   * reading one as "it is gone" is how a perfectly healthy project got routed
   * onto the path that cancels and recreates its subscriptions. Failing the
   * plan change leaves the project exactly as it was, which is the safe answer
   * when we cannot tell.
   */
  private async findSubscription(
    subscriptionId: string,
  ): Promise<Stripe.Subscription | null> {
    try {
      return (await this.stripe.subscriptions.retrieve(subscriptionId)) || null;
    } catch (err) {
      if (this.isResourceMissingError(err)) {
        logger.debug(
          `Payment provider has no subscription ${subscriptionId}. It will be replaced.`,
        );
        return null;
      }

      logger.error(err, { subscriptionId } as LogAttributes);
      throw err;
    }
  }

  /*
   * A payment provider error saying the object is not there.
   *
   * Matched on the error's shape rather than with instanceof: the error can be
   * raised by a different copy of the stripe package than the one imported
   * here, and instanceof would then quietly say no - turning a subscription
   * that is simply gone into a failed plan change.
   */
  private isResourceMissingError(error: unknown): boolean {
    const providerError: {
      type?: string | undefined;
      rawType?: string | undefined;
      code?: string | undefined;
    } = (error || {}) as {
      type?: string | undefined;
      rawType?: string | undefined;
      code?: string | undefined;
    };

    return (
      providerError.code === "resource_missing" &&
      (providerError.type === "StripeInvalidRequestError" ||
        providerError.rawType === "invalid_request_error")
    );
  }

  @CaptureSpan()
  public async changePlan(data: {
    projectId: ObjectID;
    subscriptionId: string;
    meteredSubscriptionId: string;
    serverMeteredPlans: Array<ServerMeteredPlan>;
    newPlan: SubscriptionPlan;
    quantity: number;
    isYearly: boolean;
    endTrialAt?: Date | undefined;
  }): Promise<{
    subscriptionId: string;
    meteredSubscriptionId: string;
    trialEndsAt?: Date | undefined;
    subscriptionIdsPendingCancellation: Array<string>;
  }> {
    logger.debug("Changing plan");
    logger.debug(data);

    if (!this.isBillingEnabled()) {
      logger.debug(Errors.BillingService.BILLING_NOT_ENABLED);

      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }

    const subscription: Stripe.Response<Stripe.Subscription> =
      await this.stripe.subscriptions.retrieve(data.subscriptionId);

    logger.debug("Subscription");
    logger.debug(subscription);

    if (!subscription) {
      logger.debug(Errors.BillingService.SUBSCRIPTION_NOT_FOUND);
      throw new BadDataException(Errors.BillingService.SUBSCRIPTION_NOT_FOUND);
    }

    logger.debug("Subscription status");
    logger.debug(subscription.status);

    const paymentMethods: Array<PaymentMethod> = await this.getPaymentMethods(
      subscription.customer.toString(),
    );

    logger.debug("Payment methods");
    logger.debug(paymentMethods);

    if (paymentMethods.length === 0) {
      logger.debug("No payment methods");

      throw new BadDataException(Errors.BillingService.NO_PAYMENTS_METHODS);
    }

    /*
     * The trial the customer is really on lives on the subscription being
     * changed; endTrialAt is only the caller's copy of it. Resolve both while
     * the old subscription is still readable, and keep whichever runs longer.
     *
     * Changing plan must never shorten a trial. A caller holding a stale
     * project row - or one that does not pass endTrialAt at all - would
     * otherwise be able to end a trial the customer was promised, and Stripe
     * would invoice the full plan on the spot.
     */
    const trialEndOnCurrentSubscription: Date | null =
      this.getTrialEndOnSubscription(subscription);

    let endTrialAt: Date | undefined = data.endTrialAt;

    if (
      trialEndOnCurrentSubscription &&
      (!endTrialAt ||
        OneUptimeDate.isAfter(trialEndOnCurrentSubscription, endTrialAt))
    ) {
      endTrialAt = trialEndOnCurrentSubscription;
    }

    /*
     * A trial that has already lapsed is not revived by a plan change - the
     * customer is billed from now, which is what changing plan off a finished
     * trial is meant to do.
     */
    if (endTrialAt && !OneUptimeDate.isInTheFuture(endTrialAt)) {
      endTrialAt = undefined;
    }

    /*
     * The metered subscription is read but never rebuilt while it is alive.
     * Its items come from the metered plans' own price ids, which have nothing
     * to do with the plan being changed - recreating it would throw away the
     * usage already reported against it for the current period. It is fetched
     * here to find out whether it is one of the two halves that has to be
     * replaced.
     */
    const meteredSubscription: Stripe.Subscription | null =
      await this.findSubscription(data.meteredSubscriptionId);

    const subscriptionItemId: string | undefined =
      subscription.items.data[0]?.id;

    /*
     * A plan change is a price swap, so do exactly that whenever the project's
     * subscription can take one. Cancelling and recreating it means every
     * piece of subscription state - the trial, the billing cycle anchor,
     * discounts, billing anchor history, reported usage - has to be rebuilt by
     * hand, and the window between the create and the cancel is one the
     * customer pays for twice.
     *
     * The two subscriptions are decided separately, because they fail
     * separately: a project can be billing quite happily on its flat-fee
     * subscription while its metered one is dead, and the reverse. Replacing
     * the pair whenever either half was dead is what cancelled a live, billing
     * subscription and left the customer paying for it alongside its
     * replacement. Nothing that still bills is cancelled here.
     *
     * A subscription with no item has no handle to swap a price onto, so it is
     * replaced whatever its status says. It charges nothing either way - the
     * items are what carry the prices - so replacing it bills nobody twice.
     */
    const canSwapPriceOnSubscription: boolean =
      Boolean(subscriptionItemId) &&
      this.isSubscriptionStillBilling(subscription);

    const canKeepMeteredSubscription: boolean =
      this.isSubscriptionStillBilling(meteredSubscription);

    const customerId: string = subscription.customer.toString();

    /*
     * Order matters, and it is: update what is being kept, create what is
     * replacing what is not, cancel what has been replaced.
     *
     * The updates come first because they are the only steps that can fail
     * without leaving anything behind - the project is left on the
     * subscriptions it already had. The creates come before the cancels so
     * that a failure between them leaves the project on the subscriptions it
     * had rather than on none at all.
     */
    const subscriptionIdsToCancel: Array<string> = [];

    let newSubscriptionId: string = data.subscriptionId;
    let newMeteredSubscriptionId: string = data.meteredSubscriptionId;

    if (canSwapPriceOnSubscription) {
      await this.swapPlanPriceOnSubscription({
        subscriptionId: data.subscriptionId,
        subscriptionItemId: subscriptionItemId!,
        priceId: data.isYearly
          ? data.newPlan.getYearlyPlanId()
          : data.newPlan.getMonthlyPlanId(),
        quantity: data.quantity,
        endTrialAt: endTrialAt,
        trialEndOnSubscription: trialEndOnCurrentSubscription,
      });
    }

    if (canKeepMeteredSubscription) {
      await this.moveTrialOnMeteredSubscription({
        meteredSubscriptionId: data.meteredSubscriptionId,
        meteredSubscription: meteredSubscription,
        endTrialAt: endTrialAt,
      });
    }

    if (!canSwapPriceOnSubscription) {
      logger.debug("Replacing the flat-fee subscription");

      newSubscriptionId = await this.createFlatFeeSubscription({
        customerId: customerId,
        plan: data.newPlan,
        quantity: data.quantity,
        isYearly: data.isYearly,
        trialDate: endTrialAt || null,
        defaultPaymentMethodId: paymentMethods[0]?.id,
        metadata: this.getReplacementSubscriptionMetadata({
          projectId: data.projectId,
          replacedSubscriptionId: data.subscriptionId,
        }),
      });

      if (!this.isSubscriptionAlreadyFinished(subscription)) {
        subscriptionIdsToCancel.push(data.subscriptionId);
      }
    }

    if (!canKeepMeteredSubscription) {
      logger.debug("Replacing the metered subscription");

      const replacementMeteredSubscription: {
        meteredSubscriptionId: string;
        trialEndsAt: Date | null;
      } = await this.subscribeToMeteredPlan({
        projectId: data.projectId,
        customerId: customerId,
        serverMeteredPlans: data.serverMeteredPlans,
        trialDate: endTrialAt || null,
        defaultPaymentMethodId: paymentMethods[0]?.id,
        metadata: this.getReplacementSubscriptionMetadata({
          projectId: data.projectId,
          replacedSubscriptionId: data.meteredSubscriptionId,
        }),
      });

      newMeteredSubscriptionId =
        replacementMeteredSubscription.meteredSubscriptionId;

      if (!this.isSubscriptionAlreadyFinished(meteredSubscription)) {
        subscriptionIdsToCancel.push(data.meteredSubscriptionId);
      }
    }

    const subscriptionIdsPendingCancellation: Array<string> =
      await this.cancelReplacedSubscriptions(subscriptionIdsToCancel);

    return {
      subscriptionId: newSubscriptionId,
      meteredSubscriptionId: newMeteredSubscriptionId,

      /*
       * endTrialAt is the resolved trial: the longer of the caller's and the
       * one the old subscription carried, and undefined once it has lapsed.
       * It is what was sent to the payment provider on both halves, and the
       * caller writes it onto the project row.
       */
      trialEndsAt: endTrialAt,
      subscriptionIdsPendingCancellation: subscriptionIdsPendingCancellation,
    };
  }

  /*
   * The breadcrumb a replacement subscription carries at the payment provider.
   *
   * It is set when the replacement is created, which is before anything is
   * cancelled and before the caller writes the new ids over the old ones. That
   * ordering is the point: if the cancel is lost, or the plan change dies
   * between the two creates, this is what is left to find the abandoned
   * subscription - and the project it belongs to - with.
   */
  private getReplacementSubscriptionMetadata(data: {
    projectId: ObjectID;
    replacedSubscriptionId: string;
  }): Dictionary<string> {
    return {
      projectId: data.projectId.toString(),
      replacedSubscriptionId: data.replacedSubscriptionId,
    };
  }

  /*
   * Puts the new plan's price on the subscription the project already has.
   *
   * The subscription survives, so everything it carries survives with it.
   */
  private async swapPlanPriceOnSubscription(data: {
    subscriptionId: string;
    subscriptionItemId: string;
    priceId: string;
    quantity: number;
    endTrialAt: Date | undefined;
    trialEndOnSubscription: Date | null;
  }): Promise<void> {
    logger.debug("Swapping plan price on subscription");
    logger.debug(data.subscriptionId);

    const isTrialing: boolean = Boolean(data.endTrialAt);

    const updateParams: Stripe.SubscriptionUpdateParams = {
      items: [
        {
          /*
           * The id of the item being replaced. It is not optional: without it
           * Stripe ADDS the new price alongside the old one instead of
           * swapping it, and the customer is billed for both plans.
           */
          id: data.subscriptionItemId,
          price: data.priceId,
          quantity: data.quantity,
        },
      ],

      /*
       * Prorations are recorded and settle on the next invoice. Never
       * "always_invoice" - that raises an invoice on the spot, which is the
       * surprise charge a plan change must not produce. A trialing
       * subscription has nothing to prorate, so it asks for nothing.
       */
      proration_behavior: isTrialing ? "none" : "create_prorations",
    };

    /*
     * trial_end is deliberately absent unless the trial has to move forward.
     * Omitting it is what leaves the subscription trialing on the trial it
     * already has - sending a value re-anchors the billing cycle to it, and
     * sending "now" ends the trial and invoices the plan immediately.
     *
     * It is sent only when the resolved trial outlasts the one the
     * subscription carries: an extension recorded on the project but not yet
     * pushed to the payment provider is still a trial the customer was
     * promised, and the date returned below is written onto the project row,
     * so the two have to agree.
     */
    if (
      data.endTrialAt &&
      (!data.trialEndOnSubscription ||
        OneUptimeDate.isAfter(data.endTrialAt, data.trialEndOnSubscription))
    ) {
      updateParams.trial_end = OneUptimeDate.toUnixTimestamp(data.endTrialAt);
    }

    await this.stripe.subscriptions.update(data.subscriptionId, updateParams);

    logger.debug("Swapped plan price on subscription");
  }

  /*
   * Carries a trial that has moved forward onto the metered subscription.
   *
   * Both subscriptions bill the same customer for the same project, so they
   * have to end their trial on the same date - see subscribeToPlan. The
   * metered one is touched only for that; its plan is not part of a plan
   * change, and its items are the metered plans' own price ids.
   */
  private async moveTrialOnMeteredSubscription(data: {
    meteredSubscriptionId: string;
    meteredSubscription: Stripe.Subscription | null;
    endTrialAt: Date | undefined;
  }): Promise<void> {
    const trialEndOnMeteredSubscription: Date | null =
      this.getTrialEndOnSubscription(data.meteredSubscription);

    if (
      data.endTrialAt &&
      (!trialEndOnMeteredSubscription ||
        OneUptimeDate.isAfter(data.endTrialAt, trialEndOnMeteredSubscription))
    ) {
      await this.stripe.subscriptions.update(data.meteredSubscriptionId, {
        trial_end: OneUptimeDate.toUnixTimestamp(data.endTrialAt),
        proration_behavior: "none",
      });
    }
  }

  /*
   * Cancels the subscriptions a plan change has replaced, and reports back the
   * ones that are still there.
   *
   * Every id handed here belongs to a subscription that was not billing when
   * the plan change read it - changePlan keeps anything that was - so a cancel
   * that does not land is a loose end rather than a second charge. It still
   * must not pass silently: the caller is about to write the replacement ids
   * over these, and after that nothing in OneUptime points at them.
   *
   * The cancel is not allowed to throw, because by this point the replacements
   * already exist. Failing here would mean the caller never records them, and
   * the abandoned subscription would be the new, live pair instead of the dead
   * one - strictly worse than the problem being solved.
   */
  private async cancelReplacedSubscriptions(
    subscriptionIds: Array<string>,
  ): Promise<Array<string>> {
    const subscriptionIdsPendingCancellation: Array<string> = [];

    for (const subscriptionId of subscriptionIds) {
      if (!subscriptionId) {
        continue;
      }

      logger.debug(`Cancelling replaced subscription ${subscriptionId}`);

      const isCancelled: boolean =
        await this.cancelReplacedSubscription(subscriptionId);

      if (!isCancelled) {
        subscriptionIdsPendingCancellation.push(subscriptionId);
      }
    }

    return subscriptionIdsPendingCancellation;
  }

  // Cancels one replaced subscription, retrying. True when it is gone.
  private async cancelReplacedSubscription(
    subscriptionId: string,
  ): Promise<boolean> {
    for (
      let attempt: number = 0;
      attempt <= CANCEL_RETRY_DELAYS_IN_MS.length;
      attempt++
    ) {
      try {
        await this.stripe.subscriptions.del(subscriptionId);

        return true;
      } catch (err) {
        /*
         * Already gone - cancelled by a webhook, by another request, or by an
         * earlier attempt of this one whose response was lost. Gone is the
         * state being asked for.
         */
        if (this.isResourceMissingError(err)) {
          return true;
        }

        logger.error(err, { subscriptionId } as LogAttributes);

        const delayInMs: number | undefined =
          CANCEL_RETRY_DELAYS_IN_MS[attempt];

        if (delayInMs === undefined) {
          return false;
        }

        await Sleep.sleep(delayInMs);
      }
    }

    return false;
  }

  @CaptureSpan()
  public async deletePaymentMethod(
    customerId: string,
    paymentMethodId: string,
  ): Promise<void> {
    if (!this.isBillingEnabled()) {
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }

    const paymentMethods: Array<PaymentMethod> =
      await this.getPaymentMethods(customerId);

    if (paymentMethods.length === 1) {
      throw new BadDataException(
        Errors.BillingService.MIN_REQUIRED_PAYMENT_METHOD_NOT_MET,
      );
    }

    await this.stripe.paymentMethods.detach(paymentMethodId);
  }

  @CaptureSpan()
  public async hasPaymentMethods(customerId: string): Promise<boolean> {
    if ((await this.getPaymentMethods(customerId)).length > 0) {
      return true;
    }

    return false;
  }

  @CaptureSpan()
  public async setDefaultPaymentMethod(
    customerId: string,
    paymentMethodId: string,
  ): Promise<void> {
    await this.stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });
  }

  @CaptureSpan()
  public async getPaymentMethods(
    customerId: string,
  ): Promise<Array<PaymentMethod>> {
    if (!this.isBillingEnabled()) {
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }
    const paymentMethods: Array<PaymentMethod> = [];

    const cardPaymentMethods: Stripe.ApiList<Stripe.PaymentMethod> =
      await this.stripe.paymentMethods.list({
        customer: customerId,
        type: "card",
      });

    const sepaPaymentMethods: Stripe.ApiList<Stripe.PaymentMethod> =
      await this.stripe.paymentMethods.list({
        customer: customerId,
        type: "sepa_debit",
      });

    const usBankPaymentMethods: Stripe.ApiList<Stripe.PaymentMethod> =
      await this.stripe.paymentMethods.list({
        customer: customerId,
        type: "us_bank_account",
      });

    const bacsPaymentMethods: Stripe.ApiList<Stripe.PaymentMethod> =
      await this.stripe.paymentMethods.list({
        customer: customerId,
        type: "bacs_debit",
      });

    cardPaymentMethods.data.forEach((item: Stripe.PaymentMethod) => {
      paymentMethods.push({
        type: item.card?.brand || "Card",
        last4Digits: item.card?.last4 || "xxxx",
        isDefault: false,
        id: item.id,
      });
    });

    bacsPaymentMethods.data.forEach((item: Stripe.PaymentMethod) => {
      paymentMethods.push({
        type: "UK Bank Account",
        last4Digits: item.bacs_debit?.last4 || "xxxx",
        isDefault: false,
        id: item.id,
      });
    });

    usBankPaymentMethods.data.forEach((item: Stripe.PaymentMethod) => {
      paymentMethods.push({
        type: "US Bank Account",
        last4Digits: item.us_bank_account?.last4 || "xxxx",
        isDefault: false,
        id: item.id,
      });
    });

    sepaPaymentMethods.data.forEach((item: Stripe.PaymentMethod) => {
      paymentMethods.push({
        type: "EU Bank Account",
        last4Digits: item.sepa_debit?.last4 || "xxxx",
        isDefault: false,
        id: item.id,
      });
    });

    // check if there's a default payment method.

    const customer: Stripe.Response<Stripe.Customer | Stripe.DeletedCustomer> =
      await this.stripe.customers.retrieve(customerId);

    const defaultPaymentMethod:
      | string
      | Stripe.PaymentMethod
      | null
      | undefined = (customer as Stripe.Customer).invoice_settings
      ?.default_payment_method;

    const defaultPaymentMethodId: string | undefined =
      typeof defaultPaymentMethod === "string"
        ? defaultPaymentMethod
        : defaultPaymentMethod?.id;

    if (defaultPaymentMethodId) {
      for (const paymentMethod of paymentMethods) {
        paymentMethod.isDefault = paymentMethod.id === defaultPaymentMethodId;
      }

      // default payment method first — it's charged first when paying invoices.
      paymentMethods.sort((a: PaymentMethod, b: PaymentMethod) => {
        return Number(b.isDefault) - Number(a.isDefault);
      });
    } else if (
      (customer as Stripe.Customer).invoice_settings &&
      paymentMethods.length > 0 &&
      paymentMethods[0]?.id
    ) {
      // set the first payment method as default.
      await this.setDefaultPaymentMethod(customerId, paymentMethods[0].id);
      paymentMethods[0].isDefault = true;
    }

    return paymentMethods;
  }

  @CaptureSpan()
  public async getSetupIntentSecret(customerId: string): Promise<string> {
    const setupIntent: Stripe.Response<Stripe.SetupIntent> =
      await this.stripe.setupIntents.create({
        customer: customerId,
      });

    if (!setupIntent.client_secret) {
      throw new APIException(Errors.BillingService.CLIENT_SECRET_MISSING);
    }

    return setupIntent.client_secret;
  }

  @CaptureSpan()
  public async getCustomerBalance(customerId: string): Promise<number> {
    if (!this.isBillingEnabled()) {
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }

    const customer: Stripe.Response<Stripe.Customer | Stripe.DeletedCustomer> =
      await this.stripe.customers.retrieve(customerId);

    if (!customer || customer.deleted) {
      throw new BadDataException(Errors.BillingService.CUSTOMER_NOT_FOUND);
    }

    // Balance is in cents, convert to dollars
    return ((customer as Stripe.Customer).balance || 0) / 100;
  }

  /*
   * Cancels a subscription, and carries on if it could not be cancelled.
   *
   * The leniency is for deleting a project: the project row goes away either
   * way, and a failed cancel there is a billing loose end to chase, not a
   * reason to leave the project half-deleted. A caller that needs to know the
   * subscription really stopped billing must not use this - a plan change goes
   * through cancelReplacedSubscriptions, which retries and reports what is
   * left.
   */
  @CaptureSpan()
  public async cancelSubscription(subscriptionId: string): Promise<void> {
    if (!this.isBillingEnabled()) {
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }
    try {
      await this.stripe.subscriptions.del(subscriptionId);
    } catch (err) {
      logger.error(err, { subscriptionId } as LogAttributes);
    }
  }

  /*
   * Moves the trial end of a project's subscriptions to a new date.
   *
   * Both the flat-fee subscription and the metered subscription have to move
   * together: they were created with the same trial_end (see subscribeToPlan),
   * and leaving the metered one behind would start billing usage while the
   * customer still believes they are on trial.
   */
  @CaptureSpan()
  public async extendTrial(data: {
    subscriptionId: string;
    meteredSubscriptionId?: string | undefined;
    trialEndsAt: Date;
  }): Promise<void> {
    if (!this.isBillingEnabled()) {
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }

    if (!OneUptimeDate.isInTheFuture(data.trialEndsAt)) {
      throw new BadDataException(Errors.BillingService.TRIAL_END_DATE_IN_PAST);
    }

    if (
      OneUptimeDate.isAfter(
        data.trialEndsAt,
        OneUptimeDate.getSomeDaysAfter(MAX_TRIAL_LENGTH_IN_DAYS),
      )
    ) {
      throw new BadDataException(
        Errors.BillingService.TRIAL_END_DATE_TOO_FAR_IN_FUTURE,
      );
    }

    const subscriptionIds: Array<string> = [data.subscriptionId];

    if (data.meteredSubscriptionId) {
      subscriptionIds.push(data.meteredSubscriptionId);
    }

    /*
     * Validate every subscription before touching any of them. Updating the
     * flat-fee subscription and then discovering the metered one is cancelled
     * would leave the project's two subscriptions on different trial dates.
     */
    for (const subscriptionId of subscriptionIds) {
      const subscription: Stripe.Subscription =
        await this.getSubscription(subscriptionId);

      if (!subscription) {
        throw new BadDataException(
          Errors.BillingService.SUBSCRIPTION_NOT_FOUND,
        );
      }

      if (
        subscription.status === "canceled" ||
        subscription.status === "incomplete_expired"
      ) {
        throw new BadDataException(
          Errors.BillingService.CANNOT_EXTEND_TRIAL_ON_CANCELLED_SUBSCRIPTION,
        );
      }
    }

    for (const subscriptionId of subscriptionIds) {
      await this.stripe.subscriptions.update(subscriptionId, {
        trial_end: OneUptimeDate.toUnixTimestamp(data.trialEndsAt),

        /*
         * Setting trial_end also moves the billing cycle anchor to that date.
         * With the default proration behaviour Stripe raises proration line
         * items for the shifted period, which is exactly the surprise invoice
         * extending a trial is meant to prevent - so prorations are disabled.
         *
         * Caveat: this only silences the flat-fee subscription. Usage-based
         * billing is not subject to proration, so closing the metered
         * subscription's period early still invoices the usage recorded in it.
         * For a project that is still trialing that is nothing (trial usage is
         * not billable), but extending the trial of an already-active project
         * bills its accrued usage immediately - the admin page warns about
         * this before the extension is submitted.
         */
        proration_behavior: "none",
      });

      logger.debug(
        `Extended trial for subscription ${subscriptionId} to ${data.trialEndsAt.toISOString()}`,
      );
    }
  }

  @CaptureSpan()
  public async getSubscriptionStatus(
    subscriptionId: string,
  ): Promise<SubscriptionStatus> {
    const subscription: Stripe.Subscription =
      await this.getSubscription(subscriptionId);
    return subscription.status as SubscriptionStatus;
  }

  @CaptureSpan()
  public async getSubscription(
    subscriptionId: string,
  ): Promise<Stripe.Subscription> {
    if (!this.isBillingEnabled()) {
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }

    const subscription: Stripe.Response<Stripe.Subscription> =
      await this.stripe.subscriptions.retrieve(subscriptionId);

    return subscription;
  }

  @CaptureSpan()
  public async getInvoice(
    customerId: string,
    invoiceId: string,
  ): Promise<Invoice> {
    if (!this.isBillingEnabled()) {
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }

    logger.debug("Getting invoice");
    logger.debug(invoiceId);
    logger.debug(customerId);

    const invoice: Stripe.Response<Stripe.Invoice> =
      await this.stripe.invoices.retrieve(invoiceId);

    if (!invoice) {
      throw new BadDataException(Errors.BillingService.INVOICE_NOT_FOUND);
    }

    return {
      id: invoice.id!,
      amount: invoice.amount_due,
      currencyCode: invoice.currency,
      subscriptionId: invoice.subscription?.toString() || undefined,
      status: invoice.status?.toString() || "Unknown",
      downloadableLink: invoice.invoice_pdf?.toString() || "",
      customerId: invoice.customer?.toString() || "",
      invoiceDate: invoice.created
        ? new Date(invoice.created * 1000)
        : OneUptimeDate.getCurrentDate(),
      invoiceNumber: invoice.number || undefined,
      paymentIntentId: invoice.payment_intent?.toString() || undefined,
    };
  }

  @CaptureSpan()
  public async getPaymentIntentClientSecret(
    paymentIntentId: string,
  ): Promise<string> {
    const paymentIntent: Stripe.Response<Stripe.PaymentIntent> =
      await this.stripe.paymentIntents.retrieve(paymentIntentId);

    if (!paymentIntent.client_secret) {
      throw new APIException(Errors.BillingService.CLIENT_SECRET_MISSING);
    }

    return paymentIntent.client_secret;
  }

  @CaptureSpan()
  public async getPaymentIntentIdFromInvoice(
    invoiceId: string,
  ): Promise<string> {
    const invoice: Stripe.Response<Stripe.Invoice> =
      await this.stripe.invoices.retrieve(invoiceId);

    if (!invoice) {
      throw new BadDataException(Errors.BillingService.INVOICE_NOT_FOUND);
    }

    if (!invoice.payment_intent) {
      throw new BadDataException(
        Errors.BillingService.PAYMENT_INTENT_NOT_FOUND,
      );
    }

    return invoice.payment_intent.toString();
  }

  @CaptureSpan()
  public async getInvoices(customerId: string): Promise<Array<Invoice>> {
    const invoices: Stripe.ApiList<Stripe.Invoice> =
      await this.stripe.invoices.list({
        customer: customerId,
        limit: 100,
      });

    let billingInvoices: Array<Invoice> = invoices.data.map(
      (invoice: Stripe.Invoice) => {
        return {
          id: invoice.id!,
          amount: invoice.amount_due,
          currencyCode: invoice.currency,
          subscriptionId: invoice.subscription?.toString() || undefined,
          status: invoice.status?.toString() || "Unknown",
          downloadableLink: invoice.invoice_pdf?.toString() || "",
          customerId: invoice.customer?.toString() || "",
          invoiceDate: invoice.created
            ? new Date(invoice.created * 1000)
            : OneUptimeDate.getCurrentDate(),
          invoiceNumber: invoice.number || undefined,
          paymentIntent: invoice.payment_intent?.toString() || undefined,
        };
      },
    );

    // sort by date in descending order.
    billingInvoices = billingInvoices.sort((a: Invoice, b: Invoice) => {
      return a.invoiceDate.getTime() - b.invoiceDate.getTime();
    });

    return billingInvoices;
  }

  @CaptureSpan()
  public async sendInvoiceByEmail(
    invoiceId: string,
    recipientEmails?: Array<Email>,
    projectId?: ObjectID,
  ): Promise<void> {
    const recipientsForLog: string = (recipientEmails || [])
      .map((e: Email): string => {
        return e.toString();
      })
      .join(", ");
    logger.debug(
      `[Invoice Email] sendInvoiceByEmail called for invoice: ${invoiceId}, recipients: ${recipientsForLog}`,
    );

    if (!this.isBillingEnabled()) {
      logger.debug(
        `[Invoice Email] Billing not enabled, skipping send for invoice: ${invoiceId}`,
      );
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }

    try {
      // Fetch invoice details from Stripe
      logger.debug(
        `[Invoice Email] Fetching invoice ${invoiceId} details from Stripe`,
      );
      const stripeInvoice: Stripe.Invoice =
        await this.stripe.invoices.retrieve(invoiceId);

      if (!stripeInvoice) {
        logger.error(
          `[Invoice Email] Invoice ${invoiceId} not found in Stripe`,
          { projectId: projectId?.toString() } as LogAttributes,
        );
        return;
      }

      /*
       * Determine recipient list. Fall back to the invoice's customer email when no
       * explicit recipients were supplied by the caller.
       */
      let toEmails: Array<Email> = recipientEmails || [];
      if (toEmails.length === 0 && stripeInvoice.customer_email) {
        try {
          toEmails = Email.parseList(stripeInvoice.customer_email);
        } catch (err) {
          logger.error(
            `[Invoice Email] Failed to parse Stripe customer_email "${stripeInvoice.customer_email}" for invoice ${invoiceId}: ${err}`,
          );
        }
      }

      if (toEmails.length === 0) {
        logger.error(
          `[Invoice Email] No recipient email found for invoice ${invoiceId}`,
          { projectId: projectId?.toString() } as LogAttributes,
        );
        return;
      }

      // Format invoice data for email
      const invoiceNumber: string = stripeInvoice.number || invoiceId;
      const invoiceDate: string = stripeInvoice.created
        ? OneUptimeDate.getDateAsFormattedString(
            new Date(stripeInvoice.created * 1000),
          )
        : OneUptimeDate.getDateAsFormattedString(
            OneUptimeDate.getCurrentDate(),
          );
      const amount: string = `${(stripeInvoice.amount_due / 100).toFixed(2)} ${stripeInvoice.currency?.toUpperCase() || "USD"}`;
      const invoicePdfUrl: string | undefined =
        stripeInvoice.invoice_pdf || undefined;
      const description: string | undefined =
        stripeInvoice.description || undefined;

      // Build dashboard link
      let dashboardLink: string | undefined = undefined;
      if (projectId && DashboardClientUrl) {
        dashboardLink = `${DashboardClientUrl.toString()}/dashboard/${projectId.toString()}/settings/billing`;
      }

      for (const toEmail of toEmails) {
        logger.debug(
          `[Invoice Email] Sending invoice email to ${toEmail.toString()} - Invoice #${invoiceNumber}, Amount: ${amount}`,
        );
        try {
          await MailService.sendMail(
            {
              toEmail: toEmail,
              templateType: EmailTemplateType.Invoice,
              vars: {
                invoiceNumber: invoiceNumber,
                invoiceDate: invoiceDate,
                amount: amount,
                description: description || "",
                invoicePdfUrl: invoicePdfUrl || "",
                dashboardLink: dashboardLink || "",
              },
              subject: `Invoice #${invoiceNumber} from OneUptime`,
            },
            {
              projectId: projectId,
            },
          );

          logger.debug(
            `[Invoice Email] Successfully sent invoice ${invoiceId} email to ${toEmail.toString()}`,
          );
        } catch (perRecipientErr) {
          // Keep going for the remaining recipients if one fails.
          logger.error(
            `[Invoice Email] Failed to send invoice ${invoiceId} to ${toEmail.toString()}: ${perRecipientErr}`,
            { projectId: projectId?.toString() } as LogAttributes,
          );
        }
      }
    } catch (err) {
      logger.error(
        `[Invoice Email] Failed to send invoice ${invoiceId} by email: ${err}`,
        { projectId: projectId?.toString() } as LogAttributes,
      );
      // Don't throw - sending email is not critical
    }
  }

  @CaptureSpan()
  public async shouldSendInvoicesByEmail(customerId: string): Promise<boolean> {
    logger.debug(
      `[Invoice Email] shouldSendInvoicesByEmail called for customer: ${customerId}`,
    );

    if (!this.isBillingEnabled()) {
      logger.debug(
        `[Invoice Email] Billing not enabled, returning false for customer: ${customerId}`,
      );
      return false;
    }

    try {
      logger.debug(
        `[Invoice Email] Retrieving customer ${customerId} from Stripe to check preference`,
      );
      const customer: Stripe.Response<
        Stripe.Customer | Stripe.DeletedCustomer
      > = await this.stripe.customers.retrieve(customerId);

      if (!customer || customer.deleted) {
        logger.debug(
          `[Invoice Email] Customer ${customerId} not found or deleted, returning false`,
        );
        return false;
      }

      const metadata: Stripe.Metadata = (customer as Stripe.Customer).metadata;
      const sendInvoicesByEmail: boolean =
        metadata?.["send_invoices_by_email"] === "true";
      logger.debug(
        `[Invoice Email] Customer ${customerId} metadata.send_invoices_by_email = "${metadata?.["send_invoices_by_email"]}", result: ${sendInvoicesByEmail}`,
      );
      return sendInvoicesByEmail;
    } catch (err) {
      logger.error(
        `[Invoice Email] Failed to check invoice email preference for customer ${customerId}: ${err}`,
        { customerId } as LogAttributes,
      );
      return false;
    }
  }

  @CaptureSpan()
  public async generateInvoiceAndChargeCustomer(
    customerId: string,
    itemText: string,
    amountInUsd: number,
    options?: {
      sendInvoiceByEmail?: boolean | undefined;
      recipientEmails?: Array<Email> | undefined;
      projectId?: ObjectID | undefined;
    },
  ): Promise<void> {
    const sendInvoiceByEmail: boolean = options?.sendInvoiceByEmail || false;
    const recipientEmails: Array<Email> | undefined = options?.recipientEmails;
    const projectId: ObjectID | undefined = options?.projectId;

    const recipientsForLog: string = (recipientEmails || [])
      .map((e: Email): string => {
        return e.toString();
      })
      .join(", ");
    logger.debug(
      `[Invoice Email] generateInvoiceAndChargeCustomer called - customer: ${customerId}, amount: $${amountInUsd}, sendInvoiceByEmail: ${sendInvoiceByEmail}, recipients: ${recipientsForLog}, projectId: ${projectId?.toString()}`,
    );

    const invoice: Stripe.Invoice = await this.stripe.invoices.create({
      customer: customerId,
      auto_advance: true, // do not automatically charge.
      collection_method: "charge_automatically",
    });

    if (!invoice || !invoice.id) {
      logger.error(
        `[Invoice Email] Failed to create invoice for customer ${customerId}`,
        { projectId: projectId?.toString() } as LogAttributes,
      );
      throw new APIException(Errors.BillingService.INVOICE_NOT_GENERATED);
    }

    logger.debug(
      `[Invoice Email] Created invoice ${invoice.id} for customer ${customerId}`,
    );

    await this.stripe.invoiceItems.create({
      invoice: invoice.id,
      amount: amountInUsd * 100,
      description: itemText,
      customer: customerId,
    });

    logger.debug(
      `[Invoice Email] Added invoice item to invoice ${invoice.id}: ${itemText}, $${amountInUsd}`,
    );

    await this.stripe.invoices.finalizeInvoice(invoice.id!);
    logger.debug(`[Invoice Email] Finalized invoice ${invoice.id}`);

    try {
      await this.payInvoice(customerId, invoice.id!);
      logger.debug(`[Invoice Email] Paid invoice ${invoice.id}`);

      // Send invoice by email if requested
      if (sendInvoiceByEmail) {
        logger.debug(
          `[Invoice Email] sendInvoiceByEmail is true, sending invoice ${invoice.id} by email`,
        );
        await this.sendInvoiceByEmail(invoice.id!, recipientEmails, projectId);
      } else {
        logger.debug(
          `[Invoice Email] sendInvoiceByEmail is false, skipping email for invoice ${invoice.id}`,
        );
      }
    } catch (err) {
      logger.error(
        `[Invoice Email] Failed to pay invoice ${invoice.id}, voiding: ${err}`,
        { projectId: projectId?.toString() } as LogAttributes,
      );
      // mark invoice as failed and do not collect payment.
      await this.voidInvoice(invoice.id!);
      throw err;
    }
  }

  @CaptureSpan()
  public async voidInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    const invoice: Stripe.Invoice =
      await this.stripe.invoices.voidInvoice(invoiceId);

    return invoice;
  }

  /*
   * Returns true if the error is attributable to the payment method itself
   * (declined, expired, unusable), meaning paying with a different payment
   * method may succeed.
   *
   * Not retryable:
   * - invoice_payment_intent_requires_action (3DS/SCA): the payment method
   *   works but needs customer authentication — throw so the interactive
   *   flow (BillingInvoiceAPI) surfaces the authentication prompt for the
   *   default method instead of silently charging a backup method.
   * - Invoice-state or connectivity errors: another payment method would
   *   not help, and if the outcome of the attempt is unknown a retry could
   *   double-charge the customer.
   *
   * Note: most bank debit (ACH/SEPA/BACS) failures are asynchronous — the
   * pay call succeeds and the failure arrives days later via webhook — so
   * failover only catches the synchronous ones (unverified/unusable
   * accounts).
   */
  private canRetryWithDifferentPaymentMethod(err: unknown): boolean {
    const stripeError: { type?: string; code?: string } = err as {
      type?: string;
      code?: string;
    };

    if (stripeError?.type === "StripeCardError") {
      return true;
    }

    return Boolean(
      stripeError?.code?.startsWith("payment_method_") ||
        stripeError?.code?.startsWith("bank_account_"),
    );
  }

  @CaptureSpan()
  public async payInvoice(
    customerId: string,
    invoiceId: string,
  ): Promise<Invoice> {
    // after the invoice is paid, // please fetch subscription and check the status.
    const paymentMethods: Array<PaymentMethod> =
      await this.getPaymentMethods(customerId);

    if (paymentMethods.length === 0) {
      throw new BadDataException(Errors.BillingService.NO_PAYMENTS_METHODS);
    }

    /*
     * getPaymentMethods returns the default payment method first. If it is
     * declined, fall back to the customer's other payment methods before
     * giving up. Attempts are capped to bound decline traffic on unattended
     * retry paths (e.g. recharge-on-low-balance), which create a fresh
     * invoice and retry on every cycle.
     */
    const maxPaymentMethodsToTry: number = 3;
    let lastError: unknown = null;

    for (const paymentMethod of paymentMethods.slice(
      0,
      maxPaymentMethodsToTry,
    )) {
      try {
        const invoice: Stripe.Invoice = await this.stripe.invoices.pay(
          invoiceId,
          {
            payment_method: paymentMethod.id,
          },
        );

        return {
          id: invoice.id!,
          amount: invoice.amount_due,
          currencyCode: invoice.currency,
          subscriptionId: invoice.subscription?.toString() || undefined,
          status: invoice.status?.toString() || "Unknown",
          downloadableLink: invoice.invoice_pdf?.toString() || "",
          customerId: invoice.customer?.toString() || "",
          invoiceDate: invoice.created
            ? new Date(invoice.created * 1000)
            : OneUptimeDate.getCurrentDate(),
          invoiceNumber: invoice.number || undefined,
        };
      } catch (err) {
        logger.error(
          `Failed to pay invoice ${invoiceId} with payment method ${paymentMethod.type} ending in ${paymentMethod.last4Digits}: ${err}`,
        );

        if (!this.canRetryWithDifferentPaymentMethod(err)) {
          throw err;
        }

        lastError = err;
      }
    }

    throw lastError;
  }

  public getMeteredPlanPriceId(productType: ProductType): string {
    if (productType === ProductType.ActiveMonitoring) {
      if (this.isTestEnvironment()) {
        return "price_1N6CHFANuQdJ93r7qDaLmb7S";
      }

      return "price_1N6B9EANuQdJ93r7fj3bhcWP";
    }

    if (productType === ProductType.Logs) {
      if (this.isTestEnvironment()) {
        return "price_1OPnB5ANuQdJ93r7jG4NLCJG";
      }

      return "price_1OQ8gwANuQdJ93r74Pi85UQq";
    }

    if (productType === ProductType.Traces) {
      if (this.isTestEnvironment()) {
        return "price_1OQ8i9ANuQdJ93r75J3wr0PX";
      }

      return "price_1OQ8ivANuQdJ93r7NAR8KbH3";
    }

    if (productType === ProductType.Metrics) {
      if (this.isTestEnvironment()) {
        return "price_1OQ8iqANuQdJ93r7wZ7gJ7Gb";
      }

      return "price_1OQ8j0ANuQdJ93r7WGzR0p6j";
    }

    if (productType === ProductType.Profiles) {
      if (this.isTestEnvironment()) {
        return "price_1TGwUpANuQdJ93r7b9qxa5Se";
      }

      return "price_1TGwTDANuQdJ93r7s0jKRxaT";
    }

    if (productType === ProductType.SessionReplay) {
      if (this.isTestEnvironment()) {
        return "price_1U0icaANuQdJ93r7yE4a6icc";
      }

      return "price_1U0iWJANuQdJ93r7iVAXwhdP";
    }

    if (productType === ProductType.SecurityEvents) {
      if (this.isTestEnvironment()) {
        return "price_1U7efaANuQdJ93r74hFVOgdS";
      }

      return "price_1U7edTANuQdJ93r7hR9jpBfv";
    }

    throw new BadDataException(
      "Plan with productType " + productType + " not found",
    );
  }

  /*
   * Whether a Stripe metered price exists for this product type yet.
   *
   * getMeteredPlanPriceId throws for product types whose Stripe prices have
   * not been created and for unknown types. Every product type is priced
   * today, so this only guards the next one added ahead of its Stripe price.
   * Callers that build Stripe subscription items must skip those plans instead of
   * letting the throw abort the whole operation - a metered plan without a
   * price still stages usage into TelemetryUsageBilling, only the push to
   * Stripe waits on the price ids. This is the single, side-effect-free way to
   * ask, so we keep getMeteredPlanPriceId as the single source of truth.
   */
  public hasMeteredPlanPriceId(productType: ProductType): boolean {
    try {
      return Boolean(this.getMeteredPlanPriceId(productType));
    } catch {
      return false;
    }
  }

  @CaptureSpan()
  public verifyWebhookSignature(
    payload: string | Buffer,
    signature: string,
  ): Stripe.Event {
    logger.debug(`[Invoice Email] verifyWebhookSignature called`);

    if (!BillingWebhookSecret) {
      logger.error(`[Invoice Email] Billing webhook secret is not configured`);
      throw new BadDataException("Billing webhook secret is not configured");
    }

    logger.debug(
      `[Invoice Email] Verifying webhook signature with secret (length: ${BillingWebhookSecret.length})`,
    );
    const event: Stripe.Event = this.stripe.webhooks.constructEvent(
      payload,
      signature,
      BillingWebhookSecret,
    );
    logger.debug(
      `[Invoice Email] Webhook signature verified, event type: ${event.type}, event id: ${event.id}`,
    );
    return event;
  }

  @CaptureSpan()
  public async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    logger.debug(
      `[Invoice Email] handleWebhookEvent called - event type: ${event.type}, event id: ${event.id}`,
    );

    if (!this.isBillingEnabled()) {
      logger.debug(
        `[Invoice Email] Billing not enabled, ignoring webhook event ${event.id}`,
      );
      return;
    }

    // Handle invoice.finalized event to send invoice by email if customer has opted in
    if (event.type === "invoice.finalized") {
      logger.debug(
        `[Invoice Email] Processing invoice.finalized event ${event.id}`,
      );
      const invoice: Stripe.Invoice = event.data.object as Stripe.Invoice;

      logger.debug(
        `[Invoice Email] Invoice details - id: ${invoice.id}, number: ${invoice.number}, customer: ${invoice.customer}, status: ${invoice.status}`,
      );

      if (!invoice.customer) {
        logger.debug(
          `[Invoice Email] No customer on invoice ${invoice.id}, skipping`,
        );
        return;
      }

      const customerId: string =
        typeof invoice.customer === "string"
          ? invoice.customer
          : invoice.customer.id;

      logger.debug(
        `[Invoice Email] Extracted customer ID: ${customerId} from invoice ${invoice.id}`,
      );

      try {
        logger.debug(
          `[Invoice Email] Checking if customer ${customerId} has invoice emails enabled`,
        );
        const shouldSend: boolean =
          await this.shouldSendInvoicesByEmail(customerId);

        if (shouldSend && invoice.id) {
          logger.debug(
            `[Invoice Email] Customer ${customerId} has invoice emails enabled, looking up project`,
          );

          // Find the project by Stripe customer ID
          const project: Project | null = await ProjectService.findOneBy({
            query: {
              paymentProviderCustomerId: customerId,
            },
            select: {
              _id: true,
              financeAccountingEmail: true,
            },
            props: {
              isRoot: true,
            },
          });

          let recipientEmails: Array<Email> | undefined = undefined;
          let projectId: ObjectID | undefined = undefined;

          if (project) {
            projectId = project.id || undefined;
            if (project.financeAccountingEmail) {
              try {
                recipientEmails = Email.parseList(
                  project.financeAccountingEmail,
                );
              } catch (parseErr) {
                /*
                 * Log and fall back to Stripe customer email rather than dropping
                 * the invoice delivery entirely due to a malformed address.
                 */
                logger.error(
                  `[Invoice Email] Failed to parse financeAccountingEmail for project ${projectId?.toString()}: ${parseErr}`,
                );
              }
            }
            const parsedForLog: string = (recipientEmails || [])
              .map((e: Email): string => {
                return e.toString();
              })
              .join(", ");
            logger.debug(
              `[Invoice Email] Found project ${projectId?.toString()}, financeAccountingEmail recipients: ${parsedForLog}`,
            );
          } else {
            logger.debug(
              `[Invoice Email] No project found for customer ${customerId}, will use Stripe customer email`,
            );
          }

          logger.debug(
            `[Invoice Email] Sending invoice ${invoice.id} by email`,
          );
          await this.sendInvoiceByEmail(invoice.id, recipientEmails, projectId);
          logger.debug(
            `[Invoice Email] Successfully processed invoice.finalized - sent invoice ${invoice.id} by email`,
          );
        } else {
          logger.debug(
            `[Invoice Email] Customer ${customerId} has invoice emails disabled (shouldSend: ${shouldSend}), skipping email for invoice ${invoice.id}`,
          );
        }
      } catch (err) {
        logger.error(
          `[Invoice Email] Failed to send invoice by email for invoice ${invoice.id}: ${err}`,
          { customerId } as LogAttributes,
        );
        // Don't throw - webhook should still return success
      }
    } else {
      logger.debug(
        `[Invoice Email] Ignoring event type ${event.type}, not invoice.finalized`,
      );
    }
  }
}

export default new BillingService();
