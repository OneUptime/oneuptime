import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MarketplaceCharge from "Common/Models/DatabaseModels/MarketplaceCharge";
import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import MarketplaceUsageReport from "Common/Models/DatabaseModels/MarketplaceUsageReport";
import Project from "Common/Models/DatabaseModels/Project";
import TelemetryUsageBilling from "Common/Models/DatabaseModels/TelemetryUsageBilling";
import ProjectBalanceType from "Common/Types/Billing/ProjectBalanceType";
import OneUptimeDate from "Common/Types/Date";
import Decimal from "Common/Types/Decimal";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import MarketplaceUsageReportStatus from "Common/Types/Marketplace/MarketplaceUsageReportStatus";
import ObjectID from "Common/Types/ObjectID";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import MarketplaceChargeService from "Common/Server/Services/MarketplaceChargeService";
import MarketplaceSubscriptionService from "Common/Server/Services/MarketplaceSubscriptionService";
import MarketplaceUsageReportService from "Common/Server/Services/MarketplaceUsageReportService";
import ProjectService from "Common/Server/Services/ProjectService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import TelemetryUsageBillingService from "Common/Server/Services/TelemetryUsageBillingService";
import MarketplaceAdapter, {
  MarketplaceUsageHour,
  MarketplaceUsageRecord,
  MarketplaceUsageResult,
} from "../../../Server/CloudMarketplace/MarketplaceAdapter";
import MarketplaceAdapters from "../../../Server/CloudMarketplace/MarketplaceAdapters";
import MarketplaceUsageCalculator from "../../../Server/CloudMarketplace/MarketplaceUsageCalculator";
import MarketplaceUsageReporter from "../../../Server/CloudMarketplace/MarketplaceUsageReporter";
import logger from "Common/Server/Utils/Logger";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * A marketplace bills a project by the hour, after the hour. When the
 * project is deleted, what it used since its last hourly report - its seats
 * and monitors for the part of the hour, its staged telemetry, and every
 * balance top-up bought since - is billed in one final report, written
 * while the project is still there to be priced
 * (MarketplaceUsageReporter.reportFinalUsageOfProject, called by
 * ProjectService.onBeforeDelete). The delete waits for the report to be
 * written, never for the marketplace: a report the marketplace does not take
 * now stays Pending, and the hourly job sends it again once the project is
 * gone.
 *
 * The rows the reporter reads and writes live in memory here, so each test
 * can follow a purchase through the delete and the hourly runs after it, and
 * check that every minute and every top-up is billed exactly once.
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

jest.mock("Common/Server/Services/MarketplaceSubscriptionService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      findPurchaseById: jest.fn(),
      findPurchaseForProject: jest.fn(),
      updateOneById: jest.fn(),
      getPurchaseSelect: jest.fn().mockReturnValue({ _id: true }),
    },
  };
});

jest.mock("../../../Server/CloudMarketplace/MarketplacePurchases", () => {
  return {
    __esModule: true,
    default: {
      updatePurchase: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MarketplaceChargeService", () => {
  return {
    __esModule: true,
    default: { findUnbilled: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/MarketplaceUsageReportService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: { getUniqueTeamMemberCountInProject: jest.fn() },
  };
});

jest.mock("Common/Server/Services/TelemetryUsageBillingService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Billing/ActiveMonitorLimit", () => {
  return {
    __esModule: true,
    default: { refreshCount: jest.fn().mockResolvedValue(0) },
  };
});

const mocked: (fn: unknown) => jest.Mock = (fn: unknown): jest.Mock => {
  return fn as jest.Mock;
};

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PURCHASE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

// The 10:01 hourly run billed 09:00 - 10:00; the project is deleted at 10:40.
const LAST_REPORTED: Date = new Date("2026-10-16T10:00:00.000Z");
const DELETED_AT: Date = new Date("2026-10-16T10:40:00.000Z");

const SEATS: number = 10;
const SEAT_PRICE: number = 22;
const MONITORS: number = 3;
const MONITOR_PRICE: number = 1;

type Row = Record<string, unknown>;

/*
 * What the database holds for one purchase: the purchase, its project, the
 * reports written for it, its top-ups and the project's staged telemetry.
 */
interface Store {
  purchase: MarketplaceSubscription;
  project: Project | null;
  reports: Array<MarketplaceUsageReport>;
  charges: Array<MarketplaceCharge>;
  telemetry: Array<TelemetryUsageBilling>;
}

let store: Store;
let clock: Date;

// A row as a read from the database hands it over: changing it changes nothing stored.
const copyOf: <T extends BaseModel>(row: T) => T = <T extends BaseModel>(
  row: T,
): T => {
  return Object.assign(Object.create(Object.getPrototypeOf(row)) as T, row);
};

const sameId: (a: unknown, b: unknown) => boolean = (
  a: unknown,
  b: unknown,
): boolean => {
  return Boolean(a) && Boolean(b) && String(a) === String(b);
};

const purchaseRow: (
  overrides?: Partial<MarketplaceSubscription>,
) => MarketplaceSubscription = (
  overrides?: Partial<MarketplaceSubscription>,
): MarketplaceSubscription => {
  return Object.assign(new MarketplaceSubscription(), {
    _id: PURCHASE_ID.toString(),
    marketplace: CloudMarketplace.AWS,
    externalSubscriptionId: "arn:aws:license-manager::1:license:l-1",
    externalCustomerId: "123456789012",
    status: MarketplaceSubscriptionStatus.Active,
    projectId: PROJECT_ID,
    isUsageMetered: true,
    linkedAt: new Date("2026-10-01T00:00:00.000Z"),
    usageReportedUntil: LAST_REPORTED,
    unreportedUsageInUSD: new Decimal(0.004),
    ...overrides,
  });
};

const projectRow: (overrides?: Partial<Project>) => Project = (
  overrides?: Partial<Project>,
): Project => {
  return Object.assign(new Project(), {
    _id: PROJECT_ID.toString(),
    paymentProviderPlanId: "growth_monthly",
    trialEndsAt: null,
    currentActiveMonitorsCount: MONITORS,
    ...overrides,
  });
};

const topUp: (
  balanceType: ProjectBalanceType,
  amountInUSD: number,
) => MarketplaceCharge = (
  balanceType: ProjectBalanceType,
  amountInUSD: number,
): MarketplaceCharge => {
  return Object.assign(new MarketplaceCharge(), {
    _id: ObjectID.generate().toString(),
    marketplaceSubscriptionId: PURCHASE_ID,
    projectId: PROJECT_ID,
    marketplace: CloudMarketplace.AWS,
    balanceType: balanceType,
    amountInUSD: new Decimal(amountInUSD),
    isAutomatic: false,
    marketplaceUsageReportId: undefined,
  });
};

const telemetryRow: (cost: number) => TelemetryUsageBilling = (
  cost: number,
): TelemetryUsageBilling => {
  return Object.assign(new TelemetryUsageBilling(), {
    _id: ObjectID.generate().toString(),
    projectId: PROJECT_ID,
    totalCostInUSD: new Decimal(cost),
    day: "Oct 16, 2026",
    isReportedToBillingProvider: false,
  });
};

// The report the reporter wrote, as stored.
const storedReport: (id: unknown) => MarketplaceUsageReport | undefined = (
  id: unknown,
): MarketplaceUsageReport | undefined => {
  return store.reports.find((report: MarketplaceUsageReport): boolean => {
    return sameId(report._id, id);
  });
};

// Each service the reporter calls, reading and writing the store.
const wireStore: () => void = (): void => {
  mocked(
    MarketplaceSubscriptionService.findPurchaseForProject,
  ).mockImplementation(
    async (projectId: ObjectID): Promise<MarketplaceSubscription | null> => {
      return sameId(store.purchase.projectId, projectId)
        ? copyOf(store.purchase)
        : null;
    },
  );
  mocked(MarketplaceSubscriptionService.findPurchaseById).mockImplementation(
    async (id: ObjectID): Promise<MarketplaceSubscription | null> => {
      return sameId(store.purchase._id, id) ? copyOf(store.purchase) : null;
    },
  );
  // The hourly job's query: purchases that bill a project now.
  mocked(MarketplaceSubscriptionService.findBy).mockImplementation(
    async (): Promise<Array<MarketplaceSubscription>> => {
      return store.purchase.projectId &&
        store.purchase.status === MarketplaceSubscriptionStatus.Active
        ? [copyOf(store.purchase)]
        : [];
    },
  );
  mocked(MarketplaceSubscriptionService.updateOneById).mockImplementation(
    async (data: { data: Row }): Promise<void> => {
      Object.assign(store.purchase, data.data);
    },
  );

  mocked(MarketplaceChargeService.findUnbilled).mockImplementation(
    async (purchaseId: ObjectID): Promise<Array<MarketplaceCharge>> => {
      return store.charges
        .filter((charge: MarketplaceCharge): boolean => {
          return (
            sameId(charge.marketplaceSubscriptionId, purchaseId) &&
            !charge.marketplaceUsageReportId
          );
        })
        .map(copyOf);
    },
  );
  mocked(MarketplaceChargeService.updateOneById).mockImplementation(
    async (data: { id: ObjectID; data: Row }): Promise<void> => {
      const charge: MarketplaceCharge | undefined = store.charges.find(
        (each: MarketplaceCharge): boolean => {
          return sameId(each._id, data.id);
        },
      );
      Object.assign(charge!, data.data);
    },
  );

  mocked(MarketplaceUsageReportService.create).mockImplementation(
    async (data: {
      data: MarketplaceUsageReport;
    }): Promise<MarketplaceUsageReport> => {
      store.reports.push(copyOf(data.data));
      return data.data;
    },
  );
  // Pending reports: every one (the hourly job), or one purchase's, oldest first.
  mocked(MarketplaceUsageReportService.findBy).mockImplementation(
    async (data: { query: Row }): Promise<Array<MarketplaceUsageReport>> => {
      return store.reports
        .filter((report: MarketplaceUsageReport): boolean => {
          return (
            report.status === data.query["status"] &&
            (!data.query["marketplaceSubscriptionId"] ||
              sameId(
                report.marketplaceSubscriptionId,
                data.query["marketplaceSubscriptionId"],
              ))
          );
        })
        .sort((a: MarketplaceUsageReport, b: MarketplaceUsageReport) => {
          return a.periodEnd!.getTime() - b.periodEnd!.getTime();
        })
        .map(copyOf);
    },
  );
  // The purchase's last report, whatever its status.
  mocked(MarketplaceUsageReportService.findOneBy).mockImplementation(
    async (data: { query: Row }): Promise<MarketplaceUsageReport | null> => {
      const reports: Array<MarketplaceUsageReport> = store.reports
        .filter((report: MarketplaceUsageReport): boolean => {
          return sameId(
            report.marketplaceSubscriptionId,
            data.query["marketplaceSubscriptionId"],
          );
        })
        .sort((a: MarketplaceUsageReport, b: MarketplaceUsageReport) => {
          return b.periodEnd!.getTime() - a.periodEnd!.getTime();
        });

      return reports[0] ? copyOf(reports[0]) : null;
    },
  );
  mocked(MarketplaceUsageReportService.updateOneById).mockImplementation(
    async (data: { id: ObjectID; data: Row }): Promise<void> => {
      Object.assign(storedReport(data.id)!, data.data);
    },
  );

  mocked(ProjectService.findOneById).mockImplementation(
    async (data: { id: ObjectID }): Promise<Project | null> => {
      return store.project && sameId(store.project._id, data.id)
        ? copyOf(store.project)
        : null;
    },
  );
  mocked(ProjectService.updateOneById).mockImplementation(
    async (data: { data: Row }): Promise<void> => {
      if (store.project) {
        Object.assign(store.project, data.data);
      }
    },
  );
  mocked(TeamMemberService.getUniqueTeamMemberCountInProject).mockResolvedValue(
    SEATS,
  );

  mocked(TelemetryUsageBillingService.findBy).mockImplementation(
    async (): Promise<Array<TelemetryUsageBilling>> => {
      return store.telemetry
        .filter((row: TelemetryUsageBilling): boolean => {
          return (
            !row.isReportedToBillingProvider &&
            Number(row.totalCostInUSD?.value || 0) > 0
          );
        })
        .map(copyOf);
    },
  );
  mocked(TelemetryUsageBillingService.updateOneById).mockImplementation(
    async (data: { id: ObjectID; data: Row }): Promise<void> => {
      const row: TelemetryUsageBilling | undefined = store.telemetry.find(
        (each: TelemetryUsageBilling): boolean => {
          return sameId(each._id, data.id);
        },
      );
      Object.assign(row!, data.data);
    },
  );
};

/*
 * The report is sent after the delete's call returns, without being waited
 * for. Every service here answers at once, so the send is done once the
 * promises already queued have run.
 */
const settle: () => Promise<void> = async (): Promise<void> => {
  for (let round: number = 0; round < 5; round++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
};

// What OneUptime does around the reporter when the delete goes through.
const deleteProject: () => Promise<void> = async (): Promise<void> => {
  await MarketplaceUsageReporter.reportFinalUsageOfProject(PROJECT_ID);

  // The project's rows go with it, and onDeleteSuccess unlinks its purchase.
  store.project = null;
  store.telemetry = [];
  Object.assign(store.purchase, { projectId: null });

  await settle();
};

const runHourlyJobAt: (time: string) => Promise<void> = async (
  time: string,
): Promise<void> => {
  clock = new Date(time);
  await MarketplaceUsageReporter.reportAll();
  await settle();
};

const sentRecords: () => Array<MarketplaceUsageRecord> =
  (): Array<MarketplaceUsageRecord> => {
    return adapter.reportUsage.mock.calls.map(
      (call: Array<unknown>): MarketplaceUsageRecord => {
        return call[1] as MarketplaceUsageRecord;
      },
    );
  };

const errorLogged: (text: string) => boolean = (text: string): boolean => {
  return mocked(logger.error).mock.calls.some((call: Array<unknown>) => {
    return String(call[0]).includes(text);
  });
};

let adapter: {
  marketplace: CloudMarketplace;
  keepsOneReportPerHour: boolean;
  isConfigured: jest.Mock;
  activate: jest.Mock;
  fetchStatus: jest.Mock;
  reportUsage: jest.Mock;
};

const useAdapter: (marketplace: CloudMarketplace) => void = (
  marketplace: CloudMarketplace,
): void => {
  adapter = {
    marketplace: marketplace,
    keepsOneReportPerHour: marketplace !== CloudMarketplace.GoogleCloud,
    isConfigured: jest.fn().mockReturnValue(true),
    activate: jest.fn(),
    fetchStatus: jest.fn().mockResolvedValue(null),
    reportUsage: jest.fn().mockResolvedValue({
      outcome: "accepted",
      externalReportId: "external-1",
    } as MarketplaceUsageResult),
  };

  MarketplaceAdapters.set(
    marketplace,
    adapter as unknown as MarketplaceAdapter,
  );
};

// What the deleted project owed for 10:00 - 10:40, with the given top-ups.
const owedUntilDelete: (chargesInUSD: number) => number = (
  chargesInUSD: number,
): number => {
  return MarketplaceUsageCalculator.calculate({
    periodStart: LAST_REPORTED,
    periodEnd: DELETED_AT,
    seats: SEATS,
    seatPricePerMonthInUSD: SEAT_PRICE,
    trialEndsAt: null,
    activeMonitors: MONITORS,
    activeMonitorPricePerMonthInUSD: MONITOR_PRICE,
    telemetryInUSD: 1.75,
    chargesInUSD: chargesInUSD,
    carriedInUSD: 0.004,
  }).quantity;
};

describe("MarketplaceUsageReporter.reportFinalUsageOfProject", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    clock = DELETED_AT;
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(clock.getTime());
    });
    jest.spyOn(logger, "error").mockImplementation((): void => {});
    jest.spyOn(logger, "debug").mockImplementation((): void => {});

    useAdapter(CloudMarketplace.AWS);

    store = {
      purchase: purchaseRow(),
      project: projectRow(),
      reports: [],
      charges: [],
      telemetry: [telemetryRow(1.25), telemetryRow(0.5)],
    };

    mocked(Semaphore.lock).mockResolvedValue({ key: "lock" });
    mocked(Semaphore.release).mockResolvedValue(undefined);
    wireStore();
  });

  afterEach(() => {
    for (const marketplace of [
      CloudMarketplace.AWS,
      CloudMarketplace.Azure,
      CloudMarketplace.GoogleCloud,
    ]) {
      MarketplaceAdapters.set(marketplace, null);
    }
    jest.restoreAllMocks();
  });

  describe("a project a marketplace bills", () => {
    it("bills the time since the last report up to the delete, and every top-up bought since, in one final report", async () => {
      const sms: MarketplaceCharge = topUp(ProjectBalanceType.SmsOrCall, 20);
      const ai: MarketplaceCharge = topUp(ProjectBalanceType.AI, 50);
      store.charges.push(sms, ai);

      await deleteProject();

      expect(store.reports).toHaveLength(1);
      const report: MarketplaceUsageReport = store.reports[0]!;

      // 40 minutes of 10 seats and 3 monitors, $1.75 of telemetry and $70 of top-ups.
      expect(owedUntilDelete(70)).toBeGreaterThan(7175);
      expect(report).toMatchObject({
        projectId: PROJECT_ID,
        marketplace: CloudMarketplace.AWS,
        periodStart: LAST_REPORTED,
        periodEnd: DELETED_AT,
        quantity: owedUntilDelete(70),
        status: MarketplaceUsageReportStatus.Reported,
      });
      expect(String(report.marketplaceSubscriptionId)).toBe(
        PURCHASE_ID.toString(),
      );
      expect(report.breakdown).toMatchObject({
        isFinal: true,
        seats: SEATS,
        activeMonitors: MONITORS,
        telemetryInUSD: 1.75,
        telemetryRows: 2,
        chargesInUSD: 70,
        smsOrCallBalanceInUSD: 20,
        aiBalanceInUSD: 50,
        charges: 2,
      });

      // Both top-ups now belong to it, and the telemetry is spent.
      for (const charge of store.charges) {
        expect(String(charge.marketplaceUsageReportId)).toBe(
          report.id!.toString(),
        );
      }

      // Sent once, as written.
      expect(sentRecords()).toEqual([
        {
          reportId: report.id!.toString(),
          quantity: owedUntilDelete(70),
          periodStart: LAST_REPORTED,
          periodEnd: DELETED_AT,
          projectId: PROJECT_ID.toString(),
        },
      ]);
    });

    it("claims everything it bills before it writes the report, and moves the purchase's period to the delete", async () => {
      store.charges.push(topUp(ProjectBalanceType.AI, 20));

      await MarketplaceUsageReporter.reportFinalUsageOfProject(PROJECT_ID);

      const writtenAt: number = mocked(MarketplaceUsageReportService.create)
        .mock.invocationCallOrder[0]!;

      for (const claim of [
        ...mocked(TelemetryUsageBillingService.updateOneById).mock
          .invocationCallOrder,
        ...mocked(MarketplaceChargeService.updateOneById).mock
          .invocationCallOrder,
        ...mocked(MarketplaceSubscriptionService.updateOneById).mock
          .invocationCallOrder,
      ]) {
        expect(claim).toBeLessThan(writtenAt);
      }

      expect(store.purchase.usageReportedUntil).toEqual(DELETED_AT);
      expect(
        store.telemetry.every((row: TelemetryUsageBilling): boolean => {
          return Boolean(row.isReportedToBillingProvider);
        }),
      ).toBe(true);
    });

    it("prices the project while it is still there, and under the purchase's report lock", async () => {
      await MarketplaceUsageReporter.reportFinalUsageOfProject(PROJECT_ID);

      expect(ProjectService.findOneById).toHaveBeenCalledWith(
        expect.objectContaining({ id: PROJECT_ID }),
      );
      expect(Semaphore.lock).toHaveBeenCalledWith(
        expect.objectContaining({
          key: PURCHASE_ID.toString(),
          namespace: "marketplace-usage-report",
        }),
      );
      expect(mocked(Semaphore.lock).mock.invocationCallOrder[0]!).toBeLessThan(
        mocked(MarketplaceUsageReportService.create).mock
          .invocationCallOrder[0]!,
      );
      expect(Semaphore.release).toHaveBeenCalled();
    });

    it("bills the deleted project exactly once: the hourly runs after it bill nothing of it again", async () => {
      store.charges.push(topUp(ProjectBalanceType.SmsOrCall, 20));

      await deleteProject();
      await runHourlyJobAt("2026-10-16T11:01:00.000Z");
      await runHourlyJobAt("2026-10-16T12:01:00.000Z");

      expect(store.reports).toHaveLength(1);
      expect(adapter.reportUsage).toHaveBeenCalledTimes(1);
      expect(store.charges[0]!.marketplaceUsageReportId?.toString()).toBe(
        store.reports[0]!.id!.toString(),
      );
    });

    it("bills a top-up made a minute before the delete, which no hourly report had reached", async () => {
      clock = new Date("2026-10-16T10:39:00.000Z");
      const lastMinute: MarketplaceCharge = topUp(
        ProjectBalanceType.SmsOrCall,
        25,
      );
      store.charges.push(lastMinute);
      clock = DELETED_AT;

      await deleteProject();

      expect(store.reports[0]!.breakdown).toMatchObject({
        smsOrCallBalanceInUSD: 25,
        charges: 1,
      });
      expect(lastMinute.marketplaceUsageReportId?.toString()).toBe(
        store.reports[0]!.id!.toString(),
      );
    });

    it("bills a top-up bought in the project's trial: it was bought, not used", async () => {
      store.project = projectRow({
        trialEndsAt: new Date("2026-11-01T00:00:00.000Z"),
      });
      store.charges.push(topUp(ProjectBalanceType.AI, 30));
      store.purchase = purchaseRow({ unreportedUsageInUSD: new Decimal(0) });
      store.telemetry = [];

      await deleteProject();

      expect(store.reports[0]).toMatchObject({ quantity: 3000 });
      expect(store.reports[0]!.breakdown).toMatchObject({
        seatsInUSD: 0,
        activeMonitorsInUSD: 0,
        aiBalanceInUSD: 30,
      });
    });

    it("bills only the top-ups of a purchase whose usage is not metered", async () => {
      store.purchase = purchaseRow({
        isUsageMetered: false,
        unreportedUsageInUSD: new Decimal(0),
      });
      store.charges.push(topUp(ProjectBalanceType.AI, 20));

      await MarketplaceUsageReporter.reportFinalUsageOfProject(PROJECT_ID);
      await settle();

      expect(store.reports[0]).toMatchObject({ quantity: 2000 });
      expect(store.reports[0]!.breakdown).toMatchObject({
        isUsageMetered: false,
        isFinal: true,
      });
      // Its usage is the deal's: not counted, not claimed.
      expect(TelemetryUsageBillingService.findBy).not.toHaveBeenCalled();
      expect(
        store.telemetry.some((row: TelemetryUsageBilling): boolean => {
          return Boolean(row.isReportedToBillingProvider);
        }),
      ).toBe(false);
    });

    it("writes no report when there is nothing to bill, but still moves the period to the delete", async () => {
      store.project = projectRow({
        paymentProviderPlanId: "free_monthly",
        currentActiveMonitorsCount: 0,
      });
      store.telemetry = [];
      store.purchase = purchaseRow({ unreportedUsageInUSD: new Decimal(0) });

      await deleteProject();

      expect(store.reports).toHaveLength(0);
      expect(adapter.reportUsage).not.toHaveBeenCalled();
      expect(store.purchase.usageReportedUntil).toEqual(DELETED_AT);
    });

    it("bills a project deleted before the hourly run reached its last hour, up to the delete", async () => {
      // Deleted at 10:00:30, before the 10:01 run: the 09:00 - 10:00 hour was never reported.
      store.purchase = purchaseRow({
        usageReportedUntil: new Date("2026-10-16T09:00:00.000Z"),
      });
      clock = new Date("2026-10-16T10:00:30.000Z");

      await deleteProject();
      await runHourlyJobAt("2026-10-16T10:01:00.000Z");

      expect(store.reports).toHaveLength(1);
      expect(store.reports[0]).toMatchObject({
        periodStart: new Date("2026-10-16T09:00:00.000Z"),
        periodEnd: new Date("2026-10-16T10:00:30.000Z"),
        status: MarketplaceUsageReportStatus.Reported,
      });
    });

    it("bills the final usage on Microsoft and Google Cloud too", async () => {
      for (const marketplace of [
        CloudMarketplace.Azure,
        CloudMarketplace.GoogleCloud,
      ]) {
        jest.clearAllMocks();
        wireStore();
        useAdapter(marketplace);
        store = {
          purchase: purchaseRow({ marketplace: marketplace }),
          project: projectRow(),
          reports: [],
          charges: [topUp(ProjectBalanceType.SmsOrCall, 20)],
          telemetry: [telemetryRow(1.25), telemetryRow(0.5)],
        };
        mocked(Semaphore.lock).mockResolvedValue({ key: "lock" });

        await deleteProject();

        expect(store.reports).toHaveLength(1);
        expect(store.reports[0]).toMatchObject({
          marketplace: marketplace,
          quantity: owedUntilDelete(20),
          status: MarketplaceUsageReportStatus.Reported,
        });
      }
    });
  });

  describe("a marketplace that does not take the report now", () => {
    it("never makes the delete wait for the marketplace's answer", async () => {
      // A marketplace that holds the connection open and never answers.
      adapter.reportUsage.mockReturnValue(
        new Promise<MarketplaceUsageResult>(() => {}),
      );

      await MarketplaceUsageReporter.reportFinalUsageOfProject(PROJECT_ID);

      // Back to the delete with the report written, and not yet confirmed.
      expect(store.reports).toHaveLength(1);
      expect(store.reports[0]).toMatchObject({
        status: MarketplaceUsageReportStatus.Pending,
        attempts: 0,
      });
    });

    it("keeps a report the marketplace could not take, Pending, and fails nothing", async () => {
      adapter.reportUsage.mockResolvedValue({
        outcome: "retry",
        error: "AWS Marketplace Metering Service is unavailable",
      } as MarketplaceUsageResult);

      await expect(deleteProject()).resolves.toBeUndefined();

      expect(store.reports[0]).toMatchObject({
        status: MarketplaceUsageReportStatus.Pending,
        attempts: 1,
        lastError: "AWS Marketplace Metering Service is unavailable",
      });
    });

    it("keeps the report Pending when the marketplace cannot be reached at all", async () => {
      adapter.reportUsage.mockRejectedValue(new Error("connect ETIMEDOUT"));

      await expect(deleteProject()).resolves.toBeUndefined();

      expect(store.reports[0]).toMatchObject({
        status: MarketplaceUsageReportStatus.Pending,
        attempts: 1,
        lastError: "connect ETIMEDOUT",
      });
    });

    it("leaves no promise rejected behind when the send after the delete fails", async () => {
      // Read for the report; gone by the time it is sent.
      mocked(MarketplaceSubscriptionService.findPurchaseById)
        .mockImplementationOnce(async (): Promise<MarketplaceSubscription> => {
          return copyOf(store.purchase);
        })
        .mockRejectedValueOnce(new Error("database is gone"));

      await expect(deleteProject()).resolves.toBeUndefined();

      expect(errorLogged("the hourly job sends them again")).toBe(true);
      expect(store.reports[0]!.status).toBe(
        MarketplaceUsageReportStatus.Pending,
      );
    });

    it("is sent by the hourly job once the project is gone, as exactly the same record, without reading the project", async () => {
      store.charges.push(topUp(ProjectBalanceType.AI, 50));
      adapter.reportUsage.mockResolvedValueOnce({
        outcome: "retry",
        error: "Throttled",
      } as MarketplaceUsageResult);

      await deleteProject();

      const firstSend: MarketplaceUsageRecord = sentRecords()[0]!;
      mocked(ProjectService.findOneById).mockClear();

      await runHourlyJobAt("2026-10-16T11:01:00.000Z");

      expect(sentRecords()).toHaveLength(2);
      expect(sentRecords()[1]).toEqual(firstSend);
      expect(firstSend.projectId).toBe(PROJECT_ID.toString());
      expect(store.reports).toHaveLength(1);
      expect(store.reports[0]).toMatchObject({
        status: MarketplaceUsageReportStatus.Reported,
        attempts: 2,
        lastError: null,
      });
      // The project is gone: the report and its purchase are all a send needs.
      expect(ProjectService.findOneById).not.toHaveBeenCalled();
    });

    it("gives the report up as Failed, logged as not billed, only after the marketplaces' one-day deadline", async () => {
      adapter.reportUsage.mockResolvedValue({
        outcome: "retry",
        error: "Throttled",
      } as MarketplaceUsageResult);

      await deleteProject();
      await runHourlyJobAt("2026-10-17T09:01:00.000Z");

      expect(store.reports[0]!.status).toBe(
        MarketplaceUsageReportStatus.Pending,
      );

      await runHourlyJobAt("2026-10-17T10:01:00.000Z");

      expect(store.reports[0]!.status).toBe(
        MarketplaceUsageReportStatus.Failed,
      );
      expect(errorLogged("was NOT billed")).toBe(true);
    });
  });

  describe("a project no active purchase bills", () => {
    it("does nothing for a project no purchase is linked to", async () => {
      store.purchase = purchaseRow({ projectId: OTHER_PROJECT_ID });

      await MarketplaceUsageReporter.reportFinalUsageOfProject(PROJECT_ID);
      await settle();

      expect(Semaphore.lock).not.toHaveBeenCalled();
      expect(MarketplaceUsageReportService.create).not.toHaveBeenCalled();
      expect(adapter.reportUsage).not.toHaveBeenCalled();
    });

    it("bills nothing, and claims nothing, for a purchase that is suspended, pending or cancelled", async () => {
      for (const status of [
        MarketplaceSubscriptionStatus.Suspended,
        MarketplaceSubscriptionStatus.Pending,
        MarketplaceSubscriptionStatus.Cancelled,
      ]) {
        const charge: MarketplaceCharge = topUp(
          ProjectBalanceType.SmsOrCall,
          20,
        );
        store.purchase = purchaseRow({ status: status });
        store.charges = [charge];

        await MarketplaceUsageReporter.reportFinalUsageOfProject(PROJECT_ID);
        await settle();

        expect(store.reports).toHaveLength(0);
        expect(charge.marketplaceUsageReportId).toBeUndefined();
        expect(store.purchase.usageReportedUntil).toEqual(LAST_REPORTED);
      }

      expect(Semaphore.lock).not.toHaveBeenCalled();
      expect(adapter.reportUsage).not.toHaveBeenCalled();
    });

    it("bills nothing when the purchase ended while the delete waited for its lock", async () => {
      // Read active, then cancelled by a webhook before the lock was had.
      mocked(
        MarketplaceSubscriptionService.findPurchaseById,
      ).mockImplementation(async (): Promise<MarketplaceSubscription> => {
        return copyOf(
          purchaseRow({ status: MarketplaceSubscriptionStatus.Cancelled }),
        );
      });

      await MarketplaceUsageReporter.reportFinalUsageOfProject(PROJECT_ID);
      await settle();

      expect(store.reports).toHaveLength(0);
      expect(adapter.reportUsage).not.toHaveBeenCalled();
    });

    it("does nothing for a marketplace this server is not set up for", async () => {
      adapter.isConfigured.mockReturnValue(false);

      await MarketplaceUsageReporter.reportFinalUsageOfProject(PROJECT_ID);
      await settle();

      expect(Semaphore.lock).not.toHaveBeenCalled();
      expect(store.reports).toHaveLength(0);
    });
  });

  describe("a delete the report must never stop", () => {
    it("says loudly that the usage was not billed when another report of the purchase holds its lock", async () => {
      mocked(Semaphore.lock).mockRejectedValue(new Error("lock is held"));

      await expect(
        MarketplaceUsageReporter.reportFinalUsageOfProject(PROJECT_ID),
      ).resolves.toBeUndefined();

      expect(store.reports).toHaveLength(0);
      expect(errorLogged("was NOT billed")).toBe(true);
    });

    it("never throws when the database fails while the report is priced", async () => {
      mocked(ProjectService.findOneById).mockRejectedValue(
        new Error("db down"),
      );

      await expect(
        MarketplaceUsageReporter.reportFinalUsageOfProject(PROJECT_ID),
      ).resolves.toBeUndefined();

      expect(errorLogged("Final marketplace usage report failed")).toBe(true);
    });

    it("never throws when the purchase cannot be read", async () => {
      mocked(
        MarketplaceSubscriptionService.findPurchaseForProject,
      ).mockRejectedValue(new Error("db down"));

      await expect(
        MarketplaceUsageReporter.reportFinalUsageOfProject(PROJECT_ID),
      ).resolves.toBeUndefined();
    });

    it("says loudly when a report it claimed for could not be written", async () => {
      mocked(MarketplaceUsageReportService.create).mockRejectedValue(
        new Error("connection lost"),
      );

      await expect(
        MarketplaceUsageReporter.reportFinalUsageOfProject(PROJECT_ID),
      ).resolves.toBeUndefined();

      expect(errorLogged("was NOT billed")).toBe(true);
      expect(adapter.reportUsage).not.toHaveBeenCalled();
    });
  });

  /*
   * AWS and Microsoft keep one usage record per purchase and hour. A final
   * report ends part way through an hour and is filed in it, so a purchase
   * billed again after one - a delete that failed, or the purchase linked to
   * another project within the hour - must not file its next report there.
   */
  describe("a purchase billed again after a final report", () => {
    it("files the hourly report after a failed delete in the next hour, and bills the whole time since", async () => {
      await MarketplaceUsageReporter.reportFinalUsageOfProject(PROJECT_ID);
      await settle();

      // The delete failed: the project and its purchase are still there.
      clock = new Date("2026-10-16T10:50:00.000Z");
      const later: MarketplaceCharge = topUp(ProjectBalanceType.AI, 40);
      store.charges.push(later);

      await runHourlyJobAt("2026-10-16T11:01:00.000Z");

      // 10:40 - 11:00 would be filed in the 10:00 hour, the final report's.
      expect(store.reports).toHaveLength(1);
      expect(later.marketplaceUsageReportId).toBeUndefined();
      expect(store.purchase.usageReportedUntil).toEqual(DELETED_AT);

      await runHourlyJobAt("2026-10-16T12:01:00.000Z");

      expect(store.reports).toHaveLength(2);
      expect(store.reports[1]).toMatchObject({
        periodStart: DELETED_AT,
        periodEnd: new Date("2026-10-16T12:00:00.000Z"),
        status: MarketplaceUsageReportStatus.Reported,
      });
      expect(store.reports[1]!.breakdown).toMatchObject({
        aiBalanceInUSD: 40,
        charges: 1,
      });
      expect(
        store.reports.map((report: MarketplaceUsageReport): number => {
          return MarketplaceUsageHour.getHour(report.periodEnd!).getTime();
        }),
      ).toEqual([Date.UTC(2026, 9, 16, 10), Date.UTC(2026, 9, 16, 11)]);
    });

    it("files the first report of a purchase linked to another project within the hour in the next hour", async () => {
      await deleteProject();

      // Linked to another project at 10:50, from the marketplace's link.
      Object.assign(store.purchase, {
        projectId: OTHER_PROJECT_ID,
        linkedAt: new Date("2026-10-16T10:50:00.000Z"),
        usageReportedUntil: new Date("2026-10-16T10:50:00.000Z"),
        unreportedUsageInUSD: new Decimal(0),
      });
      store.project = projectRow({ _id: OTHER_PROJECT_ID.toString() });

      await runHourlyJobAt("2026-10-16T11:01:00.000Z");
      expect(store.reports).toHaveLength(1);

      await runHourlyJobAt("2026-10-16T12:01:00.000Z");
      expect(store.reports).toHaveLength(2);
      expect(store.reports[1]).toMatchObject({
        projectId: OTHER_PROJECT_ID,
        periodStart: new Date("2026-10-16T10:50:00.000Z"),
        periodEnd: new Date("2026-10-16T12:00:00.000Z"),
      });
    });

    it("does not hold back the first report of a purchase linked again in a later hour", async () => {
      await deleteProject();

      Object.assign(store.purchase, {
        projectId: OTHER_PROJECT_ID,
        linkedAt: new Date("2026-10-16T11:10:00.000Z"),
        usageReportedUntil: new Date("2026-10-16T11:10:00.000Z"),
      });
      store.project = projectRow({ _id: OTHER_PROJECT_ID.toString() });

      await runHourlyJobAt("2026-10-16T12:01:00.000Z");

      expect(store.reports).toHaveLength(2);
      expect(store.reports[1]).toMatchObject({
        periodStart: new Date("2026-10-16T11:10:00.000Z"),
        periodEnd: new Date("2026-10-16T12:00:00.000Z"),
      });
    });

    it("does not hold back the first report of a purchase that has none yet", async () => {
      store.purchase = purchaseRow({
        linkedAt: new Date("2026-10-16T10:50:00.000Z"),
        usageReportedUntil: new Date("2026-10-16T10:50:00.000Z"),
      });

      await runHourlyJobAt("2026-10-16T11:01:00.000Z");

      expect(store.reports).toHaveLength(1);
      expect(store.reports[0]).toMatchObject({
        periodStart: new Date("2026-10-16T10:50:00.000Z"),
        periodEnd: new Date("2026-10-16T11:00:00.000Z"),
      });
    });

    it("reads no reports for an hourly report whose period starts on the hour", async () => {
      await runHourlyJobAt("2026-10-16T11:01:00.000Z");

      expect(store.reports).toHaveLength(1);
      expect(MarketplaceUsageReportService.findOneBy).not.toHaveBeenCalled();
    });

    it("never holds back a report on Google Cloud, which counts reports by their ID", async () => {
      useAdapter(CloudMarketplace.GoogleCloud);
      store.purchase = purchaseRow({
        marketplace: CloudMarketplace.GoogleCloud,
      });

      await MarketplaceUsageReporter.reportFinalUsageOfProject(PROJECT_ID);
      await settle();
      await runHourlyJobAt("2026-10-16T11:01:00.000Z");

      expect(store.reports).toHaveLength(2);
      expect(store.reports[1]).toMatchObject({
        periodStart: DELETED_AT,
        periodEnd: new Date("2026-10-16T11:00:00.000Z"),
      });
      expect(MarketplaceUsageReportService.findOneBy).not.toHaveBeenCalled();
    });

    it("bills nothing for a second final report in the same hour, says so loudly, and leaves its top-ups for a later report", async () => {
      await MarketplaceUsageReporter.reportFinalUsageOfProject(PROJECT_ID);
      await settle();

      // The delete failed, and is tried again at 10:50, after a top-up.
      clock = new Date("2026-10-16T10:45:00.000Z");
      const between: MarketplaceCharge = topUp(
        ProjectBalanceType.SmsOrCall,
        15,
      );
      store.charges.push(between);
      clock = new Date("2026-10-16T10:50:00.000Z");

      await deleteProject();

      expect(store.reports).toHaveLength(1);
      expect(adapter.reportUsage).toHaveBeenCalledTimes(1);
      expect(between.marketplaceUsageReportId).toBeUndefined();
      expect(errorLogged("keeps one report per hour")).toBe(true);
    });
  });

  /*
   * Whenever a project is deleted, and whatever was bought before it, each
   * top-up is billed by exactly one report, the reports cover the time from
   * the link to the delete with no gap and no overlap, no two of them are
   * filed in the same hour, and together they bill exactly what the project
   * owed. The same when the delete fails and the hourly job goes on.
   */
  describe("every minute and every top-up billed exactly once", () => {
    interface Scenario {
      linkedAt: number;
      deletedAt: number;
      isDeleteFailing: boolean;
      topUps: Array<{ at: number; amountInUSD: number }>;
      telemetry: Array<{ at: number; costInUSD: number }>;
    }

    const MINUTE: number = 60 * 1000;
    const HOUR: number = 60 * MINUTE;

    const drawScenario: (
      random: SeededRandom,
      isDeleteFailing: boolean,
    ) => Scenario = (
      random: SeededRandom,
      isDeleteFailing: boolean,
    ): Scenario => {
      const linkedAt: number =
        Date.UTC(2026, 9, 16, 3) + random(4 * 60) * MINUTE + random(60) * 1000;
      const deletedAt: number =
        linkedAt + (5 + random(6 * 60)) * MINUTE + random(60) * 1000;

      const at: () => number = (): number => {
        return linkedAt + random(deletedAt - linkedAt);
      };

      return {
        linkedAt: linkedAt,
        deletedAt: deletedAt,
        isDeleteFailing: isDeleteFailing,
        topUps: Array.from({ length: random(4) }, () => {
          return { at: at(), amountInUSD: 5 * (1 + random(20)) };
        }),
        telemetry: Array.from({ length: random(3) }, () => {
          return { at: at(), costInUSD: (1 + random(500)) / 100 };
        }),
      };
    };

    const simulate: (scenario: Scenario) => Promise<number> = async (
      scenario: Scenario,
    ): Promise<number> => {
      store = {
        purchase: purchaseRow({
          linkedAt: new Date(scenario.linkedAt),
          usageReportedUntil: new Date(scenario.linkedAt),
          unreportedUsageInUSD: new Decimal(0),
        }),
        project: projectRow(),
        reports: [],
        charges: [],
        telemetry: [],
      };

      // The hourly runs until two hours after the delete.
      const runs: Array<number> = [];
      for (
        let run: number =
          Math.floor(scenario.linkedAt / HOUR) * HOUR + HOUR + MINUTE;
        run <= scenario.deletedAt + 2 * HOUR;
        run += HOUR
      ) {
        runs.push(run);
      }

      type Step = { at: number; act: () => Promise<void> };

      const steps: Array<Step> = [
        ...scenario.topUps.map((each: { at: number; amountInUSD: number }) => {
          return {
            at: each.at,
            act: async (): Promise<void> => {
              store.charges.push(
                topUp(ProjectBalanceType.SmsOrCall, each.amountInUSD),
              );
            },
          };
        }),
        ...scenario.telemetry.map((each: { at: number; costInUSD: number }) => {
          return {
            at: each.at,
            act: async (): Promise<void> => {
              store.telemetry.push(telemetryRow(each.costInUSD));
            },
          };
        }),
        {
          at: scenario.deletedAt,
          act: async (): Promise<void> => {
            if (scenario.isDeleteFailing) {
              await MarketplaceUsageReporter.reportFinalUsageOfProject(
                PROJECT_ID,
              );
              await settle();
            } else {
              await deleteProject();
            }
          },
        },
        ...runs.map((run: number) => {
          return {
            at: run,
            act: async (): Promise<void> => {
              await MarketplaceUsageReporter.reportAll();
              await settle();
            },
          };
        }),
      ].sort((a: Step, b: Step) => {
        return a.at - b.at;
      });

      for (const step of steps) {
        clock = new Date(step.at);
        await step.act();
      }

      // Where billing ends: the delete, or the last hour the job reported.
      return scenario.isDeleteFailing
        ? Math.floor(runs[runs.length - 1]! / HOUR) * HOUR
        : scenario.deletedAt;
    };

    const checkBilledOnce: (scenario: Scenario, billedUntil: number) => void = (
      scenario: Scenario,
      billedUntil: number,
    ): void => {
      const reports: Array<MarketplaceUsageReport> = [...store.reports].sort(
        (a: MarketplaceUsageReport, b: MarketplaceUsageReport) => {
          return a.periodStart!.getTime() - b.periodStart!.getTime();
        },
      );

      /*
       * Priced from the link to the end, and no time twice. A period worth
       * less than a cent writes no report: its value is carried into the
       * next one, which the total below counts.
       */
      expect(reports.length).toBeGreaterThan(0);
      expect(reports[0]!.periodStart!.getTime()).toBeGreaterThanOrEqual(
        scenario.linkedAt,
      );
      for (let index: number = 1; index < reports.length; index++) {
        expect(reports[index]!.periodStart!.getTime()).toBeGreaterThanOrEqual(
          reports[index - 1]!.periodEnd!.getTime(),
        );
      }
      expect(
        reports[reports.length - 1]!.periodEnd!.getTime(),
      ).toBeLessThanOrEqual(billedUntil);
      expect(store.purchase.usageReportedUntil!.getTime()).toBe(billedUntil);

      // Each in an hour of its own, each sent and taken once.
      const hours: Set<number> = new Set<number>(
        reports.map((report: MarketplaceUsageReport): number => {
          return MarketplaceUsageHour.getHour(report.periodEnd!).getTime();
        }),
      );
      expect(hours.size).toBe(reports.length);
      expect(
        new Set<string>(
          sentRecords().map((record: MarketplaceUsageRecord): string => {
            return record.reportId;
          }),
        ).size,
      ).toBe(reports.length);
      for (const report of reports) {
        expect(report.status).toBe(MarketplaceUsageReportStatus.Reported);
      }

      // Every top-up in exactly one of them.
      for (const charge of store.charges) {
        expect(storedReport(charge.marketplaceUsageReportId)).toBeDefined();
      }

      /*
       * Together - with the fraction of a cent still carried - exactly what
       * was owed, to the millionths of a dollar the calculator rounds to.
       * A minute of the project's usage is half a cent.
       */
      const months: number = MarketplaceUsageCalculator.getMonthsInPeriod({
        periodStart: new Date(scenario.linkedAt),
        periodEnd: new Date(billedUntil),
        notBefore: null,
      });
      const owed: number =
        (SEATS * SEAT_PRICE + MONITORS * MONITOR_PRICE) * months +
        scenario.topUps.reduce(
          (sum: number, each: { amountInUSD: number }): number => {
            return sum + each.amountInUSD;
          },
          0,
        ) +
        scenario.telemetry.reduce(
          (sum: number, each: { costInUSD: number }): number => {
            return sum + each.costInUSD;
          },
          0,
        );
      const billed: number =
        reports.reduce((sum: number, report: MarketplaceUsageReport) => {
          return sum + report.quantity! / 100;
        }, 0) + Number(store.purchase.unreportedUsageInUSD?.value || 0);

      expect(Math.abs(billed - owed)).toBeLessThan(0.0001);
    };

    it("when the delete goes through", async () => {
      const random: SeededRandom = seededRandom(4896);

      for (let draw: number = 0; draw < 30; draw++) {
        jest.clearAllMocks();
        wireStore();
        mocked(Semaphore.lock).mockResolvedValue({ key: "lock" });

        const scenario: Scenario = drawScenario(random, false);
        const billedUntil: number = await simulate(scenario);

        // Billed up to the delete, and nothing after it.
        expect(billedUntil).toBe(scenario.deletedAt);
        checkBilledOnce(scenario, billedUntil);
      }
    });

    it("when the delete fails and the hourly job goes on billing the project", async () => {
      const random: SeededRandom = seededRandom(4897);

      for (let draw: number = 0; draw < 30; draw++) {
        jest.clearAllMocks();
        wireStore();
        mocked(Semaphore.lock).mockResolvedValue({ key: "lock" });

        const scenario: Scenario = drawScenario(random, true);
        const billedUntil: number = await simulate(scenario);

        checkBilledOnce(scenario, billedUntil);
      }
    });
  });
});
