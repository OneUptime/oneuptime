/*
 * Stripe's types only: nothing in core loads the stripe package. The
 * implementation that calls Stripe is OneUptime Cloud's and lives in the
 * enterprise module (ee/Server/Billing).
 */
import type Stripe from "stripe";
import type { LiveUsageAuthorization } from "../../Services/PayAsYouGoBillingService";
import type ServerMeteredPlan from "./MeteredPlan/ServerMeteredPlan";
import type SubscriptionPlan from "../../../Types/Billing/SubscriptionPlan";
import type SubscriptionStatus from "../../../Types/Billing/SubscriptionStatus";
import type Dictionary from "../../../Types/Dictionary";
import type Email from "../../../Types/Email";
import type ObjectID from "../../../Types/ObjectID";

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

export interface PaymentIntentState {
  id: string;
  status: Stripe.PaymentIntent.Status;
  clientSecret: string | undefined;
  paymentMethodId: string | undefined;
  lastPaymentErrorMessage: string | undefined;
}

/*
 * Stripe rejects a trial_end more than two years past the billing cycle
 * anchor. Enforce the same ceiling here so an admin gets a readable error
 * instead of a raw payment-provider failure.
 */
export const MAX_TRIAL_LENGTH_IN_DAYS: number = 730;

/*
 * The payment provider OneUptime Cloud bills cards through: Stripe, in the
 * enterprise module. Core never talks to it directly. BillingService (core)
 * keeps the public methods every caller uses and hands each call to the
 * provider the enterprise module registers
 * (EnterpriseServerModule.getBillingProvider); without one - the Community
 * Edition, or billing off - BillingService answers as a server without
 * billing does and never reaches a payment provider.
 *
 * The methods mirror BillingService's methods that reach the payment
 * provider, one for one, with the same signatures and the same meaning.
 */
export default interface BillingProvider {
  // Returns the billing id of the customer.
  createCustomer(data: {
    name: string;
    id: ObjectID;
    email: Email;
  }): Promise<string>;

  updateCustomerName(id: string, newName: string): Promise<void>;

  updateCustomerBusinessDetails(
    id: string,
    businessDetails: string,
    countryCode?: string | null,
    financeAccountingEmail?: string | null,
    sendInvoicesByEmail?: boolean | null,
  ): Promise<void>;

  deleteCustomer(id: string): Promise<void>;

  subscribeToMeteredPlan(data: {
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
  }>;

  generateCouponCode(data: {
    name: string;
    metadata?: Dictionary<string> | undefined;
    percentOff: number;
    durationInMonths: number;
    maxRedemptions: number;
  }): Promise<string>;

  subscribeToPlan(data: {
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
  }>;

  changeQuantity(subscriptionId: string, quantity: number): Promise<void>;

  addOrUpdateMeteredPricingOnSubscription(
    subscriptionId: string,
    serverMeteredPlan: ServerMeteredPlan,
    quantity: number,
    options?: {
      liveAuthorization?: LiveUsageAuthorization | undefined;
    },
  ): Promise<void>;

  isPromoCodeValid(promoCode: string): Promise<boolean>;

  removeSubscriptionItem(
    subscriptionId: string,
    subscriptionItemId: string,
    isMeteredSubscriptionItem: boolean,
  ): Promise<void>;

  getSubscriptionItems(
    subscriptionId: string,
  ): Promise<Array<SubscriptionItem>>;

  changePlan(data: {
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
  }>;

  deletePaymentMethod(
    customerId: string,
    paymentMethodId: string,
  ): Promise<void>;

  makePaymentMethodDefault(
    customerId: string,
    paymentMethodId: string,
  ): Promise<void>;

  hasPaymentMethods(customerId: string): Promise<boolean>;

  getMeteredBillingStartDate(customerId: string): Promise<Date>;

  setDefaultPaymentMethod(
    customerId: string,
    paymentMethodId: string,
  ): Promise<void>;

  syncSubscriptionPaymentMethodsWithCustomerDefault(
    customerId: string,
  ): Promise<Array<string>>;

  getPaymentMethods(customerId: string): Promise<Array<PaymentMethod>>;

  getSetupIntentSecret(customerId: string): Promise<string>;

  getCustomerBalance(customerId: string): Promise<number>;

  cancelSubscription(subscriptionId: string): Promise<void>;

  cancelSubscriptionWithFinalInvoice(subscriptionId: string): Promise<void>;

  extendTrial(data: {
    subscriptionId: string;
    meteredSubscriptionId?: string | undefined;
    trialEndsAt: Date;
  }): Promise<void>;

  getSubscriptionStatus(subscriptionId: string): Promise<SubscriptionStatus>;

  getSubscription(subscriptionId: string): Promise<Stripe.Subscription>;

  getInvoice(customerId: string, invoiceId: string): Promise<Invoice>;

  getPaymentIntentClientSecret(paymentIntentId: string): Promise<string>;

  getPaymentIntent(paymentIntentId: string): Promise<PaymentIntentState>;

  getPaymentIntentIdFromInvoice(invoiceId: string): Promise<string>;

  getInvoices(customerId: string): Promise<Array<Invoice>>;

  sendInvoiceByEmail(
    invoiceId: string,
    recipientEmails?: Array<Email>,
    projectId?: ObjectID,
  ): Promise<void>;

  shouldSendInvoicesByEmail(customerId: string): Promise<boolean>;

  generateInvoiceAndChargeCustomer(
    customerId: string,
    itemText: string,
    amountInUsd: number,
    options?: {
      sendInvoiceByEmail?: boolean | undefined;
      recipientEmails?: Array<Email> | undefined;
      projectId?: ObjectID | undefined;
    },
  ): Promise<void>;

  voidInvoice(invoiceId: string): Promise<Stripe.Invoice>;

  payInvoice(
    customerId: string,
    invoiceId: string,
    options?: { canSurfaceAuthenticationPrompt?: boolean | undefined },
  ): Promise<Invoice>;

  verifyWebhookSignature(
    payload: string | Buffer,
    signature: string,
  ): Stripe.Event;

  handleWebhookEvent(event: Stripe.Event): Promise<void>;
}
