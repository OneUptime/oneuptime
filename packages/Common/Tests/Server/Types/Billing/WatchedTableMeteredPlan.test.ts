import { afterEach, describe, expect, jest, test } from "@jest/globals";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import Project from "../../../../Models/DatabaseModels/Project";
import { WatchedTablePricingConfig } from "../../../../Server/EnvironmentConfig";
import BillingService from "../../../../Server/Services/BillingService";
import DataAssetService from "../../../../Server/Services/DataAssetService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import PayAsYouGoBillingService, {
  LiveUsageAuthorization,
} from "../../../../Server/Services/PayAsYouGoBillingService";
import ProjectService from "../../../../Server/Services/ProjectService";
import { WatchedTableMeteredPlan } from "../../../../Server/Types/Billing/MeteredPlan/AllMeteredPlans";
import WatchedTableMeteredPlanType from "../../../../Server/Types/Billing/MeteredPlan/WatchedTableMeteredPlan";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../../Types/ObjectID";

/*
 * What reaches the payment provider for a project's watched tables: the month's
 * cost in cents, nothing at all while no price is named, and nothing a project
 * with no way to pay could not pay.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const STORE_ID: ObjectID = ObjectID.generate();
const PRICE_ID: string = "price_watched_tables";
const AUTHORIZATION: LiveUsageAuthorization =
  {} as unknown as LiveUsageAuthorization;

function stub(data: {
  tableCount: number;
  storeCount?: number;
  hasPrice?: boolean;
  canPay?: boolean;
  subscriptionItems?: Array<string>;
}): {
  report: ReturnType<typeof jest.fn>;
  saved: ReturnType<typeof jest.fn>;
  count: ReturnType<typeof jest.fn>;
} {
  const store: DataStore = new DataStore();
  store.id = STORE_ID;

  jest
    .spyOn(DataStoreService, "findAllBy")
    .mockResolvedValue(data.storeCount === 0 ? [] : [store]);
  const count: ReturnType<typeof jest.fn> = jest
    .spyOn(DataAssetService, "countBy")
    .mockResolvedValue({
      toNumber: () => {
        return data.tableCount;
      },
    } as never) as unknown as ReturnType<typeof jest.fn>;
  const saved: ReturnType<typeof jest.fn> = jest
    .spyOn(ProjectService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never) as unknown as ReturnType<
    typeof jest.fn
  >;
  const project: Project = new Project();
  project.paymentProviderMeteredSubscriptionId = "sub_metered";
  project.paymentProviderPlanId = "plan";
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue(project);
  jest
    .spyOn(BillingService, "hasMeteredPlanPriceId")
    .mockReturnValue(data.hasPrice !== false);
  jest.spyOn(BillingService, "getMeteredPlanPriceId").mockReturnValue(PRICE_ID);
  jest
    .spyOn(PayAsYouGoBillingService, "authorizeUsageNow")
    .mockResolvedValue(data.canPay === false ? null : AUTHORIZATION);
  jest.spyOn(BillingService, "getSubscriptionItems").mockResolvedValue(
    (data.subscriptionItems || []).map((id: string) => {
      return { price: { id } };
    }) as never,
  );
  const report: ReturnType<typeof jest.fn> = jest
    .spyOn(BillingService, "addOrUpdateMeteredPricingOnSubscription")
    .mockResolvedValue(undefined) as unknown as ReturnType<typeof jest.fn>;

  return { report, saved, count };
}

describe("The watched table bill", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is a plan of its own", () => {
    expect(WatchedTableMeteredPlan.getProductType()).toBe(
      ProductType.WatchedTables,
    );
  });

  test("counts tables, and not views, of the databases being watched", async () => {
    const { count } = stub({ tableCount: 7 });

    await expect(
      WatchedTableMeteredPlanType.countWatchedTables(PROJECT_ID),
    ).resolves.toBe(7);

    const query: { assetKind: unknown; isDropped: boolean } = (
      count.mock.calls[0]![0] as {
        query: { assetKind: unknown; isDropped: boolean };
      }
    ).query;

    expect(query.isDropped).toBe(false);
    expect(JSON.stringify(query.assetKind)).toContain(DataAssetKind.View);
    expect(DataStoreService.findAllBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          projectId: PROJECT_ID,
          isArchived: false,
          isTableHealthEnabled: true,
        },
      }),
    );
  });

  test("a project watching no database watches no tables", async () => {
    const { report } = stub({ tableCount: 99, storeCount: 0 });

    await WatchedTableMeteredPlan.reportQuantityToBillingProvider(PROJECT_ID);

    expect(report).not.toHaveBeenCalled();
    expect(DataAssetService.countBy).not.toHaveBeenCalled();
  });

  test("with no price named, keeps the count and tells the provider nothing", async () => {
    const { report, saved } = stub({ tableCount: 500, hasPrice: false });

    await WatchedTableMeteredPlan.reportQuantityToBillingProvider(PROJECT_ID);

    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentWatchedTablesCount: 500 } }),
    );
    expect(report).not.toHaveBeenCalled();
  });

  test("reports the month's cost in cents, not the count", async () => {
    const { report } = stub({ tableCount: 500 });

    await WatchedTableMeteredPlan.reportQuantityToBillingProvider(PROJECT_ID);

    // 400 tables past the free 100, at $1.
    expect(WatchedTablePricingConfig.includedTables).toBe(100);
    expect(report).toHaveBeenCalledWith(
      "sub_metered",
      WatchedTableMeteredPlan,
      40000,
      { liveAuthorization: AUTHORIZATION },
    );
  });

  test("charges a project that cannot pay nothing", async () => {
    const { report } = stub({ tableCount: 500, canPay: false });

    await WatchedTableMeteredPlan.reportQuantityToBillingProvider(PROJECT_ID);

    expect(report).not.toHaveBeenCalled();
  });

  test("inside the free tables, adds no line to the invoice and asks for no way to pay", async () => {
    const { report } = stub({ tableCount: 60 });

    await WatchedTableMeteredPlan.reportQuantityToBillingProvider(PROJECT_ID);

    expect(report).not.toHaveBeenCalled();
    expect(PayAsYouGoBillingService.authorizeUsageNow).not.toHaveBeenCalled();
  });

  test("back inside the free tables, replaces what it reported earlier this month", async () => {
    const { report } = stub({
      tableCount: 60,
      subscriptionItems: [PRICE_ID],
    });

    await WatchedTableMeteredPlan.reportQuantityToBillingProvider(PROJECT_ID);

    expect(report).toHaveBeenCalledWith(
      "sub_metered",
      WatchedTableMeteredPlan,
      0,
    );
  });
});
