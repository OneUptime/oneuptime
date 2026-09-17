import "../../../../Server/Types/Billing/MeteredPlan/AllMeteredPlans";
import ActiveMonitoringMeteredPlan from "../../../../Server/Types/Billing/MeteredPlan/ActiveMonitoringMeteredPlan";
import TelemetryMeteredPlan from "../../../../Server/Types/Billing/MeteredPlan/TelemetryMeteredPlan";
import PayAsYouGoBillingService, {
  LiveUsageAuthorization,
} from "../../../../Server/Services/PayAsYouGoBillingService";
import BillingService from "../../../../Server/Services/BillingService";
import MonitorService from "../../../../Server/Services/MonitorService";
import ProjectService from "../../../../Server/Services/ProjectService";
import TelemetryUsageBillingService from "../../../../Server/Services/TelemetryUsageBillingService";
import LogService from "../../../../Server/Services/LogService";
import Project from "../../../../Models/DatabaseModels/Project";
import TelemetryUsageBilling from "../../../../Models/DatabaseModels/TelemetryUsageBilling";
import Decimal from "../../../../Types/Decimal";
import ObjectID from "../../../../Types/ObjectID";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import PositiveNumber from "../../../../Types/PositiveNumber";
import OneUptimeDate from "../../../../Types/Date";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../../Server/EnvironmentConfig"),
    IsBillingEnabled: true,
  };
});

/*
 * PayAsYouGoBillingService is the real one, with canUsePayAsYouGo and
 * getTelemetryBillingStartDate stubbed per test. A metered report takes one
 * live authorization and hands it to staging and to the usage write, so
 * whether a second provider read happens is decided by the real token
 * handling - stubbing that too would leave nothing here to prove it.
 */
jest.mock("../../../../Server/Services/BillingService", () => {
  return {
    __esModule: true,
    default: {
      addOrUpdateMeteredPricingOnSubscription: jest.fn(),
      getMeteredPlanPriceId: jest.fn(),
      hasMeteredPlanPriceId: jest.fn(),
    },
  };
});
jest.mock("../../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), updateOneById: jest.fn() },
  };
});
jest.mock("../../../../Server/Services/MonitorService", () => {
  return { __esModule: true, default: { countBy: jest.fn() } };
});
jest.mock("../../../../Server/Services/LogService", () => {
  return {
    __esModule: true,
    default: { groupTelemetryUsageByService: jest.fn() },
  };
});
jest.mock("../../../../Server/Services/ServiceService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/SpanService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/SecurityEventService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/MetricService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/ExceptionInstanceService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/ProfileService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/RumSessionService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/ProfileSampleService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/HostService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/DockerHostService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/PodmanHostService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/KubernetesClusterService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/ProxmoxClusterService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/VMwareVCenterService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/CephClusterService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/IoTFleetService", () => {
  return { __esModule: true, default: {} };
});

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();
const CUTOFF: Date = new Date("2026-09-09T00:00:00Z");

describe("metered billing payment protection", () => {
  let canUse: jest.SpyInstance;
  let report: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    canUse = getJestSpyOn(
      PayAsYouGoBillingService,
      "canUsePayAsYouGo",
    ).mockResolvedValue(true);
    getJestSpyOn(
      PayAsYouGoBillingService,
      "getTelemetryBillingStartDate",
    ).mockResolvedValue(CUTOFF);
    report = getJestSpyOn(
      BillingService,
      "addOrUpdateMeteredPricingOnSubscription",
    ).mockResolvedValue(undefined);
    getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(
      Object.assign(new Project(), {
        paymentProviderMeteredSubscriptionId: "sub_metered",
        paymentProviderPlanId: "free",
      }),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("active monitors", () => {
    beforeEach(() => {
      getJestSpyOn(MonitorService, "countBy").mockResolvedValue(
        new PositiveNumber(3),
      );
      getJestSpyOn(ProjectService, "updateOneById").mockResolvedValue(1);
    });

    it("updates visible monitor counts without charging a no-card project", async () => {
      canUse.mockResolvedValue(false);
      await new ActiveMonitoringMeteredPlan().reportQuantityToBillingProvider(
        PROJECT_ID,
      );
      expect(ProjectService.updateOneById).toHaveBeenCalledWith(
        expect.objectContaining({
          id: PROJECT_ID,
          data: { currentActiveMonitorsCount: 3 },
        }),
      );
      expect(canUse).toHaveBeenCalledWith(PROJECT_ID, { useCache: false });
      expect(report).not.toHaveBeenCalled();
    });

    it("reports authorized monitors and honors a replacement subscription", async () => {
      const plan: ActiveMonitoringMeteredPlan =
        new ActiveMonitoringMeteredPlan();
      await plan.reportQuantityToBillingProvider(PROJECT_ID, {
        meteredPlanSubscriptionId: "sub_replacement",
      });
      expect(report).toHaveBeenCalledWith("sub_replacement", plan, 3, {
        liveAuthorization: expect.objectContaining({
          projectId: PROJECT_ID.toString(),
        }),
      });
    });

    it("checks payment once per report and hands that answer to the usage write", async () => {
      const plan: ActiveMonitoringMeteredPlan =
        new ActiveMonitoringMeteredPlan();
      await plan.reportQuantityToBillingProvider(PROJECT_ID);
      expect(canUse).toHaveBeenCalledTimes(1);
      expect(canUse).toHaveBeenCalledWith(PROJECT_ID, { useCache: false });
      expect(report).toHaveBeenCalledTimes(1);
      expect(report.mock.calls[0]![3]).toEqual({
        liveAuthorization: expect.objectContaining({
          projectId: PROJECT_ID.toString(),
        }),
      });
    });

    it("writes the visible monitor count before deciding whether to bill it", async () => {
      const writeCount: jest.SpyInstance = getJestSpyOn(
        ProjectService,
        "updateOneById",
      );
      canUse.mockResolvedValue(false);
      await new ActiveMonitoringMeteredPlan().reportQuantityToBillingProvider(
        PROJECT_ID,
      );
      expect(writeCount.mock.invocationCallOrder[0]).toBeLessThan(
        canUse.mock.invocationCallOrder[0]!,
      );
      expect(report).not.toHaveBeenCalled();
    });

    it("propagates a payment-provider outage without reporting monitors", async () => {
      canUse.mockRejectedValue(new Error("Provider unavailable"));
      await expect(
        new ActiveMonitoringMeteredPlan().reportQuantityToBillingProvider(
          PROJECT_ID,
        ),
      ).rejects.toThrow("Provider unavailable");
      expect(report).not.toHaveBeenCalled();
    });
  });

  describe("telemetry reports", () => {
    let stage: jest.SpyInstance;
    let waive: jest.SpyInstance;
    let readUsage: jest.SpyInstance;
    let markReported: jest.SpyInstance;
    let plan: TelemetryMeteredPlan;

    beforeEach(() => {
      stage = getJestSpyOn(
        TelemetryUsageBillingService,
        "stageTelemetryUsageForProject",
      ).mockResolvedValue(undefined);
      waive = getJestSpyOn(
        TelemetryUsageBillingService,
        "waiveUnreportedUsageBilling",
      ).mockResolvedValue(undefined);
      readUsage = getJestSpyOn(
        TelemetryUsageBillingService,
        "getUnreportedUsageBilling",
      ).mockResolvedValue([
        Object.assign(new TelemetryUsageBilling(), {
          id: ObjectID.generate(),
          totalCostInUSD: new Decimal(1.25),
        }),
      ]);
      markReported = getJestSpyOn(
        TelemetryUsageBillingService,
        "updateOneById",
      ).mockResolvedValue(1);
      plan = new TelemetryMeteredPlan({
        productType: ProductType.Logs,
        unitCostInUSD: 0.1,
      });
    });

    it.each([
      ProductType.Logs,
      ProductType.Metrics,
      ProductType.Traces,
      ProductType.Profiles,
      ProductType.SessionReplay,
      ProductType.SecurityEvents,
    ])(
      "waives unapproved %s debt and does not stage or report it",
      async (productType: ProductType) => {
        canUse.mockResolvedValue(false);
        plan.productType = productType;
        await plan.reportQuantityToBillingProvider(PROJECT_ID);
        expect(waive).toHaveBeenCalledWith({
          projectId: PROJECT_ID,
          productType,
        });
        expect(stage).not.toHaveBeenCalled();
        expect(readUsage).not.toHaveBeenCalled();
        expect(report).not.toHaveBeenCalled();
        expect(markReported).not.toHaveBeenCalled();
      },
    );

    it("waives historical costs before reporting only authorized usage", async () => {
      await plan.reportQuantityToBillingProvider(PROJECT_ID);
      expect(waive).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        productType: ProductType.Logs,
        before: CUTOFF,
      });
      expect(waive.mock.invocationCallOrder[0]).toBeLessThan(
        stage.mock.invocationCallOrder[0]!,
      );
      expect(report).toHaveBeenCalledWith("sub_metered", plan, 125, {
        liveAuthorization: expect.objectContaining({
          projectId: PROJECT_ID.toString(),
        }),
      });
      expect(markReported).toHaveBeenCalledTimes(1);
    });

    it("shares one live payment check between staging and the usage write", async () => {
      stage.mockRestore();
      const staging: jest.SpyInstance = getJestSpyOn(
        TelemetryUsageBillingService,
        "stageTelemetryUsageForProject",
      );
      getJestSpyOn(
        PayAsYouGoBillingService,
        "getTelemetryBillingStartDate",
      ).mockResolvedValue(undefined);
      const aggregation: jest.SpyInstance = getJestSpyOn(
        LogService,
        "groupTelemetryUsageByService",
      ).mockResolvedValue([]);

      await plan.reportQuantityToBillingProvider(PROJECT_ID);

      // Staging ran past its own payment gate without a second check.
      expect(aggregation).toHaveBeenCalledTimes(1);
      expect(canUse).toHaveBeenCalledTimes(1);
      expect(canUse).toHaveBeenCalledWith(PROJECT_ID, { useCache: false });

      const liveAuthorization: unknown =
        staging.mock.calls[0]![0].liveAuthorization;
      expect(liveAuthorization).toEqual(
        expect.objectContaining({ projectId: PROJECT_ID.toString() }),
      );
      expect(report).toHaveBeenCalledWith("sub_metered", plan, 125, {
        liveAuthorization,
      });
    });

    it("preserves prior usage for invoice and reseller contracts without a cutoff", async () => {
      getJestSpyOn(
        PayAsYouGoBillingService,
        "getTelemetryBillingStartDate",
      ).mockResolvedValue(undefined);
      await plan.reportQuantityToBillingProvider(PROJECT_ID);
      expect(waive).not.toHaveBeenCalled();
      expect(report).toHaveBeenCalled();
    });

    it("does not waive debt or stage usage during a payment-provider outage", async () => {
      canUse.mockRejectedValue(new Error("Provider unavailable"));
      await expect(
        plan.reportQuantityToBillingProvider(PROJECT_ID),
      ).rejects.toThrow("Provider unavailable");
      expect(waive).not.toHaveBeenCalled();
      expect(stage).not.toHaveBeenCalled();
    });

    it("does not mark usage reported if the final billing guard refuses it", async () => {
      report.mockRejectedValue(new Error("Payment method was removed"));
      await expect(
        plan.reportQuantityToBillingProvider(PROJECT_ID),
      ).rejects.toThrow("Payment method was removed");
      expect(markReported).not.toHaveBeenCalled();
    });

    it("retains the minimum reporting threshold after authorization", async () => {
      readUsage.mockResolvedValue([
        Object.assign(new TelemetryUsageBilling(), {
          totalCostInUSD: new Decimal(0.99),
        }),
      ]);
      await plan.reportQuantityToBillingProvider(PROJECT_ID);
      expect(report).not.toHaveBeenCalled();
    });
  });

  describe("daily staging", () => {
    let aggregation: jest.SpyInstance;

    beforeEach(() => {
      aggregation = getJestSpyOn(
        LogService,
        "groupTelemetryUsageByService",
      ).mockResolvedValue([]);
    });

    it("blocks direct staging for no-card projects", async () => {
      canUse.mockResolvedValue(false);
      const waive: jest.SpyInstance = getJestSpyOn(
        TelemetryUsageBillingService,
        "waiveUnreportedUsageBilling",
      ).mockResolvedValue(undefined);
      await TelemetryUsageBillingService.stageTelemetryUsageForProject({
        projectId: PROJECT_ID,
        productType: ProductType.Logs,
      });
      expect(waive).toHaveBeenCalled();
      expect(aggregation).not.toHaveBeenCalled();
    });

    it.each(["2026-09-07T12:00:00Z", "2026-09-08T23:59:59Z"])(
      "never backfills usage from before authorization or its partial day (%s)",
      async (usageDate: string) => {
        await TelemetryUsageBillingService.stageTelemetryUsageForProject({
          projectId: PROJECT_ID,
          productType: ProductType.Logs,
          usageDate: new Date(usageDate),
        });
        expect(aggregation).not.toHaveBeenCalled();
      },
    );

    it("stages the first complete authorized UTC day", async () => {
      await TelemetryUsageBillingService.stageTelemetryUsageForProject({
        projectId: PROJECT_ID,
        productType: ProductType.Logs,
        usageDate: CUTOFF,
      });
      expect(aggregation).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: PROJECT_ID, startDate: CUTOFF }),
      );
    });

    describe("with a live authorization from the report", () => {
      const authorize: (
        projectId: ObjectID,
      ) => Promise<LiveUsageAuthorization> = async (
        projectId: ObjectID,
      ): Promise<LiveUsageAuthorization> => {
        const liveAuthorization: LiveUsageAuthorization | null =
          await PayAsYouGoBillingService.authorizeUsageNow(projectId);
        expect(liveAuthorization).not.toBeNull();
        canUse.mockClear();
        return liveAuthorization!;
      };

      it("skips its own live check for this project's fresh authorization", async () => {
        const liveAuthorization: LiveUsageAuthorization =
          await authorize(PROJECT_ID);
        await TelemetryUsageBillingService.stageTelemetryUsageForProject({
          projectId: PROJECT_ID,
          productType: ProductType.Logs,
          usageDate: CUTOFF,
          liveAuthorization,
        });
        expect(canUse).not.toHaveBeenCalled();
        expect(aggregation).toHaveBeenCalledTimes(1);
      });

      it("checks live when called without one", async () => {
        await TelemetryUsageBillingService.stageTelemetryUsageForProject({
          projectId: PROJECT_ID,
          productType: ProductType.Logs,
          usageDate: CUTOFF,
        });
        expect(canUse).toHaveBeenCalledWith(PROJECT_ID, { useCache: false });
      });

      it("checks live, and waives, when handed another project's authorization", async () => {
        const liveAuthorization: LiveUsageAuthorization =
          await authorize(OTHER_PROJECT_ID);
        canUse.mockResolvedValue(false);
        const waive: jest.SpyInstance = getJestSpyOn(
          TelemetryUsageBillingService,
          "waiveUnreportedUsageBilling",
        ).mockResolvedValue(undefined);
        await TelemetryUsageBillingService.stageTelemetryUsageForProject({
          projectId: PROJECT_ID,
          productType: ProductType.Logs,
          usageDate: CUTOFF,
          liveAuthorization,
        });
        expect(canUse).toHaveBeenCalledTimes(1);
        expect(canUse).toHaveBeenCalledWith(PROJECT_ID, { useCache: false });
        expect(waive).toHaveBeenCalled();
        expect(aggregation).not.toHaveBeenCalled();
      });

      it("checks live once the authorization has aged past the reuse window", async () => {
        const now: jest.SpyInstance = getJestSpyOn(Date, "now").mockReturnValue(
          100_000,
        );
        const liveAuthorization: LiveUsageAuthorization =
          await authorize(PROJECT_ID);
        now.mockReturnValue(160_001);
        await TelemetryUsageBillingService.stageTelemetryUsageForProject({
          projectId: PROJECT_ID,
          productType: ProductType.Logs,
          usageDate: CUTOFF,
          liveAuthorization,
        });
        expect(canUse).toHaveBeenCalledWith(PROJECT_ID, { useCache: false });
      });
    });

    it("uses the same UTC day key for staging and writes across timezone changes and retries", async () => {
      const resourceId: ObjectID = ObjectID.generate();
      const stored: Array<TelemetryUsageBilling> = [];
      aggregation.mockResolvedValue([
        {
          primaryEntityId: resourceId.toString(),
          primaryEntityType: ServiceType.OpenTelemetry,
          rowCount: 1,
          estimatedBytes: 1024,
        },
      ]);
      getJestSpyOn(
        TelemetryUsageBillingService,
        "buildTelemetryRetentionMap",
      ).mockResolvedValue(new Map());
      getJestSpyOn(
        TelemetryUsageBillingService,
        "getProjectDefaultRetentionInDays",
      ).mockResolvedValue(15);
      getJestSpyOn(TelemetryUsageBillingService, "findBy").mockImplementation(
        async (args: any): Promise<Array<TelemetryUsageBilling>> => {
          return stored.filter((row: TelemetryUsageBilling) => {
            return row.day === args.query.day;
          });
        },
      );
      getJestSpyOn(TelemetryUsageBillingService, "findOneBy").mockResolvedValue(
        null,
      );
      const create: jest.SpyInstance = getJestSpyOn(
        TelemetryUsageBillingService,
        "create",
      ).mockImplementation(
        async (args: any): Promise<TelemetryUsageBilling> => {
          stored.push(args.data as TelemetryUsageBilling);
          return args.data as TelemetryUsageBilling;
        },
      );
      const timezone: jest.SpyInstance = getJestSpyOn(
        OneUptimeDate,
        "getCurrentTimezone",
      ).mockReturnValue("America/Los_Angeles");
      await TelemetryUsageBillingService.stageTelemetryUsageForProject({
        projectId: PROJECT_ID,
        productType: ProductType.Logs,
        usageDate: new Date("2026-09-09T00:30:00Z"),
      });
      timezone.mockReturnValue("Asia/Tokyo");
      await TelemetryUsageBillingService.stageTelemetryUsageForProject({
        projectId: PROJECT_ID,
        productType: ProductType.Logs,
        usageDate: new Date("2026-09-09T23:30:00Z"),
      });
      expect(stored[0]?.day).toBe("Sep 09, 2026");
      expect(create).toHaveBeenCalledTimes(1);
      for (const call of aggregation.mock.calls) {
        expect(call[0].startDate).toEqual(CUTOFF);
        expect(call[0].endDate).toEqual(new Date("2026-09-09T23:59:59.999Z"));
      }
    });
  });

  describe("waiving unapproved usage", () => {
    it("preserves recorded volume and invoice history while zeroing every unreported positive cost", async () => {
      const update: jest.SpyInstance = getJestSpyOn(
        TelemetryUsageBillingService,
        "updateBy",
      )
        .mockResolvedValueOnce(10000)
        .mockResolvedValueOnce(3);
      await TelemetryUsageBillingService.waiveUnreportedUsageBilling({
        projectId: PROJECT_ID,
        productType: ProductType.Logs,
        before: CUTOFF,
      });
      expect(update).toHaveBeenCalledTimes(2);
      const args: any = update.mock.calls[0]![0];
      expect(args.query.projectId).toEqual(PROJECT_ID);
      expect(args.query.isReportedToBillingProvider).toBe(false);
      expect(args.query.createdAt).toBeDefined();
      expect(args.query.totalCostInUSD).toBeDefined();
      expect(Object.keys(args.data)).toEqual(["totalCostInUSD"]);
      expect(args.data.totalCostInUSD.value).toBe(0);
      expect(args.skip).toBe(0);
    });
  });
});
