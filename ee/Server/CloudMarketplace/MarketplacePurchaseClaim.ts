import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import SubscriptionStatus from "Common/Types/Billing/SubscriptionStatus";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { CloudMarketplaceUtil } from "Common/Types/Marketplace/CloudMarketplace";
import {
  MarketplacePurchaseDetails,
  MarketplacePurchasePlan,
  MarketplacePurchaseProject,
  MarketplacePurchaseProjectRefusal,
} from "Common/Types/Marketplace/MarketplacePurchase";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
} from "Common/Types/Permission";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import { getAllEnvVars } from "Common/Server/EnvironmentConfig";
import Semaphore, {
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import MarketplaceSubscriptionService from "Common/Server/Services/MarketplaceSubscriptionService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserService from "Common/Server/Services/UserService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import CallerPermission from "Common/Server/Utils/Permission/CallerPermission";
import logger from "Common/Server/Utils/Logger";
import MarketplaceAdapter, {
  MarketplaceActivationError,
  MarketplaceStatus,
} from "./MarketplaceAdapter";
import MarketplaceAdapters from "./MarketplaceAdapters";
import MarketplaceApiError from "./MarketplaceApiError";
import MarketplacePurchases from "./MarketplacePurchases";

/*
 * Setting up a marketplace purchase in OneUptime: the purchase page
 * (/accounts/marketplace) asks what the buyer can link it to
 * (getDetails), and the buyer links it to one of their projects or a new one
 * (complete).
 *
 * Who may link a purchase to an existing project is who may change how the
 * project is billed anywhere else: its owners and the people who manage its
 * billing (Permission.ManageProjectBilling) - the same rule as Change Plan. A
 * project already billed by a marketplace, or bought from a reseller, is
 * listed but cannot be picked.
 *
 * The marketplace is asked first: completing a purchase activates it there
 * (which, on Microsoft Marketplace, is when billing starts), and only once
 * the marketplace has it active is a project created or moved over. A
 * refusal from the marketplace is shown to the buyer in its own words.
 */

const MAX_PROJECT_NAME_LENGTH: number = 100;
const COMPLETE_LOCK_NAMESPACE: string = "marketplace-purchase-complete";

export interface CompleteMarketplacePurchase {
  purchase: MarketplaceSubscription;
  userId: ObjectID;
  // Link an existing project...
  projectId?: ObjectID | undefined;
  // ...or create one.
  newProject?:
    | {
        name: string;
        planId: string;
      }
    | undefined;
}

export default class MarketplacePurchaseClaim {
  public static async getDetails(data: {
    purchase: MarketplaceSubscription;
    userId: ObjectID;
  }): Promise<MarketplacePurchaseDetails> {
    const user: User | null = await UserService.findOneById({
      id: data.userId,
      select: { email: true, isMasterAdmin: true },
      props: { isRoot: true },
    });

    if (!user) {
      throw new BadDataException("User not found.");
    }

    const projects: Array<MarketplacePurchaseProject> =
      await MarketplacePurchaseClaim.listProjects({
        userId: data.userId,
        purchase: data.purchase,
      });

    const linkedProjectId: string | null =
      data.purchase.projectId &&
      projects.some((project: MarketplacePurchaseProject): boolean => {
        return project.id === data.purchase.projectId!.toString();
      })
        ? data.purchase.projectId.toString()
        : null;

    return {
      marketplace: data.purchase.marketplace!,
      marketplaceName: CloudMarketplaceUtil.getDisplayName(
        data.purchase.marketplace!,
      ),
      status: data.purchase.status!,
      buyerId: data.purchase.externalCustomerId || null,
      buyerEmail: data.purchase.purchaserEmail || null,
      marketplacePlan: data.purchase.externalPlanId || null,
      isFreeTrial: Boolean(data.purchase.isFreeTrial),
      linkedProjectId: linkedProjectId,
      signedInEmail: user.email?.toString() || "",
      projects: projects,
      plans: MarketplacePurchaseClaim.getPlans(),
      canCreateProject:
        Boolean(user.isMasterAdmin) ||
        !(await DatabaseConfig.shouldDisableUserProjectCreation()),
    };
  }

  // The plans a new project can be created on: every plan with a list price.
  public static getPlans(): Array<MarketplacePurchasePlan> {
    return SubscriptionPlan.getSubscriptionPlans(getAllEnvVars())
      .filter((plan: SubscriptionPlan): boolean => {
        return !plan.isCustomPricing() && Boolean(plan.getMonthlyPlanId());
      })
      .map((plan: SubscriptionPlan): MarketplacePurchasePlan => {
        return {
          planId: plan.getMonthlyPlanId(),
          name: plan.getName(),
          monthlyPricePerUserInUSD: plan.getMonthlySubscriptionAmountInUSD(),
          isCustomPricing: false,
        };
      });
  }

  /*
   * Every project the buyer belongs to, each marked with whether this
   * purchase can pay for it and, if not, why - listed rather than hidden, so
   * a buyer who cannot find their project knows what to do about it.
   */
  public static async listProjects(data: {
    userId: ObjectID;
    purchase: MarketplaceSubscription;
  }): Promise<Array<MarketplacePurchaseProject>> {
    const globalPermission: UserGlobalAccessPermission | null =
      await AccessTokenService.getUserGlobalAccessPermission(data.userId);

    const projectIds: Array<ObjectID> = globalPermission?.projectIds || [];

    if (projectIds.length === 0) {
      return [];
    }

    const projects: Array<Project> = await ProjectService.findBy({
      query: {
        _id: QueryHelper.any(projectIds),
        isBlocked: false,
      },
      select: {
        _id: true,
        name: true,
        billingMarketplace: true,
        resellerId: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });

    const listed: Array<MarketplacePurchaseProject> = [];

    for (const project of projects) {
      if (!project.id) {
        continue;
      }

      const refusal: MarketplacePurchaseProjectRefusal | null =
        await MarketplacePurchaseClaim.getRefusal({
          userId: data.userId,
          project: project,
          purchase: data.purchase,
        });

      listed.push({
        id: project.id.toString(),
        name: project.name?.toString() || "",
        isEligible: !refusal,
        ...(refusal ? { refusal: refusal } : {}),
      });
    }

    return listed.sort(
      (
        a: MarketplacePurchaseProject,
        b: MarketplacePurchaseProject,
      ): number => {
        return a.name.localeCompare(b.name);
      },
    );
  }

  private static async getRefusal(data: {
    userId: ObjectID;
    project: Project;
    purchase: MarketplaceSubscription;
  }): Promise<MarketplacePurchaseProjectRefusal | null> {
    const isThisPurchasesProject: boolean = Boolean(
      data.purchase.projectId &&
        data.project.id?.toString() === data.purchase.projectId.toString(),
    );

    if (data.project.billingMarketplace && !isThisPurchasesProject) {
      return MarketplacePurchaseProjectRefusal.AlreadyBilledByMarketplace;
    }

    if (data.project.resellerId) {
      return MarketplacePurchaseProjectRefusal.BoughtFromReseller;
    }

    const props: DatabaseCommonInteractionProps =
      await AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject(
        { userId: data.userId, projectId: data.project.id! },
      );

    if (
      !CallerPermission.holdsAnyOf(
        props,
        [Permission.ProjectOwner, Permission.ManageProjectBilling],
        { projectId: data.project.id! },
      )
    ) {
      return MarketplacePurchaseProjectRefusal.NotBillingManager;
    }

    return null;
  }

  /*
   * Link the purchase. Returns the project it now pays for. Held under a
   * lock per purchase, so two tabs - or a double click - cannot activate it
   * twice or link it to two projects.
   */
  public static async complete(
    data: CompleteMarketplacePurchase,
  ): Promise<ObjectID> {
    const mutex: SemaphoreMutex = await Semaphore.lock({
      key: data.purchase.id!.toString(),
      namespace: COMPLETE_LOCK_NAMESPACE,
      lockTimeout: 60_000,
      acquireTimeout: 30_000,
    });

    try {
      const purchase: MarketplaceSubscription | null =
        await MarketplaceSubscriptionService.findPurchaseById(
          data.purchase.id!,
        );

      if (!purchase) {
        throw new BadDataException("This purchase was not found.");
      }

      // Already set up: the same answer again, for the same buyer.
      if (purchase.projectId) {
        const projects: Array<MarketplacePurchaseProject> =
          await MarketplacePurchaseClaim.listProjects({
            userId: data.userId,
            purchase: purchase,
          });

        if (
          projects.some((project: MarketplacePurchaseProject): boolean => {
            return project.id === purchase.projectId!.toString();
          })
        ) {
          return purchase.projectId;
        }

        throw new BadDataException(
          "This purchase is already set up for a project you are not a member of. Ask that project's owner to invite you.",
        );
      }

      const planForNewProject: SubscriptionPlan | null =
        await MarketplacePurchaseClaim.validateChoice(data, purchase);

      const adapter: MarketplaceAdapter = MarketplaceAdapters.get(
        purchase.marketplace!,
      );

      if (!adapter.isConfigured()) {
        throw new BadDataException(
          `${CloudMarketplaceUtil.getDisplayName(purchase.marketplace!)} is not available on this server.`,
        );
      }

      let activation: MarketplaceStatus;

      try {
        activation = await adapter.activate(purchase);
      } catch (err) {
        if (err instanceof MarketplaceActivationError) {
          throw new BadDataException(err.message);
        }

        if (err instanceof MarketplaceApiError) {
          logger.error(err);
          throw new BadDataException(
            `We could not reach ${CloudMarketplaceUtil.getDisplayName(purchase.marketplace!)} to set up your purchase. Please try again in a minute.`,
          );
        }

        throw err;
      }

      const projectId: ObjectID = planForNewProject
        ? await MarketplacePurchaseClaim.createProject({
            userId: data.userId,
            name: data.newProject!.name.trim(),
            plan: planForNewProject,
            purchase: purchase,
          })
        : data.projectId!;

      await MarketplacePurchases.linkToProject({
        purchase: purchase,
        projectId: projectId,
        userId: data.userId,
        status: MarketplaceSubscriptionStatus.Active,
        // What the marketplace said while activating: plan, entitlement, usage reporting ID.
        facts: activation,
      });

      return projectId;
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        logger.error(err);
      }
    }
  }

  /*
   * The buyer's choice, checked before the marketplace is asked anything: an
   * existing project they may move over, or a new one with a valid name and
   * plan. Returns the plan when a project is to be created.
   */
  private static async validateChoice(
    data: CompleteMarketplacePurchase,
    purchase: MarketplaceSubscription,
  ): Promise<SubscriptionPlan | null> {
    if (data.projectId) {
      const projects: Array<MarketplacePurchaseProject> =
        await MarketplacePurchaseClaim.listProjects({
          userId: data.userId,
          purchase: purchase,
        });

      const chosen: MarketplacePurchaseProject | undefined = projects.find(
        (project: MarketplacePurchaseProject): boolean => {
          return project.id === data.projectId!.toString();
        },
      );

      if (!chosen) {
        throw new BadDataException("You are not a member of this project.");
      }

      if (!chosen.isEligible) {
        throw new BadDataException(
          MarketplacePurchaseClaim.describeRefusal(chosen.refusal),
        );
      }

      return null;
    }

    if (!data.newProject) {
      throw new BadDataException(
        "Choose a project for this purchase, or name a new one.",
      );
    }

    const name: string = (data.newProject.name || "").trim();

    if (!name) {
      throw new BadDataException("Enter a name for the new project.");
    }

    if (name.length > MAX_PROJECT_NAME_LENGTH) {
      throw new BadDataException(
        `A project name can be at most ${MAX_PROJECT_NAME_LENGTH} characters.`,
      );
    }

    const plan: SubscriptionPlan | undefined =
      SubscriptionPlan.getSubscriptionPlanById(
        data.newProject.planId,
        getAllEnvVars(),
      );

    if (!plan || plan.isCustomPricing()) {
      throw new BadDataException("Choose a plan for the new project.");
    }

    return plan;
  }

  public static describeRefusal(
    refusal: MarketplacePurchaseProjectRefusal | undefined,
  ): string {
    switch (refusal) {
      case MarketplacePurchaseProjectRefusal.AlreadyBilledByMarketplace:
        return "This project is already billed through a cloud marketplace purchase.";
      case MarketplacePurchaseProjectRefusal.BoughtFromReseller:
        return "This project was bought from a OneUptime reseller, which bills it.";
      case MarketplacePurchaseProjectRefusal.NotBillingManager:
      default:
        return "Only the project's owners, or people who manage its billing, can change how it is billed.";
    }
  }

  /*
   * A new project, created for the buyer as if they had created it
   * themselves - its owner, its default teams and states, the duplicate-name
   * check - but billed by the marketplace from the start: no card customer,
   * no card subscriptions, and the plan's trial on its per-user price. Also
   * how a Vercel resource gets its project (VercelMarketplaceProvider).
   */
  public static async createProject(data: {
    userId: ObjectID;
    name: string;
    plan: SubscriptionPlan;
    purchase: MarketplaceSubscription;
  }): Promise<ObjectID> {
    const project: Project = new Project();
    project.name = data.name;
    project.paymentProviderPlanId = data.plan.getMonthlyPlanId();
    project.billingMarketplace = data.purchase.marketplace!;
    project.paymentProviderSubscriptionStatus = SubscriptionStatus.Active;
    project.paymentProviderMeteredSubscriptionStatus =
      SubscriptionStatus.Active;

    if (data.plan.getTrialPeriod() > 0) {
      project.trialEndsAt = OneUptimeDate.addRemoveDays(
        OneUptimeDate.getCurrentDate(),
        data.plan.getTrialPeriod(),
      );
    }

    const globalPermission: UserGlobalAccessPermission | null =
      await AccessTokenService.getUserGlobalAccessPermission(data.userId);

    /*
     * Root, because the billing columns are OneUptime's to write and no
     * caller's; the creator is still the buyer (userId), which is who
     * onBeforeCreate checks may create projects here and makes the owner.
     */
    const created: Project = await ProjectService.create({
      data: project,
      props: {
        isRoot: true,
        userId: data.userId,
        ...(globalPermission
          ? { userGlobalAccessPermission: globalPermission }
          : {}),
      },
    });

    await AccessTokenService.refreshUserAllPermissions(data.userId);

    return created.id!;
  }
}
