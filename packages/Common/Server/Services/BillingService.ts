import { BillingPrivateKey, IsBillingEnabled } from "../EnvironmentConfig";
import EnterpriseEdition from "../Enterprise/EnterpriseEdition";
import type BillingProvider from "../Types/Billing/BillingProvider";
import type {
  Invoice,
  PaymentIntentState,
  PaymentMethod,
  SubscriptionItem,
} from "../Types/Billing/BillingProvider";
import type ServerMeteredPlan from "../Types/Billing/MeteredPlan/ServerMeteredPlan";
import Errors from "../Utils/Errors";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BaseService from "./BaseService";
import type { LiveUsageAuthorization } from "./PayAsYouGoBillingService";
import type SubscriptionPlan from "../../Types/Billing/SubscriptionPlan";
import SubscriptionStatus, {
  SubscriptionStatusUtil,
} from "../../Types/Billing/SubscriptionStatus";
import type Dictionary from "../../Types/Dictionary";
import type Email from "../../Types/Email";
import BadDataException from "../../Types/Exception/BadDataException";
import ProductType from "../../Types/MeteredPlan/ProductType";
import type ObjectID from "../../Types/ObjectID";
/*
 * Stripe's types only: the Stripe client is OneUptime Cloud's, in the
 * enterprise module (ee/Server/Billing/StripeBillingProvider.ts).
 */
import type Stripe from "stripe";

export type {
  Coupon,
  Invoice,
  PaymentIntentState,
  PaymentMethod,
  SubscriptionItem,
} from "../Types/Billing/BillingProvider";

export { MAX_TRIAL_LENGTH_IN_DAYS } from "../Types/Billing/BillingProvider";

/*
 * OneUptime Cloud's card billing, as every caller in core sees it.
 *
 * The payment provider (Stripe) is the enterprise module's: it registers it
 * with EnterpriseEdition (getBillingProvider), and each method below hands
 * its call to it. Without one - the Community Edition, or billing off - every
 * method answers as a server without billing does, and nothing ever reaches
 * a payment provider: what reads or changes a payment provider's records
 * throws BILLING_NOT_ENABLED, shouldSendInvoicesByEmail is false and
 * handleWebhookEvent ignores the event.
 *
 * isBillingEnabled, isSubscriptionActive, isTestEnvironment and the metered
 * price ids never reach the provider, so plan gating and the metered plans
 * work the same in every edition.
 */
export class BillingService extends BaseService {
  public constructor() {
    super();
  }

  @CaptureSpan()
  public async createCustomer(data: {
    name: string;
    id: ObjectID;
    email: Email;
  }): Promise<string> {
    return await this.getProviderOrThrow().createCustomer(data);
  }

  @CaptureSpan()
  public async updateCustomerName(id: string, newName: string): Promise<void> {
    await this.getProviderOrThrow().updateCustomerName(id, newName);
  }

  @CaptureSpan()
  public async updateCustomerBusinessDetails(
    id: string,
    businessDetails: string,
    countryCode?: string | null,
    financeAccountingEmail?: string | null,
    sendInvoicesByEmail?: boolean | null,
  ): Promise<void> {
    const provider: BillingProvider | null = this.getProvider();

    if (!provider) {
      logger.debug(
        `[Invoice Email] Billing not enabled, skipping updateCustomerBusinessDetails for customer ${id}`,
      );
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }

    await provider.updateCustomerBusinessDetails(
      id,
      businessDetails,
      countryCode,
      financeAccountingEmail,
      sendInvoicesByEmail,
    );
  }

  @CaptureSpan()
  public async deleteCustomer(id: string): Promise<void> {
    await this.getProviderOrThrow().deleteCustomer(id);
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

    /*
     * Pins the subscription to one card, ahead of the customer's default, for
     * as long as the subscription lives. Leave it out unless that is really
     * wanted - see changePlan for the autopay failure a pin caused.
     */
    defaultPaymentMethodId?: string | undefined;
    promoCode?: string | undefined;
    metadata?: Dictionary<string> | undefined;
  }): Promise<{
    meteredSubscriptionId: string;
    trialEndsAt: Date | null;
  }> {
    return await this.getProviderOrThrow().subscribeToMeteredPlan(data);
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
    return await this.getProviderOrThrow().generateCouponCode(data);
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

    // Pins both subscriptions to one card - see subscribeToMeteredPlan.
    defaultPaymentMethodId?: string | undefined;
    promoCode?: string | undefined;
  }): Promise<{
    subscriptionId: string;
    meteredSubscriptionId: string;
    trialEndsAt: Date | null;
  }> {
    return await this.getProviderOrThrow().subscribeToPlan(data);
  }

  @CaptureSpan()
  public async changeQuantity(
    subscriptionId: string,
    quantity: number,
  ): Promise<void> {
    await this.getProviderOrThrow().changeQuantity(subscriptionId, quantity);
  }

  @CaptureSpan()
  public async addOrUpdateMeteredPricingOnSubscription(
    subscriptionId: string,
    serverMeteredPlan: ServerMeteredPlan,
    quantity: number,
    options?: {
      /*
       * The live authorization the reporting plan made for this usage a
       * moment ago. requireMeteredSubscriptionPayment still ties it to the
       * project that owns this subscription's customer, and checks live
       * without one.
       */
      liveAuthorization?: LiveUsageAuthorization | undefined;
    },
  ): Promise<void> {
    await this.getProviderOrThrow().addOrUpdateMeteredPricingOnSubscription(
      subscriptionId,
      serverMeteredPlan,
      quantity,
      options,
    );
  }

  @CaptureSpan()
  public async isPromoCodeValid(promoCode: string): Promise<boolean> {
    return await this.getProviderOrThrow().isPromoCodeValid(promoCode);
  }

  @CaptureSpan()
  public async removeSubscriptionItem(
    subscriptionId: string,
    subscriptionItemId: string,
    isMeteredSubscriptionItem: boolean,
  ): Promise<void> {
    await this.getProviderOrThrow().removeSubscriptionItem(
      subscriptionId,
      subscriptionItemId,
      isMeteredSubscriptionItem,
    );
  }

  @CaptureSpan()
  public async getSubscriptionItems(
    subscriptionId: string,
  ): Promise<Array<SubscriptionItem>> {
    return await this.getProviderOrThrow().getSubscriptionItems(subscriptionId);
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
    const provider: BillingProvider | null = this.getProvider();

    if (!provider) {
      logger.debug(Errors.BillingService.BILLING_NOT_ENABLED);
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }

    return await provider.changePlan(data);
  }

  @CaptureSpan()
  public async deletePaymentMethod(
    customerId: string,
    paymentMethodId: string,
  ): Promise<void> {
    await this.getProviderOrThrow().deletePaymentMethod(
      customerId,
      paymentMethodId,
    );
  }

  /*
   * Makes a payment method the customer's default, and makes autopay use it
   * (the subscriptions are re-synced, and a failure to do that is reported).
   */
  @CaptureSpan()
  public async makePaymentMethodDefault(
    customerId: string,
    paymentMethodId: string,
  ): Promise<void> {
    await this.getProviderOrThrow().makePaymentMethodDefault(
      customerId,
      paymentMethodId,
    );
  }

  @CaptureSpan()
  public async hasPaymentMethods(customerId: string): Promise<boolean> {
    return await this.getProviderOrThrow().hasPaymentMethods(customerId);
  }

  /*
   * When the customer's pay-as-you-go usage started being billed: a durable
   * boundary set at the first authorized billing pass.
   */
  @CaptureSpan()
  public async getMeteredBillingStartDate(customerId: string): Promise<Date> {
    return await this.getProviderOrThrow().getMeteredBillingStartDate(
      customerId,
    );
  }

  @CaptureSpan()
  public async setDefaultPaymentMethod(
    customerId: string,
    paymentMethodId: string,
  ): Promise<void> {
    await this.getProviderOrThrow().setDefaultPaymentMethod(
      customerId,
      paymentMethodId,
    );
  }

  /*
   * Points every live subscription of the customer at the customer's default
   * payment method. Returns the ids of the subscriptions that were changed.
   */
  @CaptureSpan()
  public async syncSubscriptionPaymentMethodsWithCustomerDefault(
    customerId: string,
  ): Promise<Array<string>> {
    return await this.getProviderOrThrow().syncSubscriptionPaymentMethodsWithCustomerDefault(
      customerId,
    );
  }

  @CaptureSpan()
  public async getPaymentMethods(
    customerId: string,
  ): Promise<Array<PaymentMethod>> {
    return await this.getProviderOrThrow().getPaymentMethods(customerId);
  }

  @CaptureSpan()
  public async getSetupIntentSecret(customerId: string): Promise<string> {
    return await this.getProviderOrThrow().getSetupIntentSecret(customerId);
  }

  @CaptureSpan()
  public async getCustomerBalance(customerId: string): Promise<number> {
    return await this.getProviderOrThrow().getCustomerBalance(customerId);
  }

  /*
   * Cancels a subscription, and carries on if it could not be cancelled
   * (deleting a project: a failed cancel is a billing loose end to chase).
   */
  @CaptureSpan()
  public async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.getProviderOrThrow().cancelSubscription(subscriptionId);
  }

  /*
   * Ends a subscription now and settles it on one final invoice, when a
   * cloud marketplace takes over a project's billing.
   */
  @CaptureSpan()
  public async cancelSubscriptionWithFinalInvoice(
    subscriptionId: string,
  ): Promise<void> {
    await this.getProviderOrThrow().cancelSubscriptionWithFinalInvoice(
      subscriptionId,
    );
  }

  // Moves the trial end of a project's subscriptions to a new date.
  @CaptureSpan()
  public async extendTrial(data: {
    subscriptionId: string;
    meteredSubscriptionId?: string | undefined;
    trialEndsAt: Date;
  }): Promise<void> {
    await this.getProviderOrThrow().extendTrial(data);
  }

  @CaptureSpan()
  public async getSubscriptionStatus(
    subscriptionId: string,
  ): Promise<SubscriptionStatus> {
    return await this.getProviderOrThrow().getSubscriptionStatus(
      subscriptionId,
    );
  }

  @CaptureSpan()
  public async getSubscription(
    subscriptionId: string,
  ): Promise<Stripe.Subscription> {
    return await this.getProviderOrThrow().getSubscription(subscriptionId);
  }

  @CaptureSpan()
  public async getInvoice(
    customerId: string,
    invoiceId: string,
  ): Promise<Invoice> {
    return await this.getProviderOrThrow().getInvoice(customerId, invoiceId);
  }

  @CaptureSpan()
  public async getPaymentIntentClientSecret(
    paymentIntentId: string,
  ): Promise<string> {
    return await this.getProviderOrThrow().getPaymentIntentClientSecret(
      paymentIntentId,
    );
  }

  // What a PaymentIntent is doing right now.
  @CaptureSpan()
  public async getPaymentIntent(
    paymentIntentId: string,
  ): Promise<PaymentIntentState> {
    return await this.getProviderOrThrow().getPaymentIntent(paymentIntentId);
  }

  @CaptureSpan()
  public async getPaymentIntentIdFromInvoice(
    invoiceId: string,
  ): Promise<string> {
    return await this.getProviderOrThrow().getPaymentIntentIdFromInvoice(
      invoiceId,
    );
  }

  @CaptureSpan()
  public async getInvoices(customerId: string): Promise<Array<Invoice>> {
    return await this.getProviderOrThrow().getInvoices(customerId);
  }

  @CaptureSpan()
  public async sendInvoiceByEmail(
    invoiceId: string,
    recipientEmails?: Array<Email>,
    projectId?: ObjectID,
  ): Promise<void> {
    const provider: BillingProvider | null = this.getProvider();

    if (!provider) {
      logger.debug(
        `[Invoice Email] Billing not enabled, skipping send for invoice: ${invoiceId}`,
      );
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }

    await provider.sendInvoiceByEmail(invoiceId, recipientEmails, projectId);
  }

  @CaptureSpan()
  public async shouldSendInvoicesByEmail(customerId: string): Promise<boolean> {
    const provider: BillingProvider | null = this.getProvider();

    if (!provider) {
      logger.debug(
        `[Invoice Email] Billing not enabled, returning false for customer: ${customerId}`,
      );
      return false;
    }

    return await provider.shouldSendInvoicesByEmail(customerId);
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
    await this.getProviderOrThrow().generateInvoiceAndChargeCustomer(
      customerId,
      itemText,
      amountInUsd,
      options,
    );
  }

  @CaptureSpan()
  public async voidInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    return await this.getProviderOrThrow().voidInvoice(invoiceId);
  }

  /*
   * Pays an invoice, falling back to the customer's other cards when one is
   * declined. canSurfaceAuthenticationPrompt says whether the caller is able
   * to show the cardholder an authentication prompt - true for the
   * interactive /billing-invoices/pay route, false (the default) for the
   * unattended recharge paths.
   */
  @CaptureSpan()
  public async payInvoice(
    customerId: string,
    invoiceId: string,
    options?: { canSurfaceAuthenticationPrompt?: boolean | undefined },
  ): Promise<Invoice> {
    return await this.getProviderOrThrow().payInvoice(
      customerId,
      invoiceId,
      options,
    );
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

  // The Stripe event a webhook delivered, once its signature checks out.
  @CaptureSpan()
  public verifyWebhookSignature(
    payload: string | Buffer,
    signature: string,
  ): Stripe.Event {
    return this.getProviderOrThrow().verifyWebhookSignature(payload, signature);
  }

  @CaptureSpan()
  public async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    const provider: BillingProvider | null = this.getProvider();

    if (!provider) {
      logger.debug(
        `[Invoice Email] Billing not enabled, ignoring webhook event ${event.id}`,
      );
      return;
    }

    await provider.handleWebhookEvent(event);
  }

  /*
   * The payment provider this server bills through: the enterprise module's,
   * and only with billing on. Null otherwise - then nothing reaches a
   * payment provider.
   */
  private getProvider(): BillingProvider | null {
    if (!this.isBillingEnabled()) {
      return null;
    }

    return EnterpriseEdition.getBillingProvider();
  }

  // The payment provider, or BILLING_NOT_ENABLED as a server without billing answers.
  private getProviderOrThrow(): BillingProvider {
    const provider: BillingProvider | null = this.getProvider();

    if (!provider) {
      throw new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED);
    }

    return provider;
  }
}

export default new BillingService();
