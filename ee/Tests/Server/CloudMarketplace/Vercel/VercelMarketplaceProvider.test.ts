import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import User from "Common/Models/DatabaseModels/User";
import VercelMarketplaceInstallation from "Common/Models/DatabaseModels/VercelMarketplaceInstallation";
import { JSONObject } from "Common/Types/JSON";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import VercelInstallationStatus from "Common/Types/Marketplace/VercelInstallationStatus";
import ObjectID from "Common/Types/ObjectID";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import MarketplacePurchases from "../../../../Server/CloudMarketplace/MarketplacePurchases";
import ProjectService from "Common/Server/Services/ProjectService";
import UserService from "Common/Server/Services/UserService";
import VercelMarketplaceInstallationService from "Common/Server/Services/VercelMarketplaceInstallationService";
import { VercelMarketplaceCaller } from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceAuth";
import VercelMarketplaceBilling from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceBilling";
import VercelMarketplaceMonitors from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceMonitors";
import VercelMarketplaceProvider, {
  VercelProviderError,
} from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceProvider";
import VercelMarketplaceResources from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceResources";
import logger from "Common/Server/Utils/Logger";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The provider API Vercel calls: installing OneUptime on a team, adding,
 * changing and deleting a OneUptime resource, and uninstalling - each
 * request held to the installation its token is for, and to the caller's
 * role in the team.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...jest.requireActual("Common/Server/EnvironmentConfig"),
    Host: "oneuptime.com",
    HttpProtocol: "https://",
    getAllEnvVars: (): Record<string, string> => {
      return {
        SUBSCRIPTION_PLAN_FREE: "Free,free_monthly,free_yearly,0,0,1,0",
        SUBSCRIPTION_PLAN_GROWTH:
          "Growth,growth_monthly,growth_yearly,22,240,2,14",
      };
    },
  };
});

jest.mock("Common/Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: { lock: jest.fn(), release: jest.fn() },
  };
});

jest.mock("Common/Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: { getString: jest.fn(), setString: jest.fn() },
  };
});

jest.mock("Common/Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: { shouldDisableSignup: jest.fn() },
  };
});

jest.mock("Common/Server/Services/VercelMarketplaceInstallationService", () => {
  return {
    __esModule: true,
    default: {
      findByInstallationId: jest.fn(),
      create: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

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

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { updateOneById: jest.fn(), changePlan: jest.fn() },
  };
});

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn(), createByEmail: jest.fn() },
  };
});

jest.mock(
  "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceResources",
  () => {
    return {
      __esModule: true,
      default: {
        findPurchase: jest.fn(),
        provision: jest.fn(),
        deprovision: jest.fn(),
        rotateSecrets: jest.fn(),
        saveDetails: jest.fn(),
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

jest.mock(
  "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceMonitors",
  () => {
    return {
      __esModule: true,
      default: { addMissingMonitors: jest.fn() },
    };
  },
);

const mocked: (fn: unknown) => jest.Mock = (fn: unknown): jest.Mock => {
  return fn as jest.Mock;
};

const INSTALLATION_ID: string = "icfg_acme";

const admin: (
  overrides?: Partial<VercelMarketplaceCaller>,
) => VercelMarketplaceCaller = (
  overrides?: Partial<VercelMarketplaceCaller>,
): VercelMarketplaceCaller => {
  return {
    kind: "user",
    accountId: "team_acme",
    installationId: INSTALLATION_ID,
    userId: "user_ada",
    userRole: "ADMIN",
    userEmail: "ada@example.com",
    isUserEmailVerified: true,
    userName: "Ada Lovelace",
    ...overrides,
  };
};

const system: VercelMarketplaceCaller = {
  kind: "system",
  accountId: "team_acme",
  installationId: INSTALLATION_ID,
};

const installation: (
  overrides?: Partial<Record<keyof VercelMarketplaceInstallation, unknown>>,
) => VercelMarketplaceInstallation = (
  overrides?: Partial<Record<keyof VercelMarketplaceInstallation, unknown>>,
): VercelMarketplaceInstallation => {
  return Object.assign(new VercelMarketplaceInstallation(), {
    _id: "6720a1b2-0000-4000-8000-000000000001",
    installationId: INSTALLATION_ID,
    status: VercelInstallationStatus.Active,
    accessToken: "token",
    ...overrides,
  });
};

const resourcePurchase: (
  overrides?: Partial<Record<keyof MarketplaceSubscription, unknown>>,
) => MarketplaceSubscription = (
  overrides?: Partial<Record<keyof MarketplaceSubscription, unknown>>,
): MarketplaceSubscription => {
  return Object.assign(new MarketplaceSubscription(), {
    _id: ObjectID.generate().toString(),
    marketplace: CloudMarketplace.Vercel,
    externalSubscriptionId: "res_1",
    externalCustomerId: INSTALLATION_ID,
    externalOfferId: "oneuptime",
    externalPlanId: "free",
    status: MarketplaceSubscriptionStatus.Active,
    projectId: ObjectID.generate(),
    details: {
      name: "Storefront",
      productId: "oneuptime",
      metadata: { monitorProductionDomains: false },
    },
    ...overrides,
  });
};

const user: (overrides?: Partial<Record<keyof User, unknown>>) => User = (
  overrides?: Partial<Record<keyof User, unknown>>,
): User => {
  return Object.assign(new User(), {
    _id: ObjectID.generate().toString(),
    email: "ada@example.com",
    isEmailVerified: true,
    isBlocked: false,
    ...overrides,
  });
};

const provisionBody: JSONObject = {
  productId: "oneuptime",
  name: "Storefront",
  metadata: { monitorProductionDomains: true, createStatusPage: false },
  billingPlanId: "growth",
};

const expectError: (
  promise: Promise<unknown>,
  code: string,
) => Promise<VercelProviderError> = async (
  promise: Promise<unknown>,
  code: string,
): Promise<VercelProviderError> => {
  const err: unknown = await promise.then(
    () => {
      return null;
    },
    (error: unknown) => {
      return error;
    },
  );

  expect(err).toBeInstanceOf(VercelProviderError);
  expect((err as VercelProviderError).code).toBe(code);
  return err as VercelProviderError;
};

beforeEach(() => {
  jest.clearAllMocks();

  mocked(Semaphore.lock).mockResolvedValue({ key: "lock" });
  mocked(Semaphore.release).mockResolvedValue(undefined);
  mocked(GlobalCache.getString).mockResolvedValue(null);
  mocked(GlobalCache.setString).mockResolvedValue(undefined);
  mocked(DatabaseConfig.shouldDisableSignup).mockResolvedValue(false);
  mocked(
    VercelMarketplaceInstallationService.findByInstallationId,
  ).mockResolvedValue(installation());
  mocked(UserService.findOneBy).mockResolvedValue(user());
  mocked(VercelMarketplaceResources.provision).mockImplementation(
    async (data: unknown): Promise<unknown> => {
      const input: { resourceId: string } = data as { resourceId: string };
      return {
        purchase: resourcePurchase({
          externalSubscriptionId: input.resourceId,
          externalPlanId: "growth",
        }),
        secrets: [
          {
            name: "OTEL_EXPORTER_OTLP_ENDPOINT",
            value: "https://oneuptime.com/otlp",
          },
        ],
      };
    },
  );

  jest.spyOn(logger, "info").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("VercelMarketplaceProvider: the token's installation", () => {
  it("refuses a call about an installation the token is not for", async () => {
    await expectError(
      VercelMarketplaceProvider.getInstallation({
        caller: admin({ installationId: "icfg_other" }),
        installationId: INSTALLATION_ID,
      }),
      "forbidden",
    );

    await expectError(
      VercelMarketplaceProvider.getResource({
        caller: { ...system, installationId: null },
        installationId: INSTALLATION_ID,
        resourceId: "res_1",
      }),
      "forbidden",
    );
  });
});

describe("VercelMarketplaceProvider.upsertInstallation", () => {
  it("records a new installation with its token, scopes and contact", async () => {
    mocked(
      VercelMarketplaceInstallationService.findByInstallationId,
    ).mockResolvedValue(null);

    await VercelMarketplaceProvider.upsertInstallation({
      caller: admin(),
      installationId: INSTALLATION_ID,
      body: {
        scopes: ["read:project", "", 7],
        acceptedPolicies: { toc: "2026-10-18T10:00:00Z" },
        credentials: { access_token: "vercel-token", token_type: "Bearer" },
        account: {
          name: "Acme",
          url: "https://vercel.com/acme/~/integrations/oneuptime",
          contact: { email: "Owner@Acme.com", name: "Grace" },
        },
      } as unknown as JSONObject,
    });

    const created: VercelMarketplaceInstallation = mocked(
      VercelMarketplaceInstallationService.create,
    ).mock.calls[0]![0].data;

    expect(created).toMatchObject({
      installationId: INSTALLATION_ID,
      status: VercelInstallationStatus.Active,
      vercelAccountId: "team_acme",
      accessToken: "vercel-token",
      tokenType: "Bearer",
      scopes: ["read:project"],
      acceptedPolicies: { toc: "2026-10-18T10:00:00Z" },
      accountName: "Acme",
      contactEmail: "owner@acme.com",
      contactName: "Grace",
    });
  });

  it("brings an installation up to date, a new token included", async () => {
    await VercelMarketplaceProvider.upsertInstallation({
      caller: system,
      installationId: INSTALLATION_ID,
      body: {
        scopes: [],
        acceptedPolicies: {},
        credentials: { access_token: "rotated-token" },
        account: { url: "https://vercel.com/acme", contact: null },
      },
    });

    expect(VercelMarketplaceInstallationService.create).not.toHaveBeenCalled();
    expect(
      mocked(VercelMarketplaceInstallationService.updateOneById).mock
        .calls[0]![0].data,
    ).toMatchObject({
      accessToken: "rotated-token",
      tokenType: "Bearer",
      contactEmail: null,
      accountName: null,
    });
  });

  it("refuses an installation with no token, and one that was uninstalled", async () => {
    const missing: VercelProviderError = await expectError(
      VercelMarketplaceProvider.upsertInstallation({
        caller: admin(),
        installationId: INSTALLATION_ID,
        body: { scopes: [], acceptedPolicies: {}, credentials: {} },
      }),
      "validation_error",
    );
    expect(missing.toJSON()).toMatchObject({
      error: { fields: [{ key: "credentials" }] },
    });

    mocked(
      VercelMarketplaceInstallationService.findByInstallationId,
    ).mockResolvedValue(
      installation({ status: VercelInstallationStatus.Deleted }),
    );

    await expectError(
      VercelMarketplaceProvider.upsertInstallation({
        caller: admin(),
        installationId: INSTALLATION_ID,
        body: { credentials: { access_token: "t" } },
      }),
      "conflict",
    );
  });
});

describe("VercelMarketplaceProvider.provisionResource", () => {
  it("makes the resource for the person who added it, and returns its secrets", async () => {
    const response: JSONObject =
      await VercelMarketplaceProvider.provisionResource({
        caller: admin(),
        installationId: INSTALLATION_ID,
        body: provisionBody,
        idempotencyKey: "idem-1",
      });

    const input: Record<string, unknown> = mocked(
      VercelMarketplaceResources.provision,
    ).mock.calls[0]![0];

    expect(input).toMatchObject({
      productId: "oneuptime",
      name: "Storefront",
      metadata: provisionBody["metadata"],
      ownerEmail: "ada@example.com",
      vercelUserId: "user_ada",
    });
    expect((input["plan"] as { getName: () => string }).getName()).toBe(
      "Growth",
    );

    expect(response).toMatchObject({
      id: input["resourceId"],
      name: "Storefront",
      status: "ready",
      billingPlan: { id: "growth" },
      secrets: [{ name: "OTEL_EXPORTER_OTLP_ENDPOINT" }],
    });

    // Remembered by its Idempotency-Key before anything is made.
    expect(GlobalCache.setString).toHaveBeenCalledWith(
      "vercel-marketplace-idempotency",
      `${INSTALLATION_ID}:idem-1`,
      input["resourceId"],
      { expiresInSeconds: 24 * 60 * 60 },
    );
    expect(
      mocked(GlobalCache.setString).mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocked(VercelMarketplaceResources.provision).mock.invocationCallOrder[0]!,
    );
  });

  it("answers a retried provisioning for the resource it started, not a second one", async () => {
    const earlier: MarketplaceSubscription = resourcePurchase({
      externalSubscriptionId: "res_earlier",
    });

    mocked(GlobalCache.getString).mockResolvedValue("res_earlier");
    mocked(VercelMarketplaceResources.findPurchase).mockResolvedValue(earlier);

    await VercelMarketplaceProvider.provisionResource({
      caller: admin(),
      installationId: INSTALLATION_ID,
      body: provisionBody,
      idempotencyKey: "idem-1",
    });

    expect(VercelMarketplaceResources.provision).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: "res_earlier",
        purchase: earlier,
      }),
    );
    expect(GlobalCache.setString).not.toHaveBeenCalled();
  });

  it("makes a OneUptime account, verified, for someone who has none", async () => {
    mocked(UserService.findOneBy).mockResolvedValue(null);
    mocked(UserService.createByEmail).mockResolvedValue(user());

    await VercelMarketplaceProvider.provisionResource({
      caller: admin(),
      installationId: INSTALLATION_ID,
      body: provisionBody,
    });

    expect(UserService.createByEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        isEmailVerified: true,
        generateRandomPassword: true,
      }),
    );
  });

  it("says what is wrong with the request, field by field", async () => {
    const err: VercelProviderError = await expectError(
      VercelMarketplaceProvider.provisionResource({
        caller: admin(),
        installationId: INSTALLATION_ID,
        body: { name: " ", billingPlanId: "enterprise" },
      }),
      "validation_error",
    );

    expect(err.getStatus()).toBe(400);
    expect(
      (err.fields || []).map((field: { key: string }) => {
        return field.key;
      }),
    ).toEqual(["name", "billingPlanId", "productId"]);

    await expectError(
      VercelMarketplaceProvider.provisionResource({
        caller: admin(),
        installationId: INSTALLATION_ID,
        body: { ...provisionBody, name: "x".repeat(101) },
      }),
      "validation_error",
    );
  });

  it("takes a Vercel admin to add a resource", async () => {
    await expectError(
      VercelMarketplaceProvider.provisionResource({
        caller: admin({ userRole: "USER" }),
        installationId: INSTALLATION_ID,
        body: provisionBody,
      }),
      "forbidden",
    );

    await expectError(
      VercelMarketplaceProvider.provisionResource({
        caller: system,
        installationId: INSTALLATION_ID,
        body: provisionBody,
      }),
      "forbidden",
    );

    expect(VercelMarketplaceResources.provision).not.toHaveBeenCalled();
  });

  it("needs an email address Vercel verified, on an account that is not blocked and verified its own", async () => {
    const unverified: VercelProviderError = await expectError(
      VercelMarketplaceProvider.provisionResource({
        caller: admin({ isUserEmailVerified: false }),
        installationId: INSTALLATION_ID,
        body: provisionBody,
      }),
      "forbidden",
    );
    expect(unverified.userMessage).toContain("verified email address");

    mocked(UserService.findOneBy).mockResolvedValue(user({ isBlocked: true }));

    await expectError(
      VercelMarketplaceProvider.provisionResource({
        caller: admin(),
        installationId: INSTALLATION_ID,
        body: provisionBody,
      }),
      "forbidden",
    );

    // An account nobody verified may not be its address's owner's: no project is given to it.
    mocked(UserService.findOneBy).mockResolvedValue(
      user({ isEmailVerified: false }),
    );

    const squatted: VercelProviderError = await expectError(
      VercelMarketplaceProvider.provisionResource({
        caller: admin(),
        installationId: INSTALLATION_ID,
        body: provisionBody,
      }),
      "forbidden",
    );
    expect(squatted.userMessage).toContain("not verified");

    mocked(UserService.findOneBy).mockResolvedValue(null);
    mocked(DatabaseConfig.shouldDisableSignup).mockResolvedValue(true);

    await expectError(
      VercelMarketplaceProvider.provisionResource({
        caller: admin(),
        installationId: INSTALLATION_ID,
        body: provisionBody,
      }),
      "forbidden",
    );

    expect(VercelMarketplaceResources.provision).not.toHaveBeenCalled();
  });

  it("refuses a resource for an uninstalled or unknown installation", async () => {
    mocked(
      VercelMarketplaceInstallationService.findByInstallationId,
    ).mockResolvedValue(
      installation({ status: VercelInstallationStatus.DeletePending }),
    );

    await expectError(
      VercelMarketplaceProvider.provisionResource({
        caller: admin(),
        installationId: INSTALLATION_ID,
        body: provisionBody,
      }),
      "conflict",
    );

    mocked(
      VercelMarketplaceInstallationService.findByInstallationId,
    ).mockResolvedValue(null);

    await expectError(
      VercelMarketplaceProvider.provisionResource({
        caller: admin(),
        installationId: INSTALLATION_ID,
        body: provisionBody,
      }),
      "not_found",
    );
  });
});

describe("VercelMarketplaceProvider.updateResource", () => {
  beforeEach(() => {
    mocked(VercelMarketplaceResources.findPurchase).mockResolvedValue(
      resourcePurchase(),
    );
    mocked(VercelMarketplaceResources.saveDetails).mockImplementation(
      async (purchase: unknown, details: unknown): Promise<unknown> => {
        return Object.assign(purchase as MarketplaceSubscription, {
          details: details,
        });
      },
    );
    mocked(MarketplacePurchases.updatePurchase).mockImplementation(
      async (purchase: unknown, facts: unknown): Promise<unknown> => {
        return Object.assign(purchase as MarketplaceSubscription, facts);
      },
    );
  });

  it("renames the project with the resource, and turns the domain monitors on", async () => {
    const response: JSONObject = await VercelMarketplaceProvider.updateResource(
      {
        caller: admin(),
        installationId: INSTALLATION_ID,
        resourceId: "res_1",
        body: {
          name: "Storefront EU",
          metadata: { monitorProductionDomains: true },
        },
      },
    );

    expect(ProjectService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: "Storefront EU" } }),
    );
    expect(VercelMarketplaceMonitors.addMissingMonitors).toHaveBeenCalled();
    expect(response).toMatchObject({
      name: "Storefront EU",
      metadata: { monitorProductionDomains: true },
    });
  });

  it("moves the project to the plan chosen in Vercel, without telling Vercel back", async () => {
    await VercelMarketplaceProvider.updateResource({
      caller: admin(),
      installationId: INSTALLATION_ID,
      resourceId: "res_1",
      body: { billingPlanId: "growth" },
    });

    expect(MarketplacePurchases.updatePurchase).toHaveBeenCalledWith(
      expect.anything(),
      { externalPlanId: "growth" },
    );
    expect(ProjectService.changePlan).toHaveBeenCalledWith(
      expect.objectContaining({ paymentProviderPlanId: "growth_monthly" }),
    );
    // The purchase knew the new plan before the project changed to it.
    expect(
      mocked(MarketplacePurchases.updatePurchase).mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocked(ProjectService.changePlan).mock.invocationCallOrder[0]!,
    );
  });

  it("refuses a plan OneUptime does not sell there, and a deleted resource", async () => {
    await expectError(
      VercelMarketplaceProvider.updateResource({
        caller: admin(),
        installationId: INSTALLATION_ID,
        resourceId: "res_1",
        body: { billingPlanId: "enterprise" },
      }),
      "validation_error",
    );

    mocked(VercelMarketplaceResources.findPurchase).mockResolvedValue(
      resourcePurchase({ status: MarketplaceSubscriptionStatus.Cancelled }),
    );

    await expectError(
      VercelMarketplaceProvider.updateResource({
        caller: admin(),
        installationId: INSTALLATION_ID,
        resourceId: "res_1",
        body: { name: "x" },
      }),
      "conflict",
    );
  });
});

describe("VercelMarketplaceProvider: deleting", () => {
  it("deprovisions a resource Vercel deletes, and is done with one it does not know", async () => {
    const purchase: MarketplaceSubscription = resourcePurchase();
    mocked(VercelMarketplaceResources.findPurchase).mockResolvedValueOnce(
      purchase,
    );

    await VercelMarketplaceProvider.deleteResource({
      caller: system,
      installationId: INSTALLATION_ID,
      resourceId: "res_1",
    });

    expect(VercelMarketplaceResources.deprovision).toHaveBeenCalledWith(
      purchase,
    );

    mocked(VercelMarketplaceResources.findPurchase).mockResolvedValueOnce(null);

    await VercelMarketplaceProvider.deleteResource({
      caller: admin(),
      installationId: INSTALLATION_ID,
      resourceId: "res_gone",
    });

    expect(VercelMarketplaceResources.deprovision).toHaveBeenCalledTimes(1);

    await expectError(
      VercelMarketplaceProvider.deleteResource({
        caller: admin({ userRole: "USER" }),
        installationId: INSTALLATION_ID,
        resourceId: "res_1",
      }),
      "forbidden",
    );
  });

  it("answers an uninstall with whether billing is finalized", async () => {
    mocked(VercelMarketplaceBilling.requestDeletion).mockResolvedValue(false);

    expect(
      await VercelMarketplaceProvider.deleteInstallation({
        caller: admin(),
        installationId: INSTALLATION_ID,
      }),
    ).toEqual({ finalized: false });

    mocked(
      VercelMarketplaceInstallationService.findByInstallationId,
    ).mockResolvedValue(null);

    expect(
      await VercelMarketplaceProvider.deleteInstallation({
        caller: system,
        installationId: INSTALLATION_ID,
      }),
    ).toEqual({ finalized: true });
  });
});

describe("VercelMarketplaceProvider.rotateSecrets", () => {
  it("rotates at once, keeping the old key for the hours Vercel asks", async () => {
    const purchase: MarketplaceSubscription = resourcePurchase();
    mocked(VercelMarketplaceResources.findPurchase).mockResolvedValue(purchase);
    mocked(VercelMarketplaceResources.rotateSecrets).mockResolvedValue([
      { name: "ONEUPTIME_TELEMETRY_INGESTION_KEY", value: "new" },
    ]);

    expect(
      await VercelMarketplaceProvider.rotateSecrets({
        caller: system,
        installationId: INSTALLATION_ID,
        resourceId: "res_1",
        body: { delayOldSecretsExpirationHours: 24 },
      }),
    ).toEqual({
      sync: true,
      secrets: [{ name: "ONEUPTIME_TELEMETRY_INGESTION_KEY", value: "new" }],
    });

    expect(VercelMarketplaceResources.rotateSecrets).toHaveBeenCalledWith({
      purchase: purchase,
      keepOldKeyForHours: 24,
    });
  });

  it("refuses to rotate the secrets of a deleted resource", async () => {
    mocked(VercelMarketplaceResources.findPurchase).mockResolvedValue(
      resourcePurchase({ status: MarketplaceSubscriptionStatus.Cancelled }),
    );

    await expectError(
      VercelMarketplaceProvider.rotateSecrets({
        caller: system,
        installationId: INSTALLATION_ID,
        resourceId: "res_1",
        body: {},
      }),
      "conflict",
    );
  });
});

describe("VercelProviderError", () => {
  it("answers in Vercel's error shape, with the person's message where there is one", () => {
    const err: VercelProviderError = new VercelProviderError({
      code: "forbidden",
      message: "Only a team admin may do this.",
      userMessage: "Only an owner of the Vercel team can do this.",
    });

    expect(err.getStatus()).toBe(403);
    expect(err.toJSON()).toEqual({
      error: {
        code: "forbidden",
        message: "Only a team admin may do this.",
        user: { message: "Only an owner of the Vercel team can do this." },
      },
    });

    expect(
      new VercelProviderError({ code: "not_found", message: "x" }).getStatus(),
    ).toBe(404);
    expect(
      new VercelProviderError({ code: "conflict", message: "x" }).getStatus(),
    ).toBe(409);
  });
});

describe("VercelMarketplaceProvider.listPlans", () => {
  it("lists OneUptime's plans", () => {
    expect(
      VercelMarketplaceProvider.listPlans().plans.map(
        (plan: { id: string }) => {
          return plan.id;
        },
      ),
    ).toEqual(["free", "growth"]);
  });
});
