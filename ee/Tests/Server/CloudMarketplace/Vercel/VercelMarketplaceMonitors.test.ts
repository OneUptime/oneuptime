import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import VercelMarketplaceConnection from "Common/Models/DatabaseModels/VercelMarketplaceConnection";
import VercelMarketplaceInstallation from "Common/Models/DatabaseModels/VercelMarketplaceInstallation";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import AlertSeverityService from "Common/Server/Services/AlertSeverityService";
import IncidentSeverityService from "Common/Server/Services/IncidentSeverityService";
import MarketplaceSubscriptionService from "Common/Server/Services/MarketplaceSubscriptionService";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import VercelMarketplaceConnectionService from "Common/Server/Services/VercelMarketplaceConnectionService";
import VercelMarketplaceInstallationService from "Common/Server/Services/VercelMarketplaceInstallationService";
import VercelMarketplaceAPI from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceAPI";
import VercelMarketplaceMonitors from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceMonitors";
import VercelMarketplaceResources from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceResources";
import logger from "Common/Server/Utils/Logger";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * A Vercel project connected to a OneUptime resource is watched: a website
 * monitor for its production domain, on the resource's status page - made
 * when the project is connected, or at its first production deployment if
 * it had no domain yet - and deleted when it is disconnected.
 */

jest.mock(
  "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceResources",
  () => {
    return {
      __esModule: true,
      default: { findPurchase: jest.fn() },
    };
  },
);

jest.mock("Common/Server/Services/VercelMarketplaceConnectionService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      findBy: jest.fn(),
      create: jest.fn(),
      updateOneById: jest.fn(),
      deleteOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: { create: jest.fn(), deleteOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/StatusPageResourceService", () => {
  return {
    __esModule: true,
    default: { create: jest.fn() },
  };
});

jest.mock("Common/Server/Services/MonitorStatusService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/IncidentSeverityService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/AlertSeverityService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/MarketplaceSubscriptionService", () => {
  return { __esModule: true, default: { findPurchaseById: jest.fn() } };
});

jest.mock("Common/Server/Services/VercelMarketplaceInstallationService", () => {
  return { __esModule: true, default: { findByInstallationId: jest.fn() } };
});

const mocked: (fn: unknown) => jest.Mock = (fn: unknown): jest.Mock => {
  return fn as jest.Mock;
};

const PROJECT_ID: ObjectID = ObjectID.generate();
const STATUS_PAGE_ID: ObjectID = ObjectID.generate();
const MONITOR_ID: ObjectID = ObjectID.generate();

const purchase: (
  metadata?: Record<string, unknown>,
  overrides?: Partial<Record<keyof MarketplaceSubscription, unknown>>,
) => MarketplaceSubscription = (
  metadata?: Record<string, unknown>,
  overrides?: Partial<Record<keyof MarketplaceSubscription, unknown>>,
): MarketplaceSubscription => {
  return Object.assign(new MarketplaceSubscription(), {
    _id: "6720a1b2-0000-4000-8000-00000000000a",
    marketplace: CloudMarketplace.Vercel,
    externalSubscriptionId: "res_1",
    externalCustomerId: "icfg_acme",
    status: MarketplaceSubscriptionStatus.Active,
    projectId: PROJECT_ID,
    details: {
      name: "Storefront",
      productId: "oneuptime",
      metadata: metadata || {},
      statusPageId: STATUS_PAGE_ID.toString(),
    },
    ...overrides,
  });
};

const connection: (
  overrides?: Partial<Record<keyof VercelMarketplaceConnection, unknown>>,
) => VercelMarketplaceConnection = (
  overrides?: Partial<Record<keyof VercelMarketplaceConnection, unknown>>,
): VercelMarketplaceConnection => {
  return Object.assign(new VercelMarketplaceConnection(), {
    _id: ObjectID.generate().toString(),
    marketplaceSubscriptionId: new ObjectID(
      "6720a1b2-0000-4000-8000-00000000000a",
    ),
    projectId: PROJECT_ID,
    vercelProjectId: "prj_1",
    vercelProjectName: "storefront",
    ...overrides,
  });
};

beforeEach(() => {
  jest.clearAllMocks();

  mocked(VercelMarketplaceResources.findPurchase).mockResolvedValue(purchase());
  mocked(VercelMarketplaceConnectionService.findOneBy).mockResolvedValue(null);
  mocked(VercelMarketplaceConnectionService.create).mockImplementation(
    async (data: unknown): Promise<VercelMarketplaceConnection> => {
      return Object.assign(
        new VercelMarketplaceConnection(),
        (data as { data: VercelMarketplaceConnection }).data,
        { _id: ObjectID.generate().toString() },
      );
    },
  );
  mocked(MonitorService.create).mockResolvedValue(
    Object.assign(new Monitor(), { _id: MONITOR_ID.toString() }),
  );
  mocked(MonitorStatusService.findBy).mockResolvedValue([
    Object.assign(new MonitorStatus(), {
      _id: ObjectID.generate().toString(),
      isOperationalState: true,
    }),
    Object.assign(new MonitorStatus(), {
      _id: ObjectID.generate().toString(),
      isOfflineState: true,
    }),
  ]);
  mocked(IncidentSeverityService.findBy).mockResolvedValue([
    Object.assign(new IncidentSeverity(), {
      _id: ObjectID.generate().toString(),
    }),
  ]);
  mocked(AlertSeverityService.findBy).mockResolvedValue([
    Object.assign(new AlertSeverity(), { _id: ObjectID.generate().toString() }),
    Object.assign(new AlertSeverity(), { _id: ObjectID.generate().toString() }),
  ]);

  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("VercelMarketplaceMonitors.normalizeDomain", () => {
  it("takes a host name, as Vercel names a domain, and nothing else", () => {
    expect(VercelMarketplaceMonitors.normalizeDomain("Shop.Acme.COM")).toBe(
      "shop.acme.com",
    );
    expect(
      VercelMarketplaceMonitors.normalizeDomain("https://shop.acme.com/x"),
    ).toBe("shop.acme.com");
    expect(VercelMarketplaceMonitors.normalizeDomain("acme.com.")).toBe(
      "acme.com",
    );

    for (const value of [
      "",
      "localhost",
      "acme.com:8080",
      "bad host.com",
      "-acme.com",
      7,
      null,
      undefined,
    ]) {
      expect(VercelMarketplaceMonitors.normalizeDomain(value)).toBeNull();
    }
  });

  it("takes the host alone: everything from its first slash goes", () => {
    for (const [value, host] of [
      ["acme.com/", "acme.com"],
      ["acme.com/a/b/c", "acme.com"],
      ["https://acme.com//x", "acme.com"],
      ["acme.com./x", "acme.com"],
      ["http://shop.acme.com/x/y?z=1", "shop.acme.com"],
    ]) {
      expect([value, VercelMarketplaceMonitors.normalizeDomain(value)]).toEqual(
        [value, host],
      );
    }
  });

  it("a value with a line break in it is no domain, wherever the break is", () => {
    for (const value of [
      "acme.com/x\ny",
      "acme.com\nevil.com",
      "acme.com/x\ry",
      "acme.com/x\u2028y",
    ]) {
      expect(VercelMarketplaceMonitors.normalizeDomain(value)).toBeNull();
    }

    // Breaks and spaces around it are not part of it.
    expect(VercelMarketplaceMonitors.normalizeDomain("\n acme.com \n")).toBe(
      "acme.com",
    );
  });

  it.each([
    ["slashes then a line break", "/".repeat(400000) + "\n/", null],
    [
      "a host, slashes, a line break",
      "acme.com" + "/".repeat(400000) + "\n/",
      null,
    ],
    ["a host then slashes", "acme.com" + "/".repeat(400000), "acme.com"],
  ])(
    "reads %s, 400,000 characters, in time that grows with them",
    (_name: string, value: string, expected: string | null) => {
      const read: FastestRun<string | null> = fastestRun({
        run: (): string | null => {
          return VercelMarketplaceMonitors.normalizeDomain(value);
        },
        limitInMs: 2000,
      });

      expect(read.inMs).toBeLessThan(2000);
      expect(read.result).toBe(expected);
    },
  );
});

describe("VercelMarketplaceMonitors.onProjectConnected", () => {
  it("watches the project's production domain with a website monitor on the resource's status page", async () => {
    await VercelMarketplaceMonitors.onProjectConnected({
      installationId: "icfg_acme",
      resourceId: "res_1",
      vercelProjectId: "prj_1",
      vercelProjectName: "storefront",
      productionDomain: "storefront.vercel.app",
    });

    const created: VercelMarketplaceConnection = mocked(
      VercelMarketplaceConnectionService.create,
    ).mock.calls[0]![0].data;
    expect(created).toMatchObject({
      projectId: PROJECT_ID,
      vercelProjectId: "prj_1",
      vercelProjectName: "storefront",
      productionDomain: "storefront.vercel.app",
    });

    const monitor: Monitor = mocked(MonitorService.create).mock.calls[0]![0]
      .data;
    expect(monitor).toMatchObject({
      projectId: PROJECT_ID,
      name: "storefront",
      monitorType: MonitorType.Website,
    });
    expect(
      monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!.monitorDestination!.toString(),
    ).toBe("https://storefront.vercel.app/");
    expect(mocked(MonitorService.create).mock.calls[0]![0].props).toEqual({
      isRoot: true,
      tenantId: PROJECT_ID,
    });

    expect(
      VercelMarketplaceConnectionService.updateOneById,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ data: { monitorId: MONITOR_ID } }),
    );

    const resource: StatusPageResource = mocked(
      StatusPageResourceService.create,
    ).mock.calls[0]![0].data;
    expect(resource).toMatchObject({
      statusPageId: STATUS_PAGE_ID,
      monitorId: MONITOR_ID,
      displayName: "storefront",
      showCurrentStatus: true,
    });
  });

  it("makes no monitor when the resource's setting is off, but remembers the project", async () => {
    mocked(VercelMarketplaceResources.findPurchase).mockResolvedValue(
      purchase({ monitorProductionDomains: false }),
    );

    await VercelMarketplaceMonitors.onProjectConnected({
      installationId: "icfg_acme",
      resourceId: "res_1",
      vercelProjectId: "prj_1",
      productionDomain: "storefront.vercel.app",
    });

    expect(VercelMarketplaceConnectionService.create).toHaveBeenCalledTimes(1);
    expect(MonitorService.create).not.toHaveBeenCalled();
  });

  it("waits for a domain when the project has none yet", async () => {
    await VercelMarketplaceMonitors.onProjectConnected({
      installationId: "icfg_acme",
      resourceId: "res_1",
      vercelProjectId: "prj_1",
    });

    expect(VercelMarketplaceConnectionService.create).toHaveBeenCalledTimes(1);
    expect(MonitorService.create).not.toHaveBeenCalled();
  });

  it("makes one monitor however often Vercel tells it", async () => {
    mocked(VercelMarketplaceConnectionService.findOneBy).mockResolvedValue(
      connection({
        productionDomain: "storefront.vercel.app",
        monitorId: MONITOR_ID,
      }),
    );

    await VercelMarketplaceMonitors.onProjectConnected({
      installationId: "icfg_acme",
      resourceId: "res_1",
      vercelProjectId: "prj_1",
      productionDomain: "storefront.vercel.app",
    });

    expect(VercelMarketplaceConnectionService.create).not.toHaveBeenCalled();
    expect(MonitorService.create).not.toHaveBeenCalled();
  });

  it("does nothing for a resource that ended, or one it does not know", async () => {
    mocked(VercelMarketplaceResources.findPurchase).mockResolvedValueOnce(
      purchase({}, { status: MarketplaceSubscriptionStatus.Cancelled }),
    );
    await VercelMarketplaceMonitors.onProjectConnected({
      installationId: "icfg_acme",
      resourceId: "res_1",
      vercelProjectId: "prj_1",
      productionDomain: "storefront.vercel.app",
    });

    mocked(VercelMarketplaceResources.findPurchase).mockResolvedValueOnce(null);
    await VercelMarketplaceMonitors.onProjectConnected({
      installationId: "icfg_acme",
      resourceId: "res_unknown",
      vercelProjectId: "prj_1",
      productionDomain: "storefront.vercel.app",
    });

    expect(VercelMarketplaceConnectionService.create).not.toHaveBeenCalled();
  });

  it("keeps the connection when the plan does not allow another monitor", async () => {
    mocked(MonitorService.create).mockRejectedValue(
      new Error("This project has reached its active monitor limit."),
    );

    await VercelMarketplaceMonitors.onProjectConnected({
      installationId: "icfg_acme",
      resourceId: "res_1",
      vercelProjectId: "prj_1",
      productionDomain: "storefront.vercel.app",
    });

    expect(VercelMarketplaceConnectionService.create).toHaveBeenCalledTimes(1);
    expect(
      VercelMarketplaceConnectionService.updateOneById,
    ).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("active monitor limit"),
    );
  });
});

describe("VercelMarketplaceMonitors.onProjectDisconnected", () => {
  it("deletes the project's monitor and forgets the project", async () => {
    const existing: VercelMarketplaceConnection = connection({
      monitorId: MONITOR_ID,
    });
    mocked(VercelMarketplaceConnectionService.findOneBy).mockResolvedValue(
      existing,
    );

    await VercelMarketplaceMonitors.onProjectDisconnected({
      installationId: "icfg_acme",
      resourceId: "res_1",
      vercelProjectId: "prj_1",
    });

    expect(MonitorService.deleteOneById).toHaveBeenCalledWith({
      id: MONITOR_ID,
      props: { isRoot: true },
    });
    expect(
      VercelMarketplaceConnectionService.deleteOneById,
    ).toHaveBeenCalledWith(expect.objectContaining({ id: existing.id }));
  });
});

describe("VercelMarketplaceMonitors.onProductionDeployment", () => {
  it("makes the monitor of a project connected before it had a domain, from the domains Vercel lists", async () => {
    mocked(VercelMarketplaceConnectionService.findBy).mockResolvedValue([
      connection(),
    ]);
    mocked(MarketplaceSubscriptionService.findPurchaseById).mockResolvedValue(
      purchase(),
    );
    mocked(
      VercelMarketplaceInstallationService.findByInstallationId,
    ).mockResolvedValue(
      Object.assign(new VercelMarketplaceInstallation(), {
        installationId: "icfg_acme",
        accessToken: "vercel-token",
      }),
    );
    const lookUp: jest.SpyInstance = jest
      .spyOn(VercelMarketplaceAPI.prototype, "getProductionDomain")
      .mockResolvedValue("shop.acme.com");

    await VercelMarketplaceMonitors.onProductionDeployment({
      vercelProjectId: "prj_1",
      installationIds: ["icfg_acme"],
      resourceIds: ["res_1"],
    });

    expect(lookUp).toHaveBeenCalledWith(
      { installationId: "icfg_acme", accessToken: "vercel-token" },
      "prj_1",
    );
    expect(
      VercelMarketplaceConnectionService.updateOneById,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ data: { productionDomain: "shop.acme.com" } }),
    );
    expect(MonitorService.create).toHaveBeenCalledTimes(1);
  });

  it("leaves alone the projects of another team's installation, and ones already watched", async () => {
    mocked(VercelMarketplaceConnectionService.findBy).mockResolvedValue([
      connection(),
      connection({ monitorId: MONITOR_ID }),
    ]);
    mocked(MarketplaceSubscriptionService.findPurchaseById).mockResolvedValue(
      purchase(),
    );

    await VercelMarketplaceMonitors.onProductionDeployment({
      vercelProjectId: "prj_1",
      installationIds: ["icfg_other_team"],
      resourceIds: [],
    });

    expect(MonitorService.create).not.toHaveBeenCalled();
  });
});

describe("VercelMarketplaceMonitors.addMissingMonitors", () => {
  it("watches every connected project still without a monitor", async () => {
    mocked(VercelMarketplaceConnectionService.findBy).mockResolvedValue([
      connection({ productionDomain: "one.vercel.app" }),
      connection({ productionDomain: "two.vercel.app", monitorId: MONITOR_ID }),
      connection({ productionDomain: undefined }),
    ]);

    await VercelMarketplaceMonitors.addMissingMonitors(purchase());

    expect(MonitorService.create).toHaveBeenCalledTimes(1);
  });
});
