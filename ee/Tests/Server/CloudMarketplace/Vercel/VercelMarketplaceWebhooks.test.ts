import crypto from "crypto";
import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import User from "Common/Models/DatabaseModels/User";
import VercelMarketplaceInstallation from "Common/Models/DatabaseModels/VercelMarketplaceInstallation";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import ObjectID from "Common/Types/ObjectID";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import MarketplacePurchases from "../../../../Server/CloudMarketplace/MarketplacePurchases";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserService from "Common/Server/Services/UserService";
import VercelMarketplaceInstallationService from "Common/Server/Services/VercelMarketplaceInstallationService";
import VercelMarketplaceBilling from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceBilling";
import VercelMarketplaceMonitors from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceMonitors";
import VercelMarketplaceResources from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceResources";
import VercelMarketplaceWebhooks, {
  VercelWebhookEvent,
} from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceWebhooks";
import logger from "Common/Server/Utils/Logger";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The webhooks Vercel sends the integration, signed with its client
 * secret: connected projects get uptime monitors, an overdue invoice
 * suspends the team's resources and paying it brings them back, an
 * uninstall ends the installation, and someone leaving the team leaves its
 * OneUptime projects.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...jest.requireActual("Common/Server/EnvironmentConfig"),
    VercelMarketplaceClientSecret: "integration-secret",
  };
});

jest.mock(
  "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceMonitors",
  () => {
    return {
      __esModule: true,
      default: {
        onProjectConnected: jest.fn(),
        onProjectDisconnected: jest.fn(),
        onProductionDeployment: jest.fn(),
      },
    };
  },
);

jest.mock(
  "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceResources",
  () => {
    return {
      __esModule: true,
      default: {
        listPurchases: jest.fn(),
        tellVercelResourceChanged: jest.fn(),
      },
    };
  },
);

jest.mock(
  "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceBilling",
  () => {
    return {
      __esModule: true,
      default: { requestDeletion: jest.fn() },
    };
  },
);

jest.mock("Common/Server/Services/MarketplaceSubscriptionService", () => {
  return {
    __esModule: true,
    default: {},
  };
});

jest.mock("../../../../Server/CloudMarketplace/MarketplacePurchases", () => {
  return {
    __esModule: true,
    default: {
      updatePurchase: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/VercelMarketplaceInstallationService", () => {
  return {
    __esModule: true,
    default: { findByInstallationId: jest.fn() },
  };
});

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn() },
  };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: { deleteBy: jest.fn() },
  };
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

const event: (
  type: string,
  payload: Record<string, unknown>,
) => VercelWebhookEvent = (
  type: string,
  payload: Record<string, unknown>,
): VercelWebhookEvent => {
  return VercelMarketplaceWebhooks.parse({
    id: "evt_1",
    type: type,
    createdAt: 1792330000000,
    region: "iad1",
    payload: payload,
  })!;
};

const purchase: (
  resourceId: string,
  status: MarketplaceSubscriptionStatus,
) => MarketplaceSubscription = (
  resourceId: string,
  status: MarketplaceSubscriptionStatus,
): MarketplaceSubscription => {
  return Object.assign(new MarketplaceSubscription(), {
    _id: ObjectID.generate().toString(),
    marketplace: CloudMarketplace.Vercel,
    externalSubscriptionId: resourceId,
    externalCustomerId: "icfg_acme",
    status: status,
    projectId: ObjectID.generate(),
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mocked(MarketplacePurchases.updatePurchase).mockImplementation(
    async (current: unknown, facts: unknown): Promise<unknown> => {
      return Object.assign(new MarketplaceSubscription(), current, facts);
    },
  );
  jest.spyOn(logger, "info").mockImplementation((): void => {});
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("VercelMarketplaceWebhooks.isSignatureValid", () => {
  it("takes a webhook signed with the integration's client secret, over its raw body", () => {
    const body: string = JSON.stringify({ id: "evt_1", type: "test-webhook" });

    expect(
      VercelMarketplaceWebhooks.isSignatureValid({
        rawBody: body,
        signature: crypto
          .createHmac("sha1", "integration-secret")
          .update(body)
          .digest("hex"),
      }),
    ).toBe(true);

    expect(
      VercelMarketplaceWebhooks.isSignatureValid({
        rawBody: body,
        signature: crypto
          .createHmac("sha1", "another-secret")
          .update(body)
          .digest("hex"),
      }),
    ).toBe(false);

    expect(
      VercelMarketplaceWebhooks.isSignatureValid({
        rawBody: undefined,
        signature: "abc",
      }),
    ).toBe(false);
  });
});

describe("VercelMarketplaceWebhooks.parse", () => {
  it("reads the envelope, and nothing that is not one", () => {
    expect(
      VercelMarketplaceWebhooks.parse({ id: "e", type: "x", payload: [] }),
    ).toEqual({ id: "e", type: "x", payload: {} });
    expect(VercelMarketplaceWebhooks.parse({ id: "e" })).toBeNull();
    expect(VercelMarketplaceWebhooks.parse([])).toBeNull();
    expect(VercelMarketplaceWebhooks.parse("x")).toBeNull();
  });
});

describe("VercelMarketplaceWebhooks.handle", () => {
  it("watches a Vercel project connected to a resource", async () => {
    await VercelMarketplaceWebhooks.handle(
      event("integration-resource.project-connected", {
        configuration: { id: "icfg_acme" },
        installationId: "icfg_acme",
        resourceId: "res_1",
        project: { id: "prj_1", name: "storefront" },
        projectId: "prj_1",
        productionDomain: "storefront.vercel.app",
        targets: ["production", "preview"],
      }),
    );

    expect(VercelMarketplaceMonitors.onProjectConnected).toHaveBeenCalledWith({
      installationId: "icfg_acme",
      resourceId: "res_1",
      vercelProjectId: "prj_1",
      vercelProjectName: "storefront",
      productionDomain: "storefront.vercel.app",
    });
  });

  it("stops watching a project disconnected, read by the configuration's ID where that is all there is", async () => {
    await VercelMarketplaceWebhooks.handle(
      event("integration-resource.project-disconnected", {
        configuration: { id: "icfg_acme" },
        resourceId: "res_1",
        projectId: "prj_1",
      }),
    );

    expect(
      VercelMarketplaceMonitors.onProjectDisconnected,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: "icfg_acme",
        resourceId: "res_1",
        vercelProjectId: "prj_1",
      }),
    );
  });

  it("ignores a connection it cannot place", async () => {
    await VercelMarketplaceWebhooks.handle(
      event("integration-resource.project-connected", { resourceId: "res_1" }),
    );

    expect(VercelMarketplaceMonitors.onProjectConnected).not.toHaveBeenCalled();
  });

  it("looks at production deployments only, for the installations and resources Vercel names", async () => {
    await VercelMarketplaceWebhooks.handle(
      event("deployment.succeeded", {
        target: "production",
        project: { id: "prj_1" },
        deployment: { id: "dpl_1", url: "storefront-abc.vercel.app" },
        integrations: [
          {
            installationId: "icfg_acme",
            resources: [{ externalResourceId: "res_1" }],
          },
        ],
        installationIds: ["icfg_legacy"],
      }),
    );

    expect(
      VercelMarketplaceMonitors.onProductionDeployment,
    ).toHaveBeenCalledWith({
      vercelProjectId: "prj_1",
      installationIds: ["icfg_acme", "icfg_legacy"],
      resourceIds: ["res_1"],
    });

    // A promotion is to production, whatever its payload says.
    await VercelMarketplaceWebhooks.handle(
      event("deployment.promoted", { project: { id: "prj_2" } }),
    );
    expect(
      VercelMarketplaceMonitors.onProductionDeployment,
    ).toHaveBeenCalledTimes(2);

    // A preview deployment is not watched.
    await VercelMarketplaceWebhooks.handle(
      event("deployment.ready", { target: null, project: { id: "prj_1" } }),
    );
    expect(
      VercelMarketplaceMonitors.onProductionDeployment,
    ).toHaveBeenCalledTimes(2);
  });

  it("suspends the team's resources when an invoice is overdue, and brings them back when it is paid", async () => {
    const active: MarketplaceSubscription = purchase(
      "res_1",
      MarketplaceSubscriptionStatus.Active,
    );
    const ended: MarketplaceSubscription = purchase(
      "res_2",
      MarketplaceSubscriptionStatus.Cancelled,
    );

    mocked(VercelMarketplaceResources.listPurchases).mockResolvedValue([
      active,
      ended,
    ]);

    await VercelMarketplaceWebhooks.handle(
      event("marketplace.invoice.overdue", {
        configuration: { id: "icfg_acme" },
        installationId: "icfg_acme",
        invoiceId: "inv_1",
      }),
    );

    expect(MarketplacePurchases.updatePurchase).toHaveBeenCalledTimes(1);
    expect(MarketplacePurchases.updatePurchase).toHaveBeenCalledWith(active, {
      status: MarketplaceSubscriptionStatus.Suspended,
      externalState: "invoice-overdue",
    });
    expect(
      VercelMarketplaceResources.tellVercelResourceChanged,
    ).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();

    mocked(VercelMarketplaceResources.listPurchases).mockResolvedValue([
      purchase("res_1", MarketplaceSubscriptionStatus.Suspended),
      ended,
    ]);
    mocked(MarketplacePurchases.updatePurchase).mockImplementation(
      async (current: unknown, facts: unknown): Promise<unknown> => {
        return Object.assign(new MarketplaceSubscription(), current, facts);
      },
    );

    await VercelMarketplaceWebhooks.handle(
      event("marketplace.invoice.paid", { installationId: "icfg_acme" }),
    );

    expect(MarketplacePurchases.updatePurchase).toHaveBeenCalledTimes(1);
    expect(MarketplacePurchases.updatePurchase).toHaveBeenCalledWith(
      expect.anything(),
      {
        status: MarketplaceSubscriptionStatus.Active,
        externalState: "invoice-paid",
      },
    );
  });

  it("changes nothing for a failed charge Vercel will retry", async () => {
    await VercelMarketplaceWebhooks.handle(
      event("marketplace.invoice.notpaid", {
        installationId: "icfg_acme",
        invoiceId: "inv_1",
      }),
    );

    expect(MarketplacePurchases.updatePurchase).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("uninstalls on integration-configuration.removed, as Delete Installation does", async () => {
    const installation: VercelMarketplaceInstallation = Object.assign(
      new VercelMarketplaceInstallation(),
      { installationId: "icfg_acme" },
    );
    mocked(
      VercelMarketplaceInstallationService.findByInstallationId,
    ).mockResolvedValue(installation);

    await VercelMarketplaceWebhooks.handle(
      event("integration-configuration.removed", {
        configuration: { id: "icfg_acme", projectSelection: "all" },
      }),
    );

    expect(VercelMarketplaceBilling.requestDeletion).toHaveBeenCalledWith(
      installation,
    );
  });

  it("takes someone who left the Vercel team out of its OneUptime projects", async () => {
    const userId: ObjectID = ObjectID.generate();
    const first: MarketplaceSubscription = purchase(
      "res_1",
      MarketplaceSubscriptionStatus.Active,
    );

    mocked(UserService.findOneBy).mockResolvedValue(
      Object.assign(new User(), { _id: userId.toString() }),
    );
    mocked(VercelMarketplaceResources.listPurchases).mockResolvedValue([first]);

    await VercelMarketplaceWebhooks.handle(
      event("marketplace.member.changed", {
        installationId: "icfg_acme",
        memberId: "user_ada",
        role: "NONE",
        userEmail: "ada@example.com",
      }),
    );

    expect(TeamMemberService.deleteBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { projectId: first.projectId, userId: userId },
      }),
    );
    expect(AccessTokenService.refreshUserAllPermissions).toHaveBeenCalledWith(
      userId,
    );

    jest.clearAllMocks();

    // A role change, or a departure Vercel does not name by email, changes nothing.
    await VercelMarketplaceWebhooks.handle(
      event("marketplace.member.changed", {
        installationId: "icfg_acme",
        role: "USER",
        userEmail: "ada@example.com",
      }),
    );
    await VercelMarketplaceWebhooks.handle(
      event("marketplace.member.changed", {
        installationId: "icfg_acme",
        role: "NONE",
      }),
    );

    expect(TeamMemberService.deleteBy).not.toHaveBeenCalled();
  });

  it("acknowledges what it does not act on", async () => {
    await expect(
      VercelMarketplaceWebhooks.handle(event("project.created", {})),
    ).resolves.toBeUndefined();
  });
});
