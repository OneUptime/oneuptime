import { afterEach, describe, expect, jest, test } from "@jest/globals";
import DataAssetService from "../../../../Server/Services/DataAssetService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import PayAsYouGoBillingService from "../../../../Server/Services/PayAsYouGoBillingService";
import { WatchedTableMeteredPlan } from "../../../../Server/Types/Billing/MeteredPlan/AllMeteredPlans";
import WatchedTableMeteredPlanType from "../../../../Server/Types/Billing/MeteredPlan/WatchedTableMeteredPlan";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import { CollectedTable } from "../../../../Server/Utils/DataObservability/TableHealthCollector";
import TableHealthIngest from "../../../../Server/Utils/DataObservability/TableHealthIngest";
import WatchedTableLimit from "../../../../Server/Utils/DataObservability/WatchedTableLimit";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Once watched tables are charged, a project with no way to pay keeps what it
 * watches and adds no more than its free tables. Views are free, so they are
 * always added, and where nothing is billed nothing is held back.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const STORE_ID: ObjectID = ObjectID.generate();

function collectedTable(name: string, kind: DataAssetKind): CollectedTable {
  return {
    schema: "public",
    name,
    kind,
    rowCount: 1,
    sizeInBytes: 1,
    columns: [],
  } as unknown as CollectedTable;
}

async function collect(data: {
  room: number;
  tables: Array<CollectedTable>;
}): Promise<{ created: Array<string>; warnings: Array<string> }> {
  jest.spyOn(DataAssetService, "findAllBy").mockResolvedValue([]);
  jest.spyOn(MonitorMetricUtil, "getRetentionDays").mockResolvedValue(30);
  jest
    .spyOn(WatchedTableLimit, "getRoomForNewTables")
    .mockResolvedValue(data.room);
  jest
    .spyOn(DataStoreService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(TableHealthIngest as never, "writeMetricRows")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(TableHealthIngest as never, "writeNewPersonalDataColumns")
    .mockResolvedValue(undefined as never);

  const created: Array<string> = [];

  jest
    .spyOn(TableHealthIngest as never, "createAsset")
    .mockImplementation((async (input: {
      table: CollectedTable;
    }): Promise<ObjectID> => {
      created.push(input.table.name);

      return ObjectID.generate();
    }) as never);

  const warnings: Array<string> = [];

  await TableHealthIngest.recordSnapshot({
    store: {
      id: STORE_ID,
      projectId: PROJECT_ID,
      name: "Shop",
      kind: "PostgreSQL",
    } as never,
    snapshot: {
      engine: "postgres",
      collectedAt: new Date().toISOString(),
      isComplete: true,
      warnings,
      tables: data.tables,
    } as never,
  });

  return { created, warnings };
}

describe("what a collection adds", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("adds every table while there is room", async () => {
    const { created, warnings } = await collect({
      room: Number.POSITIVE_INFINITY,
      tables: [
        collectedTable("a", DataAssetKind.Table),
        collectedTable("b", DataAssetKind.Table),
      ],
    });

    expect(created).toEqual(["a", "b"]);
    expect(warnings).toEqual([]);
  });

  test("leaves out the tables past its room, and says so", async () => {
    const { created, warnings } = await collect({
      room: 1,
      tables: [
        collectedTable("a", DataAssetKind.Table),
        collectedTable("b", DataAssetKind.Table),
        collectedTable("c", DataAssetKind.Table),
      ],
    });

    expect(created).toEqual(["a"]);
    expect(warnings.join(" ")).toContain("2 more tables were left out");
    expect(warnings.join(" ")).toContain("Add a payment method");
  });

  test("always adds a view, which is free", async () => {
    const { created, warnings } = await collect({
      room: 0,
      tables: [
        collectedTable("a", DataAssetKind.Table),
        collectedTable("a_view", DataAssetKind.View),
      ],
    });

    expect(created).toEqual(["a_view"]);
    expect(warnings.join(" ")).toContain("1 more tables were left out");
  });
});

describe("the room a project has", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is unlimited where nothing is billed", async () => {
    const canPay: ReturnType<typeof jest.spyOn> = jest.spyOn(
      PayAsYouGoBillingService,
      "canUsePayAsYouGo",
    );

    await expect(
      WatchedTableLimit.getRoomForNewTables(PROJECT_ID),
    ).resolves.toBe(Number.POSITIVE_INFINITY);
    expect(canPay).not.toHaveBeenCalled();
  });

  describe("once tables are charged", () => {
    function charging(data: { canPay: boolean; tableCount: number }): void {
      jest.spyOn(WatchedTableLimit, "isCharging").mockReturnValue(true);
      jest
        .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
        .mockResolvedValue(data.canPay);
      jest
        .spyOn(WatchedTableMeteredPlanType, "countWatchedTables")
        .mockResolvedValue(data.tableCount);
    }

    test("is unlimited with a way to pay", async () => {
      charging({ canPay: true, tableCount: 5000 });

      await expect(
        WatchedTableLimit.getRoomForNewTables(PROJECT_ID),
      ).resolves.toBe(Number.POSITIVE_INFINITY);
    });

    test("is what is left of the free tables without one", async () => {
      charging({ canPay: false, tableCount: 60 });

      await expect(
        WatchedTableLimit.getRoomForNewTables(PROJECT_ID),
      ).resolves.toBe(40);
    });

    test("is none past them, and nothing already watched is touched", async () => {
      charging({ canPay: false, tableCount: 150 });

      await expect(
        WatchedTableLimit.getRoomForNewTables(PROJECT_ID),
      ).resolves.toBe(0);
    });

    test("a hiccup reading the payment setup costs nobody a table", async () => {
      jest.spyOn(WatchedTableLimit, "isCharging").mockReturnValue(true);
      jest
        .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
        .mockRejectedValue(new Error("Stripe is down"));

      await expect(
        WatchedTableLimit.getRoomForNewTables(PROJECT_ID),
      ).resolves.toBe(Number.POSITIVE_INFINITY);
    });
  });

  test("the plan is the one project services bill with", () => {
    expect(WatchedTableMeteredPlan).toBeInstanceOf(WatchedTableMeteredPlanType);
  });
});
