import MarketplaceChargeService, {
  Service,
} from "../../../Server/Services/MarketplaceChargeService";
import MarketplaceSubscriptionService from "../../../Server/Services/MarketplaceSubscriptionService";
import MarketplaceCharge from "../../../Models/DatabaseModels/MarketplaceCharge";
import MarketplaceSubscription from "../../../Models/DatabaseModels/MarketplaceSubscription";
import ProjectBalanceType from "../../../Types/Billing/ProjectBalanceType";
import BadDataException from "../../../Types/Exception/BadDataException";
import CloudMarketplace from "../../../Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "../../../Types/Marketplace/MarketplaceSubscriptionStatus";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * A top-up of a marketplace-billed project's balance is recorded here, to be
 * billed with the next hourly usage report - and only while the purchase
 * that pays for the project is active on its marketplace. Otherwise nothing
 * is recorded, and the refusal says where to put it right.
 */

jest.mock("../../../Server/Services/MarketplaceSubscriptionService", () => {
  return {
    __esModule: true,
    default: { findPurchaseForProject: jest.fn() },
  };
});

const PROJECT_ID: ObjectID = ObjectID.generate();

const purchase: (
  overrides?: Partial<MarketplaceSubscription>,
) => MarketplaceSubscription = (
  overrides?: Partial<MarketplaceSubscription>,
): MarketplaceSubscription => {
  return Object.assign(new MarketplaceSubscription(), {
    _id: ObjectID.generate().toString(),
    marketplace: CloudMarketplace.AWS,
    externalSubscriptionId: "arn:aws:license-manager::1:license:l-1",
    status: MarketplaceSubscriptionStatus.Active,
    projectId: PROJECT_ID,
    ...overrides,
  });
};

describe("MarketplaceChargeService.recordBalanceRecharge", () => {
  let findPurchase: jest.Mock;
  let create: jest.SpyInstance;

  beforeEach(() => {
    findPurchase =
      MarketplaceSubscriptionService.findPurchaseForProject as unknown as jest.Mock;
    findPurchase.mockReset();
    create = getJestSpyOn(
      MarketplaceChargeService,
      "create",
    ).mockImplementation(
      async (data: { data: MarketplaceCharge }): Promise<MarketplaceCharge> => {
        return data.data;
      },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("records the top-up against the active purchase that pays for the project", async () => {
    const active: MarketplaceSubscription = purchase();
    findPurchase.mockResolvedValue(active);

    await MarketplaceChargeService.recordBalanceRecharge({
      projectId: PROJECT_ID,
      balanceType: ProjectBalanceType.SmsOrCall,
      amountInUSD: 50,
      isAutomatic: true,
    });

    expect(findPurchase).toHaveBeenCalledWith(PROJECT_ID);

    const recorded: MarketplaceCharge = (
      create.mock.calls[0]![0] as { data: MarketplaceCharge }
    ).data;

    expect(recorded.marketplaceSubscriptionId).toEqual(active.id);
    expect(recorded.projectId).toEqual(PROJECT_ID);
    expect(recorded.marketplace).toBe(CloudMarketplace.AWS);
    expect(recorded.balanceType).toBe(ProjectBalanceType.SmsOrCall);
    expect(Number(recorded.amountInUSD!.value)).toBe(50);
    expect(recorded.isAutomatic).toBe(true);
    // Not billed yet: the next hourly report takes it.
    expect(recorded.marketplaceUsageReportId).toBeUndefined();
  });

  it("records nothing while the purchase is suspended, cancelled, unlinked or missing", async () => {
    for (const current of [
      purchase({ status: MarketplaceSubscriptionStatus.Suspended }),
      purchase({ status: MarketplaceSubscriptionStatus.Cancelled }),
      purchase({ status: MarketplaceSubscriptionStatus.Pending }),
      purchase({ projectId: undefined }),
      null,
    ]) {
      findPurchase.mockResolvedValueOnce(current);

      const error: unknown =
        await MarketplaceChargeService.recordBalanceRecharge({
          projectId: PROJECT_ID,
          balanceType: ProjectBalanceType.AI,
          amountInUSD: 20,
          isAutomatic: false,
        }).catch((err: unknown) => {
          return err;
        });

      expect(error).toBeInstanceOf(BadDataException);
    }

    expect(create).not.toHaveBeenCalled();
  });

  it("says where to put a refusal right", async () => {
    findPurchase.mockResolvedValue(
      purchase({
        marketplace: CloudMarketplace.Azure,
        status: MarketplaceSubscriptionStatus.Suspended,
      }),
    );

    await expect(
      MarketplaceChargeService.recordBalanceRecharge({
        projectId: PROJECT_ID,
        balanceType: ProjectBalanceType.AI,
        amountInUSD: 20,
        isAutomatic: false,
      }),
    ).rejects.toThrow(
      "This project is billed through Microsoft Marketplace, and its subscription there is not active. Resolve it on Microsoft Marketplace, then try again.",
    );

    expect(Service.getInactivePurchaseMessage(undefined)).toContain(
      "its cloud marketplace",
    );
  });

  it("refuses an amount that is not a positive number, before looking anything up", async () => {
    for (const amountInUSD of [0, -20, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        MarketplaceChargeService.recordBalanceRecharge({
          projectId: PROJECT_ID,
          balanceType: ProjectBalanceType.SmsOrCall,
          amountInUSD: amountInUSD,
          isAutomatic: false,
        }),
      ).rejects.toThrow("Invalid amount");
    }

    expect(findPurchase).not.toHaveBeenCalled();
  });
});

describe("MarketplaceChargeService.findUnbilled", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads the purchase's charges no report has taken yet, oldest first", async () => {
    const findBy: jest.SpyInstance = getJestSpyOn(
      MarketplaceChargeService,
      "findBy",
    ).mockResolvedValue([]);
    const purchaseId: ObjectID = ObjectID.generate();

    await MarketplaceChargeService.findUnbilled(purchaseId);

    const query: Record<string, unknown> = (
      findBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(query["marketplaceSubscriptionId"]).toEqual(purchaseId);
    // The "is null" condition: a charge with a report id is billed already.
    expect(query["marketplaceUsageReportId"]).toBeDefined();
    expect(
      (findBy.mock.calls[0]![0] as { sort: Record<string, unknown> }).sort,
    ).toEqual({ createdAt: "ASC" });
  });
});
