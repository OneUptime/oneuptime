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
 * read per supported type, plus - on a paid plan - the subscription read that
 * rules out an invoice agreement. On the telemetry admission path - which
 * runs for every ingested batch over OTLP, gRPC, MQTT and session replay, and
 * which deliberately re-checks even on a key-cache hit - that is a provider
 * read storm proportional to ingest traffic, for exactly the projects that
 * are not paying. It is enough on its own to hold a Stripe account at its
 * rate limit indefinitely, which then breaks the billing page for every other
 * project.
 *
 * So denials are cacheable, but only where a few seconds of staleness is
 * harmless: admission control, which the client retries anyway. Every
 * user-facing check - the billing page's own gate, creating a monitor -
 * still reads through, so "add a card and it works" keeps meaning that.
 */
const DENIAL_CACHE_TTL_IN_MS: number = 10_000;
const AUTHORIZATION_CACHE_TTL_IN_MS: number = 60_000;

/*
 * How long a live authorization from authorizeUsageNow may stand in for the
 * next live check of the same project. One metered report used to read the
 * owner's payment setup three times in as many seconds - to decide, again
 * while staging, and again before the usage write - and every one of those
 * reads repeated the provider calls the first had just made.
 *
 * Equal to AUTHORIZATION_CACHE_TTL_IN_MS on purpose: it is never looser than
 * the positive cache every other caller already accepts. Nothing stores a
 * token, so it lives only as long as the report that asked for it.
 */
const LIVE_AUTHORIZATION_REUSE_WINDOW_IN_MS: number =
  AUTHORIZATION_CACHE_TTL_IN_MS;

declare const liveUsageAuthorizationBrand: unique symbol;

/**
 * Proof that a project's payment setup was read live a moment ago. Only
 * authorizeUsageNow mints one: the brand is not exported and has no runtime
 * value, so any other way of making one is a visible cast. It is honoured
 * only for the project it names, and only inside
 * LIVE_AUTHORIZATION_REUSE_WINDOW_IN_MS.
 */
export interface LiveUsageAuthorization {
  readonly projectId: string;
  readonly decidedAt: number;
  readonly [liveUsageAuthorizationBrand]: true;
}

export class Service {
  private authorizedProjects: InMemoryTTLCache<
    PaymentAuthorization | NotAuthorized
  > = new InMemoryTTLCache(10_000);

  /*
   * Whether a project bills under an agreement that already covers its earlier
   * telemetry, and so takes no cutoff. Kept apart from authorizedProjects,
   * which records only what authorized the project first - and for an invoice
   * customer who also keeps a card on file, that is the card.
   */
  private noCutoffAgreements: InMemoryTTLCache<boolean> = new InMemoryTTLCache(
    10_000,
  );

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
   * A live check of the project's payment setup, as a token the rest of one
   * metered report hands on instead of repeating the check - see
   * LIVE_AUTHORIZATION_REUSE_WINDOW_IN_MS. Null when the project may not
   * incur usage charges. A provider failure propagates like any other live
   * check: it becomes neither a token nor a denial.
   */
  public async authorizeUsageNow(
    projectId: ObjectID,
  ): Promise<LiveUsageAuthorization | null> {
    // Stamped before the read, so a token never outlives the answer it carries.
    const decidedAt: number = Date.now();

    if (!(await this.canUsePayAsYouGo(projectId, { useCache: false }))) {
      return null;
    }

    return {
      projectId: projectId.toString(),
      decidedAt: decidedAt,
    } as LiveUsageAuthorization;
  }

  /**
   * Whether a token from authorizeUsageNow still vouches for this project.
   * No token, another project's token, or one past the reuse window is not an
   * answer at all, and the caller has to check live.
   */
  public isLiveAuthorizationFor(
    authorization: LiveUsageAuthorization | undefined,
    projectId: ObjectID,
  ): boolean {
    if (!authorization || authorization.projectId !== projectId.toString()) {
      return false;
    }

    const ageInMs: number = Date.now() - authorization.decidedAt;

    return ageInMs >= 0 && ageInMs <= LIVE_AUTHORIZATION_REUSE_WINDOW_IN_MS;
  }

  /**
   * Forget everything cached about a project's authorization and billing
   * agreement. Called when the payment methods on file are re-read and when
   * one is removed, so a card added a moment ago is honoured on the next
   * admission check rather than at the end of the denial TTL.
   */
  public invalidate(projectId: ObjectID): void {
    this.authorizedProjects.delete(projectId.toString());
    this.noCutoffAgreements.delete(projectId.toString());
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

    /*
     * "payment-method" is not the whole answer. The card is checked before the
     * invoice agreement, so an invoice customer who also keeps a card on file
     * is authorized by the card - and a cutoff stamped for them would waive
     * telemetry their contract already bills. Ask about the agreement itself
     * before any marker is written.
     */
    if (await this.hasNoCutoffAgreement(projectId)) {
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
    options?: { liveAuthorization?: LiveUsageAuthorization | undefined },
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
    if (!project?.id) {
      throw new PaymentRequiredException(
        PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE,
      );
    }

    /*
     * The owner comes from the subscription's own customer, never from the
     * caller, so a token only spares the read when it was made for the
     * project this usage is about to be charged to.
     */
    if (this.isLiveAuthorizationFor(options?.liveAuthorization, project.id)) {
      return;
    }

    if (!(await this.canUsePayAsYouGo(project.id, { useCache: false }))) {
      throw new PaymentRequiredException(
        PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE,
      );
    }
  }

  private async checkPaymentAuthorization(
    projectId: ObjectID,
  ): Promise<PaymentAuthorization | null> {
    const project: Project | null = await this.findBillingSetup(projectId);

    if (!project) {
      return null;
    }

    if (await this.hasResellerAgreement(projectId, project)) {
      return "reseller";
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

    /*
     * Card first, and a card holder's subscription is never read. Stripe
     * rate-limits GET /v1/subscriptions/:id on its own, apart from the
     * account-wide limit, and this check sits on synchronous paths - creating
     * a monitor, the billing page's gate, every metered report. Reading the
     * subscription first put that endpoint in front of every answer, three or
     * four times per monitor create, and held it at its limit. Only a project
     * with no card needs the subscription: it is what tells an invoice
     * agreement apart from no agreement at all.
     */
    if (
      await BillingService.hasPaymentMethods(project.paymentProviderCustomerId)
    ) {
      return "payment-method";
    }

    return (await this.hasInvoiceAgreement(project)) ? "invoice" : null;
  }

  /*
   * Cached per project because a telemetry billing pass asks for every product
   * type, twice each, seconds apart - one subscription read a pass rather than
   * fourteen. A failure is never cached and never read as "no agreement": that
   * answer stamps a cutoff, and a cutoff waives usage.
   */
  private async hasNoCutoffAgreement(projectId: ObjectID): Promise<boolean> {
    const cacheKey: string = projectId.toString();
    const cached: boolean | undefined = this.noCutoffAgreements.get(cacheKey);

    if (cached !== undefined) {
      return cached;
    }

    const project: Project | null = await this.findBillingSetup(projectId);

    const hasAgreement: boolean = project
      ? (await this.hasResellerAgreement(projectId, project)) ||
        (await this.hasInvoiceAgreement(project))
      : false;

    this.noCutoffAgreements.set(
      cacheKey,
      hasAgreement,
      AUTHORIZATION_CACHE_TTL_IN_MS,
    );

    return hasAgreement;
  }

  private async findBillingSetup(projectId: ObjectID): Promise<Project | null> {
    return await ProjectService.findOneById({
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
  }

  private async hasResellerAgreement(
    projectId: ObjectID,
    project: Project,
  ): Promise<boolean> {
    if (!project.resellerId || !project.resellerPlanId) {
      return false;
    }

    /*
     * The redeemed license is bound to the project and reseller. Its
     * original plan can differ after an authenticated reseller tier change.
     */
    const redeemedLicense: PromoCode | null = await PromoCodeService.findOneBy({
      query: {
        projectId: projectId,
        resellerId: project.resellerId,
        isPromoCodeUsed: true,
      },
      select: { _id: true },
      props: { isRoot: true, ignoreHooks: true },
    });

    return Boolean(redeemedLicense);
  }

  /*
   * A paid plan whose own subscription, billed to this project's own customer,
   * is active and collected by invoice. The single definition behind both the
   * "invoice" authorization and the telemetry cutoff exemption.
   */
  private async hasInvoiceAgreement(project: Project): Promise<boolean> {
    if (
      !project.paymentProviderPlanId ||
      !project.paymentProviderCustomerId ||
      !project.paymentProviderSubscriptionId
    ) {
      return false;
    }

    const plan: SubscriptionPlan | undefined =
      SubscriptionPlan.getSubscriptionPlanById(
        project.paymentProviderPlanId,
        getAllEnvVars(),
      );

    if (!plan || plan.getName() === PlanType.Free) {
      return false;
    }

    const subscription: Stripe.Subscription =
      await BillingService.getSubscription(
        project.paymentProviderSubscriptionId,
      );
    const customerId: string =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id;

    return (
      customerId === project.paymentProviderCustomerId &&
      subscription.collection_method === "send_invoice" &&
      subscription.status === "active"
    );
  }
}

export default new Service();
