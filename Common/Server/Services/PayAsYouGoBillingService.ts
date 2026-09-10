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

type NotAuthorized = "none";
const NOT_AUTHORIZED: NotAuthorized = "none";

/*
 * A denial is the expensive answer. An authorized project answers from the
 * positive cache and costs one provider read a minute; an unauthorized one
 * re-ran the full check every time, and that check costs a payment-method
 * read per supported type. On the telemetry admission path - which runs for
 * every ingested batch over OTLP, gRPC, MQTT and session replay, and which
 * deliberately re-checks even on a key-cache hit - that is a provider read
 * storm proportional to ingest traffic, for exactly the projects that are not
 * paying. It is enough on its own to hold a Stripe account at its rate limit
 * indefinitely, which then breaks the billing page for every other project.
 *
 * So denials are cacheable, but only where a few seconds of staleness is
 * harmless: admission control, which the client retries anyway. Every
 * user-facing check - the billing page's own gate, creating a monitor -
 * still reads through, so "add a card and it works" keeps meaning that.
 */
const DENIAL_CACHE_TTL_IN_MS: number = 10_000;
const AUTHORIZATION_CACHE_TTL_IN_MS: number = 60_000;

export class Service {
  private authorizedProjects: InMemoryTTLCache<
    PaymentAuthorization | NotAuthorized
  > = new InMemoryTTLCache(10_000);

  /**
   * A subscription created during signup is not permission to incur charges.
   * Require a payment method, or a real invoice/reseller billing agreement.
   * Short positive caching keeps the telemetry admission path affordable.
   *
   * `allowStaleDenial` additionally lets a recent denial answer without going
   * back to the provider. Only admission control should pass it - see
   * DENIAL_CACHE_TTL_IN_MS above.
   */
  public async canUsePayAsYouGo(
    projectId: ObjectID,
    options?: { useCache?: boolean; allowStaleDenial?: boolean },
  ): Promise<boolean> {
    if (!BillingService.isBillingEnabled()) {
      return true;
    }

    const cacheKey: string = projectId.toString();
    if (options?.useCache !== false) {
      const cached: PaymentAuthorization | NotAuthorized | undefined =
        this.authorizedProjects.get(cacheKey);

      if (cached && cached !== NOT_AUTHORIZED) {
        return true;
      }

      if (cached === NOT_AUTHORIZED && options?.allowStaleDenial) {
        return false;
      }
    }

    const authorization: PaymentAuthorization | null =
      await this.checkPaymentAuthorization(projectId);
    if (authorization) {
      this.authorizedProjects.set(
        cacheKey,
        authorization,
        AUTHORIZATION_CACHE_TTL_IN_MS,
      );
    } else {
      this.authorizedProjects.set(
        cacheKey,
        NOT_AUTHORIZED,
        DENIAL_CACHE_TTL_IN_MS,
      );
    }
    return Boolean(authorization);
  }

  /**
   * Forget everything cached about a project's authorization. Called when the
   * payment methods on file are re-read and when one is removed, so a card
   * added a moment ago is honoured on the next admission check rather than at
   * the end of the denial TTL.
   */
  public invalidate(projectId: ObjectID): void {
    this.authorizedProjects.delete(projectId.toString());
  }

  public async requirePayAsYouGo(
    projectId: ObjectID,
    options?: { allowStaleDenial?: boolean },
  ): Promise<void> {
    if (!(await this.canUsePayAsYouGo(projectId, options))) {
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

    const authorization: PaymentAuthorization | NotAuthorized | undefined =
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

    /*
     * Daily aggregates cannot separate pre-card and post-card usage. Forgive
     * the partial authorization day and begin with the next complete UTC day.
     */
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
      /*
       * The redeemed license is bound to the project and reseller. Its
       * original plan can differ after an authenticated reseller tier change.
       */
      const redeemedLicense: PromoCode | null =
        await PromoCodeService.findOneBy({
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
