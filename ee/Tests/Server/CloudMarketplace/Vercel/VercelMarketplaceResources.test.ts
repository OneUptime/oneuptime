import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import Project from "Common/Models/DatabaseModels/Project";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import VercelMarketplaceInstallation from "Common/Models/DatabaseModels/VercelMarketplaceInstallation";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import OneUptimeDate from "Common/Types/Date";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import VercelInstallationStatus from "Common/Types/Marketplace/VercelInstallationStatus";
import ObjectID from "Common/Types/ObjectID";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import MarketplaceSubscriptionService from "Common/Server/Services/MarketplaceSubscriptionService";
import MarketplacePurchases from "../../../../Server/CloudMarketplace/MarketplacePurchases";
import ProjectService from "Common/Server/Services/ProjectService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import VercelMarketplaceConnectionService from "Common/Server/Services/VercelMarketplaceConnectionService";
import VercelMarketplaceInstallationService from "Common/Server/Services/VercelMarketplaceInstallationService";
import MarketplacePurchaseClaim from "../../../../Server/CloudMarketplace/MarketplacePurchaseClaim";
import MarketplaceUsageReporter from "../../../../Server/CloudMarketplace/MarketplaceUsageReporter";
import VercelMarketplaceAPI from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceAPI";
import VercelMarketplacePlans from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplacePlans";
import VercelMarketplaceResources, {
  DELETED_FROM_VERCEL_REASON,
  ProvisionedVercelResource,
} from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceResources";
import logger from "Common/Server/Utils/Logger";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * What becomes of a Vercel resource: made with its project, ingestion key
 * and status page - each only once, however often Vercel asks - given new
 * secrets, and deleted after its final usage is billed. Deleting its
 * project in OneUptime deletes it on Vercel, and changing the project's
 * plan changes it there.
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

jest.mock("Common/Server/Services/MarketplaceSubscriptionService", () => {
  return {
    __esModule: true,
    default: {
      findPurchase: jest.fn(),
      findPurchaseById: jest.fn(),
      findPurchaseForProject: jest.fn(),
      findBy: jest.fn(),
      getPurchaseSelect: jest.fn().mockReturnValue({ _id: true }),
    },
  };
});

jest.mock("../../../../Server/CloudMarketplace/MarketplacePurchases", () => {
  return {
    __esModule: true,
    default: {
      recordPurchase: jest.fn(),
      updatePurchase: jest.fn(),
      linkToProject: jest.fn(),
      unlinkProject: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), deleteOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/StatusPageService", () => {
  return {
    __esModule: true,
    default: { create: jest.fn() },
  };
});

jest.mock("Common/Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
      findOneById: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/VercelMarketplaceConnectionService", () => {
  return {
    __esModule: true,
    default: { deleteBy: jest.fn() },
  };
});

jest.mock("Common/Server/Services/VercelMarketplaceInstallationService", () => {
  return {
    __esModule: true,
    default: { findByInstallationId: jest.fn() },
  };
});

jest.mock(
  "../../../../Server/CloudMarketplace/MarketplacePurchaseClaim",
  () => {
    return {
      __esModule: true,
      default: { createProject: jest.fn() },
    };
  },
);

jest.mock(
  "../../../../Server/CloudMarketplace/MarketplaceUsageReporter",
  () => {
    return {
      __esModule: true,
      default: { reportFinalUsage: jest.fn() },
    };
  },
);

const mocked: (fn: unknown) => jest.Mock = (fn: unknown): jest.Mock => {
  return fn as jest.Mock;
};

const INSTALLATION_ID: string = "icfg_acme";
const OWNER_ID: ObjectID = ObjectID.generate();
const PROJECT_ID: ObjectID = ObjectID.generate();
const KEY_ID: ObjectID = ObjectID.generate();
const KEY_SECRET: ObjectID = ObjectID.generate();
const STATUS_PAGE_ID: ObjectID = ObjectID.generate();

const growth: () => SubscriptionPlan = (): SubscriptionPlan => {
  return VercelMarketplacePlans.findPlan("growth")!;
};

const installation: () => VercelMarketplaceInstallation =
  (): VercelMarketplaceInstallation => {
    return Object.assign(new VercelMarketplaceInstallation(), {
      _id: ObjectID.generate().toString(),
      installationId: INSTALLATION_ID,
      accessToken: "vercel-token",
      status: VercelInstallationStatus.Active,
    });
  };

const purchase: (
  overrides?: Partial<Record<keyof MarketplaceSubscription, unknown>>,
) => MarketplaceSubscription = (
  overrides?: Partial<Record<keyof MarketplaceSubscription, unknown>>,
): MarketplaceSubscription => {
  return Object.assign(new MarketplaceSubscription(), {
    _id: "6720a1b2-0000-4000-8000-000000000009",
    marketplace: CloudMarketplace.Vercel,
    externalSubscriptionId: "res_1",
    externalCustomerId: INSTALLATION_ID,
    externalPlanId: "growth",
    status: MarketplaceSubscriptionStatus.Active,
    linkedByUserId: OWNER_ID,
    details: { name: "Storefront", productId: "oneuptime", metadata: {} },
    ...overrides,
  });
};

let api: { deleteResource: jest.Mock; sendResourceUpdated: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();

  api = {
    deleteResource: jest.fn().mockResolvedValue(undefined),
    sendResourceUpdated: jest.fn().mockResolvedValue(undefined),
  };
  jest
    .spyOn(VercelMarketplaceAPI.prototype, "deleteResource")
    .mockImplementation(api.deleteResource);
  jest
    .spyOn(VercelMarketplaceAPI.prototype, "sendResourceUpdated")
    .mockImplementation(api.sendResourceUpdated);

  // The purchase as recorded, read back with its project once it is linked.
  let recorded: MarketplaceSubscription = purchase();

  mocked(MarketplacePurchases.recordPurchase).mockImplementation(
    async (facts: unknown): Promise<MarketplaceSubscription> => {
      recorded = purchase({
        details: (facts as { details: Record<string, unknown> }).details,
      });
      return recorded;
    },
  );
  mocked(MarketplaceSubscriptionService.findPurchaseById).mockImplementation(
    async (): Promise<MarketplaceSubscription> => {
      return purchase({ projectId: PROJECT_ID, details: recorded.details });
    },
  );
  mocked(MarketplacePurchases.updatePurchase).mockImplementation(
    async (current: unknown, facts: unknown): Promise<unknown> => {
      return Object.assign(
        new MarketplaceSubscription(),
        current as MarketplaceSubscription,
        facts,
      );
    },
  );
  mocked(MarketplacePurchaseClaim.createProject).mockResolvedValue(PROJECT_ID);

  mocked(TelemetryIngestionKeyService.create).mockResolvedValue(
    Object.assign(new TelemetryIngestionKey(), { _id: KEY_ID.toString() }),
  );
  mocked(TelemetryIngestionKeyService.findOneById).mockResolvedValue(
    Object.assign(new TelemetryIngestionKey(), {
      _id: KEY_ID.toString(),
      secretKey: KEY_SECRET,
    }),
  );
  mocked(StatusPageService.create).mockResolvedValue(
    Object.assign(new StatusPage(), { _id: STATUS_PAGE_ID.toString() }),
  );
  mocked(
    VercelMarketplaceInstallationService.findByInstallationId,
  ).mockResolvedValue(installation());

  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("VercelMarketplaceResources.provision", () => {
  it("makes the purchase, a project on the plan, an ingestion key and a public status page", async () => {
    const provisioned: ProvisionedVercelResource =
      await VercelMarketplaceResources.provision({
        installation: installation(),
        resourceId: "res_1",
        productId: "oneuptime",
        name: "Storefront",
        metadata: { createStatusPage: true, injected: "x" },
        plan: growth(),
        ownerUserId: OWNER_ID,
        ownerEmail: "ada@example.com",
        vercelUserId: "user_ada",
      });

    expect(MarketplacePurchases.recordPurchase).toHaveBeenCalledWith({
      marketplace: CloudMarketplace.Vercel,
      externalSubscriptionId: "res_1",
      externalCustomerId: INSTALLATION_ID,
      externalOfferId: "oneuptime",
      externalPlanId: "growth",
      purchaserEmail: "ada@example.com",
      details: {
        name: "Storefront",
        productId: "oneuptime",
        metadata: { createStatusPage: true },
        provisionedByVercelUserId: "user_ada",
      },
    });

    expect(MarketplacePurchaseClaim.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OWNER_ID, name: "Storefront" }),
    );
    expect(MarketplacePurchases.linkToProject).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        userId: OWNER_ID,
        status: MarketplaceSubscriptionStatus.Active,
      }),
    );

    const key: TelemetryIngestionKey = mocked(
      TelemetryIngestionKeyService.create,
    ).mock.calls[0]![0].data;
    expect(key).toMatchObject({
      projectId: PROJECT_ID,
      name: "Vercel",
      keyType: TelemetryIngestionKeyType.Server,
      createdByUserId: OWNER_ID,
    });

    const page: StatusPage = mocked(StatusPageService.create).mock.calls[0]![0]
      .data;
    expect(page).toMatchObject({
      projectId: PROJECT_ID,
      name: "Storefront",
      isPublicStatusPage: true,
    });

    expect(provisioned.secrets).toContainEqual({
      name: "OTEL_EXPORTER_OTLP_HEADERS",
      value: `x-oneuptime-token=${KEY_SECRET.toString()}`,
    });
    expect(provisioned.purchase.details).toMatchObject({
      telemetryIngestionKeyId: KEY_ID.toString(),
      statusPageId: STATUS_PAGE_ID.toString(),
    });
  });

  it("finishes a provisioning that stopped part way, making only what is missing", async () => {
    const started: MarketplaceSubscription = purchase({
      projectId: PROJECT_ID,
      details: {
        name: "Storefront",
        productId: "oneuptime",
        metadata: {},
        telemetryIngestionKeyId: KEY_ID.toString(),
      },
    });

    const provisioned: ProvisionedVercelResource =
      await VercelMarketplaceResources.provision({
        installation: installation(),
        purchase: started,
        resourceId: "res_1",
        productId: "oneuptime",
        name: "Storefront",
        metadata: {},
        plan: growth(),
        ownerUserId: OWNER_ID,
      });

    expect(MarketplacePurchases.recordPurchase).not.toHaveBeenCalled();
    expect(MarketplacePurchaseClaim.createProject).not.toHaveBeenCalled();
    expect(TelemetryIngestionKeyService.create).not.toHaveBeenCalled();
    // Its status page had not been made yet.
    expect(StatusPageService.create).toHaveBeenCalledTimes(1);
    expect(provisioned.secrets).toContainEqual({
      name: "ONEUPTIME_TELEMETRY_INGESTION_KEY",
      value: KEY_SECRET.toString(),
    });
  });

  it("makes no status page when the team turned it off, and never fails because of one", async () => {
    await VercelMarketplaceResources.provision({
      installation: installation(),
      resourceId: "res_1",
      productId: "oneuptime",
      name: "Storefront",
      metadata: { createStatusPage: false },
      plan: growth(),
      ownerUserId: OWNER_ID,
    });

    expect(StatusPageService.create).not.toHaveBeenCalled();

    mocked(StatusPageService.create).mockRejectedValue(new Error("plan limit"));

    const provisioned: ProvisionedVercelResource =
      await VercelMarketplaceResources.provision({
        installation: installation(),
        resourceId: "res_1",
        productId: "oneuptime",
        name: "Storefront",
        metadata: {},
        plan: growth(),
        ownerUserId: OWNER_ID,
      });

    expect(provisioned.secrets.length).toBeGreaterThan(0);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("VercelMarketplaceResources.rotateSecrets", () => {
  const withKey: () => MarketplaceSubscription =
    (): MarketplaceSubscription => {
      return purchase({
        projectId: PROJECT_ID,
        details: {
          name: "Storefront",
          productId: "oneuptime",
          metadata: {},
          telemetryIngestionKeyId: "old-key-id",
        },
      });
    };

  it("makes a new key, and keeps the old one working for the hours asked", async () => {
    const now: Date = new Date("2026-10-18T10:00:00.000Z");
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(now);

    await VercelMarketplaceResources.rotateSecrets({
      purchase: withKey(),
      keepOldKeyForHours: 2,
    });

    expect(TelemetryIngestionKeyService.create).toHaveBeenCalledTimes(1);
    expect(TelemetryIngestionKeyService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: new ObjectID("old-key-id"),
        data: { expiresAt: new Date("2026-10-18T12:00:00.000Z") },
      }),
    );
    expect(MarketplacePurchases.updatePurchase).toHaveBeenCalledWith(
      expect.anything(),
      {
        details: expect.objectContaining({
          telemetryIngestionKeyId: KEY_ID.toString(),
        }),
      },
    );
  });

  it("turns the old key off at once when it is kept for no time", async () => {
    await VercelMarketplaceResources.rotateSecrets({
      purchase: withKey(),
      keepOldKeyForHours: 0,
    });

    expect(TelemetryIngestionKeyService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isEnabled: false } }),
    );
  });
});

describe("VercelMarketplaceResources.deprovision", () => {
  it("stops the telemetry, bills the final usage, ends the purchase, then deletes the project", async () => {
    const active: MarketplaceSubscription = purchase({
      projectId: PROJECT_ID,
      details: {
        name: "Storefront",
        productId: "oneuptime",
        metadata: {},
        telemetryIngestionKeyId: KEY_ID.toString(),
      },
    });

    mocked(ProjectService.findOneById).mockResolvedValue(
      Object.assign(new Project(), { _id: PROJECT_ID.toString() }),
    );

    await VercelMarketplaceResources.deprovision(active);

    expect(TelemetryIngestionKeyService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isEnabled: false } }),
    );
    expect(MarketplaceUsageReporter.reportFinalUsage).toHaveBeenCalledWith(
      active,
    );
    expect(MarketplacePurchases.updatePurchase).toHaveBeenCalledWith(active, {
      status: MarketplaceSubscriptionStatus.Cancelled,
      externalState: "deleted",
    });
    expect(VercelMarketplaceConnectionService.deleteBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { marketplaceSubscriptionId: active.id },
      }),
    );
    expect(ProjectService.deleteOneById).toHaveBeenCalledWith({
      id: PROJECT_ID,
      deletionReason: DELETED_FROM_VERCEL_REASON,
      props: { isRoot: true },
    });

    // Billed before it was ended, and ended before its project was deleted.
    const order: Array<number> = [
      mocked(MarketplaceUsageReporter.reportFinalUsage).mock
        .invocationCallOrder[0]!,
      mocked(MarketplacePurchases.updatePurchase).mock.invocationCallOrder[0]!,
      mocked(ProjectService.deleteOneById).mock.invocationCallOrder[0]!,
    ];
    expect(
      [...order].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(order);
  });

  it("only deletes the project of a resource that has ended already", async () => {
    mocked(ProjectService.findOneById).mockResolvedValue(
      Object.assign(new Project(), { _id: PROJECT_ID.toString() }),
    );

    await VercelMarketplaceResources.deprovision(
      purchase({
        status: MarketplaceSubscriptionStatus.Cancelled,
        projectId: PROJECT_ID,
      }),
    );

    expect(MarketplaceUsageReporter.reportFinalUsage).not.toHaveBeenCalled();
    expect(MarketplacePurchases.updatePurchase).not.toHaveBeenCalled();
    expect(ProjectService.deleteOneById).toHaveBeenCalledTimes(1);
  });

  it("unlinks a project that is gone already instead of deleting it", async () => {
    mocked(ProjectService.findOneById).mockResolvedValue(null);

    await VercelMarketplaceResources.deprovision(
      purchase({
        status: MarketplaceSubscriptionStatus.Cancelled,
        projectId: PROJECT_ID,
      }),
    );

    expect(ProjectService.deleteOneById).not.toHaveBeenCalled();
    expect(MarketplacePurchases.unlinkProject).toHaveBeenCalledWith(PROJECT_ID);
  });

  it("bills no final usage for a suspended resource, which is not billing", async () => {
    mocked(ProjectService.findOneById).mockResolvedValue(null);

    await VercelMarketplaceResources.deprovision(
      purchase({
        status: MarketplaceSubscriptionStatus.Suspended,
        projectId: PROJECT_ID,
      }),
    );

    expect(MarketplaceUsageReporter.reportFinalUsage).not.toHaveBeenCalled();
    expect(MarketplacePurchases.updatePurchase).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: MarketplaceSubscriptionStatus.Cancelled,
      }),
    );
  });
});

describe("VercelMarketplaceResources.onProjectDeleted", () => {
  it("deletes the resource on Vercel when its project is deleted in OneUptime", async () => {
    mocked(
      MarketplaceSubscriptionService.findPurchaseForProject,
    ).mockResolvedValue(purchase({ projectId: PROJECT_ID }));

    await VercelMarketplaceResources.onProjectDeleted(PROJECT_ID);

    expect(MarketplacePurchases.updatePurchase).toHaveBeenCalledWith(
      expect.anything(),
      {
        status: MarketplaceSubscriptionStatus.Cancelled,
        externalState: "project-deleted",
      },
    );
    expect(api.deleteResource).toHaveBeenCalledWith(
      { installationId: INSTALLATION_ID, accessToken: "vercel-token" },
      "res_1",
    );
  });

  it("sends Vercel nothing for a resource Vercel deleted itself, or one that is not Vercel's", async () => {
    mocked(
      MarketplaceSubscriptionService.findPurchaseForProject,
    ).mockResolvedValueOnce(
      purchase({ status: MarketplaceSubscriptionStatus.Cancelled }),
    );
    await VercelMarketplaceResources.onProjectDeleted(PROJECT_ID);

    mocked(
      MarketplaceSubscriptionService.findPurchaseForProject,
    ).mockResolvedValueOnce(purchase({ marketplace: CloudMarketplace.AWS }));
    await VercelMarketplaceResources.onProjectDeleted(PROJECT_ID);

    expect(api.deleteResource).not.toHaveBeenCalled();
    expect(MarketplacePurchases.updatePurchase).not.toHaveBeenCalled();
  });

  it("never fails the delete because Vercel did not answer", async () => {
    mocked(
      MarketplaceSubscriptionService.findPurchaseForProject,
    ).mockResolvedValue(purchase({ projectId: PROJECT_ID }));
    api.deleteResource.mockRejectedValue(new Error("Vercel down"));

    await VercelMarketplaceResources.onProjectDeleted(PROJECT_ID);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Delete it in the team's Vercel dashboard"),
    );
  });
});

describe("VercelMarketplaceResources.onPlanChanged", () => {
  it("tells Vercel the resource's new plan when it changed in OneUptime", async () => {
    mocked(
      MarketplaceSubscriptionService.findPurchaseForProject,
    ).mockResolvedValue(purchase({ externalPlanId: "free" }));

    await VercelMarketplaceResources.onPlanChanged({
      projectId: PROJECT_ID,
      paymentProviderPlanId: "growth_monthly",
    });

    expect(MarketplacePurchases.updatePurchase).toHaveBeenCalledWith(
      expect.anything(),
      { externalPlanId: "growth" },
    );
    expect(api.sendResourceUpdated).toHaveBeenCalledWith(
      { installationId: INSTALLATION_ID, accessToken: "vercel-token" },
      "res_1",
    );
  });

  it("sends nothing back for a change Vercel asked for itself", async () => {
    mocked(
      MarketplaceSubscriptionService.findPurchaseForProject,
    ).mockResolvedValue(purchase({ externalPlanId: "growth" }));

    await VercelMarketplaceResources.onPlanChanged({
      projectId: PROJECT_ID,
      paymentProviderPlanId: "growth_monthly",
    });

    expect(api.sendResourceUpdated).not.toHaveBeenCalled();
  });
});

describe("VercelMarketplaceResources.findPurchase", () => {
  it("reaches a resource only through its own installation", async () => {
    mocked(MarketplaceSubscriptionService.findPurchase).mockResolvedValue(
      purchase(),
    );

    expect(
      await VercelMarketplaceResources.findPurchase({
        installationId: INSTALLATION_ID,
        resourceId: "res_1",
      }),
    ).not.toBeNull();

    expect(
      await VercelMarketplaceResources.findPurchase({
        installationId: "icfg_other_team",
        resourceId: "res_1",
      }),
    ).toBeNull();

    expect(MarketplaceSubscriptionService.findPurchase).toHaveBeenCalledWith({
      marketplace: CloudMarketplace.Vercel,
      externalSubscriptionId: "res_1",
    });
  });
});
