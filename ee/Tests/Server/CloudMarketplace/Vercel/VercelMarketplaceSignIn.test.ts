import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import VercelMarketplaceInstallation from "Common/Models/DatabaseModels/VercelMarketplaceInstallation";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import VercelInstallationStatus from "Common/Types/Marketplace/VercelInstallationStatus";
import ObjectID from "Common/Types/ObjectID";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import TeamService from "Common/Server/Services/TeamService";
import VercelMarketplaceInstallationService from "Common/Server/Services/VercelMarketplaceInstallationService";
import { VercelMarketplaceCaller } from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceAuth";
import VercelMarketplaceResources from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceResources";
import VercelMarketplaceSignIn, {
  VercelSignInError,
} from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceSignIn";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Signing in from Vercel: the person gets into the resource's project - or
 * all of the team's - in the team their Vercel role gives them, and lands on
 * the page Vercel sent them for.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...jest.requireActual("Common/Server/EnvironmentConfig"),
    Host: "oneuptime.com",
    HttpProtocol: "https://",
  };
});

jest.mock("Common/Server/Services/VercelMarketplaceInstallationService", () => {
  return { __esModule: true, default: { findByInstallationId: jest.fn() } };
});

jest.mock(
  "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceResources",
  () => {
    return {
      __esModule: true,
      default: { findPurchase: jest.fn(), listPurchases: jest.fn() },
    };
  },
);

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      create: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/TeamService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock("Common/Server/Services/AccessTokenService", () => {
  return {
    __esModule: true,
    default: { refreshUserAllPermissions: jest.fn() },
  };
});

const mocked: (fn: unknown) => jest.Mock = (fn: unknown): jest.Mock => {
  return fn as jest.Mock;
};

const USER_ID: ObjectID = ObjectID.generate();

const caller: (
  overrides?: Partial<VercelMarketplaceCaller>,
) => VercelMarketplaceCaller = (
  overrides?: Partial<VercelMarketplaceCaller>,
): VercelMarketplaceCaller => {
  return {
    kind: "user",
    accountId: "team_acme",
    installationId: "icfg_acme",
    userId: "user_ada",
    userRole: "ADMIN",
    userEmail: "ada@example.com",
    isUserEmailVerified: true,
    ...overrides,
  };
};

const purchase: (
  resourceId: string,
  overrides?: Partial<Record<keyof MarketplaceSubscription, unknown>>,
) => MarketplaceSubscription = (
  resourceId: string,
  overrides?: Partial<Record<keyof MarketplaceSubscription, unknown>>,
): MarketplaceSubscription => {
  return Object.assign(new MarketplaceSubscription(), {
    _id: ObjectID.generate().toString(),
    marketplace: CloudMarketplace.Vercel,
    externalSubscriptionId: resourceId,
    externalCustomerId: "icfg_acme",
    status: MarketplaceSubscriptionStatus.Active,
    projectId: ObjectID.generate(),
    ...overrides,
  });
};

beforeEach(() => {
  jest.clearAllMocks();

  mocked(
    VercelMarketplaceInstallationService.findByInstallationId,
  ).mockResolvedValue(
    Object.assign(new VercelMarketplaceInstallation(), {
      installationId: "icfg_acme",
      status: VercelInstallationStatus.Active,
    }),
  );
  mocked(TeamMemberService.findOneBy).mockResolvedValue(null);
  mocked(TeamService.findOneBy).mockResolvedValue(
    Object.assign(new Team(), { _id: ObjectID.generate().toString() }),
  );
});

describe("VercelMarketplaceSignIn.getPurchases", () => {
  it("signs in to the resource Vercel names", async () => {
    const one: MarketplaceSubscription = purchase("res_1");
    mocked(VercelMarketplaceResources.findPurchase).mockResolvedValue(one);

    expect(
      await VercelMarketplaceSignIn.getPurchases({
        caller: caller(),
        resourceId: "res_1",
      }),
    ).toEqual([one]);

    expect(VercelMarketplaceResources.findPurchase).toHaveBeenCalledWith({
      installationId: "icfg_acme",
      resourceId: "res_1",
    });
  });

  it("signs in to every open resource of the team when Vercel names none", async () => {
    const open: MarketplaceSubscription = purchase("res_1");

    mocked(VercelMarketplaceResources.listPurchases).mockResolvedValue([
      open,
      purchase("res_2", { status: MarketplaceSubscriptionStatus.Cancelled }),
      purchase("res_3", { projectId: undefined }),
    ]);

    expect(
      await VercelMarketplaceSignIn.getPurchases({ caller: caller() }),
    ).toEqual([open]);
  });

  it("says why there is nothing to sign in to", async () => {
    mocked(VercelMarketplaceResources.findPurchase).mockResolvedValue(null);

    await expect(
      VercelMarketplaceSignIn.getPurchases({
        caller: caller(),
        resourceId: "res_gone",
      }),
    ).rejects.toThrow("was deleted");

    mocked(VercelMarketplaceResources.listPurchases).mockResolvedValue([]);

    await expect(
      VercelMarketplaceSignIn.getPurchases({ caller: caller() }),
    ).rejects.toThrow("no OneUptime resource yet");

    mocked(
      VercelMarketplaceInstallationService.findByInstallationId,
    ).mockResolvedValue(
      Object.assign(new VercelMarketplaceInstallation(), {
        status: VercelInstallationStatus.DeletePending,
      }),
    );

    await expect(
      VercelMarketplaceSignIn.getPurchases({ caller: caller() }),
    ).rejects.toBeInstanceOf(VercelSignInError);

    await expect(
      VercelMarketplaceSignIn.getPurchases({
        caller: caller({ installationId: null }),
      }),
    ).rejects.toThrow("which installation");
  });
});

describe("VercelMarketplaceSignIn.ensureMemberships", () => {
  it("adds a Vercel admin to the Admin team, and anyone else to Members", async () => {
    const one: MarketplaceSubscription = purchase("res_1");

    await VercelMarketplaceSignIn.ensureMemberships({
      userId: USER_ID,
      role: "ADMIN",
      purchases: [one],
    });

    expect(TeamService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { projectId: one.projectId, name: "Admin" },
      }),
    );

    const member: TeamMember = mocked(TeamMemberService.create).mock
      .calls[0]![0].data;
    expect(member).toMatchObject({
      projectId: one.projectId,
      userId: USER_ID,
      hasAcceptedInvitation: true,
    });
    expect(AccessTokenService.refreshUserAllPermissions).toHaveBeenCalledWith(
      USER_ID,
    );

    jest.clearAllMocks();
    mocked(TeamMemberService.findOneBy).mockResolvedValue(null);
    mocked(TeamService.findOneBy).mockResolvedValue(
      Object.assign(new Team(), { _id: ObjectID.generate().toString() }),
    );

    await VercelMarketplaceSignIn.ensureMemberships({
      userId: USER_ID,
      role: "USER",
      purchases: [one],
    });

    expect(TeamService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { projectId: one.projectId, name: "Members" },
      }),
    );
  });

  it("leaves someone already in the project in their teams, accepting a pending invitation", async () => {
    mocked(TeamMemberService.findOneBy).mockResolvedValueOnce(
      Object.assign(new TeamMember(), {
        _id: ObjectID.generate().toString(),
        hasAcceptedInvitation: true,
      }),
    );

    await VercelMarketplaceSignIn.ensureMemberships({
      userId: USER_ID,
      role: "ADMIN",
      purchases: [purchase("res_1")],
    });

    expect(TeamMemberService.create).not.toHaveBeenCalled();
    expect(AccessTokenService.refreshUserAllPermissions).not.toHaveBeenCalled();

    mocked(TeamMemberService.findOneBy).mockResolvedValueOnce(
      Object.assign(new TeamMember(), {
        _id: ObjectID.generate().toString(),
        hasAcceptedInvitation: false,
      }),
    );

    await VercelMarketplaceSignIn.ensureMemberships({
      userId: USER_ID,
      role: "ADMIN",
      purchases: [purchase("res_1")],
    });

    expect(TeamMemberService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({ data: { hasAcceptedInvitation: true } }),
    );
  });

  it("says, in the dashboard's words, why someone could not be added", async () => {
    mocked(TeamMemberService.create).mockRejectedValue(
      new Error("This project's plan allows 1 person."),
    );

    await expect(
      VercelMarketplaceSignIn.ensureMemberships({
        userId: USER_ID,
        role: "USER",
        purchases: [purchase("res_1")],
      }),
    ).rejects.toThrow("plan allows 1 person");
  });
});

describe("VercelMarketplaceSignIn.getRedirectUrl", () => {
  const projectId: ObjectID = new ObjectID(
    "6720a1b2-0000-4000-8000-00000000000b",
  );

  it("lands on the page Vercel sent the person for", () => {
    expect(
      VercelMarketplaceSignIn.getRedirectUrl({
        projectId: projectId,
        request: {},
      }),
    ).toBe(`/dashboard/${projectId.toString()}/home/`);

    expect(
      VercelMarketplaceSignIn.getRedirectUrl({
        projectId: projectId,
        request: { invoiceId: "inv_1" },
      }),
    ).toBe(`/dashboard/${projectId.toString()}/settings/billing`);

    expect(
      VercelMarketplaceSignIn.getRedirectUrl({
        projectId: projectId,
        request: { path: "usage" },
      }),
    ).toBe(`/dashboard/${projectId.toString()}/settings/billing`);

    expect(
      VercelMarketplaceSignIn.getRedirectUrl({
        projectId: projectId,
        request: { path: "secrets" },
      }),
    ).toBe(
      `/dashboard/${projectId.toString()}/settings/telemetry-ingestion-keys`,
    );

    expect(
      VercelMarketplaceSignIn.getRedirectUrl({
        projectId: projectId,
        request: { isSupport: true },
      }),
    ).toBe("https://oneuptime.com/support");
  });
});
