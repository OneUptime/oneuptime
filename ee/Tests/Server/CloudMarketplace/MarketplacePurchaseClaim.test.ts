import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import Project from "Common/Models/DatabaseModels/Project";
import BadDataException from "Common/Types/Exception/BadDataException";
import SubscriptionStatus from "Common/Types/Billing/SubscriptionStatus";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import {
  MarketplacePurchaseProject,
  MarketplacePurchaseProjectRefusal,
} from "Common/Types/Marketplace/MarketplacePurchase";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import MarketplaceSubscriptionService from "Common/Server/Services/MarketplaceSubscriptionService";
import MarketplacePurchases from "../../../Server/CloudMarketplace/MarketplacePurchases";
import ProjectService from "Common/Server/Services/ProjectService";
import UserService from "Common/Server/Services/UserService";
import MarketplaceAdapter, {
  MarketplaceActivationError,
} from "../../../Server/CloudMarketplace/MarketplaceAdapter";
import MarketplaceAdapters from "../../../Server/CloudMarketplace/MarketplaceAdapters";
import MarketplaceApiError from "../../../Server/CloudMarketplace/MarketplaceApiError";
import MarketplacePurchaseClaim from "../../../Server/CloudMarketplace/MarketplacePurchaseClaim";
import CallerPermission from "Common/Server/Utils/Permission/CallerPermission";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The purchase page: which of the buyer's projects a purchase may pay for,
 * and linking it. Who may move a project's billing to a marketplace is who
 * may change its billing anywhere else - its owners and billing managers -
 * and the marketplace must have the purchase active before any project is
 * created or moved.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...jest.requireActual("Common/Server/EnvironmentConfig"),
    getAllEnvVars: (): Record<string, string> => {
      return {
        SUBSCRIPTION_PLAN_FREE: "Free,free_monthly,free_yearly,0,0,1,0",
        SUBSCRIPTION_PLAN_GROWTH:
          "Growth,growth_monthly,growth_yearly,22,240,2,14",
        SUBSCRIPTION_PLAN_ENTERPRISE:
          "Enterprise,enterprise_monthly,enterprise_yearly,-1,-1,4,0",
      };
    },
  };
});

jest.mock("Common/Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn().mockResolvedValue({ key: "lock" }),
      release: jest.fn().mockResolvedValue(undefined),
    },
  };
});

jest.mock("Common/Server/Services/AccessTokenService", () => {
  return {
    __esModule: true,
    default: {
      getUserGlobalAccessPermission: jest.fn(),
      getDatabaseCommonInteractionPropsByUserAndProject: jest.fn(),
      refreshUserAllPermissions: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), create: jest.fn() },
  };
});

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/MarketplaceSubscriptionService", () => {
  return {
    __esModule: true,
    default: { findPurchaseById: jest.fn() },
  };
});

jest.mock("../../../Server/CloudMarketplace/MarketplacePurchases", () => {
  return {
    __esModule: true,
    default: {
      linkToProject: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Permission/CallerPermission", () => {
  return {
    __esModule: true,
    default: { holdsAnyOf: jest.fn() },
  };
});

const mocked: (fn: unknown) => jest.Mock = (fn: unknown): jest.Mock => {
  return fn as jest.Mock;
};

const USER_ID: ObjectID = ObjectID.generate();

const project: (name: string, overrides?: Partial<Project>) => Project = (
  name: string,
  overrides?: Partial<Project>,
): Project => {
  return Object.assign(new Project(), {
    _id: ObjectID.generate().toString(),
    name: name,
    ...overrides,
  });
};

const purchaseRow: (
  overrides?: Partial<MarketplaceSubscription>,
) => MarketplaceSubscription = (
  overrides?: Partial<MarketplaceSubscription>,
): MarketplaceSubscription => {
  return Object.assign(new MarketplaceSubscription(), {
    _id: ObjectID.generate().toString(),
    marketplace: CloudMarketplace.Azure,
    externalSubscriptionId: "37f9dea2-4345-438f-b0bd-03d40d28c7e0",
    status: MarketplaceSubscriptionStatus.Pending,
    ...overrides,
  });
};

// The projects the buyer belongs to, and which of them they manage billing for.
const givenProjects: (
  projects: Array<Project>,
  billingManagerOf: Array<Project>,
) => void = (
  projects: Array<Project>,
  billingManagerOf: Array<Project>,
): void => {
  mocked(AccessTokenService.getUserGlobalAccessPermission).mockResolvedValue({
    projectIds: projects.map((each: Project) => {
      return each.id!;
    }),
  });
  mocked(ProjectService.findBy).mockResolvedValue(projects);
  mocked(
    AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject,
  ).mockImplementation(
    async (data: { projectId: ObjectID }): Promise<unknown> => {
      return { projectIdForTest: data.projectId.toString() };
    },
  );
  mocked(CallerPermission.holdsAnyOf).mockImplementation(
    (props: { projectIdForTest: string }): boolean => {
      return billingManagerOf.some((each: Project) => {
        return each.id!.toString() === props.projectIdForTest;
      });
    },
  );
};

describe("MarketplacePurchaseClaim", () => {
  let adapter: {
    marketplace: CloudMarketplace;
    isConfigured: jest.Mock;
    activate: jest.Mock;
    fetchStatus: jest.Mock;
    reportUsage: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    adapter = {
      marketplace: CloudMarketplace.Azure,
      isConfigured: jest.fn().mockReturnValue(true),
      activate: jest.fn().mockResolvedValue({
        status: MarketplaceSubscriptionStatus.Active,
        externalPlanId: "pay-as-you-go",
        externalState: "Subscribed",
      }),
      fetchStatus: jest.fn(),
      reportUsage: jest.fn(),
    };
    MarketplaceAdapters.set(
      CloudMarketplace.Azure,
      adapter as unknown as MarketplaceAdapter,
    );
  });

  afterEach(() => {
    MarketplaceAdapters.set(CloudMarketplace.Azure, null);
  });

  describe("listProjects", () => {
    it("lists every project of the buyer, and says why each one it cannot pay for is refused", async () => {
      const owned: Project = project("Acme Production");
      const memberOnly: Project = project("Beta");
      const marketplaceBilled: Project = project("Charlie", {
        billingMarketplace: CloudMarketplace.AWS,
      });
      const resold: Project = project("Delta", {
        resellerId: ObjectID.generate(),
      });

      givenProjects(
        [resold, memberOnly, owned, marketplaceBilled],
        [owned, marketplaceBilled, resold],
      );

      const listed: Array<MarketplacePurchaseProject> =
        await MarketplacePurchaseClaim.listProjects({
          userId: USER_ID,
          purchase: purchaseRow(),
        });

      expect(listed).toEqual([
        { id: owned.id!.toString(), name: "Acme Production", isEligible: true },
        {
          id: memberOnly.id!.toString(),
          name: "Beta",
          isEligible: false,
          refusal: MarketplacePurchaseProjectRefusal.NotBillingManager,
        },
        {
          id: marketplaceBilled.id!.toString(),
          name: "Charlie",
          isEligible: false,
          refusal: MarketplacePurchaseProjectRefusal.AlreadyBilledByMarketplace,
        },
        {
          id: resold.id!.toString(),
          name: "Delta",
          isEligible: false,
          refusal: MarketplacePurchaseProjectRefusal.BoughtFromReseller,
        },
      ]);

      // Billing is changed by owners and billing managers, as on Change Plan.
      expect(CallerPermission.holdsAnyOf).toHaveBeenCalledWith(
        expect.anything(),
        [Permission.ProjectOwner, Permission.ManageProjectBilling],
        expect.objectContaining({ projectId: owned.id }),
      );

      // Blocked projects are not offered at all.
      expect(mocked(ProjectService.findBy).mock.calls[0]![0]).toMatchObject({
        query: { isBlocked: false },
      });
    });

    it("lets the purchase's own project be picked again", async () => {
      const linked: Project = project("Acme", {
        billingMarketplace: CloudMarketplace.Azure,
      });
      givenProjects([linked], [linked]);

      const listed: Array<MarketplacePurchaseProject> =
        await MarketplacePurchaseClaim.listProjects({
          userId: USER_ID,
          purchase: purchaseRow({ projectId: linked.id! }),
        });

      expect(listed[0]!.isEligible).toBe(true);
    });

    it("is empty for a user in no project", async () => {
      mocked(
        AccessTokenService.getUserGlobalAccessPermission,
      ).mockResolvedValue(null);

      await expect(
        MarketplacePurchaseClaim.listProjects({
          userId: USER_ID,
          purchase: purchaseRow(),
        }),
      ).resolves.toEqual([]);
      expect(ProjectService.findBy).not.toHaveBeenCalled();
    });
  });

  describe("getPlans", () => {
    it("offers every plan with a list price, by its monthly plan ID", () => {
      expect(MarketplacePurchaseClaim.getPlans()).toEqual([
        {
          planId: "free_monthly",
          name: "Free",
          monthlyPricePerUserInUSD: 0,
          isCustomPricing: false,
        },
        {
          planId: "growth_monthly",
          name: "Growth",
          monthlyPricePerUserInUSD: 22,
          isCustomPricing: false,
        },
      ]);
    });
  });

  describe("complete", () => {
    it("activates the purchase on the marketplace, then moves the chosen project over", async () => {
      const owned: Project = project("Acme");
      const row: MarketplaceSubscription = purchaseRow();

      givenProjects([owned], [owned]);
      mocked(MarketplaceSubscriptionService.findPurchaseById).mockResolvedValue(
        row,
      );

      await expect(
        MarketplacePurchaseClaim.complete({
          purchase: row,
          userId: USER_ID,
          projectId: owned.id!,
        }),
      ).resolves.toEqual(owned.id);

      expect(adapter.activate).toHaveBeenCalledWith(row);
      expect(MarketplacePurchases.linkToProject).toHaveBeenCalledWith({
        purchase: row,
        projectId: owned.id,
        userId: USER_ID,
        status: MarketplaceSubscriptionStatus.Active,
        facts: expect.objectContaining({ externalPlanId: "pay-as-you-go" }),
      });
      expect(
        mocked(MarketplacePurchases.linkToProject).mock.invocationCallOrder[0]!,
      ).toBeGreaterThan(adapter.activate.mock.invocationCallOrder[0]!);
      expect(ProjectService.create).not.toHaveBeenCalled();
    });

    it("refuses a project the buyer does not manage billing for, before asking the marketplace", async () => {
      const memberOnly: Project = project("Beta");
      const row: MarketplaceSubscription = purchaseRow();

      givenProjects([memberOnly], []);
      mocked(MarketplaceSubscriptionService.findPurchaseById).mockResolvedValue(
        row,
      );

      await expect(
        MarketplacePurchaseClaim.complete({
          purchase: row,
          userId: USER_ID,
          projectId: memberOnly.id!,
        }),
      ).rejects.toThrow(/owners, or people who manage its billing/);

      expect(adapter.activate).not.toHaveBeenCalled();
      expect(MarketplacePurchases.linkToProject).not.toHaveBeenCalled();
    });

    it("refuses a project the buyer is not a member of", async () => {
      const row: MarketplaceSubscription = purchaseRow();

      givenProjects([project("Mine")], []);
      mocked(MarketplaceSubscriptionService.findPurchaseById).mockResolvedValue(
        row,
      );

      await expect(
        MarketplacePurchaseClaim.complete({
          purchase: row,
          userId: USER_ID,
          projectId: ObjectID.generate(),
        }),
      ).rejects.toThrow(/not a member of this project/);
      expect(adapter.activate).not.toHaveBeenCalled();
    });

    it("creates a new project on the chosen plan, billed by the marketplace from the start", async () => {
      const row: MarketplaceSubscription = purchaseRow();
      const createdId: ObjectID = ObjectID.generate();

      givenProjects([], []);
      mocked(MarketplaceSubscriptionService.findPurchaseById).mockResolvedValue(
        row,
      );
      mocked(ProjectService.create).mockResolvedValue(
        Object.assign(new Project(), { _id: createdId.toString() }),
      );

      await expect(
        MarketplacePurchaseClaim.complete({
          purchase: row,
          userId: USER_ID,
          newProject: { name: "  Acme Cloud  ", planId: "growth_monthly" },
        }),
      ).resolves.toEqual(createdId);

      const created: { data: Project; props: Record<string, unknown> } = mocked(
        ProjectService.create,
      ).mock.calls[0]![0] as { data: Project; props: Record<string, unknown> };

      expect(created.data.name).toBe("Acme Cloud");
      expect(created.data.paymentProviderPlanId).toBe("growth_monthly");
      expect(created.data.billingMarketplace).toBe(CloudMarketplace.Azure);
      expect(created.data.paymentProviderSubscriptionStatus).toBe(
        SubscriptionStatus.Active,
      );
      expect(created.data.paymentProviderMeteredSubscriptionStatus).toBe(
        SubscriptionStatus.Active,
      );
      // Growth's 14-day trial applies to its per-user price.
      expect(created.data.trialEndsAt).toBeInstanceOf(Date);
      // Created as the buyer, so they are its owner.
      expect(created.props).toMatchObject({ isRoot: true, userId: USER_ID });

      expect(AccessTokenService.refreshUserAllPermissions).toHaveBeenCalledWith(
        USER_ID,
      );
      expect(MarketplacePurchases.linkToProject).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: createdId }),
      );
    });

    it("refuses a new project without a name, with too long a name, or on a plan without a list price", async () => {
      const row: MarketplaceSubscription = purchaseRow();

      givenProjects([], []);
      mocked(MarketplaceSubscriptionService.findPurchaseById).mockResolvedValue(
        row,
      );

      for (const newProject of [
        { name: "   ", planId: "growth_monthly" },
        { name: "x".repeat(101), planId: "growth_monthly" },
        { name: "Acme", planId: "enterprise_monthly" },
        { name: "Acme", planId: "no-such-plan" },
      ]) {
        await expect(
          MarketplacePurchaseClaim.complete({
            purchase: row,
            userId: USER_ID,
            newProject: newProject,
          }),
        ).rejects.toBeInstanceOf(BadDataException);
      }

      await expect(
        MarketplacePurchaseClaim.complete({ purchase: row, userId: USER_ID }),
      ).rejects.toThrow(/Choose a project/);

      expect(adapter.activate).not.toHaveBeenCalled();
      expect(ProjectService.create).not.toHaveBeenCalled();
    });

    it("shows the buyer the marketplace's refusal, and creates nothing", async () => {
      const row: MarketplaceSubscription = purchaseRow();

      givenProjects([], []);
      mocked(MarketplaceSubscriptionService.findPurchaseById).mockResolvedValue(
        row,
      );

      adapter.activate.mockRejectedValueOnce(
        new MarketplaceActivationError(
          "This subscription has been cancelled. Buy OneUptime again on Microsoft Marketplace to continue.",
        ),
      );
      await expect(
        MarketplacePurchaseClaim.complete({
          purchase: row,
          userId: USER_ID,
          newProject: { name: "Acme", planId: "growth_monthly" },
        }),
      ).rejects.toThrow(/has been cancelled/);

      adapter.activate.mockRejectedValueOnce(
        new MarketplaceApiError({
          message: "HTTP 503 from marketplaceapi.microsoft.com",
          status: 503,
          isRetryable: true,
        }),
      );
      await expect(
        MarketplacePurchaseClaim.complete({
          purchase: row,
          userId: USER_ID,
          newProject: { name: "Acme", planId: "growth_monthly" },
        }),
      ).rejects.toThrow(/could not reach Microsoft Marketplace/);

      expect(ProjectService.create).not.toHaveBeenCalled();
      expect(MarketplacePurchases.linkToProject).not.toHaveBeenCalled();
    });

    it("answers a second submit with the project already linked, without activating again", async () => {
      const linked: Project = project("Acme", {
        billingMarketplace: CloudMarketplace.Azure,
      });
      const row: MarketplaceSubscription = purchaseRow({
        projectId: linked.id!,
        status: MarketplaceSubscriptionStatus.Active,
      });

      givenProjects([linked], [linked]);
      mocked(MarketplaceSubscriptionService.findPurchaseById).mockResolvedValue(
        row,
      );

      await expect(
        MarketplacePurchaseClaim.complete({
          purchase: row,
          userId: USER_ID,
          newProject: { name: "Another", planId: "growth_monthly" },
        }),
      ).resolves.toEqual(linked.id);

      expect(adapter.activate).not.toHaveBeenCalled();
      expect(ProjectService.create).not.toHaveBeenCalled();
    });

    it("refuses a purchase already set up for someone else's project", async () => {
      const row: MarketplaceSubscription = purchaseRow({
        projectId: ObjectID.generate(),
        status: MarketplaceSubscriptionStatus.Active,
      });

      givenProjects([project("Mine")], []);
      mocked(MarketplaceSubscriptionService.findPurchaseById).mockResolvedValue(
        row,
      );

      await expect(
        MarketplacePurchaseClaim.complete({
          purchase: row,
          userId: USER_ID,
          newProject: { name: "Acme", planId: "growth_monthly" },
        }),
      ).rejects.toThrow(/already set up for a project you are not a member of/);
    });

    it("refuses while the marketplace is not configured on this server", async () => {
      const row: MarketplaceSubscription = purchaseRow();

      givenProjects([], []);
      mocked(MarketplaceSubscriptionService.findPurchaseById).mockResolvedValue(
        row,
      );
      adapter.isConfigured.mockReturnValue(false);

      await expect(
        MarketplacePurchaseClaim.complete({
          purchase: row,
          userId: USER_ID,
          newProject: { name: "Acme", planId: "growth_monthly" },
        }),
      ).rejects.toThrow(/not available on this server/);
      expect(adapter.activate).not.toHaveBeenCalled();
    });
  });

  describe("getDetails", () => {
    it("describes the purchase for the page, and only names a linked project the buyer can see", async () => {
      const elsewhere: ObjectID = ObjectID.generate();

      mocked(UserService.findOneById).mockResolvedValue({
        email: {
          toString: (): string => {
            return "buyer@contoso.com";
          },
        },
        isMasterAdmin: false,
      });
      givenProjects([project("Mine")], []);
      const shouldDisableProjectCreation: jest.SpyInstance = jest
        .spyOn(DatabaseConfig, "shouldDisableUserProjectCreation")
        .mockResolvedValue(false);

      const details: Awaited<
        ReturnType<typeof MarketplacePurchaseClaim.getDetails>
      > = await MarketplacePurchaseClaim.getDetails({
        purchase: purchaseRow({
          projectId: elsewhere,
          purchaserEmail: "buyer@contoso.com",
          externalPlanId: "pay-as-you-go",
        }),
        userId: USER_ID,
      });

      expect(details).toMatchObject({
        marketplace: CloudMarketplace.Azure,
        marketplaceName: "Microsoft Marketplace",
        buyerEmail: "buyer@contoso.com",
        marketplacePlan: "pay-as-you-go",
        linkedProjectId: null,
        signedInEmail: "buyer@contoso.com",
        canCreateProject: true,
      });
      expect(details.plans.length).toBe(2);

      shouldDisableProjectCreation.mockRestore();
    });
  });
});
