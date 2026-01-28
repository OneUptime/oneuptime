import { BillingPrivateKey, BillingWebhookSecret, IsBillingEnabled, DashboardClientUrl } from "../EnvironmentConfig";
import Project from "../../Models/DatabaseModels/Project";
import ServerMeteredPlan from "../Types/Billing/MeteredPlan/ServerMeteredPlan";
import Errors from "../Utils/Errors";
import logger from "../Utils/Logger";
import BaseService from "./BaseService";
import MailService from "./MailService";
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
    logger.debug(`[Invoice Email] updateCustomerBusinessDetails called - customerId: ${id}, sendInvoicesByEmail: ${sendInvoicesByEmail}`);

    if (!this.isBillingEnabled()) {
      logger.debug(`[Invoice Email] Billing not enabled, skipping updateCustomerBusinessDetails for customer ${id}`);
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

    const metadata: Record<string, string> = {
      business_details_full: businessDetails.substring(0, 5000),
    };
    if (financeAccountingEmail) {
      metadata["finance_accounting_email"] = financeAccountingEmail.substring(
        0,
        200,
      );
    } else {
      // Remove if cleared
      metadata["finance_accounting_email"] = "";
    }
    if (sendInvoicesByEmail !== undefined && sendInvoicesByEmail !== null) {
      metadata["send_invoices_by_email"] = sendInvoicesByEmail ? "true" : "false";
      logger.debug(`[Invoice Email] Setting send_invoices_by_email metadata to "${metadata["send_invoices_by_email"]}" for customer ${id}`);
    }

    const updateParams: Stripe.CustomerUpdateParams = {
      metadata,
      address: {},
    };

    /*
     * If finance / accounting email provided, set it as the customer email so Stripe sends
     * invoices / receipts there. (Stripe only supports a single email via API currently.)
     */
    if (financeAccountingEmail && financeAccountingEmail.trim().length > 0) {
      updateParams.email = financeAccountingEmail.trim();
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

    logger.debug(`[Invoice Email] Updating Stripe customer ${id} with metadata: ${JSON.stringify(metadata)}`);
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
  }): Promise<{
    meteredSubscriptionId: string;
    trialEndsAt: Date | null;
  }> {
    const meteredPlanSubscriptionParams: Stripe.SubscriptionCreateParams = {
      customer: data.customerId,

      proration_behavior: "always_invoice",

      items: data.serverMeteredPlans.map((item: ServerMeteredPlan) => {
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

      trial_end:
        trialDate && data.plan.getTrialPeriod() > 0
          ? OneUptimeDate.toUnixTimestamp(trialDate)
          : "now",
    };

    if (data.promoCode) {
      subscriptionParams.coupon = data.promoCode;
    }

    if (data.defaultPaymentMethodId) {
      subscriptionParams.default_payment_method = data.defaultPaymentMethodId;
    }

    const subscription: Stripe.Response<Stripe.Subscription> =
      await this.stripe.subscriptions.create(subscriptionParams);

    // Create metered subscriptions
    const meteredSubscription: {
      meteredSubscriptionId: string;
      trialEndsAt: Date | null;
    } = await this.subscribeToMeteredPlan({
      ...data,
      trialDate,
    });

    return {
      subscriptionId: subscription.id,
      meteredSubscriptionId: meteredSubscription.meteredSubscriptionId,
      trialEndsAt:
        trialDate && data.plan.getTrialPeriod() > 0 ? trialDate : null,
    };
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

    logger.debug("Cancelling subscriptions");
    logger.debug(data.subscriptionId);
    await this.cancelSubscription(data.subscriptionId);

    logger.debug("Cancelling metered subscriptions");
    logger.debug(data.meteredSubscriptionId);
    await this.cancelSubscription(data.meteredSubscriptionId);

    if (data.endTrialAt && !OneUptimeDate.isInTheFuture(data.endTrialAt)) {
      data.endTrialAt = undefined;
    }

    logger.debug("Subscribing to plan");

    const subscribeToPlan: {
      subscriptionId: string;
      meteredSubscriptionId: string;
      trialEndsAt: Date | null;
    } = await this.subscribeToPlan({
      projectId: data.projectId,
      customerId: subscription.customer.toString(),
      serverMeteredPlans: data.serverMeteredPlans,
      plan: data.newPlan,
      quantity: data.quantity,
      isYearly: data.isYearly,
      trial: data.endTrialAt,
      defaultPaymentMethodId: paymentMethods[0]?.id,
      promoCode: undefined,
    });

    logger.debug("Subscribed to plan");

    const value: {
      subscriptionId: string;
      meteredSubscriptionId: string;
      trialEndsAt?: Date | undefined;
    } = {
      subscriptionId: subscribeToPlan.subscriptionId,
      meteredSubscriptionId: subscribeToPlan.meteredSubscriptionId,
      trialEndsAt: subscribeToPlan.trialEndsAt || undefined,
    };

    return value;
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

    if (
      (customer as Stripe.Customer).invoice_settings &&
      !(customer as Stripe.Customer).invoice_settings?.default_payment_method
    ) {
      // set the first payment method as default.
      if (paymentMethods.length > 0 && paymentMethods[0]?.id) {
        await this.setDefaultPaymentMethod(customerId, paymentMethods[0]?.id);
      }
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

  @CaptureSpan()
  public async cancelSubscription(subscriptionId: string): Promise<void> {
    if (!this.isBillingEnabled()) {
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }
    try {
      await this.stripe.subscriptions.del(subscriptionId);
    } catch (err) {
      logger.error(err);
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
    recipientEmail?: Email,
    projectId?: ObjectID,
  ): Promise<void> {
    logger.debug(`[Invoice Email] sendInvoiceByEmail called for invoice: ${invoiceId}, recipientEmail: ${recipientEmail?.toString()}`);

    if (!this.isBillingEnabled()) {
      logger.debug(`[Invoice Email] Billing not enabled, skipping send for invoice: ${invoiceId}`);
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }

    try {
      // Fetch invoice details from Stripe
      logger.debug(`[Invoice Email] Fetching invoice ${invoiceId} details from Stripe`);
      const stripeInvoice = await this.stripe.invoices.retrieve(invoiceId);

      if (!stripeInvoice) {
        logger.error(`[Invoice Email] Invoice ${invoiceId} not found in Stripe`);
        return;
      }

      // Determine recipient email
      let toEmail: Email | undefined = recipientEmail;
      if (!toEmail && stripeInvoice.customer_email) {
        toEmail = new Email(stripeInvoice.customer_email);
      }

      if (!toEmail) {
        logger.error(`[Invoice Email] No recipient email found for invoice ${invoiceId}`);
        return;
      }

      // Format invoice data for email
      const invoiceNumber = stripeInvoice.number || invoiceId;
      const invoiceDate = stripeInvoice.created
        ? OneUptimeDate.getDateAsFormattedString(new Date(stripeInvoice.created * 1000))
        : OneUptimeDate.getDateAsFormattedString(OneUptimeDate.getCurrentDate());
      const amount = `${(stripeInvoice.amount_due / 100).toFixed(2)} ${stripeInvoice.currency?.toUpperCase() || 'USD'}`;
      const invoicePdfUrl = stripeInvoice.invoice_pdf || undefined;
      const description = stripeInvoice.description || undefined;

      // Build dashboard link
      let dashboardLink: string | undefined = undefined;
      if (projectId && DashboardClientUrl) {
        dashboardLink = `${DashboardClientUrl.toString()}/dashboard/${projectId.toString()}/settings/billing`;
      }

      logger.debug(`[Invoice Email] Sending invoice email to ${toEmail.toString()} - Invoice #${invoiceNumber}, Amount: ${amount}`);

      // Send email via OneUptime MailService
      await MailService.sendMail(
        {
          toEmail: toEmail,
          templateType: EmailTemplateType.Invoice,
          vars: {
            invoiceNumber: invoiceNumber,
            invoiceDate: invoiceDate,
            amount: amount,
            description: description || '',
            invoicePdfUrl: invoicePdfUrl || '',
            dashboardLink: dashboardLink || '',
          },
          subject: `Invoice #${invoiceNumber} from OneUptime`,
        },
        {
          projectId: projectId,
        },
      );

      logger.debug(`[Invoice Email] Successfully sent invoice ${invoiceId} email to ${toEmail.toString()}`);
    } catch (err) {
      logger.error(`[Invoice Email] Failed to send invoice ${invoiceId} by email: ${err}`);
      // Don't throw - sending email is not critical
    }
  }

  @CaptureSpan()
  public async shouldSendInvoicesByEmail(customerId: string): Promise<boolean> {
    logger.debug(`[Invoice Email] shouldSendInvoicesByEmail called for customer: ${customerId}`);

    if (!this.isBillingEnabled()) {
      logger.debug(`[Invoice Email] Billing not enabled, returning false for customer: ${customerId}`);
      return false;
    }

    try {
      logger.debug(`[Invoice Email] Retrieving customer ${customerId} from Stripe to check preference`);
      const customer: Stripe.Response<Stripe.Customer | Stripe.DeletedCustomer> =
        await this.stripe.customers.retrieve(customerId);

      if (!customer || customer.deleted) {
        logger.debug(`[Invoice Email] Customer ${customerId} not found or deleted, returning false`);
        return false;
      }

      const metadata = (customer as Stripe.Customer).metadata;
      const sendInvoicesByEmail = metadata?.["send_invoices_by_email"] === "true";
      logger.debug(`[Invoice Email] Customer ${customerId} metadata.send_invoices_by_email = "${metadata?.["send_invoices_by_email"]}", result: ${sendInvoicesByEmail}`);
      return sendInvoicesByEmail;
    } catch (err) {
      logger.error(`[Invoice Email] Failed to check invoice email preference for customer ${customerId}: ${err}`);
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
      recipientEmail?: Email | undefined;
      projectId?: ObjectID | undefined;
    },
  ): Promise<void> {
    const sendInvoiceByEmail = options?.sendInvoiceByEmail || false;
    const recipientEmail = options?.recipientEmail;
    const projectId = options?.projectId;

    logger.debug(`[Invoice Email] generateInvoiceAndChargeCustomer called - customer: ${customerId}, amount: $${amountInUsd}, sendInvoiceByEmail: ${sendInvoiceByEmail}, recipientEmail: ${recipientEmail?.toString()}, projectId: ${projectId?.toString()}`);

    const invoice: Stripe.Invoice = await this.stripe.invoices.create({
      customer: customerId,
      auto_advance: true, // do not automatically charge.
      collection_method: "charge_automatically",
    });

    if (!invoice || !invoice.id) {
      logger.error(`[Invoice Email] Failed to create invoice for customer ${customerId}`);
      throw new APIException(Errors.BillingService.INVOICE_NOT_GENERATED);
    }

    logger.debug(`[Invoice Email] Created invoice ${invoice.id} for customer ${customerId}`);

    await this.stripe.invoiceItems.create({
      invoice: invoice.id,
      amount: amountInUsd * 100,
      description: itemText,
      customer: customerId,
    });

    logger.debug(`[Invoice Email] Added invoice item to invoice ${invoice.id}: ${itemText}, $${amountInUsd}`);

    await this.stripe.invoices.finalizeInvoice(invoice.id!);
    logger.debug(`[Invoice Email] Finalized invoice ${invoice.id}`);

    try {
      await this.payInvoice(customerId, invoice.id!);
      logger.debug(`[Invoice Email] Paid invoice ${invoice.id}`);

      // Send invoice by email if requested
      if (sendInvoiceByEmail) {
        logger.debug(`[Invoice Email] sendInvoiceByEmail is true, sending invoice ${invoice.id} by email`);
        await this.sendInvoiceByEmail(invoice.id!, recipientEmail, projectId);
      } else {
        logger.debug(`[Invoice Email] sendInvoiceByEmail is false, skipping email for invoice ${invoice.id}`);
      }
    } catch (err) {
      logger.error(`[Invoice Email] Failed to pay invoice ${invoice.id}, voiding: ${err}`);
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

    const invoice: Stripe.Invoice = await this.stripe.invoices.pay(invoiceId, {
      payment_method: paymentMethods[0]?.id || "",
    });

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

    throw new BadDataException(
      "Plan with productType " + productType + " not found",
    );
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

    logger.debug(`[Invoice Email] Verifying webhook signature with secret (length: ${BillingWebhookSecret.length})`);
    const event = this.stripe.webhooks.constructEvent(
      payload,
      signature,
      BillingWebhookSecret,
    );
    logger.debug(`[Invoice Email] Webhook signature verified, event type: ${event.type}, event id: ${event.id}`);
    return event;
  }

  @CaptureSpan()
  public async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    logger.debug(`[Invoice Email] handleWebhookEvent called - event type: ${event.type}, event id: ${event.id}`);

    if (!this.isBillingEnabled()) {
      logger.debug(`[Invoice Email] Billing not enabled, ignoring webhook event ${event.id}`);
      return;
    }

    // Handle invoice.finalized event to send invoice by email if customer has opted in
    if (event.type === "invoice.finalized") {
      logger.debug(`[Invoice Email] Processing invoice.finalized event ${event.id}`);
      const invoice = event.data.object as Stripe.Invoice;

      logger.debug(`[Invoice Email] Invoice details - id: ${invoice.id}, number: ${invoice.number}, customer: ${invoice.customer}, status: ${invoice.status}`);

      if (!invoice.customer) {
        logger.debug(`[Invoice Email] No customer on invoice ${invoice.id}, skipping`);
        return;
      }

      const customerId = typeof invoice.customer === "string"
        ? invoice.customer
        : invoice.customer.id;

      logger.debug(`[Invoice Email] Extracted customer ID: ${customerId} from invoice ${invoice.id}`);

      try {
        logger.debug(`[Invoice Email] Checking if customer ${customerId} has invoice emails enabled`);
        const shouldSend = await this.shouldSendInvoicesByEmail(customerId);

        if (shouldSend && invoice.id) {
          logger.debug(`[Invoice Email] Customer ${customerId} has invoice emails enabled, looking up project`);

          // Lazy import to avoid circular dependency
          const { default: ProjectService } = await import("./ProjectService");

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

          let recipientEmail: Email | undefined = undefined;
          let projectId: ObjectID | undefined = undefined;

          if (project) {
            projectId = project.id || undefined;
            if (project.financeAccountingEmail) {
              recipientEmail = new Email(project.financeAccountingEmail);
            }
            logger.debug(`[Invoice Email] Found project ${projectId?.toString()}, financeAccountingEmail: ${recipientEmail?.toString()}`);
          } else {
            logger.debug(`[Invoice Email] No project found for customer ${customerId}, will use Stripe customer email`);
          }

          logger.debug(`[Invoice Email] Sending invoice ${invoice.id} by email`);
          await this.sendInvoiceByEmail(invoice.id, recipientEmail, projectId);
          logger.debug(`[Invoice Email] Successfully processed invoice.finalized - sent invoice ${invoice.id} by email`);
        } else {
          logger.debug(`[Invoice Email] Customer ${customerId} has invoice emails disabled (shouldSend: ${shouldSend}), skipping email for invoice ${invoice.id}`);
        }
      } catch (err) {
        logger.error(`[Invoice Email] Failed to send invoice by email for invoice ${invoice.id}: ${err}`);
        // Don't throw - webhook should still return success
      }
    } else {
      logger.debug(`[Invoice Email] Ignoring event type ${event.type}, not invoice.finalized`);
    }
  }
}

export default new BillingService();
