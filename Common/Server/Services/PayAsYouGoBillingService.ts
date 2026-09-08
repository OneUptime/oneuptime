import Project from "../../Models/DatabaseModels/Project";
import PromoCode from "../../Models/DatabaseModels/PromoCode";
import SubscriptionPlan, {
  PlanType,
} from "../../Types/Billing/SubscriptionPlan";
import PaymentRequiredException from "../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../Types/ObjectID";
import { getAllEnvVars } from "../EnvironmentConfig";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import BillingService from "./BillingService";
import ProjectService from "./ProjectService";
import PromoCodeService from "./PromoCodeService";
import Stripe from "stripe";

export const PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE: string =
  "Add a payment method in Project Settings > Billing before using paid monitoring or telemetry. These features have usage charges even on the Free plan. Manual monitors remain free.";

type PaymentAuthorization = "payment-method" | "invoice" | "reseller";

export class Service {
  private authorizedProjects: InMemoryTTLCache<PaymentAuthorization> =
    new InMemoryTTLCache(10_000);

  /**
   * A subscription created during signup is not permission to incur charges.
   * Require a payment method, or a real invoice/reseller billing agreement.
   * Short positive caching keeps the telemetry admission path affordable;
   * rejected checks are never cached so adding a card works immediately.
   */
  public async canUsePayAsYouGo(
    projectId: ObjectID,
    options?: { useCache?: boolean },
  ): Promise<boolean> {
    if (!BillingService.isBillingEnabled()) {
      return true;
    }

    const cacheKey: string = projectId.toString();
    if (options?.useCache !== false && this.authorizedProjects.get(cacheKey)) {
      return true;
    }

    const authorization: PaymentAuthorization | null =
      await this.checkPaymentAuthorization(projectId);
    if (authorization) {
      this.authorizedProjects.set(cacheKey, authorization, 60_000);
    } else {
      this.authorizedProjects.delete(cacheKey);
    }
    return Boolean(authorization);
  }

  public async requirePayAsYouGo(projectId: ObjectID): Promise<void> {
    if (!(await this.canUsePayAsYouGo(projectId))) {
      throw new PaymentRequiredException(
        PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE,
      );
    }
  }

  public async getTelemetryBillingStartDate(
    projectId: ObjectID,
  ): Promise<Date | undefined> {
    await this.requirePayAsYouGo(projectId);
    if (!BillingService.isBillingEnabled()) {
      return undefined;
    }

    const authorization: PaymentAuthorization | undefined =
      this.authorizedProjects.get(projectId.toString());
    if (authorization === "invoice" || authorization === "reseller") {
      return undefined;
    }

    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        paymentProviderCustomerId: true,
      },
      props: { isRoot: true, ignoreHooks: true },
    });
    if (!project?.paymentProviderCustomerId) {
      throw new PaymentRequiredException(
        PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE,
      );
    }

    const authorizedAt: Date = await BillingService.getMeteredBillingStartDate(
      project.paymentProviderCustomerId,
    );

    // Daily aggregates cannot separate pre-card and post-card usage. Forgive
    // the partial authorization day and begin with the next complete UTC day.
    return new Date(
      Date.UTC(
        authorizedAt.getUTCFullYear(),
        authorizedAt.getUTCMonth(),
        authorizedAt.getUTCDate() + 1,
      ),
    );
  }

  public async requireMeteredSubscriptionPayment(
    subscription: Stripe.Subscription,
  ): Promise<void> {
    const customerId: string =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id;
    const project: Project | null = await ProjectService.findOneBy({
      query: { paymentProviderCustomerId: customerId },
      select: { _id: true },
      props: { isRoot: true, ignoreHooks: true },
    });
    if (
      !project?.id ||
      !(await this.canUsePayAsYouGo(project.id, { useCache: false }))
    ) {
      throw new PaymentRequiredException(
        PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE,
      );
    }
  }

  private async checkPaymentAuthorization(
    projectId: ObjectID,
  ): Promise<PaymentAuthorization | null> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        paymentProviderPlanId: true,
        paymentProviderCustomerId: true,
        paymentProviderSubscriptionId: true,
        resellerId: true,
        resellerPlanId: true,
      },
      props: { isRoot: true, ignoreHooks: true },
    });

    if (!project) {
      return null;
    }

    if (project.resellerId && project.resellerPlanId) {
      // The redeemed license is bound to the project and reseller. Its
      // original plan can differ after an authenticated reseller tier change.
      const redeemedLicense: PromoCode | null = await PromoCodeService.findOneBy({
        query: {
          projectId: projectId,
          resellerId: project.resellerId,
          isPromoCodeUsed: true,
        },
        select: { _id: true },
        props: { isRoot: true, ignoreHooks: true },
      });
      if (redeemedLicense) {
        return "reseller";
      }
    }

    if (!project.paymentProviderPlanId || !project.paymentProviderCustomerId) {
      return null;
    }

    const plan: SubscriptionPlan | undefined =
      SubscriptionPlan.getSubscriptionPlanById(
        project.paymentProviderPlanId,
        getAllEnvVars(),
      );

    if (!plan) {
      return null;
    }

    if (
      plan.getName() !== PlanType.Free &&
      project.paymentProviderSubscriptionId
    ) {
      const subscription: Stripe.Subscription =
        await BillingService.getSubscription(
          project.paymentProviderSubscriptionId,
        );
      const customerId: string =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;

      if (
        customerId === project.paymentProviderCustomerId &&
        subscription.collection_method === "send_invoice" &&
        subscription.status === "active"
      ) {
        return "invoice";
      }
    }

    return (await BillingService.hasPaymentMethods(
      project.paymentProviderCustomerId,
    ))
      ? "payment-method"
      : null;
  }
}

export default new Service();
